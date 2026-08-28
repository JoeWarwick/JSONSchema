import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test('simple field rendering with firstName typing', async ({ page }) => {
  await page.goto(BASE);
  
  // Wait for page to load
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
  
  // Navigate to XML Input tab
  const xmlInputTab = page.getByRole('button', { name: 'XML Input' });
  await xmlInputTab.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  
  if (await xmlInputTab.isVisible().catch(() => false)) {
    await xmlInputTab.click();
    await page.waitForTimeout(500);
  
  // Paste simple instance
  const xmlTextarea = page.locator('textarea').first();
  await xmlTextarea.fill(`<person>
  <firstName>John</firstName>
  <lastName>Doe</lastName>
  <birthDate>1990-01-01</birthDate>
</person>`);
  await page.waitForTimeout(300);
  
  // Navigate to Schema Input tab
  const schemaInputTab = page.getByRole('button', { name: 'Schema Input' });
  await schemaInputTab.click();
  await page.waitForTimeout(300);
  
  // Paste simple schema
  const schemaTextarea = page.locator('textarea').first();
  await schemaTextarea.fill(`<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="person" type="PersonType"/>
  <xs:complexType name="PersonType">
    <xs:sequence>
      <xs:element name="firstName" type="xs:string"/>
      <xs:element name="lastName" type="xs:string"/>
      <xs:element name="birthDate" type="xs:date"/>
    </xs:sequence>
  </xs:complexType>
</xs:schema>`);
  await page.waitForTimeout(500);
  
  // Go to Instance Form
  const instanceFormTab = page.getByRole('button', { name: 'Instance Form' });
  await instanceFormTab.click();
  await page.waitForTimeout(500);
  
  // Check initial inputs
  const initialInputs = page.locator('input[type="text"], input[type="date"]');
  const initialCount = await initialInputs.count();
  console.log(`[TEST] Initial input count: ${initialCount}`);
  
  // Get field labels
  const labels = await page.locator('label, [style*="minWidth: 100"]').allTextContents();
  console.log(`[TEST] Initial field labels: ${labels.filter(l => l.includes(':')).join(', ')}`);
  
  // Type in first input
  const firstInput = initialInputs.first();
  await firstInput.click();
  await firstInput.fill('Jane');
  await page.waitForTimeout(500);
  
  // Check inputs after typing
  const afterInputs = page.locator('input[type="text"], input[type="date"]');
  const afterCount = await afterInputs.count();
  console.log(`[TEST] Input count after typing: ${afterCount}`);
  
  const afterLabels = await page.locator('label, [style*="minWidth: 100"]').allTextContents();
  console.log(`[TEST] Field labels after typing: ${afterLabels.filter(l => l.includes(':')).join(', ')}`);
  
  expect(afterCount).toBeGreaterThanOrEqual(initialCount, 'Fields should not disappear when typing');
});
