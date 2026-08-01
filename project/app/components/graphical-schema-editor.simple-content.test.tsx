import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GraphicalSchemaEditor } from './graphical-schema-editor';
import { parseMarkup } from '../utils/markup';
import { expandAllGraphNodes } from './test-fixtures/expand-all-nodes';

describe('GraphicalSchemaEditor - xs:simpleContent/xs:extension', () => {
  it('expands attributes for a complexType and an inline element complexType using simpleContent', async () => {
    const xsd = `<?xml version="1.0"?>
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:complexType name="MoneyType">
          <xs:simpleContent>
            <xs:extension base="xs:decimal">
              <xs:attribute name="currency" type="xs:string" use="required"/>
            </xs:extension>
          </xs:simpleContent>
        </xs:complexType>
        <xs:element name="Root">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="Price" type="MoneyType"/>
              <xs:element name="Note">
                <xs:complexType>
                  <xs:simpleContent>
                    <xs:extension base="xs:string">
                      <xs:attribute name="lang" type="xs:string"/>
                    </xs:extension>
                  </xs:simpleContent>
                </xs:complexType>
              </xs:element>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
      </xs:schema>`;
    const parsed = parseMarkup(xsd, 'xml');

    render(<GraphicalSchemaEditor schema={parsed as any} schemaLanguage="xml" />);

    // MoneyType (top-level complexType with simpleContent) shows its own extension attribute.
    expect(await screen.findByText('MoneyType')).toBeInTheDocument();
    await expandAllGraphNodes();
    expect((await screen.findAllByText('currency')).length).toBeGreaterThan(0);

    // Price references MoneyType by name -> its inline expansion should also show "currency".
    expect(await screen.findByText('Price')).toBeInTheDocument();

    // Note has an inline complexType using simpleContent directly on the element.
    expect(await screen.findByText('Note')).toBeInTheDocument();
    expect((await screen.findAllByText('lang')).length).toBeGreaterThan(0);
  });
});
