import { test, expect } from '@playwright/test';

const unresolved = {
  $id: 'https://example.com/ecommerce.schema.json',
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: {
    product: {
      $anchor: 'ProductSchema',
      type: 'object',
      properties: {
        name: { type: 'string' },
        price: { type: 'number', minimum: 0 }
      }
    },
    order: {
      $anchor: 'OrderSchema',
      type: 'object',
      properties: {
        orderId: { type: 'string' },
        items: { type: 'array', items: { $ref: '#ProductSchema' } }
      }
    }
  }
};

// Set BASE_URL env var or default to http://localhost:5173 where Vite dev server runs
const BASE = process.env.BASE_URL || 'http://localhost:5173';

test.describe('Workbench E2E', () => {
  test('loading unresolved $defs schema from localStorage renders object root', async ({ page }) => {
    await page.goto(BASE);

    // Write unresolved schema into localStorage and reload
    await page.evaluate((s) => localStorage.setItem('schema-sculptor-schema', s), JSON.stringify(unresolved));
    await page.reload();

    // Click the Schema Input tab
    await page.locator('role=button[name="Schema Input"]').click();

    // Wait for the runtime debug handle to indicate resolved cache is available
    const start = Date.now();
    let last: any = null;
    while (Date.now() - start < 5000) {
      last = await page.evaluate(() => (window as any).__lastSchemaLoad);
      if (last && last.used === 'resolved') break;
      await page.waitForTimeout(100);
    }
    // If not resolved within timeout, capture diagnostics
    if (!last || last.used !== 'resolved') {
      // Save screenshot and dump debug
      await page.screenshot({ path: 'e2e/failure-debug.png', fullPage: true });
      // print last value for CI logs
      // eslint-disable-next-line no-console
      console.error('E2E: __lastSchemaLoad:', last);
    }

    // Wait for the Properties panel to be visible
    const propsHeader = page.locator('text=Properties').first();
    await expect(propsHeader).toBeVisible();
    // Validate that the resolved cache contains an `order` definition (fallback check)
    const hasOrderProp = await page.evaluate(() => {
      const last = (window as any).__lastSchemaLoad;
      return !!(last && last.resolvedCache && last.resolvedCache.properties && Object.prototype.hasOwnProperty.call(last.resolvedCache.properties, 'order'));
    });
    await expect(hasOrderProp).toBeTruthy();
  });
});
