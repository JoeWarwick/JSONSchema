import { expect, test } from '@playwright/test';
import path from 'node:path';

test('adding xsl:template binds param and choose/when schema-driven controls', async ({ page }) => {
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

  const stylesheetChoice = page.getByRole('combobox', { name: 'Add child to xsl:stylesheet from choice group 1' });
  await expect(stylesheetChoice).toBeVisible();
  await stylesheetChoice.selectOption('xsl:template');
  const selectedTemplateChoice = page.locator('select').filter({
    has: page.locator('option:checked[value="xsl:template"]'),
  });
  await expect(selectedTemplateChoice).toHaveCount(1);
  await expect(selectedTemplateChoice.locator('xpath=../..')).toHaveCSS('align-items', 'flex-start');
  const templateRemoveButton = page.getByRole('button', { name: 'Remove xsl:template' });
  await expect(templateRemoveButton).toBeVisible();
  const templateRemoveBox = await templateRemoveButton.boundingBox();
  const templateSelectorBox = await selectedTemplateChoice.boundingBox();
  if (!templateRemoveBox || !templateSelectorBox) {
    throw new Error('Expected the template selector and remove button to have layout bounds');
  }
  const templateRemoveGap = templateRemoveBox.x - (templateSelectorBox.x + templateSelectorBox.width);
  expect(templateRemoveGap).toBeGreaterThanOrEqual(0);
  expect(templateRemoveGap).toBeLessThanOrEqual(8);

  const sequenceConstructorChoice = page.getByRole('combobox', { name: 'Add child to xsl:template from choice group 1' });
  await expect(sequenceConstructorChoice).toBeVisible();
  await expect(sequenceConstructorChoice).toHaveValue('');
  const templateChildTriggerRow = sequenceConstructorChoice.locator('xpath=..');
  await expect(templateChildTriggerRow).toHaveClass(/elementTriggerRow/);
  const templateChildTriggerBox = await templateChildTriggerRow.boundingBox();
  if (!templateSelectorBox || !templateChildTriggerBox) {
    throw new Error('Expected the template choice selector and child triggers to have layout bounds');
  }
  expect(Math.abs(templateChildTriggerBox.x - templateSelectorBox.x)).toBeLessThan(12);
  expect(templateChildTriggerBox.y).toBeGreaterThanOrEqual(templateSelectorBox.y + templateSelectorBox.height);
  await expect(sequenceConstructorChoice.locator('option[value="xsl:apply-templates"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Add xsl:apply-templates', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add xsl:instruction' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add xsl:declaration' })).toHaveCount(0);
  await expect(page.locator('button[title="Add match attribute"]')).toBeVisible();

  await sequenceConstructorChoice.selectOption('xsl:analyze-string');
  await expect(page.getByRole('button', { name: 'Add xsl:matching-substring' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add xsl:non-matching-substring' })).toBeVisible();
  await expect(sequenceConstructorChoice).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Add xsl:analyze-string', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Add xsl:param' }).last().click();
  const paramLabel = page.getByTestId('xml-tag-xsl_param');
  const paramRemoveButton = page.getByRole('button', { name: 'Remove xsl:param' });
  await expect(paramLabel).toBeVisible();
  await expect(paramRemoveButton).toBeVisible();
  const paramLabelBox = await paramLabel.boundingBox();
  const paramRemoveBox = await paramRemoveButton.boundingBox();
  if (!paramLabelBox || !paramRemoveBox) {
    throw new Error('Expected the parameter label and remove button to have layout bounds');
  }
  const paramRemoveGap = paramRemoveBox.x - (paramLabelBox.x + paramLabelBox.width);
  expect(paramRemoveGap).toBeGreaterThanOrEqual(0);
  expect(paramRemoveGap).toBeLessThanOrEqual(8);
  const templateChoiceLayout = selectedTemplateChoice.locator('xpath=../..');
  await expect(templateChoiceLayout).toHaveCSS('gap', '0px');
  await expect(templateChoiceLayout).toHaveCSS('margin-bottom', '0px');
  const templateHeaderRowBox = await selectedTemplateChoice.locator('xpath=..').boundingBox();
  const templateAttributeTriggerBox = await page.locator('button[title="Add match attribute"]').boundingBox();
  const paramHeader = paramLabel.locator('xpath=ancestor::div[contains(@class, "propertyHeader")][1]');
  const paramHeaderBox = await paramHeader.boundingBox();
  const paramAttributeTriggerBox = await page.locator('button[title="Add required attribute"]').boundingBox();
  if (!templateHeaderRowBox || !templateAttributeTriggerBox || !paramHeaderBox || !paramAttributeTriggerBox) {
    throw new Error('Expected template and parameter labels and attribute triggers to have layout bounds');
  }
  const templateContentGap = templateAttributeTriggerBox.y - (templateHeaderRowBox.y + templateHeaderRowBox.height);
  const paramContentGap = paramAttributeTriggerBox.y - (paramHeaderBox.y + paramHeaderBox.height);
  expect(Math.abs(templateContentGap - paramContentGap)).toBeLessThanOrEqual(4);
  const sequenceConstructorChoices = page.getByRole('combobox', { name: 'Add child to xsl:param from choice group 1' });
  await expect(sequenceConstructorChoices).toHaveCount(1);
  await expect(sequenceConstructorChoices).toHaveValue('');
  await expect(sequenceConstructorChoices.locator('option[value="xsl:variable"]')).toHaveCount(1);
  await expect(page.locator('button[title="Add required attribute"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add xsl:variable', exact: true })).toHaveCount(0);

  await sequenceConstructorChoice.selectOption('xsl:choose');
  await expect(page.getByRole('button', { name: 'Add xsl:when' }).first()).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Add child to xsl:choose from choice group 1' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add xsl:when' }).first().click();
  await expect(page.locator('button[title="Add test attribute"]')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Add child to xsl:when from choice group 1' })).toHaveCount(1);

  await page.getByRole('button', { name: 'XML Input' }).click();
  const serializedXml = page.locator('textarea');
  await expect(serializedXml).toHaveValue(
    /<xsl:template(?:\s|\/?>)[\s\S]*<xsl:param[\s\S]*<xsl:choose>[\s\S]*<xsl:when/,
  );
  await expect(serializedXml).not.toHaveValue(/<xsl:variable/);
});
