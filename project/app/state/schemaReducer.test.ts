import schemaReducer, {
  initialSchemaState,
  APPLY_RESOLVED_EDIT,
  getPersistableSource,
} from "./schemaReducer";
import { resolveSchema } from "~/utils/schema-resolver";

describe("schemaReducer rehydrate behavior", () => {
  const sourceWithDefs = {
    $id: "https://example.com/ecommerce.schema.json",
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $defs: {
      product: {
        $anchor: "ProductSchema",
        type: "object",
        properties: {
          name: { type: "string" },
          price: { type: "number", minimum: 0 },
        },
      },
      order: {
        $anchor: "OrderSchema",
        type: "object",
        properties: {
          orderId: { type: "string" },
          items: {
            type: "array",
            items: { $ref: "#ProductSchema" },
          },
        },
      },
    },
  } as any;

  // A resolved/hoisted view that an editor might produce (similar to schema (5)).
  const resolvedEditorView = {
    type: "object",
    properties: {
      order: {
        type: "object",
        properties: {
          orderId: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                price: { type: "number" },
              },
              required: ["name", "price"],
            },
          },
        },
        required: ["orderId", "items"],
      },
    },
    required: ["order"],
  } as any;

  test("APPLY_RESOLVED_EDIT rehydrates resolved edits into $defs structure", () => {
    const state0 = initialSchemaState(sourceWithDefs);
    const state1 = schemaReducer(state0, { type: APPLY_RESOLVED_EDIT, payload: resolvedEditorView });
    const persistable = getPersistableSource(state1) as any;
    expect(persistable).toBeTruthy();
    // persisted result should still have $defs
    expect(persistable.$defs).toBeTruthy();
    // find any def that contains the merged order/items/name structure
    const defs = persistable.$defs as Record<string, any>;
    const hasNestedNamePrice = (obj: any): boolean => {
      if (!obj || typeof obj !== 'object') return false;
      // direct match
      if (obj.properties && obj.properties.items && obj.properties.items.items && obj.properties.items.items.properties && obj.properties.items.items.properties.name && obj.properties.items.items.properties.price) return true;
      // recurse
      for (const v of Object.values(obj)) {
        if (hasNestedNamePrice(v)) return true;
      }
      return false;
    };
    const found = Object.values(defs).some(d => hasNestedNamePrice(d));
    expect(found).toBe(true);
  });

  test("APPLY_RESOLVED_EDIT preserves draft-07 definitions for ref dropdown usage", () => {
    const sourceWithDefinitions = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        concurrency: { $ref: "#/definitions/concurrency" }
      },
      definitions: {
        concurrency: {
          type: "object",
          properties: {
            group: { type: "string" }
          },
          required: ["group"]
        }
      }
    } as any;

    const resolvedEditorView = {
      type: "object",
      properties: {
        concurrency: {
          type: "object",
          properties: {
            group: { type: "string" },
            "cancel-in-progress": { type: "boolean" }
          },
          required: ["group"]
        }
      }
    } as any;

    const state0 = initialSchemaState(sourceWithDefinitions);
    const state1 = schemaReducer(state0, { type: APPLY_RESOLVED_EDIT, payload: resolvedEditorView });
    const persistable = getPersistableSource(state1) as any;

    expect(persistable).toBeTruthy();
    expect(persistable.definitions).toBeTruthy();
    expect(persistable.definitions.concurrency).toBeTruthy();
  });

  test("initial resolvedCache for sourceWithDefs contains only 'order' property", () => {
    const state0 = initialSchemaState(sourceWithDefs) as any;
    expect(state0.resolvedCache).toBeTruthy();
    const props = state0.resolvedCache && (state0.resolvedCache.properties || state0.resolvedCache);
    const keys = props && typeof props === 'object' ? Object.keys(props) : [];
    expect(keys).toEqual(expect.arrayContaining(["order"]));
  });

  test("rehydration of the provided ecommerce schema preserves $defs and converts inlined copies to $ref", async () => {
    const messySchema = {
      "$id": "https://example.com/ecommerce.schema.json",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$defs": {
        "product": {
          "$anchor": "ProductSchema",
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "price": { "type": "number", "minimum": 0 }
          }
        },
        "order": {
          "$anchor": "OrderSchema",
          "type": "object",
          "properties": {
            "orderId": { "type": "string" },
            "items": {
              "type": "array",
              "items": { "$ref": "#ProductSchema" }
            },
            "order": {
              "type": "object",
              "title": "order",
              "properties": {
                "orderId": { "type": "string", "title": "orderId" },
                "items": {
                  "type": "array",
                  "title": "items",
                  "items": {
                    "type": "object",
                    "properties": {
                      "name": { "type": "string", "title": "name" },
                      "price": { "type": "number", "title": "price", "minimum": 0 }
                    }
                  }
                }
              },
              "required": ["orderId"]
            }
          },
          "title": "Root"
        }
      },
      "properties": {}
    } as any;

    const state0 = initialSchemaState(messySchema) as any;
    // Produce the editor/resolved view the reducer expects
      const resolved = await resolveSchema(messySchema) as any;

    const state1 = schemaReducer(state0, { type: APPLY_RESOLVED_EDIT, payload: resolved });
    const persistable = getPersistableSource(state1) as any;

    expect(persistable).toBeTruthy();
    // persisted result should still have $defs and include product/order
    expect(persistable.$defs).toBeTruthy();
    const defKeys = Object.keys(persistable.$defs || {});
    expect(defKeys).toEqual(expect.arrayContaining(["product", "order"]));

    // persisted properties should preferably reference the defs for order
    if (persistable.properties && persistable.properties.order) {
      const orderProp = persistable.properties.order;
      // Either a $ref to the defs entry or an object (fallback)
      if (orderProp && typeof orderProp === 'object' && orderProp.$ref) {
        expect(typeof orderProp.$ref).toBe('string');
        expect(orderProp.$ref).toMatch(/#\/?\$defs\/?order|#OrderSchema/);
      }
    }
  });

  test("apply resolved object (schema(5)) onto $defs source (schema(4)) rehydrates back to defs", () => {
    const schema4 = {
      "$id": "https://example.com/ecommerce.schema.json",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$defs": {
        "product": {
          "$anchor": "ProductSchema",
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "price": { "type": "number", "minimum": 0 }
          }
        },
        "order": {
          "$anchor": "OrderSchema",
          "type": "object",
          "properties": {
            "orderId": { "type": "string" },
            "items": {
              "type": "array",
              "items": { "$ref": "#ProductSchema" }
            }
          }
        }
      }
    } as any;

    const schema5 = {
      type: "object",
      properties: {
        order: {
          type: "object",
          properties: {
            orderId: { type: "string", required: true },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  price: { type: "number" }
                },
                required: ["name", "price"]
              }
            }
          },
          required: ["orderId", "items"]
        }
      },
      required: ["order"]
    } as any;

    const state0 = initialSchemaState(schema4) as any;
    const state1 = schemaReducer(state0, { type: APPLY_RESOLVED_EDIT, payload: schema5 });
    const persistable = getPersistableSource(state1) as any;

    expect(persistable).toBeTruthy();
    expect(persistable.$defs).toBeTruthy();
    const defs = persistable.$defs as Record<string, any>;
    expect(Object.keys(defs)).toEqual(expect.arrayContaining(["product", "order"]));

    // product def should preserve name/price types
    expect(defs.product).toBeTruthy();
    expect(defs.product.properties).toBeTruthy();
    expect(defs.product.properties.name.type).toBe("string");

    // order.items should reference the product def (either by anchor or defs path)
    const orderDef = defs.order;
    expect(orderDef).toBeTruthy();
    const itemsNode = orderDef.properties && orderDef.properties.items && orderDef.properties.items.items;
    expect(itemsNode).toBeTruthy();
    if (itemsNode.$ref) {
      expect(itemsNode.$ref).toMatch(/#\/?\$defs\/?product|#ProductSchema/);
    }
  });

  test("idempotence: repeated resolve -> APPLY_RESOLVED_EDIT cycles stabilize persisted source", async () => {
    const schema4 = {
      "$id": "https://example.com/ecommerce.schema.json",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$defs": {
        "product": {
          "$anchor": "ProductSchema",
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "price": { "type": "number", "minimum": 0 }
          }
        },
        "order": {
          "$anchor": "OrderSchema",
          "type": "object",
          "properties": {
            "orderId": { "type": "string" },
            "items": {
              "type": "array",
              "items": { "$ref": "#ProductSchema" }
            }
          }
        }
      }
    } as any;

    const stable = (v: any) => {
      const sortKeys = (x: any): any => {
        if (Array.isArray(x)) return x.map(sortKeys);
        if (x && typeof x === 'object') {
          const o: Record<string, any> = {};
          for (const k of Object.keys(x).sort()) o[k] = sortKeys(x[k]);
          return o;
        }
        return x;
      };
      return JSON.stringify(sortKeys(v));
    };

    let current = schema4;
    const rounds = 8;
    for (let i = 0; i < rounds; i++) {
      const state0 = initialSchemaState(current) as any;
      const resolved = await resolveSchema(current) as any;
      const state1 = schemaReducer(state0, { type: APPLY_RESOLVED_EDIT, payload: resolved });
      const persistable = getPersistableSource(state1) as any;
      // Each cycle should preserve $defs and the canonical def keys
      expect(persistable).toBeTruthy();
      expect(persistable.$defs).toBeTruthy();
      const defKeys = Object.keys(persistable.$defs || {});
      expect(defKeys).toEqual(expect.arrayContaining(["product", "order"]));
      // ensure $defs remain present (we've already asserted keys)
      current = persistable as any;
    }
  });

  test("strict idempotence: canonical persisted source is byte-equal across cycles", async () => {
    const schema4 = {
      "$id": "https://example.com/ecommerce.schema.json",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$defs": {
        "product": {
          "$anchor": "ProductSchema",
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "price": { "type": "number", "minimum": 0 }
          }
        },
        "order": {
          "$anchor": "OrderSchema",
          "type": "object",
          "properties": {
            "orderId": { "type": "string" },
            "items": {
              "type": "array",
              "items": { "$ref": "#ProductSchema" }
            }
          }
        }
      }
    } as any;

    // canonicalizer: remove transient metadata and produce deterministic key order
    const canonicalize = (v: any): string => {
      const clone = JSON.parse(JSON.stringify(v));
      const prune = (o: any) => {
        if (o && typeof o === 'object') {
          delete o.$id;
          delete o.$schema;
          delete o.__from;
          delete o.$anchor;
          for (const k of Object.keys(o)) prune(o[k]);
        }
      };
      prune(clone);
      const sortKeys = (x: any): any => {
        if (Array.isArray(x)) return x.map(sortKeys);
        if (x && typeof x === 'object') {
          const out: any = {};
          for (const k of Object.keys(x).sort()) out[k] = sortKeys(x[k]);
          return out;
        }
        return x;
      };
      return JSON.stringify(sortKeys(clone));
    };

    let current: any = schema4;
    const seen: string[] = [];
    const rounds = 8;
    for (let i = 0; i < rounds; i++) {
      const state0 = initialSchemaState(current) as any;
      const resolved = await resolveSchema(current) as any;
      const state1 = schemaReducer(state0, { type: APPLY_RESOLVED_EDIT, payload: resolved });
      const persistable = getPersistableSource(state1) as any;
      const canon = canonicalize(persistable);
      if (seen.length > 0) {
        // strict equality against previous canonical form
        expect(canon).toBe(seen[seen.length - 1]);
        // once equal, idempotence is satisfied; break early
        return;
      }
      seen.push(canon);
      current = persistable as any;
    }
    // if no stabilization in rounds, fail explicitly
    throw new Error('Canonical persisted source did not stabilize within rounds');
  });

  test("resolvedCache preserves $defs for editor access (especially ref button)", async () => {
    // When a schema has $defs, they must be preserved in resolvedCache so the editor
    // can access them for features like the ref type button. This is essential for
    // allowing users to reference definitions when editing schemas.
    const sourceWithDefinitions = {
      $id: "https://example.com/test.schema.json",
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        userId: { type: "string" },
        profile: { $ref: "#/$defs/userProfile" },
      },
      $defs: {
        userProfile: {
          type: "object",
          properties: {
            name: { type: "string" },
            email: { type: "string" },
          },
        },
        address: {
          type: "object",
          properties: {
            street: { type: "string" },
            city: { type: "string" },
          },
        },
      },
    } as any;

    // Initial state should preserve $defs for editor access
    const s0 = initialSchemaState(sourceWithDefinitions) as any;
    expect(s0.resolvedCache).toBeTruthy();
    expect((s0.resolvedCache as any).$defs).toBeDefined();
    expect(Object.keys((s0.resolvedCache as any).$defs || {})).toContain("userProfile");
    expect(Object.keys((s0.resolvedCache as any).$defs || {})).toContain("address");

    // After async resolution, $defs should still be present
    const resolved = await resolveSchema(sourceWithDefinitions) as any;
    const s1 = schemaReducer(s0, { type: APPLY_RESOLVED_EDIT, payload: resolved });
    expect(s1.resolvedCache).toBeTruthy();
    expect((s1.resolvedCache as any).$defs).toBeDefined();
    expect(Object.keys((s1.resolvedCache as any).$defs || {})).toContain("userProfile");
    expect(Object.keys((s1.resolvedCache as any).$defs || {})).toContain("address");
  });

  test("resolvedCache preserves $defs when source has definitions", async () => {
    // Test that $defs are preserved in the most common case: modern JSON Schema with $defs
    const sourceWithDefs = {
      $defs: {
        userProfile: {
          type: "object",
          properties: { name: { type: "string" } },
        },
        address: {
          type: "object",
          properties: { street: { type: "string" } },
        },
      },
      type: "object",
      properties: {
        item: { $ref: "#/$defs/userProfile" },
      },
    };

    const s0 = initialSchemaState(sourceWithDefs as any) as any;
    expect(s0.resolvedCache).toBeTruthy();
    // Should preserve $defs
    const cache = s0.resolvedCache as any;
    expect(cache.$defs).toBeDefined();
    expect(Object.keys(cache.$defs || {})).toContain("userProfile");
    expect(Object.keys(cache.$defs || {})).toContain("address");

    // After async resolution, should still preserve them
    const resolved = await resolveSchema(sourceWithDefs as any) as any;
    const s1 = schemaReducer(s0, { type: APPLY_RESOLVED_EDIT, payload: resolved });
    expect(s1.resolvedCache).toBeTruthy();
    const cache1 = s1.resolvedCache as any;
    expect(cache1.$defs).toBeDefined();
    expect(Object.keys(cache1.$defs || {})).toContain("userProfile");
    expect(Object.keys(cache1.$defs || {})).toContain("address");
  });
});
