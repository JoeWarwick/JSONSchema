import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test('Simple: Check if Instance Form loads with demo XSD', async ({ page, context }) => {
  // Set localStorage before navigation
  await context.addInitScript(() => {
    try {
      localStorage.setItem('schema-sculptor-markup-language', 'xml');
      localStorage.setItem('schema-sculptor-schema-xml', '');
      localStorage.setItem('schema-sculptor-instance-xml', '');
    } catch {}
  });

  // Navigate to the app
  console.log('Navigating to', BASE);
  await page.goto(BASE);

  // Wait for page to load
  await page.waitForTimeout(2000);

  // Check what tabs exist
  const tabs = page.getByRole('button', { name: /Schema Form|Instance Form|XML Input/ });
  const tabCount = await tabs.count();
  console.log(`Found ${tabCount} tabs`);

  // Try clicking Schema Form tab
  console.log('Clicking Schema Form tab...');
  const schemaTab = page.getByRole('button', { name: 'Schema Form' });
  await schemaTab.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {
    console.log('Schema Form tab not found');
  });
  await schemaTab.click().catch(() => {
    console.log('Failed to click Schema Form tab');
  });

  // Wait for the page to update
  await page.waitForTimeout(1000);

  // Try to find and click Load demo button
  console.log('Looking for Load demo controls XSD button...');
  const loadDemoBtn = page.getByRole('button', { name: 'Load demo controls XSD' }).first();
  
  const isVisible = await loadDemoBtn.isVisible().catch(() => false);
  console.log(`Load demo button visible: ${isVisible}`);

  if (isVisible) {
    console.log('Clicking Load demo controls XSD...');
    await loadDemoBtn.click();
    
    // Wait for schema to load
    await page.waitForTimeout(3000);
    
    // Click Instance Form tab
    console.log('Clicking Instance Form tab...');
    const instanceFormTab = page.getByRole('button', { name: 'Instance Form' });
    const iFormVisible = await instanceFormTab.isVisible().catch(() => false);
    console.log(`Instance Form tab visible: ${iFormVisible}`);
    
    if (iFormVisible) {
      await instanceFormTab.click();
      
      // Wait for form to render
      await page.waitForTimeout(2000);
      
      // Check what's on the page
      const formContent = await page.evaluate(() => {
        return {
          hasEditorContainer: !!document.querySelector('[class*="editorContainer"]'),
          hasEmptyState: !!document.querySelector('[class*="emptyState"]'),
          emptyStateText: document.querySelector('[class*="emptyState"]')?.textContent,
          buttonCount: document.querySelectorAll('button').length,
          inputCount: document.querySelectorAll('input').length,
          selectCount: document.querySelectorAll('select').length,
          labelCount: document.querySelectorAll('label').length,
          divCount: document.querySelectorAll('div').length,
        };
      });
      
      console.log('=== Form Content ===');
      console.log(JSON.stringify(formContent, null, 2));
      
      // Take a screenshot
      await page.screenshot({ path: '/tmp/form-screenshot.png' }).catch(() => {
        console.log('Screenshot failed');
      });
    }
  } else {
    console.log('Load demo button not found, checking page state...');
    const pageText = await page.evaluate(() => document.body.innerText);
    console.log(pageText.substring(0, 1000));
  }
});
