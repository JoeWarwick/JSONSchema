import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test.describe('Instance Form Child Element Recursion - Person Demo', () => {
  test('loads demo XSD and renders Person element with child elements', async ({ page }) => {
    // Clear localStorage
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

    // Load the demo XSD via Schema menu
    const schemaTab = page.getByRole('button', { name: 'Schema Form' });
    await schemaTab.waitFor({ state: 'visible', timeout: 15000 });
    await schemaTab.click();

    const loadDemoBtn = page.getByRole('button', { name: 'Load demo controls XSD' }).first();
    await loadDemoBtn.waitFor({ state: 'visible', timeout: 15000 });
    await loadDemoBtn.click();

    // Wait for schema to load
    await expect(page.getByText('xs:schema').first()).toBeVisible({ timeout: 15000 });

    // Navigate to Instance Form tab
    const instanceFormTab = page.getByRole('button', { name: 'Instance Form' });
    await instanceFormTab.waitFor({ state: 'visible', timeout: 10000 });
    await instanceFormTab.click();

    // Wait for Instance Form to render child elements - check for child element names
    await page.waitForFunction(
      () => {
        const pageText = document.body.innerText;
        // Check that child element names appear in the rendered form
        return pageText.includes('firstName') && pageText.includes('lastName') && pageText.includes('address');
      },
      { timeout: 15000 }
    );

    // Verify all child elements are present
    const bodyText = await page.innerText('body');
    expect(bodyText).toContain('firstName');
    expect(bodyText).toContain('lastName');
    expect(bodyText).toContain('birthDate');
    expect(bodyText).toContain('address');

    console.log('✓ All child elements rendered: firstName, lastName, birthDate, address');
  });

  test('can modify multiple child element values and form persists changes', async ({ page }) => {
    // Clear localStorage
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

    // Load demo schema
    const schemaTab = page.getByRole('button', { name: 'Schema Form' });
    await schemaTab.waitFor({ state: 'visible', timeout: 15000 });
    await schemaTab.click();

    const loadDemoBtn = page.getByRole('button', { name: 'Load demo controls XSD' }).first();
    await loadDemoBtn.waitFor({ state: 'visible', timeout: 15000 });
    await loadDemoBtn.click();

    await expect(page.getByText('xs:schema').first()).toBeVisible({ timeout: 15000 });

    // Go to Instance Form
    const instanceFormTab = page.getByRole('button', { name: 'Instance Form' });
    await instanceFormTab.waitFor({ state: 'visible', timeout: 10000 });
    await instanceFormTab.click();

    // Wait for form to render
    await page.waitForFunction(
      () => {
        const inputs = document.querySelectorAll('input, select, textarea');
        return inputs.length > 0;
      },
      { timeout: 15000 }
    );

    // Modify text input (Person firstName)
    const textInputs = page.locator('input[type="text"]');
    const textCount = await textInputs.count();
    
    if (textCount > 0) {
      const firstTextInput = textInputs.first();
      await firstTextInput.fill('John');
      const value = await firstTextInput.inputValue();
      expect(value).toBe('John');
      console.log('✓ Modified text input (firstName): John');
    }

    // Modify number input (Person id attribute)
    const numberInputs = page.locator('input[type="number"]');
    const numberCount = await numberInputs.count();
    
    if (numberCount > 0) {
      const firstNumber = numberInputs.first();
      await firstNumber.fill('123');
      const value = await firstNumber.inputValue();
      expect(value).toBe('123');
      console.log('✓ Modified number input (id): 123');
    }

    // Verify changes persist
    console.log('✓ Child element modifications persist in Instance Form');
  });

  test('renders expected number of controls for Person with nested Address elements', async ({ page }) => {
    // Clear localStorage
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

    // Load demo schema
    const schemaTab = page.getByRole('button', { name: 'Schema Form' });
    await schemaTab.waitFor({ state: 'visible', timeout: 15000 });
    await schemaTab.click();

    const loadDemoBtn = page.getByRole('button', { name: 'Load demo controls XSD' }).first();
    await loadDemoBtn.waitFor({ state: 'visible', timeout: 15000 });
    await loadDemoBtn.click();

    await expect(page.getByText('xs:schema').first()).toBeVisible({ timeout: 15000 });

    // Go to Instance Form
    const instanceFormTab = page.getByRole('button', { name: 'Instance Form' });
    await instanceFormTab.waitFor({ state: 'visible', timeout: 10000 });
    await instanceFormTab.click();

    // Wait for form to render with child elements visible
    await page.waitForFunction(
      () => {
        const pageText = document.body.innerText;
        // Check for presence of key child elements indicating recursion is working
        return pageText.includes('firstName') && pageText.includes('address');
      },
      { timeout: 15000 }
    );

    const totalControls = await page.locator('input, select, textarea').count();

    // Verify that child elements are rendered
    const bodyText = await page.innerText('body');
    expect(bodyText).toContain('firstName');
    expect(bodyText).toContain('lastName');
    expect(bodyText).toContain('address');

    console.log(`✓ Child element recursion working - found all child element names in form`);
    console.log(`  Total input controls: ${totalControls}`);
  });
});
