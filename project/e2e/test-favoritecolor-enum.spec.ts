import { test } from '@playwright/test';
import * as fs from 'fs';

test('Test favoriteColor enumeration rendering', async ({ page }) => {
  // Load demo XSD schema
  const schemaPath = 'public/schemas/xml-form-controls-demo.xsd';
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  
  // Create instance XML
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

  // Initialize window debug logs
  await page.context().addInitScript(() => {
    window.__DEBUG_LOGS__ = [];
  });

  // Load page
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  
  // Click XML Input tab
  await page.getByRole('button', { name: 'XML Input' }).click();
  await page.waitForTimeout(500);
  
  // Enter XML
  const xmlTextarea = page.locator('textarea').first();
  await xmlTextarea.fill(instanceXml);
  await page.waitForTimeout(300);
  
  // Click Schema Input tab
  await page.getByRole('button', { name: 'Schema Input' }).click();
  await page.waitForTimeout(500);
  
  // Enter schema
  const schemaTextarea = page.locator('textarea').first();
  await schemaTextarea.fill(schema);
  await page.waitForTimeout(500);
  
  // Click Instance Form tab
  await page.getByRole('button', { name: 'Instance Form' }).click();
  await page.waitForTimeout(1000);
  
  // Get debug logs
  const debugLogs = await page.evaluate(() => window.__DEBUG_LOGS__) as string[];
  console.log('\n=== DEBUG LOGS ===');
  if (debugLogs && debugLogs.length > 0) {
    debugLogs.forEach(log => console.log(log));
  } else {
    console.log('No debug logs captured');
  }
  
  // Check if favoriteColor field is a select or textbox
  const favoriteColorElements = await page.locator('label:has-text("favoriteColor:") + *').all();
  console.log(`\nFound ${favoriteColorElements.length} elements after favoriteColor label`);
  
  for (const el of favoriteColorElements) {
    const tag = await el.evaluate(e => e.tagName);
    const type = await el.evaluate(e => e.getAttribute('type'));
    const value = await el.inputValue().catch(() => 'N/A');
    console.log(`Element: ${tag} type=${type} value=${value}`);
  }
});
