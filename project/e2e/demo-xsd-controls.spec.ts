import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test('loads demo controls XSD and renders inferred XML schema controls', async ({ page }) => {
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

  const schemaTab = page.getByRole('button', { name: 'Schema Form' });
  await schemaTab.waitFor({ state: 'visible', timeout: 15000 });
  await schemaTab.click();

  const loadDemoBtn = page.getByRole('button', { name: 'Load demo controls XSD' }).first();
  await loadDemoBtn.waitFor({ state: 'visible', timeout: 15000 });
  await loadDemoBtn.click();

  await expect(page.getByText('xs:schema').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('xs:annotation').first()).toBeVisible();
  await expect(page.getByText('xs:complexType').first()).toBeVisible();
  await expect(page.getByText('xs:sequence').first()).toBeVisible();
  await expect(page.getByText('xs:choice').first()).toBeVisible();
  await expect(page.getByText('xs:all').first()).toBeVisible();
  await expect(page.getByText('xs:attribute').first()).toBeVisible();
  await expect(page.getByText('xs:element').first()).toBeVisible();

  // RHS-style editors should appear for schema-derived nodes inside the XML form.
  await expect(page.getByText('Schema Editor').first()).toBeVisible();
  await expect(page.getByText('xs:import Declarations').first()).toBeVisible();
  await expect(page.locator('input[value="external-types.xsd"]').first()).toBeVisible();
  await expect(page.getByText('SimpleType Editor').first()).toBeVisible();
  await expect(page.getByText('ComplexType Editor').first()).toBeVisible();
});
