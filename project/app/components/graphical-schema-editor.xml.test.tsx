import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { waitFor } from '@testing-library/react';
import { GraphicalSchemaEditor } from './graphical-schema-editor';

describe('GraphicalSchemaEditor - XML RHS Editing', () => {
  beforeEach(() => {
    delete (globalThis as any).__graphicalSchemaExpansionState;
  });

  it('shows XML schema details in the right sidebar when the schema language is XML', async () => {
    const schema = {
      'xs:schema': {
        '@attributes': {
          xmlns: 'http://schemas.datacontract.org/2004/07/RPFabric.Core.Data',
          'xmlns:xs': 'http://www.w3.org/2001/XMLSchema',
          targetNamespace: 'http://schemas.datacontract.org/2004/07/RPFabric.Core.Data',
          elementFormDefault: 'qualified',
          attributeFormDefault: 'unqualified',
        },
      },
    } as any;

    render(<GraphicalSchemaEditor schema={schema} schemaLanguage="xml" onChange={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /Toggle XML schema details/i }));

    const detailsPanel = await screen.findByLabelText('XML schema details');
    expect(detailsPanel).toBeInTheDocument();
    expect(within(detailsPanel).getByText('targetNamespace')).toBeInTheDocument();
    expect(within(detailsPanel).getAllByText('http://schemas.datacontract.org/2004/07/RPFabric.Core.Data').length).toBeGreaterThan(0);
    expect(within(detailsPanel).getByText('xmlns:xs')).toBeInTheDocument();
  });

  it('dispatches XML SimpleType editor in RHS when a simpleType node is selected', async () => {
    const schema = {
      'xs:schema': {
        'xs:simpleType': [
          {
            '@attributes': { name: 'StatusCode' },
            'xs:restriction': { '@attributes': { base: 'xs:string' } },
          },
        ],
      },
    } as any;

    render(<GraphicalSchemaEditor schema={schema} schemaLanguage="xml" onChange={() => {}} />);

    fireEvent.click(await screen.findByText('simpleType:StatusCode'));

    expect(await screen.findByText('SimpleType Editor')).toBeInTheDocument();
    expect(screen.getByLabelText('SimpleType Name')).toHaveValue('StatusCode');
    expect(screen.getByLabelText('SimpleType Mode')).toHaveValue('restriction');
  });

  it('adds sequence from complexType context menu and edits min/max in XML RHS', async () => {
    const initialSchema = {
      'xs:schema': {
        'xs:complexType': [
          {
            '@attributes': { name: 'PersonType' },
            'xs:attribute': [
              { '@attributes': { name: 'id', type: 'xs:string', use: 'required' } },
            ],
          },
        ],
      },
    } as any;

    let latestSchema = initialSchema;

    function StatefulXmlEditor() {
      const [currentSchema, setCurrentSchema] = React.useState<any>(initialSchema);
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

    const complexTypeNodeLabel = await screen.findByText('complexType:PersonType');
    fireEvent.contextMenu(complexTypeNodeLabel);
    fireEvent.click(await screen.findByRole('button', { name: 'Add sequence' }));

    await waitFor(() => {
      const sequence = latestSchema?.['xs:schema']?.['xs:complexType']?.[0]?.['xs:sequence'];
      const attrs = sequence?.['@attributes'];
      expect(attrs?.minOccurs).toBe('1');
      expect(attrs?.maxOccurs).toBe('1');
    });

    await waitFor(() => {
      expect(document.querySelector('.react-flow__node[data-id="1.complexType_0.sequence"]')).not.toBeNull();
    });

    fireEvent.click(document.querySelector('.react-flow__node[data-id="1.complexType_0.sequence"]') as Element);
    expect(await screen.findByText('sequence Editor')).toBeInTheDocument();

    const minOccursInput = screen.getByLabelText('minOccurs');
    const maxOccursInput = screen.getByLabelText('maxOccurs');

    fireEvent.change(minOccursInput, { target: { value: '0' } });
    fireEvent.blur(minOccursInput);
    fireEvent.change(maxOccursInput, { target: { value: 'unbounded' } });
    fireEvent.blur(maxOccursInput);

    await waitFor(() => {
      const sequence = latestSchema?.['xs:schema']?.['xs:complexType']?.[0]?.['xs:sequence'];
      const attrs = sequence?.['@attributes'];
      expect(attrs?.minOccurs).toBe('0');
      expect(attrs?.maxOccurs).toBe('unbounded');
    });
  });

  it.each([
    { kind: 'choice', minValue: '0', maxValue: '3' },
    { kind: 'all', minValue: '1', maxValue: 'unbounded' },
  ])('adds $kind from complexType context menu and edits min/max in XML RHS', async ({ kind, minValue, maxValue }) => {
    const initialSchema = {
      'xs:schema': {
        'xs:complexType': [
          {
            '@attributes': { name: 'AccountType' },
            'xs:attribute': [
              { '@attributes': { name: 'id', type: 'xs:string', use: 'required' } },
            ],
          },
        ],
      },
    } as any;

    let latestSchema = initialSchema;

    function StatefulXmlEditor() {
      const [currentSchema, setCurrentSchema] = React.useState<any>(initialSchema);
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

    const complexTypeNodeLabel = await screen.findByText('complexType:AccountType');
    fireEvent.contextMenu(complexTypeNodeLabel);
    fireEvent.click(await screen.findByRole('button', { name: `Add ${kind}` }));

    await waitFor(() => {
      const compositor = latestSchema?.['xs:schema']?.['xs:complexType']?.[0]?.[`xs:${kind}`];
      const attrs = compositor?.['@attributes'];
      expect(attrs?.minOccurs).toBe('1');
      expect(attrs?.maxOccurs).toBe('1');
    });

    await waitFor(() => {
      expect(document.querySelector(`.react-flow__node[data-id="1.complexType_0.${kind}"]`)).not.toBeNull();
    });

    fireEvent.click(document.querySelector(`.react-flow__node[data-id="1.complexType_0.${kind}"]`) as Element);
    expect(await screen.findByText(`${kind} Editor`)).toBeInTheDocument();

    const minOccursInput = screen.getByLabelText('minOccurs');
    const maxOccursInput = screen.getByLabelText('maxOccurs');

    fireEvent.change(minOccursInput, { target: { value: minValue } });
    fireEvent.blur(minOccursInput);
    fireEvent.change(maxOccursInput, { target: { value: maxValue } });
    fireEvent.blur(maxOccursInput);

    await waitFor(() => {
      const compositor = latestSchema?.['xs:schema']?.['xs:complexType']?.[0]?.[`xs:${kind}`];
      const attrs = compositor?.['@attributes'];
      expect(attrs?.minOccurs).toBe(minValue);
      expect(attrs?.maxOccurs).toBe(maxValue);
    });
  });

  it('transitions simpleType mode restriction ↔ union ↔ list and persists expected schema shape', async () => {
    const initialSchema = {
      'xs:schema': {
        'xs:simpleType': [
          {
            '@attributes': { name: 'TokenList' },
            'xs:restriction': { '@attributes': { base: 'xs:string' } },
          },
        ],
      },
    } as any;

    let latestSchema = initialSchema;

    function StatefulXmlEditor() {
      const [currentSchema, setCurrentSchema] = React.useState<any>(initialSchema);
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

    fireEvent.click(await screen.findByText('simpleType:TokenList'));
    const modeSelect = await screen.findByLabelText('SimpleType Mode');

    await waitFor(() => {
      const simpleType = latestSchema?.['xs:schema']?.['xs:simpleType']?.[0];
      expect(simpleType?.['xs:restriction']).toBeTruthy();
      expect(simpleType?.['xs:restriction']?.['@attributes']?.base).toBe('xs:string');
      expect(simpleType?.['xs:union']).toBeUndefined();
      expect(simpleType?.['xs:list']).toBeUndefined();
    });

    fireEvent.change(modeSelect, { target: { value: 'union' } });
    await waitFor(() => {
      const simpleType = latestSchema?.['xs:schema']?.['xs:simpleType']?.[0];
      expect(simpleType?.['xs:union']).toBeTruthy();
      expect(simpleType?.['xs:union']?.['@attributes']?.memberTypes).toBe('');
      expect(simpleType?.['xs:restriction']).toBeUndefined();
      expect(simpleType?.['xs:list']).toBeUndefined();
    });

    const unionMemberTypesInput = await screen.findByLabelText('Union Member Types');
    fireEvent.change(unionMemberTypesInput, { target: { value: 'tns:CodeA tns:CodeB' } });
    fireEvent.blur(unionMemberTypesInput);
    await waitFor(() => {
      const simpleType = latestSchema?.['xs:schema']?.['xs:simpleType']?.[0];
      expect(simpleType?.['xs:union']?.['@attributes']?.memberTypes).toBe('tns:CodeA tns:CodeB');
    });

    fireEvent.change(modeSelect, { target: { value: 'list' } });
    await waitFor(() => {
      const simpleType = latestSchema?.['xs:schema']?.['xs:simpleType']?.[0];
      expect(simpleType?.['xs:list']).toBeTruthy();
      expect(simpleType?.['xs:list']?.['@attributes']?.itemType).toBe('xs:string');
      expect(simpleType?.['xs:restriction']).toBeUndefined();
      expect(simpleType?.['xs:union']).toBeUndefined();
    });

    const listItemTypeInput = await screen.findByLabelText('List Item Type');
    fireEvent.change(listItemTypeInput, { target: { value: 'xs:token' } });
    fireEvent.blur(listItemTypeInput);
    await waitFor(() => {
      const simpleType = latestSchema?.['xs:schema']?.['xs:simpleType']?.[0];
      expect(simpleType?.['xs:list']?.['@attributes']?.itemType).toBe('xs:token');
    });

    fireEvent.change(modeSelect, { target: { value: 'restriction' } });
    await waitFor(() => {
      const simpleType = latestSchema?.['xs:schema']?.['xs:simpleType']?.[0];
      expect(simpleType?.['xs:restriction']).toBeTruthy();
      expect(simpleType?.['xs:restriction']?.['@attributes']?.base).toBe('xs:string');
      expect(simpleType?.['xs:union']).toBeUndefined();
      expect(simpleType?.['xs:list']).toBeUndefined();
    });

    const restrictionBaseInput = await screen.findByLabelText('Restriction Base');
    fireEvent.change(restrictionBaseInput, { target: { value: 'xs:token' } });
    fireEvent.blur(restrictionBaseInput);
    await waitFor(() => {
      const simpleType = latestSchema?.['xs:schema']?.['xs:simpleType']?.[0];
      expect(simpleType?.['xs:restriction']?.['@attributes']?.base).toBe('xs:token');
      expect(simpleType?.['xs:union']).toBeUndefined();
      expect(simpleType?.['xs:list']).toBeUndefined();
    });
  });

  it('renders compositor nodes (sequence/choice/all) as graph nodes with elements inside', async () => {
    const schema = {
      'xs:schema': {
        'xs:complexType': [
          {
            '@attributes': { name: 'PersonType' },
            'xs:sequence': [
              { '@attributes': { name: 'firstName', type: 'xs:string' } },
              { '@attributes': { name: 'lastName', type: 'xs:string' } },
            ],
          },
        ],
      },
    } as any;

    render(<GraphicalSchemaEditor schema={schema} schemaLanguage="xml" onChange={() => {}} />);

    // Verify compositor node is rendered
    await waitFor(() => {
      expect(screen.getByText('xs:sequence')).toBeInTheDocument();
    });

    // Verify element nodes are rendered
    await waitFor(() => {
      expect(screen.getByText('firstName')).toBeInTheDocument();
      expect(screen.getByText('lastName')).toBeInTheDocument();
    });
  });

  it('adds element to compositor via right-click context menu', async () => {
    const schema = {
      'xs:schema': {
        'xs:complexType': [
          {
            '@attributes': { name: 'PersonType' },
            'xs:sequence': [{ '@attributes': { name: 'firstName', type: 'xs:string' } }],
          },
        ],
      },
    } as any;

    let latestSchema = schema;

    function StatefulXmlEditor() {
      const [currentSchema, setCurrentSchema] = React.useState<any>(schema);
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

    // Find and right-click the compositor node
    const compositorNode = await screen.findByText('xs:sequence');
    fireEvent.contextMenu(compositorNode);

    // Click "Add element"
    const addElementOption = await screen.findByText('Add element');
    fireEvent.click(addElementOption);

    // Verify new element was added to the compositor
    await waitFor(() => {
      const complexType = latestSchema?.['xs:schema']?.['xs:complexType']?.[0];
      const sequence = complexType?.['xs:sequence'];
      expect(Array.isArray(sequence)).toBe(true);
      expect(sequence?.length).toBe(2);
      expect(sequence?.[1]?.['@attributes']?.name).toMatch(/element\d+/);
    });
  });

  it('adds nested compositor to compositor via right-click context menu', async () => {
    const schema = {
      'xs:schema': {
        'xs:complexType': [
          {
            '@attributes': { name: 'PersonType' },
            'xs:sequence': [{ '@attributes': { name: 'name', type: 'xs:string' } }],
          },
        ],
      },
    } as any;

    let latestSchema = schema;

    function StatefulXmlEditor() {
      const [currentSchema, setCurrentSchema] = React.useState<any>(schema);
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

    // Find and right-click the compositor node
    const compositorNode = await screen.findByText('xs:sequence');
    fireEvent.contextMenu(compositorNode);

    // Click "Add choice" to add nested compositor
    const addChoiceOption = await screen.findByText('Add choice');
    fireEvent.click(addChoiceOption);

    // Verify nested compositor was added
    await waitFor(() => {
      const complexType = latestSchema?.['xs:schema']?.['xs:complexType']?.[0];
      const sequence = complexType?.['xs:sequence'];
      expect(Array.isArray(sequence)).toBe(true);
      // Should have original element + nested choice
      expect(sequence?.length).toBe(2);
      expect(sequence?.[1]?.['xs:choice']).toBeDefined();
    });
  });

  it('edits element properties (name, type, minOccurs, maxOccurs) via RHS editor', async () => {
    const schema = {
      'xs:schema': {
        'xs:complexType': [
          {
            '@attributes': { name: 'PersonType' },
            'xs:sequence': [
              { '@attributes': { name: 'firstName', type: 'xs:string', minOccurs: '0', maxOccurs: '1' } },
            ],
          },
        ],
      },
    } as any;

    let latestSchema = schema;

    function StatefulXmlEditor() {
      const [currentSchema, setCurrentSchema] = React.useState<any>(schema);
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

    // Click on element node to select it
    fireEvent.click(await screen.findByText('firstName'));

    // Find and modify the name input
    const nameInput = await screen.findByLabelText('Element Name');
    fireEvent.change(nameInput, { target: { value: 'givenName' } });
    fireEvent.blur(nameInput);

    await waitFor(() => {
      const element = latestSchema?.['xs:schema']?.['xs:complexType']?.[0]?.['xs:sequence']?.[0];
      expect(element?.['@attributes']?.name).toBe('givenName');
    });

    // Modify the type
    const typeInput = await screen.findByLabelText('Element Type');
    fireEvent.change(typeInput, { target: { value: 'xs:token' } });
    fireEvent.blur(typeInput);

    await waitFor(() => {
      const element = latestSchema?.['xs:schema']?.['xs:complexType']?.[0]?.['xs:sequence']?.[0];
      expect(element?.['@attributes']?.type).toBe('xs:token');
    });

    // Modify maxOccurs
    const maxOccursInput = await screen.findByLabelText('Element maxOccurs');
    fireEvent.change(maxOccursInput, { target: { value: 'unbounded' } });
    fireEvent.blur(maxOccursInput);

    await waitFor(() => {
      const element = latestSchema?.['xs:schema']?.['xs:complexType']?.[0]?.['xs:sequence']?.[0];
      expect(element?.['@attributes']?.maxOccurs).toBe('unbounded');
    });
  });
});
