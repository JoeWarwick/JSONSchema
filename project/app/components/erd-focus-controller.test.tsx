import React from 'react';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ReactFlow, { ReactFlowProvider } from 'reactflow';
import type { Node } from 'reactflow';
import type { ErdFocusRequest } from '../types/erd-editor';
import type { ErdTableNodeData } from '../utils/erd-graph';
import { ErdFocusController } from './erd-focus-controller';

describe('ErdFocusController', () => {
  it('waits for the requested node to appear before centering the graph', async () => {
    const focusRequest: ErdFocusRequest = { tableId: 'NewEntity', token: 1 };
    const node: Node<ErdTableNodeData> = {
      id: 'NewEntity',
      position: { x: 10, y: 20 },
      width: 100,
      height: 80,
      data: {
        table: {
          id: 'NewEntity',
          name: 'NewEntity',
          clrName: 'NewEntity',
          columns: [],
          navigations: [],
        },
      },
    };
    const renderGraph = (nodes: Node<ErdTableNodeData>[]) => (
      <ReactFlowProvider>
        <ReactFlow nodes={nodes} edges={[]}>
          <ErdFocusController focusRequest={focusRequest} nodes={nodes} />
        </ReactFlow>
      </ReactFlowProvider>
    );
    const { container, rerender } = render(renderGraph([]));
    const viewport = container.querySelector('.react-flow__viewport');
    expect(viewport).toHaveStyle({ transform: 'translate(0px,0px) scale(1)' });

    rerender(renderGraph([node]));

    await waitFor(() => {
      expect(viewport).not.toHaveStyle({ transform: 'translate(0px,0px) scale(1)' });
    });
  });
});
