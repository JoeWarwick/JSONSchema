import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GraphicalSchemaEditor } from './graphical-schema-editor';
import { parseMarkup } from '../utils/markup';
import { expandNodeByDataId } from './test-fixtures/expand-all-nodes';

// Repro for a reported freeze: clicking the "\u00d7" (Remove Default Value) badge on the
// real `EigerModelType.xsd` fixture's `modelType.namespace` attribute (which has
// `default="RPFabric.Core.Data"` and `type="namespaceType"`, a union simpleType) supposedly
// hung the page. If there's a genuine infinite loop / runaway computation, this test will
// time out rather than complete.
describe('GraphicalSchemaEditor - removing xs:attribute default on a real large XSD does not hang', () => {
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

  it('removes the default value from modelType.namespace without hanging', async () => {
    const xsdPath = path.join(__dirname, '..', '..', 'public', 'schemas', 'EigerModelType.xsd');
    const xsd = fs.readFileSync(xsdPath, 'utf-8');
    const parsed = parseMarkup(xsd, 'xml');

    let latestSchema: any = parsed;
    render(<StatefulXmlEditor initialSchema={parsed} onLatest={(s) => { latestSchema = s; }} />);

    // modelType is a root-level global complexType (collapsed by default); expand it to reveal
    // its own "namespace" attribute directly.
    await expandNodeByDataId('1.complexType_0');

    const namespaceLabels = await screen.findAllByText('namespace');
    expect(namespaceLabels.length).toBeGreaterThan(0);

    // Click each occurrence until we find one whose Attribute Editor shows a default value
    // (the top-level `modelType` definition's own copy, not a bare-attribute duplicate elsewhere).
    let foundEditableWithDefault = false;
    for (const label of namespaceLabels) {
      fireEvent.click(label);
      // eslint-disable-next-line no-await-in-loop
      const editorHeading = await screen.findByText('Attribute Editor');
      expect(editorHeading).toBeInTheDocument();
      const removeBtn = screen.queryByLabelText('Remove Default Value');
      if (removeBtn) {
        foundEditableWithDefault = true;
        // Simulate the user having focused/edited the default-value input right before
        // clicking the remove badge (mousedown on the button blurs the input first).
        const input = screen.getByLabelText('Attribute Default Value');
        fireEvent.focus(input);
        fireEvent.mouseDown(removeBtn);
        fireEvent.blur(input);
        fireEvent.click(removeBtn);
        // eslint-disable-next-line no-await-in-loop
        await waitFor(() => {
          expect(screen.queryByLabelText('Attribute Default Value')).not.toBeInTheDocument();
        });
        break;
      }
    }

    expect(foundEditableWithDefault).toBe(true);

    // Confirm the write-back actually happened: no `xs:attribute` named "namespace" with
    // `type="namespaceType"` should still carry a `default` in the mutated schema.
    await waitFor(() => {
      const raw = JSON.stringify(latestSchema);
      // crude sanity check: the specific default value should be gone from at least one spot
      const modelType = (latestSchema as any)?.['xs:schema']?.['xs:complexType']?.find(
        (ct: any) => ct?.['@attributes']?.name === 'modelType'
      );
      const namespaceAttr = modelType?.['xs:attribute']?.find((a: any) => a?.['@attributes']?.name === 'namespace');
      expect(namespaceAttr?.['@attributes']?.default).toBeUndefined();
    });
  }, 15000);
});
