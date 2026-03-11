import { getEditorSchema } from "~/state/schemaReducer";

describe('schemaReducer produceResolvedCache normalization', () => {
  test('hoists $defs from source into normalized editor view without $ref/$defs', () => {
    const source = {
      $defs: {
        order: { type: 'object', properties: { orderId: { type: 'string' } } },
        product: { type: 'object', properties: { name: { type: 'string' } } }
      }
    } as any;

    const state: any = {
      source,
      resolvedCache: null,
      derefInProgress: false,
      sourceIsObject: false,
    };

    const editor = getEditorSchema(state) as any;
    expect(editor).toBeTruthy();
    expect(editor.properties).toBeTruthy();
    expect(editor.properties.order).toBeTruthy();
    // editors should not receive $ref placeholders
    expect(editor.properties.order.$ref).toBeUndefined();
    // editors should not see top-level $defs
    expect(editor.$defs).toBeUndefined();
  });

  test('inlines $ref entries from resolvedCache into editor view', () => {
    const resolved = {
      $defs: {
        order: { type: 'object', properties: { orderId: { type: 'string' } } }
      },
      properties: {
        order: { $ref: '#/$defs/order' }
      }
    } as any;

    const state: any = {
      source: null,
      resolvedCache: resolved,
      derefInProgress: false,
      sourceIsObject: false,
    };

    const editor = getEditorSchema(state) as any;
    expect(editor).toBeTruthy();
    expect(editor.properties).toBeTruthy();
    // $ref should have been inlined into concrete schema
    expect(editor.properties.order.$ref).toBeUndefined();
    expect(editor.properties.order.type).toBe('object');
    // no top-level $defs on editor view
    expect(editor.$defs).toBeUndefined();
  });

  test('preserves source property facets when resolved property omits them', () => {
    const source = {
      type: 'object',
      properties: {
        jobs: {
          type: 'object',
          patternProperties: {
            '^[_a-zA-Z][a-zA-Z0-9_-]*$': {
              type: 'object'
            }
          },
          minProperties: 1,
          maxProperties: 1,
          additionalProperties: false,
        }
      }
    } as any;

    const resolved = {
      type: 'object',
      properties: {
        jobs: {
          type: 'object',
          patternProperties: {
            '^[_a-zA-Z][a-zA-Z0-9_-]*$': {
              type: 'object'
            }
          },
          minProperties: 1,
          additionalProperties: false,
        }
      }
    } as any;

    const state: any = {
      source,
      resolvedCache: resolved,
      derefInProgress: false,
      sourceIsObject: true,
    };

    const editor = getEditorSchema(state) as any;
    expect(editor?.properties?.jobs?.minProperties).toBe(1);
    expect(editor?.properties?.jobs?.maxProperties).toBe(1);
  });
});
