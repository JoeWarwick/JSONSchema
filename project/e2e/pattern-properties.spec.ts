import { test, expect } from '@playwright/test';

// Increase per-test timeout for resolver-heavy flows
test.setTimeout(120000);

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const baseSchema = {
  type: 'object',
  properties: {
    jobs: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
};

// Flaky in CI: treat this as a smoke test and allow a single retry when it flakes.
// Unit tests are authoritative for blocking behavior; this e2e is a higher-level smoke test.
test.describe('PatternProperties E2E', () => {
  test.describe.configure({ retries: 1 });
  test('Graphical -> add pattern property and Schema Editor reflects it', async ({ page }) => {
    await page.goto(BASE);

    // Seed the schema and reload so the graph renders synchronously
    await page.evaluate((s) => localStorage.setItem('schema-sculptor-schema', s), JSON.stringify(baseSchema));
    await page.reload();

    // Wait for page to be ready
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => null);
    await page.locator('[data-testid="schema-source-badge"]').waitFor({ state: 'visible', timeout: 30000 });

    // Navigate to Schema Input tab to access the properties editor
    await page.getByRole('button', { name: 'Schema Input' }).click();
    await page.waitForSelector('text=Properties', { timeout: 30000 });
    
    // Wait a bit for the schema to fully render
    await page.waitForTimeout(1000);

    // The "+ pattern property" button should be visible at the root level
    // This allows adding pattern properties directly to the root object
    const patternBtn = page.locator('button:has-text("+ pattern property")').first();
    await expect(patternBtn).toBeVisible({ timeout: 10000 });
    await patternBtn.click();
    await page.waitForTimeout(700);

    // After clicking, a pattern property input should appear
    // Look for the regex/pattern input field - typically has a default value of ".*"
    const patternInputs = page.locator('input[value=".*"]');
    const patternCount = await patternInputs.count();
    
    if (patternCount > 0) {
      // Update the pattern value
      const patternInput = patternInputs.first();
      await patternInput.click({ clickCount: 3 }); // Triple-click to select all
      await patternInput.fill('^test_pattern_');
      await patternInput.blur();
      await page.waitForTimeout(500);
    }

    // Verify the pattern property was added to the root schema
    const schemaHasPattern = await page.evaluate(() => {
      const last = (window as any).__lastSchemaLoad;
      try {
        const src = last && last.source;
        // Check if root has patternProperties
        if (src && src.patternProperties) {
          return Object.keys(src.patternProperties).length > 0;
        }
        return false;
      } catch (e) {
        console.error('Error checking schema:', e);
        return false;
      }
    });
    
    await expect(schemaHasPattern).toBeTruthy();
  });
});
