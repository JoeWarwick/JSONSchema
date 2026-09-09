import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test('Check console logs for attribute enumeration handling', async ({ page }) => {
  // Set up localStorage
  await page.context().addInitScript(() => {
    localStorage.setItem('schema-sculptor-markup-language', 'xml');
    localStorage.setItem('schema-sculptor-schema-xml', '');
    localStorage.setItem('schema-sculptor-instance-xml', '');
  });

  // Capture console messages
  const consoleLogs: string[] = [];
  page.on('console', msg => {
    consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
  });

  await page.goto(BASE);

  // Click on Schema menu
  await page.click('text=Schema');
  
  // Wait for "Load from URL..." or "Open Schema File..." to appear
  await page.waitForSelector('text=Load from URL', { timeout: 2000 }).catch(() => null);
  
  // Try to open the file
  const fileInput = await page.$('input[type="file"]').catch(() => null);
  if (fileInput) {
    await fileInput.uploadFile('public/schemas/xml-form-controls-demo.xsd');
  }
  
  // Wait for schema to load
  await page.waitForTimeout(2000);
  
  // Click on Instance Form tab
  await page.click('text=Instance Form');
  
  // Wait for rendering
  await page.waitForTimeout(1000);
  
  // Check console logs for enumeration-related messages
  const enumLogs = consoleLogs.filter(log => 
    log.includes('enumeration') || 
    log.includes('Enumeration') ||
    log.includes('favoriteColor') ||
    log.includes('ColorType')
  );
  
  console.log('=== Console logs related to enumerations ===');
  enumLogs.forEach(log => console.log(log));
  
  console.log('\n=== All console logs ===');
  consoleLogs.forEach(log => console.log(log));
  
  // Check if favoriteColor element exists and is textbox
  const favColor = await page.$('input[value="red"]');
  if (favColor) {
    const type = await favColor.getAttribute('type');
    console.log(`favoriteColor input type: ${type}`);
  }
  
  // Check if there's a select for favoriteColor
  const selects = await page.$$('select');
  console.log(`Number of select elements: ${selects.length}`);
});
