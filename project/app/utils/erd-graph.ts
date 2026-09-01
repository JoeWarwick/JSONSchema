import * as dagre from 'dagre';
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
}

interface LayoutErdGraphOptions {
  preferDifferentFrom?: Record<string, { x: number; y: number }>;
}

interface ErdModelToGraphOptions {
  useStoredPositions?: boolean;
  preferDifferentLayout?: boolean;
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

  const laidOutNodes = graph.nodes.map((node) => {
    const position = layout.node(node.id);
    return position ? { ...node, position: { x: position.x - position.width / 2, y: position.y - position.height / 2 } } : node;
  });

  const axis = config.rankdir === 'LR' || config.rankdir === 'RL' ? 'y' : 'x';
  const optimizedNodes = optimizeByAxisSwaps(laidOutNodes, graph.edges, axis);
  return {
    nodes: optimizedNodes,
    rankdir: config.rankdir,
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
      crossings: countEdgeCrossings(result.nodes, graph.edges),
    };
  }));

  const bestCrossings = Math.min(...candidateLayouts.map((candidate) => candidate.crossings));
  let chosen = candidateLayouts.find((candidate) => candidate.crossings === bestCrossings) ?? candidateLayouts[0];

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

  return {
    nodes: chosen.nodes,
    edges: graph.edges,
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
  const laidOutGraph = layoutErdGraph(
    { nodes, edges },
    options?.preferDifferentLayout && model.nodePositions
      ? { preferDifferentFrom: model.nodePositions }
      : undefined,
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
