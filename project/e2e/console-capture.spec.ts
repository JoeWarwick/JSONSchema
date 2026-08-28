import { test } from '@playwright/test';
import * as fs from 'fs';

test('Log console output to file', async ({ page }) => {
  const logs: string[] = [];
  
  page.on('console', msg => {
    const text = msg.text();
    // Capture all console logs
    logs.push(`[${msg.type().toUpperCase()}] ${text}`);
    console.log(text);  // Also print to stdout
  });

  // Navigate
  await page.goto('http://localhost:5173/?test=' + Date.now());
  await page.waitForTimeout(2000);

  // Type in firstName
  const inputs = page.locator('input[type="text"], input[type="date"]');
  if (await inputs.count() > 0) {
    console.log(`Found ${await inputs.count()} input fields`);
    await inputs.nth(0).click();
    await inputs.nth(0).fill('TestName');
    await page.waitForTimeout(1500);
  }

  // Write logs to file
  fs.writeFileSync('./console-logs.txt', logs.join('\n'), 'utf-8');
  console.log(`\n=== Logged ${logs.length} messages to console-logs.txt ===`);
});
