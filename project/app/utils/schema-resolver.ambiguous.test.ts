import { rehydrateToRefs } from "~/utils/schema-resolver";

describe('schema-resolver ambiguous mapping heuristics', () => {
  test('tie-breaker picks alphabetical def when overlap scores equal', () => {
    const original = {
      $defs: {
        apple: {
          type: 'object',
          properties: {
            common: { type: 'string' },
            appleOnly: { type: 'number' }
          }
        },
        banana: {
          type: 'object',
          properties: {
            common: { type: 'string' },
            bananaOnly: { type: 'boolean' }
          }
        }
      }
    } as any;

    // Editor produced an anonymous inlined resolved payload (no def keys)
    // that contains `common` and `extra`. Both defs overlap equally on `common`.
    const resolved = {
      type: 'object',
      properties: {
        common: { type: 'string', maxLength: 10 },
        extra: { type: 'number' }
      }
    } as any;

    const out = rehydrateToRefs(original as any, resolved as any) as any;

    // Tie-breaker should pick 'apple' (alphabetical) and merge `common.maxLength` into it
    expect(out.$defs).toBeTruthy();
    expect(out.$defs.apple).toBeTruthy();
    expect(out.$defs.apple.properties.common.maxLength).toBe(10);
    // Ensure banana was not modified with the maxLength
    expect(out.$defs.banana.properties.common.maxLength).toBeUndefined();
  });
});
