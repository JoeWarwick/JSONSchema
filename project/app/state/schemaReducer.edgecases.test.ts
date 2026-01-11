import { getEditorSchema } from "~/state/schemaReducer";

describe('schemaReducer edge cases', () => {
  test('removes $anchor from editor properties', () => {
    const resolved = {
      type: 'object',
      properties: {
        product: {
          $anchor: 'ProductSchema',
          type: 'object',
          properties: { name: { type: 'string' } }
        }
      }
    } as any;

    const state: any = { source: null, resolvedCache: resolved, derefInProgress: false, sourceIsObject: false };
    const editor = getEditorSchema(state) as any;
    expect(editor).toBeTruthy();
    // properties exposing $anchor are removed from the editor view
    expect(editor.properties.product).toBeUndefined();
  });

  test('prunes defs referenced by other defs (no duplicate inline copy)', () => {
    const source = {
      $defs: {
        product: { type: 'object', properties: { name: { type: 'string' } } },
        order: { type: 'object', properties: { item: { $ref: '#/$defs/product' } } }
      }
    } as any;

    const state: any = { source, resolvedCache: null, derefInProgress: false, sourceIsObject: false };
    const editor = getEditorSchema(state) as any;
    expect(editor).toBeTruthy();
    // order should be exposed
    expect(editor.properties.order).toBeTruthy();
    // product should be pruned because it's referenced by order
    expect(editor.properties.product).toBeUndefined();
    // no top-level $defs
    expect(editor.$defs).toBeUndefined();
  });

  test('resolved payload with nested $defs still yields editor without top-level $defs', () => {
    const resolved = {
      $defs: {
        outer: {
          type: 'object',
          properties: { x: { type: 'string' } },
          $defs: { inner: { type: 'string' } }
        }
      },
      properties: { outer: { $ref: '#/$defs/outer' } }
    } as any;

    const state: any = { source: null, resolvedCache: resolved, derefInProgress: false, sourceIsObject: false };
    const editor = getEditorSchema(state) as any;
    expect(editor).toBeTruthy();
    expect(editor.properties.outer).toBeTruthy();
    // editor must not expose top-level $defs
    expect(editor.$defs).toBeUndefined();
  });
});
