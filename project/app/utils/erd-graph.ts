import * as dagre from 'dagre';
import solver from 'javascript-lp-solver';
import { Position, MarkerType } from 'reactflow';
import type { Edge, Node } from 'reactflow';
import type { ErdModel, ErdNavigation, ErdRelationship, ErdTable } from '../types/erd';

export interface ErdTableNodeData {
  table: ErdTable;
  onNavigationClick?: (tableId: string, navigation: ErdNavigation) => void;
  highlightedNavigationName?: string;
}

export interface ErdRelationshipEdgeData {
  relationship: ErdRelationship;
}

export interface ErdGraph {
  nodes: Node<ErdTableNodeData>[];
  edges: Edge<ErdRelationshipEdgeData>[];
  layoutMeta?: ErdLayoutMeta;
}

export interface ErdLayoutMeta {
  candidateCrossings: number;
  finalCrossings: number;
  ilpAttempted: boolean;
  ilpApplied: boolean;
  ilpStatus: 'disabled' | 'skipped-size' | 'skipped-trivial' | 'infeasible-or-timeout' | 'not-better' | 'applied';
}

interface DagreLayoutConfig {
  rankdir: 'LR' | 'RL' | 'TB' | 'BT';
  ranker: 'network-simplex' | 'tight-tree' | 'longest-path';
  nodesep: number;
  ranksep: number;
}

interface DagreLayoutResult {
  nodes: Node<ErdTableNodeData>[];
  rankdir: DagreLayoutConfig['rankdir'];
  ranks: Record<string, number>;
}

interface LayoutErdGraphOptions {
  preferDifferentFrom?: Record<string, { x: number; y: number }>;
  useIlpUntangle?: boolean;
  spacingScale?: number;
  minVerticalGap?: number;
}

interface ErdModelToGraphOptions {
  useStoredPositions?: boolean;
  preferDifferentLayout?: boolean;
  useIlpUntangle?: boolean;
  spacingScale?: number;
  minVerticalGap?: number;
}

interface LinearExpr {
  constant: number;
  coeffs: Record<string, number>;
}

interface IlpUntangleResult {
  status: ErdLayoutMeta['ilpStatus'];
  attempted: boolean;
  nodes?: Node<ErdTableNodeData>[];
}

export const tableWidth = (table: ErdTable): number => Math.max(240, Math.min(360, table.name.length * 10 + 80));
export const tableHeight = (table: ErdTable): number => 52 + Math.max(1, table.columns.length) * 26 + (table.navigations.length > 0 ? 34 : 0);

function positionForDirection(dx: number, dy: number): Position {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? Position.Right : Position.Left;
  return dy >= 0 ? Position.Bottom : Position.Top;
}

function oppositePosition(position: Position): Position {
  if (position === Position.Left) return Position.Right;
  if (position === Position.Right) return Position.Left;
  if (position === Position.Top) return Position.Bottom;
  return Position.Top;
}

function handleId(kind: 'source' | 'target', position: Position): string {
  return `${kind}-${position}`;
}

function attachEdgePositions(edge: Edge<ErdRelationshipEdgeData>, sourceNode: Node<ErdTableNodeData>, targetNode: Node<ErdTableNodeData>): Edge<ErdRelationshipEdgeData> {
  const sourceWidth = tableWidth(sourceNode.data.table);
  const sourceHeight = tableHeight(sourceNode.data.table);
  const targetWidth = tableWidth(targetNode.data.table);
  const targetHeight = tableHeight(targetNode.data.table);
  const sourceCenter = {
    x: sourceNode.position.x + sourceWidth / 2,
    y: sourceNode.position.y + sourceHeight / 2,
  };
  const targetCenter = {
    x: targetNode.position.x + targetWidth / 2,
    y: targetNode.position.y + targetHeight / 2,
  };
  const sourcePosition = positionForDirection(targetCenter.x - sourceCenter.x, targetCenter.y - sourceCenter.y);
  const targetPosition = oppositePosition(sourcePosition);

  return {
    ...edge,
    sourcePosition,
    targetPosition,
    sourceHandle: handleId('source', sourcePosition),
    targetHandle: handleId('target', targetPosition),
  } as unknown as Edge<ErdRelationshipEdgeData>;
}

function pruneGraphEdges(edges: Edge<ErdRelationshipEdgeData>[], nodes: Node<ErdTableNodeData>[]): Edge<ErdRelationshipEdgeData>[] {
  const nodeIds = new Set(nodes.map((node) => node.id));

  return edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
}

