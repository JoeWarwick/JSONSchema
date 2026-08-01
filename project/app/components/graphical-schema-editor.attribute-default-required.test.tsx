import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GraphicalSchemaEditor } from './graphical-schema-editor';
import { expandAllGraphNodes } from './test-fixtures/expand-all-nodes';

// Covers the `xs:attribute` `default="..."` value and `use="required"` badges: they render on
// the graph node, and can be added/edited/removed from the Attribute Editor's small toggle
// controls (rather than always-visible fields), writing back to the underlying XSD JSON.
describe('GraphicalSchemaEditor - XML attribute default value & required toggle badges', () => {
  function buildSchema() {
    return {
      'xs:schema': {
        'xs:complexType': [
          {
            '@attributes': { name: 'widgetType' },
            'xs:attribute': [
              { '@attributes': { name: 'kind', type: 'xs:string', default: 'basic' } },
              { '@attributes': { name: 'label', type: 'xs:string', use: 'optional' } },
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

  const getAttr = (schema: any, index: number) => schema?.['xs:schema']?.['xs:complexType']?.[0]?.['xs:attribute']?.[index];

  it('renders the attribute node for an attribute with a default', async () => {
    render(<GraphicalSchemaEditor schema={buildSchema()} schemaLanguage="xml" onChange={() => {}} />);
    await expandAllGraphNodes();

    expect(await screen.findByText('kind')).toBeInTheDocument();
  });

  it('shows the default value pre-expanded and read-only for a referenced attributeGroup attribute', async () => {
    const xsd = {
      'xs:schema': {
        'xs:complexType': [
          {
            '@attributes': { name: 'fieldType' },
            'xs:attributeGroup': { '@attributes': { ref: 'shared' } },
          },
        ],
        'xs:attributeGroup': {
          '@attributes': { name: 'shared' },
          'xs:attribute': { '@attributes': { name: 'cstype-name', type: 'xs:string', default: 'MetaData' } },
        },
      },
    } as any;

    render(<GraphicalSchemaEditor schema={xsd} schemaLanguage="xml" onChange={() => {}} />);
    await expandAllGraphNodes();

    // The attributeGroup definition node and the fieldType's expanded ref both render a
    // "cstype-name" label; click the referenced (read-only) copy.
    const labels = await screen.findAllByText('cstype-name');
    fireEvent.click(labels[labels.length - 1]);
    expect(await screen.findByText('Attribute Editor')).toBeInTheDocument();
    expect(await screen.findByLabelText('Attribute Default Value')).toHaveValue('MetaData');
  });

  it('toggles the "required" badge on and off, updating xmlAttributeUse', async () => {
    let latestSchema = buildSchema();
    render(<StatefulXmlEditor initialSchema={latestSchema} onLatest={(s) => { latestSchema = s; }} />);
    await expandAllGraphNodes();

    fireEvent.click(await screen.findByText('label'));
    expect(await screen.findByText('Attribute Editor')).toBeInTheDocument();

    const toggle = await screen.findByLabelText('Toggle Required');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(getAttr(latestSchema, 1)?.['@attributes']?.use).toBe('required');
    });
    expect(await screen.findByLabelText('Toggle Required')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(await screen.findByLabelText('Toggle Required'));
    await waitFor(() => {
      expect(getAttr(latestSchema, 1)?.['@attributes']?.use).toBe('optional');
    });
  });

  it('adds a default value via the "+ default" badge and removes it via the remove control', async () => {
    let latestSchema = buildSchema();
    render(<StatefulXmlEditor initialSchema={latestSchema} onLatest={(s) => { latestSchema = s; }} />);
    await expandAllGraphNodes();

    fireEvent.click(await screen.findByText('label'));
    expect(await screen.findByText('Attribute Editor')).toBeInTheDocument();

    // No default yet: shows the compact toggle badge, not an input.
    expect(screen.queryByLabelText('Attribute Default Value')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByLabelText('Add Default Value'));

    const input = await screen.findByLabelText('Attribute Default Value');
    fireEvent.change(input, { target: { value: 'fallback' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(getAttr(latestSchema, 1)?.['@attributes']?.default).toBe('fallback');
    });

    fireEvent.click(await screen.findByLabelText('Remove Default Value'));
    await waitFor(() => {
      expect(getAttr(latestSchema, 1)?.['@attributes']?.default).toBeUndefined();
    });
    expect(screen.queryByLabelText('Attribute Default Value')).not.toBeInTheDocument();
  });
});
