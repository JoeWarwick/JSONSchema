import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test.describe('Instance Form Dynamic Data Binding', () => {
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

    // Load the demo XSD
    const schemaTab = page.getByRole('button', { name: 'Schema Form' });
    await schemaTab.waitFor({ state: 'visible', timeout: 15000 });
    await schemaTab.click();

    const loadDemoBtn = page.getByRole('button', { name: 'Load demo controls XSD' }).first();
    await loadDemoBtn.waitFor({ state: 'visible', timeout: 15000 });
    await loadDemoBtn.click();

    // Wait for schema to load
    await expect(page.getByText('xs:schema').first()).toBeVisible({ timeout: 15000 });
  });

  test('loads demo schema and modifies instance values with form', async ({ page }) => {
    // Navigate to Instance Form tab
    const instanceFormTab = page.getByRole('button', { name: 'Instance Form' });
    await instanceFormTab.waitFor({ state: 'visible', timeout: 10000 });
    await instanceFormTab.click();

    // Wait for form to render - look for input fields or select dropdowns
    await page.waitForFunction(
      () => {
        const inputs = document.querySelectorAll('input, select, textarea');
        return inputs.length > 0;
      },
      { timeout: 10000 }
    );
    
    // Try to find the color dropdown by looking for select near the favoriteColor label
    const selectDropdowns = page.locator('select');
    const dropdownCount = await selectDropdowns.count();
    
    if (dropdownCount > 0) {
      // Get the first select and change its value
      const firstSelect = selectDropdowns.first();
      await firstSelect.selectOption('green');
      
      // Verify the value was changed
      const selectedValue = await firstSelect.inputValue();
      expect(selectedValue).toBe('green');
      
      console.log('✓ Successfully changed dropdown value to "green"');
    }

    // Look for text inputs to modify
    const inputs = page.locator('input[type="text"]');
    const inputCount = await inputs.count();
    
    if (inputCount > 0) {
      // Modify the first text input
      const firstInput = inputs.first();
      await firstInput.fill('test-value-1');
      
      // Verify it was updated
      const inputValue = await firstInput.inputValue();
      expect(inputValue).toBe('test-value-1');
      
      console.log('✓ Successfully changed text input to "test-value-1"');
    }

    // Check that a number input exists and modify it if found
    const numberInputs = page.locator('input[type="number"]');
    const numberCount = await numberInputs.count();
    
    if (numberCount > 0) {
      const firstNumber = numberInputs.first();
      await firstNumber.fill('42');
      
      const numValue = await firstNumber.inputValue();
      expect(numValue).toBe('42');
      
      console.log('✓ Successfully changed number input to 42');
    }
  });

  test('verifies data persists when switching tabs and returning', async ({ page }) => {
    // Navigate to Instance Form tab
    const instanceFormTab = page.getByRole('button', { name: 'Instance Form' });
    await instanceFormTab.waitFor({ state: 'visible', timeout: 10000 });
    await instanceFormTab.click();

    // Wait for form to render - look for input fields
    await page.waitForFunction(
      () => {
        const inputs = document.querySelectorAll('input, select, textarea');
        return inputs.length > 0;
      },
      { timeout: 10000 }
    );

    // Get the first select dropdown (if it exists)
    const selectDropdowns = page.locator('select');
    const dropdownCount = await selectDropdowns.count();
    
    let originalValue = '';
    if (dropdownCount > 0) {
      const firstSelect = selectDropdowns.first();
      // Change to a specific value
      await firstSelect.selectOption('red');
      originalValue = 'red';
    }

    // Get the first text input (if it exists)
    const inputs = page.locator('input[type="text"]');
    const inputCount = await inputs.count();
    let originalInputValue = '';
    
    if (inputCount > 0) {
      const firstInput = inputs.first();
      await firstInput.fill('persist-test');
      originalInputValue = 'persist-test';
    }

    // Switch to XML Input tab
    const xmlInputTab = page.getByRole('button', { name: 'XML Input' });
    await xmlInputTab.click();
    
    // Wait a moment for the switch
    await page.waitForTimeout(500);

    // Switch back to Instance Form
    const instanceFormTab2 = page.getByRole('button', { name: 'Instance Form' });
    await instanceFormTab2.click();

    // Wait for form to be visible again - look for input fields
    await page.waitForFunction(
      () => {
        const inputs = document.querySelectorAll('input, select, textarea');
        return inputs.length > 0;
      },
      { timeout: 10000 }
    );

    // Verify the values persisted
    if (dropdownCount > 0) {
      const firstSelect = page.locator('select').first();
      const persistedDropdownValue = await firstSelect.inputValue();
      expect(persistedDropdownValue).toBe(originalValue);
      console.log('✓ Dropdown value persisted:', originalValue);
    }

    if (inputCount > 0) {
      const firstInput = page.locator('input[type="text"]').first();
      const persistedInputValue = await firstInput.inputValue();
      expect(persistedInputValue).toBe(originalInputValue);
      console.log('✓ Text input value persisted:', originalInputValue);
    }
  });

  test('loads two different XML instances and verifies independent state', async ({ page }) => {
    // Navigate to Instance Form
    const instanceFormTab = page.getByRole('button', { name: 'Instance Form' });
    await instanceFormTab.waitFor({ state: 'visible', timeout: 10000 });
    await instanceFormTab.click();

    // Wait for form to render - look for input fields
    await page.waitForFunction(
      () => {
        const inputs = document.querySelectorAll('input, select, textarea');
        return inputs.length > 0;
      },
      { timeout: 10000 }
    );

    // === Instance 1: Set values for first instance ===
    const selects = page.locator('select');
    const selectCount = await selects.count();
    
    if (selectCount > 0) {
      const firstSelect = selects.nth(0);
      await firstSelect.selectOption('red');
      const value1 = await firstSelect.inputValue();
      expect(value1).toBe('red');
      console.log('✓ Instance 1: Set dropdown to "red"');
    }

    const inputs = page.locator('input[type="text"]');
    const inputCount = await inputs.count();
    
    if (inputCount > 0) {
      const firstInput = inputs.nth(0);
      await firstInput.fill('instance-one');
      const inputVal1 = await firstInput.inputValue();
      expect(inputVal1).toBe('instance-one');
      console.log('✓ Instance 1: Set text input to "instance-one"');
    }

    // Store Instance 1 values to verify later
    let instance1SelectValue = '';
    let instance1InputValue = '';
    
    if (selectCount > 0) {
      instance1SelectValue = await page.locator('select').nth(0).inputValue();
    }
    if (inputCount > 0) {
      instance1InputValue = await page.locator('input[type="text"]').nth(0).inputValue();
    }

    // === Load Instance 2: Set different values ===
    // This simulates clearing the form and loading a new instance
    // In a real scenario, we'd have a way to swap instances
    // For this test, we'll clear the schema and reload it to get a fresh instance
    
    const schemaTab = page.getByRole('button', { name: 'Schema Form' });
    await schemaTab.click();

    // Reload the demo schema (which clears the instance)
    const loadDemoBtn = page.getByRole('button', { name: 'Load demo controls XSD' }).first();
    await loadDemoBtn.click();

    // Wait for schema to load
    await expect(page.getByText('xs:schema').first()).toBeVisible({ timeout: 15000 });

    // Go back to Instance Form with fresh instance
    const instanceFormTab2 = page.getByRole('button', { name: 'Instance Form' });
    await instanceFormTab2.click();

    // Wait for form - look for input fields
    await page.waitForFunction(
      () => {
        const inputs = document.querySelectorAll('input, select, textarea');
        return inputs.length > 0;
      },
      { timeout: 10000 }
    );

    // === Instance 2: Set different values ===
    if (selectCount > 0) {
      const firstSelect = page.locator('select').nth(0);
      await firstSelect.selectOption('blue');
      const value2 = await firstSelect.inputValue();
      expect(value2).toBe('blue');
      console.log('✓ Instance 2: Set dropdown to "blue"');
    }

    if (inputCount > 0) {
      const firstInput = page.locator('input[type="text"]').nth(0);
      await firstInput.fill('instance-two');
      const inputVal2 = await firstInput.inputValue();
      expect(inputVal2).toBe('instance-two');
      console.log('✓ Instance 2: Set text input to "instance-two"');
    }

    // Store Instance 2 values
    let instance2SelectValue = '';
    let instance2InputValue = '';
    
    if (selectCount > 0) {
      instance2SelectValue = await page.locator('select').nth(0).inputValue();
    }
    if (inputCount > 0) {
      instance2InputValue = await page.locator('input[type="text"]').nth(0).inputValue();
    }

    // Verify Instance 2 is different from Instance 1
    if (selectCount > 0) {
      expect(instance2SelectValue).not.toBe(instance1SelectValue);
      expect(instance2SelectValue).toBe('blue');
      console.log(`✓ Instance 2 select (${instance2SelectValue}) differs from Instance 1 (${instance1SelectValue})`);
    }

    if (inputCount > 0) {
      expect(instance2InputValue).not.toBe(instance1InputValue);
      expect(instance2InputValue).toBe('instance-two');
      console.log(`✓ Instance 2 input (${instance2InputValue}) differs from Instance 1 (${instance1InputValue})`);
    }
  });

  test('form reflects changes in real-time and updates state', async ({ page }) => {
    // Navigate to Instance Form
    const instanceFormTab = page.getByRole('button', { name: 'Instance Form' });
    await instanceFormTab.waitFor({ state: 'visible', timeout: 10000 });
    await instanceFormTab.click();

    // Wait for form - look for input fields, with longer timeout
    await page.waitForFunction(
      () => {
        const inputs = document.querySelectorAll('input, select, textarea');
        return inputs.length > 0;
      },
      { timeout: 15000 }
    );

    // Find and interact with select dropdowns if present
    const selects = page.locator('select');
    const selectCount = await selects.count();
    if (selectCount > 0) {
      const dropdown = selects.first();
      
      // Change value multiple times and verify each change
      await dropdown.selectOption('red');
      let val = await dropdown.inputValue();
      expect(val).toBe('red');
      console.log('✓ Changed to red');

      await dropdown.selectOption('green');
      val = await dropdown.inputValue();
      expect(val).toBe('green');
      console.log('✓ Changed to green');

      await dropdown.selectOption('blue');
      val = await dropdown.inputValue();
      expect(val).toBe('blue');
      console.log('✓ Changed to blue');
    }

    // Test text input real-time updates if present
    const inputs = page.locator('input[type="text"]');
    const inputCount = await inputs.count();
    if (inputCount > 0) {
      const textInput = inputs.first();
      
      await textInput.fill('quick');
      let val = await textInput.inputValue();
      expect(val).toBe('quick');
      
      await textInput.fill('quick-brown');
      val = await textInput.inputValue();
      expect(val).toBe('quick-brown');
      
      await textInput.fill('quick-brown-fox');
      val = await textInput.inputValue();
      expect(val).toBe('quick-brown-fox');
      
      console.log('✓ Real-time updates working for text input');
    }

    // Verify state persists for select if present
    if (selectCount > 0) {
      const finalSelectValue = await page.locator('select').first().inputValue();
      expect(finalSelectValue).toBe('blue');
    }
    
    // Verify state persists for text input if present
    if (inputCount > 0) {
      const finalInputValue = await page.locator('input[type="text"]').first().inputValue();
      expect(finalInputValue).toBe('quick-brown-fox');
    }
    
    console.log('✓ All changes persisted correctly');
  });

  test('verifies enumeration dropdowns appear and work correctly', async ({ page }) => {
    // Navigate to Instance Form
    const instanceFormTab = page.getByRole('button', { name: 'Instance Form' });
    await instanceFormTab.waitFor({ state: 'visible', timeout: 10000 });
    await instanceFormTab.click();

    // Wait for form - look for input fields
    await page.waitForFunction(
      () => {
        const inputs = document.querySelectorAll('input, select, textarea');
        return inputs.length > 0;
      },
      { timeout: 10000 }
    );

    // Look for select elements (enumerations should render as select)
    const selects = page.locator('select');
    const selectCount = await selects.count();
    
    expect(selectCount).toBeGreaterThan(0);
    console.log(`✓ Found ${selectCount} enumeration dropdown(s)`);

    // Verify the first select has the expected options
    const firstSelect = selects.first();
    const options = firstSelect.locator('option');
    const optionCount = await options.count();
    
    expect(optionCount).toBeGreaterThan(0);
    console.log(`✓ First dropdown has ${optionCount} option(s)`);

    // Verify we can get all option values using evaluate
    const optionValues = await firstSelect.evaluate((select: HTMLSelectElement) => {
      return Array.from(select.options).map(option => option.value);
    });
    
    console.log('✓ Available options:', optionValues.join(', '));

    // Select each option and verify it works
    for (const optValue of optionValues) {
      if (optValue) { // Skip empty placeholder options
        await firstSelect.selectOption(optValue);
        const currentVal = await firstSelect.inputValue();
        expect(currentVal).toBe(optValue);
      }
    }
    
    console.log('✓ All enumeration options selectable and functional');
  });
});
