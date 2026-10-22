import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TooltipProvider } from './app/components/ui/tooltip/tooltip';
import { XmlInstanceForm } from './app/components/xml-instance-form';
import { parseMarkup } from './app/utils/markup';

const renderForm = (ui: React.ReactElement) => render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);

it('debug generic', async () => {
  const xmlSchemaDefinition = parseMarkup(fs.readFileSync(path.resolve(process.cwd(), 'public/schemas/XMLSchema.xsd'), 'utf8'), 'xml') as any;
  const xsltSchema = parseMarkup(fs.readFileSync(path.resolve(process.cwd(), 'public/schemas/schema-for-xslt20.xsd'), 'utf8'), 'xml') as any;
  const complexTypes = xsltSchema['xs:schema']['xs:complexType'];
  const genericElementType = (Array.isArray(complexTypes) ? complexTypes : [complexTypes]).find((entry: any) => entry?.['@attributes']?.name === 'generic-element-type');
  renderForm(<XmlInstanceForm schema={xmlSchemaDefinition} rootSchema={xsltSchema} value={{ 'xs:complexType': genericElementType }} onChange={jest.fn()} autoExpandAll expansionStateKey="xml-schema-form-expanded" />);
  screen.debug(document.body, 200000);
});
