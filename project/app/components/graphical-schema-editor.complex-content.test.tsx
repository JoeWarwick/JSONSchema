import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GraphicalSchemaEditor } from './graphical-schema-editor';
import { parseMarkup } from '../utils/markup';

describe('GraphicalSchemaEditor - xs:complexContent/xs:extension', () => {
  it('expands inherited base-type attributes for an element with an inline complexContent extension', async () => {
    const xsdPath = path.join(__dirname, '../../public/schemas/EigerModelType.xsd');
    const xsd = fs.readFileSync(xsdPath, 'utf-8');
    const parsed = parseMarkup(xsd, 'xml');

    render(<GraphicalSchemaEditor schema={parsed as any} schemaLanguage="xml" />);

    // The Model element's inline complexType uses complexContent/extension base="modelType";
    // its own extra field (PostScript) and the inherited modelType attribute (e.g. "name") should both render.
    expect(await screen.findByText('PostScript')).toBeInTheDocument();
    expect((await screen.findAllByText('name')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('version-number')).length).toBeGreaterThan(0);

    // arrayOfType (global complexType) extends modelType via complexContent too.
    expect(await screen.findByText('arrayOfType')).toBeInTheDocument();
  });
});
