import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GraphicalSchemaEditor } from './graphical-schema-editor';
import { expandAllGraphNodes } from './test-fixtures/expand-all-nodes';

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

  const extendTypeAttributeNodeId = '1.complexType_0.attribute_0';
  const extendTypeSimpleTypeNodeId = `${extendTypeAttributeNodeId}.simpleType`;
  const servicesAttributeNodeId = '1.complexType_0.attribute_1';
  const servicesSimpleTypeNodeId = `${servicesAttributeNodeId}.simpleType`;

  const clickNode = (nodeId: string) => {
    const el = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
    expect(el).not.toBeNull();
    fireEvent.click(el as Element);
  };

  it('shows a note on the Attribute Editor and a separate SimpleType Editor child node for the extend-type attribute', async () => {
    render(<GraphicalSchemaEditor schema={buildSchema()} schemaLanguage="xml" onChange={() => {}} />);
    await expandAllGraphNodes();

    fireEvent.click(await screen.findByText('extend-type'));
    expect(await screen.findByText('Attribute Editor')).toBeInTheDocument();
    expect(await screen.findByText(/This attribute has an inline SimpleType/)).toBeInTheDocument();

    await waitFor(() => {
      expect(document.querySelector(`.react-flow__node[data-id="${extendTypeSimpleTypeNodeId}"]`)).not.toBeNull();
    });

    clickNode(extendTypeSimpleTypeNodeId);
    expect(await screen.findByText('SimpleType Editor')).toBeInTheDocument();

    expect(await screen.findByLabelText('SimpleType Mode')).toHaveValue('union');
    expect(await screen.findByLabelText('SimpleType Union Member Types')).toHaveValue('xs:string');
    expect(await screen.findByLabelText('SimpleType member 1 Mode')).toHaveValue('restriction');
    expect(await screen.findByLabelText('SimpleType member 1 enumeration value 1')).toHaveValue('PersistedExtensibleDataObjectBase');
    expect(await screen.findByLabelText('SimpleType member 1 enumeration value 2')).toHaveValue('ExtensibleDataObjectBase');
    expect(await screen.findByLabelText('SimpleType member 1 enumeration value 3')).toHaveValue('None');
  });

  it('adds, reorders, edits, and removes enumeration values on the nested union member restriction', async () => {
    let latestSchema = buildSchema();
    render(<StatefulXmlEditor initialSchema={latestSchema} onLatest={(s) => { latestSchema = s; }} />);
    await expandAllGraphNodes();

    await screen.findByText('extend-type');
    await waitFor(() => {
      expect(document.querySelector(`.react-flow__node[data-id="${extendTypeSimpleTypeNodeId}"]`)).not.toBeNull();
    });
    clickNode(extendTypeSimpleTypeNodeId);
    await screen.findByLabelText('SimpleType member 1 Mode');

    // Add a new enumeration value
    const newValueInput = await screen.findByLabelText('SimpleType member 1 enumeration new value');
    fireEvent.change(newValueInput, { target: { value: 'Custom' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      const enumeration = getExtendTypeAttr(latestSchema)?.['xs:simpleType']?.['xs:union']?.['xs:simpleType']?.['xs:restriction']?.['xs:enumeration'];
      expect(enumeration.map((e: any) => e['@attributes'].value)).toEqual([
        'PersistedExtensibleDataObjectBase', 'ExtensibleDataObjectBase', 'None', 'Custom',
      ]);
    });

    // Move the first value down (swap with second)
    fireEvent.click(await screen.findByLabelText('SimpleType member 1 enumeration move down 1'));
    await waitFor(() => {
      const enumeration = getExtendTypeAttr(latestSchema)?.['xs:simpleType']?.['xs:union']?.['xs:simpleType']?.['xs:restriction']?.['xs:enumeration'];
      expect(enumeration.map((e: any) => e['@attributes'].value)).toEqual([
        'ExtensibleDataObjectBase', 'PersistedExtensibleDataObjectBase', 'None', 'Custom',
      ]);
    });

    // Edit a value directly
    const secondValueInput = await screen.findByLabelText('SimpleType member 1 enumeration value 2');
    fireEvent.change(secondValueInput, { target: { value: 'RenamedBase' } });
    await waitFor(() => {
      const enumeration = getExtendTypeAttr(latestSchema)?.['xs:simpleType']?.['xs:union']?.['xs:simpleType']?.['xs:restriction']?.['xs:enumeration'];
      expect(enumeration.map((e: any) => e['@attributes'].value)).toEqual([
        'ExtensibleDataObjectBase', 'RenamedBase', 'None', 'Custom',
      ]);
    });

    // Remove a value
    fireEvent.click(await screen.findByLabelText('SimpleType member 1 enumeration remove 3'));
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
    await expandAllGraphNodes();

    await screen.findByText('services-used-in');
    await waitFor(() => {
      expect(document.querySelector(`.react-flow__node[data-id="${servicesSimpleTypeNodeId}"]`)).not.toBeNull();
    });
    clickNode(servicesSimpleTypeNodeId);

    expect(await screen.findByLabelText('SimpleType Mode')).toHaveValue('list');
    expect(await screen.findByLabelText('SimpleType has nested simpleType')).toBeChecked();
    expect(await screen.findByLabelText('SimpleType item Mode')).toHaveValue('restriction');
    expect(await screen.findByLabelText('SimpleType item enumeration value 4')).toHaveValue('SearchField');

    fireEvent.click(await screen.findByLabelText('SimpleType item enumeration remove 1'));
    await waitFor(() => {
      const enumeration = getServicesAttr(latestSchema)?.['xs:simpleType']?.['xs:list']?.['xs:simpleType']?.['xs:restriction']?.['xs:enumeration'];
      expect(enumeration.map((e: any) => e['@attributes'].value)).toEqual(['User', 'Tenant', 'SearchField']);
    });
  });

  it('removes the inline SimpleType via the "Remove SimpleType" context menu action, restoring a plain Type input', async () => {
    let latestSchema = buildSchema();
    render(<StatefulXmlEditor initialSchema={latestSchema} onLatest={(s) => { latestSchema = s; }} />);
    await expandAllGraphNodes();

    fireEvent.click(await screen.findByText('extend-type'));
    fireEvent.contextMenu(document.querySelector(`.react-flow__node[data-id="${extendTypeAttributeNodeId}"]`) as Element);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove SimpleType' }));

    await waitFor(() => {
      const attr = getExtendTypeAttr(latestSchema);
      expect(attr?.['xs:simpleType']).toBeUndefined();
      expect(attr?.['@attributes']?.type).toBe('xs:string');
    });

    await waitFor(() => {
      expect(document.querySelector(`.react-flow__node[data-id="${extendTypeSimpleTypeNodeId}"]`)).toBeNull();
    });

    const typeInput = await screen.findByLabelText('Attribute Type') as HTMLInputElement;
    expect(typeInput).not.toBeDisabled();
  });

  it('adds a default inline SimpleType via the "Add SimpleType" context menu action on an attribute without one', async () => {
    const schema = {
      'xs:schema': {
        'xs:complexType': [
          {
            '@attributes': { name: 'modelType' },
            'xs:attribute': [
              { '@attributes': { name: 'plain-attr', type: 'xs:int' } },
            ],
          },
        ],
      },
    } as any;
    let latestSchema = schema;
    render(<StatefulXmlEditor initialSchema={schema} onLatest={(s) => { latestSchema = s; }} />);
    await expandAllGraphNodes();

    fireEvent.click(await screen.findByText('plain-attr'));
    fireEvent.contextMenu(document.querySelector('.react-flow__node[data-id="1.complexType_0.attribute_0"]') as Element);
    fireEvent.click(await screen.findByRole('button', { name: 'Add SimpleType' }));

    await waitFor(() => {
      const attr = latestSchema?.['xs:schema']?.['xs:complexType']?.[0]?.['xs:attribute']?.[0];
      expect(attr?.['@attributes']?.type).toBeUndefined();
      expect(attr?.['xs:simpleType']?.['xs:restriction']?.['@attributes']?.base).toBe('xs:int');
    });

    await waitFor(() => {
      expect(document.querySelector('.react-flow__node[data-id="1.complexType_0.attribute_0.simpleType"]')).not.toBeNull();
    });

    clickNode('1.complexType_0.attribute_0.simpleType');
    expect(await screen.findByText('SimpleType Editor')).toBeInTheDocument();
    expect(await screen.findByLabelText('SimpleType Mode')).toHaveValue('restriction');
    expect(await screen.findByLabelText('SimpleType Restriction Base')).toHaveValue('xs:int');
  });
});
