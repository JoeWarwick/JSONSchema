import { act, screen, waitFor } from '@testing-library/react';

/**
 * Test helper: nodes are collapsed by default (only the root's direct children are visible
 * on load). Repeatedly clicks every "Expand children" toggle button until none remain so
 * tests can assert on deeply nested graph content without modelling collapse state manually.
 */
export async function expandAllGraphNodes(container: HTMLElement = document.body): Promise<void> {
  await waitFor(() => {
    expect(container.querySelectorAll('.react-flow__node').length).toBeGreaterThan(0);
  });
  let iterations = 0;
  while (iterations < 50) {
    iterations += 1;
    const buttons = Array.from(container.querySelectorAll('button')).filter(
      (btn) => btn.getAttribute('title') === 'Expand children'
    );
    if (buttons.length === 0) break;
    for (const btn of buttons) {
      await act(async () => {
        btn.click();
      });
    }
  }
}

/**
 * Test helper: expands only the single graph node whose visible label matches `text`, by
 * clicking its "Expand children" toggle button. Useful for large real-world schema fixtures
 * where fully expanding the whole tree (via `expandAllGraphNodes`) would be too slow.
 */
export async function expandNodeByLabel(text: string): Promise<void> {
  const label = await screen.findByText(text);
  const nodeEl = label.closest('.react-flow__node');
  if (!nodeEl) {
    throw new Error(`expandNodeByLabel: could not find a containing .react-flow__node for text "${text}"`);
  }
  const button = Array.from(nodeEl.querySelectorAll('button')).find(
    (btn) => btn.getAttribute('title') === 'Expand children'
  );
  if (!button) {
    throw new Error(`expandNodeByLabel: no "Expand children" button found on node for text "${text}"`);
  }
  await act(async () => {
    button.click();
  });
}

/**
 * Test helper: expands only the single graph node with the given ReactFlow `data-id`, by
 * clicking its "Expand children" toggle button. Useful for nodes whose visible label is not
 * plain text (e.g. sequence/choice compositor nodes rendered as an icon).
 */
export async function expandNodeByDataId(dataId: string, container: HTMLElement = document.body): Promise<void> {
  const nodeEl = await waitFor(() => {
    const el = container.querySelector(`.react-flow__node[data-id="${dataId}"]`);
    if (!el) throw new Error(`expandNodeByDataId: node "${dataId}" not found`);
    return el;
  });
  const button = Array.from(nodeEl.querySelectorAll('button')).find(
    (btn) => btn.getAttribute('title') === 'Expand children'
  );
  if (!button) {
    throw new Error(`expandNodeByDataId: no "Expand children" button found on node "${dataId}"`);
  }
  await act(async () => {
    button.click();
  });
}


