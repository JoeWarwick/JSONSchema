import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test('Check for [RESTRICTION RENDER] console messages when viewing ColorType with xs:restriction', async ({ page }) => {
  const consoleLogs: string[] = [];
  const restrictionLogs: string[] = [];
  
  // Set up console message listener
  page.on('console', msg => {
    const text = msg.text();
    const timestamp = new Date().toISOString();
    const logEntry = `[${msg.type().toUpperCase()}] ${text}`;
    consoleLogs.push(logEntry);
    
    // Check if this log contains the restriction render marker
    if (text.includes('[RESTRICTION RENDER]')) {
      restrictionLogs.push(logEntry);
      console.log(`✓ Found: ${logEntry}`);
    }
  });

  // Initialize storage
  await page.context().addInitScript(() => {
    try {
      localStorage.setItem('schema-sculptor-markup-language', 'xml');
      localStorage.setItem('schema-sculptor-schema-xml', '');
      localStorage.setItem('schema-sculptor-instance-xml', '');
      localStorage.removeItem('schema-sculptor-graph-collapse-state');
    } catch {
      // ignore
    }
  });

  console.log('Navigating to:', BASE);
  await page.goto(BASE);
  await page.waitForTimeout(1000);

  // Navigate to Schema Form tab
  const schemaTab = page.getByRole('button', { name: 'Schema Form' });
  console.log('Waiting for Schema Form tab...');
  await schemaTab.waitFor({ state: 'visible', timeout: 15000 });
  await schemaTab.click();
  console.log('Clicked Schema Form tab');
  await page.waitForTimeout(1000);

  // Load demo controls XSD which should contain ColorType with restriction
  const loadDemoBtn = page.getByRole('button', { name: 'Load demo controls XSD' }).first();
  console.log('Waiting for Load demo button...');
  await loadDemoBtn.waitFor({ state: 'visible', timeout: 15000 });
  await loadDemoBtn.click();
  console.log('Clicked Load demo button');
  await page.waitForTimeout(2000);

  // Wait for schema to be rendered
  await expect(page.getByText('xs:schema').first()).toBeVisible({ timeout: 15000 });
  console.log('Schema loaded');

  // Look for ColorType element in the DOM
  console.log('Searching for ColorType element...');
  const colorTypeLocator = page.getByText(/ColorType|xs:restriction/i);
  const colorTypeElements = await colorTypeLocator.all();
  console.log(`Found ${colorTypeElements.length} elements matching ColorType or xs:restriction`);

  // Try to find and scroll to ColorType with xs:restriction
  let found = false;
  for (let i = 0; i < colorTypeElements.length; i++) {
    const element = colorTypeElements[i];
    const text = await element.textContent();
    if (text && (text.includes('ColorType') || text.includes('xs:restriction'))) {
      console.log(`Scrolling to element ${i}: ${text?.substring(0, 50)}`);
      await element.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      found = true;
      break;
    }
  }

  // If ColorType not found, try scrolling through the schema form
  if (!found) {
    console.log('ColorType not immediately found, scrolling schema form...');
    const schemaFormLocator = page.locator('.schema-form, [class*="form"], [class*="schema"]').first();
    if (await schemaFormLocator.isVisible()) {
      await schemaFormLocator.hover();
      await page.keyboard.press('End');
      await page.waitForTimeout(1000);
      await page.keyboard.press('Home');
      await page.waitForTimeout(500);
    }
  }

  // Wait a bit more for any final logs
  await page.waitForTimeout(1000);

  // Save results
  const results = {
    timestamp: new Date().toISOString(),
    page_url: page.url(),
    total_console_logs: consoleLogs.length,
    restriction_render_logs_found: restrictionLogs.length,
    restriction_logs: restrictionLogs,
    all_logs_sample: consoleLogs.slice(-50), // Last 50 logs for context
  };

  fs.writeFileSync('./restriction-render-results.json', JSON.stringify(results, null, 2), 'utf-8');
  fs.writeFileSync('./restriction-render-logs.txt', restrictionLogs.join('\n'), 'utf-8');

  console.log('\n===== RESULTS =====');
  console.log(`Total console logs: ${consoleLogs.length}`);
  console.log(`[RESTRICTION RENDER] logs found: ${restrictionLogs.length}`);
  console.log('===== RESTRICTION RENDER LOGS =====');
  restrictionLogs.forEach(log => console.log(log));
  console.log('===================\n');

  // Report findings
  if (restrictionLogs.length > 0) {
    console.log(`✓ SUCCESS: Found ${restrictionLogs.length} [RESTRICTION RENDER] message(s)`);
  } else {
    console.log('⚠ INFO: No [RESTRICTION RENDER] messages found in console');
  }
});
