import { act, screen, waitFor } from '@testing-library/react';

function findExpandToggle(nodeEl: Element): HTMLButtonElement | null {
  return Array.from(nodeEl.querySelectorAll('button')).find(
    (btn) => {
      const title = btn.getAttribute('title');
      return title === 'Expand children' || title === 'Collapse children';
    }
  ) as HTMLButtonElement | null;
}

async function waitUntilExpanded(dataId: string, container: HTMLElement = document.body): Promise<void> {
  await waitFor(() => {
    const currentNode = container.querySelector(`.react-flow__node[data-id="${dataId}"]`);
    if (!currentNode) throw new Error(`waitUntilExpanded: node "${dataId}" not found`);
    const currentToggle = findExpandToggle(currentNode);
    // Some node re-renders can temporarily remove/recreate controls; treat missing as settled.
    if (!currentToggle) return;
    const title = currentToggle.getAttribute('title');
    if (title === 'Expand children') {
      throw new Error(`waitUntilExpanded: node "${dataId}" is still collapsed`);
    }
  });
}

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
    const expandNodes = Array.from(container.querySelectorAll('.react-flow__node'))
      .map((nodeEl) => {
        const toggle = findExpandToggle(nodeEl);
        return {
          dataId: nodeEl.getAttribute('data-id') || '',
          shouldExpand: toggle?.getAttribute('title') === 'Expand children',
        };
      })
      .filter((entry) => entry.dataId && entry.shouldExpand);

    if (expandNodes.length === 0) break;

    for (const entry of expandNodes) {
      await expandNodeByDataId(entry.dataId, container);
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
  const button = findExpandToggle(nodeEl);
  if (!button) {
    throw new Error(`expandNodeByLabel: no "Expand children" button found on node for text "${text}"`);
  }
  if (button.getAttribute('title') !== 'Expand children') return;

  const dataId = nodeEl.getAttribute('data-id');
  await act(async () => {
    button.click();
  });
  if (dataId) {
    await waitUntilExpanded(dataId);
  }
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
  const button = findExpandToggle(nodeEl);
  if (!button) {
    throw new Error(`expandNodeByDataId: no "Expand children" button found on node "${dataId}"`);
  }
  if (button.getAttribute('title') !== 'Expand children') return;

  await act(async () => {
    button.click();
  });
  await waitUntilExpanded(dataId, container);
}


