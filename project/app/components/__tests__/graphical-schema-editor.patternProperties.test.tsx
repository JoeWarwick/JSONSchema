import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GraphicalSchemaEditor } from '../graphical-schema-editor';

describe('GraphicalSchemaEditor - patternProperties support', () => {
  it('renders pattern property nodes and round-trips edits to schema.patternProperties', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        jobs: {
          type: 'object',
          patternProperties: {
            '^job_': {
              type: 'object',
              properties: {
                step: { type: 'string' }
              }
            }
          }
        }
      }
    } as any;

    let latestSchema = testSchema;
    const handleChange = (s: any) => { latestSchema = s; };

    render(<GraphicalSchemaEditor schema={testSchema} onChange={handleChange} />);

    // The pattern node should appear with a label containing the regex (allow partial match)
    const patternNode = await screen.findByText((content) => /pattern:/i.test(content));
    expect(patternNode).toBeInTheDocument();

    // Select the pattern node to open the editor
    fireEvent.click(patternNode);

    // The Pattern Key editor should be shown
    const patternKeyInput = await screen.findByLabelText('Pattern Key');
    expect(patternKeyInput).toBeInTheDocument();

    // Change the pattern key to an invalid value and blur -> should show validation and NOT update schema
    fireEvent.change(patternKeyInput, { target: { value: '(' } });
    fireEvent.blur(patternKeyInput);
    const errorMsg = await screen.findByText('Invalid regular expression');
    expect(errorMsg).toBeInTheDocument();

    // Schema should still contain the original pattern key
    expect(Object.keys(latestSchema.properties.jobs.patternProperties)).toContain('^job_');

    // Now enter a valid value and blur - schema should update
    fireEvent.change(patternKeyInput, { target: { value: '^jobX_' } });
    fireEvent.blur(patternKeyInput);
    await waitFor(() => {
      const jobProps = latestSchema?.properties?.jobs || {};
      expect(jobProps.patternProperties).toBeDefined();
      expect(Object.keys(jobProps.patternProperties)).toContain('^jobX_');
      expect(Object.keys(jobProps.patternProperties)).not.toContain('^job_');
    });
  });
});