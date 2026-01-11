import schemaReducer, {
  initialSchemaState,
  APPLY_RESOLVED_EDIT,
  getPersistableSource,
} from "./schemaReducer";

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
});
