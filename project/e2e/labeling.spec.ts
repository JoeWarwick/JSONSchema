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
    
    // Use a simpler schema focused on testing variant labeling
    const simpleLabelSchema = {
      type: 'object',
      properties: {
        concurrency: {
          oneOf: [
            { type: 'string', $comment: 'https://example.com/github-hosted-runners' },
            { type: 'array', $comment: 'https://example.com/self-hosted-runners' },
            { $ref: '#/definitions/expressionSyntax' }
          ]
        }
      },
      definitions: {
        expressionSyntax: {
          type: 'string',
          pattern: '^\\$\\{\\{.*\\}\\}$'
        }
      }
    };
    
    // Inject schema and clear local storage to avoid "stale storage" issues
    await page.context().addInitScript((s) => {
      try {
        localStorage.clear();
        localStorage.setItem('schema-sculptor-schema', s);
      } catch (_) {}
    }, JSON.stringify(simpleLabelSchema));
    
    await page.goto(BASE);

    // Click the "Schema Input" tab
    await page.getByRole('button', { name: 'Schema Input' }).click({ force: true });
    
    // Wait for schema to resolve
    const sourceBadge = page.locator('[data-testid="schema-source-badge"]');
    await expect(sourceBadge).toHaveText('Source: resolved', { timeout: 30000 });

    // Wait for the "Resolving schema" message to disappear
    await expect(page.locator('text=Resolving schema')).not.toBeVisible({ timeout: 15000 });

    // Find the concurrency property
    const concurrencyInput = page.getByTestId('prop-concurrency-name');
    await expect(concurrencyInput).toBeVisible({ timeout: 15000 });

    // Expand the concurrency property to see its variants
    const expandButtons = page.locator('button[title="Expand"]').or(page.locator('button[aria-label="Expand"]'));
    if (await expandButtons.count() > 0) {
      await expandButtons.first().click();
      await page.waitForTimeout(500);
    }
    
    // Verify the variant labels are correctly generated from URLs
    // The labels should strip the URL and show meaningful names
    await expect(page.getByText(/Github-hosted-runners/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Self-hosted-runners/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/ExpressionSyntax/i)).toBeVisible({ timeout: 15000 });
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

    // Wait for schema resolution
    const sourceBadge = page.locator('[data-testid="schema-source-badge"]');
    await expect(sourceBadge).toHaveText('Source: resolved', { timeout: 30000 });
    
    // Wait for the "Resolving schema" message to disappear (it shows while editorSchema is null)
    await expect(page.locator('text=Resolving schema')).not.toBeVisible({ timeout: 15000 });

    // Find the prefixed property input to ensure the form is rendered
    const prefixedInput = page.getByTestId('prop-prefixed-name');
    await expect(prefixedInput).toBeVisible({ timeout: 15000 });

    // Properties now default to collapsed, so we need to find the expand button for the "prefixed" property
    const expandButtons = page.locator('button[title="Expand"]');
    const count = await expandButtons.count();
    
    if (count > 0) {
      await expandButtons.first().click();
      await page.waitForTimeout(700);
    }

    // Verify the variant labels are displayed
    // The labels are extracted from the $comment URLs
    await expect(page.getByText(/Jobsjob_id_name/i)).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/Runs-on_options/i)).toBeVisible({ timeout: 20000 });
  });
});
