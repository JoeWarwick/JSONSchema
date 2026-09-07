import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

async function clickAddElementFromContextMenu(page: any) {
  await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('button')).filter(
      (btn) => btn.textContent?.trim() === 'Add element'
    ) as HTMLButtonElement[];
    const clickable = candidates.find((btn) => {
      const style = window.getComputedStyle(btn);
      return style.display !== 'none' && style.visibility !== 'hidden' && !btn.disabled;
    }) || candidates[0];
    if (!clickable) throw new Error('Add element button not found');
    clickable.click();
  });
}

async function getNodeGraphPosition(page: any, nodeId: string) {
  return page.evaluate((id) => {
    const node = document.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement | null;
    if (!node) return null;
    const m = (node.style.transform || '').match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    if (!m) return null;
    return { x: Number(m[1]), y: Number(m[2]) };
  }, nodeId);
}

async function waitForStableNodeY(page: any, nodeId: string, stableMs = 220): Promise<void> {
  await expect
    .poll(async () => {
      return page.evaluate(async ({ id, stableWindow }) => {
        const readY = () => {
          const node = document.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement | null;
          if (!node) return null;
          const m = (node.style.transform || '').match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
          if (!m) return null;
          return Number(m[2]);
        };

        const first = readY();
        if (first == null) return null;
        await new Promise((resolve) => setTimeout(resolve, stableWindow));
        const second = readY();
        if (second == null) return null;
        return Math.abs(second - first);
      }, { id: nodeId, stableWindow: stableMs });
    })
    .toBeLessThan(1);
}

async function getNoteTypeSequenceElementCount(page: any): Promise<number> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('schema-sculptor-schema-xml');
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as any;
    const noteType = (parsed?.['xs:schema']?.['xs:complexType'] || []).find(
      (ct: any) => ct?.['@attributes']?.name === 'NoteType'
    );
    const sequence = noteType?.['xs:sequence']
      || noteType?.['xs:complexContent']?.['xs:extension']?.['xs:sequence']
      || noteType?.['xs:simpleContent']?.['xs:extension']?.['xs:sequence']
      || noteType?.['xs:complexContent']?.['xs:restriction']?.['xs:sequence']
      || noteType?.['xs:simpleContent']?.['xs:restriction']?.['xs:sequence'];
    if (!sequence) return 0;
    const elementValue = sequence?.['xs:element'];
    if (!elementValue) return 0;
    return Array.isArray(elementValue) ? elementValue.length : 1;
  });
}

