import { test } from '@playwright/test';
import * as fs from 'fs';

test('Debug HTML structure for favoriteColor', async ({ page }) => {
  const logs: string[] = [];
  
  page.on('console', msg => {
    const text = `[${msg.type()}] ${msg.text()}`;
    logs.push(text);
  });

  // Set up localStorage
  await page.context().addInitScript(() => {
    localStorage.setItem('schema-sculptor-markup-language', 'xml');
  });

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  
  // Click Instance Form tab
  await page.click('text=Instance Form');
  
  // Wait for rendering
  await page.waitForTimeout(2000);
  
  // Get all textboxes
  const textboxes = await page.locator('input[type="text"]').all();
  logs.push(`Total textboxes found: ${textboxes.length}`);
  
  for (let i = 0; i < textboxes.length; i++) {
    const value = await textboxes[i].inputValue();
    const placeholder = await textboxes[i].getAttribute('placeholder');
    const ariaLabel = await textboxes[i].getAttribute('aria-label');
    logs.push(`Textbox ${i}: value="${value}" placeholder="${placeholder}" aria-label="${ariaLabel}"`);
  }
  
  // Get HTML dump of the form area
  const formHtml = await page.locator('generic').first().evaluate(el => {
    return el.outerHTML.substring(0, 2000);
  }).catch(() => 'N/A');
  
  logs.push(`\n=== Form HTML dump ===`);
  logs.push(formHtml || 'N/A');
  
  // Save logs to file
  fs.writeFileSync('e2e/html-structure-logs.txt', logs.join('\n'), 'utf-8');
  console.log(`Logs saved`);
});
