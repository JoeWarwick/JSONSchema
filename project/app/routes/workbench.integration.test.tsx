import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Workbench from './workbench';

const STORAGE_KEY = 'schema-sculptor-schema';

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

  it('XML menu default-instance submenu passes selected rootElementName', async () => {
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
  <xs:element name="person" type="tns:PersonType" />
  <xs:element name="employee" type="tns:EmployeeType" />
  <xs:element name="note" type="tns:NoteType" />
</xs:schema>`;

    const originalFetch = global.fetch;
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String((input as Request).url);

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

      const xmlMenuTrigger = screen.getByText(/XML Document/i);
      fireEvent.pointerDown(xmlMenuTrigger, { bubbles: true, cancelable: true });

      const generateDefaultItem = await screen.findByRole('menuitem', { name: /Generate Default Instance/i });
      fireEvent.pointerMove(generateDefaultItem, { bubbles: true });
      fireEvent.click(generateDefaultItem);

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

});
