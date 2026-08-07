import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test('loads bundled XMLSchema.generated.json and displays xs:schema and xs:element nodes', async ({ page }) => {
  // Preload the generated JSON schema into localStorage so the app boots with it
  const genFile = path.resolve(process.cwd(), 'public/schemas/XMLSchema.generated.json');
  let body = '{}';
  try { body = fs.readFileSync(genFile, 'utf8'); } catch (e) { /* ignore */ }

  await page.context().addInitScript((s) => {
    try {
      // Ensure app initializes in XML mode so it reads the xml-specific schema key
      localStorage.setItem('schema-sculptor-markup-language', 'xml');
      localStorage.setItem('schema-sculptor-schema-xml', s);
      localStorage.setItem('schema-sculptor-instance-xml', '');
      // Enable dark-mode class early so the app loads in dark theme
      try { document.documentElement.classList.add('dark-mode'); } catch (e) {}
    } catch (e) {
      /* ignore */
    }
  }, body);

  await page.goto(BASE);

  // Open Schema Form tab
  const schemaTab = page.getByRole('button', { name: 'Schema Form' });
  await schemaTab.waitFor({ state: 'visible', timeout: 15000 });
  await schemaTab.click();

  // Wait for the XmlInstanceForm to render a top-level xs:schema label
  await page.waitForSelector('text=xs:schema', { timeout: 15000 });
  const schemaLabel = page.getByText('xs:schema').first();
  await expect(schemaLabel).toBeVisible();

  // Attempt to expand the node and check for a child xs:element label
  try {
    const chevron = schemaLabel.locator('xpath=..').locator('button').first();
    if (await chevron.isVisible()) await chevron.click();
  } catch (e) { /* ignore */ }

  await page.waitForSelector('text=xs:element', { timeout: 15000 });
  const elemLabel = page.getByText('xs:element').first();
  await expect(elemLabel).toBeVisible();
});
