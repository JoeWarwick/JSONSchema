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

test('loads demo controls XSD and populates XML Input with default instance', async ({ page }) => {
  // Enable console logging to debug
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning' || msg.text().includes('Failed') || msg.text().includes('xmlInput')) {
      console.log(`Browser console [${msg.type()}]: ${msg.text()}`);
    }
  });

  // Log network errors
  page.on('response', response => {
    if (!response.ok() && response.url().includes('api')) {
      console.log(`Network error: ${response.status()} ${response.url()}`);
    }
  });

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
  
  // Add debugging for the button click
  console.log('Clicking Load demo controls XSD button');
  await loadDemoBtn.click();

  // Wait for the demo to load (schema should be visible)
  await expect(page.getByText('xs:schema').first()).toBeVisible({ timeout: 15000 });

  // Click on the XML Input tab
  const xmlInputTab = page.getByRole('button', { name: 'XML Input' });
  await xmlInputTab.click();

  // Get the XML Input textarea and wait for it to have content
  const xmlTextarea = page.locator('textarea[placeholder*="Paste your"]').first();
  await xmlTextarea.waitFor({ state: 'visible', timeout: 10000 });

  // Check the initial value
  let xmlContent = await xmlTextarea.inputValue();
  console.log('XML textarea initial content length:', xmlContent.length);
  console.log('XML textarea initial content:', xmlContent.substring(0, 100));

  // Wait for the textarea to have non-empty content (the default instance)
  try {
    await page.waitForFunction(
      () => {
        const textarea = document.querySelector('textarea[placeholder*="Paste your"]') as HTMLTextAreaElement;
        return textarea && textarea.value.trim().length > 0;
      },
      { timeout: 15000 }
    );
  } catch (e) {
    console.log('Timeout waiting for textarea content');
    // Check the state of the app
    const hasJsonInput = await page.locator('textarea').count();
    console.log('Number of textareas:', hasJsonInput);
    xmlContent = await xmlTextarea.inputValue();
    console.log('Final XML textarea content length:', xmlContent.length);
    throw e;
  }

  xmlContent = await xmlTextarea.inputValue();

  // Verify the XML Input is not empty and contains valid XML (starts with < and has root element)
  expect(xmlContent).toBeTruthy();
  // Match either XML declaration or root element directly
  expect(xmlContent).toMatch(/^(<\?xml|<\w+)/);
  expect(xmlContent).toContain('</'); // Should have closing tags
});


