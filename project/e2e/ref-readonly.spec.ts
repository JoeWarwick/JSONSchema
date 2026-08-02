import { test, expect, type Page } from '@playwright/test';

// Increase per-test timeout for schema loading, ref expansion and editor interactions
test.setTimeout(120000);

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const AUTODB_SCHEMA_URL = `${BASE}/schemas/autodb-v2.xsd`;

// Loads public/schemas/autodb-v2.xsd via the Schema menu's "Load from URL…" dialog,
// exactly the way a user would, then waits for the graph to render.
async function loadAutodbSchemaFromUrl(page: Page) {
  await page.goto(BASE);
  await page.evaluate(() => {
    try {
      localStorage.clear();
    } catch (_) {
      // ignore
    }
  });
  await page.reload();
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => null);

  // Open the "Schema" menu in the top menubar, then click "Load from URL…"
  await page.getByRole('menuitem', { name: 'Schema', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Load from URL…' }).click();

  // Fill in the URL dialog and submit
  const urlDialog = page.getByRole('dialog').filter({ hasText: 'Load Schema from URL' });
  await urlDialog.waitFor({ state: 'visible', timeout: 10000 });
  await urlDialog.locator('input[type="url"]').fill(AUTODB_SCHEMA_URL);
  await urlDialog.getByRole('button', { name: 'Load' }).click();
  await urlDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => null);

  // Switch to the "Schema Editor" (graphical) tab
  await page.getByRole('button', { name: 'Schema Editor' }).click();

  // Wait for the graph to render
  await page.waitForSelector('.react-flow__node', { timeout: 60000 });
}

// Finds a graph node containing a child with visible text matching `label` exactly.
// Node cards also render a kind badge and an "expand" button, so we can't match on the
// full node text — instead we look for the exact-text label element and walk up to the
// enclosing `.react-flow__node` card. The global type/element definitions panel also
// renders a node per global name, so when a ref is expanded in-place its newly created
// instance is appended after those — take the *last* match to prefer the in-place instance.
function findNodeByLabel(page: Page, label: string) {
  return page
    .locator('.react-flow__node')
    .filter({ has: page.getByText(label, { exact: true }) })
    .last();
}

async function expandNode(page: Page, nodeLabel: string) {
  const node = findNodeByLabel(page, nodeLabel);
  await node.waitFor({ state: 'visible', timeout: 20000 });
  const expandButton = node.locator('button[title="Expand children"]');
  await expandButton.waitFor({ state: 'visible', timeout: 20000 });
  await expandButton.click();
}

test.describe('Ref Element Read-Only Behavior E2E (autodb-v2.xsd)', () => {
  test('datafield ref element is partially editable: only minOccurs, maxOccurs, default, fixed, and annotations are editable', async ({ page }) => {
    await loadAutodbSchemaFromUrl(page);

    // AUTOFORM -> opentable -> datafield (ref="datafield")
    await expandNode(page, 'AUTOFORM');
    await expandNode(page, 'opentable');

    const datafieldNode = findNodeByLabel(page, 'datafield');
    await datafieldNode.waitFor({ state: 'visible', timeout: 20000 });
    await datafieldNode.click();

    await page.locator('text=Element Editor').waitFor({ state: 'visible', timeout: 10000 });

    // Ref elements show a "ref" selector (not a "Name" field) — it must be read-only
    const refTarget = page.locator('[aria-label="Element Ref Target"]');
    await expect(refTarget).toBeDisabled();

    // minOccurs / maxOccurs remain editable on ref elements
    const minOccursInput = page.locator('input[aria-label="minOccurs"]');
    await expect(minOccursInput).toBeEnabled();

    const maxOccursInput = page.locator('input[aria-label="maxOccurs"]');
    await expect(maxOccursInput).toBeEnabled();

    // default / fixed remain editable
    await expect(page.locator('input[aria-label="default value"]')).toBeEnabled();
    await expect(page.locator('input[aria-label="fixed value"]')).toBeEnabled();

    // Annotation remains editable
    await expect(page.locator('[aria-label="Annotation"]')).toBeEnabled();

    // Global Reference checkbox cannot be toggled off for a ref element
    await expect(page.locator('input[aria-label="Global Reference"]')).toBeDisabled();

    // Sanity check: editing minOccurs actually persists
    await minOccursInput.fill('2');
    await minOccursInput.blur();
    await page.waitForTimeout(300);
    await expect(minOccursInput).toHaveValue('2');
  });

  test('datafield ref children are read-only, and refs-within-refs are also expandable', async ({ page }) => {
    await loadAutodbSchemaFromUrl(page);

    await expandNode(page, 'AUTOFORM');
    await expandNode(page, 'opentable');
    await expandNode(page, 'datafield');

    // datafield's inline complexType includes a non-ref child element "fieldname"
    const fieldnameNode = findNodeByLabel(page, 'fieldname');
    await fieldnameNode.waitFor({ state: 'visible', timeout: 20000 });
    await fieldnameNode.click();

    await page.locator('text=Element Editor').waitFor({ state: 'visible', timeout: 10000 });

    // All fields on a read-only ref-child must be disabled
    await expect(page.locator('input[aria-label="Element Name"]')).toBeDisabled();
    await expect(page.locator('input[aria-label="minOccurs"]')).toBeDisabled();
    await expect(page.locator('input[aria-label="maxOccurs"]')).toBeDisabled();

    // fieldname itself has no expand button (it's a plain leaf element)
    await expect(fieldnameNode.locator('button[title="Expand children"]')).toHaveCount(0);

    // A ref-within-a-ref-expansion (e.g. "htmlinput") CAN be expanded to reveal its own
    // read-only content, same as any other ref element.
    const htmlinputNode = findNodeByLabel(page, 'htmlinput');
    if (await htmlinputNode.count()) {
      await expect(htmlinputNode.locator('button[title="Expand children"]')).toHaveCount(1);
      await expandNode(page, 'htmlinput');
      const htmlinputChild = findNodeByLabel(page, 'textfield');
      await htmlinputChild.waitFor({ state: 'visible', timeout: 20000 });
      await htmlinputChild.click();
      await page.locator('text=Element Editor').waitFor({ state: 'visible', timeout: 10000 });
      await expect(page.locator('input[aria-label="Element Name"]')).toBeDisabled();
    }
  });

  test('non-ref elements (e.g. opentable/recordset) remain fully editable', async ({ page }) => {
    await loadAutodbSchemaFromUrl(page);

    await expandNode(page, 'AUTOFORM');
    await expandNode(page, 'opentable');

    // "recordset" under opentable is a plain (non-ref) element
    const recordsetNode = findNodeByLabel(page, 'recordset');
    await recordsetNode.waitFor({ state: 'visible', timeout: 20000 });
    await recordsetNode.click();

    await page.locator('text=Element Editor').waitFor({ state: 'visible', timeout: 10000 });

    await expect(page.locator('input[aria-label="Element Name"]')).toBeEnabled();
    await expect(page.locator('input[aria-label="minOccurs"]')).toBeEnabled();
    await expect(page.locator('input[aria-label="maxOccurs"]')).toBeEnabled();
  });
});
