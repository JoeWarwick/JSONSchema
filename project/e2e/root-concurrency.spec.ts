import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// E2E test for root-level concurrency field in GitHub Actions workflow schema
// Tests variant switching at root: concurrency (string ↔ object)
test.describe('GitHub Actions Root Concurrency Variant Switching', () => {
  test.setTimeout(180000);

  const BASE = process.env.BASE_URL || 'http://localhost:5174';

  // Load the full GitHub Actions schema
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.join(__dirname, 'test-schema', 'schema (14).json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

  // FIX: The full GitHub Actions schema defines concurrency as only an object,
  // but GitHub Actions actually supports concurrency as either a string or object.
  // We add the oneOf structure for proper variant testing at the ROOT LEVEL ONLY.
  // (Nested job concurrency variants are handled by job type selection, not here)
  if (schema.properties.concurrency && !schema.properties.concurrency.oneOf) {
    const concurrencyObject = schema.properties.concurrency;
    schema.properties.concurrency = {
      oneOf: [
        { type: 'string', title: 'String' },
        concurrencyObject
      ]
    };
  }

  // Helper to clear all variant memory from localStorage
  const clearVariantMemory = async (page: any) => {
    await page.evaluate(() => {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('json-instance-variants:')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
    });
  };

  // Run before each test to ensure clean state
  test.beforeEach(async ({ page }) => {
    // Navigate to base URL first
    await page.goto(BASE);
    // Clear any stale variant memory immediately
    await clearVariantMemory(page);
  });

  // Minimal instance data - focus on root-level concurrency only
  // Job is simplified to avoid complexity with nested job type variants
  const instanceDataString = {
    "on": "push",
    "concurrency": "my-workflow-group",
    "jobs": {
      "test": {
        "runs-on": "ubuntu-latest"
      }
    }
  };

  const instanceDataObject = {
    "on": "push",
    "concurrency": {
      "group": "my-workflow-group",
      "cancel-in-progress": true
    },
    "jobs": {
      "test": {
        "runs-on": "ubuntu-latest"
      }
    }
  };

  test('Root-level concurrency shows variant chips and allows switching from String to Object', async ({ page }) => {
    // beforeEach already navigated and cleared variant memory

    // 1. Add JSON to the JSON Input Form textarea (string variant)
    const jsonInputArea = page.locator('textarea').first();
    await jsonInputArea.focus();
    await jsonInputArea.fill(JSON.stringify(instanceDataString, null, 2));
    await page.waitForTimeout(500);

    // 2. Click the Schema Input tab to go to schema editor
    const schemaTab = page.locator('role=button[name="Schema Input"]');
    await schemaTab.click();
    await page.waitForTimeout(500);

    // 3. Clear variant memory once more before loading new schema (belt and suspenders approach)
    await clearVariantMemory(page);

    // 4. Load the full schema programmatically into localStorage
    await page.evaluate((s) => {
      localStorage.setItem('schema-sculptor-schema', JSON.stringify(s));
    }, schema);

    // Reload the page to pick up the schema from localStorage
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // 5. Click the Instance Editor tab
    const instanceTab = page.locator('role=button[name="Instance Editor"]');
    await instanceTab.click();
    await page.waitForTimeout(1000);

    // 6. Test the root-level Concurrency variant setup

    // Wait for variant buttons to be visible (should be near the top for root-level field)
    await page.waitForSelector('button:has-text("String")', { timeout: 15000 });

    const stringBtn = page.locator('button:has-text("String")').first();
    const concurrencyBtn = page.locator('button:has-text("Concurrency")').first();

    // Verify String variant is initially selected (since we have string data)
    await expect(stringBtn).toHaveAttribute('aria-pressed', 'true');

    // Verify string input is visible with the value
    const stringInputs = page.locator('input[type="text"]');
    const inputCount = await stringInputs.count();
    let stringInputFound = false;
    let stringInputElement: any;

    for (let i = 0; i < inputCount; i++) {
      const input = stringInputs.nth(i);
      const isVisible = await input.isVisible().catch(() => false);
      const value = await input.inputValue().catch(() => '');
      if (isVisible && value === 'my-workflow-group') {
        stringInputFound = true;
        stringInputElement = input;
        break;
      }
    }

    expect(stringInputFound, 'String input with workflow group value should be visible').toBe(true);

    // Update the string value to trigger state change
    if (stringInputElement) {
      await stringInputElement.fill('modified-workflow-group');
      await page.waitForTimeout(300);
    }

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

    // 3. Check that the old string input with our value is gone
    const allStringInputsAfter = page.locator('input[type="text"]');
    const totalInputsAfter = await allStringInputsAfter.count();

    let foundOldValue = false;
    for (let i = 0; i < totalInputsAfter; i++) {
      const input = allStringInputsAfter.nth(i);
      const isVisible = await input.isVisible().catch(() => false);
      const value = await input.inputValue().catch(() => '');
      if (isVisible && value === 'modified-workflow-group') {
        foundOldValue = true;
        break;
      }
    }

    expect(foundOldValue, 'Old String input should be hidden after switching to Concurrency object').toBe(false);

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

  test('Root-level concurrency allows switching back from Object to String', async ({ page }) => {
    // beforeEach already navigated and cleared variant memory

    // 1. Add JSON to the JSON Input Form textarea (object variant)
    const jsonInputArea = page.locator('textarea').first();
    await jsonInputArea.focus();
    await jsonInputArea.fill(JSON.stringify(instanceDataObject, null, 2));
    await page.waitForTimeout(500);

    // 2. Click the Schema Input tab
    const schemaTab = page.locator('role=button[name="Schema Input"]');
    await schemaTab.click();
    await page.waitForTimeout(500);

    // 3. Clear variant memory once more before loading new schema (belt and suspenders approach)
    await clearVariantMemory(page);

    // 4. Load the full schema programmatically
    await page.evaluate((s) => {
      localStorage.setItem('schema-sculptor-schema', JSON.stringify(s));
    }, schema);

    // Reload to pick up the schema
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // 5. Click the Instance Editor tab
    const instanceTab = page.locator('role=button[name="Instance Editor"]');
    await instanceTab.click();
    await page.waitForTimeout(1000);

    // Wait for form to render
    await page.waitForSelector('button:has-text("Concurrency")', { timeout: 15000 });

    // 6. Test switching back to String
    const stringBtn = page.locator('button:has-text("String")').first();
    const concurrencyBtn = page.locator('button:has-text("Concurrency")').first();

    // Verify Concurrency variant is initially selected (object data)
    await expect(concurrencyBtn).toHaveAttribute('aria-pressed', 'true');

    // Take a screenshot to verify object form is visible
    await page.screenshot({ path: 'test-results/before-switch.png' });

    // Click String button to switch back
    await stringBtn.click();
    await page.waitForTimeout(1000);  // Wait longer for state update

    // Take a screenshot after switching
    await page.screenshot({ path: 'test-results/after-switch-to-string.png' });

    // **CRITICAL CHECKS**:

    // 1. Concurrency object fields should NOT be visible
    const groupLabels = page.locator('text="Group"');
    const labelCount = await groupLabels.count();

    // If there are multiple Group texts, check each for visibility
    let groupStillVisible = false;
    for (let i = 0; i < labelCount; i++) {
      const label = groupLabels.nth(i);
      const isVisible = await label.isVisible().catch(() => false);
      console.log(`Group label ${i}: visible=${isVisible}`);
      if (isVisible) {
        groupStillVisible = true;
        break;
      }
    }

    expect(groupStillVisible, 'Group label should not be visible after switching to String').toBe(false);

    // 2. String input should be visible
    const stringInputs = page.locator('input[type="text"]:not([placeholder*=""])');
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
