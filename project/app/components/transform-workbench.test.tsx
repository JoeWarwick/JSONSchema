import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import WorkspaceRoute from '../routes/workbench';
import { contentFingerprint, createWorkbench, parseWorkspace, WORKSPACE_STORAGE_KEY } from '../state/workspace';
import { flattenTransformNodes, OUTPUT_BUNDLE_NAMESPACE, parseTransform, TRANSFORM_STORAGE_KEY, xmlStructure } from '../utils/transform';

const inputXml = '<orders><order id="7"><name>Alice</name></order><order id="8"><name>Bob</name></order></orders>';
const targetXml = '<invoices><invoice code=""><customer/></invoice><invoice code=""><customer/></invoice></invoices>';

function setupWorkspace() {
  const source = createWorkbench('xml', 'orders', 'Orders');
  source.entries['schema-sculptor-instance-xml'] = inputXml;
  source.savedContent = contentFingerprint(source);
  const target = createWorkbench('xml', 'invoices', 'Invoices');
  target.entries['schema-sculptor-instance-xml'] = targetXml;
  target.savedContent = contentFingerprint(target);
  const transform = createWorkbench('transform', 'transform', 'Order mapping');
  localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({
    version: 1, activeId: transform.id, workbenches: [source, target, transform],
  }));
}

function selectMapping(source: string, target: string, mode = 'value', templateMode?: string) {
  const sourceNode = flattenTransformNodes(xmlStructure(inputXml)).find(node => node.label === source)!;
  const targetNode = flattenTransformNodes(xmlStructure(targetXml)).find(node => node.label === target)!;
  fireEvent.change(screen.getByLabelText('Operation'), { target: { value: mode } });
  fireEvent.change(screen.getByLabelText('Source field'), { target: { value: sourceNode.id } });
  fireEvent.change(screen.getByLabelText('Target field'), { target: { value: targetNode.id } });
  if (templateMode !== undefined) fireEvent.change(screen.getByLabelText('Template mode'), { target: { value: templateMode } });
  fireEvent.click(screen.getByRole('button', { name: 'Add mapping' }));
}

async function selectSources() {
  fireEvent.change(screen.getByLabelText('Source datasource'), { target: { value: 'orders' } });
  await waitFor(() => expect(screen.getByLabelText('Source datasource')).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText('Target datasource'), { target: { value: 'invoices' } });
  await waitFor(() => expect(screen.getByLabelText('Target datasource')).not.toBeDisabled());
}

