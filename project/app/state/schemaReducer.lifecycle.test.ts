import schemaReducer, {
  getEditorSchema,
  LOAD_SOURCE_SCHEMA,
  APPLY_RESOLVED_EDIT
} from './schemaReducer';
import type { SchemaState } from './schemaReducer';

// Import the workflow schema for realistic testing
import workflowSchema from '../test-fixtures/schemastore-workflow.json';

/**
 * Comprehensive end-to-end test simulating the full lifecycle:
 * 1. Schema Load: Load a schema with definitions
 * 2. Initial Render: Verify rootSchema has defs, editorSchema doesn't
 * 3. Re-renders: Multiple calls to getEditorSchema should preserve state
 * 
 * This tests the actual issue: ref button disappearing on re-render
 * because rootSchema was losing its definitions.
 */
describe('schemaReducer - full workflow lifecycle', () => {
  it('should maintain rootSchema definitions through load → render → rerender cycle', () => {
    // Initial empty state
    let state: SchemaState = {
      source: null,
      resolvedCache: null,
      sourceIsObject: false,
      derefInProgress: false
    };

    // PHASE 1: Load schema from URL (simulated)
    const workflowWithDefs = JSON.parse(JSON.stringify(workflowSchema));
    expect(workflowWithDefs.definitions).toBeDefined();

    state = schemaReducer(state, {
      type: LOAD_SOURCE_SCHEMA,
      payload: workflowWithDefs
    });

    // After load: state.resolvedCache should exist
    expect(state.resolvedCache).toBeDefined();
    const resolvedCacheDefs = (state.resolvedCache as any)?.definitions || (state.resolvedCache as any)?.$defs;
    expect(resolvedCacheDefs).toBeDefined();

    // Store original reference to verify it's not mutated
    const originalResolved = state.resolvedCache;
    const originalDefsJson = JSON.stringify(resolvedCacheDefs);

    // PHASE 2: Initial render - call getEditorSchema once
    const editorSchemaFirstRender = getEditorSchema(state);

    // Verify separation of concerns:
    // - editorSchema should NOT have definitions (for clean UI)
    expect((editorSchemaFirstRender as any).definitions).toBeUndefined();
    expect((editorSchemaFirstRender as any).$defs).toBeUndefined();

    // - rootSchema (state.resolvedCache) SHOULD still have definitions
    expect(state.resolvedCache).toBeDefined();
    const rootSchemaDefs = (state.resolvedCache as any)?.definitions || (state.resolvedCache as any)?.$defs;
    expect(rootSchemaDefs).toBeDefined();
    expect(JSON.stringify(rootSchemaDefs)).toBe(originalDefsJson);

    // PHASE 3: Re-renders - simulate multiple render cycles
    const editorSchemas = [];
    for (let i = 0; i < 5; i++) {
      const schema = getEditorSchema(state);
      editorSchemas.push(schema);

      // Each editor schema should NOT have definitions
      expect((schema as any).definitions).toBeUndefined();
      expect((schema as any).$defs).toBeUndefined();

      // rootSchema should STILL have definitions after each call
      const currentRootDefs = (state.resolvedCache as any)?.definitions || (state.resolvedCache as any)?.$defs;
      expect(currentRootDefs).toBeDefined();
      expect(JSON.stringify(currentRootDefs)).toBe(originalDefsJson);
    }

    // PHASE 4: Verify independence of objects
    editorSchemas.forEach((editorSchema) => {
      // No editor schema should be the same object as rootSchema
      expect(editorSchema).not.toBe(state.resolvedCache);

      // No editor schema should be the same object as original resolved cache
      expect(editorSchema).not.toBe(originalResolved);

      // Modifying an editorSchema should not affect rootSchema
      (editorSchema as any).testMutation = true;
      expect((state.resolvedCache as any).testMutation).toBeUndefined();
    });

    // FINAL VERIFICATION: Original cached reference should be intact
    expect(state.resolvedCache).toBe(originalResolved);
    const finalDefs = (state.resolvedCache as any)?.definitions || (state.resolvedCache as any)?.$defs;
    expect(JSON.stringify(finalDefs)).toBe(originalDefsJson);
  });

  it('should allow edits while maintaining schema structure', () => {
    const workflowSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        on: { type: 'string' }
      },
      definitions: {
        Event: {
          type: 'object',
          properties: {
            name: { type: 'string' }
          }
        }
      }
    } as any;

    let state: SchemaState = {
      source: null,
      resolvedCache: null,
      sourceIsObject: false,
      derefInProgress: false
    };

    // Load schema
    state = schemaReducer(state, {
      type: LOAD_SOURCE_SCHEMA,
      payload: workflowSchema
    });

    // Get editor schema for rendering
    const editorSchema1 = getEditorSchema(state) as any;
    expect(editorSchema1.definitions).toBeUndefined();
    expect(editorSchema1.properties).toBeDefined();

    // Simulate user making an edit to the schema
    const editedSchema = {
      ...editorSchema1,
      properties: {
        ...(editorSchema1.properties || {}),
        newProp: { type: 'boolean' }
      }
    };

    // Apply the edit through the reducer
    state = schemaReducer(state, {
      type: APPLY_RESOLVED_EDIT,
      payload: editedSchema
    });

    // After edit, get editor schema again - it should have the new property
    const editorSchema2 = getEditorSchema(state);
    expect((editorSchema2 as any).properties?.newProp).toBeDefined();
    expect((editorSchema2 as any).properties?.name).toBeDefined();

    // Most importantly: rootSchema should still be an object
    expect(state.resolvedCache).toBeDefined();
    expect((state.resolvedCache as any).properties).toBeDefined();
  });

  it('has ref button definitions accessible through rootSchema even after complex operations', () => {
    const schema = {
      type: 'object',
      properties: {
        jobs: {
          type: 'object',
          properties: {
            build: {
              type: 'object',
              properties: {
                runs: { type: 'string' }
              }
            }
          }
        }
      },
      $defs: {
        Job: {
          type: 'object',
          properties: {
            name: { type: 'string' }
          }
        },
        Step: {
          type: 'object',
          properties: {
            run: { type: 'string' }
          }
        }
      }
    } as any;

    let state: SchemaState = {
      source: null,
      resolvedCache: null,
      sourceIsObject: false,
      derefInProgress: false
    };

    state = schemaReducer(state, {
      type: LOAD_SOURCE_SCHEMA,
      payload: schema
    });

    // Simulate the ref button's getAllDefinitionNames function
    const getAllDefinitionNames = (rootSchema: any): string[] => {
      if (!rootSchema) return [];
      const defsKey = rootSchema.$defs ? '$defs' : (rootSchema.definitions ? 'definitions' : null);
      if (!defsKey) return [];
      const defs = (rootSchema as any)[defsKey];
      return Object.keys(defs || {});
    };

    // Initial: ref button should work
    const availableDefs = getAllDefinitionNames(state.resolvedCache);
    expect(availableDefs).toContain('Job');
    expect(availableDefs).toContain('Step');
    expect(availableDefs.length).toBe(2);

    // After getting editor schema multiple times
    for (let i = 0; i < 3; i++) {
      getEditorSchema(state);

      // ref button should still work
      const defsAfter = getAllDefinitionNames(state.resolvedCache);
      expect(defsAfter).toEqual(availableDefs);
    }
  });
});
