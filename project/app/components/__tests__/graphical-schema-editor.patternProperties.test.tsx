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

    // Change the pattern key to a new value and blur
    fireEvent.change(patternKeyInput, { target: { value: '^job2_' } });
    fireEvent.blur(patternKeyInput);

    // Wait for the schema emitted by the editor to include the updated key
    await waitFor(() => {
      const jobProps = latestSchema?.properties?.jobs || {};
      expect(jobProps.patternProperties).toBeDefined();
      expect(Object.keys(jobProps.patternProperties)).toContain('^job2_');
      expect(Object.keys(jobProps.patternProperties)).not.toContain('^job_');
    });
  });
});