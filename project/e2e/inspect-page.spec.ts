import { test } from '@playwright/test';

test('Inspect page structure', async ({ page }) => {
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  
  // Get all buttons
  const allButtons = await page.locator('button').all();
  console.log(`Total buttons: ${allButtons.length}`);
  
  for (let i = 0; i < Math.min(15, allButtons.length); i++) {
    const text = await allButtons[i].textContent();
    console.log(`Button ${i}: "${text}"`);
  }
  
  // Try to find "person" element indicator
  const personText = await page.textContent('text=person');
  console.log(`\nFound "person" text: ${personText ? 'yes' : 'no'}`);
  
  // Get all headings
  const headings = await page.locator('h2').all();
  console.log(`\nHeadings: ${headings.length}`);
  for (const h of headings) {
    console.log(`  - ${await h.textContent()}`);
  }
});
