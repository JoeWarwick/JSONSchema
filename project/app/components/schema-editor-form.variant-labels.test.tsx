import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaEditorForm } from './schema-editor-form';
import { TooltipProvider } from './ui/tooltip/tooltip';

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
      <TooltipProvider>
        <SchemaEditorForm 
          schema={schema} 
          onChange={handleChange} 
          isSchemaImported={isSchemaImportedStub} 
        />
      </TooltipProvider>
    );

    // Check for "1. Event"
    expect(screen.getAllByText('1. Event')[0]).toBeInTheDocument();
    
    // Check for "2. Array<Event>"
    expect(screen.getAllByText('2. Array<Event>')[0]).toBeInTheDocument();
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

    render(
      <TooltipProvider>
        <SchemaEditorForm schema={schema} onChange={jest.fn()} isSchemaImported={isSchemaImportedStub} />
      </TooltipProvider>
    );

    expect(screen.getAllByText('1. Architecture')[0]).toBeInTheDocument();
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

    render(
      <TooltipProvider>
        <SchemaEditorForm schema={schema} onChange={jest.fn()} isSchemaImported={isSchemaImportedStub} />
      </TooltipProvider>
    );

    // Should fall back to Option labels if all parts are boring
    expect(screen.getAllByText('1. String')[0]).toBeInTheDocument();
    expect(screen.getAllByText('2. Object')[0]).toBeInTheDocument();
  });
});
