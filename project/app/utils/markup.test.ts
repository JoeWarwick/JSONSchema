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
});