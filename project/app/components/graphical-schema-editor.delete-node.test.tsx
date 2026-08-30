import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GraphicalSchemaEditor } from './graphical-schema-editor';
import { parseMarkup } from '../utils/markup';
import { expandNodeByDataId } from './test-fixtures/expand-all-nodes';

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

  it('deletes version-number on the expanded Model branch without creating numeric phantom fields', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    const xsdPath = path.join(__dirname, '..', '..', 'public', 'schemas', 'EigerModelType.xsd');
    const xsd = fs.readFileSync(xsdPath, 'utf-8');
    const parsed = parseMarkup(xsd, 'xml');

    let latestSchema: any = parsed;

    function StatefulXmlEditor() {
      const [currentSchema, setCurrentSchema] = React.useState<any>(parsed);
      return (
        <GraphicalSchemaEditor
          schema={currentSchema}
          schemaLanguage="xml"
          onChange={(next) => {
            latestSchema = next as any;
            setCurrentSchema(next as any);
          }}
        />
      );
    }

    render(<StatefulXmlEditor />);

    await expandNodeByDataId('1.element_0');
    await expandNodeByDataId('1.element_0.sequence.element_0');
    await expandNodeByDataId('1.element_0.sequence.element_0.sequence.element_0');

    const modelVersionAttrNode = document.querySelector('.react-flow__node[data-id="1.element_0.sequence.element_0.sequence.element_0.base.attribute_0"]');
    expect(modelVersionAttrNode).toBeInTheDocument();

    fireEvent.contextMenu(modelVersionAttrNode as Element);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Attribute' }));

    await waitFor(() => {
      const topLevelProps = (latestSchema as any)?.properties;
      expect(topLevelProps?.['0']).toBeUndefined();
      expect(topLevelProps?.['1']).toBeUndefined();
    });

    confirmSpy.mockRestore();
  }, 20000);

  it('removes modelType version-number in complexType editor without creating 0:/1: ghost nodes', async () => {
    const xsdPath = path.join(__dirname, '..', '..', 'public', 'schemas', 'EigerModelType.xsd');
    const xsd = fs.readFileSync(xsdPath, 'utf-8');
    const parsed = parseMarkup(xsd, 'xml');

    let latestSchema: any = parsed;

    function StatefulXmlEditor() {
      const [currentSchema, setCurrentSchema] = React.useState<any>(parsed);
      return (
        <GraphicalSchemaEditor
          schema={currentSchema}
          schemaLanguage="xml"
          onChange={(next) => {
            latestSchema = next as any;
            setCurrentSchema(next as any);
          }}
        />
      );
    }

    render(<StatefulXmlEditor />);

    const modelTypeNode = await screen.findByText('modelType');
    fireEvent.click(modelTypeNode);

    expect(await screen.findByText('ComplexType Editor')).toBeInTheDocument();

    const versionInput = await screen.findByDisplayValue('version-number');
    let cursor: Element | null = versionInput;
    let removeButton: Element | null = null;
    while (cursor && !removeButton) {
      removeButton = Array.from(cursor.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Remove') ?? null;
      cursor = cursor.parentElement;
    }
    expect(removeButton).toBeTruthy();
    fireEvent.click(removeButton as Element);

    await waitFor(() => {
      const modelType = (latestSchema as any)?.['xs:schema']?.['xs:complexType']?.find(
        (ct: any) => ct?.['@attributes']?.name === 'modelType'
      );
      const attrs = Array.isArray(modelType?.['xs:attribute']) ? modelType['xs:attribute'] : [];
      expect(attrs.some((a: any) => a?.['@attributes']?.name === 'version-number')).toBe(false);
    });

    expect(screen.queryByText('0:')).not.toBeInTheDocument();
    expect(screen.queryByText('1:')).not.toBeInTheDocument();
  }, 20000);
});
