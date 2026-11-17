import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Workbench } from './workbench';
import { parseMarkup } from '~/utils/markup';
import { toast } from 'sonner';

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const STORAGE_KEY = 'schema-sculptor-schema';

describe('Workbench ERD SQLite export', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  it('explains that sign-in is required before requesting a SQLite database', async () => {
    localStorage.setItem('schema-sculptor-erd', JSON.stringify({
      tables: [{
        id: 'Person',
        name: 'Person',
        clrName: 'Person',
        columns: [{ name: 'Id', type: 'int', isNullable: false, isPrimaryKey: true, isForeignKey: false }],
        navigations: [],
      }],
      relationships: [],
      sourceFiles: [],
      diagnostics: [],
    }));

    const originalFetch = global.fetch;
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ user: null, googleEnabled: false, csrfToken: 'test-csrf-token' }),
    } as unknown as Response));
    global.fetch = fetchMock as typeof fetch;

    try {
      render(<Workbench kind="erd" />);
      fireEvent.pointerDown(await screen.findByRole('menuitem', { name: /^ERD$/ }), { bubbles: true, cancelable: true });
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Generate SQLite database' }));

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
        'Sign in using Account before generating the SQLite database.',
      ));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/session', expect.anything());
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('sends the ERD model to the SQLite endpoint and downloads the database', async () => {
    const model = {
      tables: [{
        id: 'Person',
        name: 'Person',
        clrName: 'Person',
        columns: [{ name: 'Id', type: 'int', isNullable: false, isPrimaryKey: true, isForeignKey: false }],
        navigations: [],
      }],
      relationships: [],
      sourceFiles: [],
      diagnostics: [],
    };
    localStorage.setItem('schema-sculptor-erd', JSON.stringify(model));

    const originalFetch = global.fetch;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/auth/session') {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            user: { email: 'editor@example.test', emailConfirmed: true, hasPassword: true, hasGoogleLogin: false },
            googleEnabled: false,
            csrfToken: 'test-csrf-token',
          }),
        } as unknown as Response;
      }
      return {
        ok: true,
        blob: async () => new Blob(['sqlite database']),
      } as Response;
    });
    const createObjectURL = jest.fn<string, [Blob | MediaSource]>(() => 'blob:sqlite');
    let downloadedFilename = '';
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadedFilename = this.download;
    });
    global.fetch = fetchMock as typeof fetch;
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = jest.fn();

    try {
      render(<Workbench kind="erd" />);
      fireEvent.pointerDown(await screen.findByRole('menuitem', { name: /^ERD$/ }), { bubbles: true, cancelable: true });
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Generate SQLite database' }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      const apiCall = fetchMock.mock.calls.find(([input]) => String(input) === '/api/schema/generate-sqlite');
      const request = (apiCall as unknown as [RequestInfo | URL, RequestInit])[1];
      expect(apiCall).toEqual(['/api/schema/generate-sqlite', expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': 'test-csrf-token' },
      })]);
      expect(JSON.parse(request.body as string)).toMatchObject({
        workbenchId: expect.any(String),
        tables: model.tables,
        relationships: model.relationships,
      });
      expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      expect(downloadedFilename).toBe('schema-sculptor.sqlite');
    } finally {
      global.fetch = originalFetch;
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      click.mockRestore();
    }
  });
});

