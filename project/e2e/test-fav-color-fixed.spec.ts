import { test } from '@playwright/test';
import * as fs from 'fs';

test('Test favoriteColor enumeration', async ({ page }) => {
  // Load schema
  const schema = fs.readFileSync('public/schemas/xml-form-controls-demo.xsd', 'utf-8');
  const instanceXml = `<?xml version="1.0"?>
<person id="123" active="true" favoriteColor="red">
  <firstName>John</firstName>
  <lastName>Doe</lastName>
  <address>
    <street>123 Main</street>
    <city>Boston</city>
    <country>USA</country>
    <postalCode>02101</postalCode>
  </address>
</person>`;

  await page.context().addInitScript(() => {
    window.__DEBUG_LOGS__ = [];
  });

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  
  // Click JSON Input (not XML Input)
  await page.click('button:has-text("JSON Input")');
  await page.waitForTimeout(500);
  
  // Find the textarea and fill with XML
  const textareas = await page.locator('textarea').all();
  console.log(`Found ${textareas.length} textareas`);
  if (textareas.length > 0) {
    await textareas[0].fill(instanceXml);
    await page.waitForTimeout(500);
  }
  
  // Click Schema Input
  await page.click('button:has-text("Schema Input")');
  await page.waitForTimeout(500);
  
  // Fill schema
  const schemaTextareas = await page.locator('textarea').all();
  if (schemaTextareas.length > 0) {
    await schemaTextareas[0].fill(schema);
    await page.waitForTimeout(500);
  }
  
  // Click Instance Form
  await page.click('button:has-text("Instance Form")');
  await page.waitForTimeout(1500);
  
  // Check debug logs
  const debugLogs = await page.evaluate(() => (window as any).__DEBUG_LOGS__) as string[];
  console.log('\n=== DEBUG LOGS ===');
  debugLogs?.forEach(log => console.log(log));
  
  // Check if favoriteColor field renders as select or text input
  const favoriteColorLabel = await page.locator('text=favoriteColor:').first();
  if (await favoriteColorLabel.isVisible()) {
    console.log('\nfavoriteColor label found');
    const parent = favoriteColorLabel.locator('xpath=ancestor::div[1]');
    const select = parent.locator('select');
    const input = parent.locator('input[type="text"]');
    
    if (await select.count()) {
      console.log('✓ favoriteColor renders as SELECT');
      const options = await select.locator('option').allTextContents();
      console.log(`  Options: ${options.join(', ')}`);
    } else if (await input.count()) {
      console.log('✗ favoriteColor renders as TEXT INPUT');
      const value = await input.inputValue();
      console.log(`  Value: ${value}`);
    }
  } else {
    console.log('favoriteColor label NOT found');
  }
});
