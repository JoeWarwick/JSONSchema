import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GraphicalSchemaEditor } from './graphical-schema-editor';

// Covers displaying/editing `xs:enumeration` values on a named top-level `xs:simpleType`'s
// `xs:restriction` (e.g. EigerModelType.xsd's `modelNames`/`operationType`/`typesType`), which
// previously had no RHS representation at all — only Name/Mode/Base were editable.
describe('GraphicalSchemaEditor - XML named simpleType restriction enumeration editing', () => {
  beforeEach(() => {
    delete (globalThis as any).__graphicalSchemaExpansionState;
  });

  function buildSchema() {
    return {
      'xs:schema': {
        'xs:simpleType': [
          {
            '@attributes': { name: 'modelNames' },
            'xs:restriction': {
              '@attributes': { base: 'xs:string' },
              'xs:enumeration': [
                { '@attributes': { value: 'Item' } },
                { '@attributes': { value: 'Aggregation' } },
                { '@attributes': { value: 'Audit' } },
                { '@attributes': { value: 'Rule' } },
                { '@attributes': { value: 'ItemCategory' } },
              ],
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

  const getModelNames = (schema: any) => schema?.['xs:schema']?.['xs:simpleType']?.[0];

  it('shows the existing enumeration values when a restriction-mode simpleType is selected', async () => {
    render(<GraphicalSchemaEditor schema={buildSchema()} schemaLanguage="xml" onChange={() => {}} />);

    fireEvent.click(await screen.findByText('modelNames'));
    expect(await screen.findByText('SimpleType Editor')).toBeInTheDocument();
    expect(await screen.findByLabelText('SimpleType Mode')).toHaveValue('restriction');

    expect(await screen.findByLabelText('SimpleType enumeration value 1')).toHaveValue('Item');
    expect(await screen.findByLabelText('SimpleType enumeration value 2')).toHaveValue('Aggregation');
    expect(await screen.findByLabelText('SimpleType enumeration value 3')).toHaveValue('Audit');
    expect(await screen.findByLabelText('SimpleType enumeration value 4')).toHaveValue('Rule');
    expect(await screen.findByLabelText('SimpleType enumeration value 5')).toHaveValue('ItemCategory');
  });

  it('adds, reorders, edits, and removes enumeration values, persisting back to xs:restriction/xs:enumeration', async () => {
    let latestSchema = buildSchema();
    render(<StatefulXmlEditor initialSchema={latestSchema} onLatest={(s) => { latestSchema = s; }} />);

    fireEvent.click(await screen.findByText('modelNames'));
    await screen.findByLabelText('SimpleType enumeration value 1');

    // Add a new value (there are two "Add" buttons on screen — this simpleType editor's own
    // enumeration "Add" plus the disabled "Add attribute" button from XmlAttributesManager below it)
    const newValueInput = await screen.findByLabelText('SimpleType enumeration new value');
    fireEvent.change(newValueInput, { target: { value: 'CustomKind' } });
    const addButtons = screen.getAllByRole('button', { name: 'Add' });
    fireEvent.click(addButtons.find((b) => !(b as HTMLButtonElement).disabled)!);

    await waitFor(() => {
      const enumeration = getModelNames(latestSchema)?.['xs:restriction']?.['xs:enumeration'];
      expect(enumeration.map((e: any) => e['@attributes'].value)).toEqual([
        'Item', 'Aggregation', 'Audit', 'Rule', 'ItemCategory', 'CustomKind',
      ]);
    });

    // Move the first value down
    fireEvent.click(await screen.findByLabelText('SimpleType enumeration move down 1'));
    await waitFor(() => {
      const enumeration = getModelNames(latestSchema)?.['xs:restriction']?.['xs:enumeration'];
      expect(enumeration.map((e: any) => e['@attributes'].value)).toEqual([
        'Aggregation', 'Item', 'Audit', 'Rule', 'ItemCategory', 'CustomKind',
      ]);
    });

    // Edit a value directly
    const secondValueInput = await screen.findByLabelText('SimpleType enumeration value 2');
    fireEvent.change(secondValueInput, { target: { value: 'RenamedItem' } });
    await waitFor(() => {
      const enumeration = getModelNames(latestSchema)?.['xs:restriction']?.['xs:enumeration'];
      expect(enumeration.map((e: any) => e['@attributes'].value)).toEqual([
        'Aggregation', 'RenamedItem', 'Audit', 'Rule', 'ItemCategory', 'CustomKind',
      ]);
    });

    // Remove a value
    fireEvent.click(await screen.findByLabelText('SimpleType enumeration remove 3'));
    await waitFor(() => {
      const enumeration = getModelNames(latestSchema)?.['xs:restriction']?.['xs:enumeration'];
      expect(enumeration.map((e: any) => e['@attributes'].value)).toEqual([
        'Aggregation', 'RenamedItem', 'Rule', 'ItemCategory', 'CustomKind',
      ]);
    });
  });
});
