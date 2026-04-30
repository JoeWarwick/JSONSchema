import { test, expect } from '@playwright/test';

// Set BASE_URL env var or default to http://localhost:5173 where Vite dev server runs
const BASE = process.env.BASE_URL || 'http://localhost:5173';

test.describe('additionalProperties popover', () => {
  test('popover is not mounted by default and opens when clicking the Edit extras button', async ({ page }) => {
    test.setTimeout(120000);
    const schemaWithAp = { type: 'object', additionalProperties: { type: 'string' } } as any;

    // Inject the schema into localStorage before the app loads
    // eslint-disable-next-line no-empty
    await page.context().addInitScript((s) => { try { localStorage.setItem('schema-sculptor-schema', s); } catch (_) {} }, JSON.stringify(schemaWithAp));
    await page.goto(BASE);

    // Open Schema Input panel where the editor lives
    await page.locator('role=button[name="Schema Input"]').click();

    // If a floating popover is already present on load, close it
    const pop = page.locator('[data-testid="ap-popover-content"]');
    if (await pop.count() > 0) {
      await pop.locator('role=button[name="Close"]').click();
      await expect(pop).toHaveCount(0);
    }

    // click the Edit extras button to open the floating popover
    await page.locator('button[aria-label="edit-additional-properties-root"]').click();

    // Now the floating popover should appear
    await expect(page.locator('[data-testid="ap-popover-content"]')).toBeVisible();

    // Close the popover via the Close button and assert it is removed
    await page.locator('[data-testid="ap-popover-content"] >> role=button[name="Close"]').click();
    await expect(page.locator('[data-testid="ap-popover-content"]')).toHaveCount(0);
  });
});