describe('Workbench integration - load unresolved $defs schema', () => {
  const unresolved = {
    $id: 'https://example.com/ecommerce.schema.json',
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $defs: {
      product: {
        $anchor: 'ProductSchema',
        type: 'object',
        properties: {
          name: { type: 'string' },
          price: { type: 'number', minimum: 0 }
        }
      },
      order: {
        $anchor: 'OrderSchema',
        type: 'object',
        properties: {
          orderId: { type: 'string' },
          items: { type: 'array', items: { $ref: '#ProductSchema' } }
        }
      }
    }
  } as any;

  beforeEach(() => {
    localStorage.clear();
  });

  it.each([
    ['xml', '<person xmlns="urn:person"><name>Jane</name></person>', 'application/xml', 'data.xml'],
    ['yaml', 'person:\n  name: Jane\n', 'text/yaml', 'data.yaml'],
    ['json', '{"person":{"name":"Jane"}}', 'application/json', 'data.json'],
  ])('exports the current %s text without parsing it as JSON', async (language, content, mime, filename) => {
    localStorage.setItem('schema-sculptor-markup-language', language);
    localStorage.setItem(`schema-sculptor-instance-${language}`, content);
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const create = jest.fn<string, [Blob | MediaSource]>(() => 'blob:export');
    URL.createObjectURL = create;
    URL.revokeObjectURL = jest.fn();
    let downloadedFilename = '';
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadedFilename = this.download;
    });
    try {
      render(<Workbench />);
      await screen.findByRole('button', { name: `${language.toUpperCase()} Input` });
      const input = await screen.findByPlaceholderText(`Paste your ${language.toUpperCase()} here...`);
      await waitFor(() => expect((input as HTMLTextAreaElement).value).toContain('Jane'));
      const exportedText = (input as HTMLTextAreaElement).value;
      const menuName = language === 'xml' ? 'XML Doc' : language === 'yaml' ? 'YAML Doc' : 'JSON Doc';
      fireEvent.pointerDown(screen.getByRole('menuitem', { name: menuName }), { bubbles: true, cancelable: true });
      fireEvent.click(await screen.findByRole('menuitem', { name: `Save ${language.toUpperCase()}` }));
      expect(create).toHaveBeenCalledTimes(1);
      const blob = create.mock.calls[0][0];
      if (!(blob instanceof Blob)) throw new Error('Expected an exported Blob');
      expect(blob.type).toBe(mime);
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
      });
      expect(text).toBe(exportedText);
      expect(downloadedFilename).toBe(filename);
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      click.mockRestore();
    }
  });

  it('persists namespace-qualified XML form edits and restores them on remount', async () => {
    const schema = parseMarkup(`
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
        xmlns:tns="urn:person" targetNamespace="urn:person" elementFormDefault="qualified">
        <xs:element name="person"><xs:complexType><xs:sequence>
          <xs:element name="firstName" type="xs:string"/>
          <xs:element name="address"><xs:complexType><xs:sequence>
            <xs:element name="street" type="xs:string"/>
          </xs:sequence></xs:complexType></xs:element>
        </xs:sequence></xs:complexType></xs:element>
      </xs:schema>`, 'xml');
    localStorage.setItem('schema-sculptor-markup-language', 'xml');
    localStorage.setItem('schema-sculptor-schema-xml', JSON.stringify(schema));
    localStorage.setItem('schema-sculptor-instance-xml',
      '<tns:person xmlns:tns="urn:person"><tns:firstName>Jane</tns:firstName>' +
      '<tns:address><tns:street>Old Street</tns:street></tns:address></tns:person>');

    const view = render(<Workbench />);
    fireEvent.click(await screen.findByRole('button', { name: /Instance Form/i }));
    const rootLabel = await screen.findByTestId(/xml-tag-.*person$/);
    fireEvent.click(within(rootLabel.parentElement!).getByRole('button'));
    fireEvent.change(await screen.findByTestId('xml-element-firstName-input'), { target: { value: 'Janet' } });
    const addressLabel = await screen.findByTestId(/xml-tag-.*address$/);
    fireEvent.click(within(addressLabel.parentElement!).getByRole('button'));
    fireEvent.change(await screen.findByTestId('xml-element-street-input'), { target: { value: 'New Street' } });
    expect(screen.getByTestId('xml-element-firstName-input')).toHaveValue('Janet');
    expect(screen.getByTestId('xml-element-street-input')).toHaveValue('New Street');

    fireEvent.click(screen.getByRole('button', { name: /XML Input/i }));
    const xml = (screen.getByPlaceholderText(/Paste your XML here/i) as HTMLTextAreaElement).value;
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    expect(document.getElementsByTagName('tns:firstName')[0].textContent?.trim()).toBe('Janet');
    expect(document.getElementsByTagName('tns:street')[0].textContent?.trim()).toBe('New Street');
    expect(document.getElementsByTagName('firstName')).toHaveLength(0);
    expect(document.getElementsByTagName('street')).toHaveLength(0);
    await waitFor(() => expect(localStorage.getItem('schema-sculptor-instance-xml')).toBe(xml));

    view.unmount();
    render(<Workbench />);
    fireEvent.click(await screen.findByRole('button', { name: /Instance Form/i }));
    const restoredRoot = await screen.findByTestId(/xml-tag-.*person$/);
    fireEvent.click(within(restoredRoot.parentElement!).getByRole('button'));
    expect(await screen.findByTestId('xml-element-firstName-input')).toHaveValue('Janet');
    const restoredAddress = await screen.findByTestId(/xml-tag-.*address$/);
    fireEvent.click(within(restoredAddress.parentElement!).getByRole('button'));
    expect(await screen.findByTestId('xml-element-street-input')).toHaveValue('New Street');
  });

  it('loads and saves an ERD-origin XML graph through the authenticated runtime routes', async () => {
    const schema = parseMarkup(`
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:element name="Person"><xs:complexType><xs:sequence>
          <xs:element name="Id" type="xs:integer" minOccurs="0"/>
          <xs:element name="Name" type="xs:string"/>
        </xs:sequence></xs:complexType></xs:element>
      </xs:schema>`, 'xml');
    localStorage.setItem('schema-sculptor-markup-language', 'xml');
    localStorage.setItem('schema-sculptor-schema-xml', JSON.stringify(schema));
    localStorage.setItem('schema-sculptor-instance-xml', '<Person><Name>New person</Name></Person>');
    localStorage.setItem('schema-sculptor-erd-origin', JSON.stringify({
      workbenchId: 'erd-db',
      rootTableId: 'person',
    }));

    const originalFetch = global.fetch;
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/schema/erd-database/erd-db') {
        return {
          ok: true,
          json: async () => ({ tables: [{ id: 'person', records: [{ rowId: 5 }, { rowId: 6 }] }] }),
        } as Response;
      }
      if (url === '/schemas/XMLSchema.xsd') {
        return {
          ok: true,
          text: async () => '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"/>',
        } as Response;
      }
      if (url === '/api/schema/erd-xml/erd-db/person/5' && (!init?.method || init.method === 'GET')) {
        return {
          ok: true,
          headers: { get: (name: string) => name === 'X-ERD-Row-Id' ? '5' : null },
          text: async () => '<Person><Id>5</Id><Name>Existing</Name></Person>',
        } as unknown as Response;
      }
      if (url === '/api/schema/erd-xml/erd-db/person/6' && (!init?.method || init.method === 'GET')) {
        return {
          ok: true,
          headers: { get: (name: string) => name === 'X-ERD-Row-Id' ? '6' : null },
          text: async () => '<Person><Id>6</Id><Name>Second person</Name></Person>',
        } as unknown as Response;
      }
      if (url === '/api/schema/erd-xml/erd-db/person/5' && init?.method === 'PUT') {
        return {
          ok: true,
          headers: { get: (name: string) => name === 'X-ERD-Row-Id' ? '5' : null },
          text: async () => '<Person><Id>5</Id><Name>Updated</Name></Person>',
        } as unknown as Response;
      }
      if (url === '/api/auth/session') {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            user: { email: 'editor@example.test', emailConfirmed: true, hasPassword: true, hasGoogleLogin: false },
            googleEnabled: false,
            csrfToken: 'test-csrf-token',
          }),
        } as unknown as Response;
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    try {
      render(<Workbench />);
      fireEvent.click(await screen.findByRole('button', { name: /Instance Form/i }));
      const newGraphButton = await screen.findByRole('button', { name: 'New graph' });
      await waitFor(() => expect(newGraphButton).toBeEnabled());
      fireEvent.click(newGraphButton);
      const rootLabel = await screen.findByTestId(/xml-tag-.*Person$/);
      fireEvent.click(within(rootLabel.parentElement!).getByRole('button', { name: 'Expand' }));
      const nameInput = await screen.findByTestId('xml-element-Name-input');
      await waitFor(() => expect(nameInput).toHaveValue('New person'));

      const recordSelector = await screen.findByRole('combobox', { name: 'ERD record' });
      fireEvent.change(recordSelector, { target: { value: '5' } });
      fireEvent.click(screen.getByRole('button', { name: 'Load from ERD' }));
      await waitFor(() => expect(nameInput).toHaveValue('Existing'));
      fireEvent.change(nameInput, { target: { value: 'Updated' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save to ERD' }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        '/api/schema/erd-xml/erd-db/person/5',
        expect.objectContaining({ method: 'PUT', headers: expect.any(Object) }),
      ));
      const saveCall = fetchMock.mock.calls.find(([input, init]) =>
        String(input) === '/api/schema/erd-xml/erd-db/person/5' && init?.method === 'PUT');
      expect(saveCall).toBeDefined();
      expect(new Headers(saveCall?.[1]?.headers).get('X-CSRF-TOKEN')).toBe('test-csrf-token');
      const savedXml = new DOMParser().parseFromString(String(saveCall?.[1]?.body), 'application/xml');
      expect(savedXml.getElementsByTagName('Name')[0].textContent?.trim()).toBe('Updated');

      fireEvent.click(screen.getByRole('button', { name: 'Next ERD record' }));
      await waitFor(() => expect(nameInput).toHaveValue('Second person'));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('clears invalid persisted XML instance content on hydration', async () => {
    localStorage.setItem('schema-sculptor-markup-language', 'xml');
    localStorage.setItem('schema-sculptor-instance-xml', 'null');

    render(<Workbench />);

    await waitFor(() => {
      expect(localStorage.getItem('schema-sculptor-instance-xml')).toBeNull();
    });

    const xmlInputTab = screen.getByRole('button', { name: /XML Input/i });
    fireEvent.click(xmlInputTab);

    const xmlTextarea = screen.getByPlaceholderText(/Paste your XML here/i) as HTMLTextAreaElement;
    expect(xmlTextarea).toBeInTheDocument();
    expect(xmlTextarea.value).toBe('');
  });

  it('switching from JSON/YAML into XML clears invalid persisted XML instance content', async () => {
    localStorage.setItem('schema-sculptor-markup-language', 'json');
    localStorage.setItem('schema-sculptor-instance-xml', 'null');

    render(<Workbench />);

    const xmlToggle = screen.getByRole('radio', { name: /^XML$/i });
    fireEvent.click(xmlToggle);

    await waitFor(() => {
      expect(localStorage.getItem('schema-sculptor-instance-xml')).toBeNull();
    });

    const xmlInputTab = screen.getByRole('button', { name: /XML Input/i });
    fireEvent.click(xmlInputTab);

    const xmlTextarea = screen.getByPlaceholderText(/Paste your XML here/i) as HTMLTextAreaElement;
    expect(xmlTextarea).toBeInTheDocument();
    expect(xmlTextarea.value).toBe('');
  });

  it('does not read persisted storage during the initial render pass', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(unresolved));
    const getItemSpy = jest.spyOn(Storage.prototype, 'getItem');

    render(<Workbench />);

    expect(getItemSpy).not.toHaveBeenCalled();
    getItemSpy.mockRestore();
  });

  it('renders SchemaEditorForm root type as object when schema loaded from storage', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(unresolved));
    render(<Workbench />);

    // Wait for reducer to produce a resolved schema before interacting with the UI
    await waitFor(() => {
      const badge = screen.getByTestId('schema-source-badge');
      expect(badge).toHaveTextContent(/resolved/i);
    });

    // Open the Schema Form tab
    const schemaTab = screen.getByRole('button', { name: /Schema Form/i });
    expect(schemaTab).toBeInTheDocument();
    fireEvent.click(schemaTab);

    // The SchemaEditorForm renders Object buttons for the root type
    // Wait for these to appear after clicking the Schema Form tab
    await waitFor(() => {
      const objectBtns = screen.getAllByRole('button', { name: /^Object$/ });
      expect(objectBtns.length).toBeGreaterThan(0);
      // The first one should be the root object button
      expect(objectBtns[0]).toHaveStyle('font-weight: 700');
    });
  });

  it('shows XML schema root add buttons inferred from the XSD walk', async () => {
    const xmlSchemaMetadata = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'schemas', 'XMLSchema.xsd'), 'utf-8');
    const originalFetch = global.fetch;
    (global as any).fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String((input as Request).url);
      if (url === '/schemas/XMLSchema.xsd') {
        return {
          ok: true,
          text: async () => xmlSchemaMetadata,
        } as Response;
      }
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Not Found',
      } as Response;
    });

    const xmlSchema = parseMarkup(`
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:group name="schemaTop">
          <xs:choice>
            <xs:element ref="xs:element"/>
            <xs:element ref="xs:attribute"/>
            <xs:element ref="xs:notation"/>
          </xs:choice>
        </xs:group>
        <xs:group name="redefinable">
          <xs:choice>
            <xs:element ref="xs:simpleType"/>
            <xs:element ref="xs:complexType"/>
            <xs:element ref="xs:attributeGroup"/>
          </xs:choice>
        </xs:group>
      </xs:schema>
    `, 'xml') as any;

    localStorage.setItem('schema-sculptor-markup-language', 'xml');
    localStorage.setItem('schema-sculptor-schema-xml', JSON.stringify(xmlSchema));
    render(<Workbench />);

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /^XML$/i })).toHaveAttribute('aria-checked', 'true');
    });

    fireEvent.click(await screen.findByRole('button', { name: /Schema Form/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Element/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Add ComplexType/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Add SimpleType/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Add Group/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Add Notation/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Add AttributeGroup/i })).toBeInTheDocument();
    });

    (global as any).fetch = originalFetch;
  });

  it('updates UI when uploading a schema file', async () => {
    render(<Workbench />);

    // Open Schema Form tab first, then upload the file
    const schemaTab = screen.getByRole('button', { name: /Schema Form/i });
    fireEvent.click(schemaTab);

    // Find the hidden file input and simulate uploading JSON content
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).toBeTruthy();
    const file = new File([JSON.stringify(unresolved)], 'schema.json', { type: 'application/json' });
    // fire change event to load schema into reducer
    fireEvent.change(fileInput!, { target: { files: [file] } });

    // Wait for reducer to produce a resolved schema
    await waitFor(() => {
      const badge = screen.getByTestId('schema-source-badge');
      expect(badge).toHaveTextContent(/resolved/i);
    });

    // The SchemaEditorForm renders Object buttons for the root type
    // Wait for these to appear after the schema is resolved
    await waitFor(() => {
      const objectBtns = screen.getAllByRole('button', { name: /^Object$/ });
      expect(objectBtns.length).toBeGreaterThan(0);
      expect(objectBtns[0]).toHaveStyle('font-weight: 700');
    });
  });

  it('Save Intermediate includes definition maps in downloaded schema', async () => {
    const draft7WithDefinitions = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        concurrency: { $ref: '#/definitions/concurrency' }
      },
      definitions: {
        concurrency: {
          type: 'object',
          properties: {
            group: { type: 'string' }
          },
          required: ['group']
        }
      }
    } as any;

    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft7WithDefinitions));

    const OriginalBlob = (global as any).Blob;
    class MockBlob {
      private readonly textValue: string;
      readonly type: string;
      readonly size: number;
      constructor(parts: any[], options?: { type?: string }) {
        this.textValue = (parts || []).map((p) => (typeof p === 'string' ? p : String(p))).join('');
        this.type = options?.type || '';
        this.size = this.textValue.length;
      }
      text() {
        return Promise.resolve(this.textValue);
      }
    }
    (global as any).Blob = MockBlob as any;

    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = jest.fn();

    const originalCreateObjectURL = (URL as any).createObjectURL;
    const originalRevokeObjectURL = (URL as any).revokeObjectURL;
    const createObjectURLSpy = jest.fn(() => 'blob:mock-schema');
    const revokeObjectURLSpy = jest.fn(() => {});
    (URL as any).createObjectURL = createObjectURLSpy;
    (URL as any).revokeObjectURL = revokeObjectURLSpy;

    render(<Workbench />);

    await waitFor(() => {
      const badge = screen.getByTestId('schema-source-badge');
      expect(badge).toHaveTextContent(/resolved/i);
    });

    // Open the Schema menu in the menu bar via pointer interaction (Radix Menubar uses pointerdown)
    const schemaTrigger = screen.getByRole('menuitem', { name: /^Schema$/ });
    fireEvent.pointerDown(schemaTrigger, { bubbles: true, cancelable: true });

    const saveIntermediate = await screen.findByRole('menuitem', { name: /Save Intermediate/i });
    fireEvent.click(saveIntermediate);

    await waitFor(async () => {
      expect(createObjectURLSpy).toHaveBeenCalled();
      const firstArg = (createObjectURLSpy.mock.calls[0] as any)[0] as Blob;
      expect(firstArg).toBeDefined();
      const text = await firstArg?.text();
      expect(text).toContain('"definitions"');
      expect(text).toContain('"concurrency"');
    });

    (URL as any).createObjectURL = originalCreateObjectURL;
    (URL as any).revokeObjectURL = originalRevokeObjectURL;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
    (global as any).Blob = OriginalBlob;
  });

  it('clears persisted local storage from dev schema menu action', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(unresolved));
    localStorage.setItem('schema-sculptor-instance', JSON.stringify({ foo: 'bar' }));
    localStorage.setItem('schema-sculptor-deref-complete', JSON.stringify({ ts: Date.now() }));
    localStorage.setItem('schema-sculptor-deref-error', JSON.stringify({ message: 'x' }));
    localStorage.setItem('json-instance-variants:v1:test', JSON.stringify({}));

    render(<Workbench />);

    const schemaTrigger = screen.getByRole('menuitem', { name: /^Schema$/ });
    fireEvent.pointerDown(schemaTrigger, { bubbles: true, cancelable: true });

    const clearStorageItem = await screen.findByRole('menuitem', { name: /Clear local storage \(dev\)/i });
    fireEvent.click(clearStorageItem);

    await waitFor(() => {
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(localStorage.getItem('schema-sculptor-instance')).toBeNull();
      expect(localStorage.getItem('schema-sculptor-deref-complete')).toBeNull();
      expect(localStorage.getItem('schema-sculptor-deref-error')).toBeNull();
      expect(localStorage.getItem('json-instance-variants:v1:test')).toBeNull();
    });
  });

  it('XML instance form hides root pills and the default-instance menu selects a root', async () => {
    const xmlSchemaMetadata = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'schemas', 'XMLSchema.xsd'), 'utf-8');
    const demoXsd = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           xmlns:tns="http://example.com/demo"
           targetNamespace="http://example.com/demo"
           elementFormDefault="qualified"
           attributeFormDefault="unqualified">
  <xs:complexType name="PersonType">
    <xs:sequence>
      <xs:element name="firstName" type="xs:string" />
    </xs:sequence>
  </xs:complexType>
  <xs:complexType name="EmployeeType">
    <xs:complexContent>
      <xs:extension base="tns:PersonType">
        <xs:sequence>
          <xs:element name="employeeNumber" type="xs:string" />
        </xs:sequence>
      </xs:extension>
    </xs:complexContent>
  </xs:complexType>
  <xs:complexType name="NoteType">
    <xs:simpleContent>
      <xs:extension base="xs:string" />
    </xs:simpleContent>
  </xs:complexType>
  <xs:element name="abstractRoot" abstract="true" />
  <xs:element name="person" type="tns:PersonType" />
  <xs:element name="employee" type="tns:EmployeeType" />
  <xs:element name="substitutedPerson" type="tns:PersonType" substitutionGroup="tns:abstractRoot" />
  <xs:element name="note" type="tns:NoteType" />
