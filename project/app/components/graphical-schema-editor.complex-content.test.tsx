import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GraphicalSchemaEditor } from './graphical-schema-editor';
import { parseMarkup } from '../utils/markup';
import { expandNodeByLabel, expandNodeByDataId } from './test-fixtures/expand-all-nodes';

describe('GraphicalSchemaEditor - xs:complexContent/xs:extension', () => {
  it('expands inherited base-type attributes for an element with an inline complexContent extension', async () => {
    const xsdPath = path.join(__dirname, '../../public/schemas/EigerModelType.xsd');
    const xsd = fs.readFileSync(xsdPath, 'utf-8');
    const parsed = parseMarkup(xsd, 'xml');

    render(<GraphicalSchemaEditor schema={parsed as any} schemaLanguage="xml" />);

    // "UpgradeStep" is the root's direct child; "Models" and "Model" are nested progressively
    // deeper inside it.
    await expandNodeByDataId('1.element_0'); // UpgradeStep
    // Compositor nodes automatically reveal their children when their parent expands.
    await expandNodeByDataId('1.element_0.sequence.element_0'); // Models
    await expandNodeByDataId('1.element_0.sequence.element_0.sequence.element_0'); // Model
    // arrayOfType is itself a root-level global complexType; expand it to reveal its
    // inherited-from-modelType members for the inheritance group box assertion below.
    await expandNodeByLabel('arrayOfType');

    // The Model element's inline complexType uses complexContent/extension base="modelType";
    // its own extra field (PostScript) and the inherited modelType attribute (e.g. "name") should both render.
    expect(await screen.findByText('PostScript')).toBeInTheDocument();
    expect((await screen.findAllByText('name')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('version-number')).length).toBeGreaterThan(0);

    // arrayOfType (global complexType) extends modelType via complexContent too.
    expect(await screen.findByText('arrayOfType')).toBeInTheDocument();

    // A decorative background box should be drawn grouping each extending node with its
    // inherited-from-modelType descendants (one for the Model element, one for arrayOfType).
    await waitFor(() => {
      const groupBoxes = document.querySelectorAll('.react-flow__node[data-id$=".inheritance-group"]');
      expect(groupBoxes.length).toBeGreaterThanOrEqual(2);
    });
  }, 20000);
});

