import { test } from '@playwright/test';

test('Check UI state', async ({ page }) => {
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  
  // Get all tab buttons
  const tabs = await page.locator('button').filter({ hasText: /XML Input|Instance Form|Schema Input/ }).all();
  console.log(`Found ${tabs.length} tabs`);
  
  for (const tab of tabs) {
    const text = await tab.textContent();
    const isActive = await tab.evaluate((el: Element) => el.getAttribute('aria-selected') === 'true' || el.hasAttribute('aria-pressed'));
    console.log(`Tab: "${text}" active=${isActive}`);
  }
  
  // Click Instance Form
  await page.click('button:has-text("Instance Form")');
  await page.waitForTimeout(1000);
  
  // Check tabs again
  console.log('\n--- After clicking Instance Form ---');
  for (const tab of tabs) {
    const text = await tab.textContent();
    const isActive = await tab.evaluate((el: Element) => el.getAttribute('aria-selected') === 'true' || el.hasAttribute('aria-pressed'));
    console.log(`Tab: "${text}" active=${isActive}`);
  }
  
  // Get debug logs
  const debugLogs = await page.evaluate(() => window.__DEBUG_LOGS__).catch(() => []);
  console.log(`\nDebug logs count: ${debugLogs ? debugLogs.length : 0}`);
  if (debugLogs && Array.isArray(debugLogs)) {
    debugLogs.forEach(log => console.log(`  ${log}`));
  }
});
