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

    fireEvent.click(screen.getByRole('button', { name: /Schema Input/i }));

    const saveIntermediate = await screen.findByRole('button', { name: /Save Intermediate/i });
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

});
