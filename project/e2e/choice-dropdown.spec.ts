import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test('renders choice dropdown in Instance Form for homeEmail | workEmail', async ({ page }) => {
  const allLogs: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    allLogs.push(text);
  });

  // Setup localStorage
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

  // Switch to Schema Form tab first
  const schemaFormTab = page.getByRole('button', { name: 'Schema Form' });
  await schemaFormTab.waitFor({ state: 'visible', timeout: 10000 });
  await schemaFormTab.click();

  // Wait a moment for the tab to switch
  await page.waitForTimeout(500);

  // Click Load demo controls XSD button
  const loadDemoBtn = page.getByRole('button', { name: 'Load demo controls XSD' }).first();
  await loadDemoBtn.waitFor({ state: 'visible', timeout: 10000 });
  await loadDemoBtn.click();

  // Wait for any schema element to appear
  await expect(page.getByText('xs:schema').first()).toBeVisible({ timeout: 15000 });

  // Switch to Instance Form tab
  const instanceFormTab = page.getByRole('button', { name: 'Instance Form' });
  await instanceFormTab.waitFor({ state: 'visible', timeout: 10000 });
  await instanceFormTab.click();

  // Wait for form to load - look for firstName which should always be there
  await expect(page.getByText('firstName:').first()).toBeVisible({ timeout: 10000 });

  // Give browser time to log debug info
  await page.waitForTimeout(1000);

  // Print debug logs
  console.log('\n=== SCHEMA/CHOICE LOGS ===');
  for (const log of allLogs) {
    if (log.includes('SchemaCompiler') || log.includes('ChoiceDetection') || log.includes('resolveType') || log.includes('About')) {
      console.log(log);
    }
  }
  console.log('=== END LOGS ===\n');

  // Look for the choice dropdown - should have options for homeEmail and workEmail
  // The dropdown is now rendered at the element position instead of with a "Choose" label
  const choiceSelects = page.locator('select');
  const selectCount = await choiceSelects.count();
  
  console.log(`Found ${selectCount} select elements`);
  
  // Check if any select has options for homeEmail and workEmail
  let foundChoice = false;
  for (let i = 0; i < selectCount; i++) {
    const options = await choiceSelects.nth(i).locator('option').allTextContents();
    const normalized = options.map((o) => o.replace(/:$/, '').trim());
    if (normalized.includes('homeEmail') && normalized.includes('workEmail')) {
      foundChoice = true;
      console.log('✓ Found choice dropdown with homeEmail and workEmail options!');
      break;
    }
  }
  
  if (!foundChoice) {
    console.log('Choice dropdown not found');
    
    // Log all select options for debugging
    for (let i = 0; i < selectCount; i++) {
      const options = await choiceSelects.nth(i).locator('option').allTextContents();
      console.log(`Select ${i} options: ${options.join(', ')}`);
    }
    
    throw new Error(`Choice dropdown not found`);
  }

  // Ensure workEmail stays selected after editing a different element field.
  // This guards against regressions where choice state is recomputed from the wrong level.
  const xmlInputTab = page.getByRole('button', { name: 'XML Input' });
  await xmlInputTab.click();
  const xmlTextarea = page.locator('textarea').first();
  await xmlTextarea.fill(`<?xml version="1.0" encoding="UTF-8"?>
<person xmlns="http://example.com/demo" id="0" active="true" favoriteColor="string">
  <firstName>string</firstName>
  <lastName>string</lastName>
  <birthDate>2026-07-22</birthDate>
  <workEmail>qa@example.com</workEmail>
  <address>
    <street>string</street>
    <city>string</city>
    <country>string</country>
    <postalCode>string</postalCode>
  </address>
</person>`);

  await instanceFormTab.click();
  await expect(page.getByText('firstName:').first()).toBeVisible({ timeout: 10000 });

  const firstNameInput = page.locator('input[type="text"]').first();
  await firstNameInput.fill('edited-first-name');
  await page.waitForTimeout(250);

  const choiceSelect = page
    .locator('select')
    .filter({ has: page.locator('option:has-text("workEmail:")') })
    .first();
  await expect(choiceSelect).toBeVisible();
  await expect(choiceSelect).toHaveValue('workEmail');

  const workEmailInput = page.locator('input[value="qa@example.com"]').first();
  await expect(workEmailInput).toBeVisible();
});

