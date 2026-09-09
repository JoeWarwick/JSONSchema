import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test('Check if favoriteColor renders as select after form fix', async ({ page, context }) => {
  // Set localStorage before navigation
  await context.addInitScript(() => {
    try {
      localStorage.setItem('schema-sculptor-markup-language', 'xml');
      localStorage.setItem('schema-sculptor-schema-xml', '');
      localStorage.setItem('schema-sculptor-instance-xml', '');
    } catch {}
  });

  // Navigate to the app
  await page.goto(BASE);
  await page.waitForTimeout(2000);

  // Load the demo XSD via Schema Form
  const schemaTab = page.getByRole('button', { name: 'Schema Form' });
  await schemaTab.click();
  await page.waitForTimeout(1000);

  const loadDemoBtn = page.getByRole('button', { name: 'Load demo controls XSD' }).first();
  await loadDemoBtn.click();
  await page.waitForTimeout(2000);

  // Go to Instance Form
  const instanceFormTab = page.getByRole('button', { name: 'Instance Form' });
  await instanceFormTab.click();
  await page.waitForTimeout(2000);

  // Wait for form to render
  await page.waitForTimeout(2000);

  // Look for all form elements
  const allInputs = page.locator('input, select, textarea');
  const inputCount = await allInputs.count();
  console.log(`Total form elements found: ${inputCount}`);

  // Try to find favoriteColor by looking for the label text and adjacent input
  const favoriteColorLabel = page.locator('label, div').filter({ hasText: /favoriteColor/ }).first();
  const labelVisible = await favoriteColorLabel.isVisible().catch(() => false);
  console.log(`favoriteColor label visible: ${labelVisible}`);

  if (labelVisible) {
    // Get the parent container and look for the input
    const container = favoriteColorLabel.locator('..').first();
    const inputs = container.locator('input, select');
    const inputCount = await inputs.count();
    console.log(`Inputs in favoriteColor container: ${inputCount}`);

    if (inputCount > 0) {
      const input = inputs.first();
      const info = await input.evaluate((el) => {
        return {
          tagName: el.tagName,
          type: (el as any).type,
          value: (el as any).value,
          id: (el as any).id,
          className: (el as any).className,
        };
      });

      console.log(`favoriteColor element info:`, info);

      if (info.tagName === 'SELECT') {
        console.log('✓ PASS: favoriteColor is a SELECT dropdown');
      } else {
        console.log(`✗ FAIL: favoriteColor is a ${info.tagName}, should be SELECT`);
      }
    }
  } else {
    console.log('✗ Could not find favoriteColor label');
    
    // Try a broader search - look for any input/select and print them
    const allLabels = page.locator('label');
    const labelCount = await allLabels.count();
    console.log(`Total labels on page: ${labelCount}`);
    
    for (let i = 0; i < Math.min(labelCount, 10); i++) {
      const label = allLabels.nth(i);
      const text = await label.textContent();
      console.log(`  Label ${i}: ${text}`);
    }
  }

  // Also check total select count on the page
  const selectCount = await page.locator('select').count();
  console.log(`Total select elements on page: ${selectCount}`);

});
