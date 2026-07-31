import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GraphicalSchemaEditor } from './graphical-schema-editor';

// Covers the "Type" dropdown on Attribute/Element editors: it should offer built-in XSD simple
// types under a "Simple" group and this schema's own named simpleType/complexType definitions
// under a "My Types" group, plus a "Custom…" escape hatch for free-text values not in either list.
describe('GraphicalSchemaEditor - XML Type selector dropdown (Simple / My Types)', () => {
  function buildSchema() {
    return {
      'xs:schema': {
        'xs:complexType': [
          {
            '@attributes': { name: 'fieldType' },
            'xs:attribute': [{ '@attributes': { name: 'type', type: 'typesType', use: 'required' } }],
          },
        ],
        'xs:element': [{ '@attributes': { name: 'Field', type: 'fieldType' } }],
        'xs:simpleType': [
          {
            '@attributes': { name: 'typesType' },
            'xs:restriction': {
              '@attributes': { base: 'xs:string' },
              'xs:enumeration': [{ '@attributes': { value: 'bool' } }, { '@attributes': { value: 'string' } }],
            },
          },
        ],
      },
    } as any;
  }

  function StatefulXmlEditor({ initialSchema, onLatest }: { initialSchema: any; onLatest: (s: any) => void }) {
    const [currentSchema, setCurrentSchema] = React.useState<any>(initialSchema);
    return (
      <GraphicalSchemaEditor
        schema={currentSchema}
        schemaLanguage="xml"
        onChange={(next) => {
          onLatest(next);
          setCurrentSchema(next as any);
        }}
      />
    );
  }

  it('renders the Attribute Type select with Simple and My Types option groups', async () => {
    render(<GraphicalSchemaEditor schema={buildSchema()} schemaLanguage="xml" onChange={() => {}} />);

    const typeAttributeNodes = await screen.findAllByText('type');
    fireEvent.click(typeAttributeNodes[typeAttributeNodes.length - 1]);

    const select = await screen.findByLabelText('Attribute Type') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveValue('typesType');

    const groups = Array.from(select.querySelectorAll('optgroup')).map((g) => g.getAttribute('label'));
    expect(groups).toEqual(['Simple', 'My Types']);

    const simpleOptions = Array.from(select.querySelectorAll('optgroup[label="Simple"] option')).map((o) => (o as HTMLOptionElement).value);
    expect(simpleOptions).toContain('xs:string');
    expect(simpleOptions).toContain('xs:int');

    const myTypeOptions = Array.from(select.querySelectorAll('optgroup[label="My Types"] option')).map((o) => (o as HTMLOptionElement).value);
    expect(myTypeOptions).toEqual(['typesType']);
  });

  it('changing the select to a built-in simple type patches xmlAttributeType directly', async () => {
    let latestSchema = buildSchema();
    render(<StatefulXmlEditor initialSchema={latestSchema} onLatest={(s) => { latestSchema = s; }} />);

    const typeAttributeNodes = await screen.findAllByText('type');
    fireEvent.click(typeAttributeNodes[typeAttributeNodes.length - 1]);
    const select = await screen.findByLabelText('Attribute Type');
    fireEvent.change(select, { target: { value: 'xs:boolean' } });

    const attribute = latestSchema?.['xs:schema']?.['xs:complexType']?.[0]?.['xs:attribute']?.[0];
    expect(attribute?.['@attributes']?.type).toBe('xs:boolean');
  });

  it('switches to a free-text "Custom…" input for a value not present in either group', async () => {
    let latestSchema = buildSchema();
    render(<StatefulXmlEditor initialSchema={latestSchema} onLatest={(s) => { latestSchema = s; }} />);

    const typeAttributeNodes = await screen.findAllByText('type');
    fireEvent.click(typeAttributeNodes[typeAttributeNodes.length - 1]);
    const select = await screen.findByLabelText('Attribute Type');
    fireEvent.change(select, { target: { value: '__custom__' } });

    const customInput = await screen.findByLabelText('Attribute Type');
    expect((customInput as HTMLInputElement).tagName).toBe('INPUT');
    fireEvent.change(customInput, { target: { value: 'tns:ExternalType' } });
    fireEvent.blur(customInput);

    const attribute = latestSchema?.['xs:schema']?.['xs:complexType']?.[0]?.['xs:attribute']?.[0];
    expect(attribute?.['@attributes']?.type).toBe('tns:ExternalType');
  });

  it('renders the Element Type select including complexType names under My Types', async () => {
    render(<GraphicalSchemaEditor schema={buildSchema()} schemaLanguage="xml" onChange={() => {}} />);

    fireEvent.click(await screen.findByText('Field'));
    const select = await screen.findByLabelText('Element Type') as HTMLSelectElement;
    expect(select).toHaveValue('fieldType');

    const myTypeOptions = Array.from(select.querySelectorAll('optgroup[label="My Types"] option')).map((o) => (o as HTMLOptionElement).value);
    expect(myTypeOptions).toEqual(['fieldType', 'typesType']);
  });
});
