import type { Edge, Node } from 'reactflow';
import type { ErdRelationshipEdgeData, ErdTableNodeData } from './erd-graph-core';
import { countEdgeCrossings, totalEdgeLength } from './erd-graph-core';

export function optimizeByAxisSwaps(
  initialNodes: Node<ErdTableNodeData>[],
  edges: Edge<ErdRelationshipEdgeData>[],
  axis: 'x' | 'y',
): Node<ErdTableNodeData>[] {
  if (initialNodes.length > 44 || edges.length > 220) return initialNodes;

  const nodes = initialNodes.map((node) => ({
    ...node,
    position: { ...node.position },
  }));
  let bestScore = countEdgeCrossings(nodes, edges) * 1_000_000 + totalEdgeLength(nodes, edges);

  for (let pass = 0; pass < 2; pass += 1) {
    let improved = false;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const temp = a.position[axis];
        a.position[axis] = b.position[axis];
        b.position[axis] = temp;

        const candidateScore = countEdgeCrossings(nodes, edges) * 1_000_000 + totalEdgeLength(nodes, edges);
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

export function optimizeByGlobalNodeSwaps(
  initialNodes: Node<ErdTableNodeData>[],
  edges: Edge<ErdRelationshipEdgeData>[],
): Node<ErdTableNodeData>[] {
  if (initialNodes.length > 28 || edges.length > 240) return initialNodes;

  const nodes = initialNodes.map((node) => ({
    ...node,
    position: { ...node.position },
  }));
  let bestScore = countEdgeCrossings(nodes, edges) * 1_000_000 + totalEdgeLength(nodes, edges);

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

          const candidateScore = countEdgeCrossings(nodes, edges) * 1_000_000 + totalEdgeLength(nodes, edges);
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
