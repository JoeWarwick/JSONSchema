import { test } from '@playwright/test';

test('Read debug logs from window variable', async ({ page }) => {
  await page.context().addInitScript(() => {
    window.__DEBUG_LOGS__ = [];
  });

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  
  // Click Instance Form tab
  await page.click('text=Instance Form');
  
  // Wait for rendering
  await page.waitForTimeout(2000);
  
  // Read the debug logs from the window
  const debugLogs = await page.evaluate(() => {
    return window.__DEBUG_LOGS__;
  }).catch(e => []);
  
  console.log('=== DEBUG LOGS FROM WINDOW ===');
  if (Array.isArray(debugLogs)) {
    debugLogs.forEach(log => {
      console.log(log);
    });
  } else {
    console.log('No debug logs captured');
  }
});
