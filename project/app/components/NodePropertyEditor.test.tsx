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

  it('defaults to false mode for synthetic additionalProperties nodes without explicit value', () => {
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

    expect(screen.getByRole('combobox', { name: 'additionalProperties' })).toHaveValue('false');
  });

  it('uses schema mode for synthetic additionalProperties nodes with explicit schema object', () => {
    render(
      <NodePropertyEditor
        node={makeNode({
          label: 'additionalProperties',
          type: 'object',
          isAdditionalProperties: true,
          additionalProperties: { type: 'string' },
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

describe('NodePropertyEditor min/max properties facets', () => {
  const makeNode = (data: Record<string, unknown>) => ({
    id: '1.test',
    type: 'property',
    position: { x: 0, y: 0 },
    data,
  } as any);

  it('shows Min/Max Properties facet actions for object type only', () => {
    const { unmount } = render(
      <NodePropertyEditor
        node={makeNode({
          label: 'obj',
          type: 'object',
        })}
        onChange={() => {}}
      />
    );

    expect(screen.getByRole('button', { name: '+ Min Properties' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Max Properties' })).toBeInTheDocument();

    unmount();
    render(
      <NodePropertyEditor
        node={makeNode({
          label: 'str',
          type: 'string',
        })}
        onChange={() => {}}
      />
    );

    expect(screen.queryByRole('button', { name: '+ Min Properties' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Max Properties' })).toBeNull();
  });

  it('emits minProperties and maxProperties when facet actions are used', () => {
    const onChange = jest.fn();
    render(
      <NodePropertyEditor
        node={makeNode({
          label: 'obj',
          type: 'object',
        })}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '+ Min Properties' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Max Properties' }));

    expect(onChange).toHaveBeenNthCalledWith(1, expect.objectContaining({ minProperties: 0 }));
    expect(onChange).toHaveBeenNthCalledWith(2, expect.objectContaining({ maxProperties: 0 }));
  });

  it('refreshes maxProperties input when selected node data updates with same id', () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <NodePropertyEditor
        node={makeNode({
          label: 'jobs',
          type: 'object',
          minProperties: 1,
        })}
        onChange={onChange}
      />
    );

    expect(screen.getByRole('button', { name: '+ Max Properties' })).toBeInTheDocument();

    rerender(
      <NodePropertyEditor
        node={makeNode({
          label: 'jobs',
          type: 'object',
          minProperties: 1,
          maxProperties: 1,
        })}
        onChange={onChange}
      />
    );

    expect(screen.getByRole('spinbutton', { name: 'Max Properties' })).toHaveValue(1);
  });

  it('can transition from no node to a selected node without error', () => {
    const onChange = jest.fn();
    const { rerender } = render(<NodePropertyEditor node={null} onChange={onChange} />);

    expect(screen.getByText('Select a node to edit its properties.')).toBeInTheDocument();

    rerender(
      <NodePropertyEditor
        node={makeNode({
          label: 'obj',
          type: 'object',
        })}
        onChange={onChange}
      />
    );

    expect(screen.getByRole('button', { name: '+ Min Properties' })).toBeInTheDocument();
  });
});
