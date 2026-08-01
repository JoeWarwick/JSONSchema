import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GraphicalSchemaEditor } from './graphical-schema-editor';
import { parseMarkup } from '../utils/markup';
import { expandAllGraphNodes } from './test-fixtures/expand-all-nodes';

describe('GraphicalSchemaEditor - xs:attributeGroup', () => {
  it('renders a top-level attributeGroup with its own attributes', async () => {
    const xsd = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:attributeGroup name="default-specifier">
          <xs:attribute name="default-value" type="xs:string" use="optional"/>
          <xs:attribute name="default-kind" type="xs:string"/>
        </xs:attributeGroup>
      </xs:schema>`;
    const parsed = parseMarkup(xsd, 'xml');

    render(<GraphicalSchemaEditor schema={parsed as any} schemaLanguage="xml" />);
    await expandAllGraphNodes();

    expect(await screen.findByText('default-specifier')).toBeInTheDocument();
    expect(await screen.findByText('default-value')).toBeInTheDocument();
    expect(await screen.findByText('default-kind')).toBeInTheDocument();
  });

  it('expands a nested xs:attributeGroup ref inside a complexType as read-only attribute nodes', async () => {
    const xsd = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:complexType name="fieldType">
          <xs:attribute name="name" type="xs:string" use="required"/>
          <xs:attributeGroup ref="default-specifier"/>
        </xs:complexType>
        <xs:attributeGroup name="default-specifier">
          <xs:attribute name="default-value" type="xs:string" use="optional"/>
          <xs:attribute name="cstype-name" type="xs:string" default="MetaData"/>
        </xs:attributeGroup>
        <xs:element name="Root" type="fieldType"/>
      </xs:schema>`;
    const parsed = parseMarkup(xsd, 'xml');

    render(<GraphicalSchemaEditor schema={parsed as any} schemaLanguage="xml" />);
    await expandAllGraphNodes();

    // fieldType's own attribute renders normally.
    expect((await screen.findAllByText('name')).length).toBeGreaterThan(0);

    // The referenced attributeGroup's attributes are pulled into the graph...
    expect((await screen.findAllByText('default-value')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('cstype-name')).length).toBeGreaterThan(0);

    // ...and each is flagged as a read-only reference (Ref badge).
    expect((await screen.findAllByText('Ref')).length).toBeGreaterThan(0);
  });
});
