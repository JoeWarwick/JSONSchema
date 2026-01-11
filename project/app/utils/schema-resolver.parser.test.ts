import { resolveSchema } from "~/utils/schema-resolver";

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

describe('json-schema-ref-parser availability', () => {
  test('module can be dynamically imported', async () => {
    const parser = await import('json-schema-ref-parser');
    expect(parser).toBeTruthy();
    // dereference should be available on default export or module itself
    const deref = (parser as any).default?.dereference || (parser as any).dereference;
    expect(typeof deref).toBe('function');
  });

  test('resolveSchema uses parser when available and returns object-root schema', async () => {
    const resolved = await resolveSchema(unresolved as any);
    expect(resolved).toBeTruthy();
    // Should not expose top-level $defs after deref
    expect((resolved as any).$defs).toBeUndefined();
    // Should have object root with properties that include `order`
    expect((resolved as any).type).toBe('object');
    expect((resolved as any).properties).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call((resolved as any).properties, 'order')).toBe(true);
  });
});
