import React from 'react';
import type { Node } from 'reactflow';
import { useReactFlow } from 'reactflow';
import type { ErdFocusRequest } from '../types/erd-editor';
import { tableHeight, tableWidth, type ErdTableNodeData } from '../utils/erd-graph';

interface ErdFocusControllerProps {
  focusRequest: ErdFocusRequest | null;
}

/** Lives inside ReactFlowProvider so it can pan/zoom the canvas to center on a focused entity. */
export function ErdFocusController({ focusRequest }: ErdFocusControllerProps) {
  const { getNode, setCenter } = useReactFlow();

  React.useEffect(() => {
    if (!focusRequest) return;
    const node = getNode(focusRequest.tableId) as Node<ErdTableNodeData> | undefined;
    if (!node) return;
    const width = node.width ?? tableWidth(node.data.table);
    const height = node.height ?? tableHeight(node.data.table);
    setCenter(node.position.x + width / 2, node.position.y + height / 2, { zoom: 1, duration: 500 });
  }, [focusRequest, getNode, setCenter]);

  return null;
}