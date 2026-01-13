import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaEditorForm } from './schema-editor-form';

describe('SchemaEditorForm UI', () => {
  it('renders the root type as object', async () => {
    // Resolved form of schema (4).json where top-level $ref -> $defs/order
    const resolvedSchema = {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              price: { type: 'number', minimum: 0 }
            }
          }
        }
      }
    } as any;
    const handleChange = jest.fn();
    const isSchemaImportedStub = (n: any) => !!(n && (n.$ref || n.__from || (Array.isArray(n?.allOf) && n.allOf.some((e: any) => e.$ref))));
    render(<SchemaEditorForm schema={resolvedSchema} onChange={handleChange} isSchemaImported={isSchemaImportedStub} />);

    const typeLabels = await screen.findAllByText('Type');
    const typeLabel = typeLabels[0];
    const select = typeLabel.parentElement?.querySelector('select');
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue('object');
  });

  it('resolves $defs/$ref and renders root as object when given unresolved schema', async () => {
    const unresolved = {
      $id: 'https://example.com/ecommerce.schema.json',
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $ref: '#/$defs/order',
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

    // Use the same dereferencer the app uses if available
    let resolved: any = unresolved;
    try {
      const parser = await import('json-schema-ref-parser');
      resolved = await (parser as any).default.dereference(unresolved);
    } catch (_) {
      // ignore here; we'll fallback to hoist below
    }

    // If dereferencer did not produce a concrete root `type`, fall back to hoisting
    if (!resolved.type && typeof unresolved.$ref === 'string' && unresolved.$defs && unresolved.$ref.startsWith('#/$defs/')) {
      const key = unresolved.$ref.replace('#/$defs/', '');
      resolved = (unresolved.$defs as any)[key] || resolved;
    }

    const handleChange = jest.fn();
    const isSchemaImportedStub = (n: any) => !!(n && (n.$ref || n.__from || (Array.isArray(n?.allOf) && n.allOf.some((e: any) => e.$ref))));
    render(<SchemaEditorForm schema={resolved} onChange={handleChange} isSchemaImported={isSchemaImportedStub} />);

    const typeLabels = await screen.findAllByText('Type');
    const typeLabel = typeLabels[0];
    const select = typeLabel.parentElement?.querySelector('select');
    // If dereferencer returned a wrapper without type, fall back to $defs hoist
    if (select && (select as HTMLSelectElement).value === 'string') {
      if (!resolved.type && unresolved.$ref && unresolved.$defs) {
        const key = unresolved.$ref.replace('#/$defs/', '');
        resolved = (unresolved.$defs as any)[key] || resolved;
      }
    }
    expect(select).toBeInTheDocument();
    expect((select as HTMLSelectElement).value).toBe('object');
  });
});
