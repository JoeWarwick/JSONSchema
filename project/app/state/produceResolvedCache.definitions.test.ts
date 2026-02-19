import { describe, it, expect } from '@jest/globals';
import schemaReducer, { 
  initialSchemaState,
  APPLY_SOURCE_UPDATE,
  produceResolvedCache
} from './schemaReducer';

describe('produceResolvedCache - Definitions Preservation', () => {
  it('preserves $defs from source when resolving with async resolver', async () => {
    const workflow = {
      $id: 'https://example.com/workflow',
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $defs: {
        job: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            runs: { type: 'string' }
          }
        },
        env: {
          type: 'object',
          properties: {
            key: { type: 'string' }
          }
        }
      },
      type: 'object',
      properties: {
        name: { type: 'string' },
        jobs: { $ref: '#/$defs/job' }
      }
    } as any;

    // Simulate what happens when source is loaded and needs resolution
    const resolved = { ...workflow };
    const sourceIsObject = true;
    const source = workflow;

    const result = produceResolvedCache(resolved, sourceIsObject, source);

    // The key test: result should have $defs preserved
    expect(result).toBeDefined();
    expect(result.$defs).toBeDefined();
    expect(result.$defs.job).toBeDefined();
    expect(result.$defs.env).toBeDefined();
    expect(result.$defs.job.properties.name).toEqual({ type: 'string' });
  });

  it('preserves definitions (legacy key) from source', async () => {
    const legacySchema = {
      $id: 'https://example.com/legacy',
      definitions: {
        person: {
          type: 'object',
          properties: {
            name: { type: 'string' }
          }
        }
      },
      type: 'object',
      properties: {
        user: { $ref: '#/definitions/person' }
      }
    } as any;

    const resolved = { ...legacySchema };
    const sourceIsObject = true;
    const source = legacySchema;

    const result = produceResolvedCache(resolved, sourceIsObject, source);

    expect(result).toBeDefined();
    expect(result.definitions).toBeDefined();
    expect(result.definitions.person).toBeDefined();
    expect(result.definitions.person.properties.name).toEqual({ type: 'string' });
  });

  it('preserves $defs when resolved is null but source has them', async () => {
    const source = {
      $defs: {
        tag: {
          type: 'string',
          enum: ['v1', 'v2']
        }
      },
      type: 'object',
      properties: {
        version: { $ref: '#/$defs/tag' }
      }
    } as any;

    // This simulates when resolver returns null
    const resolved = null;
    const sourceIsObject = true;

    const result = produceResolvedCache(resolved, sourceIsObject, source);

    expect(result).toBeDefined();
    expect(result.$defs).toBeDefined();
    expect(result.$defs.tag).toBeDefined();
  });

  it('adds $defs to resolved when it lacks them but source has them', async () => {
    const source = {
      $defs: {
        address: {
          type: 'object',
          properties: {
            street: { type: 'string' }
          }
        }
      },
      properties: {
        home: { $ref: '#/$defs/address' }
      }
    } as any;

    // Resolved doesn't have $defs
    const resolved = {
      properties: {
        home: {
          type: 'object',
          properties: {
            street: { type: 'string' }
          }
        }
      }
    } as any;

    const sourceIsObject = true;

    const result = produceResolvedCache(resolved, sourceIsObject, source);

    expect(result).toBeDefined();
    expect(result.$defs).toBeDefined();
    expect(result.$defs.address).toBeDefined();
  });

  it('does not mutate source $defs (deep copy)', async () => {
    const source = {
      $defs: {
        config: {
          type: 'object',
          properties: {
            timeout: { type: 'number' }
          }
        }
      },
      properties: {
        settings: { $ref: '#/$defs/config' }
      }
    } as any;

    const originalDefsString = JSON.stringify(source.$defs);

    const resolved = { ...source };
    const sourceIsObject = true;

    const result = produceResolvedCache(resolved, sourceIsObject, source);

    // Result should have $defs
    expect(result.$defs).toBeDefined();

    // Source should be unchanged
    expect(JSON.stringify(source.$defs)).toBe(originalDefsString);

    // Result's $defs should be a different object (deep copy, not reference)
    if (result.$defs && source.$defs) {
      expect(result.$defs).not.toBe(source.$defs);
    }
  });
});
