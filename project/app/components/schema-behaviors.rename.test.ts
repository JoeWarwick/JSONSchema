import { renamePatternPropertyInSchema } from './schema-behaviors';

describe('renamePatternPropertyInSchema', () => {
  test('renames an existing key', () => {
    const schema = { type: 'object', patternProperties: { '^pat$': { type: 'string' } } } as any;
    const next = renamePatternPropertyInSchema(schema, '^pat$', '^new$');
    const pp = next.patternProperties as Record<string, unknown>;
    expect(pp['^new$']).toEqual({ type: 'string' });
    expect(pp['^pat$']).toBeUndefined();
  });

  test('resolves conflicts by appending suffix', () => {
    const schema = { type: 'object', patternProperties: { '^a$': { type: 'string' }, '^b$': { type: 'number' } } } as any;
    const next = renamePatternPropertyInSchema(schema, '^a$', '^b$');
    // '^b_' or '^b$_1' accepted; ensure new key exists and old removed
    const keys = Object.keys(next.patternProperties as Record<string, unknown>);
    expect(keys).toContain('^b$');
    const other = keys.find(k => k !== '^b$' && /\^b\$_?\d*/.test(k));
    expect(other).toBeTruthy();
    expect((next.patternProperties as any)['^a$']).toBeUndefined();
  });
});