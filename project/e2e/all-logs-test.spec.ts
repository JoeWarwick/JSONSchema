import { test } from '@playwright/test';

test('Capture all console logs', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const logs: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    logs.push(text);
  });
  
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(3000);
  
  console.log('\n=== ALL CONSOLE LOGS ===\n');
  logs.slice(0, 30).forEach((l, i) => console.log(`${i}: ${l}`));
  console.log(`\n... (${logs.length} total logs)\n`);
  
  // Filter for our debug logs
  const debugLogs = logs.filter(l => l.includes('getTypeEnumerations') || l.includes('FAVORITECOLOR') || l.includes('['));
  console.log('\n=== FILTERED DEBUG LOGS ===\n');
  debugLogs.forEach(l => console.log(l));
  
  await context.close();
});
