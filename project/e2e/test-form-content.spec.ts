import { test } from '@playwright/test';
import * as fs from 'fs';

test('Check Instance Form content', async ({ page }) => {
  const schema = fs.readFileSync('public/schemas/xml-form-controls-demo.xsd', 'utf-8');
  const instanceXml = `<?xml version="1.0"?>
<person id="123" active="true" favoriteColor="red">
  <firstName>John</firstName>
  <lastName>Doe</lastName>
</person>`;

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  
  await page.click('button:has-text("JSON Input")');
  await page.waitForTimeout(500);
  await page.locator('textarea').first().fill(instanceXml);
  await page.waitForTimeout(500);
  
  await page.click('button:has-text("Schema Input")');
  await page.waitForTimeout(500);
  await page.locator('textarea').first().fill(schema);
  await page.waitForTimeout(500);
  
  await page.click('button:has-text("Instance Form")');
  await page.waitForTimeout(1500);
  
  // Get all text content in Instance Form section
  const formHeading = await page.locator('h2:has-text("Instance Form")');
  if (await formHeading.isVisible()) {
    console.log('Instance Form heading found');
  } else {
    console.log('Instance Form heading NOT found');
  }
  
  // Get all visible text
  const allText = await page.textContent('body');
  const textSnippet = allText?.substring(0, 500) || '';
  console.log(`Page text (first 500 chars):\n${textSnippet}`);
  
  // Look for "person" specifically
  const personButton = await page.locator('button, span:has-text("person")').first();
  if (await personButton.isVisible()) {
    console.log(`\nFound person element: ${await personButton.textContent()}`);
  } else {
    console.log('\nperson element NOT found');
  }
  
  // Check console errors
  let consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  
  await page.waitForTimeout(500);
  if (consoleErrors.length > 0) {
    console.log('\nConsole errors:');
    consoleErrors.forEach(err => console.log(`  ${err}`));
  }
});
