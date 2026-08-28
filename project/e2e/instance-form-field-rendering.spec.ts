import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

// Simple person schema with firstName, lastName, birthDate
const PERSON_SCHEMA = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="person" type="PersonType"/>
  
  <xs:complexType name="PersonType">
    <xs:sequence>
      <xs:element name="firstName" type="xs:string"/>
      <xs:element name="lastName" type="xs:string"/>
      <xs:element name="birthDate" type="xs:string"/>
    </xs:sequence>
  </xs:complexType>
</xs:schema>`;

const INSTANCE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<person>
  <firstName>John</firstName>
  <lastName>Doe</lastName>
  <birthDate>1990-01-01</birthDate>
</person>`;

test.describe('Instance Form Field Rendering', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage to start fresh
    await page.context().addInitScript(() => {
      try {
        localStorage.setItem('schema-sculptor-markup-language', 'xml');
        localStorage.setItem('schema-sculptor-schema-xml', '');
        localStorage.setItem('schema-sculptor-instance-xml', '');
      } catch {
        // ignore
      }
    });

    await page.goto(BASE);
  });

  test('should maintain input fields when typing in firstName field', async ({ page }) => {
    // Load schema via Schema menu
    const schemaMenu = page.getByRole('menuitem', { name: 'Schema' });
    await schemaMenu.waitFor({ state: 'visible', timeout: 10000 });
    await schemaMenu.click();

    // Wait for menu to open and click "Load from URL..." or similar
    // For now, we'll paste it into Schema Input tab
    const schemaInputTab = page.getByRole('button', { name: 'Schema Input' });
    await schemaInputTab.waitFor({ state: 'visible', timeout: 10000 });
    await schemaInputTab.click();

    // Paste the schema
    const schemaTextarea = page.locator('textarea').first();
    await schemaTextarea.fill(PERSON_SCHEMA);

    // Wait a moment for schema to process
    await page.waitForTimeout(500);

    // Navigate to XML Input tab and paste instance
    const xmlInputTab = page.getByRole('button', { name: 'XML Input' });
    await xmlInputTab.waitFor({ state: 'visible', timeout: 10000 });
    await xmlInputTab.click();

    const xmlTextarea = page.locator('textarea').first();
    await xmlTextarea.fill(INSTANCE_XML);

    // Navigate to Instance Form tab
    const instanceFormTab = page.getByRole('button', { name: 'Instance Form' });
    await instanceFormTab.waitFor({ state: 'visible', timeout: 10000 });
    await instanceFormTab.click();

    // Wait for form to render with input fields
    await page.waitForFunction(
      () => {
        const inputs = document.querySelectorAll('input[type="text"]');
        return inputs.length >= 3;
      },
      { timeout: 10000 }
    );

    // Count initial input fields
    let initialInputCount = await page.locator('input[type="text"]').count();
    console.log(`Initial input count: ${initialInputCount}`);
    expect(initialInputCount).toBeGreaterThanOrEqual(3);

    // Log all initial field labels
    const initialLabels = await page.locator('label').allTextContents();
    console.log(`Initial labels: ${initialLabels.join(', ')}`);

    // Find the firstName input field and type in it
    const firstNameInputs = page.locator('input[type="text"]');
    const firstInput = firstNameInputs.first();
    await firstInput.click();
    await firstInput.fill('Jane');

    // Wait a moment for any re-renders
    await page.waitForTimeout(300);

    // Count input fields after typing
    const afterTypingInputCount = await page.locator('input[type="text"]').count();
    console.log(`Input count after typing: ${afterTypingInputCount}`);

    // Log all labels after typing to see what changed
    const afterLabels = await page.locator('label').allTextContents();
    console.log(`Labels after typing: ${afterLabels.join(', ')}`);

    // The key assertion: we should still have at least 3 input fields
    // If the bug is present, some fields would render as labels instead of inputs,
    // reducing this count
    expect(afterTypingInputCount).toBeGreaterThanOrEqual(3);

    // Also verify the fields haven't changed in count
    expect(afterTypingInputCount).toBe(initialInputCount);

    // Verify all three field labels are visible
    await expect(page.getByText('firstName:')).toBeVisible();
    await expect(page.getByText('lastName:')).toBeVisible();
    await expect(page.getByText('birthDate:')).toBeVisible();
  });

  test('should maintain all input fields when modifying multiple fields', async ({ page }) => {
    // Load schema via Schema menu
    const schemaMenu = page.getByRole('menuitem', { name: 'Schema' });
    await schemaMenu.waitFor({ state: 'visible', timeout: 10000 });
    await schemaMenu.click();

    // Navigate to Schema Input tab
    const schemaInputTab = page.getByRole('button', { name: 'Schema Input' });
    await schemaInputTab.waitFor({ state: 'visible', timeout: 10000 });
    await schemaInputTab.click();

    // Paste the schema
    const schemaTextarea = page.locator('textarea').first();
    await schemaTextarea.fill(PERSON_SCHEMA);

    // Wait a moment for schema to process
    await page.waitForTimeout(500);

    // Navigate to XML Input tab and paste instance
    const xmlInputTab = page.getByRole('button', { name: 'XML Input' });
    await xmlInputTab.waitFor({ state: 'visible', timeout: 10000 });
    await xmlInputTab.click();

    const xmlTextarea = page.locator('textarea').first();
    await xmlTextarea.fill(INSTANCE_XML);

    // Navigate to Instance Form tab
    const instanceFormTab = page.getByRole('button', { name: 'Instance Form' });
    await instanceFormTab.waitFor({ state: 'visible', timeout: 10000 });
    await instanceFormTab.click();

    // Wait for form to render
    await page.waitForFunction(
      () => {
        const inputs = document.querySelectorAll('input[type="text"]');
        return inputs.length >= 3;
      },
      { timeout: 10000 }
    );

    const inputs = page.locator('input[type="text"]');
    
    // Type in firstName
    await inputs.nth(0).fill('Alice');
    await page.waitForTimeout(300);
    expect(await page.locator('input[type="text"]').count()).toBeGreaterThanOrEqual(3);

    // Type in lastName
    await inputs.nth(1).fill('Smith');
    await page.waitForTimeout(300);
    expect(await page.locator('input[type="text"]').count()).toBeGreaterThanOrEqual(3);

    // Type in birthDate
    await inputs.nth(2).fill('1995-05-15');
    await page.waitForTimeout(300);
    expect(await page.locator('input[type="text"]').count()).toBeGreaterThanOrEqual(3);

    // Final verification: all three fields should still be visible as inputs
    const finalInputCount = await page.locator('input[type="text"]').count();
    expect(finalInputCount).toBeGreaterThanOrEqual(3);
  });
});
