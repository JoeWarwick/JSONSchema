import { test } from '@playwright/test';

test('Check page content', async ({ page }) => {
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  // Get all button texts
  const buttons = await page.locator('button').all();
  console.log('Total buttons:', buttons.length);
  
  for (let i = 0; i < Math.min(10, buttons.length); i++) {
    const text = await buttons[i].textContent();
    console.log(`Button ${i}: "${text}"`);
  }
  
  // Try to get all text on the page
  const pageText = await page.textContent('body');
  const lines = pageText?.split('\n').filter(l => l.trim()).slice(0, 20) || [];
  console.log('\nPage text (first 20 lines):');
  lines.forEach((l, i) => console.log(`  ${i}: ${l.substring(0, 60)}`));
});
