import { resolveSchema } from "~/utils/schema-resolver";

describe('schema-resolver fallback behavior', () => {
  test('resolveSchema hoists and inlines $defs into properties', async () => {
    const unresolved = {
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

    const resolved = await resolveSchema(unresolved as any) as any;
    // debug output for CI/local runs
    // eslint-disable-next-line no-console
    // debug log removed

    // Expect a root object with properties containing `order`
    expect(resolved).toBeTruthy();
    expect(resolved.type).toBe('object');
    expect(resolved.properties).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(resolved.properties, 'order')).toBe(true);

    const order = resolved.properties.order;
    expect(order).toBeTruthy();
    expect(order.type).toBe('object');
    expect(order.properties).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(order.properties, 'orderId')).toBe(true);
    expect(order.properties.orderId.type).toBe('string');

    // items should be an array whose items are inlined product object
    expect(order.properties.items.type).toBe('array');
    expect(order.properties.items.items).toBeTruthy();
    expect(order.properties.items.items.type).toBe('object');
    expect(order.properties.items.items.properties.name.type).toBe('string');
    expect(order.properties.items.items.properties.price.type).toBe('number');
  });
});
