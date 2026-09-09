import { test } from '@playwright/test';

test('Load schema and check enumerations', async ({ page }) => {
  const consoleLogs: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    consoleLogs.push(text);
    if (text.includes('[get') || text.includes('[render') || text.includes('[FAVOR')) {
      console.log('LOG:', text);
    }
  });
  
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(2000);
  
  // Try directly injecting the demo XML that has favoriteColor
  const demoXml = `<?xml version="1.0" encoding="UTF-8"?>
<person xmlns:tns="http://example.com/demo" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <id>123</id>
  <active>true</active>
  <favoriteColor>red</favoriteColor>
  <firstName>John</firstName>
  <lastName>Doe</lastName>
</person>`;

  // Find the XML Input tab and enter the XML
  const xmlInputBtn = page.locator('button:has-text("XML Input")');
  await xmlInputBtn.click();
  await page.waitForTimeout(1000);
  
  // Find the textarea and paste the XML
  const textarea = page.locator('textarea').first();
  await textarea.click();
  await textarea.fill(demoXml);
  await page.waitForTimeout(1000);
  
  // Switch to Instance Form
  const instanceFormBtn = page.locator('button:has-text("Instance Form")');
  await instanceFormBtn.click();
  await page.waitForTimeout(2000);
  
  // Check for favoriteColor
  const fcElement = page.locator('text=favoriteColor').first();
  const fcFound = await fcElement.isVisible({ timeout: 1000 }).catch(() => false);
  console.log('\nfavoriteColor visible:', fcFound);
  
  // Count selects
  const selectCount = await page.locator('select').count();
  console.log('Total select elements:', selectCount);
  
  // Print logs
  console.log('\n=== FILTERED LOGS ===');
  consoleLogs
    .filter(l => l.includes('[get') || l.includes('[render') || l.includes('[FAVOR') || l.includes('[ATTR'))
    .forEach(l => console.log(l));
});
