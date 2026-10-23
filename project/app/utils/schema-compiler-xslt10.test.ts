import { readFileSync } from 'fs';
import { compileSchema } from './schema-compiler';
import { parseMarkup } from './markup';

describe('XSLT 1.0 authoring schema in form tools', () => {
  const parsed = parseMarkup(readFileSync('public/schemas/schema-for-xslt10.xsd', 'utf-8'), 'xml');
  if (!parsed || typeof parsed !== 'object' || !('xs:schema' in parsed)) {
    throw new Error('Expected an XML Schema document.');
  }
  const compiled = compileSchema(parsed['xs:schema']);

  it('indexes stylesheet roots and XSLT 1.0 instructions but not later instructions', () => {
    expect(compiled.getElement('stylesheet')).toBeDefined();
    expect(compiled.getElement('transform')).toBeDefined();
    expect(compiled.getElement('apply-templates')).toBeDefined();
    expect(compiled.getElement('sequence')).toBeUndefined();
  });

  it('exposes a required fixed version and enum controls for authoring', () => {
    expect(compiled.getType('stylesheet')?.attributes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'version', use: 'required', fixed: '1.0' }),
    ]));
    expect(compiled.getEnumerations('yes-no')).toEqual(['yes', 'no']);
    expect(compiled.getEnumerations('number-level')).toEqual(['single', 'multiple', 'any']);
  });
});
