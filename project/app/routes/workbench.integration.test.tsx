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
    fireEvent.click(schemaTab);

    // Now the SchemaEditorForm should be rendered with root type 'object'
    await waitFor(() => {
      const typeLabels = screen.getAllByText('Type');
      expect(typeLabels.length).toBeGreaterThan(0);
      const typeLabel = typeLabels[0];
      const select = typeLabel.parentElement?.querySelector('select') as HTMLSelectElement | null;
      expect(select).toBeInTheDocument();
      expect(select?.value).toBe('object');
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

    // Wait for reducer to produce a resolved schema and for SchemaEditorForm to render
    await waitFor(() => {
      const badge = screen.getByTestId('schema-source-badge');
      expect(badge).toHaveTextContent(/resolved/i);
    });

    await waitFor(() => {
      const typeLabels = screen.getAllByText('Type');
      expect(typeLabels.length).toBeGreaterThan(0);
      const typeLabel = typeLabels[0];
      const select = typeLabel.parentElement?.querySelector('select') as HTMLSelectElement | null;
      expect(select).toBeInTheDocument();
      expect(select?.value).toBe('object');
    });
  });
});
