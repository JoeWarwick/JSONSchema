import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test('Check favoriteColor rendering in Instance Form', async ({ page }) => {
  // Initialize localStorage
  await page.context().addInitScript(() => {
    try {
      localStorage.setItem('schema-sculptor-markup-language', 'xml');
      localStorage.setItem('schema-sculptor-schema-xml', '');
      localStorage.setItem('schema-sculptor-instance-xml', '');
      localStorage.removeItem('schema-sculptor-graph-collapse-state');
    } catch {
      // ignore
    }
  });

  // Navigate to the app
  await page.goto(BASE);
  console.log('Navigated to:', BASE);

  // Wait for the Schema Form tab
  const schemaTab = page.getByRole('button', { name: 'Schema Form' });
  await schemaTab.waitFor({ state: 'visible', timeout: 15000 });
  await schemaTab.click();
  console.log('Clicked Schema Form tab');

  // Load demo controls XSD
  const loadDemoBtn = page.getByRole('button', { name: 'Load demo controls XSD' }).first();
  await loadDemoBtn.waitFor({ state: 'visible', timeout: 15000 });
  await loadDemoBtn.click();
  console.log('Clicked Load demo controls XSD button');

  // Wait for schema to load
  await expect(page.getByText('xs:schema').first()).toBeVisible({ timeout: 15000 });
  console.log('Schema loaded');

  // Switch to Instance Form tab
  const instanceFormTab = page.getByRole('button', { name: 'Instance Form' });
  await instanceFormTab.waitFor({ state: 'visible', timeout: 15000 });
  await instanceFormTab.click();
  console.log('Clicked Instance Form tab');

  // Wait for the form to render
  await page.waitForTimeout(2000);

  // Take a screenshot
  await page.screenshot({ path: 'favoriteColor-rendering.png' });
  console.log('Screenshot taken: favoriteColor-rendering.png');

  // Try to find the favoriteColor control
  // It could be within a form or labeled with "favoriteColor"
  const favoriteColorLabel = page.locator('label, div').filter({ hasText: /favoriteColor|Favorite Color/ }).first();
  
  try {
    await favoriteColorLabel.waitFor({ timeout: 5000 });
    console.log('Found favoriteColor label');
    
    // Get the parent container and look for input/select inside
    const container = favoriteColorLabel.locator('..').first();
    
    // Check if there's a select element
    const selectElements = container.locator('select');
    const selectCount = await selectElements.count();
    
    // Check if there's a text input
    const inputElements = container.locator('input[type="text"]');
    const inputCount = await inputElements.count();
    
    console.log(`Found ${selectCount} select elements`);
    console.log(`Found ${inputCount} text input elements`);
    
    if (selectCount > 0) {
      console.log('✓ favoriteColor is rendered as a SELECT DROPDOWN');
      
      // Get the select options
      const optionsCount = await selectElements.first().locator('option').count();
      console.log(`Select dropdown has ${optionsCount} options`);
    } else if (inputCount > 0) {
      console.log('✗ favoriteColor is rendered as a TEXT INPUT');
    }
  } catch (e) {
    console.log('Could not find favoriteColor label with that selector');
    
    // Try alternative: look for any input or select with data attributes or aria labels
    const allSelects = page.locator('select');
    const selectCount = await allSelects.count();
    console.log(`Total select elements on page: ${selectCount}`);
    
    const allTextInputs = page.locator('input[type="text"]');
    const textInputCount = await allTextInputs.count();
    console.log(`Total text input elements on page: ${textInputCount}`);
    
    // Try to find elements with "color" in their id or name
    const colorControls = page.locator('[id*="color" i], [name*="color" i]');
    const colorCount = await colorControls.count();
    console.log(`Controls with "color" in id/name: ${colorCount}`);
    
    if (colorCount > 0) {
      for (let i = 0; i < Math.min(colorCount, 3); i++) {
        const control = colorControls.nth(i);
        const tagName = await control.evaluate(el => el.tagName);
        const id = await control.evaluate(el => el.id);
        const name = await control.evaluate(el => el.getAttribute('name'));
        console.log(`  Control ${i+1}: <${tagName}> id="${id}" name="${name}"`);
      }
    }
  }

  // Log all console messages
  page.on('console', msg => {
    console.log(`Browser console [${msg.type()}]: ${msg.text()}`);
  });

  // Check for any errors in console
  page.on('pageerror', err => {
    console.log(`Browser error: ${err}`);
  });
});
