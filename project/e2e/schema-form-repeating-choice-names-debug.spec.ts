import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test.describe('Schema Form - Repeating Choice Elements with @name Badges - Debug', () => {
  test('capture compiler and choicegroups logs', async ({ page }) => {
    const allLogs: string[] = [];
    const schemaCompilerLogs: string[] = [];
    const choiceGroupsLogs: string[] = [];
    
    page.on('console', (msg) => {
      const text = msg.text();
      allLogs.push(text);
      if (text.includes('[SchemaCompiler]')) {
        schemaCompilerLogs.push(text);
      }
      if (text.includes('[ChoiceGroups]')) {
        choiceGroupsLogs.push(text);
      }
    });

    await page.context().addInitScript(() => {
      try {
        localStorage.clear();
        localStorage.setItem('schema-sculptor-markup-language', 'xml');
        localStorage.setItem('schema-sculptor-schema-xml', '');
        localStorage.setItem('schema-sculptor-instance-xml', '');
      } catch {
        // ignore
      }
    });

    await page.goto(BASE);

    // Load demo.xsd via "Load demo controls XSD" button
    const schemaFormTab = page.getByRole('button', { name: 'Schema Form' });
    await schemaFormTab.waitFor({ state: 'visible', timeout: 10000 });
    await schemaFormTab.click();

    const loadDemoBtn = page.getByRole('button', { name: 'Load demo controls XSD' }).first();
    await loadDemoBtn.waitFor({ state: 'visible', timeout: 10000 });
    await loadDemoBtn.click();

    // Wait for xs:schema root to be visible
    await expect(page.getByText('xs:schema').first()).toBeVisible({ timeout: 15000 });

    // Give the form time to fully render
    await page.waitForTimeout(2000);

    // Print all logs for debugging
    console.log('\n=== ALL CONSOLE LOGS ===');
    for (const log of allLogs) {
      console.log(log);
    }

    console.log('\n=== [SchemaCompiler] LOGS ===');
    if (schemaCompilerLogs.length > 0) {
      for (const log of schemaCompilerLogs) {
        console.log(log);
      }
    } else {
      console.log('No [SchemaCompiler] logs found');
    }

    console.log('\n=== [ChoiceGroups] LOGS ===');
    if (choiceGroupsLogs.length > 0) {
      for (const log of choiceGroupsLogs) {
        console.log(log);
      }
    } else {
      console.log('No [ChoiceGroups] logs found');
    }

    console.log('=== END LOGS ===\n');
  });
});
