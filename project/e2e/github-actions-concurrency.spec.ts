import { test, expect } from '@playwright/test';

// E2E test for nested concurrency field in GitHub Actions workflow schema
// Tests variant switching at path: jobs.job.concurrency (string ↔ object)
test.describe('GitHub Actions Concurrency Variant Switching (Nested)', () => {
  test.setTimeout(180000);

  const BASE = process.env.BASE_URL || 'http://localhost:5174';

  const instanceData = {
    "jobs": {
      "job": {
        "runs-on": "ubuntu-latest",
        "concurrency": ""
      }
    },
    "on": "branch_protection_rule"
  };

  test.beforeAll(async () => {
    // Load schema from disk (in a real scenario, this would come from API)
    // For now, we'll rely on the schema being embedded in the test via localStorage
  });

  test('Nested concurrency field shows variant chips and allows switching from String to Object', async ({ page }) => {
    // Navigate to the workbench
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    // 1. Add JSON to the JSON Input Form textarea
    const jsonInputArea = page.locator('textarea').first();
    await jsonInputArea.focus();
    await jsonInputArea.fill(JSON.stringify(instanceData, null, 2));
    await page.waitForTimeout(500);

    // 2. Click the Schema Input tab to go to schema editor
    const schemaTab = page.locator('role=button[name="Schema Input"]');
    await schemaTab.click();
    await page.waitForTimeout(500);

    // 3. Load the schema programmatically into localStorage
    // Note: Using a simplified schema for testing. In production, use the full 4734-line schema.
    const simplifiedSchema = {
      "type": "object",
      "properties": {
        "jobs": {
          "type": "object",
          "properties": {
            "job": {
              "type": "object",
              "properties": {
                "runs-on": { "type": "string" },
                "concurrency": {
                  "oneOf": [
                    { "type": "string", "title": "String" },
                    {
                      "type": "object",
                      "title": "Concurrency",
                      "properties": {
                        "group": { "type": "string" },
                        "cancel-in-progress": { "type": "boolean" }
                      },
                      "required": ["group"]
                    }
                  ]
                }
              }
            }
          }
        },
        "on": { "type": "string" }
      }
    };

    await page.evaluate((s) => {
      localStorage.setItem('schema-sculptor-schema', JSON.stringify(s));
    }, simplifiedSchema);

    // Reload the page to pick up the schema from localStorage
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // 4. Click the Instance Editor tab
    const instanceTab = page.locator('role=button[name="Instance Editor"]');
    await instanceTab.click();
    await page.waitForTimeout(1000);

    // Navigate to the nested concurrency field by expanding the structure
    // Wait for the Instance Editor to fully load
    await page.waitForTimeout(500);

    // 5. Test the Concurrency variant setup after clicking oneOf choice at nested location
    
    // Wait for concurrency variant buttons to be visible
    // They should be nested within the job object
    await page.waitForSelector('button:has-text("String")', { timeout: 15000 });

    const stringBtn = page.locator('button:has-text("String")').first();
    const concurrencyBtn = page.locator('button:has-text("Concurrency")').first();

    // Verify String variant is initially selected (since we have empty string data)
    await expect(stringBtn).toHaveAttribute('aria-pressed', 'true');

    // Verify string input is visible
    const stringInputs = page.locator('input[type="text"]');
    const inputCount = await stringInputs.count();
    let stringInputFound = false;

    for (let i = 0; i < inputCount; i++) {
      const input = stringInputs.nth(i);
      const isVisible = await input.isVisible().catch(() => false);
      if (isVisible && input !== jsonInputArea) {
        stringInputFound = true;
        break;
      }
    }

    expect(stringInputFound, 'String input should be visible for concurrency field').toBe(true);

    // Update the string value to trigger state change
    const concurrencyStringInput = page.locator('input[type="text"]').nth(await (async () => {
      for (let i = 0; i < await page.locator('input[type="text"]').count(); i++) {
        const input = page.locator('input[type="text"]').nth(i);
        const isVisible = await input.isVisible().catch(() => false);
        if (isVisible && input !== jsonInputArea) return i;
      }
      return 0;
    })());
    
    await concurrencyStringInput.fill('test-xyz-concurrency');
    await page.waitForTimeout(300);

    // Click Concurrency variant
    await concurrencyBtn.click();
    await page.waitForTimeout(700);

    // **CRITICAL CHECKS**:

    // 1. First verify Concurrency button is now selected (variant switch happened)
    await expect(concurrencyBtn).toHaveAttribute('aria-pressed', 'true');
    
    // 2. Wait for Group label to be visible (Concurrency form rendered)
    const groupLabelLocator = page.locator('text=Group').first();
    await expect(groupLabelLocator).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(800);

    // 3. Now check that the old string input with our test value is gone
    const allStringInputs = page.locator('input[type="text"]');
    const totalInputs = await allStringInputs.count();
    
    let foundOldValue = false;
    for (let i = 0; i < totalInputs; i++) {
      const input = allStringInputs.nth(i);
      const isVisible = await input.isVisible().catch(() => false);
      const value = await input.inputValue().catch(() => '');
      if (isVisible && value === 'test-xyz-concurrency') {
        foundOldValue = true;
        break;
      }
    }

    expect(foundOldValue, 'Old String input with value "test-xyz-concurrency" should be hidden').toBe(false);

    // 4. Concurrency object fields should be visible with labels
    let groupLabelVisible = false;
    const groupLabels = page.locator('text=Group');
    const labelCount = await groupLabels.count();
    for (let i = 0; i < labelCount; i++) {
      const isVisible = await groupLabels.nth(i).isVisible().catch(() => false);
      if (isVisible) {
        groupLabelVisible = true;
        break;
      }
    }

    expect(groupLabelVisible, 'Group label should be visible for Concurrency object').toBe(true);

    // 5. String button should be unselected
    await expect(stringBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('Nested concurrency field allows switching back from Object to String', async ({ page }) => {
    // Navigate to the workbench
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    const instanceDataWithObject = {
      "jobs": {
        "job": {
          "runs-on": "ubuntu-latest",
          "concurrency": {
            "group": "my-group",
            "cancel-in-progress": false
          }
        }
      },
      "on": "branch_protection_rule"
    };

    // 1. Add JSON to the JSON Input Form textarea
    const jsonInputArea = page.locator('textarea').first();
    await jsonInputArea.focus();
    await jsonInputArea.fill(JSON.stringify(instanceDataWithObject, null, 2));
    await page.waitForTimeout(500);

    // 2. Click the Schema Input tab
    const schemaTab = page.locator('role=button[name="Schema Input"]');
    await schemaTab.click();
    await page.waitForTimeout(500);

    // 3. Load the schema programmatically
    const simplifiedSchema = {
      "type": "object",
      "properties": {
        "jobs": {
          "type": "object",
          "properties": {
            "job": {
              "type": "object",
              "properties": {
                "runs-on": { "type": "string" },
                "concurrency": {
                  "oneOf": [
                    { "type": "string", "title": "String" },
                    {
                      "type": "object",
                      "title": "Concurrency",
                      "properties": {
                        "group": { "type": "string" },
                        "cancel-in-progress": { "type": "boolean" }
                      },
                      "required": ["group"]
                    }
                  ]
                }
              }
            }
          }
        },
        "on": { "type": "string" }
      }
    };

    await page.evaluate((s) => {
      localStorage.setItem('schema-sculptor-schema', JSON.stringify(s));
    }, simplifiedSchema);

    // Reload to pick up the schema
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // 4. Click the Instance Editor tab
    const instanceTab = page.locator('role=button[name="Instance Editor"]');
    await instanceTab.click();
    await page.waitForTimeout(1000);

    // Wait for form to render
    await page.waitForSelector('button:has-text("Concurrency")', { timeout: 15000 });

    // 5. Test switching back to String
    const stringBtn = page.locator('button:has-text("String")').first();
    const concurrencyBtn = page.locator('button:has-text("Concurrency")').first();

    // Verify Concurrency variant is initially selected (object data)
    await expect(concurrencyBtn).toHaveAttribute('aria-pressed', 'true');

    // Verify object field is visible
    const groupLabels = page.locator('text=Group');
    let groupLabelVisible = false;

    const labelCount = await groupLabels.count();
    for (let i = 0; i < labelCount; i++) {
      const isVisible = await groupLabels.nth(i).isVisible().catch(() => false);
      if (isVisible) {
        groupLabelVisible = true;
        break;
      }
    }

    expect(groupLabelVisible, 'Group label should be visible for Concurrency object initially').toBe(true);

    // Click String button to switch back
    await stringBtn.click();
    await page.waitForTimeout(700);

    // **CRITICAL CHECKS**:

    // 1. Concurrency object fields should NOT be visible
    const groupLabelsAfter = page.locator('text=Group');
    let groupStillVisible = false;

    const labelCountAfter = await groupLabelsAfter.count();
    for (let i = 0; i < labelCountAfter; i++) {
      const label = groupLabelsAfter.nth(i);
      const isVisible = await label.isVisible().catch(() => false);
      if (isVisible) {
        groupStillVisible = true;
        break;
      }
    }

    expect(groupStillVisible, 'Group label should not be visible after switching to String').toBe(false);

    // 2. String input should be visible
    const stringInputs = page.locator('input[placeholder*="Enter"]');
    const inputCount = await stringInputs.count();
    let foundVisibleStringInput = false;

    for (let i = 0; i < inputCount; i++) {
      const input = stringInputs.nth(i);
      const isVisible = await input.isVisible().catch(() => false);
      if (isVisible) {
        foundVisibleStringInput = true;
        break;
      }
    }

    expect(foundVisibleStringInput, 'String input should be visible after switching back from Concurrency').toBe(true);

    // 3. String button should be selected
    await expect(stringBtn).toHaveAttribute('aria-pressed', 'true');

    // 4. Concurrency button should be unselected
    await expect(concurrencyBtn).toHaveAttribute('aria-pressed', 'false');
  });
});
