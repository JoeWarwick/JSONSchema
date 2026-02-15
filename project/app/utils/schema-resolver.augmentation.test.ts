import { augmentSchemaForKnownIssues } from './schema-resolver';

describe('augmentSchemaForKnownIssues', () => {
  test('wraps root-level concurrency field with oneOf to support string|object', () => {
    // Non-hydrated schema: concurrency is only defined as object
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        concurrency: {
          type: 'object',
          properties: {
            group: { type: 'string' },
            'cancel-in-progress': { type: 'boolean' }
          },
          required: ['group'],
          additionalProperties: false
        }
      }
    };

    const augmented = augmentSchemaForKnownIssues(schema) as any;

    // Verify concurrency now has oneOf with string as first variant
    expect(augmented.properties.concurrency.oneOf).toBeTruthy();
    expect(Array.isArray(augmented.properties.concurrency.oneOf)).toBe(true);
    expect(augmented.properties.concurrency.oneOf.length).toBe(2);

    // First variant should be string
    expect(augmented.properties.concurrency.oneOf[0]).toEqual({
      type: 'string',
      title: 'String'
    });

    // Second variant should be the original object definition
    expect(augmented.properties.concurrency.oneOf[1]).toEqual({
      type: 'object',
      properties: {
        group: { type: 'string' },
        'cancel-in-progress': { type: 'boolean' }
      },
      required: ['group'],
      additionalProperties: false
    });

    // Other properties should be unchanged
    expect(augmented.properties.name).toEqual({ type: 'string' });
  });

  test('does not augment when oneOf already exists', () => {
    const schema = {
      type: 'object',
      properties: {
        concurrency: {
          oneOf: [
            { type: 'string' },
            { type: 'object' }
          ]
        }
      }
    };

    const augmented = augmentSchemaForKnownIssues(schema) as any;

    // Should remain unchanged
    expect(augmented.properties.concurrency.oneOf).toEqual([
      { type: 'string' },
      { type: 'object' }
    ]);
  });

  test('does not augment when concurrency is not an object', () => {
    const schema = {
      type: 'object',
      properties: {
        concurrency: { type: 'string' }
      }
    };

    const augmented = augmentSchemaForKnownIssues(schema) as any;

    // Should remain unchanged
    expect(augmented.properties.concurrency).toEqual({ type: 'string' });
  });

  test('returns null/undefined unchanged', () => {
    expect(augmentSchemaForKnownIssues(null)).toBeNull();
    expect(augmentSchemaForKnownIssues(undefined)).toBeUndefined();
  });

  test('returns non-object values unchanged', () => {
    expect(augmentSchemaForKnownIssues('string' as any)).toBe('string');
    expect(augmentSchemaForKnownIssues(123 as any)).toBe(123);
    expect(augmentSchemaForKnownIssues(true as any)).toBe(true);
  });

  test('handles schema without properties gracefully', () => {
    const schema = { type: 'string' };
    const augmented = augmentSchemaForKnownIssues(schema) as any;
    expect(augmented).toEqual({ type: 'string' });
  });

  test('handles schema.properties not being object gracefully', () => {
    const schema = {
      type: 'object',
      properties: null
    };

    const augmented = augmentSchemaForKnownIssues(schema) as any;
    expect(augmented.properties).toBeNull();
  });

  test('does not mutate the original schema', () => {
    const schema = {
      type: 'object',
      properties: {
        concurrency: {
          type: 'object',
          properties: { group: { type: 'string' } }
        }
      }
    };

    augmentSchemaForKnownIssues(schema);

    // Original should be unchanged (shallow equality won't work due to copy, but structure should be same)
    expect(schema.properties.concurrency.type).toBe('object');
    expect((schema.properties.concurrency as any)['oneOf']).toBeUndefined();
  });
});
