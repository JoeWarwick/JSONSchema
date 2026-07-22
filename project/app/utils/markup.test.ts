import * as fs from 'fs';
import * as path from 'path';
import { detectMarkupLanguageFromPath, parseMarkup, serializeMarkup } from './markup';

describe('markup', () => {
  test('detects markup language from file path', () => {
    expect(detectMarkupLanguageFromPath('schema.yaml')).toBe('yaml');
    expect(detectMarkupLanguageFromPath('schema.yml')).toBe('yaml');
    expect(detectMarkupLanguageFromPath('schema.xml')).toBe('xml');
    expect(detectMarkupLanguageFromPath('schema.json')).toBe('json');
    expect(detectMarkupLanguageFromPath('schema')).toBe('json');
  });

  test('parses YAML into plain JS values', () => {
    const parsed = parseMarkup(`name: Example
enabled: true
items:
  - one
  - two
`, 'yaml') as Record<string, unknown>;

    expect(parsed).toEqual({
      name: 'Example',
      enabled: true,
      items: ['one', 'two'],
    });
  });

  test('serializes plain JS values to YAML', () => {
    const yaml = serializeMarkup({ name: 'Example', count: 2, enabled: false }, 'yaml');

    expect(yaml).toContain('name: Example');
    expect(yaml).toContain('count: 2');
    expect(yaml).toContain('enabled: false');
  });

  test('parses namespaced XML Schema into a plain object tree and round-trips it', () => {
    const fixturePath = path.resolve(process.cwd(), 'public/schemas/EigerModelType.xsd');
    const xml = fs.readFileSync(fixturePath, 'utf-8');

    const parsed = parseMarkup(xml, 'xml') as Record<string, any>;
    const root = parsed['xs:schema'];

    expect(root).toBeTruthy();
    expect(root['@attributes']).toMatchObject({
      xmlns: 'http://schemas.datacontract.org/2004/07/RPFabric.Core.Data',
      'xmlns:xs': 'http://www.w3.org/2001/XMLSchema',
      targetNamespace: 'http://schemas.datacontract.org/2004/07/RPFabric.Core.Data',
      elementFormDefault: 'qualified',
      attributeFormDefault: 'unqualified',
    });
    expect(Array.isArray(root['xs:element'])).toBe(true);
    expect((root['xs:element'] as any[]).map(entry => entry['@attributes']?.name)).toEqual(
      expect.arrayContaining(['UpgradeStep', 'ModelType', 'Transformations', 'Field', 'Enum'])
    );

    const serialized = serializeMarkup(parsed, 'xml');
    expect(serialized).toContain('<xs:schema');
    expect(serialized).toContain('targetNamespace="http://schemas.datacontract.org/2004/07/RPFabric.Core.Data"');
    expect(serialized).toContain('xmlns:xs="http://www.w3.org/2001/XMLSchema"');

    const reparsed = parseMarkup(serialized, 'xml') as Record<string, any>;
    expect(reparsed['xs:schema']['@attributes']).toMatchObject({
      targetNamespace: 'http://schemas.datacontract.org/2004/07/RPFabric.Core.Data',
      'xmlns:xs': 'http://www.w3.org/2001/XMLSchema',
    });
  });
});