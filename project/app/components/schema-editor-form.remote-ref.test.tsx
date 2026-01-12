import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaEditorForm } from './schema-editor-form';
import { resolveSchema } from '~/utils/schema-resolver';

describe('SchemaEditorForm with remote-ref resolved schema', () => {
  beforeAll(() => {
    (global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url === 'https://example.com/user-profile.schema.json' || url.endsWith('/user-profile.schema.json')) {
        const remoteSchema = {
          $id: 'https://example.com/user-profile.schema.json',
          type: 'object',
          properties: {
            firstName: { type: 'string' },
            phone: { type: 'string' }
          }
        };
        return {
          ok: true,
          headers: { get: (k: string) => 'application/json' },
          json: async () => remoteSchema,
          text: async () => JSON.stringify(remoteSchema),
        };
      }
      return { ok: false, status: 404, headers: { get: () => 'text/plain' }, text: async () => 'Not found' };
    });
  });

  afterAll(() => {
    delete (global as any).fetch;
  });

  it('resolves $ref and renders nested properties from the remote schema', async () => {
    const unresolved = {
      $id: 'https://example.com/health-record.schema.json',
      type: 'object',
      properties: {
        emergencyContact: { $ref: 'https://example.com/user-profile.schema.json' }
      }
    } as any;

    const resolved = await resolveSchema(unresolved as any);
    const handleChange = jest.fn();
    render(<SchemaEditorForm schema={resolved as any} onChange={handleChange} />);

    // The editor renders property name inputs for nested properties
    const firstNameInput = await screen.findByDisplayValue('firstName');
    const phoneInput = await screen.findByDisplayValue('phone');

    expect(firstNameInput).toBeInTheDocument();
    expect(phoneInput).toBeInTheDocument();
  });
});
