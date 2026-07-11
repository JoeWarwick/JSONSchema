import { resolveSchema, rehydrateSchema } from "~/utils/schema-resolver";

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
    // (removed temporary debug log)

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

  test('resolveSchema handles deeply nested object schemas without overflowing the stack', async () => {
    const makeDeepSchema = (depth: number) => {
      const leaf = { type: 'string', title: 'leaf' };
      let current: any = leaf;

      for (let index = 0; index < depth; index++) {
        current = {
          type: 'object',
          title: `level-${depth - index}`,
          properties: {
            child: current,
          },
        };
      }

      return current;
    };

    const resolved = await resolveSchema(makeDeepSchema(60) as any) as any;

    expect(resolved).toBeTruthy();

    let cursor = resolved;
    for (let index = 0; index < 60; index++) {
      expect(cursor.type).toBe('object');
      cursor = cursor.properties.child;
    }

    expect(cursor.type).toBe('string');
    expect(cursor.title).toBe('leaf');
  });

  test('rehydrateSchema handles deeply nested plain objects without overflowing the stack', () => {
    const makeDeepObject = (depth: number) => {
      const root: any = {};
      let cursor = root;
      for (let i = 0; i < depth; i++) {
        cursor.level = i;
        cursor.child = {};
        cursor = cursor.child;
      }
      cursor.leaf = true;
      return root;
    };

    const original = makeDeepObject(150);
    const edited = makeDeepObject(150);
    edited.child.child.child.marker = 'updated';

    expect(() => rehydrateSchema(original as any, edited as any)).not.toThrow();
  });
});
