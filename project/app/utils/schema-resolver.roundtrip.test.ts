import { resolveSchema, rehydrateSchema } from "~/utils/schema-resolver";

describe('schema-resolver roundtrip (resolve -> edit -> rehydrate)', () => {
  test('inlined defs are rehydrated into $defs on save', async () => {
    const original = {
      $id: 'https://example.com/ecommerce.schema.json',
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $defs: {
        product: {
          $anchor: 'ProductSchema',
          type: 'object',
          properties: {
            name: { type: 'string' },
            price: { type: 'number', minimum: 0 }
          }
        },
        order: {
          $anchor: 'OrderSchema',
          type: 'object',
          properties: {
            orderId: { type: 'string' },
            items: { type: 'array', items: { $ref: '#ProductSchema' } }
          }
        }
      }
    } as any;

    const resolved = await resolveSchema(original as any) as any;
    expect(resolved).toBeTruthy();
    expect(resolved.type).toBe('object');
    // product should be inlined
    expect(resolved.properties.product).toBeTruthy();
    // debug: show resolved product price node
    // eslint-disable-next-line no-console
    console.info('[test debug] resolved.product.price node:', resolved.properties.product.properties.price);

    // Simulate an edit: change price.minimum to 5
    const edited = JSON.parse(JSON.stringify(resolved));
    edited.properties.product.properties.price.minimum = 5;

    const rehydrated = rehydrateSchema(original as any, edited as any) as any;
    // Ensure it wrote back into root.$defs.product
    expect(rehydrated.$defs).toBeTruthy();
    expect(rehydrated.$defs.product).toBeTruthy();
    expect(rehydrated.$defs.product.properties.price.minimum).toBe(5);
    // original $anchor should be preserved
    expect(rehydrated.$defs.product.$anchor).toBe('ProductSchema');
  });
});
