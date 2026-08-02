import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GraphicalSchemaEditor } from './graphical-schema-editor';

// Simulates a full drag: mousedown on the node, mousemove by (deltaX, deltaY), mouseup to drop —
// this is the sequence React Flow's drag handling listens for (not a native HTML5 drag). Passing
// `view: window` is required or reactflow's internal d3-drag code throws in jsdom.
function dragNodeBy(nodeEl: HTMLElement, deltaX: number, deltaY: number) {
  const rect = nodeEl.getBoundingClientRect();
  const startX = rect.left + rect.width / 2;
  const startY = rect.top + rect.height / 2;
  fireEvent.mouseDown(nodeEl, { button: 0, clientX: startX, clientY: startY, view: window });
  fireEvent.mouseMove(document, { clientX: startX + deltaX, clientY: startY + deltaY, view: window });
  fireEvent.mouseMove(document, { clientX: startX + deltaX, clientY: startY + deltaY, view: window });
  fireEvent.mouseUp(document, { clientX: startX + deltaX, clientY: startY + deltaY, view: window });
}

function translateOf(el: HTMLElement) {
  const match = (el.style.transform || '').match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : { x: 0, y: 0 };
}

describe('GraphicalSchemaEditor - dragging a parent node moves its children with it', () => {
  it('shifts nested object property nodes by the same delta as the dragged parent', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        address: {
          type: 'object',
          properties: {
            city: { type: 'string' },
            zip: { type: 'string' },
          },
        },
      },
    } as any;

    render(<GraphicalSchemaEditor schema={testSchema} onChange={() => {}} />);

    await waitFor(() => {
      expect(document.querySelector('.react-flow__node[data-id="1.address"]')).not.toBeNull();
      expect(document.querySelector('.react-flow__node[data-id="1.address.city"]')).not.toBeNull();
      expect(document.querySelector('.react-flow__node[data-id="1.address.zip"]')).not.toBeNull();
    });

    const addressNode = document.querySelector('.react-flow__node[data-id="1.address"]') as HTMLElement;
    const cityNode = document.querySelector('.react-flow__node[data-id="1.address.city"]') as HTMLElement;
    const zipNode = document.querySelector('.react-flow__node[data-id="1.address.zip"]') as HTMLElement;

    const addressBefore = translateOf(addressNode);
    const cityBefore = translateOf(cityNode);
    const zipBefore = translateOf(zipNode);

    dragNodeBy(addressNode, 150, 80);

    // The drag is done in screen pixels, which get divided by the viewport zoom to produce the
    // graph-space delta actually applied to node positions — so just assert the children moved
    // by the *same* graph-space delta as their dragged parent, not a specific screen-pixel amount.
    await waitFor(() => {
      const addressAfter = translateOf(addressNode);
      expect(Math.abs(addressAfter.x - addressBefore.x)).toBeGreaterThan(1);
    });

    const addressAfter = translateOf(addressNode);
    const addressDeltaX = addressAfter.x - addressBefore.x;
    const addressDeltaY = addressAfter.y - addressBefore.y;

    const cityAfter = translateOf(cityNode);
    expect(Math.abs((cityAfter.x - cityBefore.x) - addressDeltaX)).toBeLessThan(1);
    expect(Math.abs((cityAfter.y - cityBefore.y) - addressDeltaY)).toBeLessThan(1);

    const zipAfter = translateOf(zipNode);
    expect(Math.abs((zipAfter.x - zipBefore.x) - addressDeltaX)).toBeLessThan(1);
    expect(Math.abs((zipAfter.y - zipBefore.y) - addressDeltaY)).toBeLessThan(1);
  });
});
