import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import WorkspaceRoute from '../routes/workbench';
import { contentFingerprint, createWorkbench, parseWorkspace, WORKSPACE_STORAGE_KEY } from '../state/workspace';
import { emptyOpenApi, newApiEndpoint, OPENAPI_STORAGE_KEY, parseOpenApi } from '../utils/openapi';

jest.mock('./openapi-preview', () => ({
  __esModule: true, default: ({ document }: { document: Record<string, unknown> }) =>
    <div data-testid="swagger-preview">{JSON.stringify(document)}</div>,
}));

function setup() {
  const entity = createWorkbench('erd', 'entity', 'Shop');
  entity.entries['schema-sculptor-erd'] = JSON.stringify({
    tables: [{ id: 'Products', name: 'Products', clrName: 'Product', navigations: [], columns: [
      { name: 'Id', type: 'int', isPrimaryKey: true, isNullable: false, isForeignKey: false },
      { name: 'Name', type: 'string', isPrimaryKey: false, isNullable: false, isForeignKey: false },
    ] }], relationships: [], sourceFiles: [], diagnostics: [],
  });
  const schema = createWorkbench('json', 'schema', 'Receipt');
  schema.entries['schema-sculptor-schema'] = '{"type":"object","properties":{"receipt":{"type":"string"}}}';
  entity.savedContent = contentFingerprint(entity);
  schema.savedContent = contentFingerprint(schema);
  const api = createWorkbench('openapi', 'api', 'Store API');
  localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({
    version: 1, activeId: api.id, workbenches: [entity, schema, api],
  }));
}

