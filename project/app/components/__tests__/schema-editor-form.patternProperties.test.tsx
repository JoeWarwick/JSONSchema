import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaEditorForm } from '../schema-editor-form';

describe('SchemaEditorForm - patternProperties editor', () => {
  it('validates pattern key and renames pattern property on valid input', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        jobs: {
          type: 'object',
          patternProperties: {
            '^job_': { type: 'object', properties: { step: { type: 'string' } } }
          }
        }
      }
    } as any;

    let latest: any = testSchema;
    const handleChange = (s: any) => { latest = s; };

    render(<SchemaEditorForm schema={testSchema} onChange={handleChange} />);

    // The pattern key input should be present
    const keyInput = await screen.findByLabelText('pattern-key-^job_');
    expect(keyInput).toBeInTheDocument();

    // Enter invalid regex
    fireEvent.change(keyInput, { target: { value: '(' } });
    fireEvent.blur(keyInput);
    const err = await screen.findByText('Invalid regular expression');
    expect(err).toBeInTheDocument();

    // Schema should still have original key
    expect(Object.keys(latest.properties.jobs.patternProperties)).toContain('^job_');

    // Enter valid regex and blur
    fireEvent.change(keyInput, { target: { value: '^jobX_' } });
    fireEvent.blur(keyInput);

    await waitFor(() => {
      expect(latest.properties.jobs.patternProperties).toBeDefined();
      expect(Object.keys(latest.properties.jobs.patternProperties)).toContain('^jobX_');
      expect(Object.keys(latest.properties.jobs.patternProperties)).not.toContain('^job_');
    });
  });
});