</xs:schema>`;

    const originalFetch = global.fetch;
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String((input as Request).url);

      if (url === '/schemas/XMLSchema.xsd') {
        return {
          ok: true,
          text: async () => xmlSchemaMetadata,
        } as Response;
      }

      if (url === '/schemas/xml-form-controls-demo.xsd') {
        return {
          ok: true,
          text: async () => demoXsd,
        } as Response;
      }

      if (url === '/api/schema/default-instance') {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const root = body.rootElementName || 'person';
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ xml: `<${root} xmlns="http://example.com/demo"></${root}>`, warnings: [] }),
          text: async () => '',
        } as Response;
      }

      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Not Found',
      } as Response;
    });

    (global as any).fetch = fetchMock;

    try {
      render(<Workbench />);

      const xmlToggle = screen.getByRole('radio', { name: /^XML$/i });
      fireEvent.click(xmlToggle);

      const schemaFormTab = await screen.findByRole('button', { name: /Schema Form/i });
      fireEvent.click(schemaFormTab);

      const loadDemoButton = await screen.findByRole('button', { name: /Load demo controls XSD/i });
      fireEvent.click(loadDemoButton);

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith('/api/schema/default-instance', expect.anything());
      });

      fetchMock.mockClear();

      const instanceFormTab = await screen.findByRole('button', { name: /Instance Form/i });
      fireEvent.click(instanceFormTab);

      expect(screen.queryByRole('button', { name: /^\+\s*person\b/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^\+\s*employee\b/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^\+\s*note\b/i })).not.toBeInTheDocument();

      const xmlMenuTrigger = screen.getByRole('menuitem', { name: 'XML Doc' });
      fireEvent.pointerDown(xmlMenuTrigger, { bubbles: true, cancelable: true });

      const generateDefaultItem = await screen.findByRole('menuitem', { name: /Generate Default Instance/i });
      fireEvent.pointerMove(generateDefaultItem, { bubbles: true });
      fireEvent.click(generateDefaultItem);

      expect(screen.queryByRole('menuitem', { name: /^abstractRoot$/i })).not.toBeInTheDocument();
      expect(await screen.findByRole('menuitem', { name: /^substitutedPerson$/i })).toBeInTheDocument();

      const employeeMenuItem = await screen.findByRole('menuitem', { name: /^employee$/i });
      fireEvent.click(employeeMenuItem);

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith('/api/schema/default-instance', expect.anything());
      });

      const apiCall = fetchMock.mock.calls.find((call) => call[0] === '/api/schema/default-instance');
      expect(apiCall).toBeTruthy();

      const requestBody = JSON.parse(String((apiCall as any)[1]?.body || '{}'));
      expect(requestBody.rootElementName).toBe('employee');
    } finally {
      (global as any).fetch = originalFetch;
    }
  });

  it('excludes members of abstract XSLT child groups from roots but keeps other concrete globals', async () => {
    const xsltSchema = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'schemas', 'schema-for-xslt20.xsd'), 'utf-8');
    const xmlSchemaMetadata = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'schemas', 'XMLSchema.xsd'), 'utf-8');
    localStorage.setItem('schema-sculptor-markup-language', 'xml');
    localStorage.setItem('schema-sculptor-schema-xml', JSON.stringify(parseMarkup(xsltSchema, 'xml')));

    const originalFetch = global.fetch;
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String((input as Request).url);
      if (url === '/schemas/XMLSchema.xsd') {
        return { ok: true, text: async () => xmlSchemaMetadata } as Response;
      }
      if (url === '/api/schema/default-instance') {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            xml: `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="2.0"/>`,
            warnings: [],
          }),
          text: async () => '',
        } as Response;
      }
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Not Found',
      } as Response;
    });

    (global as any).fetch = fetchMock;
    try {
      render(<Workbench />);

      await waitFor(() => {
        const call = fetchMock.mock.calls.find((entry) => entry[0] === '/api/schema/default-instance');
        expect(call).toBeTruthy();
        expect(JSON.parse(String((call as any)[1]?.body || '{}')).rootElementName).toBe('stylesheet');
      });

      const xmlMenuTrigger = screen.getByRole('menuitem', { name: 'XML Doc' });
      fireEvent.pointerDown(xmlMenuTrigger, { bubbles: true, cancelable: true });
      const generateDefaultItem = await screen.findByRole('menuitem', { name: /Generate Default Instance/i });
      fireEvent.pointerMove(generateDefaultItem, { bubbles: true });

      expect(await screen.findByRole('menuitem', { name: /^stylesheet$/i })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: /^transform$/i })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /^analyze-string$/i })).not.toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: /^variable$/i })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /^declaration$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /^instruction$/i })).not.toBeInTheDocument();

      const menuItems = screen.getAllByRole('menuitem');
      const stylesheetIndex = menuItems.findIndex((item) => item.textContent?.trim() === 'stylesheet');
      const paramIndex = menuItems.findIndex((item) => item.textContent?.trim() === 'param');
      expect(stylesheetIndex).toBeGreaterThanOrEqual(0);
      expect(paramIndex).toBeGreaterThan(stylesheetIndex);
    } finally {
      (global as any).fetch = originalFetch;
    }
  });

  it('Schema Form keeps ColorType enumerations visible after loading demo XSD', async () => {
    const xmlSchemaMetadata = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'schemas', 'XMLSchema.xsd'), 'utf-8');
    const demoXsd = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'schemas', 'xml-form-controls-demo.xsd'), 'utf-8');

    const originalFetch = global.fetch;
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String((input as Request).url);

      if (url === '/schemas/XMLSchema.xsd') {
        return {
          ok: true,
          text: async () => xmlSchemaMetadata,
        } as Response;
      }

      if (url === '/schemas/xml-form-controls-demo.xsd') {
        return {
          ok: true,
          text: async () => demoXsd,
        } as Response;
      }

      if (url === '/api/schema/default-instance') {
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({ xml: '', warnings: [] }),
          text: async () => '',
        } as Response;
      }

      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Not Found',
      } as Response;
    });

    (global as any).fetch = fetchMock;

    try {
      render(<Workbench />);

      fireEvent.click(screen.getByRole('radio', { name: /^XML$/i }));
      fireEvent.click(await screen.findByRole('button', { name: /Schema Form/i }));

      const loadButtons = await screen.findAllByRole('button', { name: /Load demo controls XSD/i });
      fireEvent.click(loadButtons[0]);

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith('/schemas/xml-form-controls-demo.xsd');
      });

      const rootTag = await screen.findByTestId('xml-tag-xs_schema');
      const rootHeader = rootTag.parentElement?.parentElement;
      const rootToggle = rootHeader?.querySelector('button') as HTMLButtonElement | null;
      const rootIconClass = rootToggle?.querySelector('svg')?.getAttribute('class') || '';
      if (rootToggle && rootIconClass.includes('chevron-right')) {
        fireEvent.click(rootToggle);
      }

      const colorTypeChip = await screen.findByText('ColorType', { exact: true });
      fireEvent.click(within(colorTypeChip.parentElement!).getByRole('button', { name: 'Expand' }));
      const colorTypeName = await screen.findByDisplayValue('ColorType');
      const colorTypeEditor = colorTypeName.closest('form')!.parentElement!.parentElement!;

      for (let depth = 0; depth < 5; depth += 1) {
        const expanders = within(colorTypeEditor).queryAllByRole('button', { name: 'Expand' });
        if (expanders.length === 0) break;
        expanders.forEach(button => fireEvent.click(button));
      }

      await waitFor(() => {
        for (const color of ['red', 'green', 'blue']) {
          expect(within(colorTypeEditor).getByDisplayValue(color)).toBeVisible();
        }
        expect(within(colorTypeEditor).queryByText(/Enumeration Values/)).not.toBeInTheDocument();
      });
    } finally {
      (global as any).fetch = originalFetch;
    }
  }, 30000);

});
