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
