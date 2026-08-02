import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GraphicalSchemaEditor } from './graphical-schema-editor';
import { parseMarkup } from '../utils/markup';

describe('GraphicalSchemaEditor load performance', () => {
  it('measures initial load time for a real XML schema', async () => {
    const xsdPath = path.join(__dirname, '..', '..', 'public', 'schemas', 'autodb-v2.xsd');
    const xsd = fs.readFileSync(xsdPath, 'utf-8');
    const parsed = parseMarkup(xsd, 'xml');

    const start = performance.now();
    render(<GraphicalSchemaEditor schema={parsed as any} schemaLanguage="xml" onChange={() => {}} />);
    await screen.findByText('xs:schema');
    const duration = performance.now() - start;
    // eslint-disable-next-line no-console
    console.log(`GraphicalSchemaEditor initial graph load: ${duration.toFixed(1)} ms`);
    expect(duration).toBeGreaterThan(0);
  }, 30000);
});
