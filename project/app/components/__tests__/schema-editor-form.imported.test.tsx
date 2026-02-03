import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { SchemaEditorForm } from '../schema-editor-form';

describe('SchemaEditorForm imported indicator', () => {
  test('shows asterisk when schema is imported via $ref', () => {
    const schema = { $ref: 'https://example.com/user-profile.schema.json', title: 'User' };
    const onChange = jest.fn();
      const isSchemaImportedStub = (n: any) => !!(n && (n.$ref || n.__from || (Array.isArray(n?.allOf) && n.allOf.some((e: any) => e.$ref))));
      render(<SchemaEditorForm schema={schema as any} onChange={onChange} isSchemaImported={isSchemaImportedStub} />);
    // asterisk is rendered as a span with title containing 'Imported'
    const star = screen.getByTitle(/Imported/i);
    expect(star).toBeInTheDocument();
  });

  test('shows asterisk when schema is imported via allOf', () => {
    const schema = { allOf: [{ $ref: 'https://example.com/foo' }], title: 'X' };
    const onChange = jest.fn();
      const isSchemaImportedStub = (n: any) => !!(n && (n.$ref || n.__from || (Array.isArray(n?.allOf) && n.allOf.some((e: any) => e.$ref))));
      render(<SchemaEditorForm schema={schema as any} onChange={onChange} isSchemaImported={isSchemaImportedStub} />);
    const star = screen.getByTitle(/Imported/i);
    expect(star).toBeInTheDocument();
  });
});
