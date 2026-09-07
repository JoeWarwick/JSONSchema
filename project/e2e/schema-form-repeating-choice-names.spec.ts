import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test.describe('Schema Form - Debug Children Section Rendering', () => {
  test('debug why children section is not rendering', async ({ page }) => {
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      consoleLogs.push(text);
      // Also log to stdout
      if (text.includes('ChildrenSection') || text.includes('ChoiceGroups') || text.includes('XmlElementNode')) {
        console.log(text);
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
    
    // Expand xs:schema by finding and clicking the expand button nearby
    // Look for the toggle button that's near the xs:schema text
    const schemaLine = page.locator('text=/xs:schema/').first();
    await schemaLine.waitFor({ state: 'visible', timeout: 5000 });
    
    // Find the parent container and look for an expand/collapse button
    const schemaContainer = schemaLine.locator('..').locator('..').first();
    const expandButton = schemaContainer.locator('button').first();
    
    // Click the expand button if it exists
    try {
      await expandButton.click({ timeout: 3000 });
      await page.waitForTimeout(1000);
      console.log('Expanded xs:schema element');
    } catch (e) {
      console.log('Could not find or click expand button for xs:schema');
    }
    
    // Collect all logs about ChildrenSection and ChoiceGroups
    console.log('\n=== Collected Console Logs ===');
    const childrenSectionLogs = consoleLogs.filter(l => l.includes('ChildrenSection'));
    const choiceGroupsLogs = consoleLogs.filter(l => l.includes('ChoiceGroups'));
    
    console.log(`ChildrenSection logs: ${childrenSectionLogs.length}`);
    childrenSectionLogs.forEach(log => console.log(`  ${log}`));
    
    console.log(`\nChoiceGroups logs: ${choiceGroupsLogs.length}`);
    choiceGroupsLogs.forEach(log => console.log(`  ${log}`));
    
    // Check for rendered choice elements
    const selectElements = page.locator('select');
    const selectCount = await selectElements.count();
    const optionCount = await page.locator('option').count();
    
    console.log(`\n=== DOM State After Expanding xs:schema ===`);
    console.log(`Select elements (choice dropdowns): ${selectCount}`);
    console.log(`Option elements: ${optionCount}`);
    
    // Also check for any visible rows or containers
    const allSelects = page.locator('select:visible');
    const visibleSelectCount = await allSelects.count();
    console.log(`Visible select elements: ${visibleSelectCount}`);
    
    // Check the page content around xs:schema
    const pageContent = await page.locator('body').textContent();
    const hasColorType = pageContent?.includes('ColorType');
    const hasPersonType = pageContent?.includes('PersonType');
    const hasEmployee = pageContent?.includes('EmployeeType');
    console.log(`Page contains ColorType: ${hasColorType}`);
    console.log(`Page contains PersonType: ${hasPersonType}`);
    console.log(`Page contains EmployeeType: ${hasEmployee}`);
    
    // Check if there are multiple choice groups
    const rowsWithGap = page.locator('[style*="marginBottom"]');
    const rowCount = await rowsWithGap.count();
    console.log(`Elements with marginBottom styling: ${rowCount}`);
    
    // If we have selects, get their values to see what elements are rendered
    if (selectCount > 0) {
      console.log(`\n=== Rendered Choice Elements (ALL) ===`);
      for (let i = 0; i < selectCount; i++) {
        const value = await selectElements.nth(i).inputValue();
        const options = await selectElements.nth(i).locator('option').count();
        console.log(`Row ${i + 1}: value="${value}" options=${options}`);
      }
      console.log(`\n*** TOTAL RENDERED ROWS: ${selectCount} (EXPECTED: 12) ***`);
    } else {
      console.log('No select elements found - xs:schema children may not be rendering');
    }
  });
});
