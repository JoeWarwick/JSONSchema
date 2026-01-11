import { getEditorSchema } from "~/state/schemaReducer";

describe('schemaReducer resolved=null behavior', () => {
  test('when resolved is null and source contains $ref, reducer returns that $ref in editor view', () => {
    const source = {
      order: { $ref: '#/$defs/order' }
    } as any;

    const state: any = {
      source,
      resolvedCache: null,
      derefInProgress: false,
      sourceIsObject: true,
    };

    const editor = getEditorSchema(state) as any;
    expect(editor).toBeTruthy();
    expect(editor.properties).toBeTruthy();
    // Ensure current reducer behavior is captured: editor sees $ref placeholder
    expect(editor.properties.order.$ref).toBe('#/$defs/order');
    // Editor should not expose top-level $defs
    expect(editor.$defs).toBeUndefined();
  });
});
