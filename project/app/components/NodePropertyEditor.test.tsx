import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NodePropertyEditor } from './NodePropertyEditor';

describe('NodePropertyEditor additionalProperties mode', () => {
  const makeNode = (data: Record<string, unknown>) => ({
    id: '1.test',
    type: 'property',
    position: { x: 0, y: 0 },
    data,
  } as any);

  it('defaults to schema mode for object nodes with additionalProperties schema object', () => {
    render(
      <NodePropertyEditor
        node={makeNode({
          label: 'env',
          type: 'object',
          additionalProperties: { type: 'string' },
        })}
        onChange={() => {}}
      />
    );

    expect(screen.getByRole('combobox', { name: 'additionalProperties' })).toHaveValue('schema');
  });

  it('defaults to schema mode for synthetic additionalProperties nodes', () => {
    render(
      <NodePropertyEditor
        node={makeNode({
          label: 'additionalProperties',
          type: 'object',
          isAdditionalProperties: true,
        })}
        onChange={() => {}}
      />
    );

    expect(screen.getByRole('combobox', { name: 'additionalProperties' })).toHaveValue('schema');
  });

  it('defaults to schema mode for variant object nodes with variantSchema.additionalProperties object', () => {
    render(
      <NodePropertyEditor
        node={makeNode({
          label: 'Object',
          type: 'object',
          variantSchema: {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
        })}
        onChange={() => {}}
      />
    );

    expect(screen.getByRole('combobox', { name: 'additionalProperties' })).toHaveValue('schema');
  });

  it('emits false, true and schema values from the 3-way selector', () => {
    const onChange = jest.fn();
    render(
      <NodePropertyEditor
        node={makeNode({
          label: 'env',
          type: 'object',
          additionalProperties: { type: 'string' },
        })}
        onChange={onChange}
      />
    );

    const modeSelect = screen.getByRole('combobox', { name: 'additionalProperties' });
    fireEvent.change(modeSelect, { target: { value: 'false' } });
    fireEvent.change(modeSelect, { target: { value: 'true' } });
    fireEvent.change(modeSelect, { target: { value: 'schema' } });

    expect(onChange).toHaveBeenNthCalledWith(1, expect.objectContaining({ additionalProperties: false }));
    expect(onChange).toHaveBeenNthCalledWith(2, expect.objectContaining({ additionalProperties: true }));
    expect(onChange).toHaveBeenNthCalledWith(3, expect.objectContaining({ additionalProperties: { type: 'string' } }));
  });

  it('restores remembered non-default schema when Schema is reselected', () => {
    const onChange = jest.fn();
    render(
      <NodePropertyEditor
        node={makeNode({
          label: 'env',
          type: 'object',
          additionalProperties: { type: 'string' },
        })}
        onChange={onChange}
      />
    );

    const modeSelect = screen.getByRole('combobox', { name: 'additionalProperties' });
    fireEvent.change(modeSelect, { target: { value: 'false' } });
    fireEvent.change(modeSelect, { target: { value: 'schema' } });

    expect(onChange).toHaveBeenNthCalledWith(1, expect.objectContaining({ additionalProperties: false }));
    expect(onChange).toHaveBeenNthCalledWith(2, expect.objectContaining({ additionalProperties: { type: 'string' } }));
  });
});
