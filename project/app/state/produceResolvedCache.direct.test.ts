import { getEditorSchema } from "~/state/schemaReducer";

describe('produceResolvedCache direct case', () => {
  test('resolved+source with $defs and $ref in properties is inlined to object schema while retaining provenance', () => {
    const resolved = {
      $defs: {
        order: {
          properties: {
            items: {
              items: {
                properties: {
                  name: { type: 'string' },
                  price: { minimum: 0, type: 'number' }
                },
                type: 'object'
              },
              type: 'array'
            },
            orderId: { type: 'string' }
          },
          required: ['orderId'],
          type: 'object'
        },
        product: {
          properties: {
            name: { type: 'string' },
            price: { minimum: 0, type: 'number' }
          },
          type: 'object'
        }
      },
      properties: {
        order: { $ref: '#/$defs/order' }
      }
    } as any;

    const source = JSON.parse(JSON.stringify(resolved));

    const state: any = { source, resolvedCache: resolved, derefInProgress: false, sourceIsObject: true };
    const editor = getEditorSchema(state) as any;
    expect(editor).toBeTruthy();
    expect(editor.type).toBe('object');
    expect(editor.properties).toBeTruthy();
    // order should be an inlined object (not just a $ref placeholder)
    // while retaining provenance for rehydration/import tracking.
    expect(editor.properties.order.$ref).toBe('#/$defs/order');
    expect(editor.properties.order.type).toBe('object');
    expect(editor.properties.order.__from).toBe('#/$defs/order');
    expect(editor.properties.order.properties).toBeTruthy();
    // nested price.minimum preserved
    expect(editor.properties.order.properties.items.items.properties.price.minimum).toBe(0);
    // top-level $defs must not be present on editor view
    expect(editor.$defs).toBeUndefined();
  });
});
