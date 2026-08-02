import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GraphicalSchemaEditor } from './graphical-schema-editor';

// Simulates a full drag: mousedown on the node, mousemove to the target Y, mouseup to drop —
// this is the sequence React Flow's drag handling listens for (not a native HTML5 drag).
function dragNodeTo(nodeEl: HTMLElement, deltaY: number) {
  const rect = nodeEl.getBoundingClientRect();
  const startX = rect.left + rect.width / 2;
  const startY = rect.top + rect.height / 2;
  fireEvent.mouseDown(nodeEl, { button: 0, clientX: startX, clientY: startY, view: window });
  fireEvent.mouseMove(document, { clientX: startX, clientY: startY + deltaY, view: window });
  fireEvent.mouseMove(document, { clientX: startX, clientY: startY + deltaY, view: window });
  fireEvent.mouseUp(document, { clientX: startX, clientY: startY + deltaY, view: window });
}

describe('GraphicalSchemaEditor - drag-to-reorder sibling nodes', () => {
  it('reorders JSON object properties when a node is dragged below its sibling', async () => {
    let latestSchema: any = null;
    const onChange = jest.fn((next) => { latestSchema = next; });
    const testSchema = {
      type: 'object',
      properties: {
        alpha: { type: 'string' },
        beta: { type: 'string' },
      },
    } as any;

    render(<GraphicalSchemaEditor schema={testSchema} onChange={onChange} />);

    await waitFor(() => {
      expect(document.querySelector('.react-flow__node[data-id="1.alpha"]')).not.toBeNull();
      expect(document.querySelector('.react-flow__node[data-id="1.beta"]')).not.toBeNull();
    });

    const alphaNode = document.querySelector('.react-flow__node[data-id="1.alpha"]') as HTMLElement;
    // Drag alpha far below beta's position.
    dragNodeTo(alphaNode, 400);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const keys = Object.keys(latestSchema.properties);
    expect(keys.indexOf('beta')).toBeLessThan(keys.indexOf('alpha'));
  });

  it('reorders XML top-level complexTypes when one is dragged below the other', async () => {
    let latestSchema: any = null;
    const onChange = jest.fn((next) => { latestSchema = next; });
    const initialSchema = {
      'xs:schema': {
        'xs:complexType': [
          { '@attributes': { name: 'FirstType' } },
          { '@attributes': { name: 'SecondType' } },
        ],
      },
    } as any;

    render(<GraphicalSchemaEditor schema={initialSchema} schemaLanguage="xml" onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByText('FirstType')).toBeInTheDocument();
      expect(screen.getByText('SecondType')).toBeInTheDocument();
    });

    const firstTypeNode = screen.getByText('FirstType').closest('.react-flow__node') as HTMLElement;
    dragNodeTo(firstTypeNode, 400);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const names = latestSchema['xs:schema']['xs:complexType'].map((ct: any) => ct['@attributes'].name);
    expect(names.indexOf('SecondType')).toBeLessThan(names.indexOf('FirstType'));
  });
});
