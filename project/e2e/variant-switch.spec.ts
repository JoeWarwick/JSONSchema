import { test, expect } from '@playwright/test';

// Test variant switching between primitive and object types
test.describe('oneOf Variant Switching (Primitive ↔ Object)', () => {
  test.setTimeout(120000);

  const BASE = process.env.BASE_URL || 'http://localhost:5174';

  test('Instance Editor shows variant chips and allows switching from String to Concurrency', async ({ page }) => {
    // Navigate to the workbench
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    // Create the test data
    const schema = {
      type: 'object',
      properties: {
        concurrency: {
          oneOf: [
            { type: 'string', title: 'String' },
            {
              type: 'object',
              title: 'Concurrency',
              properties: {
                group: { type: 'string' },
                'cancel-in-progress': { type: 'boolean' }
              },
              required: ['group']
            }
          ]
        }
      }
    };

    const instanceData = {
      concurrency: 'my-workflow'
    };

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
    await page.evaluate((s) => {
      localStorage.setItem('schema-sculptor-schema', s);
    }, JSON.stringify(schema));

    // Reload the page to pick up the schema from localStorage
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // 4. Click the Instance Editor tab
    const instanceTab = page.locator('role=button[name="Instance Editor"]');
    await instanceTab.click();
    await page.waitForTimeout(1000);

    // Wait for the form to render - look for variant chips
    await page.waitForSelector('button:has-text("String")', { timeout: 15000 });

    // 5. Test the Concurrency setup after clicking oneOf choice
    const stringBtn = page.locator('button:has-text("String")').first();
    const concurrencyBtn = page.locator('button:has-text("Concurrency")').first();

    // Verify String variant is initially selected (since we have string data)
    await expect(stringBtn).toHaveAttribute('aria-pressed', 'true');

    // Verify string input is visible
    const stringInput = page.locator('input[placeholder*="Enter"]').first();
    await expect(stringInput).toBeVisible();
    await expect(stringInput).toHaveValue('my-workflow');

    // Change the value to trigger state update
    await stringInput.fill('modified-string');
    await page.waitForTimeout(300);

    // Click Concurrency variant
    await concurrencyBtn.click();
    await page.waitForTimeout(700);

    // **CRITICAL CHECKS**:
    
    // 1. Old string input should NOT be visible
    // Wait for the Concurrency variant form to render with Group field
    await page.waitForSelector('text=Group', { timeout: 10000 });
    await page.waitForTimeout(500);
    
    // Now check if the string input is still visible - give it time to disappear
    const stringInputs = page.locator('input[type="text"]');
    const inputCount = await stringInputs.count();
    let stringStillVisible = false;
    
    for (let i = 0; i < inputCount; i++) {
      const input = stringInputs.nth(i);
      const isVisible = await input.isVisible().catch(() => false);
      const value = await input.inputValue().catch(() => '');
      
      // Check if this is the old string input (has the "modified-string" value)
      if (isVisible && value === 'modified-string') {
        stringStillVisible = true;
        break;
      }
    }
    
    expect(stringStillVisible, 'Old String input should be hidden after switching to Concurrency').toBe(false);

    // 2. Concurrency object fields should be visible with labels
    const groupLabel = page.locator('text=Group').first();
    await expect(groupLabel, 'Group label should be visible').toBeVisible({ timeout: 5000 });

    // 3. Check for no duplicate error messages
    const errorMessages = page.locator('text=Ref suggests object but data is primitive');
    const errorCount = await errorMessages.count();
    expect(errorCount, 'Should have at most 1 error message, not duplicates').toBeLessThanOrEqual(1);

    // 4. Concurrency button should be selected
    await expect(concurrencyBtn).toHaveAttribute('aria-pressed', 'true');

    // 5. String button should be unselected
    await expect(stringBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('Instance Editor allows switching from Concurrency object back to String', async ({ page }) => {
    // Navigate to the workbench
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    // Create the test data
    const schema = {
      type: 'object',
      properties: {
        concurrency: {
          oneOf: [
            { type: 'string', title: 'String' },
            {
              type: 'object',
              title: 'Concurrency',
              properties: {
                group: { type: 'string' },
                'cancel-in-progress': { type: 'boolean' }
              },
              required: ['group']
            }
          ]
        }
      }
    };

    const instanceData = {
      concurrency: {
        group: 'my-group',
        'cancel-in-progress': false
      }
    };

    // 1. Add JSON to the JSON Input Form textarea
    const jsonInputArea = page.locator('textarea').first();
    await jsonInputArea.focus();
    await jsonInputArea.fill(JSON.stringify(instanceData, null, 2));
    await page.waitForTimeout(500);

    // 2. Click the Schema Input tab
    const schemaTab = page.locator('role=button[name="Schema Input"]');
    await schemaTab.click();
    await page.waitForTimeout(500);

    // 3. Load the schema programmatically
    await page.evaluate((s) => {
      localStorage.setItem('schema-sculptor-schema', s);
    }, JSON.stringify(schema));

    // Reload to pick up the schema
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Wait for schema to resolve
    await page.waitForFunction(() => {
      const l = (window as any).__lastSchemaLoad;
      return !!(l && (l.used === 'resolved' || l.used === 'source'));
    }, null, { timeout: 30000 });

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
    const groupLabel = page.locator('text=Group').first();
    await expect(groupLabel).toBeVisible({ timeout: 5000 });

    // Click String button to switch back
    await stringBtn.click();
    await page.waitForTimeout(700);

    // **CRITICAL CHECKS**:

    // 1. Concurrency object fields should NOT be visible
    const groupLabels = page.locator('text=Group');
    const groupCount = await groupLabels.count();
    let groupStillVisible = false;
    
    for (let i = 0; i < groupCount; i++) {
      const label = groupLabels.nth(i);
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
    let foundVisibleInput = false;
    
    for (let i = 0; i < inputCount; i++) {
      const input = stringInputs.nth(i);
      const isVisible = await input.isVisible().catch(() => false);
      if (isVisible) {
        foundVisibleInput = true;
        break;
      }
    }
    
    expect(foundVisibleInput, 'String input should be visible after switching from Concurrency').toBe(true);

    // 3. String button should be selected
    await expect(stringBtn).toHaveAttribute('aria-pressed', 'true');

    // 4. Concurrency button should be unselected
    await expect(concurrencyBtn).toHaveAttribute('aria-pressed', 'false');
  });
});