async function addSource(id: string) {
  fireEvent.change(screen.getByLabelText('Workspace source'), { target: { value: id } });
  fireEvent.click(screen.getByRole('button', { name: 'Add source' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add source' })).not.toBeDisabled());
}

describe('OpenAPI workbench', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    localStorage.clear(); setup();
    global.fetch = jest.fn(async () => ({ ok: false, status: 404, text: async () => '{"title":"Not found"}' } as Response));
  });
  afterEach(() => { global.fetch = originalFetch; });

  it('creates CRUD proposals from an ERD, adds optional schemas, edits bindings, exports JSON/YAML and restores state', async () => {
    const view = render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: 'API Design' });
    expect(screen.queryByRole('tab', { name: 'Mapping' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entity Graph' })).not.toBeInTheDocument();
    await addSource('entity');
    expect(screen.getAllByRole('group', { name: /^Endpoint \d+/ })).toHaveLength(5);
    expect(screen.getByText(/CRUD routes are proposals/)).toBeInTheDocument();
    await addSource('schema');
    const create = within(screen.getByRole('group', { name: 'Endpoint 2' }));
    fireEvent.change(create.getByLabelText('Response schema'), { target: { value: 'Receipt' } });
    fireEvent.change(screen.getByLabelText('API title'), { target: { value: 'Shop Service' } });
    fireEvent.click(screen.getByRole('tab', { name: /^JSON$/ }));
    const json = screen.getByLabelText<HTMLTextAreaElement>('Generated OpenAPI document').value;
    expect(JSON.parse(json)).toMatchObject({
      openapi: '3.1.0', info: { title: 'Shop Service' },
      paths: { '/Products': { post: { responses: { '201': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Receipt' } } } } } } } },
    });
    const createObjectURL = URL.createObjectURL;
    const revokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => 'blob:api');
    URL.revokeObjectURL = jest.fn();
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Export OpenAPI JSON...' }));
      expect(click).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:api');
      fireEvent.click(screen.getByRole('tab', { name: /^YAML$/ }));
      expect(screen.getByLabelText<HTMLTextAreaElement>('Generated OpenAPI document').value).toContain('openapi: 3.1.0');
      fireEvent.click(screen.getByRole('button', { name: 'Export OpenAPI YAML...' }));
      expect(click).toHaveBeenCalledTimes(2);
    } finally {
      click.mockRestore(); URL.createObjectURL = createObjectURL; URL.revokeObjectURL = revokeObjectURL;
    }
    fireEvent.click(screen.getByRole('tab', { name: 'Swagger Preview' }));
    expect(await screen.findByTestId('swagger-preview')).toHaveTextContent('Shop Service');
    await waitFor(() => {
      const saved = parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
      const definition = parseOpenApi(saved.workbenches[2].entries[OPENAPI_STORAGE_KEY]);
      expect(definition.sources).toHaveLength(2);
      expect(definition.endpoints[1].responseSchema).toBe('Receipt');
    });
    view.unmount();
    render(<WorkspaceRoute />);
    expect(await screen.findByTestId('swagger-preview')).toHaveTextContent('Shop Service');
  });

  it('retains snapshots when sources close and blocks missing schema bindings until repaired', async () => {
    render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: 'API Design' });
    await addSource('schema');
    fireEvent.click(screen.getByRole('button', { name: 'Add endpoint' }));
    fireEvent.change(screen.getByLabelText('Response schema'), { target: { value: 'Receipt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close Receipt' }));
    expect(await screen.findByText(/Source closed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove source Receipt' }));
    expect(screen.getByRole('alert')).toHaveTextContent('missing schema');
    expect(screen.getByLabelText('Response schema')).toHaveValue('Receipt');
    fireEvent.click(screen.getByRole('tab', { name: /^JSON$/ }));
    expect(screen.getByRole('button', { name: 'Export OpenAPI JSON...' })).toBeDisabled();
    fireEvent.click(screen.getByRole('tab', { name: 'API Design' }));
    fireEvent.change(screen.getByLabelText('Response schema'), { target: { value: '' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('edits component snapshots without modifying original schema workbenches and rejects invalid schema edits', async () => {
    render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: 'API Design' });
    await addSource('schema');
    fireEvent.click(screen.getByRole('tab', { name: /^Schemas$/ }));
    fireEvent.change(screen.getByLabelText('Receipt'), { target: { value: '{broken' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Receipt' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Receipt'), { target: { value: '{"type":"boolean"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Receipt' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() => {
      const saved = parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
      expect(parseOpenApi(saved.workbenches[2].entries[OPENAPI_STORAGE_KEY]).sources[0].schemas.Receipt).toEqual({ type: 'boolean' });
      expect(saved.workbenches[1].entries['schema-sculptor-schema']).toContain('receipt');
    });
  });

  it('adds OpenAPI via File > New with independent editor tabs', async () => {
    render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: 'API Design' });
    fireEvent.pointerDown(screen.getByRole('menuitem', { name: /^File$/ }), { button: 0 });
    fireEvent.keyDown(await screen.findByRole('menuitem', { name: /^New$/ }), { key: 'ArrowRight' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'OpenAPI Workbench' }));
    expect(screen.getByRole('tab', { name: /OPENAPI OpenAPI 1/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByRole('tabpanel', { name: 'API Design' })).getByLabelText('API title')).toHaveValue('My API');
  });

  it('generates a request form from an endpoint and keeps its editable payload after source changes', async () => {
    const view = render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: 'API Design' });
    await addSource('entity');
    expect(within(screen.getByRole('group', { name: 'Endpoint 1' })).getByRole('button', { name: 'Generate form' })).toBeDisabled();
    fireEvent.click(within(screen.getByRole('group', { name: 'Endpoint 2' })).getByRole('button', { name: 'Generate form' }));
    expect(await screen.findByRole('tab', { name: /JSON POST \/Products request/ })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('heading', { name: 'Instance Form' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.focus(screen.getByRole('button', { name: 'Help' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Contract snapshot is current');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Help' }), { key: 'Escape' });
    const nameField = await within(screen.getByRole('tabpanel')).findByPlaceholderText('Enter value...');
    fireEvent.change(nameField, { target: { value: 'Widget' } });
    fireEvent.blur(nameField);
    fireEvent.click(screen.getByRole('button', { name: 'JSON Input' }));
    const input = await within(screen.getByRole('tabpanel')).findByPlaceholderText('Paste your JSON here...');
    expect(JSON.parse((input as HTMLTextAreaElement).value)).toMatchObject({ Name: 'Widget' });
    fireEvent.change(input, { target: { value: '{"Id":4,"Name":"Widget"}' } });
    await waitFor(() => {
      const saved = parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
      expect(saved.workbenches).toHaveLength(4);
      expect(saved.workbenches[3].entries['schema-sculptor-instance-json']).toContain('Widget');
    });
    fireEvent.click(screen.getByRole('tab', { name: /OPENAPI Store API/ }));
    fireEvent.change(within(screen.getByRole('group', { name: 'Endpoint 2' })).getByLabelText('Path'), { target: { value: '/catalog' } });
    fireEvent.click(screen.getByRole('tab', { name: /JSON POST \/Products request/ }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('source contract has changed'));
    expect(within(screen.getByRole('tabpanel')).getByPlaceholderText('Paste your JSON here...')).toHaveValue('{"Id":4,"Name":"Widget"}');
    view.unmount();
    render(<WorkspaceRoute />);
    expect(await screen.findByRole('status')).toHaveTextContent('source contract has changed');
    expect(await within(screen.getByRole('tabpanel')).findByPlaceholderText('Paste your JSON here...')).toHaveValue('{"Id":4,"Name":"Widget"}');
    fireEvent.click(screen.getByRole('button', { name: 'Close Store API' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(await screen.findByRole('status')).toHaveTextContent('closed');
    expect(within(screen.getByRole('tabpanel')).getByPlaceholderText('Paste your JSON here...')).toHaveValue('{"Id":4,"Name":"Widget"}');
  });

  it('renders reusable component fields and saves edits from the generated form', async () => {
    const workspace = parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
    workspace.workbenches[2].entries[OPENAPI_STORAGE_KEY] = JSON.stringify({
      ...emptyOpenApi(),
      sources: [{
        id: 'models', workbenchId: 'schema', name: 'Models', format: 'schema', revision: '', diagnostics: [], proposals: [],
        schemas: {
          Request: { type: 'object', properties: { address: { $ref: '#/components/schemas/Address' } } },
          Address: { type: 'object', properties: { city: { type: 'string' } } },
        },
      }],
      endpoints: [{ ...newApiEndpoint(), method: 'post', path: '/addresses', requestSchema: 'Request' }],
    });
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
    render(<WorkspaceRoute />);
    fireEvent.click(await screen.findByRole('button', { name: 'Generate form' }));
    expect(await screen.findByRole('heading', { name: 'Instance Form' })).toBeInTheDocument();
    const city = await within(screen.getByRole('tabpanel')).findByPlaceholderText('Enter value...');
    fireEvent.change(city, { target: { value: 'Sydney' } });
    fireEvent.blur(city);
    fireEvent.click(screen.getByRole('button', { name: 'JSON Input' }));
    const input = await within(screen.getByRole('tabpanel')).findByPlaceholderText('Paste your JSON here...');
    expect(JSON.parse((input as HTMLTextAreaElement).value)).toEqual({ address: { city: 'Sydney' } });
    await waitFor(() => {
      const saved = parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
      expect(JSON.parse(saved.workbenches[3].entries['schema-sculptor-instance-json'])).toEqual({ address: { city: 'Sydney' } });
    });
  });

  it('refreshes changed sources without overwriting endpoint edits or duplicating proposals', async () => {
    const view = render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: 'API Design' });
    await addSource('entity');
    const first = within(screen.getByRole('group', { name: 'Endpoint 1' }));
    fireEvent.change(first.getByLabelText('Path'), { target: { value: '/custom-products' } });
    await waitFor(() => {
      const saved = parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
      expect(parseOpenApi(saved.workbenches[2].entries[OPENAPI_STORAGE_KEY]).endpoints[0].path).toBe('/custom-products');
    });
    view.unmount();
    const saved = parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
    const model = JSON.parse(saved.workbenches[0].entries['schema-sculptor-erd']);
    model.tables[0].columns.push({ name: 'Price', type: 'decimal', isNullable: false, isPrimaryKey: false, isForeignKey: false });
    saved.workbenches[0].entries['schema-sculptor-erd'] = JSON.stringify(model);
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(saved));
    render(<WorkspaceRoute />);
    expect(await screen.findByText(/Source has changed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh snapshot' }));
    await waitFor(() => expect(screen.queryByText(/Source has changed/)).not.toBeInTheDocument());
    expect(screen.getAllByRole('group', { name: /^Endpoint \d+/ })).toHaveLength(5);
    expect(within(screen.getByRole('group', { name: 'Endpoint 1' })).getByLabelText('Path')).toHaveValue('/custom-products');
    fireEvent.click(screen.getByRole('tab', { name: /^JSON$/ }));
    expect(screen.getByLabelText<HTMLTextAreaElement>('Generated OpenAPI document').value).toContain('"Price"');
  });
});
