import { test } from '@playwright/test';
import * as fs from 'fs';

test('Check localStorage and visual state', async ({ page }) => {
  const schema = fs.readFileSync('public/schemas/xml-form-controls-demo.xsd', 'utf-8');
  const instanceXml = `<?xml version="1.0"?>
<person id="123" active="true" favoriteColor="red">
  <firstName>John</firstName>
  <lastName>Doe</lastName>
</person>`;

  // Initialize debug logs and set localStorage BEFORE navigation
  await page.context().addInitScript(() => {
    window.__DEBUG_LOGS__ = [];
    // Try to set schema and XML in localStorage before page loads
    localStorage.setItem('schema-sculptor-schema-xml', schema);
    localStorage.setItem('schema-sculptor-instance-xml', instanceXml);
  });

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  
  // Check localStorage
  const storedSchema = await page.evaluate(() => localStorage.getItem('schema-sculptor-schema-xml'));
  const storedInstance = await page.evaluate(() => localStorage.getItem('schema-sculptor-instance-xml'));
  
  console.log(`\nLocalStorage schema present: ${storedSchema ? 'YES' : 'NO'}`);
  console.log(`LocalStorage instance present: ${storedInstance ? 'YES' : 'NO'}`);
  
  // Go to Instance Form - it should auto-load from localStorage
  await page.click('button:has-text("Instance Form")');
  await page.waitForTimeout(1500);
  
  // Take screenshot
  await page.screenshot({ path: 'e2e/test-results/instance-form-check.png' });
  console.log('\nScreenshot saved');
  
  // Check for debug logs
  const debugLogs = await page.evaluate(() => (window as any).__DEBUG_LOGS__) as string[];
  console.log(`\nDebug logs count: ${debugLogs?.length || 0}`);
  debugLogs?.forEach(log => console.log(`  ${log}`));
  
  // Check for person element text
  const personText = await page.textContent('text=/person/i, text=/firstName/i');
  console.log(`\nFound person/firstName text: ${personText ? 'YES' : 'NO'}`);
  
  // List all visible text nodes with "favor" in them
  const allElements = await page.locator('*').all();
  let favoriteColorFound = false;
  for (const el of allElements) {
    const text = await el.textContent();
    if (text?.includes('favoriteColor')) {
      favoriteColorFound = true;
      console.log(`Found favoriteColor in: ${text.substring(0, 100)}`);
      break;
    }
  }
  console.log(`favoriteColor found on page: ${favoriteColorFound}`);
});