function edgeEndpoints(edge: Edge<ErdRelationshipEdgeData>, nodeById: Map<string, Node<ErdTableNodeData>>): { x1: number; y1: number; x2: number; y2: number } | null {
  const source = nodeById.get(edge.source);
  const target = nodeById.get(edge.target);
  if (!source || !target) return null;
  return {
    x1: source.position.x + tableWidth(source.data.table) / 2,
    y1: source.position.y + tableHeight(source.data.table) / 2,
    x2: target.position.x + tableWidth(target.data.table) / 2,
    y2: target.position.y + tableHeight(target.data.table) / 2,
  };
}

function orientation(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const value = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(value) < 1e-8) return 0;
  return value > 0 ? 1 : -1;
}

function segmentsProperlyIntersect(a: { x1: number; y1: number; x2: number; y2: number }, b: { x1: number; y1: number; x2: number; y2: number }): boolean {
  const o1 = orientation(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const o2 = orientation(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  const o3 = orientation(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const o4 = orientation(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  return o1 !== o2 && o3 !== o4;
}

function countEdgeCrossings(nodes: Node<ErdTableNodeData>[], edges: Edge<ErdRelationshipEdgeData>[]): number {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  let crossings = 0;

  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      const a = edges[i];
      const b = edges[j];
      if (a.source === b.source || a.source === b.target || a.target === b.source || a.target === b.target) {
        continue;
      }
      const segmentA = edgeEndpoints(a, nodeById);
      const segmentB = edgeEndpoints(b, nodeById);
      if (segmentA && segmentB && segmentsProperlyIntersect(segmentA, segmentB)) crossings += 1;
    }
  }

  return crossings;
}

function distanceFromPositions(nodes: Node<ErdTableNodeData>[], positions: Record<string, { x: number; y: number }>): number {
  let total = 0;
  for (const node of nodes) {
    const previous = positions[node.id];
    if (!previous) continue;
    const dx = node.position.x - previous.x;
    const dy = node.position.y - previous.y;
    total += Math.hypot(dx, dy);
  }
  return total;
}

function totalEdgeLength(nodes: Node<ErdTableNodeData>[], edges: Edge<ErdRelationshipEdgeData>[]): number {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  let total = 0;
  for (const edge of edges) {
    const segment = edgeEndpoints(edge, nodeById);
    if (!segment) continue;
    total += Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
  }
  return total;
}

function nodeDegreeMap(graph: ErdGraph): Map<string, number> {
  const degree = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
  }
  return degree;
}

function layoutNodeOrders(graph: ErdGraph): string[][] {
  const ids = graph.nodes.map((node) => node.id);
  const byName = [...ids].sort((a, b) => a.localeCompare(b));
  const byNameDesc = [...byName].reverse();
  const degree = nodeDegreeMap(graph);
  const byDegree = [...ids].sort((a, b) => {
    const delta = (degree.get(b) || 0) - (degree.get(a) || 0);
    if (delta !== 0) return delta;
    return a.localeCompare(b);
  });
  const byDegreeDesc = [...byDegree].reverse();
  return [ids, byName, byNameDesc, byDegree, byDegreeDesc];
}

function scoreLayout(nodes: Node<ErdTableNodeData>[], edges: Edge<ErdRelationshipEdgeData>[]): number {
  const crossings = countEdgeCrossings(nodes, edges);
  const length = totalEdgeLength(nodes, edges);
  return crossings * 1_000_000 + length;
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

function applyIlpRankUntangle(
  nodes: Node<ErdTableNodeData>[],
  edges: Edge<ErdRelationshipEdgeData>[],
  ranks: Record<string, number>,
  rankdir: DagreLayoutConfig['rankdir'],
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

  const nodeCount = nodes.length;
  if (nodeCount > 34) return { status: 'skipped-size', attempted: false };

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
      timeout: 1200,
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

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const updatedNodes = nodes.map((node) => ({ ...node, position: { ...node.position } }));
  const axis: 'x' | 'y' = rankdir === 'LR' || rankdir === 'RL' ? 'y' : 'x';

  for (const [rank, ids] of sortableRanks) {
    const rankNodes = ids
      .map((id) => nodeById.get(id))
      .filter((node): node is Node<ErdTableNodeData> => Boolean(node));
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

function optimizeByAxisSwaps(
  initialNodes: Node<ErdTableNodeData>[],
  edges: Edge<ErdRelationshipEdgeData>[],
  axis: 'x' | 'y',
): Node<ErdTableNodeData>[] {
  if (initialNodes.length > 44 || edges.length > 220) return initialNodes;

  const nodes = initialNodes.map((node) => ({
    ...node,
    position: { ...node.position },
  }));
  let bestScore = scoreLayout(nodes, edges);

  for (let pass = 0; pass < 2; pass += 1) {
    let improved = false;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const temp = a.position[axis];
        a.position[axis] = b.position[axis];
        b.position[axis] = temp;

        const candidateScore = scoreLayout(nodes, edges);
        if (candidateScore + 0.001 < bestScore) {
          bestScore = candidateScore;
          improved = true;
        } else {
          const rollback = a.position[axis];
          a.position[axis] = b.position[axis];
          b.position[axis] = rollback;
        }
      }
    }
    if (!improved) break;
  }

  return nodes;
}

function optimizeByGlobalNodeSwaps(
  initialNodes: Node<ErdTableNodeData>[],
  edges: Edge<ErdRelationshipEdgeData>[],
): Node<ErdTableNodeData>[] {
  if (initialNodes.length > 28 || edges.length > 240) return initialNodes;

  const nodes = initialNodes.map((node) => ({
    ...node,
    position: { ...node.position },
  }));
  let bestScore = scoreLayout(nodes, edges);

  const swapModes: Array<'x' | 'y' | 'xy'> = ['x', 'y', 'xy'];
  for (let pass = 0; pass < 2; pass += 1) {
    let improved = false;
    for (const mode of swapModes) {
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          const prevAx = a.position.x;
          const prevAy = a.position.y;
          const prevBx = b.position.x;
          const prevBy = b.position.y;

          if (mode === 'x' || mode === 'xy') {
            a.position.x = prevBx;
            b.position.x = prevAx;
          }
          if (mode === 'y' || mode === 'xy') {
            a.position.y = prevBy;
            b.position.y = prevAy;
          }

          const candidateScore = scoreLayout(nodes, edges);
          if (candidateScore + 0.001 < bestScore) {
            bestScore = candidateScore;
            improved = true;
          } else {
            a.position.x = prevAx;
            a.position.y = prevAy;
            b.position.x = prevBx;
            b.position.y = prevBy;
          }
        }
      }
    }
    if (!improved) break;
  }

  return nodes;
}

