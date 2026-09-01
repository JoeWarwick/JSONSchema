import solver from 'javascript-lp-solver';
import type { Edge, Node } from 'reactflow';
import type { ErdLayoutMeta, ErdRelationshipEdgeData, ErdTableNodeData } from './erd-graph-core';
import { countEdgeCrossings } from './erd-graph-core';

interface LinearExpr {
  constant: number;
  coeffs: Record<string, number>;
}

interface IlpUntangleResult {
  status: ErdLayoutMeta['ilpStatus'];
  attempted: boolean;
  nodes?: Node<ErdTableNodeData>[];
}

function ilpTimeoutMs(nodeCount: number, edgeCount: number): number {
  const scale = nodeCount + Math.floor(edgeCount / 3);
  if (scale <= 20) return 1200;
  if (scale <= 28) return 900;
  if (scale <= 36) return 700;
  return 500;
}

function createVar(model: any, name: string, kind: 'int' | 'binary' | 'continuous' = 'continuous'): void {
  if (!model.variables[name]) model.variables[name] = { obj: 0 };
  if (kind === 'int') model.ints[name] = 1;
  if (kind === 'binary') model.binaries[name] = 1;
}

function addExprTerm(expr: LinearExpr, variable: string, coefficient: number): void {
  if (Math.abs(coefficient) < 1e-12) return;
  expr.coeffs[variable] = (expr.coeffs[variable] || 0) + coefficient;
}

function exprVar(variable: string, coefficient = 1): LinearExpr {
  return { constant: 0, coeffs: { [variable]: coefficient } };
}

function exprAdd(base: LinearExpr, other: LinearExpr, scalar = 1): LinearExpr {
  const next: LinearExpr = { constant: base.constant + other.constant * scalar, coeffs: { ...base.coeffs } };
  for (const [name, coefficient] of Object.entries(other.coeffs)) {
    addExprTerm(next, name, coefficient * scalar);
  }
  return next;
}

function addLinearConstraint(model: any, name: string, relation: 'min' | 'max' | 'equal', expr: LinearExpr, rhs: number): void {
  model.constraints[name] = { [relation]: rhs - expr.constant };
  for (const [variable, coefficient] of Object.entries(expr.coeffs)) {
    createVar(model, variable);
    model.variables[variable][name] = (model.variables[variable][name] || 0) + coefficient;
  }
}

function orderExpr(orderVarByPair: Map<string, string>, a: string, b: string): LinearExpr {
  const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
  const variable = orderVarByPair.get(key);
  if (!variable) return { constant: 0, coeffs: {} };
  if (a < b) return exprVar(variable);
  return { constant: 1, coeffs: { [variable]: -1 } };
}

