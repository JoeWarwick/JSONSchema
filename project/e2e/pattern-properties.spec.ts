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

    // Wait for the 'jobs' node to be present (long timeout to handle CI slowness)
    await page.waitForSelector('text=jobs', { timeout: 120000 });


    // Tab click helper (robust to different render modes)
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

    // Open Graphical Schema Editor
    await clickTab('Schema Editor');

    // Wait for the Graphical Editor panel to be visible
    await page.waitForSelector('.react-flow', { timeout: 60000 });

    // Ensure the 'jobs' node is present and right-click it
    const jobsNode = await page.getByText('jobs').first();
    await jobsNode.waitFor({ state: 'visible', timeout: 60000 });
    await jobsNode.click({ button: 'right' });

    // Assert the "Add Property" menu item is disabled due to additionalProperties: false and no patternProperties
    const addPropertyBtn = await page.getByRole('button', { name: 'Add Property' }).first();
    await expect(addPropertyBtn).toBeDisabled();

    // Click Add Pattern Property in the context menu
    const addPattern = await page.getByText('Add Pattern Property');
    await addPattern.click();

    // Wait for a pattern node to appear (concise 'pattern' label)
    const patternNode = await page.locator('text=/^pattern$/i').first();
    await expect(patternNode).toBeVisible();

    // Select the pattern node and update its key
    await patternNode.click();
    // Wait for Pattern Key input to appear in NodePropertyEditor
    await page.waitForSelector('input[aria-label="Pattern Key"]', { timeout: 30000 });
    const patternKeyInput = page.getByLabel('Pattern Key');
    await patternKeyInput.fill('^jobX_');
    // Blur to trigger update
    await page.locator('body').click();

    // Wait for the emitted schema to include the patternProperties under jobs
    await page.waitForFunction(() => {
      const last = (window as any).__lastSchemaLoad;
      try {
        const src = last && last.source;
        return !!(src && src.properties && src.properties.jobs && src.properties.jobs.patternProperties && Object.keys(src.properties.jobs.patternProperties).length > 0);
      } catch (e) {
        return false;
      }
    }, null, { timeout: 60000 });

    // Confirm the key we set exists in the source schema
    const hasKey = await page.evaluate(() => {
      const last = (window as any).__lastSchemaLoad;
      const src = last && last.source;
      return !!(src && src.properties && src.properties.jobs && src.properties.jobs.patternProperties && Object.keys(src.properties.jobs.patternProperties).includes('^jobX_'));
    });
    await expect(hasKey).toBeTruthy();

    // Open the Schema Input tab and assert the Schema Editor shows Pattern properties UI
    await clickTab('Schema Input');
    await page.waitForSelector('text=Pattern properties', { timeout: 60000 });
    await expect(page.locator('text=Pattern properties')).toBeVisible();
  });
});
