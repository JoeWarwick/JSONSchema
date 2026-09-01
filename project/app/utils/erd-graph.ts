import type { ErdModel } from '../types/erd';
import {
  attachEdgePositions,
  buildRelationshipEdge,
  buildTableNode,
  pruneGraphEdges,
  type ErdGraph,
} from './erd-graph-core';
import { layoutErdGraph } from './erd-layout';

export type { ErdTableNodeData, ErdRelationshipEdgeData, ErdGraph, ErdLayoutMeta } from './erd-graph-core';
export type { LayoutErdGraphOptions } from './erd-layout';
export { countEdgeCrossings, tableWidth, tableHeight, cardinalityLabel } from './erd-graph-core';
export { layoutErdGraph, countErdGraphCrossings } from './erd-layout';

export interface ErdModelToGraphOptions {
  useStoredPositions?: boolean;
  preferDifferentLayout?: boolean;
  useIlpUntangle?: boolean;
  spacingScale?: number;
  minVerticalGap?: number;
}

export function erdModelToGraph(model: ErdModel, options?: ErdModelToGraphOptions): ErdGraph {
  const useStoredPositions = options?.useStoredPositions !== false;
  const nodes = model.tables.map(buildTableNode);
  const edges = model.relationships.map(buildRelationshipEdge);

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
      preferDifferentFrom: options?.preferDifferentLayout && model.nodePositions ? model.nodePositions : undefined,
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