describe('Transform workbench', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
    setupWorkspace();
    global.fetch = jest.fn(async () => ({
      ok: false, status: 404, text: async () => '{"title":"Not found"}',
    } as Response));
  });

  afterEach(() => { global.fetch = originalFetch; });

  it('uses workspace datasources, generates XSLT, runs preview and preserves mappings after refresh', async () => {
    const view = render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: 'Mapping' });
    expect(screen.queryByRole('button', { name: 'Entity Graph' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Map leaf fields, attributes, constants/)).not.toBeInTheDocument();
    fireEvent.focus(screen.getByRole('button', { name: 'Help: Mapping rules' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Map leaf fields');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Help: Mapping rules' }), { key: 'Escape' });
    await selectSources();
    selectMapping('order', 'invoice', 'repeat', 'invoice-output');
    selectMapping('@id', '@code');
    selectMapping('name', 'customer');
    fireEvent.click(screen.getByRole('tab', { name: 'XSLT' }));
    expect(screen.getByLabelText<HTMLTextAreaElement>('Generated stylesheet').value).toContain('<xsl:apply-templates');
    expect(screen.getByLabelText<HTMLTextAreaElement>('Generated stylesheet').value).toContain('mode="invoice-output"');
    expect(screen.getByRole('button', { name: 'Export XSLT...' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('tab', { name: 'Input / Transform / Result' }));
    expect(screen.getByLabelText('Input XML')).toHaveValue(inputXml);

    const preview = jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => ({
      ok: true, status: 200,
      text: async () => '{"xml":"<invoices><invoice code=\\"7\\"><customer>Alice</customer></invoice></invoices>"}',
    } as Response));
    global.fetch = preview;
    fireEvent.click(screen.getByRole('button', { name: 'Run Transform' }));
    await waitFor(() => expect(screen.getByLabelText<HTMLTextAreaElement>('Result XML').value).toContain('Alice'));
    expect(preview.mock.calls[0][0]).toBe('/api/transform/preview');
    expect(JSON.parse(preview.mock.calls[0][1]!.body as string).stylesheet).toContain('mode="invoice-output"');
    fireEvent.change(screen.getByLabelText('Input XML'), { target: { value: '<orders/>' } });
    expect(screen.getByLabelText('Result XML')).toHaveValue('');
    await waitFor(() => {
      const workspace = parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
      const definition = parseTransform(workspace.workbenches[2].entries[TRANSFORM_STORAGE_KEY]);
      expect(definition.mappings).toHaveLength(3);
      expect(definition.mappings[0].templateMode).toBe('invoice-output');
      expect(definition.input).toBe('<orders/>');
    });
    view.unmount();
    render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: 'Input / Transform / Result' });
    expect(screen.getByLabelText('Input XML')).toHaveValue('<orders/>');
    fireEvent.click(screen.getByRole('tab', { name: 'Mapping' }));
    expect(screen.getAllByRole('button', { name: /Remove mapping/ })).toHaveLength(3);
    expect(screen.getByLabelText('Template mode for mapping 1')).toHaveValue('invoice-output');
  });

  it('persists separate output mappings and opens selected results in new workbenches without overwriting targets', async () => {
    const view = render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: 'Mapping' });
    await selectSources();
    selectMapping('order', 'invoice', 'repeat', 'records');
    selectMapping('name', 'customer');
    fireEvent.click(screen.getByRole('button', { name: 'Add output document' }));
    expect(screen.queryAllByRole('button', { name: /Remove mapping/ })).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Output name'), { target: { value: 'Second invoice' } });
    fireEvent.change(screen.getByLabelText('Target datasource'), { target: { value: 'invoices' } });
    await waitFor(() => expect(screen.getByLabelText('Target datasource')).not.toBeDisabled());
    selectMapping('order', 'invoice', 'repeat', 'records');
    selectMapping('@id', '@code');
    let outputId = '';
    await waitFor(() => {
      const workspace = parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
      const definition = parseTransform(workspace.workbenches[2].entries[TRANSFORM_STORAGE_KEY]);
      expect(definition.mappings).toHaveLength(2);
      expect(definition.outputs?.[0].mappings).toHaveLength(2);
      expect(definition.outputs?.[0].name).toBe('Second invoice');
      outputId = definition.outputs![0].id;
    });
    view.unmount();
    render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: 'Mapping' });
    expect(screen.getByLabelText('Output document')).toHaveValue('primary');
    fireEvent.change(screen.getByLabelText('Output document'), { target: { value: outputId } });
    expect(screen.getByLabelText('Output name')).toHaveValue('Second invoice');
    expect(screen.getAllByRole('button', { name: /Remove mapping/ })).toHaveLength(2);
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ xml: `<b:outputs xmlns:b="${OUTPUT_BUNDLE_NAMESPACE}">
        <b:document id="primary"><invoices><invoice><customer>Alice</customer></invoice></invoices></b:document>
        <b:document id="${outputId}"><invoices><invoice code="7"/></invoices></b:document>
      </b:outputs>` }),
    } as Response));
    fireEvent.click(screen.getByRole('tab', { name: 'Input / Transform / Result' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run Transform' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!).workbenches).toHaveLength(3);
    expect(screen.getByLabelText<HTMLTextAreaElement>('Result XML').value).toContain('code="7"');
    fireEvent.click(screen.getByRole('button', { name: 'Open results in new workbenches' }));
    fireEvent.change(screen.getByLabelText('Workbench name for output 1'), { target: { value: 'People output' } });
    fireEvent.change(screen.getByLabelText('Workbench name for output 2'), { target: { value: 'Codes output' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create workbenches' }));
    await waitFor(() => {
      const workspace = parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
      expect(workspace.workbenches).toHaveLength(5);
      expect(workspace.activeId).toBe('transform');
      expect(workspace.workbenches[0].entries['schema-sculptor-instance-xml']).toBe(inputXml);
      expect(workspace.workbenches[1].entries['schema-sculptor-instance-xml']).toBe(targetXml);
      expect(workspace.workbenches[3].name).toBe('People output');
      expect(workspace.workbenches[3].entries['schema-sculptor-instance-xml']).toContain('Alice');
      expect(workspace.workbenches[4].name).toBe('Codes output');
      expect(workspace.workbenches[4].entries['schema-sculptor-instance-xml']).toContain('code="7"');
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Mapping' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove output document' }));
    expect(screen.getByLabelText('Output document')).toHaveValue('primary');
    expect(screen.getAllByRole('button', { name: /Remove mapping/ })).toHaveLength(2);
  });

  it('edits repeating-group modes inline, diagnoses invalid names and restores automatic modes when cleared', async () => {
    render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: 'Mapping' });
    await selectSources();
    expect(screen.queryByLabelText('Template mode')).not.toBeInTheDocument();
    selectMapping('order', 'invoice', 'repeat');
    selectMapping('name', 'customer');
    expect(screen.queryByLabelText('Template mode for mapping 2')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Template mode for mapping 1'), { target: { value: 'invoice-list' } });
    fireEvent.click(screen.getByRole('tab', { name: 'XSLT' }));
    expect(screen.getByLabelText<HTMLTextAreaElement>('Generated stylesheet').value).toContain('mode="invoice-list"');
    fireEvent.click(screen.getByRole('tab', { name: 'Mapping' }));
    fireEvent.change(screen.getByLabelText('Template mode for mapping 1'), { target: { value: 'invalid mode' } });
    expect(screen.getByRole('status')).toHaveTextContent('Invalid template mode');
    fireEvent.click(screen.getByRole('tab', { name: 'XSLT' }));
    expect(screen.getByRole('button', { name: 'Export XSLT...' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid template mode');
    fireEvent.click(screen.getByRole('tab', { name: 'Input / Transform / Result' }));
    expect(screen.getByRole('button', { name: 'Run Transform' })).toBeDisabled();
    fireEvent.click(screen.getByRole('tab', { name: 'Mapping' }));
    fireEvent.change(screen.getByLabelText('Template mode for mapping 1'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('tab', { name: 'XSLT' }));
    expect(screen.getByLabelText<HTMLTextAreaElement>('Generated stylesheet').value).toContain('mode="mapping-1"');
    expect(screen.getByRole('button', { name: 'Export XSLT...' })).not.toBeDisabled();
  });

  it('continues using saved snapshots after datasource workbenches are closed', async () => {
    render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: 'Mapping' });
    await selectSources();
    selectMapping('order', 'invoice', 'repeat');
    selectMapping('name', 'customer');
    fireEvent.click(screen.getByRole('button', { name: 'Close Orders' }));
    expect(await screen.findByText(/The file is closed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'XSLT' }));
    expect(screen.getByLabelText<HTMLTextAreaElement>('Generated stylesheet').value).toContain('customer');
  });

  it('creates collection workbenches from both datasources while retaining mappings and the original files', async () => {
    render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: 'Mapping' });
    await selectSources();
    selectMapping('order', 'invoice', 'repeat', 'invoice');
    selectMapping('name', 'customer');
    fireEvent.click(screen.getAllByRole('button', { name: 'Create collection...' })[0]);
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Collection root name'), { target: { value: 'orderBatches' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create collection' }));
    expect(screen.getByRole('tab', { name: 'Mapping' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Source datasource')).not.toHaveValue('orders');
    fireEvent.click(screen.getAllByRole('button', { name: 'Create collection...' })[1]);
    fireEvent.change(screen.getByLabelText('Collection root name'), { target: { value: 'invoiceBatches' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create collection' }));
    expect(screen.getByLabelText('Target datasource')).not.toHaveValue('invoices');
    fireEvent.click(screen.getByRole('tab', { name: 'XSLT' }));
    const xslt = screen.getByLabelText<HTMLTextAreaElement>('Generated stylesheet').value;
    expect(xslt).toContain('name="invoiceBatches"');
    expect(xslt).toContain("local-name()='orderBatches'");
    expect(xslt).toContain('mode="invoice"');
    fireEvent.click(screen.getByRole('tab', { name: 'Input / Transform / Result' }));
    expect(screen.getByLabelText<HTMLTextAreaElement>('Input XML').value).toContain('<orderBatches>');
    await waitFor(() => {
      const workspace = parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
      expect(workspace.workbenches).toHaveLength(5);
      expect(workspace.workbenches[0].entries['schema-sculptor-instance-xml']).toBe(inputXml);
      expect(workspace.workbenches[1].entries['schema-sculptor-instance-xml']).toBe(targetXml);
      const definition = parseTransform(workspace.workbenches[2].entries[TRANSFORM_STORAGE_KEY]);
      expect(JSON.parse(definition.mappings[0].source)[0].name).toBe('orderBatches');
      expect(JSON.parse(definition.mappings[0].target)[0].name).toBe('invoiceBatches');
    });
  });

  it('offers collection creation from the XML Schema menu and activates the new workbench', async () => {
    render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: 'Mapping' });
    fireEvent.click(screen.getByRole('tab', { name: /XML Orders/ }));
    fireEvent.pointerDown(screen.getByRole('menuitem', { name: /^Schema$/ }), { button: 0 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Create collection...' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create collection' }));
    expect(screen.getByRole('tab', { name: /XML orderss/ })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => {
      const workspace = parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
      expect(workspace.workbenches[3].entries['schema-sculptor-instance-xml']).toContain('<orderss>');
    });
  });

  it('creates both collections together, rebases field mappings and adds a record template', async () => {
    const workspace = parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
    const sourceXml = '<person><firstName>Alice</firstName><lastName>Smith</lastName></person>';
    const targetXml = '<employee><firstName/><lastName/></employee>';
    workspace.workbenches[0].entries['schema-sculptor-instance-xml'] = sourceXml;
    workspace.workbenches[1].entries['schema-sculptor-instance-xml'] = targetXml;
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
    const view = render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: 'Mapping' });
    expect(screen.getByRole('button', { name: 'Create source + target collections...' })).toBeDisabled();
    await selectSources();
    for (const name of ['firstName', 'lastName']) {
      fireEvent.change(screen.getByLabelText('Source field'), { target: {
        value: flattenTransformNodes(xmlStructure(sourceXml)).find(node => node.label === name)!.id,
      } });
      fireEvent.change(screen.getByLabelText('Target field'), { target: {
        value: flattenTransformNodes(xmlStructure(targetXml)).find(node => node.label === name)!.id,
      } });
      fireEvent.click(screen.getByRole('button', { name: 'Add mapping' }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Create source + target collections...' }));
    expect(screen.getByLabelText('Source collection root name')).toHaveValue('persons');
    expect(screen.getByLabelText('Target collection root name')).toHaveValue('employees');
    fireEvent.click(screen.getByRole('button', { name: 'Create collections' }));
    expect(screen.getByRole('tab', { name: 'Mapping' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('button', { name: /Remove mapping/ })).toHaveLength(3);
    fireEvent.click(screen.getByRole('tab', { name: 'XSLT' }));
    const xslt = screen.getByLabelText<HTMLTextAreaElement>('Generated stylesheet').value;
    expect(xslt).toContain('name="employees"');
    expect(xslt).toContain("local-name()='persons'");
    expect(xslt).toContain('<xsl:apply-templates');
    expect(xslt).toContain(`select="*[local-name()='firstName'`);
    expect(xslt).toContain(`select="*[local-name()='lastName'`);
    await waitFor(() => {
      const saved = parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
      expect(saved.workbenches).toHaveLength(5);
      expect(saved.activeId).toBe('transform');
      expect(saved.workbenches[0].entries['schema-sculptor-instance-xml']).toBe(sourceXml);
      expect(saved.workbenches[1].entries['schema-sculptor-instance-xml']).toBe(targetXml);
      const definition = parseTransform(saved.workbenches[2].entries[TRANSFORM_STORAGE_KEY]);
      expect(definition.mappings[0].mode).toBe('repeat');
      expect(definition.source?.rootElement).toBe('persons');
      expect(definition.target?.rootElement).toBe('employees');
      expect(definition.input).toContain('<persons>');
    });
    view.unmount();
    render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: 'XSLT' });
    expect(screen.getByLabelText('Generated stylesheet')).toHaveValue(xslt);
  });

  it('selects saved XML from workbenches currently displaying JSON', async () => {
    const workspace = parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
    workspace.workbenches[0].entries['schema-sculptor-markup-language'] = 'json';
    workspace.workbenches[1].kind = 'json';
    workspace.workbenches[1].entries['schema-sculptor-markup-language'] = 'json';
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
    render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: 'Mapping' });
    await selectSources();
    expect(screen.getByLabelText('Source datasource')).toHaveValue('orders');
    expect(screen.getByLabelText('Target datasource')).toHaveValue('invoices');
    selectMapping('order', 'invoice', 'repeat');
    selectMapping('name', 'customer');
    fireEvent.click(screen.getByRole('tab', { name: 'XSLT' }));
    expect(screen.getByLabelText<HTMLTextAreaElement>('Generated stylesheet').value).toContain('customer');
  });

  it('keeps custom preview input and existing named group mappings during paired conversion', async () => {
    render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: 'Mapping' });
    await selectSources();
    selectMapping('order', 'invoice', 'repeat', 'invoice-output');
    selectMapping('name', 'customer');
    fireEvent.click(screen.getByRole('tab', { name: 'Input / Transform / Result' }));
    fireEvent.change(screen.getByLabelText('Input XML'), { target: { value: '<custom/>' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Mapping' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create source + target collections...' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create collections' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Input / Transform / Result' }));
    expect(screen.getByLabelText('Input XML')).toHaveValue('<custom/>');
    await waitFor(() => {
      const saved = parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
      const definition = parseTransform(saved.workbenches[2].entries[TRANSFORM_STORAGE_KEY]);
      expect(definition.mappings).toHaveLength(3);
      expect(definition.mappings[1].templateMode).toBe('invoice-output');
      expect(definition.mappings[1].mode).toBe('repeat');
      expect(definition.input).toBe('<custom/>');
    });
  });

  it('surfaces preview service errors without displaying stale results', async () => {
    render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: 'Mapping' });
    await selectSources();
    selectMapping('order', 'invoice', 'repeat');
    selectMapping('name', 'customer');
    fireEvent.click(screen.getByRole('tab', { name: 'Input / Transform / Result' }));
    global.fetch = jest.fn(async () => ({
      ok: false, status: 408, text: async () => '{"detail":"Transform preview exceeded its five-second execution limit."}',
    } as Response));
    fireEvent.click(screen.getByRole('button', { name: 'Run Transform' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('five-second');
    expect(screen.getByLabelText('Result XML')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Run Transform' })).not.toBeDisabled();
  });

  it('creates a separate Transform from File > New without showing schema tabs', async () => {
    render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: 'Mapping' });
    fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'File' }), { button: 0 });
    fireEvent.keyDown(await screen.findByRole('menuitem', { name: 'New' }), { key: 'ArrowRight' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Transform Workbench' }));
    const workbenchTabs = screen.getByRole('tablist', { name: 'Workbenches' });
    expect(within(workbenchTabs).getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('tab', { name: /TRANSFORM Transform 1/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: 'Schema Form' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Mapping' })).toHaveAttribute('aria-selected', 'true');
  });

  it('flags source changes and retains mappings for explicit repair when a snapshot is refreshed', async () => {
    render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: 'Mapping' });
    await selectSources();
    selectMapping('order', 'invoice', 'repeat');
    selectMapping('name', 'customer');
    fireEvent.click(screen.getByRole('tab', { name: /XML Orders/ }));
    fireEvent.change(within(screen.getByRole('tabpanel')).getByPlaceholderText('Paste your XML here...'), {
      target: { value: '<orders><order id="7"><renamed>Alice</renamed></order></orders>' },
    });
    fireEvent.click(screen.getByRole('tab', { name: /TRANSFORM Order mapping/ }));
    expect(await screen.findByText(/This workspace file has changed/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh snapshot' })[0]);
    expect(await screen.findByText('Missing field - repair this mapping')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Remove mapping/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole('tab', { name: 'XSLT' }));
    expect(screen.getByRole('alert')).toHaveTextContent('source field no longer exists');
    expect(screen.getByRole('button', { name: 'Export XSLT...' })).toBeDisabled();
  });
});
