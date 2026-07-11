import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import schemastoreWorkflow from '../test-fixtures/schemastore-workflow.json';
import Workbench from './workbench';

const { TextEncoder, TextDecoder } = require('util');
Object.assign(global, { TextEncoder, TextDecoder });
const { renderToString } = require('react-dom/server');

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

  it('does not read persisted storage during the initial render pass', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(unresolved));
    const getItemSpy = jest.spyOn(Storage.prototype, 'getItem');

    render(<Workbench />);

    expect(getItemSpy).not.toHaveBeenCalled();
    getItemSpy.mockRestore();
  });

  it('restores the raw saved instance text without reserializing it', async () => {
    const rawInstance = '{"alpha":1,"beta":{"nested":true}}';
    localStorage.setItem(STORAGE_KEY, JSON.stringify(unresolved));
    localStorage.setItem('schema-sculptor-instance', rawInstance);

    render(<Workbench />);

    await waitFor(() => {
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      expect(textarea.value).toBe(rawInstance);
    });
  });

  it('rehydrates the GitHub workflow schema and a simple myStyles/myHtml instance from localStorage', async () => {
    const workflowInstance = {
      name: 'demo-workflow',
      myStyles: 'body { color: #123456; }',
      myHtml: '<div>hello</div>',
      on: 'push',
      jobs: {
        build: {
          'runs-on': 'ubuntu-latest',
          steps: [
            { run: 'echo hi' }
          ]
        }
      }
    } as any;

    localStorage.setItem(STORAGE_KEY, JSON.stringify(schemastoreWorkflow));
    localStorage.setItem('schema-sculptor-instance', JSON.stringify(workflowInstance));

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      render(<Workbench />);

      await waitFor(() => {
        const badge = screen.getByTestId('schema-source-badge');
        expect(badge).toHaveTextContent(/resolved/i);
      });

      const textarea = await screen.findByRole('textbox') as HTMLTextAreaElement;
      expect(textarea.value).toContain('"myStyles"');
      expect(textarea.value).toContain('"myHtml"');

      const hasStackOverflow = errorSpy.mock.calls.some((args) =>
        args.some((arg) => typeof arg === 'string' && arg.includes('Maximum call stack size exceeded'))
      );

      expect(hasStackOverflow).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('does not emit a useLayoutEffect warning during server rendering', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      renderToString(<Workbench />);

      const containsWarning = errorSpy.mock.calls.some((args) => {
        const [firstArg] = args;
        return typeof firstArg === 'string' && firstArg.includes('useLayoutEffect does nothing on the server');
      });

      expect(containsWarning).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('renders SchemaEditorForm root type as object when schema loaded from storage', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(unresolved));
    render(<Workbench />);

    // Wait for reducer to produce a resolved schema before interacting with the UI
    await waitFor(() => {
      const badge = screen.getByTestId('schema-source-badge');
      expect(badge).toHaveTextContent(/resolved/i);
    });

    // Open the Schema Input tab
    const schemaTab = screen.getByRole('button', { name: /Schema Input/i });
    expect(schemaTab).toBeInTheDocument();
    fireEvent.click(schemaTab);

    // The SchemaEditorForm renders Object buttons for the root type
    // Wait for these to appear after clicking the Schema Input tab
    await waitFor(() => {
      const objectBtns = screen.getAllByRole('button', { name: /^Object$/ });
      expect(objectBtns.length).toBeGreaterThan(0);
      // The first one should be the root object button
      expect(objectBtns[0]).toHaveStyle('font-weight: 700');
    });
  });

  it('updates UI when uploading a schema file', async () => {
    render(<Workbench />);

    // Open Schema Input tab first, then upload the file
    const schemaTab = screen.getByRole('button', { name: /Schema Input/i });
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

});
