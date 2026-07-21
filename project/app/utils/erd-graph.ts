import * as dagre from 'dagre';
import type { Edge, Node } from 'reactflow';
import type { ErdModel, ErdRelationship, ErdTable } from '../types/erd';

export interface ErdTableNodeData {
  table: ErdTable;
}

export interface ErdRelationshipEdgeData {
  relationship: ErdRelationship;
}

export interface ErdGraph {
  nodes: Node<ErdTableNodeData>[];
  edges: Edge<ErdRelationshipEdgeData>[];
}

const tableWidth = (table: ErdTable): number => Math.max(240, Math.min(360, table.name.length * 10 + 80));
const tableHeight = (table: ErdTable): number => 52 + Math.max(1, table.columns.length) * 26 + (table.navigations.length > 0 ? 34 : 0);

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
  }));
  const laidOutGraph = layoutErdGraph({ nodes, edges });
  return {
    ...laidOutGraph,
    nodes: laidOutGraph.nodes.map((node) => ({
      ...node,
      position: model.nodePositions?.[node.id] ?? node.position,
    })),
  };
}

function cardinalityLabel(cardinality: ErdRelationship['principalCardinality']): string {
  if (cardinality === 'many') return '*';
  if (cardinality === 'zero-or-one') return '0..1';
  return '1';
}