export function applyIlpRankUntangle(
  nodes: Node<ErdTableNodeData>[],
  edges: Edge<ErdRelationshipEdgeData>[],
  ranks: Record<string, number>,
  rankdir: 'LR' | 'RL' | 'TB' | 'BT',
): IlpUntangleResult {
  const rankToNodeIds = new Map<number, string[]>();
  for (const node of nodes) {
    const rank = ranks[node.id];
    if (!Number.isFinite(rank)) continue;
    const list = rankToNodeIds.get(rank) || [];
    list.push(node.id);
    rankToNodeIds.set(rank, list);
  }

  const sortableRanks = [...rankToNodeIds.entries()]
    .filter(([, ids]) => ids.length > 1)
    .sort((a, b) => a[0] - b[0]);
  if (sortableRanks.length === 0) return { status: 'skipped-trivial', attempted: false };

  if (nodes.length > 34) return { status: 'skipped-size', attempted: false };

  const edgeBands = new Map<string, Array<{ left: string; right: string }>>();
  for (const edge of edges) {
    const sourceRank = ranks[edge.source];
    const targetRank = ranks[edge.target];
    if (!Number.isFinite(sourceRank) || !Number.isFinite(targetRank) || sourceRank === targetRank) continue;
    const leftRank = Math.min(sourceRank, targetRank);
    const rightRank = Math.max(sourceRank, targetRank);
    const left = sourceRank <= targetRank ? edge.source : edge.target;
    const right = sourceRank <= targetRank ? edge.target : edge.source;
    const key = `${leftRank}->${rightRank}`;
    const list = edgeBands.get(key) || [];
    list.push({ left, right });
    edgeBands.set(key, list);
  }

  let crossingPairCount = 0;
  for (const bandEdges of edgeBands.values()) {
    for (let i = 0; i < bandEdges.length; i += 1) {
      for (let j = i + 1; j < bandEdges.length; j += 1) {
        const a = bandEdges[i];
        const b = bandEdges[j];
        if (a.left === b.left || a.right === b.right || a.left === b.right || a.right === b.left) continue;
        crossingPairCount += 1;
      }
    }
  }
  if (crossingPairCount === 0) return { status: 'skipped-trivial', attempted: false };
  if (crossingPairCount > 700) return { status: 'skipped-size', attempted: false };

  const model: any = {
    optimize: 'obj',
    opType: 'min',
    constraints: {},
    variables: {},
    ints: {},
    binaries: {},
    options: {
      timeout: ilpTimeoutMs(nodes.length, edges.length),
      tolerance: 0.0,
    },
  };

  const orderVarByPair = new Map<string, string>();

  for (const [rank, ids] of sortableRanks) {
    const sortedIds = [...ids].sort((a, b) => a.localeCompare(b));
    const m = sortedIds.length;
    for (const id of sortedIds) {
      const posVar = `p|${rank}|${id}`;
      createVar(model, posVar, 'int');
      addLinearConstraint(model, `pmax|${rank}|${id}`, 'max', exprVar(posVar), m - 1);
    }

    for (let i = 0; i < sortedIds.length; i += 1) {
      for (let j = i + 1; j < sortedIds.length; j += 1) {
        const a = sortedIds[i];
        const b = sortedIds[j];
        const key = `${a}\u0000${b}`;
        const ordVar = `ord|${rank}|${a}|${b}`;
        orderVarByPair.set(key, ordVar);
        createVar(model, ordVar, 'binary');

        const posA = `p|${rank}|${a}`;
        const posB = `p|${rank}|${b}`;
        const c1: LinearExpr = { constant: 0, coeffs: {} };
        addExprTerm(c1, posA, 1);
        addExprTerm(c1, posB, -1);
        addExprTerm(c1, ordVar, m);
        addLinearConstraint(model, `ordA|${rank}|${a}|${b}`, 'max', c1, m - 1);

        const c2: LinearExpr = { constant: 0, coeffs: {} };
        addExprTerm(c2, posB, 1);
        addExprTerm(c2, posA, -1);
        addExprTerm(c2, ordVar, -m);
        addLinearConstraint(model, `ordB|${rank}|${a}|${b}`, 'max', c2, -1);
      }
    }
  }

  let crossingVarIndex = 0;
  for (const [bandKey, bandEdges] of edgeBands.entries()) {
    const [leftRankText, rightRankText] = bandKey.split('->');
    const leftRank = Number(leftRankText);
    const rightRank = Number(rightRankText);
    if (!Number.isFinite(leftRank) || !Number.isFinite(rightRank)) continue;

    for (let i = 0; i < bandEdges.length; i += 1) {
      for (let j = i + 1; j < bandEdges.length; j += 1) {
        const a = bandEdges[i];
        const b = bandEdges[j];
        if (a.left === b.left || a.right === b.right || a.left === b.right || a.right === b.left) continue;

        const leftOrder = orderExpr(orderVarByPair, a.left, b.left);
        const rightOrder = orderExpr(orderVarByPair, a.right, b.right);
        const crossVar = `cross|${crossingVarIndex++}`;
        createVar(model, crossVar, 'binary');
        model.variables[crossVar].obj = 1;

        const z = exprVar(crossVar);
        const c1 = exprAdd(exprAdd(z, leftOrder, -1), rightOrder, 1);
        addLinearConstraint(model, `xor1|${leftRank}|${rightRank}|${crossVar}`, 'min', c1, 0);

        const c2 = exprAdd(exprAdd(z, leftOrder, 1), rightOrder, -1);
        addLinearConstraint(model, `xor2|${leftRank}|${rightRank}|${crossVar}`, 'min', c2, 0);

        const c3 = exprAdd(exprAdd(z, leftOrder, -1), rightOrder, -1);
        addLinearConstraint(model, `xor3|${leftRank}|${rightRank}|${crossVar}`, 'max', c3, 0);

        const c4 = exprAdd(exprAdd(z, leftOrder, 1), rightOrder, 1);
        addLinearConstraint(model, `xor4|${leftRank}|${rightRank}|${crossVar}`, 'max', c4, 2);
      }
    }
  }

  let result: any;
  try {
    result = solver.Solve(model);
  } catch {
    return { status: 'infeasible-or-timeout', attempted: true };
  }
  if (!result || result.feasible !== true) return { status: 'infeasible-or-timeout', attempted: true };

  const updatedNodes = nodes.map((node) => ({ ...node, position: { ...node.position } }));
  const axis: 'x' | 'y' = rankdir === 'LR' || rankdir === 'RL' ? 'y' : 'x';

  for (const [rank, ids] of sortableRanks) {
    const rankNodes = ids.map((id) => updatedNodes.find((node) => node.id === id)).filter((node): node is Node<ErdTableNodeData> => Boolean(node));
    if (rankNodes.length < 2) continue;

    const coords = rankNodes.map((node) => node.position[axis]).sort((a, b) => a - b);
    const order = rankNodes
      .map((node) => ({
        id: node.id,
        value: Number(result[`p|${rank}|${node.id}`]),
      }))
      .sort((a, b) => {
        if (a.value === b.value) return a.id.localeCompare(b.id);
        return a.value - b.value;
      });

    for (let i = 0; i < order.length; i += 1) {
      const node = updatedNodes.find((item) => item.id === order[i].id);
      if (node) node.position[axis] = coords[i] ?? node.position[axis];
    }
  }

  return {
    status: 'applied',
    attempted: true,
    nodes: updatedNodes,
  };
}

export function countIlpUntangleCrossings(nodes: Node<ErdTableNodeData>[], edges: Edge<ErdRelationshipEdgeData>[]): number {
  return countEdgeCrossings(nodes, edges);
}
