import { test } from '@playwright/test';

test('Simple Instance Form debug', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const consoleLogs: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    consoleLogs.push(text);
  });
  
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  
  // Wait for page to load
  await page.waitForTimeout(2000);
  
  // Try to find the expand button for person element
  const personBtn = page.locator('button').filter({ hasText: /person/ }).first();
  console.log('Person button found:', await personBtn.isVisible({ timeout: 1000 }).catch(() => false));
  
  if (await personBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    console.log('Clicking person expand button...');
    await personBtn.click();
    await page.waitForTimeout(1500);
  }
  
  // Check for favoriteColor
  const fcElement = page.locator('text=favoriteColor').first();
  console.log('favoriteColor found:', await fcElement.isVisible({ timeout: 1000 }).catch(() => false));
  
  // Get all log messages
  console.log('\n=== LOGS WITH BRACKETS ===');
  const bracketLogs = consoleLogs.filter(l => l.includes('['));
  bracketLogs.slice(0, 30).forEach(l => console.log(l));
  
  console.log('\n=== LOGS WITH renderAttribute ===');
  consoleLogs.filter(l => l.includes('renderAttribute')).forEach(l => console.log(l));
  
  await context.close();
});
