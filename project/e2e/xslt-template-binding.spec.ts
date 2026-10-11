import { expect, test } from '@playwright/test';
import path from 'node:path';

test('adding xsl:template binds its schema-driven child controls', async ({ page }) => {
  await page.context().addInitScript(() => {
    localStorage.setItem('schema-sculptor-markup-language', 'xml');
    localStorage.removeItem('schema-sculptor-schema-xml');
    localStorage.removeItem('schema-sculptor-instance-xml');
  });

  await page.goto(process.env.BASE_URL || 'http://localhost:5173');

  const schemaFileInput = page.locator('input[type="file"]').nth(1);
  await schemaFileInput.setInputFiles(
    path.resolve(process.cwd(), 'public/schemas/schema-for-xslt20.xsd'),
  );
  await expect(page.getByRole('button', { name: 'Instance Form' })).toBeVisible();

  await page.getByRole('button', { name: 'XML Input' }).click();
  await page.locator('textarea').fill(
    '<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="2.0"/>',
  );

  await page.getByRole('button', { name: 'Instance Form' }).click();
  const stylesheetLabel = page.getByTestId('xml-tag-xsl_stylesheet');
  await expect(stylesheetLabel).toBeVisible();
  await stylesheetLabel.locator('xpath=..').locator('button').first().click();

  const addTemplate = page.locator('button[title^="Add xsl:template"]');
  await expect(addTemplate).toBeVisible();
  await addTemplate.click();

  await expect(page.getByRole('button', { name: 'Add xsl:apply-templates' })).toBeVisible();
  await expect(page.locator('button[title="Add match attribute"]')).toBeVisible();

  await page.getByRole('button', { name: 'XML Input' }).click();
  await expect(page.locator('textarea')).toHaveValue(/<xsl:template(?:\s|\/?>)/);
});
