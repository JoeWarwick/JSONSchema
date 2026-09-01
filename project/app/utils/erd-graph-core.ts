import { MarkerType, Position } from 'reactflow';
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

export const tableWidth = (table: ErdTable): number => Math.max(240, Math.min(360, table.name.length * 10 + 80));
export const tableHeight = (table: ErdTable): number => 52 + Math.max(1, table.columns.length) * 26 + (table.navigations.length > 0 ? 34 : 0);

export function positionForDirection(dx: number, dy: number): Position {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? Position.Right : Position.Left;
  return dy >= 0 ? Position.Bottom : Position.Top;
}

export function oppositePosition(position: Position): Position {
  if (position === Position.Left) return Position.Right;
  if (position === Position.Right) return Position.Left;
  if (position === Position.Top) return Position.Bottom;
  return Position.Top;
}

export function handleId(kind: 'source' | 'target', position: Position): string {
  return `${kind}-${position}`;
}

export function attachEdgePositions(
  edge: Edge<ErdRelationshipEdgeData>,
  sourceNode: Node<ErdTableNodeData>,
  targetNode: Node<ErdTableNodeData>,
): Edge<ErdRelationshipEdgeData> {
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

export function pruneGraphEdges(edges: Edge<ErdRelationshipEdgeData>[], nodes: Node<ErdTableNodeData>[]): Edge<ErdRelationshipEdgeData>[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  return edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
}

export function edgeEndpoints(edge: Edge<ErdRelationshipEdgeData>, nodeById: Map<string, Node<ErdTableNodeData>>): { x1: number; y1: number; x2: number; y2: number } | null {
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

export function orientation(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const value = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(value) < 1e-8) return 0;
  return value > 0 ? 1 : -1;
}

export function segmentsProperlyIntersect(a: { x1: number; y1: number; x2: number; y2: number }, b: { x1: number; y1: number; x2: number; y2: number }): boolean {
  const o1 = orientation(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const o2 = orientation(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  const o3 = orientation(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const o4 = orientation(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  return o1 !== o2 && o3 !== o4;
}

export function countEdgeCrossings(nodes: Node<ErdTableNodeData>[], edges: Edge<ErdRelationshipEdgeData>[]): number {
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

export function distanceFromPositions(nodes: Node<ErdTableNodeData>[], positions: Record<string, { x: number; y: number }>): number {
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

export function totalEdgeLength(nodes: Node<ErdTableNodeData>[], edges: Edge<ErdRelationshipEdgeData>[]): number {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  let total = 0;
  for (const edge of edges) {
    const segment = edgeEndpoints(edge, nodeById);
    if (!segment) continue;
    total += Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
  }
  return total;
}

export function nodeDegreeMap(graph: ErdGraph): Map<string, number> {
  const degree = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
  }
  return degree;
}

export function layoutNodeOrders(graph: ErdGraph): string[][] {
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

export function scoreLayout(nodes: Node<ErdTableNodeData>[], edges: Edge<ErdRelationshipEdgeData>[]): number {
  const crossings = countEdgeCrossings(nodes, edges);
  const length = totalEdgeLength(nodes, edges);
  return crossings * 1_000_000 + length;
}

export function cardinalityLabel(cardinality: ErdRelationship['principalCardinality']): string {
  if (cardinality === 'many') return '*';
  if (cardinality === 'zero-or-one') return '0..1';
  return '1';
}

export function countErdGraphCrossings(graph: ErdGraph): number {
  return countEdgeCrossings(graph.nodes, graph.edges);
}

export function buildRelationshipEdge(relationship: ErdRelationship): Edge<ErdRelationshipEdgeData> {
  return {
    id: relationship.id,
    source: relationship.dependentTable,
    target: relationship.principalTable,
    type: 'default',
    label: `${cardinalityLabel(relationship.dependentCardinality)} : ${cardinalityLabel(relationship.principalCardinality)}`,
    data: { relationship },
    animated: false,
    markerEnd: { type: MarkerType.ArrowClosed },
  };
}

export function buildTableNode(table: ErdTable): Node<ErdTableNodeData> {
  return {
    id: table.id,
    type: 'erdTable',
    position: { x: 0, y: 0 },
    data: { table },
  };
}

export function normalizeStoredPositions<T extends Node<ErdTableNodeData>>(nodes: T[], nodePositions: ErdModel['nodePositions']): T[] {
  if (!nodePositions) return nodes;
  return nodes.map((node) => ({
    ...node,
    position: nodePositions[node.id] ?? node.position,
  }));
}
