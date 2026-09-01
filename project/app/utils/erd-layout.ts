import * as dagre from 'dagre';
import type { Node } from 'reactflow';
import type { ErdGraph, ErdLayoutMeta, ErdTableNodeData } from './erd-graph-core';
import { countEdgeCrossings, distanceFromPositions, tableHeight, tableWidth } from './erd-graph-core';
import { applyIlpRankUntangle } from './erd-layout-ilp';
import { optimizeByAxisSwaps, optimizeByGlobalNodeSwaps } from './erd-layout-heuristics';

export interface LayoutErdGraphOptions {
  preferDifferentFrom?: Record<string, { x: number; y: number }>;
  useIlpUntangle?: boolean;
  spacingScale?: number;
  minVerticalGap?: number;
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

  const candidateLayouts = layoutCandidates.flatMap((config) => layoutNodeOrders(graph).map((order) => {
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