function scaleNodePositions(nodes: Node<ErdTableNodeData>[], scale: number): Node<ErdTableNodeData>[] {
  if (!Number.isFinite(scale) || scale <= 1) return nodes;
  if (nodes.length <= 1) return nodes;

  const centerX = nodes.reduce((sum, node) => sum + node.position.x, 0) / nodes.length;
  const centerY = nodes.reduce((sum, node) => sum + node.position.y, 0) / nodes.length;

  return nodes.map((node) => ({
    ...node,
    position: {
      x: centerX + (node.position.x - centerX) * scale,
      y: centerY + (node.position.y - centerY) * scale,
    },
  }));
}

function spreadVerticalCrowding(nodes: Node<ErdTableNodeData>[], minGap: number): Node<ErdTableNodeData>[] {
  if (!Number.isFinite(minGap) || minGap <= 0 || nodes.length < 2) return nodes;

  const next = nodes.map((node) => ({
    ...node,
    position: { ...node.position },
  }));

  const maxPasses = 4;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let moved = false;
    for (let i = 0; i < next.length; i += 1) {
      for (let j = i + 1; j < next.length; j += 1) {
        const a = next[i];
        const b = next[j];
        const aWidth = tableWidth(a.data.table);
        const bWidth = tableWidth(b.data.table);
        const aHeight = tableHeight(a.data.table);
        const bHeight = tableHeight(b.data.table);

        const aLeft = a.position.x;
        const aRight = a.position.x + aWidth;
        const bLeft = b.position.x;
        const bRight = b.position.x + bWidth;
        const xOverlap = Math.min(aRight, bRight) - Math.max(aLeft, bLeft);

        // Only separate vertically when tables substantially share a column footprint.
        if (xOverlap < 80) continue;

        const aTop = a.position.y;
        const bTop = b.position.y;

        const aIsUpper = aTop <= bTop;
        const upper = aIsUpper ? a : b;
        const lower = aIsUpper ? b : a;
        const upperHeight = aIsUpper ? aHeight : bHeight;
        const currentGap = lower.position.y - (upper.position.y + upperHeight);

        if (currentGap >= minGap) continue;

        const delta = (minGap - currentGap) / 2;
        upper.position.y -= delta;
        lower.position.y += delta;
        moved = true;
      }
    }
    if (!moved) break;
  }

  return next;
}

