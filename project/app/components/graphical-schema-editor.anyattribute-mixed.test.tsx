import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GraphicalSchemaEditor } from './graphical-schema-editor';
import { parseMarkup } from '../utils/markup';
import { expandAllGraphNodes } from './test-fixtures/expand-all-nodes';

describe('GraphicalSchemaEditor - xs:anyAttribute and mixed support', () => {
  it('preserves mixed and xs:anyAttribute on elements with inline complexType', async () => {
    const xsd = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:element name="Root">
          <xs:complexType mixed="true">
            <xs:sequence>
              <xs:element name="Child" type="xs:string"/>
            </xs:sequence>
            <xs:anyAttribute namespace="##other"/>
          </xs:complexType>
        </xs:element>
      </xs:schema>`;
    const parsed = parseMarkup(xsd, 'xml');

    let latestSchema: any = parsed;
    function StatefulXmlEditor() {
      const [currentSchema, setCurrentSchema] = React.useState<any>(parsed);
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

    fireEvent.click(await screen.findByText('Root'));
    expect(await screen.findByText('Element Editor')).toBeInTheDocument();

    const mixedCheckbox = screen.getByLabelText('Mixed Content') as HTMLInputElement;
    expect(mixedCheckbox).toBeInTheDocument();
    expect(mixedCheckbox.checked).toBe(true);

    const anyAttrInput = screen.getByLabelText('AnyAttribute Namespace') as HTMLInputElement;
    expect(anyAttrInput).toBeInTheDocument();
    expect(anyAttrInput.value).toBe('##other');

    // Turn off mixed and change the anyAttribute namespace
    fireEvent.click(mixedCheckbox);
    fireEvent.change(anyAttrInput, { target: { value: '##local' } });
    fireEvent.blur(anyAttrInput);

    await waitFor(() => {
      const elements = latestSchema?.['xs:schema']?.['xs:element'];
      const root = Array.isArray(elements) ? elements[0] : elements;
      expect(root?.['xs:complexType']?.['@attributes']?.mixed).toBeUndefined();
      expect(root?.['xs:complexType']?.['xs:anyAttribute']?.['@attributes']?.namespace).toBe('##local');
    });
  });

  it('does not render false values as graph badges for XML boolean metadata', async () => {
    const xsd = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:element name="Root">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="Child" type="xs:string"/>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
      </xs:schema>`;
    const parsed = parseMarkup(xsd, 'xml');

    render(<GraphicalSchemaEditor schema={parsed as any} schemaLanguage="xml" onChange={() => {}} />);
    await expandAllGraphNodes();

    expect(screen.queryByText('false')).not.toBeInTheDocument();
  });
});