test('loads demo controls XSD and renders inferred XML schema controls', async ({ page }) => {
  await page.context().addInitScript(() => {
    try {
      localStorage.setItem('schema-sculptor-markup-language', 'xml');
      localStorage.setItem('schema-sculptor-schema-xml', '');
      localStorage.setItem('schema-sculptor-instance-xml', '');
      localStorage.removeItem('schema-sculptor-graph-collapse-state');
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

  await page.getByRole('button', { name: 'Schema Graph' }).click();
});

test('adding an element to NoteType keeps street hidden and renders new child near NoteType', async ({ page }) => {
  await page.context().addInitScript(() => {
    try {
      localStorage.setItem('schema-sculptor-markup-language', 'xml');
      localStorage.setItem('schema-sculptor-schema-xml', '');
      localStorage.setItem('schema-sculptor-instance-xml', '');
      localStorage.removeItem('schema-sculptor-graph-collapse-state');
    } catch {
      // ignore
    }
  });

  await page.goto(BASE);
  await page.getByRole('button', { name: 'Schema Form' }).click();
  await page.getByRole('button', { name: 'Load demo controls XSD' }).first().click();
  await expect(page.getByText('xs:schema').first()).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Schema Graph' }).click();
  await expect(page.locator('button').filter({ hasText: 'street' }).first()).toHaveCount(0);

  const noteTypeButton = page.getByRole('button', { name: 'NoteType' }).first();
  await expect(noteTypeButton).toBeVisible({ timeout: 20000 });

  const noteExpandToggle = noteTypeButton.locator('button[title="Expand children"]').first();
  if (await noteExpandToggle.count()) {
    await noteExpandToggle.click({ force: true });
  }

  const noteNodeId = await noteTypeButton.evaluate((el) => {
    const node = el.closest('.react-flow__node');
    return node?.getAttribute('data-id') || null;
  });
  expect(noteNodeId).not.toBeNull();
  if (!noteNodeId) {
    throw new Error('NoteType node id not found');
  }

  const langNodeId = `${noteNodeId}.attribute_0`;
  await waitForStableNodeY(page, noteNodeId);
  await waitForStableNodeY(page, langNodeId);

  const noteBefore = await page.evaluate((nodeId) => {
    const node = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`) as HTMLElement | null;
    if (!node) return null;
    const m = (node.style.transform || '').match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    if (!m) return null;
    return { x: Number(m[1]), y: Number(m[2]) };
  }, noteNodeId);
  expect(noteBefore).not.toBeNull();
  const langBefore = await getNodeGraphPosition(page, langNodeId);
  expect(langBefore).not.toBeNull();

  const baselineVisibleNodes = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('.react-flow__node')) as HTMLElement[];
    return nodes.filter((node) => {
      const style = window.getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden';
    }).length;
  });
  const noteCountBeforeAdd = await getNoteTypeSequenceElementCount(page);

  await noteTypeButton.click({ button: 'right' });
  await clickAddElementFromContextMenu(page);

  await expect
    .poll(async () => {
      return getNoteTypeSequenceElementCount(page);
    })
    .toBe(noteCountBeforeAdd + 1);

  const transientSample = await page.evaluate(async (nodeId) => {
    const parsePos = (id: string) => {
      const node = document.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement | null;
      if (!node) return null;
      const m = (node.style.transform || '').match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
      if (!m) return null;
      return { x: Number(m[1]), y: Number(m[2]) };
    };

    const langNodeId = `${nodeId}.attribute_0`;
    const initial = parsePos(nodeId);
    const initialLang = parsePos(langNodeId);
    let maxVisibleNodeCount = 0;
    let maxAbsYDrift = 0;
    let maxAbsLangYDrift = 0;
    const samples: Array<{ t: number; visible: number; y: number | null }> = [];
    const start = performance.now();
    const deadline = start + 1800;

    while (performance.now() < deadline) {
      const nodes = Array.from(document.querySelectorAll('.react-flow__node')) as HTMLElement[];
      const visibleCount = nodes.filter((node) => {
        const style = window.getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden';
      }).length;
      if (visibleCount > maxVisibleNodeCount) maxVisibleNodeCount = visibleCount;

      const p = parsePos(nodeId);
      const y = p?.y ?? null;
      if (initial && p) {
        const dy = Math.abs(p.y - initial.y);
        if (dy > maxAbsYDrift) maxAbsYDrift = dy;
      }

      const langP = parsePos(langNodeId);
      if (initialLang && langP) {
        const langDy = Math.abs(langP.y - initialLang.y);
        if (langDy > maxAbsLangYDrift) maxAbsLangYDrift = langDy;
      }

      samples.push({ t: Math.round(performance.now() - start), visible: visibleCount, y });
      await new Promise((resolve) => setTimeout(resolve, 40));
    }

    return { maxVisibleNodeCount, maxAbsYDrift, maxAbsLangYDrift, samples: samples.slice(0, 10) };
  }, noteNodeId);

  const noteSequenceNodeId = `${noteNodeId}.sequence`;
  const noteSequenceElementId = `${noteSequenceNodeId}.element_0`;
  await expect(page.locator(`.react-flow__node[data-id="${noteSequenceNodeId}"]`)).toBeVisible({ timeout: 15000 });
  await expect(page.locator(`.react-flow__node[data-id="${noteSequenceElementId}"]`)).toBeVisible({ timeout: 15000 });
  await expect.poll(async () => getNodeGraphPosition(page, noteSequenceNodeId)).not.toBeNull();
  await expect.poll(async () => getNodeGraphPosition(page, noteSequenceElementId)).not.toBeNull();

  const noteSequencePosition = await getNodeGraphPosition(page, noteSequenceNodeId);
  const noteSequenceElementPosition = await getNodeGraphPosition(page, noteSequenceElementId);
  expect(noteSequencePosition).not.toBeNull();
  expect(noteSequenceElementPosition).not.toBeNull();
  expect(noteSequenceElementPosition!.y).toBeGreaterThan(noteSequencePosition!.y);

  const noteAfter = await page.evaluate((nodeId) => {
    const node = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`) as HTMLElement | null;
    if (!node) return null;
    const m = (node.style.transform || '').match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    if (!m) return null;
    return { x: Number(m[1]), y: Number(m[2]) };
  }, noteNodeId);
  expect(noteAfter).not.toBeNull();

  const dx = Math.abs(noteAfter!.x - noteBefore!.x);
  const dy = Math.abs(noteAfter!.y - noteBefore!.y);
  const langAfter = await getNodeGraphPosition(page, langNodeId);
  expect(langAfter).not.toBeNull();
  const langDy = Math.abs(langAfter!.y - langBefore!.y);
  // Keep branch position stable after NoteType mutation, especially vertically.
  expect(dx).toBeLessThan(140);
  expect(dy).toBeLessThan(70);
  // The NoteType @lang attribute should not jump far south on first mutation.
  expect(langDy).toBeLessThan(70);

  // Bug guard: first mutation must not trigger a phantom full expansion spike.
  expect(
    transientSample.maxVisibleNodeCount,
    `visible-node spike too high; baseline=${baselineVisibleNodes}, max=${transientSample.maxVisibleNodeCount}, sample=${JSON.stringify(transientSample.samples)}`
  ).toBeLessThanOrEqual(baselineVisibleNodes + 4);
  expect(
    transientSample.maxAbsYDrift,
    `transient Y drift too high; maxAbsYDrift=${transientSample.maxAbsYDrift}, sample=${JSON.stringify(transientSample.samples)}`
  ).toBeLessThan(70);
  expect(
    transientSample.maxAbsLangYDrift,
    `transient @lang Y drift too high; maxAbsLangYDrift=${transientSample.maxAbsLangYDrift}, sample=${JSON.stringify(transientSample.samples)}`
  ).toBeLessThan(70);

  const streetBecameVisible = await page.evaluate(async () => {
    const isVisible = () => {
      const matches = Array.from(document.querySelectorAll('*')).filter((el) => el.textContent?.trim() === 'street');
      return matches.some((el) => {
        const htmlEl = el as HTMLElement;
        const style = window.getComputedStyle(htmlEl);
        const rect = htmlEl.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      });
    };

    const deadline = performance.now() + 1500;
    while (performance.now() < deadline) {
      if (isVisible()) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  });

  expect(streetBecameVisible).toBe(false);
  await expect(page.locator('button').filter({ hasText: 'street' }).first()).toHaveCount(0);
});

test('bug repro: NoteType Y should stay anchored after NoteType add then PersonType add', async ({ page }) => {
  await page.context().addInitScript(() => {
    try {
      localStorage.setItem('schema-sculptor-markup-language', 'xml');
      localStorage.setItem('schema-sculptor-schema-xml', '');
      localStorage.setItem('schema-sculptor-instance-xml', '');
      localStorage.removeItem('schema-sculptor-graph-collapse-state');
    } catch {
      // ignore
    }
  });

  await page.goto(BASE);
  await page.getByRole('button', { name: 'Schema Form' }).click();
  await page.getByRole('button', { name: 'Load demo controls XSD' }).first().click();
  await expect(page.getByText('xs:schema').first()).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Schema Graph' }).click();

  const noteTypeButton = page.getByRole('button', { name: 'NoteType' }).first();
  await expect(noteTypeButton).toBeVisible({ timeout: 20000 });
  const noteExpandToggle = noteTypeButton.locator('button[title="Expand children"]').first();
  if (await noteExpandToggle.count()) {
    await noteExpandToggle.click({ force: true });
  }

  const noteNodeId = await noteTypeButton.evaluate((el) => {
    const node = el.closest('.react-flow__node');
    return node?.getAttribute('data-id') || null;
  });
  expect(noteNodeId).not.toBeNull();
  if (!noteNodeId) throw new Error('NoteType node id not found');

  const noteBefore = await getNodeGraphPosition(page, noteNodeId);
  expect(noteBefore).not.toBeNull();
  const noteCountBeforeNoteMutation = await getNoteTypeSequenceElementCount(page);

  await noteTypeButton.click({ button: 'right' });
  await clickAddElementFromContextMenu(page);

  await expect
    .poll(async () => {
      return getNoteTypeSequenceElementCount(page);
    })
    .toBe(noteCountBeforeNoteMutation + 1);

  const noteAfterNoteMutation = await getNodeGraphPosition(page, noteNodeId);
  expect(noteAfterNoteMutation).not.toBeNull();

  const personTypeButton = page.getByRole('button', { name: 'PersonType' }).first();
  await expect(personTypeButton).toBeVisible({ timeout: 20000 });
  const personExpandToggle = personTypeButton.locator('button[title="Expand children"]').first();
  if (await personExpandToggle.count()) {
    await personExpandToggle.click({ force: true });
  }

  await personTypeButton.click({ button: 'right' });
  await clickAddElementFromContextMenu(page);

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const raw = localStorage.getItem('schema-sculptor-schema-xml');
        if (!raw) return null;
        const parsed = JSON.parse(raw) as any;
        const personType = (parsed?.['xs:schema']?.['xs:complexType'] || []).find(
          (ct: any) => ct?.['@attributes']?.name === 'PersonType'
        );
        const sequence = personType?.['xs:sequence'];
        const elementValue = sequence?.['xs:element'];
        const elements = Array.isArray(elementValue) ? elementValue : [elementValue].filter(Boolean);
        return elements.some((entry: any) => String(entry?.['@attributes']?.name || '').startsWith('element'));
      });
    })
    .toBe(true);

  const noteAfterPersonMutation = await getNodeGraphPosition(page, noteNodeId);
  expect(noteAfterPersonMutation).not.toBeNull();

  const driftY = Math.abs(noteAfterPersonMutation!.y - noteAfterNoteMutation!.y);
  const driftYFromStart = Math.abs(noteAfterPersonMutation!.y - noteBefore!.y);

  // Bug guard: NoteType branch should not shoot far vertically after editing PersonType.
  expect(driftY).toBeLessThan(90);
  expect(driftYFromStart).toBeLessThan(140);
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


