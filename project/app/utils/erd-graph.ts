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

export function layoutErdGraph(graph: ErdGraph): ErdGraph {
  const layout = new dagre.graphlib.Graph();
  layout.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 100, marginx: 40, marginy: 40 });
  layout.setDefaultEdgeLabel(() => ({}));
  for (const node of graph.nodes) {
    layout.setNode(node.id, { width: tableWidth(node.data.table), height: tableHeight(node.data.table) });
  }
  for (const edge of graph.edges) layout.setEdge(edge.source, edge.target);
  dagre.layout(layout);
  return {
    nodes: graph.nodes.map((node) => {
      const position = layout.node(node.id);
      return position ? { ...node, position: { x: position.x - position.width / 2, y: position.y - position.height / 2 } } : node;
    }),
    edges: graph.edges,
  };
}

export function erdModelToGraph(model: ErdModel): ErdGraph {
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
  const laidOutGraph = layoutErdGraph({ nodes, edges });
  const positionedNodes = laidOutGraph.nodes.map((node) => ({
    ...node,
    position: model.nodePositions?.[node.id] ?? node.position,
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
