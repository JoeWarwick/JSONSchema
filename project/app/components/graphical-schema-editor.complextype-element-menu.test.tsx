import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GraphicalSchemaEditor } from './graphical-schema-editor';

// Verifies that both `complexType` and `element` nodes expose the full
// Add [Element, Attribute, AttributeGroup, Sequence, Choice, All] action set.
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

    fireEvent.click(await screen.findByRole('button', { name: 'Add Attribute' }));

    await waitFor(() => {
      const complexType = latestSchema['xs:schema']['xs:complexType'][0];
      expect(complexType['xs:attribute']?.['@attributes']?.name).toBe('attribute1');
    });
  });

  it('shows all six Add actions on an element node and adding element/attribute creates an inline complexType', async () => {
    let latestSchema: any = {
      'xs:schema': {
        'xs:element': [{ '@attributes': { name: 'Root', type: 'xs:string' } }],
      },
    };

    render(<StatefulXmlEditor initialSchema={latestSchema} onLatest={(s) => { latestSchema = s; }} />);

    const elementLabel = await screen.findByText('Root');
    fireEvent.contextMenu(elementLabel);

    for (const label of ['Add sequence', 'Add choice', 'Add all', 'Add element', 'Add Attribute', 'Add AttributeGroup']) {
      expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
    }

    fireEvent.click(await screen.findByRole('button', { name: 'Add element' }));

    await waitFor(() => {
      const element = latestSchema['xs:schema']['xs:element'][0];
      expect(element['@attributes'].type).toBeUndefined();
      const sequence = element['xs:complexType']?.['xs:sequence'];
      expect(sequence?.['xs:element']?.['@attributes']?.name).toBe('element1');
    });
  });
});
