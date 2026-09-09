import { test } from '@playwright/test';

test('Debug Instance Form with proper expansion', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const consoleLogs: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    consoleLogs.push(text);
    if (text.includes('renderAttribute') || text.includes('getTypeEnumerations') || text.includes('FAVORITECOLOR')) {
      console.log('LOG:', text);
    }
  });
  
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1000);
  
  // Ensure XML is selected
  const xmlRadio = page.locator('input[value="XML"]');
  await xmlRadio.check();
  await page.waitForTimeout(500);
  
  // Go to Schema Form tab
  const schemaFormBtn = page.locator('button:has-text("Schema Form")');
  await schemaFormBtn.click();
  await page.waitForTimeout(1000);
  
  // Click Schema menu to load demo schema
  const schemaMenu = page.locator('text=Schema').first();
  await schemaMenu.click();
  await page.waitForTimeout(500);
  
  // Look for "Open Schema File..." option
  const openFileOpt = page.locator('text=Open Schema File').first();
  if (await openFileOpt.isVisible({ timeout: 1000 }).catch(() => false)) {
    await openFileOpt.click();
    await page.waitForTimeout(1000);
    
    // Select the demo schema file
    const demoSchemaFile = page.locator('text=xml-form-controls-demo.xsd').first();
    if (await demoSchemaFile.isVisible({ timeout: 1000 }).catch(() => false)) {
      await demoSchemaFile.click();
      await page.waitForTimeout(1000);
    }
  }
  
  await page.waitForTimeout(2000);
  
  // Expand root schema node (look for expand button)
  const expandButtons = page.locator('button').filter({ hasText: /^●/ });
  if (await expandButtons.count() > 0) {
    await expandButtons.first().click();
    await page.waitForTimeout(1000);
  }
  
  // Switch to Instance Form tab
  const instanceFormBtn = page.locator('button:has-text("Instance Form")');
  await instanceFormBtn.click();
  await page.waitForTimeout(1500);
  
  // Expand root node in Instance Form
  const personExpandBtn = page.locator('button:has-text("● person")').first();
  if (await personExpandBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await personExpandBtn.click();
    await page.waitForTimeout(1000);
  }
  
  await page.waitForTimeout(2000);
  
  // Log all captured logs
  console.log('\n\n=== CAPTURED CONSOLE LOGS ===\n');
  const filteredLogs = consoleLogs.filter(l => 
    l.includes('renderAttribute') || 
    l.includes('getTypeEnumerations') || 
    l.includes('FAVORITECOLOR') ||
    l.includes('[ATTR') ||
    l.includes('[Schema')
  );
  
  if (filteredLogs.length === 0) {
    console.log('NO FILTERED LOGS FOUND');
    console.log('\nAll logs:');
    consoleLogs.forEach((l, i) => console.log(`${i}: ${l}`));
  } else {
    filteredLogs.forEach(l => console.log(l));
  }
  
  // Check for favoriteColor element
  const fcLabel = page.locator('text=favoriteColor:').first();
  console.log('\nfavoriteColor visible:', await fcLabel.isVisible({ timeout: 1000 }).catch(() => false));
  
  // Check for selects
  const selectCount = await page.locator('select').count();
  console.log('Total selects on page:', selectCount);
  
  await context.close();
});
