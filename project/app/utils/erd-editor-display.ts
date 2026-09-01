import type { Node } from 'reactflow';
import type { ErdNavigation } from '../types/erd';
import type { ErdDisplayNodeCacheEntry } from '../types/erd-editor';
import type { ErdTableNodeData } from './erd-graph';

export function buildErdDisplayNodes(
  nodes: Node<ErdTableNodeData>[],
  focusedNavigation: { tableId: string; navigationName: string } | null,
  onNavigationClick: (sourceTableId: string, navigation: ErdNavigation) => void,
  cache: Map<string, ErdDisplayNodeCacheEntry>,
) {
  return nodes.map((node) => {
    const highlightedNavigationName = focusedNavigation?.tableId === node.id ? focusedNavigation.navigationName : undefined;
    const cachedNode = cache.get(node.id);

    if (cachedNode && cachedNode.node.data === node.data && cachedNode.highlight === highlightedNavigationName) {
      return cachedNode.node;
    }

    const updatedNode = {
      ...node,
      data: {
        ...node.data,
        onNavigationClick,
        highlightedNavigationName,
      },
    } as Node<ErdTableNodeData>;

    cache.set(node.id, { node: updatedNode, highlight: highlightedNavigationName });
    return updatedNode;
  });
}