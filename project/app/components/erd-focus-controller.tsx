import React from 'react';
import type { Node } from 'reactflow';
import { useReactFlow } from 'reactflow';
import type { ErdFocusRequest } from '../types/erd-editor';
import { tableHeight, tableWidth, type ErdTableNodeData } from '../utils/erd-graph';

interface ErdFocusControllerProps {
  focusRequest: ErdFocusRequest | null;
  nodes: Node<ErdTableNodeData>[];
}

/** Lives inside ReactFlowProvider so it can pan/zoom the canvas to center on a focused entity. */
export function ErdFocusController({ focusRequest, nodes }: ErdFocusControllerProps) {
  const { setCenter } = useReactFlow();
  const focusedTokenRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!focusRequest || focusedTokenRef.current === focusRequest.token) return;
    const node = nodes.find((candidate) => candidate.id === focusRequest.tableId);
    if (!node) return;
    focusedTokenRef.current = focusRequest.token;
    const width = node.width ?? tableWidth(node.data.table);
    const height = node.height ?? tableHeight(node.data.table);
    setCenter(node.position.x + width / 2, node.position.y + height / 2, { zoom: 1, duration: 500 });
  }, [focusRequest, nodes, setCenter]);

  return null;
}