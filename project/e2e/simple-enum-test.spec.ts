import { test } from '@playwright/test';

test('Capture enumeration logs', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const logs: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('getTypeEnumerations') || text.includes('FAVORITECOLOR')) {
      logs.push(text);
      console.log('LOG:', text);
    }
  });
  
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(3000);
  
  console.log('\n=== ENUMERATION LOGS ===\n');
  logs.forEach(l => console.log(l));
  
  await context.close();
});
