import { test, expect, Page } from '@playwright/test';

test('Capture ATTR ENUM console logs', async ({ page }) => {
  const allLogs: string[] = [];
  const capturedLogs: string[] = [];
  
  // Listen to ALL console messages
  page.on('console', (msg) => {
    const text = msg.text();
    allLogs.push(text);
    
    // Capture messages containing ATTR ENUM or favoriteColor
    if (text.includes('ATTR ENUM') || text.includes('favoriteColor')) {
      capturedLogs.push(text);
      console.log(`[CAPTURED] ${text}`);
    }
  });

  // Navigate to the application
  console.log('Navigating to http://localhost:5173');
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  console.log('Page loaded');
  
  // Clear localStorage
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  console.log('Storage cleared');
  
  // Reload to start fresh
  await page.reload({ waitUntil: 'networkidle' });
  console.log('Page reloaded');
  
  // Give the page time to render initial content
  await page.waitForTimeout(2000);
  
  // Click on Instance Form tab
  console.log('Looking for Instance Form tab...');
  const instanceFormTab = page.locator('[role="tab"]:has-text("Instance Form")');
  const exists = await instanceFormTab.isVisible({ timeout: 5000 }).catch(() => false);
  
  if (exists) {
    console.log('Instance Form tab found, clicking...');
    await instanceFormTab.click();
    await page.waitForTimeout(3000); // Wait for content to render
  } else {
    console.log('Instance Form tab not found, trying alternative selector');
    const altTab = page.locator('button:has-text("Instance Form")');
    const altExists = await altTab.isVisible({ timeout: 5000 }).catch(() => false);
    if (altExists) {
      await altTab.click();
      await page.waitForTimeout(3000);
    }
  }
  
  // Wait for any XML instance form rendering
  await page.waitForTimeout(2000);
  
  // Try to scroll down to trigger more rendering
  await page.evaluate(() => {
    window.scrollBy(0, window.innerHeight);
  });
  await page.waitForTimeout(1000);
  
  // Print ALL console logs
  console.log('\n=== ALL CONSOLE LOGS (Total: ' + allLogs.length + ') ===');
  allLogs.forEach((log, index) => {
    console.log(`${index + 1}. ${log}`);
  });
  console.log('=== END ALL LOGS ===\n');
  
  // Print captured logs
  console.log('\n=== FILTERED LOGS (ATTR ENUM or favoriteColor) ===');
  if (capturedLogs.length === 0) {
    console.log('No filtered logs captured');
  } else {
    capturedLogs.forEach((log, index) => {
      console.log(`${index + 1}. ${log}`);
    });
  }
  console.log('=== END FILTERED LOGS ===\n');
});