function runDagreLayout(graph: ErdGraph, config: DagreLayoutConfig, nodeOrder?: string[]): DagreLayoutResult {
  const layout = new dagre.graphlib.Graph();
  layout.setGraph({
    rankdir: config.rankdir,
    ranker: config.ranker,
    acyclicer: 'greedy',
    nodesep: config.nodesep,
    ranksep: config.ranksep,
    marginx: 40,
    marginy: 40,
  });
  layout.setDefaultEdgeLabel(() => ({}));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const orderedNodes = nodeOrder
    ? nodeOrder.map((id) => nodeById.get(id)).filter((node): node is Node<ErdTableNodeData> => Boolean(node))
    : graph.nodes;
  for (const node of orderedNodes) {
    layout.setNode(node.id, { width: tableWidth(node.data.table), height: tableHeight(node.data.table) });
  }
  for (const edge of graph.edges) layout.setEdge(edge.source, edge.target);
  dagre.layout(layout);

  const ranks: Record<string, number> = {};
  const laidOutNodes = graph.nodes.map((node) => {
    const position = layout.node(node.id);
    if (position && Number.isFinite(position.rank)) ranks[node.id] = Number(position.rank);
    return position ? { ...node, position: { x: position.x - position.width / 2, y: position.y - position.height / 2 } } : node;
  });

  if (Object.keys(ranks).length !== graph.nodes.length) {
    const axis: 'x' | 'y' = config.rankdir === 'LR' || config.rankdir === 'RL' ? 'x' : 'y';
    const values = [...new Set(laidOutNodes.map((node) => Math.round(node.position[axis] / 25) * 25))].sort((a, b) => a - b);
    const rankByValue = new Map(values.map((value, index) => [value, index]));
    for (const node of laidOutNodes) {
      const value = Math.round(node.position[axis] / 25) * 25;
      ranks[node.id] = rankByValue.get(value) ?? 0;
    }
  }

  const axis = config.rankdir === 'LR' || config.rankdir === 'RL' ? 'y' : 'x';
  const optimizedNodes = optimizeByAxisSwaps(laidOutNodes, graph.edges, axis);
  return {
    nodes: optimizedNodes,
    rankdir: config.rankdir,
    ranks,
  };
}

export function layoutErdGraph(graph: ErdGraph, options?: LayoutErdGraphOptions): ErdGraph {
  const layoutCandidates: DagreLayoutConfig[] = [
    { rankdir: 'LR', ranker: 'network-simplex', nodesep: 80, ranksep: 130 },
    { rankdir: 'TB', ranker: 'network-simplex', nodesep: 80, ranksep: 130 },
    { rankdir: 'LR', ranker: 'tight-tree', nodesep: 70, ranksep: 120 },
    { rankdir: 'TB', ranker: 'tight-tree', nodesep: 70, ranksep: 120 },
    { rankdir: 'RL', ranker: 'network-simplex', nodesep: 80, ranksep: 130 },
    { rankdir: 'BT', ranker: 'network-simplex', nodesep: 80, ranksep: 130 },
  ];

  const nodeOrders = layoutNodeOrders(graph);
  const candidateLayouts = layoutCandidates.flatMap((config) => nodeOrders.map((order) => {
    const result = runDagreLayout(graph, config, order);
    return {
      nodes: result.nodes,
      rankdir: result.rankdir,
      ranks: result.ranks,
      crossings: countEdgeCrossings(result.nodes, graph.edges),
    };
  }));

  const bestCrossings = Math.min(...candidateLayouts.map((candidate) => candidate.crossings));
  let chosen = candidateLayouts.find((candidate) => candidate.crossings === bestCrossings) ?? candidateLayouts[0];
  let ilpAttempted = false;
  let ilpApplied = false;
  let ilpStatus: ErdLayoutMeta['ilpStatus'] = options?.useIlpUntangle ? 'infeasible-or-timeout' : 'disabled';

  if (options?.preferDifferentFrom) {
    const alternatives = candidateLayouts
      .filter((candidate) => candidate.crossings <= bestCrossings + 1)
      .map((candidate) => ({
        ...candidate,
        movement: distanceFromPositions(candidate.nodes, options.preferDifferentFrom!),
      }))
      .sort((a, b) => {
        if (a.crossings !== b.crossings) return a.crossings - b.crossings;
        return b.movement - a.movement;
      });

    const movedAlternative = alternatives.find((candidate) => candidate.movement > 120);
    if (movedAlternative) {
      chosen = movedAlternative;
    }
  }

  if (options?.useIlpUntangle) {
    const ilpResult = applyIlpRankUntangle(chosen.nodes, graph.edges, chosen.ranks, chosen.rankdir);
    ilpAttempted = ilpResult.attempted;
    ilpStatus = ilpResult.status;
    if (ilpResult.nodes) {
      const ilpCrossings = countEdgeCrossings(ilpResult.nodes, graph.edges);
      if (ilpCrossings <= chosen.crossings) {
        ilpApplied = true;
        ilpStatus = 'applied';
        chosen = {
          ...chosen,
          nodes: ilpResult.nodes,
          crossings: ilpCrossings,
        };
      } else {
        ilpStatus = 'not-better';
      }
    }
  }

  const globallyOptimizedNodes = optimizeByGlobalNodeSwaps(chosen.nodes, graph.edges);
  const globalCrossings = countEdgeCrossings(globallyOptimizedNodes, graph.edges);
  if (globalCrossings <= chosen.crossings) {
    chosen = {
      ...chosen,
      nodes: globallyOptimizedNodes,
      crossings: globalCrossings,
    };
  }

  const spacedNodes = scaleNodePositions(chosen.nodes, options?.spacingScale ?? 1);
  const verticallySpreadNodes = spreadVerticalCrowding(spacedNodes, options?.minVerticalGap ?? 0);
  const spreadCrossings = countEdgeCrossings(verticallySpreadNodes, graph.edges);
  const finalNodes = spreadCrossings <= chosen.crossings ? verticallySpreadNodes : spacedNodes;
  chosen = {
    ...chosen,
    nodes: finalNodes,
    crossings: countEdgeCrossings(finalNodes, graph.edges),
  };

  return {
    nodes: chosen.nodes,
    edges: graph.edges,
    layoutMeta: {
      candidateCrossings: bestCrossings,
      finalCrossings: chosen.crossings,
      ilpAttempted,
      ilpApplied,
      ilpStatus,
    },
  };
}

