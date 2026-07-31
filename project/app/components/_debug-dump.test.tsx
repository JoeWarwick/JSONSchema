import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GraphicalSchemaEditor } from './graphical-schema-editor';
import { parseMarkup } from '../utils/markup';

describe('debug dump', () => {
  it('dumps nodes', async () => {
    const xsdPath = path.join(__dirname, '../../public/schemas/EigerModelType.xsd');
    const xsd = fs.readFileSync(xsdPath, 'utf-8');
    const parsed = parseMarkup(xsd, 'xml');

    const { container } = render(<GraphicalSchemaEditor schema={parsed as any} schemaLanguage="xml" />);

    await waitFor(() => {
      expect(container.querySelectorAll('.react-flow__node').length).toBeGreaterThan(5);
    });

    const nodes = Array.from(container.querySelectorAll('.react-flow__node')) as HTMLElement[];
    const dump = nodes.map(n => ({ id: n.getAttribute('data-id'), text: n.textContent }));
    // eslint-disable-next-line no-console
    console.log('NODE_DUMP_START');
    console.log(JSON.stringify(dump, null, 2));
    console.log('NODE_DUMP_END');
  });
});
