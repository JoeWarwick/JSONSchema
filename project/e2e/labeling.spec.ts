import { test, expect } from '@playwright/test';

const ghaSubset = {
  "type": "object",
  "properties": {
    "jobs": {
      "type": "object",
      "patternProperties": {
        "^[_a-zA-Z][a-zA-Z0-9_-]*$": {
          "oneOf": [
            {
              "title": "Normal Job",
              "type": "object",
              "properties": {
                "runs-on": {
                  "anyOf": [
                    { "type": "string", "$comment": "https://example.com/github-hosted-runners" },
                    { "type": "array", "$comment": "https://example.com/self-hosted-runners" },
                    { "$ref": "#/definitions/expressionSyntax" }
                  ]
                }
              }
            }
          ]
        }
      }
    }
  },
  "definitions": {
    "expressionSyntax": {
      "type": "string",
      "pattern": "^\\$\\{\\{.*\\}\\}$"
    }
  }
};

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test.describe('Labeling E2E', () => {
  test('verify labeling of GHA-like schema', async ({ page }) => {
    test.setTimeout(120000);
    // Inject schema and clear local storage to avoid "stale storage" issues
    await page.context().addInitScript((s) => {
      try {
        localStorage.clear();
        localStorage.setItem('schema-sculptor-schema', s);
      } catch (_) {}
    }, JSON.stringify(ghaSubset));
    
    await page.goto(BASE);

    // Click the "Schema Input" tab
    await page.getByRole('button', { name: 'Schema Input' }).click({ force: true });
    
    // Check if Graphical Editor exists (if so, we are on the wrong tab)
    const isGraphShowing = await page.isVisible('.react-flow');
    if (isGraphShowing) {
        console.log('Flipping to Schema Input failed! Clicking by text...');
        await page.click('text="Schema Input"');
    }

    // Now wait for resolution
    const sourceBadge = page.locator('[data-testid="schema-source-badge"]');
    await expect(sourceBadge).toHaveText('resolved', { timeout: 30000 });

    // Wait for the "Resolving schema" message to disappear (it shows while editorSchema is null)
    await expect(page.locator('text=Resolving schema')).not.toBeVisible({ timeout: 15000 });

    // properties use data-testid prop-[name]-name for the key input
    const jobsInput = page.getByTestId('prop-jobs-name');
    await expect(jobsInput).toBeVisible({ timeout: 15000 });

    // "jobs" should be expanded by default if it's not imported
    // The pattern property regex should be visible in an input
    const patternInput = page.locator('input[value="^[_a-zA-Z][a-zA-Z0-9_-]*$"]').first();
    await expect(patternInput).toBeVisible({ timeout: 10000 });
    
    // Pattern properties start collapsed. Expand it.
    // At this point, the only "Expand" button should be the pattern property's one.
    const expandButton = page.locator('button[title="Expand"]').first();
    await expandButton.click();

    // Now we should see "Normal Job" (it has an explicit title)
    // In SchemaEditorForm, variants are rendered as VariantItem with index.
    await expect(page.getByText(/1\. Normal Job/)).toBeVisible({ timeout: 10000 });

    // Inside Normal Job, we have "runs-on"
    // Since it's not imported (inline in the schema we injected), it should be expanded.
    const runsOnInput = page.getByTestId('prop-runs-on-name');
    await expect(runsOnInput).toBeVisible({ timeout: 10000 });

    // "runs-on" should be expanded.
    // It has a oneOf/anyOf, so we should see the variant titles.
    // Option 1: https://example.com/github-hosted-runners -> "Github-hosted-runners"
    // Option 2: https://example.com/self-hosted-runners -> "Self-hosted-runners"
    // Option 3: expressionSyntax
    
    await expect(page.getByText(/1\. Github-hosted-runners/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/2\. Self-hosted-runners/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/3\. ExpressionSyntax/)).toBeVisible({ timeout: 15000 });
  });

  test('verify GHA prefix stripping', async ({ page }) => {
    const ghaPrefixSchema = {
      "type": "object",
      "properties": {
        "prefixed": {
          "oneOf": [
            { "$comment": "https://example.com/jobsjob_id_name" },
            { "$comment": "https://example.com/runs-on_options" }
          ]
        }
      }
    };

    await page.context().addInitScript((s) => {
      try {
        localStorage.clear();
        localStorage.setItem('schema-sculptor-schema', s);
      } catch (_) {}
    }, JSON.stringify(ghaPrefixSchema));

    await page.goto(BASE);
    await page.getByRole('button', { name: 'Schema Input' }).click({ force: true });

    // Verify stripped labels. 
    // jobsjob_id_name -> Job_id_name
    // runs-on_options -> Options
    await expect(page.getByText(/1\. Job_id_name/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/2\. Options/i)).toBeVisible({ timeout: 15000 });
  });
});
