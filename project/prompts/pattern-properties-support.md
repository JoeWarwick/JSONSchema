# Feature proposal: patternProperties support

Summary
- Add first-class support for JSON Schema `patternProperties` in the Schema Editor and Graphical Schema Editor so schemas like `jobs` and `workflow_call.inputs` in GitHub Actions can be visually edited and round-tripped.

Goals
- Display patternProperties in Schema Editor with a compact UI to add a regex key and a subschema.
- Represent patternProperties in Graphical Editor as nodes (or a special edge) so authors can see and edit the keyed subschema.
- Honor `additionalProperties: false` when patternProperties / properties are defined (prevent adding ad-hoc properties that contradict schema).
- Add unit and e2e tests covering serialization and UI interactions.

Scope (MVP)
1. Schema Editor
   - New field group: "Pattern Properties" (visible when `patternProperties` present or when user clicks "+ pattern property").
   - Add pattern property: collect a regex string and an inline subschema (reuse existing property editor for the subschema body).
   - Serialize into schema.patternProperties = { "<regex>": <schema> }
   - Show a banner if `additionalProperties` is `false` and patternProperties doesn't allow extra keys.

2. Graphical Schema Editor
   - Render patternProperties as a compact node labeled `pattern: <regex>` attached to the parent object node (no full expansion needed in MVP).
   - Allow editing the subschema in the NodePropertyEditor (reusing form behaviors).

3. Instance Editor / JsonInstanceForm
   - Ensure instance validation uses resolved schema (existing resolver works) to match patternProperties when deciding which child fields to present.

4. Tests
   - Unit tests for serialization/deserialization in `schema-behaviors` and `schema-editor-form`.
   - Integration/e2e test that loads a sample workflow schema (with `patternProperties` for `jobs`) and verifies Graphical/Schema Editor surfaces the pattern property and prevents invalid property additions when `additionalProperties:false`.

Implementation steps
1. Add UI for patternProperties in `SchemaEditorForm`:
   - Small subsection listing existing regex keys and an "Add pattern property" button.
   - Use the same nested property editor for editing the subschema.
2. Add serialization helpers in `schema-behaviors` (helpers for adding/removing patternProperties and for respecting `additionalProperties`).
3. Graphical editor: add compact node type and rendering logic (update `schemaNodeDataToSchema` and reverse mapping if needed).
4. Tests: add unit tests + playwright e2e test referencing `public/schemas/github-workflow.json` subset.
5. Documentation note: add quick doc to `prompts/` and README.

Back-of-envelope timeline
- Design + small prototypes (1 day)
- Implement Schema Editor UI + unit tests (2 days)
- Implement Graphical Editor support + tests (2 days)
- e2e tests and polish (1 day)

Risks & notes
- Need to ensure pattern regexes are validated in the UI and are clear to authors (provide tooltip).  
- Some existing code assumes `properties` is the only map; adapt serialization/deserialization carefully to avoid regressions.

Acceptance criteria
- A user can add/remove/edit `patternProperties` in the Schema Editor and Graphical Editor.
- Schema serializes to `patternProperties: { <regex>: <schema> }` and the resolver/instance editor validates instances against it.
- Instances cannot add arbitrary properties when `additionalProperties: false`.

---

If this plan looks good I will create a draft PR with this document and a minimal set of changes (scaffolding + TODO tests) to start the implementation.