test('schema form preserves generated @name when switching xs:element to xs:attribute and back', async ({ page }) => {
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

  const schemaInputTab = page.getByRole('button', { name: 'Schema Input' });
  await schemaInputTab.click();

  const schemaTextarea = page.locator('textarea').first();
  await schemaTextarea.fill(`<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="person" type="xs:string"/>
</xs:schema>`);

  const schemaFormTab = page.getByRole('button', { name: 'Schema Form' });
  await schemaFormTab.click();
  await expect(page.getByText('xs:schema').first()).toBeVisible({ timeout: 15000 });

  const choiceSelect = page
    .locator('select')
    .filter({ has: page.locator('option[value="xs:attribute"]') })
    .first();

  await expect(choiceSelect).toBeVisible({ timeout: 15000 });
  await expect(choiceSelect).toHaveValue('xs:element');

  await choiceSelect.selectOption('xs:attribute');
  await expect(choiceSelect).toHaveValue('xs:attribute');
  await expect(page.locator('[data-testid="xml-name-chip"]').filter({ hasText: 'person' }).first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Remove xs:attribute' })).toBeVisible();

  await choiceSelect.selectOption('xs:element');
  await expect(choiceSelect).toHaveValue('xs:element');
  await expect(page.locator('[data-testid="xml-name-chip"]').filter({ hasText: 'person' }).first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Remove xs:element' })).toBeVisible();
});

test('demo schema form switches the same repeating choice row back to xs:element', async ({ page }) => {
  await page.context().addInitScript(() => {
    localStorage.setItem('schema-sculptor-markup-language', 'xml');
    localStorage.setItem('schema-sculptor-schema-xml', '');
    localStorage.setItem('schema-sculptor-instance-xml', '');
  });

  await page.goto(BASE);
  await page.getByRole('button', { name: 'Schema Form' }).click();
  await page.getByRole('button', { name: 'Load demo controls XSD' }).first().click();
  await expect(page.getByText('xs:schema').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Add xs:annotation' })).toHaveCount(1);

  const choiceSelects = page.locator('select').filter({
    has: page.locator('option[value="xs:attribute"]'),
  });
  await expect(choiceSelects.first()).toBeVisible({ timeout: 15000 });

  const rowIndex = 0;
  const row = choiceSelects.nth(rowIndex);
  const initialValue = await row.inputValue();
  expect(initialValue).toBe('xs:element');
  const personOrderIndex = await page.evaluate(() => {
    const raw = localStorage.getItem('schema-sculptor-schema-xml');
    const source = raw ? JSON.parse(raw) : null;
    return (source?.['xs:schema']?.__childrenInOrder || []).findIndex(
      (entry: { tagName?: string; value?: { '@attributes'?: { name?: string } } }) =>
        entry.value?.['@attributes']?.name === 'person',
    );
  });
  expect(personOrderIndex).toBeGreaterThanOrEqual(0);

  await row.selectOption('xs:attribute');
  await expect.poll(async () => page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('select'))
      .filter((select) => Array.from(select.options).some((option) => option.value === 'xs:attribute'));
    return selects.findIndex((select) => (select as HTMLSelectElement).value === 'xs:attribute');
  })).toBeGreaterThanOrEqual(0);
  const attributeIndex = await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('select'))
      .filter((select) => Array.from(select.options).some((option) => option.value === 'xs:attribute'));
    return selects.findIndex((select) => (select as HTMLSelectElement).value === 'xs:attribute');
  });

  const switchedRow = choiceSelects.nth(attributeIndex);
  await expect(switchedRow).toHaveValue('xs:attribute');
  await switchedRow.selectOption('xs:element');
  await expect.poll(async () => page.evaluate((index) => {
    const raw = localStorage.getItem('schema-sculptor-schema-xml');
    const source = raw ? JSON.parse(raw) : null;
    return source?.['xs:schema']?.__childrenInOrder?.[index]?.tagName;
  }, personOrderIndex)).toBe('xs:element');
  await expect(page.getByRole('button', { name: 'Remove xs:annotation 2', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove xs:annotation', exact: true })).toHaveCount(1);
});

test('auto-renders required missing choice', async ({ page }) => {
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

  // Use the real demo schema where homeEmail/workEmail choice is required.
  const schemaFormTab = page.getByRole('button', { name: 'Schema Form' });
  await schemaFormTab.waitFor({ state: 'visible', timeout: 10000 });
  await schemaFormTab.click();

  const loadDemoBtn = page.getByRole('button', { name: 'Load demo controls XSD' }).first();
  await loadDemoBtn.waitFor({ state: 'visible', timeout: 10000 });
  await loadDemoBtn.click();
  await expect(page.getByText('xs:schema').first()).toBeVisible({ timeout: 15000 });

  const xmlInputTab = page.getByRole('button', { name: 'XML Input' });
  await xmlInputTab.click();
  const xmlTextarea = page.locator('textarea').first();
  await xmlTextarea.fill(`<?xml version="1.0" encoding="UTF-8"?>
<person xmlns="http://example.com/demo" id="0" active="true" favoriteColor="string">
  <firstName>string</firstName>
  <lastName>string</lastName>
  <birthDate>2026-07-22</birthDate>
  <address>
    <street>string</street>
    <city>string</city>
    <country>string</country>
    <postalCode>string</postalCode>
  </address>
</person>`);

  const instanceFormTab = page.getByRole('button', { name: 'Instance Form' });
  await instanceFormTab.click();
  await expect(page.getByText('firstName:').first()).toBeVisible({ timeout: 10000 });

  // Required choice should auto-render even if missing in instance.
  const allSelects = page.locator('select');
  const selectCount = await allSelects.count();
  let foundRequiredChoice = false;
  for (let i = 0; i < selectCount; i++) {
    const options = await allSelects.nth(i).locator('option').allTextContents();
    const normalized = options.map((o) => o.replace(/:$/, '').trim());
    if (normalized.includes('homeEmail') && normalized.includes('workEmail')) {
      foundRequiredChoice = true;
      break;
    }
  }
  expect(foundRequiredChoice).toBeTruthy();
});

test('does not auto-render optional missing choice', async ({ page }) => {
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

  const schemaInputTab = page.getByRole('button', { name: 'Schema Input' });
  await schemaInputTab.click();
  const schemaTextarea = page.locator('textarea').first();
  await schemaTextarea.fill(`<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="root" type="RootType"/>
  <xs:complexType name="RootType">
    <xs:sequence>
      <xs:choice minOccurs="0">
        <xs:element name="optionalA" type="xs:string"/>
        <xs:element name="optionalB" type="xs:string"/>
      </xs:choice>
    </xs:sequence>
  </xs:complexType>
</xs:schema>`);

  const xmlInputTab = page.getByRole('button', { name: 'XML Input' });
  await xmlInputTab.click();
  const xmlTextarea = page.locator('textarea').first();
  await xmlTextarea.fill(`<?xml version="1.0" encoding="UTF-8"?>
<root />`);

  const instanceFormTab = page.getByRole('button', { name: 'Instance Form' });
  await instanceFormTab.click();
  await expect(page.getByText('root').first()).toBeVisible({ timeout: 10000 });

  const rootToggle = page.locator('[data-testid="xml-tag-root"]').locator('xpath=preceding-sibling::button').first();
  await rootToggle.click();
  await page.waitForTimeout(200);

  const allSelects = page.locator('select');
  const selectCount = await allSelects.count();
  let foundOptionalChoice = false;
  for (let i = 0; i < selectCount; i++) {
    const options = await allSelects.nth(i).locator('option').allTextContents();
    const normalized = options.map((o) => o.replace(/:$/, '').trim());
    if (normalized.includes('optionalA') && normalized.includes('optionalB')) {
      foundOptionalChoice = true;
      break;
    }
  }
  expect(foundOptionalChoice).toBeFalsy();
});
