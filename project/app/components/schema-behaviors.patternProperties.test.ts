import {
  addPatternPropertyToSchema,
  removePatternPropertyFromSchema,
  updatePatternPropertyInSchema,
} from './schema-behaviors';

describe('patternProperties helpers', () => {
  test('adds a pattern property to an empty schema', () => {
    const schema = { type: 'object' } as Record<string, unknown>;
    const next = addPatternPropertyToSchema(schema);
    expect(next.patternProperties).toBeDefined();
    const keys = Object.keys(next.patternProperties as Record<string, unknown>);
    expect(keys.length).toBe(1);
    const subschema = (next.patternProperties as Record<string, any>)[keys[0]];
    expect(subschema).toEqual({ type: 'string' });
  });

  test('adds a unique key when pattern already exists', () => {
    const schema = { type: 'object', patternProperties: { '^pattern$': { type: 'string' } } } as Record<string, any>;
    const next = addPatternPropertyToSchema(schema);
    const keys = Object.keys(next.patternProperties as Record<string, unknown>);
    expect(keys.length).toBe(2);
    // second key should not be the same as first
    expect(keys[1]).not.toBe('^pattern$');
  });

  test('removes a pattern property and cleans up when empty', () => {
    const schema = { type: 'object', patternProperties: { '^pat$': { type: 'string' } } } as Record<string, any>;
    const next = removePatternPropertyFromSchema(schema, '^pat$');
    expect(next.patternProperties).toBeUndefined();
  });

  test('updates an existing pattern property subschema', () => {
    const schema = { type: 'object', patternProperties: { '^pat$': { type: 'string' } } } as Record<string, any>;
    const newSub = { type: 'number', minimum: 0 };
    const next = updatePatternPropertyInSchema(schema, '^pat$', newSub);
    expect((next.patternProperties as Record<string, any>)['^pat$']).toEqual(newSub);
  });

  test('renames a pattern property key', () => {
    const { renamePatternPropertyInSchema } = require('./schema-behaviors');
    const schema = { type: 'object', patternProperties: { '^old$': { type: 'string' } } } as Record<string, any>;
    const next = renamePatternPropertyInSchema(schema, '^old$', '^new$');
    expect(next.patternProperties).toEqual({ '^new$': { type: 'string' } });
  });

  test('enforces uniqueness when renaming pattern property key', () => {
    const { renamePatternPropertyInSchema } = require('./schema-behaviors');
    const schema = { 
      type: 'object', 
      patternProperties: { 
        '^pat1$': { type: 'string' },
        '^pat2$': { type: 'number' }
      } 
    } as Record<string, any>;
    // try to rename pat1 to pat2
    const next = renamePatternPropertyInSchema(schema, '^pat1$', '^pat2$');
    // should have both, but with suffix on the new one
    const keys = Object.keys(next.patternProperties);
    expect(keys).toContain('^pat2$');
    expect(keys).toContain('^pat2$_1');
    expect(next.patternProperties['^pat2$']).toEqual({ type: 'number' });
    expect(next.patternProperties['^pat2$_1']).toEqual({ type: 'string' });
  });
});