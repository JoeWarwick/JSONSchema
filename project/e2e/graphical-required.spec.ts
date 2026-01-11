import { test, expect } from '@playwright/test';

// Increase per-test timeout for resolver-heavy flows
test.setTimeout(120000);

const resolvedSchema = {
  type: 'object',
  properties: {
    order: {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
        items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, price: { type: 'number', minimum: 0 } } } }
      }
    }
  }
};

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test.describe('Graphical Editor - required toggle', () => {
  test('toggling required on a property does not change graph structure', async ({ page }) => {
    await page.goto(BASE);

    // Seed a resolved (root-object) schema and reload so the graph renders synchronously
    await page.evaluate((s) => localStorage.setItem('schema-sculptor-schema', s), JSON.stringify(resolvedSchema));
    await page.reload();

    // Wait for resolved cache to be available before opening the editor
    await page.waitForFunction(() => {
      const l = (window as any).__lastSchemaLoad;
      return !!(l && (l.used === 'resolved' || l.used === 'resolvedCache'));
    }, null, { timeout: 60000 });

    // Open Graphical Schema Editor tab (robust: try role click, then DOM fallback)
    const clickTab = async (name: string) => {
      const byRole = page.getByRole('button', { name });
      try {
        await byRole.waitFor({ state: 'visible', timeout: 5000 });
        await byRole.scrollIntoViewIfNeeded();
        await byRole.click();
        return;
      } catch (e) {
        // fallback to DOM click via evaluate
      }
      const clicked = await page.evaluate((n) => {
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const b of buttons) {
          if ((b.textContent || '').trim() === n) {
            (b as HTMLElement).scrollIntoView();
            (b as HTMLElement).click();
            return true;
          }
        }
        // Also try anchors or role-less elements
        const others = Array.from(document.querySelectorAll('[role="tab"], a'));
        for (const o of others) {
          if ((o.textContent || '').trim() === n) {
            (o as HTMLElement).scrollIntoView();
            (o as HTMLElement).click();
            return true;
          }
        }
        return false;
      }, name);
      if (!clicked) throw new Error(`Failed to click tab: ${name}`);
    };

    await clickTab('Schema Editor');


    // Ensure graph nodes rendered
    // Wait for graph nodes to render (allow longer timeout for CI)
    await page.waitForSelector('.react-flow__node', { timeout: 60000 });

    // Snapshot node labels and counts
    const before = await page.evaluate(() => {
      const nodeEls = Array.from(document.querySelectorAll('.react-flow__node'));
      const labels = nodeEls.map((n: Element) => (n.textContent || '').trim().replace(/required/g, '').trim());
      const edgeEls = Array.from(document.querySelectorAll('.react-flow__edge'));
      return { labels, nodeCount: nodeEls.length, edgeCount: edgeEls.length };
    });

    // Select the orderId node by text
    await page.locator('text=orderId').first().click();

    // Ensure NodePropertyEditor shows the selected name
    await expect(page.locator('input[aria-label="Name"]')).toHaveValue('orderId');

    // Toggle the Required checkbox
    await page.locator('input[aria-label="Required"]').click();

    // small pause for graph processing
    await page.waitForTimeout(250);

    // Snapshot again
    const after = await page.evaluate(() => {
      const nodeEls = Array.from(document.querySelectorAll('.react-flow__node'));
      const labels = nodeEls.map((n: Element) => (n.textContent || '').trim().replace(/required/g, '').trim());
      const edgeEls = Array.from(document.querySelectorAll('.react-flow__edge'));
      return { labels, nodeCount: nodeEls.length, edgeCount: edgeEls.length };
    });

    // Assert structure unchanged
    expect(after.nodeCount).toBe(before.nodeCount);
    expect(after.edgeCount).toBe(before.edgeCount);
    expect(after.labels).toEqual(before.labels);
  });
});
