import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GraphicalSchemaEditor } from './graphical-schema-editor';

describe('GraphicalSchemaEditor - Delete node context-menu action', () => {
  beforeEach(() => {
    delete (globalThis as any).__graphicalSchemaExpansionState;
  });

  it('shows a red "Delete Property" button and does nothing when the confirm dialog is cancelled', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    const onChange = jest.fn();
    const testSchema = { type: 'object', properties: { foo: { type: 'string' } } } as any;

    render(<GraphicalSchemaEditor schema={testSchema} onChange={onChange} />);

    const fooLabel = await screen.findByText('foo');
    fireEvent.contextMenu(fooLabel);

    const deleteButton = await screen.findByRole('button', { name: 'Delete Property' });
    expect(deleteButton).toHaveStyle({ color: '#d32f2f' });

    fireEvent.click(deleteButton);

    expect(confirmSpy).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('foo')).toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it('deletes the property from the schema after confirming', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    let latestSchema: any = null;
    const onChange = jest.fn((next) => { latestSchema = next; });
    const testSchema = { type: 'object', properties: { foo: { type: 'string' }, bar: { type: 'string' } } } as any;

    render(<GraphicalSchemaEditor schema={testSchema} onChange={onChange} />);

    const fooLabel = await screen.findByText('foo');
    fireEvent.contextMenu(fooLabel);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Property' }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(latestSchema.properties.foo).toBeUndefined();
    expect(latestSchema.properties.bar).toBeDefined();

    confirmSpy.mockRestore();
  });

  it('deletes an XSD complexType and cascades to remove referencing elements', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    let latestSchema: any = null;
    const onChange = jest.fn((next) => { latestSchema = next; });
    const initialSchema = {
      'xs:schema': {
        'xs:complexType': [
          { '@attributes': { name: 'AddressType' }, 'xs:attribute': [{ '@attributes': { name: 'city', type: 'xs:string' } }] },
        ],
        'xs:element': [
          { '@attributes': { name: 'Root', type: 'AddressType' } },
        ],
      },
    } as any;

    render(<GraphicalSchemaEditor schema={initialSchema} schemaLanguage="xml" onChange={onChange} />);

    const complexTypeLabel = await screen.findByText('AddressType');
    fireEvent.contextMenu(complexTypeLabel);
    const deleteButton = await screen.findByRole('button', { name: 'Delete ComplexType' });
    expect(deleteButton).toHaveStyle({ color: '#d32f2f' });
    fireEvent.click(deleteButton);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(latestSchema['xs:schema']['xs:complexType'] ?? []).toHaveLength(0);
    // The referencing element (type="AddressType") is removed too since it's a global type.
    expect(latestSchema['xs:schema']['xs:element'] ?? []).toHaveLength(0);

    confirmSpy.mockRestore();
  });
});
