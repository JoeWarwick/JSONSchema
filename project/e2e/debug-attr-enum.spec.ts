import { test } from '@playwright/test';
import * as fs from 'fs';

test('Debug attribute enumeration rendering', async ({ page }) => {
  const logs: string[] = [];
  
  page.on('console', msg => {
    const text = `[${msg.type()}] ${msg.text()}`;
    logs.push(text);
    console.log(text);
  });

  page.on('pageerror', error => {
    logs.push(`[ERROR] ${error.message}`);
    console.log(`[PAGE ERROR] ${error.message}`);
  });

  // Set up localStorage
  await page.context().addInitScript(() => {
    localStorage.setItem('schema-sculptor-markup-language', 'xml');
    localStorage.setItem('schema-sculptor-schema-xml', '');
    localStorage.setItem('schema-sculptor-instance-xml', '');
  });

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  
  // Click Instance Form tab
  await page.click('text=Instance Form');
  
  // Wait for rendering
  await page.waitForTimeout(2000);
  
  // Check if favoriteColor element exists
  const favColorInputs = await page.$$('input[value="red"]');
  logs.push(`Found ${favColorInputs.length} input elements with value="red"`);
  console.log(`Found ${favColorInputs.length} input elements with value="red"`);
  
  // Save logs to file
  fs.writeFileSync('e2e/attr-enum-logs.txt', logs.join('\n'), 'utf-8');
  console.log(`Logs saved`);
});
