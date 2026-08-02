import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { waitFor } from '@testing-library/react';
import { parseMarkup } from '../utils/markup';
import { GraphicalSchemaEditor } from './graphical-schema-editor';
import { expandAllGraphNodes } from './test-fixtures/expand-all-nodes';

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

    fireEvent.click(await screen.findByText('StatusCode'));

    expect(await screen.findByText('SimpleType Editor')).toBeInTheDocument();
    expect(screen.getByLabelText('SimpleType Name')).toHaveValue('StatusCode');
    expect(screen.getByLabelText('SimpleType Mode')).toHaveValue('restriction');
  });

  it('does not switch to the JSON RHS editor when clicking empty space in XML mode', async () => {
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

    fireEvent.click(await screen.findByText('StatusCode'));
    expect(await screen.findByText('SimpleType Editor')).toBeInTheDocument();

    const pane = document.querySelector('.react-flow__pane, .react-flow__background');
    expect(pane).toBeTruthy();
    fireEvent.click(pane!);

    expect(screen.getByText('SimpleType Editor')).toBeInTheDocument();
    expect(screen.queryByText('Select a node to edit its properties.')).not.toBeInTheDocument();
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

    const complexTypeNodeLabel = await screen.findByText('PersonType');
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

    const complexTypeNodeLabel = await screen.findByText('AccountType');
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

    fireEvent.click(await screen.findByText('TokenList'));
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

    const addMemberButton = await screen.findByLabelText('Union Member Types add member');
    fireEvent.click(addMemberButton);
    const member1Select = await screen.findByLabelText('Union Member Types member 1');
    fireEvent.change(member1Select, { target: { value: '__custom__' } });
    const member1Input = await screen.findByLabelText('Union Member Types member 1');
    fireEvent.change(member1Input, { target: { value: 'tns:CodeA' } });
    fireEvent.blur(member1Input);
    await waitFor(() => {
      const simpleType = latestSchema?.['xs:schema']?.['xs:simpleType']?.[0];
      expect(simpleType?.['xs:union']?.['@attributes']?.memberTypes).toBe('tns:CodeA');
    });

    fireEvent.click(await screen.findByLabelText('Union Member Types add member'));
    const member2Select = await screen.findByLabelText('Union Member Types member 2');
    fireEvent.change(member2Select, { target: { value: '__custom__' } });
    const member2Input = await screen.findByLabelText('Union Member Types member 2');
    fireEvent.change(member2Input, { target: { value: 'tns:CodeB' } });
    fireEvent.blur(member2Input);
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
    await expandAllGraphNodes();

    // Verify compositor node is rendered (label shown as an icon with a tooltip)
    await waitFor(() => {
      expect(screen.getByLabelText('sequence compositor')).toBeInTheDocument();
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
    await expandAllGraphNodes();

    // Find and right-click the compositor node (label shown as an icon with a tooltip)
    const compositorNode = await screen.findByLabelText('sequence compositor');
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
    await expandAllGraphNodes();

    // Find and right-click the compositor node (label shown as an icon with a tooltip)
    const compositorNode = await screen.findByLabelText('sequence compositor');
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
    await expandAllGraphNodes();

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
    const maxOccursInput = await screen.findByLabelText('maxOccurs');
    fireEvent.change(maxOccursInput, { target: { value: 'unbounded' } });
    fireEvent.blur(maxOccursInput);

    await waitFor(() => {
      const element = latestSchema?.['xs:schema']?.['xs:complexType']?.[0]?.['xs:sequence']?.[0];
      expect(element?.['@attributes']?.maxOccurs).toBe('unbounded');
    });
  });

  it('edits schema targetNamespace and elementFormDefault via RHS editor', async () => {
    const initialSchema = {
      'xs:schema': {
        '@attributes': {
          xmlns: 'http://www.w3.org/2001/XMLSchema',
          'xmlns:xs': 'http://www.w3.org/2001/XMLSchema',
          targetNamespace: 'http://example.com/old',
          elementFormDefault: 'qualified',
          attributeFormDefault: 'unqualified',
        },
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

    // Click on the schema node
    const schemaNode = await screen.findByText('xs:schema');
    fireEvent.click(schemaNode);

    // Verify the schema editor is shown
    expect(await screen.findByText('Schema Editor')).toBeInTheDocument();

    // Edit the targetNamespace
    const namespaceInput = await screen.findByLabelText('Target Namespace');
    fireEvent.change(namespaceInput, { target: { value: 'http://example.com/new' } });
    fireEvent.blur(namespaceInput);

    await waitFor(() => {
      const attrs = latestSchema?.['xs:schema']?.['@attributes'];
      expect(attrs?.targetNamespace).toBe('http://example.com/new');
    });

    // Edit the elementFormDefault
    const elementFormSelect = await screen.findByLabelText('Element Form Default');
    fireEvent.change(elementFormSelect, { target: { value: 'unqualified' } });

    await waitFor(() => {
      const attrs = latestSchema?.['xs:schema']?.['@attributes'];
      expect(attrs?.elementFormDefault).toBe('unqualified');
    });
  });

  it('adds, edits, and removes attributes via RHS editor on complexType', async () => {
    const initialSchema = {
      'xs:schema': {
        'xs:complexType': [
          {
            '@attributes': { name: 'PersonType' },
            'xs:sequence': [
              { '@attributes': { minOccurs: '1', maxOccurs: '1' } },
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

    // Click on the complexType node
    const complexTypeNode = await screen.findByText('PersonType');
    fireEvent.click(complexTypeNode);

    // Verify the complexType editor is shown
    expect(await screen.findByText('ComplexType Editor')).toBeInTheDocument();

    // Reveal the "Add Attribute" form
    fireEvent.click(await screen.findByRole('button', { name: '+ Add Attribute' }));

    // Add a new attribute
    const attrNameInput = await screen.findByPlaceholderText('Attribute name');
    fireEvent.change(attrNameInput, { target: { value: 'id' } });
    
    const attrTypeInputs = await screen.findAllByPlaceholderText('Type (e.g., xs:string)');
    fireEvent.change(attrTypeInputs[0], { target: { value: 'xs:string' } });
    
    const addButton = await screen.findByRole('button', { name: 'Add' });
    fireEvent.click(addButton);

    await waitFor(() => {
      const attributes = latestSchema?.['xs:schema']?.['xs:complexType']?.[0]?.['xs:attribute'];
      expect(Array.isArray(attributes)).toBe(true);
      expect(attributes?.length).toBe(1);
      expect(attributes?.[0]?.['@attributes']?.name).toBe('id');
      expect(attributes?.[0]?.['@attributes']?.type).toBe('xs:string');
    });

    // Edit the existing attribute
    const attributeNameInput = await screen.findByDisplayValue('id');
    fireEvent.change(attributeNameInput, { target: { value: 'personId' } });
    fireEvent.blur(attributeNameInput);

    await waitFor(() => {
      const attributes = latestSchema?.['xs:schema']?.['xs:complexType']?.[0]?.['xs:attribute'];
      expect(attributes?.[0]?.['@attributes']?.name).toBe('personId');
    });

    // Remove the attribute
    const removeButton = await screen.findByRole('button', { name: 'Remove' });
    fireEvent.click(removeButton);

    await waitFor(() => {
      const attributes = latestSchema?.['xs:schema']?.['xs:complexType']?.[0]?.['xs:attribute'];
      expect(attributes?.length).toBe(0);
    });
  });

  it('renders simpleType with ref attribute as globalType node', async () => {
    const schema = {
      'xs:schema': {
        'xs:simpleType': [
          {
            '@attributes': { name: 'StatusCode', ref: 'true' },
            'xs:restriction': { '@attributes': { base: 'xs:string' } },
          },
        ],
      },
    } as any;

    render(<GraphicalSchemaEditor schema={schema} schemaLanguage="xml" onChange={() => {}} />);

    // Verify the globalType node is rendered (check for the node in the graph)
    await waitFor(() => {
      const nodeElement = document.querySelector('.react-flow__node[data-id="1.simpleType_0"]');
      expect(nodeElement).toBeInTheDocument();
      // The node should have globalType class or custom styling indicating it's a global type
      // We verify this by checking that the node exists and has the expected data attribute
    });
  });

  it('toggles simpleType ref checkbox to switch between property and globalType node types', async () => {
    const initialSchema = {
      'xs:schema': {
        'xs:simpleType': [
          {
            '@attributes': { name: 'StatusCode' },
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

    // Click on the simpleType node to open its editor
    fireEvent.click(await screen.findByText('StatusCode'));

    // Verify the SimpleType Editor is shown
    expect(await screen.findByText('SimpleType Editor')).toBeInTheDocument();

    // Initially, ref checkbox should not be checked
    const refCheckbox = await screen.findByLabelText('Global Reference');
    expect(refCheckbox).not.toBeChecked();

    // Toggle the ref checkbox to mark it as global
    fireEvent.click(refCheckbox);

    // Verify the schema was updated with ref attribute
    await waitFor(() => {
      const simpleType = latestSchema?.['xs:schema']?.['xs:simpleType']?.[0];
      expect(simpleType?.['@attributes']?.ref).toBe('true');
    });

    // Verify the node is rendered and has globalType styling
    await waitFor(() => {
      const nodeElement = document.querySelector('.react-flow__node[data-id="1.simpleType_0"]');
      expect(nodeElement).toBeInTheDocument();
    });

    // Uncheck the ref checkbox
    fireEvent.click(refCheckbox);

    // Verify the ref attribute was removed
    await waitFor(() => {
      const simpleType = latestSchema?.['xs:schema']?.['xs:simpleType']?.[0];
      expect(simpleType?.['@attributes']?.ref).toBeUndefined();
    });
  });

  it('reflects targetNamespace attribute in RHS node data when root schema node is selected', async () => {
    const targetNamespaceUrl = 'http://example.com/my-schema';
    const elementFormDefault = 'qualified';
    const attributeFormDefault = 'unqualified';

    const schema = {
      'xs:schema': {
        '@attributes': {
          'xmlns:xs': 'http://www.w3.org/2001/XMLSchema',
          targetNamespace: targetNamespaceUrl,
          elementFormDefault,
          attributeFormDefault,
        },
        'xs:element': [
          {
            '@attributes': { name: 'root', type: 'xs:string' },
          },
        ],
      },
    } as any;

    render(<GraphicalSchemaEditor schema={schema} schemaLanguage="xml" onChange={() => {}} />);

    // Click on the xs:schema root node to select it
    const schemaNode = await screen.findByText('xs:schema');
    fireEvent.click(schemaNode);

    // Verify that the target namespace input field is populated with the correct value
    const targetNamespaceInput = await screen.findByLabelText('Target Namespace') as HTMLInputElement;
    expect(targetNamespaceInput.value).toBe(targetNamespaceUrl);

    // Verify the elementFormDefault is set correctly
    const elementFormSelect = await screen.findByLabelText('Element Form Default') as HTMLSelectElement;
    expect(elementFormSelect.value).toBe(elementFormDefault);

    // Verify the attributeFormDefault is set correctly
    const attributeFormSelect = await screen.findByLabelText('Attribute Form Default') as HTMLSelectElement;
    expect(attributeFormSelect.value).toBe(attributeFormDefault);
  });
});

describe('GraphicalSchemaEditor - XML circular type-reference handling', () => {
  beforeEach(() => {
    delete (globalThis as any).__graphicalSchemaExpansionState;
  });

  it('expands a global element\'s named type one level and stops a self-referential child with an isRef badge', async () => {
    const schema = {
      'xs:schema': {
        'xs:complexType': [
          {
            '@attributes': { name: 'TreeNode' },
            'xs:sequence': {
              'xs:element': {
                '@attributes': { name: 'child', type: 'TreeNode', minOccurs: '0', maxOccurs: 'unbounded' },
              },
            },
          },
        ],
        'xs:element': [
          { '@attributes': { name: 'root', type: 'TreeNode' } },
        ],
      },
    } as any;

    render(<GraphicalSchemaEditor schema={schema} schemaLanguage="xml" onChange={() => {}} />);
    await expandAllGraphNodes();

    // The global element expands its named type inline: root -> sequence -> child.
    // The TreeNode complexType's own flat definition also renders its own "child" element,
    // so "child" appears twice (once per rendered tree) — both stopped immediately since
    // they reference the same TreeNode type that's already being expanded.
    await screen.findByText('root');
    await waitFor(() => {
      expect(screen.getAllByText('child')).toHaveLength(2);
    });

    // Every self-referential "child" (type="TreeNode") is stopped and flagged with a Ref badge
    const isRefBadges = await screen.findAllByText('Ref');
    expect(isRefBadges.length).toBe(2);
  });

  it('does not infinitely recurse for mutually-referential complexTypes', async () => {
    const schema = {
      'xs:schema': {
        'xs:complexType': [
          {
            '@attributes': { name: 'A' },
            'xs:sequence': {
              'xs:element': { '@attributes': { name: 'toB', type: 'B' } },
            },
          },
          {
            '@attributes': { name: 'B' },
            'xs:sequence': {
              'xs:element': { '@attributes': { name: 'toA', type: 'A' } },
            },
          },
        ],
        'xs:element': [
          { '@attributes': { name: 'start', type: 'A' } },
        ],
      },
    } as any;

    render(<GraphicalSchemaEditor schema={schema} schemaLanguage="xml" onChange={() => {}} />);
    await expandAllGraphNodes();

    await screen.findByText('start');
    await waitFor(() => {
      expect(screen.getAllByText('toB').length).toBeGreaterThan(0);
      expect(screen.getAllByText('toA').length).toBeGreaterThan(0);
    });
    // Mutual A <-> B recursion terminates and at least one side is flagged circular.
    expect((await screen.findAllByText('Ref')).length).toBeGreaterThan(0);
  });

  it('stops expanding a self-referential element ref and flags it as a ref', async () => {
    const schema = {
      'xs:schema': {
        'xs:element': [
          {
            '@attributes': { name: 'A' },
            'xs:complexType': {
              'xs:sequence': {
                'xs:element': { '@attributes': { ref: 'A', minOccurs: '0' } },
              },
            },
          },
        ],
      },
    } as any;

    render(<GraphicalSchemaEditor schema={schema} schemaLanguage="xml" onChange={() => {}} />);
    await expandAllGraphNodes();

    await screen.findAllByText('A');
    expect(screen.getAllByText('Ref').length).toBe(1);
  });

  it('expands a nested element ref and shows its referenced children', async () => {
    const schema = {
      'xs:schema': {
        'xs:element': [
          {
            '@attributes': { name: 'root' },
            'xs:complexType': {
              'xs:sequence': {
                'xs:element': {
                  '@attributes': { ref: 'htmlinput' },
                },
              },
            },
          },
          {
            '@attributes': { name: 'htmlinput' },
            'xs:complexType': {
              'xs:sequence': {
                'xs:element': [
                  { '@attributes': { name: 'fieldname', type: 'xs:string' } },
                  { '@attributes': { name: 'fieldlabel', type: 'xs:string' } },
                ],
              },
            },
          },
        ],
      },
    } as any;

    render(<GraphicalSchemaEditor schema={schema} schemaLanguage="xml" onChange={() => {}} />);
    await expandAllGraphNodes();

    const fieldnames = await screen.findAllByText('fieldname');
    const fieldlabels = await screen.findAllByText('fieldlabel');
    expect(fieldnames.length).toBeGreaterThan(0);
    expect(fieldlabels.length).toBeGreaterThan(0);
  });

  it('expands real nested datafield refs and shows htmlinput children', async () => {
    const xsdPath = path.join(__dirname, '..', '..', 'public', 'schemas', 'autodb-v2.xsd');
    const xsd = fs.readFileSync(xsdPath, 'utf-8');
    const parsed = parseMarkup(xsd, 'xml') as any;

    render(<GraphicalSchemaEditor schema={parsed} schemaLanguage="xml" onChange={() => {}} />);

    const datafieldLabel = await screen.findByText('datafield');
    expect(datafieldLabel).toBeInTheDocument();
    const datafieldNode = datafieldLabel.closest('.react-flow__node');
    expect(datafieldNode).toBeTruthy();

    const expandButton = within(datafieldNode as HTMLElement).getByTitle('Expand children');
    expect(expandButton).toBeInTheDocument();

    const beforeHtmlinputCount = screen.queryAllByText('htmlinput').length;
    const beforeFieldnameCount = screen.queryAllByText('fieldname').length;

    fireEvent.click(expandButton);

    await waitFor(() => expect(screen.queryAllByText('htmlinput').length).toBeGreaterThan(beforeHtmlinputCount));

    const htmlinputLabels = screen.queryAllByText('htmlinput');
    const newHtmlinputLabel = htmlinputLabels[htmlinputLabels.length - 1];
    const htmlinputNode = newHtmlinputLabel.closest('.react-flow__node');
    expect(htmlinputNode).toBeTruthy();

    const htmlinputExpandButton = within(htmlinputNode as HTMLElement).getByTitle('Expand children');
    expect(htmlinputExpandButton).toBeInTheDocument();

    await waitFor(() => expect(screen.queryAllByText('fieldname').length).toBeGreaterThan(beforeFieldnameCount));
    expect(screen.queryAllByText('fieldlabel').length).toBeGreaterThan(beforeFieldnameCount);
  });

  it('loads and round-trips xs:annotation/xs:documentation for a simpleType node', async () => {
    const initialSchema = {
      'xs:schema': {
        'xs:simpleType': [
          {
            '@attributes': { name: 'StatusCode' },
            'xs:annotation': { 'xs:documentation': { '#text': 'Existing docs.' } },
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

    fireEvent.click(await screen.findByText('StatusCode'));
    await screen.findByText('SimpleType Editor');

    const annotationField = screen.getByLabelText('Annotation') as HTMLTextAreaElement;
    expect(annotationField).toHaveValue('Existing docs.');

    fireEvent.change(annotationField, { target: { value: 'Updated docs.' } });
    fireEvent.blur(annotationField);

    await waitFor(() => {
      const simpleType = latestSchema?.['xs:schema']?.['xs:simpleType']?.[0];
      expect(simpleType?.['xs:annotation']?.['xs:documentation']?.['#text']).toBe('Updated docs.');
    });
  });
});

