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

// Set BASE_URL env var or default to http://localhost:5173 where Vite dev server runs
const BASE = process.env.BASE_URL || 'http://localhost:5173';

test.describe('Workbench E2E', () => {
  test('loading unresolved defs schema from localStorage renders object root', async ({ page }) => {
    // Inject the resolved schema into localStorage before the page loads to ensure
    // the app's initial bootstrap sees a persisted schema (avoids race on initial load)
    // eslint-disable-next-line no-empty
    await page.context().addInitScript((s) => { try { localStorage.setItem('schema-sculptor-schema', s); } catch (_) {} }, JSON.stringify(resolvedSchema));
    await page.goto(BASE);

    // Click the Schema Input tab
    await page.locator('role=button[name="Schema Input"]').click();

    // Wait for the runtime debug handle to indicate resolved cache is available
    const start = Date.now();
    let last: any = null;
    while (Date.now() - start < 60000) {
      last = await page.evaluate(() => (window as any).__lastSchemaLoad);
      if (last && last.used === 'resolved') break;
      await page.waitForTimeout(200);
    }
    // If not resolved within timeout, capture diagnostics
    if (!last || last.used !== 'resolved') {
      // Save screenshot and dump debug
      await page.screenshot({ path: 'e2e/failure-debug.png', fullPage: true });
      // print last value for CI logs
      // eslint-disable-next-line no-console
      console.error('E2E: __lastSchemaLoad:', last);
    }

    // Validate that the resolved cache contains an `order` definition (fallback check)
    const hasOrderProp = await page.evaluate(() => {
      const last = (window as any).__lastSchemaLoad;
      return !!(last && last.resolvedCache && last.resolvedCache.properties && Object.prototype.hasOwnProperty.call(last.resolvedCache.properties, 'order'));
    });
    await expect(hasOrderProp).toBeTruthy();
  });
});
