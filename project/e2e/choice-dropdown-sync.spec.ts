import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test.describe('Choice Dropdown XML Sync Diagnostic', () => {
  test('diagnostic: print page structure', async ({ page }) => {
    console.log('Navigating to', BASE);
    await page.goto(BASE);
    
    console.log('Waiting for load state...');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    
    console.log('Taking screenshot...');
    await page.screenshot({ path: 'e2e/diagnostic-page.png', fullPage: true });
    
    console.log('Getting page content...');
    const content = await page.content();
    console.log('Page HTML length:', content.length);
    console.log('First 500 chars:', content.substring(0, 500));
    
    // Check if Instance Form text exists anywhere on page
    const hasInstanceForm = content.includes('Instance Form');
    console.log('Page contains "Instance Form":', hasInstanceForm);
    
    // Get all text on page
    const pageText = await page.evaluate(() => document.body.innerText);
    console.log('Page text (first 1000 chars):', pageText.substring(0, 1000));
    
    // Get all buttons
    const buttons = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.map(btn => ({ text: btn.textContent, id: btn.id, className: btn.className }));
    });
    console.log('Buttons on page:', JSON.stringify(buttons, null, 2));
    
    // Check for select elements
    const selects = await page.evaluate(() => {
      const sels = Array.from(document.querySelectorAll('select'));
      return sels.map((sel, idx) => ({
        index: idx,
        options: Array.from(sel.options).map(opt => opt.textContent),
        value: sel.value
      }));
    });
    console.log('Select elements:', JSON.stringify(selects, null, 2));
  });
});
