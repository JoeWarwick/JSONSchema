import { expect, test, type Page } from '@playwright/test';

test.use({ headless: true, viewport: { width: 1280, height: 900 } });

async function fileCommand(page: Page, command: string) {
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: command, exact: true }).click();
}

test('saves to a real browser file handle, restores it and protects external changes', async ({ page }) => {
  // Use an isolated origin-private file to exercise real writes and IndexedDB handle cloning without an OS picker.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async () => {
        const root = await navigator.storage.getDirectory();
        return root.getFileHandle('local-save-test.workbench.json', { create: true });
      },
    });
  });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Paste your JSON here...' }).fill('{"saved":1}');
  await fileCommand(page, 'Save Workbench...');
  await page.getByRole('button', { name: 'Save File...', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /JSON 1/ })).not.toContainText('*');
  const text = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    return (await (await root.getFileHandle('local-save-test.workbench.json')).getFile()).text();
  });
  expect(JSON.parse(text).workbench.entries['schema-sculptor-instance-json']).toBe('{"saved":1}');
  expect(text).not.toContain('"handle"');

  await page.reload();
  await page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true, value: () => { throw new Error('Save must reuse the restored destination.'); },
    });
  });
  await page.getByRole('textbox', { name: 'Paste your JSON here...' }).fill('{"saved":2}');
  await fileCommand(page, 'Save Workbench...');
  await expect(page.getByRole('tab', { name: /JSON 1/ })).not.toContainText('*');
  expect(await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    return (await (await root.getFileHandle('local-save-test.workbench.json')).getFile()).text();
  })).toContain('{\\"saved\\":2}');

  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const file = await root.getFileHandle('local-save-test.workbench.json');
    const writer = await file.createWritable();
    await writer.write('External changes');
    await writer.close();
  });
  await page.getByRole('textbox', { name: 'Paste your JSON here...' }).fill('{"saved":3}');
  await fileCommand(page, 'Save Workbench...');
  await expect(page.getByRole('alert')).toContainText('changed outside this app');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('Filename')).toHaveValue('local-save-test.workbench.json');
});

test('download fallback is explicit and never marks a dirty workbench as saved', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
  });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Paste your JSON here...' }).fill('{"download":true}');
  await fileCommand(page, 'Save Workbench...');
  await expect(page.getByRole('dialog')).toContainText('cannot write directly');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Copy', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('JSON 1.workbench.json');
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Download requested, not confirmed');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('tab', { name: /JSON 1/ })).toContainText('*');
  await page.getByRole('button', { name: 'Close JSON 1', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('changes that have not been saved');
});
