import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test('Debug: favoriteColor enumeration extraction', async ({ page, context }) => {
  // Set localStorage before navigation
  await context.addInitScript(() => {
    try {
      localStorage.setItem('schema-sculptor-markup-language', 'xml');
      localStorage.setItem('schema-sculptor-schema-xml', '');
      localStorage.setItem('schema-sculptor-instance-xml', '');
      window.__DEBUG_LOGS__ = [];
    } catch {}
  });

  // Capture all console messages
  const consoleLogs: string[] = [];
  const errorLogs: string[] = [];
  page.on('console', msg => {
    const logEntry = `[${msg.type()}] ${msg.text()}`;
    consoleLogs.push(logEntry);
    if (msg.type() === 'error' || msg.type() === 'warning') {
      errorLogs.push(logEntry);
    }
  });

  // Navigate to the app
  await page.goto(BASE);

  // Load the demo XSD
  const schemaTab = page.getByRole('button', { name: 'Schema Form' });
  await schemaTab.waitFor({ state: 'visible', timeout: 15000 });
  await schemaTab.click();

  const loadDemoBtn = page.getByRole('button', { name: 'Load demo controls XSD' }).first();
  await loadDemoBtn.waitFor({ state: 'visible', timeout: 15000 });
  await loadDemoBtn.click();

  // Wait for schema to load
  await expect(page.getByText('xs:schema').first()).toBeVisible({ timeout: 15000 });

  // Now manually load XML instance data into the XML Input tab
  // Since the backend API might not be running, we'll provide instance XML directly
  const xmlInputTab = page.getByRole('button', { name: 'XML Input' });
  await xmlInputTab.waitFor({ state: 'visible', timeout: 5000 });
  await xmlInputTab.click();

  // Wait for the XML Input editor to appear
  await page.waitForFunction(
    () => document.querySelector('textarea'),
    { timeout: 5000 }
  );

  // Paste sample XML instance
  const xmlInputTextarea = page.locator('textarea').first();
  const sampleXml = `<?xml version="1.0" encoding="utf-8"?>
<person id="123" active="true" favoriteColor="red" xmlns:tns="http://example.com/demo" xmlns="http://example.com/demo">
  <firstName>John</firstName>
  <lastName>Doe</lastName>
  <address>
    <street>123 Main St</street>
    <city>Springfield</city>
    <country>USA</country>
  </address>
</person>`;

  await xmlInputTextarea.fill(sampleXml);
  console.log('Pasted XML instance data');
  await page.waitForTimeout(1000);

  // Navigate to Instance Form
  const instanceFormTab = page.getByRole('button', { name: 'Instance Form' });
  await instanceFormTab.waitFor({ state: 'visible', timeout: 10000 });
  await instanceFormTab.click();

  // Wait a bit for form to initialize
  await page.waitForTimeout(1000);

  // Expand the root element (person) by clicking expand button
  // Look for the first button that might be an expand/collapse button
  const allButtons = page.locator('button');
  const firstButton = allButtons.first();
  
  await firstButton.click().catch(() => {
    console.log('Could not click first button');
  });

  // Wait for attributes to render
  await page.waitForFunction(
    () => {
      const attrs = document.querySelectorAll('label');
      return attrs.length > 0;
    },
    { timeout: 5000 }
  ).catch(() => {
    console.log('No attributes rendered');
  });

  // Capture debug logs
  const debugLogs = await page.evaluate(() => (window as any).__DEBUG_LOGS__ || []);
  
  // Check for selects
  const selectCount = await page.locator('select').count();
  console.log(`=== Instance Form Rendered ===`);
  console.log(`Select elements found: ${selectCount}`);
  console.log(`Total console logs captured: ${consoleLogs.length}`);
  console.log(`Debug logs in window: ${debugLogs.length}`);

  // Print all debug logs
  if (debugLogs.length > 0) {
    console.log('\n=== Debug Logs ===');
    debugLogs.forEach((log: string) => console.log(log));
  }

  // Print relevant console logs
  const relevantLogs = consoleLogs.filter((log: string) => 
    log.includes('[ATTR') || 
    log.includes('[RENDER-PERSON') ||
    log.includes('[compiledSchema]') ||
    log.includes('[SchemaCompiler]')
  );

  if (relevantLogs.length > 0) {
    console.log('\n=== Relevant Console Logs ===');
    relevantLogs.forEach((log: string) => console.log(log));
  }

  // Get form data
  const formHtml = await page.locator('[class*="editorContainer"]').first().innerHTML();
  console.log(`\n=== Form HTML (first 2000 chars) ===`);
  console.log(formHtml.substring(0, 2000));

  // Check for favoriteColor specifically
  const favoriteColorInput = page.locator('input[name="favoriteColor"], input[id*="favoriteColor"], select[id*="favoriteColor"]');
  const favoriteColorCount = await favoriteColorInput.count();
  console.log(`\n=== favoriteColor Field ===`);
  console.log(`Found favoriteColor fields: ${favoriteColorCount}`);

  if (favoriteColorCount > 0) {
    const tag = await favoriteColorInput.first().evaluate((el: HTMLElement) => el.tagName);
    const value = await favoriteColorInput.first().evaluate((el: any) => el.value);
    console.log(`Tag: ${tag}, Value: ${value}`);
  }

  // Verify expectations
  console.log(`\n=== Test Result ===`);
  if (selectCount > 0) {
    console.log('✓ PASS: Found select elements');
  } else {
    console.log('✗ FAIL: No select elements found');
    if (favoriteColorCount > 0) {
      const tag = await favoriteColorInput.first().evaluate((el: HTMLElement) => el.tagName);
      console.log(`  - favoriteColor is a ${tag}, should be SELECT`);
    }
  }

  // Dump full console for inspection
  console.log(`\n=== Full Console Output ===`);
  console.log(consoleLogs.join('\n'));

  // Check for errors
  if (errorLogs.length > 0) {
    console.log(`\n=== ERRORS/WARNINGS (${errorLogs.length}) ===`);
    console.log(errorLogs.join('\n'));
  }

  // Check what's actually on the page
  const pageContent = await page.evaluate(() => {
    return {
      bodyHTML: document.body.innerHTML.substring(0, 3000),
      inputCount: document.querySelectorAll('input').length,
      selectCount: document.querySelectorAll('select').length,
      textareaCount: document.querySelectorAll('textarea').length,
      activeTab: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
      hasEmptyState: !!document.querySelector('[class*="emptyState"]'),
      emptyStateText: document.querySelector('[class*="emptyState"]')?.textContent,
    };
  });

  console.log(`\n=== Page Content Analysis ===`);
  console.log(JSON.stringify(pageContent, null, 2));
});
