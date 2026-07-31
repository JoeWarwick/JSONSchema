import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GraphicalSchemaEditor } from './graphical-schema-editor';

// Covers editing an `xs:attribute`'s inline (anonymous) `xs:simpleType` — including a nested
// `xs:union` with an anonymous member `xs:restriction`/`xs:enumeration`, and a nested `xs:list`
// with an anonymous item `xs:restriction`/`xs:enumeration` — mirroring the real-world shape
// used by EigerModelType.xsd's `extend-type` and `services-used-in` attributes.
describe('GraphicalSchemaEditor - XML attribute inline simpleType (union/list + enumeration) editing', () => {
  beforeEach(() => {
    delete (globalThis as any).__graphicalSchemaExpansionState;
  });

  function buildSchema() {
    return {
      'xs:schema': {
        'xs:complexType': [
          {
            '@attributes': { name: 'modelType' },
            'xs:attribute': [
              {
                '@attributes': { name: 'extend-type', default: 'PersistedExtensibleDataObjectBase' },
                'xs:simpleType': {
                  'xs:union': {
                    '@attributes': { memberTypes: 'xs:string' },
                    'xs:simpleType': {
                      'xs:restriction': {
                        '@attributes': { base: 'xs:string' },
                        'xs:enumeration': [
                          { '@attributes': { value: 'PersistedExtensibleDataObjectBase' } },
                          { '@attributes': { value: 'ExtensibleDataObjectBase' } },
                          { '@attributes': { value: 'None' } },
                        ],
                      },
                    },
                  },
                },
              },
              {
                '@attributes': { name: 'services-used-in' },
                'xs:simpleType': {
                  'xs:list': {
                    'xs:simpleType': {
                      'xs:restriction': {
                        '@attributes': { base: 'xs:string' },
                        'xs:enumeration': [
                          { '@attributes': { value: 'Management' } },
                          { '@attributes': { value: 'User' } },
                          { '@attributes': { value: 'Tenant' } },
                          { '@attributes': { value: 'SearchField' } },
                        ],
                      },
                    },
                  },
                },
              },
            ],
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

  const getExtendTypeAttr = (schema: any) => schema?.['xs:schema']?.['xs:complexType']?.[0]?.['xs:attribute']?.[0];
  const getServicesAttr = (schema: any) => schema?.['xs:schema']?.['xs:complexType']?.[0]?.['xs:attribute']?.[1];

  it('shows the union + nested restriction/enumeration in RHS when the extend-type attribute is selected', async () => {
    render(<GraphicalSchemaEditor schema={buildSchema()} schemaLanguage="xml" onChange={() => {}} />);

    fireEvent.click(await screen.findByText('extend-type'));
    expect(await screen.findByText('Attribute Editor')).toBeInTheDocument();

    const inlineCheckbox = await screen.findByLabelText('Inline SimpleType');
    expect(inlineCheckbox).toBeChecked();

    expect(await screen.findByLabelText('Inline SimpleType Mode')).toHaveValue('union');
    expect(await screen.findByLabelText('Inline SimpleType Union Member Types')).toHaveValue('xs:string');
    expect(await screen.findByLabelText('Inline SimpleType member 1 Mode')).toHaveValue('restriction');
    expect(await screen.findByLabelText('Inline SimpleType member 1 enumeration value 1')).toHaveValue('PersistedExtensibleDataObjectBase');
    expect(await screen.findByLabelText('Inline SimpleType member 1 enumeration value 2')).toHaveValue('ExtensibleDataObjectBase');
    expect(await screen.findByLabelText('Inline SimpleType member 1 enumeration value 3')).toHaveValue('None');
  });

  it('adds, reorders, edits, and removes enumeration values on the nested union member restriction', async () => {
    let latestSchema = buildSchema();
    render(<StatefulXmlEditor initialSchema={latestSchema} onLatest={(s) => { latestSchema = s; }} />);

    fireEvent.click(await screen.findByText('extend-type'));
    await screen.findByLabelText('Inline SimpleType member 1 Mode');

    // Add a new enumeration value
    const newValueInput = await screen.findByLabelText('Inline SimpleType member 1 enumeration new value');
    fireEvent.change(newValueInput, { target: { value: 'Custom' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      const enumeration = getExtendTypeAttr(latestSchema)?.['xs:simpleType']?.['xs:union']?.['xs:simpleType']?.['xs:restriction']?.['xs:enumeration'];
      expect(enumeration.map((e: any) => e['@attributes'].value)).toEqual([
        'PersistedExtensibleDataObjectBase', 'ExtensibleDataObjectBase', 'None', 'Custom',
      ]);
    });

    // Move the first value down (swap with second)
    fireEvent.click(await screen.findByLabelText('Inline SimpleType member 1 enumeration move down 1'));
    await waitFor(() => {
      const enumeration = getExtendTypeAttr(latestSchema)?.['xs:simpleType']?.['xs:union']?.['xs:simpleType']?.['xs:restriction']?.['xs:enumeration'];
      expect(enumeration.map((e: any) => e['@attributes'].value)).toEqual([
        'ExtensibleDataObjectBase', 'PersistedExtensibleDataObjectBase', 'None', 'Custom',
      ]);
    });

    // Edit a value directly
    const secondValueInput = await screen.findByLabelText('Inline SimpleType member 1 enumeration value 2');
    fireEvent.change(secondValueInput, { target: { value: 'RenamedBase' } });
    await waitFor(() => {
      const enumeration = getExtendTypeAttr(latestSchema)?.['xs:simpleType']?.['xs:union']?.['xs:simpleType']?.['xs:restriction']?.['xs:enumeration'];
      expect(enumeration.map((e: any) => e['@attributes'].value)).toEqual([
        'ExtensibleDataObjectBase', 'RenamedBase', 'None', 'Custom',
      ]);
    });

    // Remove a value
    fireEvent.click(await screen.findByLabelText('Inline SimpleType member 1 enumeration remove 3'));
    await waitFor(() => {
      const enumeration = getExtendTypeAttr(latestSchema)?.['xs:simpleType']?.['xs:union']?.['xs:simpleType']?.['xs:restriction']?.['xs:enumeration'];
      expect(enumeration.map((e: any) => e['@attributes'].value)).toEqual([
        'ExtensibleDataObjectBase', 'RenamedBase', 'Custom',
      ]);
    });
  });

  it('shows and edits the list + nested restriction/enumeration on the services-used-in attribute', async () => {
    let latestSchema = buildSchema();
    render(<StatefulXmlEditor initialSchema={latestSchema} onLatest={(s) => { latestSchema = s; }} />);

    fireEvent.click(await screen.findByText('services-used-in'));
    expect(await screen.findByLabelText('Inline SimpleType Mode')).toHaveValue('list');
    expect(await screen.findByLabelText('Inline SimpleType has nested simpleType')).toBeChecked();
    expect(await screen.findByLabelText('Inline SimpleType item Mode')).toHaveValue('restriction');
    expect(await screen.findByLabelText('Inline SimpleType item enumeration value 4')).toHaveValue('SearchField');

    fireEvent.click(await screen.findByLabelText('Inline SimpleType item enumeration remove 1'));
    await waitFor(() => {
      const enumeration = getServicesAttr(latestSchema)?.['xs:simpleType']?.['xs:list']?.['xs:simpleType']?.['xs:restriction']?.['xs:enumeration'];
      expect(enumeration.map((e: any) => e['@attributes'].value)).toEqual(['User', 'Tenant', 'SearchField']);
    });
  });

  it('toggles Inline SimpleType off, clearing it and re-enabling the plain Type input', async () => {
    let latestSchema = buildSchema();
    render(<StatefulXmlEditor initialSchema={latestSchema} onLatest={(s) => { latestSchema = s; }} />);

    fireEvent.click(await screen.findByText('extend-type'));
    const inlineCheckbox = await screen.findByLabelText('Inline SimpleType');
    fireEvent.click(inlineCheckbox);

    await waitFor(() => {
      const attr = getExtendTypeAttr(latestSchema);
      expect(attr?.['xs:simpleType']).toBeUndefined();
    });

    const typeInput = await screen.findByLabelText('Attribute Type') as HTMLInputElement;
    expect(typeInput).not.toBeDisabled();
  });
});
