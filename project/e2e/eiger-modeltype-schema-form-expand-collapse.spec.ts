import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test.describe('Schema Form EigerModelType expand/collapse', () => {
  test('expands and collapses nested XML schema nodes', async ({ page }) => {
    const fixturePath = path.resolve(process.cwd(), 'public/schemas/EigerModelType.xsd');
    const eigerSchema = fs.readFileSync(fixturePath, 'utf-8');

    await page.context().addInitScript(() => {
      try {
        localStorage.clear();
        localStorage.setItem('schema-sculptor-markup-language', 'xml');
        localStorage.setItem('schema-sculptor-schema-xml', '');
        localStorage.setItem('schema-sculptor-instance-xml', '');
      } catch {
        // ignore localStorage failures in constrained browser contexts
      }
    });

    await page.goto(BASE);

    const schemaInputTab = page.getByRole('button', { name: 'Schema Input' });
    await schemaInputTab.waitFor({ state: 'visible', timeout: 15000 });
    await schemaInputTab.click();

    const schemaTextarea = page.locator('textarea').first();
    await expect(schemaTextarea).toBeVisible({ timeout: 15000 });
    await schemaTextarea.fill(eigerSchema);

    const schemaFormTab = page.getByRole('button', { name: 'Schema Form' });
    await schemaFormTab.waitFor({ state: 'visible', timeout: 15000 });
    await schemaFormTab.click();

    const rootTag = page.locator('[data-testid="xml-tag-xs_schema"]').first();
    await expect(rootTag).toBeVisible({ timeout: 20000 });

    const rootChildElement = page.locator('[data-testid="xml-tag-xs_element"]').first();
    await expect(rootChildElement).toBeVisible({ timeout: 15000 });

    const upgradeStepInput = page.locator('input[value="UpgradeStep"]');
    await expect(upgradeStepInput.first()).toBeVisible({ timeout: 15000 });

    const fromVersionInput = page.locator('input[value="from-version"]');
    await expect(fromVersionInput.first()).toBeVisible({ timeout: 15000 });

    const toggleNodeSelectors = [
      '[data-testid="xml-tag-xs_complexType"]',
      '[data-testid="xml-tag-xs_element"]',
      '[data-testid="xml-tag-xs_schema"]',
    ];

    const clickUntilFromVersion = async (shouldBeVisible: boolean) => {
      for (const selector of toggleNodeSelectors) {
        const toggle = page.locator(selector).first().locator('xpath=preceding-sibling::button[1]');
        if ((await toggle.count()) === 0) continue;
        await toggle.click();
        await page.waitForTimeout(100);
        const currentlyVisible = (await fromVersionInput.count()) > 0;
        if (currentlyVisible === shouldBeVisible) return;
      }
      throw new Error(`Could not toggle from-version visibility to ${shouldBeVisible}`);
    };

    await clickUntilFromVersion(false);
    await expect(fromVersionInput).toHaveCount(0, { timeout: 15000 });
  });
});
