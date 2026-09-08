import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test('Check for [SCHEMA DRIVEN] console messages', async ({ page }) => {
  const consoleLogs: string[] = [];
  const schemaDrivenLogs: { type: string; localTagName: string; childrenCount: number; fullLog: string }[] = [];
  
  // Set up console message listener
  page.on('console', msg => {
    const text = msg.text();
    const timestamp = new Date().toISOString();
    const logEntry = `[${msg.type().toUpperCase()}] ${text}`;
    consoleLogs.push(logEntry);
    
    // Check if this log contains the SCHEMA DRIVEN marker
    if (text.includes('[SCHEMA DRIVEN]')) {
      console.log(`✓ Found: ${logEntry}`);
      
      // Parse the log to extract details
      // Expected format: [SCHEMA DRIVEN] localTagName schemaNode.children.length: count
      const match = text.match(/\[SCHEMA DRIVEN\]\s+(\S+)\s+schemaNode\.children\.length:\s+(\d+)/);
      if (match) {
        schemaDrivenLogs.push({
          type: msg.type(),
          localTagName: match[1],
          childrenCount: parseInt(match[2], 10),
          fullLog: logEntry
        });
      }
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

  // Navigate to Instance Form tab to trigger schema-driven rendering
  const instanceTab = page.getByRole('button', { name: /Instance Form|Instance/i }).first();
  console.log('Waiting for Instance Form tab...');
  await instanceTab.waitFor({ state: 'visible', timeout: 15000 });
  await instanceTab.click();
  console.log('Clicked Instance Form tab');
  await page.waitForTimeout(1000);

  // Load demo controls XSD which should trigger schema-driven rendering logs
  const loadDemoBtn = page.getByRole('button', { name: 'Load demo controls XSD' }).first();
  console.log('Waiting for Load demo button...');
  await loadDemoBtn.waitFor({ state: 'visible', timeout: 15000 });
  await loadDemoBtn.click();
  console.log('Clicked Load demo button');
  await page.waitForTimeout(3000);

  // Wait for instance form to be rendered
  await expect(page.locator('[class*="form"], input, textarea').first()).toBeVisible({ timeout: 15000 });
  console.log('Instance form loaded');

  // Interact with form to potentially trigger more schema-driven logs
  const inputs = await page.locator('input, textarea').all();
  console.log(`Found ${inputs.length} input elements`);
  
  for (let i = 0; i < Math.min(inputs.length, 3); i++) {
    try {
      await inputs[i].scrollIntoViewIfNeeded();
      await inputs[i].click();
      await page.waitForTimeout(500);
    } catch (e) {
      // ignore
    }
  }

  // Wait a bit more for any final logs
  await page.waitForTimeout(1000);

  // Save results
  const results = {
    timestamp: new Date().toISOString(),
    page_url: page.url(),
    total_console_logs: consoleLogs.length,
    schema_driven_logs_found: schemaDrivenLogs.length,
    schema_driven_logs: schemaDrivenLogs,
    all_logs_sample: consoleLogs.slice(-50), // Last 50 logs for context
  };

  fs.writeFileSync('./schema-driven-results.json', JSON.stringify(results, null, 2), 'utf-8');

  console.log('\n===== RESULTS =====');
  console.log(`Total console logs: ${consoleLogs.length}`);
  console.log(`[SCHEMA DRIVEN] logs found: ${schemaDrivenLogs.length}`);
  console.log('===== SCHEMA DRIVEN LOGS =====');
  
  if (schemaDrivenLogs.length > 0) {
    console.log('Element Type | Children Count');
    console.log('------------|----------------');
    schemaDrivenLogs.forEach(log => {
      console.log(`${log.localTagName.padEnd(12)}| ${log.childrenCount}`);
      console.log(`  Full: ${log.fullLog}`);
    });
  } else {
    console.log('(No [SCHEMA DRIVEN] logs found)');
  }
  console.log('===================\n');

  // Report findings
  if (schemaDrivenLogs.length > 0) {
    console.log(`✓ SUCCESS: Found ${schemaDrivenLogs.length} [SCHEMA DRIVEN] message(s)`);
  } else {
    console.log('⚠ INFO: No [SCHEMA DRIVEN] messages found in console');
  }
});
