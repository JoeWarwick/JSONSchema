import { getEditorSchema } from './schemaReducer';
import type { SchemaState } from './schemaReducer';

/**
 * Test for mutation issue where getEditorSchema would cause state.resolvedCache
 * to lose $defs after being called (due to shared object references).
 * 
 * Scenario from issue: 
 * - Initial: rootSchema has defs, schema doesn't
 * - During render: both have defs (mutation leaked)
 * - After render: schema has defs, rootSchema lost them (mutation persisted)
 */
describe('schemaReducer - mutation prevention', () => {
  it('getEditorSchema should not mutate state.resolvedCache', () => {
    // Create a schema with $defs
    const resolvedCacheWithDefs = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' }
      },
      $defs: {
        Person: {
          type: 'object',
          properties: {
            firstName: { type: 'string' },
            lastName: { type: 'string' }
          }
        }
      }
    } as any;

    // Deep clone to verify object reference integrity
    const originalDefsJson = JSON.stringify(resolvedCacheWithDefs.$defs);
    const resolvedCacheRef = resolvedCacheWithDefs; // Keep reference to original

    const state: SchemaState = {
      source: null,
      resolvedCache: resolvedCacheWithDefs,
      sourceIsObject: true,
      derefInProgress: false
    };

    // Call getEditorSchema multiple times (simulate re-renders)
    for (let i = 0; i < 3; i++) {
      const editorSchema = getEditorSchema(state) as any;
      const rootSchema = state.resolvedCache as any;

      // Verify editorSchema does NOT have $defs
      expect(editorSchema.$defs).toBeUndefined();
      expect(editorSchema.properties).toBeDefined();

      // Verify state.resolvedCache STILL HAS $defs (not mutated)
      expect(rootSchema.$defs).toBeDefined();
      expect(rootSchema.$defs).toEqual(resolvedCacheWithDefs.$defs);

      // Verify the $defs content is unchanged
      expect(JSON.stringify(rootSchema.$defs)).toBe(originalDefsJson);

      // Verify we didn't accidentally share references
      expect((editorSchema as any) === state.resolvedCache).toBe(false);
      expect((editorSchema as any).properties === rootSchema.properties).toBe(false);
    }

    // Triple-check: original ref should still have $defs
    expect(resolvedCacheRef.$defs).toBeDefined();
  });

  it('editorSchema and rootSchema should be independent objects', () => {
    const resolvedCache = {
      type: 'object',
      properties: {
        on: { type: 'string' }
      },
      $defs: {
        Event: {
          type: 'object',
          properties: {
            name: { type: 'string' }
          }
        }
      }
    } as any;

    const state: SchemaState = {
      source: null,
      resolvedCache,
      sourceIsObject: true,
      derefInProgress: false
    };

    const editorSchema = getEditorSchema(state) as any;
    const rootSchema = state.resolvedCache as any;

    // Both should be objects
    expect(editorSchema).toEqual(expect.objectContaining({ type: 'object' }));
    expect(state.resolvedCache).toEqual(expect.objectContaining({ type: 'object' }));

    // But they should NOT be the same reference
    expect(editorSchema).not.toBe(state.resolvedCache);

    // editorSchema should NOT have $defs
    expect(editorSchema.$defs).toBeUndefined();

    // rootSchema SHOULD have $defs
    expect(rootSchema.$defs).toBeDefined();
    expect(rootSchema.$defs.Event).toBeDefined();

    // Mutating editorSchema should not affect resolved cache
    (editorSchema as any).mutated = true;
    expect((state.resolvedCache as any).mutated).toBeUndefined();
  });

  it('should handle nested properties without losing $defs across renders', () => {
    const resolvedCache = {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            name: { type: 'string' }
          }
        }
      },
      $defs: {
        User: { type: 'object' }
      }
    } as any;

    const state: SchemaState = {
      source: null,
      resolvedCache,
      sourceIsObject: true,
      derefInProgress: false
    };

    // Simulate multiple render cycles
    const editorSchemas = [];
    for (let i = 0; i < 5; i++) {
      editorSchemas.push(getEditorSchema(state) as any);
    }

    // Check all editor schemas
    editorSchemas.forEach((schema) => {
      expect(schema.$defs).toBeUndefined();
      expect(schema.properties?.user).toBeDefined();
    });

    // Check state.resolvedCache still intact
    const rootSchema = state.resolvedCache as any;
    expect(rootSchema.$defs).toBeDefined();
    expect(rootSchema.$defs.User).toBeDefined();
    expect(rootSchema.properties.user).toBeDefined();

    // Verify all editor schemas differ from state
    editorSchemas.forEach((schema) => {
      expect(schema).not.toBe(state.resolvedCache);
      expect(schema.properties).not.toBe(rootSchema.properties);
    });
  });
});
