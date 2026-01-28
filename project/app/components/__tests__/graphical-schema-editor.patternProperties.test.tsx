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

    // The pattern node should appear with a concise label 'pattern'
    const patternNodes = await screen.findAllByText((content) => typeof content === 'string' && content.trim().toLowerCase() === 'pattern');
    expect(patternNodes.length).toBeGreaterThan(0);
    const patternNode = patternNodes.find(n => n.closest('[data-testid^="rf__node-"]')) || patternNodes[0];

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

    // Add an explicit test: invalid edit should NOT mutate the schema and should show helper text
    // Change to an invalid pattern and blur
    fireEvent.change(patternKeyInput, { target: { value: '(' } });
    fireEvent.blur(patternKeyInput);

    // The UI should show the validation error and helper text
    expect(await screen.findByText('Invalid regular expression')).toBeInTheDocument();
    expect(await screen.findByText('Pattern not saved until valid')).toBeInTheDocument();

    // Schema should still contain the original pattern key (no mutation)
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

  it('disables Add Property in context menu when additionalProperties is false and no patternProperties', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        jobs: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        }
      }
    } as any;

    render(<GraphicalSchemaEditor schema={testSchema} onChange={() => {}} />);

    // Right-click the 'jobs' node to open context menu
    const jobsNode = await screen.findByText('jobs');
    fireEvent.contextMenu(jobsNode);

    const addPropertyItem = await screen.findByRole('button', { name: 'Add Property' });
    expect(addPropertyItem).toBeDisabled();
  });
});