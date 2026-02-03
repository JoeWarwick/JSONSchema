import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaEditorForm } from './schema-editor-form';

describe('SchemaEditorForm Polymorphic Labels', () => {
  const isSchemaImportedStub = (n: any) => !!(n && (n.$ref || n.__from || (Array.isArray(n?.allOf) && n.allOf.some((e: any) => e.$ref))));

  it('renders semantic labels from $ref for oneOf variants', async () => {
    const schema = {
      oneOf: [
        {
          $ref: '#/definitions/event',
          type: 'string', // even with type string, it should show 'Event'
          __from: '#/definitions/event' // simulating hydration provenance
        },
        {
          type: 'array',
          items: {
            $ref: '#/definitions/event',
            __from: '#/definitions/event'
          }
        }
      ]
    } as any;

    const handleChange = jest.fn();
    render(
      <SchemaEditorForm 
        schema={schema} 
        onChange={handleChange} 
        isSchemaImported={isSchemaImportedStub} 
      />
    );

    // Check for "1. Event"
    expect(screen.getByText('1. Event')).toBeInTheDocument();
    
    // Check for "2. Array<Event>"
    expect(screen.getByText('2. Array<Event>')).toBeInTheDocument();
  });

  it('renders labels from deep hydration provenance (__from)', async () => {
    const schema = {
      anyOf: [
        {
          // Fully hydrated but has provenance
          __from: 'https://github.com/schema.json#/definitions/architecture',
          type: 'string',
          enum: ['x64', 'ARM32']
        }
      ]
    } as any;

    render(<SchemaEditorForm schema={schema} onChange={jest.fn()} isSchemaImported={isSchemaImportedStub} />);

    expect(screen.getByText('1. Architecture')).toBeInTheDocument();
  });

  it('ignores boring structural names and generic filenames', async () => {
    const schema = {
      oneOf: [
        {
          $ref: 'common.schema.json#/definitions/string', // 'string' is boring
          type: 'string'
        },
        {
          $ref: 'type.json', // 'type' is boring
          type: 'object'
        }
      ]
    } as any;

    render(<SchemaEditorForm schema={schema} onChange={jest.fn()} isSchemaImported={isSchemaImportedStub} />);

    // Should fall back to Option labels if all parts are boring
    expect(screen.getByText('Option 1')).toBeInTheDocument();
    expect(screen.getByText('Option 2')).toBeInTheDocument();
  });
});