export function countErdGraphCrossings(graph: ErdGraph): number {
  return countEdgeCrossings(graph.nodes, graph.edges);
}

export function erdModelToGraph(model: ErdModel, options?: ErdModelToGraphOptions): ErdGraph {
  const useStoredPositions = options?.useStoredPositions !== false;
  const nodes: Node<ErdTableNodeData>[] = model.tables.map((table) => ({
    id: table.id,
    type: 'erdTable',
    position: { x: 0, y: 0 },
    data: { table },
  }));
  const edges: Edge<ErdRelationshipEdgeData>[] = model.relationships.map((relationship) => ({
    id: relationship.id,
    source: relationship.dependentTable,
    target: relationship.principalTable,
    type: 'default',
    label: `${cardinalityLabel(relationship.dependentCardinality)} : ${cardinalityLabel(relationship.principalCardinality)}`,
    data: { relationship },
    animated: false,
    markerEnd: { type: MarkerType.ArrowClosed },
  }));

  const hasCompleteStoredPositions = Boolean(
    useStoredPositions
    && model.nodePositions
    && nodes.every((node) => Boolean(model.nodePositions?.[node.id])),
  );

  if (hasCompleteStoredPositions) {
    const positionedNodes = nodes.map((node) => ({
      ...node,
      position: model.nodePositions![node.id],
    }));
    const positionedById = new Map(positionedNodes.map((node) => [node.id, node]));
    const positionedEdges = edges.map((edge) => {
      const sourceNode = positionedById.get(edge.source);
      const targetNode = positionedById.get(edge.target);
      return sourceNode && targetNode ? attachEdgePositions(edge, sourceNode, targetNode) : edge;
    });
    return {
      nodes: positionedNodes,
      edges: pruneGraphEdges(positionedEdges, positionedNodes),
    };
  }

  const laidOutGraph = layoutErdGraph(
    { nodes, edges },
    {
      preferDifferentFrom: options?.preferDifferentLayout && model.nodePositions
        ? model.nodePositions
        : undefined,
      useIlpUntangle: options?.useIlpUntangle,
      spacingScale: options?.spacingScale,
      minVerticalGap: options?.minVerticalGap,
    },
  );
  const positionedNodes = laidOutGraph.nodes.map((node) => ({
    ...node,
    position: useStoredPositions ? (model.nodePositions?.[node.id] ?? node.position) : node.position,
  }));
  const positionedById = new Map(positionedNodes.map((node) => [node.id, node]));
  const positionedEdges = laidOutGraph.edges.map((edge) => {
    const sourceNode = positionedById.get(edge.source);
    const targetNode = positionedById.get(edge.target);
    return sourceNode && targetNode ? attachEdgePositions(edge, sourceNode, targetNode) : edge;
  });
  return {
    nodes: positionedNodes,
    edges: pruneGraphEdges(positionedEdges, positionedNodes),
  };
}

function cardinalityLabel(cardinality: ErdRelationship['principalCardinality']): string {
  if (cardinality === 'many') return '*';
  if (cardinality === 'zero-or-one') return '0..1';
  return '1';
}
