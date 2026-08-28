import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test('keeps XML Input and Instance Form in sync both directions', async ({ page }) => {
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

  const schemaFormTab = page.getByRole('button', { name: 'Schema Form' });
  await schemaFormTab.click();
  const loadDemoBtn = page.getByRole('button', { name: 'Load demo controls XSD' }).first();
  await loadDemoBtn.click();
  await expect(page.getByText('xs:schema').first()).toBeVisible({ timeout: 15000 });

  const xmlInputTab = page.getByRole('button', { name: 'XML Input' });
  await xmlInputTab.click();

  const xmlText = `<?xml version="1.0" encoding="UTF-8"?>
<person xmlns="http://example.com/demo" id="0" active="true" favoriteColor="string">
  <firstName>John</firstName>
  <lastName>Doe</lastName>
  <birthDate>2026-07-22</birthDate>
  <workEmail>qa@example.com</workEmail>
  <address>
    <street>One</street>
    <city>Two</city>
    <country>Three</country>
    <postalCode>44444</postalCode>
  </address>
</person>`;

  const xmlTextarea = page.locator('textarea').first();
  await xmlTextarea.fill(xmlText);

  const instanceFormTab = page.getByRole('button', { name: 'Instance Form' });
  await instanceFormTab.click();
  await expect(page.getByText('firstName:').first()).toBeVisible({ timeout: 10000 });

  const textInputs = page.locator('input[type="text"]');
  await expect(textInputs.first()).toHaveValue('John');

  const choiceSelect = page
    .locator('select')
    .filter({ has: page.locator('option:has-text("workEmail:")') })
    .first();
  await expect(choiceSelect).toBeVisible();
  await expect(choiceSelect).toHaveValue('workEmail');

  // Instance Form -> XML Input
  await textInputs.first().fill('Jane');
  await page.waitForTimeout(200);

  await xmlInputTab.click();
  const xmlAfterFormEdit = await xmlTextarea.inputValue();
  expect(xmlAfterFormEdit).toContain('<firstName>');
  expect(xmlAfterFormEdit).toContain('Jane');

  // XML Input -> Instance Form
  const xmlUpdated = xmlText
    .replace('<firstName>John</firstName>', '<firstName>Jane</firstName>')
    .replace('<lastName>Doe</lastName>', '<lastName>Smith</lastName>');
  await xmlTextarea.fill(xmlUpdated);

  await instanceFormTab.click();
  await expect(page.getByText('lastName:').first()).toBeVisible();
  await expect(page.locator('input[type="text"]').nth(1)).toHaveValue('Smith');
});
