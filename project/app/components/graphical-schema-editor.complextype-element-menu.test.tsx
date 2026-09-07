import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GraphicalSchemaEditor } from './graphical-schema-editor';

// Verifies that complexType nodes expose full add actions, while simpleType-backed
// element nodes require an explicit conversion before complexType-only add actions appear.
describe('GraphicalSchemaEditor - complexType/element "Add …" context-menu actions', () => {
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

  it('shows all six Add actions on a complexType node and adds an attribute/element into it', async () => {
    let latestSchema: any = {
      'xs:schema': {
        'xs:complexType': [{ '@attributes': { name: 'PersonType' } }],
      },
    };

    render(<StatefulXmlEditor initialSchema={latestSchema} onLatest={(s) => { latestSchema = s; }} />);

    const complexTypeLabel = await screen.findByText('PersonType');
    fireEvent.contextMenu(complexTypeLabel);

    for (const label of ['Add sequence', 'Add choice', 'Add all', 'Add element', 'Add Attribute', 'Add AttributeGroup']) {
      expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Convert to ComplexType' })).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Add Attribute' }));

    await waitFor(() => {
      const complexType = latestSchema['xs:schema']['xs:complexType'][0];
      expect(complexType['xs:attribute']?.['@attributes']?.name).toBe('attribute1');
    });
  });

  it('adds and selects a sequence on a simpleContent-backed complexType node', async () => {
    let latestSchema: any = {
      'xs:schema': {
        'xs:complexType': [
          {
            '@attributes': { name: 'NoteType' },
            'xs:simpleContent': {
              'xs:extension': {
                '@attributes': { base: 'xs:string' },
                'xs:attribute': [{ '@attributes': { name: 'lang', type: 'xs:language' } }],
              },
            },
          },
        ],
      },
    };

    render(<StatefulXmlEditor initialSchema={latestSchema} onLatest={(s) => { latestSchema = s; }} />);

    fireEvent.contextMenu(await screen.findByText('NoteType'));
    fireEvent.click(await screen.findByRole('button', { name: 'Add sequence' }));

    await waitFor(() => {
      const complexType = latestSchema['xs:schema']['xs:complexType'][0];
      const sequence = complexType['xs:complexContent']?.['xs:extension']?.['xs:sequence'];
      expect(sequence?.['@attributes']?.minOccurs).toBe('1');
      expect(sequence?.['@attributes']?.maxOccurs).toBe('1');
    });

    await waitFor(() => {
      expect(document.querySelector('.react-flow__node[data-id="1.complexType_0.sequence"]')).not.toBeNull();
    });

    fireEvent.click(document.querySelector('.react-flow__node[data-id="1.complexType_0.sequence"]') as Element);
    expect(await screen.findByText('sequence Editor')).toBeInTheDocument();
  });

  it('adds an element to a simpleContent-backed NoteType complexType without dragging the tree down', async () => {
    let latestSchema: any = {
      'xs:schema': {
        'xs:complexType': [
          {
            '@attributes': { name: 'NoteType' },
            'xs:simpleContent': {
              'xs:extension': {
                '@attributes': { base: 'xs:string' },
                'xs:attribute': [{ '@attributes': { name: 'lang', type: 'xs:language' } }],
              },
            },
          },
        ],
      },
    };

    render(<StatefulXmlEditor initialSchema={latestSchema} onLatest={(s) => { latestSchema = s; }} />);

    fireEvent.contextMenu(await screen.findByText('NoteType'));
    fireEvent.click(await screen.findByRole('button', { name: 'Add element' }));

    await waitFor(() => {
      const complexType = latestSchema['xs:schema']['xs:complexType'][0];
      expect(complexType['xs:complexContent']?.['xs:extension']?.['xs:sequence']?.['xs:element']?.['@attributes']?.name).toBe('element1');
    });
  });

  it('requires explicit Convert to ComplexType on a simpleType-backed element before add actions are shown', async () => {
    let latestSchema: any = {
      'xs:schema': {
        'xs:element': [{ '@attributes': { name: 'Root', type: 'xs:string' } }],
      },
    };

    render(<StatefulXmlEditor initialSchema={latestSchema} onLatest={(s) => { latestSchema = s; }} />);

    const elementLabel = await screen.findByText('Root');
    fireEvent.contextMenu(elementLabel);

    expect(await screen.findByRole('button', { name: 'Convert to ComplexType' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Attribute' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add element' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add AttributeGroup' })).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Convert to ComplexType' }));

    await waitFor(() => {
      const element = latestSchema['xs:schema']['xs:element'][0];
      expect(element['@attributes'].type).toBeUndefined();
      expect(element['xs:complexType']?.['xs:simpleContent']?.['xs:extension']?.['@attributes']?.base).toBe('xs:string');
    });

    // Re-open context menu after conversion to verify complexType-only add actions are now available.
    fireEvent.contextMenu(await screen.findByText('Root'));

    for (const label of ['Add sequence', 'Add choice', 'Add all', 'Add element', 'Add Attribute', 'Add AttributeGroup']) {
      expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Convert to ComplexType' })).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Add element' }));

    await waitFor(() => {
      const element = latestSchema['xs:schema']['xs:element'][0];
      expect(element['@attributes'].type).toBeUndefined();
      const sequence = element['xs:complexType']?.['xs:complexContent']?.['xs:extension']?.['xs:sequence'];
      expect(sequence?.['xs:element']?.['@attributes']?.name).toBe('element1');
    });
  });

  it('does not show Convert to ComplexType for an element typed to a named complexType', async () => {
    let latestSchema: any = {
      'xs:schema': {
        'xs:complexType': [{ '@attributes': { name: 'AddressType' } }],
        'xs:element': [{ '@attributes': { name: 'address', type: 'AddressType' } }],
      },
    };

    render(<StatefulXmlEditor initialSchema={latestSchema} onLatest={(s) => { latestSchema = s; }} />);

    const elementLabel = await screen.findByText('address');
    fireEvent.contextMenu(elementLabel);

    expect(screen.queryByRole('button', { name: 'Convert to ComplexType' })).not.toBeInTheDocument();
  });
});
