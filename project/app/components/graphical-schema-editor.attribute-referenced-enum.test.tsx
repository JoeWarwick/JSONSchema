import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GraphicalSchemaEditor } from './graphical-schema-editor';
import { expandAllGraphNodes } from './test-fixtures/expand-all-nodes';

// Covers `xs:attribute type="typesType"` referencing a NAMED simpleType (by name, not an inline
// anonymous simpleType) that itself has enumerations — the attribute's RHS editor should show
// those enumeration values read-only (they belong to the shared `typesType` definition, not the
// attribute), distinct from the fully-editable inline attribute simpleType feature.
describe('GraphicalSchemaEditor - XML attribute referencing a named enum simpleType by type=', () => {
  function buildSchema() {
    return {
      'xs:schema': {
        'xs:complexType': [
          {
            '@attributes': { name: 'fieldType' },
            'xs:attribute': [
              { '@attributes': { name: 'name', type: 'xs:string', use: 'required' } },
              { '@attributes': { name: 'type', type: 'typesType', use: 'required' } },
            ],
          },
        ],
        'xs:element': [{ '@attributes': { name: 'Field', type: 'fieldType' } }],
        'xs:simpleType': [
          {
            '@attributes': { name: 'typesType' },
            'xs:restriction': {
              '@attributes': { base: 'xs:string' },
              'xs:enumeration': [
                { '@attributes': { value: 'bool' } },
                { '@attributes': { value: 'int32' } },
                { '@attributes': { value: 'string' } },
              ],
            },
          },
        ],
      },
    } as any;
  }

  it('shows referenced enumeration values read-only on the "type" attribute of Field', async () => {
    render(<GraphicalSchemaEditor schema={buildSchema()} schemaLanguage="xml" onChange={() => {}} />);
    await expandAllGraphNodes();

    const typeAttributeNodes = await screen.findAllByText('type');
    fireEvent.click(typeAttributeNodes[typeAttributeNodes.length - 1]);

    expect(await screen.findByText('Attribute Editor')).toBeInTheDocument();
    expect(await screen.findByLabelText('Attribute Type')).toHaveValue('typesType');

    expect(await screen.findByLabelText('Referenced enumeration value 1')).toHaveTextContent('bool');
    expect(await screen.findByLabelText('Referenced enumeration value 2')).toHaveTextContent('int32');
    expect(await screen.findByLabelText('Referenced enumeration value 3')).toHaveTextContent('string');

    // Read-only: no editable inputs or add/remove/reorder controls for these values.
    expect(screen.queryByLabelText('SimpleType enumeration value 1')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('SimpleType enumeration new value')).not.toBeInTheDocument();
  });

  it('does not show any referenced enumeration UI for a plain xs:string attribute', async () => {
    render(<GraphicalSchemaEditor schema={buildSchema()} schemaLanguage="xml" onChange={() => {}} />);
    await expandAllGraphNodes();

    const nameAttributeNodes = await screen.findAllByText('name');
    fireEvent.click(nameAttributeNodes[0]);
    expect(await screen.findByText('Attribute Editor')).toBeInTheDocument();
    expect(screen.queryByText(/Enumeration values/)).not.toBeInTheDocument();
  });
});
