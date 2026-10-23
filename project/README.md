<!-- CLEANED -->
# Schema Sculptor — JSON Schema Workbench

Schema Sculptor is an interactive workbench for generating, inspecting, and editing JSON Schemas. It provides both a form-based editor and a graphical editor, synchronizes a canonical source schema with a resolved editor view, and lets you author safe local overrides of imported schema definitions.
It also provides an instance editor form and an instance plain json editor.

## Key Features

- Editor types: form-based editor (`SchemaEditorForm`) and graphical editor (`GraphicalSchemaEditor`).
- Authoritative reducer normalization: the reducer owns dereferencing, normalization, and provenance metadata so UI layers remain simple.
- Provenance metadata (`__from`): inlined or rehydrated schema nodes are annotated with `__from` to indicate the original `$ref` source.
- Instance-aware overrides: creating a local `allOf` override is instance-aware — the editor will only pre-populate properties when the current JSON instance contains keys at the editor path.
- Rehydration and persistence: edits made to the resolved/editor view are rehydrated into the canonical `source` for persistence.
- Tests and automation: Jest unit tests and Playwright e2e tests are provided to validate behavior and integrations.

### Multiple workbenches

- Explanatory guidance is available through compact **!** help buttons. Hover or
  focus with the keyboard to read a tooltip; Escape dismisses it. Labels, headings,
  errors, source-change/closure warnings, and decision-critical dialog text remain
  visible. Schema descriptions used as field labels or editable data are preserved.
- Use **File > New** to create independent JSON, YAML, XML/XSD, or Entity workbenches.
  Compact tabs at the bottom switch between workbenches without resetting their editors.
  Use the left/right arrow keys, Home, and End to navigate the tab strip.
- Entity workbenches show only **Entity Graph** and ERD operations. JSON/YAML/XML
  workbenches show their data/schema views without an Entity Graph tab or ERD menu.
- **File > Open** creates a new workbench. XSD files open as schemas; JSON/YAML/XML
  files prompt for schema versus instance data. Multiple C# files open together as
  one Entity workbench.
- **File > Save Workbench** downloads an editable `.workbench.json` snapshot,
  including the schema, instance data, and editor preferences. Reopen it with
  **File > Open**. Existing document/schema/ERD export commands still export their
  individual formats.
- Rename and close workbenches through the File menu; modified workbenches prompt
  to save, discard, or cancel before closing. `*` indicates content changed since
  the last workbench export, not a failure to autosave.
- The workspace autosaves locally under `schema-sculptor-workspace-v1`. On first
  use, existing editor storage is copied into a restored workbench without deleting
  legacy keys. Storage errors are shown explicitly; export workbenches to preserve
  them if browser storage is unavailable.
- **File > New > Transform Workbench** creates a separate XML/XSD mapping document.
  It has **Mapping**, **XSLT**, and **Input / Transform / Result** views.
  Source and target selectors reference the other workbenches in the bottom row.
  XML/XSD sources are supported initially, including saved XML/XSD in workbenches
  currently showing JSON or YAML. Files without XML/XSD content and Entity sources
  are listed but disabled.
- Transform saves datasource snapshots with its mapping definition, so closing a source
  workbench does not break the Transform. Changes to an open datasource are flagged;
  use **Refresh snapshot** to adopt them and review any missing-field diagnostics.
  Value, attribute, constant and repeating-group mappings generate read-only XSLT 1.0.
  **Add output document** adds another target with its own mappings; **Output document**
  switches which target you edit or preview. The source and preview input are shared.
  Up to 16 XML outputs are supported, with up to 200 mapping rules per output.
  Every output needs a target and mappings before the combined transform can run.
  Additional outputs can be named or removed without changing other output mappings.
  Saved workbenches retain all targets/mappings; older single-output designs still open.
  Multi-output exports are portable XSLT 1.0 that construct an application-defined
  `urn:schema-sculptor:transform:outputs:1` envelope, not native `xsl:result-document`.
  Each `document` wrapper has a stable `id` and contains exactly one result root;
  repeating-template modes are prefixed per output to prevent cross-output dispatch.
  No filesystem writes are enabled. The existing preview limits apply to the entire
  run/bundle, not separately to each output.
  After a successful multi-output run, a dialog lets you select results and name
  **new XML workbenches**, carrying over each target's schema when available.
  Creation is atomic and never overwrites sources/targets; the Transform remains active.
  Cancel keeps the results available through **Open results in new workbenches**,
  which is also available for single-output runs. Editing the transform/input clears
  old results. Imported results are not automatically validated against target XSDs.
  Repeating groups use `xsl:apply-templates` with dedicated modes and templates,
  preserving nested source contexts without `xsl:for-each`. Set an optional
  **Template mode** when adding a repeating group, or edit it inline in the mapping
  table. Mode names are case-sensitive and must be unique: start with an ASCII
  letter or underscore, followed by ASCII letters, digits, underscores, hyphens
  or dots (namespace prefixes are not supported). Blank names receive unique
  automatic modes, avoiding explicitly named modes. Value and constant mappings
  remain inside their enclosing template. The generated stylesheet can be exported
  independently. Use **Save Workbench** to save the editable mapping and mode names.
- Mapping fields are based on sample XML. XSD-only workbenches obtain a default sample
  through the .NET API; use representative instance data to expose optional choices
  and repeated elements. Map a repeating group before its child fields. Unmapped
  fields are omitted, and output field order follows the target sample.
- **Create collection...** is available beside a selected Transform datasource and
  in the XML editor's **Schema** menu. It creates a new XML/XSD workbench without
  changing the original: for example, `person` becomes `persons/person`. The wrapper
  inherits the record namespace. Sample XML is wrapped once; XSD adds a new global
  root with a `minOccurs="0" maxOccurs="unbounded"` reference to the original global
  element, preserving existing types and imports. Choose the record root for XSD-only
  schemas; existing XML fixes that choice to its document root.
  Transform stays open, selects the new datasource, and rebases existing field
  mappings beneath the wrapper. Unmodified preview input is wrapped too; custom
  preview input is retained. Add a repeating-group mapping between the record
  elements (for example, `persons/person` to `employees/employee`) to keep each
  record's fields together. This action currently supports XML/XSD, not JSON Schema.
- In Transform, **Create source + target collections...** creates both wrappers in
  one dialog. Review the suggested root names (for example, `persons` and
  `employees`). Both conversions are validated before either workbench is added.
  Transform stays active, selects both new files, rebases existing mappings and adds
  a repeating-group mapping between the original roots if that target is not already
  mapped. Original workbenches and custom preview input are preserved.
- Transform preview requires the .NET service (`npm run dev:full`). It runs in an
  isolated process with a five-second limit, at most two concurrent workers, and
  1,000,000-character limits on input, stylesheet and output. External documents,
  stylesheet imports, scripts and DTDs are disabled. Preview output is not yet
  validated against the target XSD.
- Graphical drag-to-connect mapping and richer expressions/conditions remain
  subsequent Transform milestones.

### OpenAPI workbench

- **File > New > OpenAPI Workbench** opens a separate document with **API Design**,
  **Schemas**, **JSON**, **YAML**, and **Swagger Preview** tabs. Set the API title,
  version, description and optional server URL.
- Add **Entity** workbenches as sources to propose CRUD operations per table.
  List and create are proposed for every table; get/update/delete by key require
  explicit primary keys. Composite keys become separate typed path parameters.
  Nullable columns use JSON Schema null unions. Unknown CLR types generate a
  diagnostic and a string placeholder. Relationships remain scalar foreign keys;
  nested resources and expanded navigation properties are not inferred.
- Routes are **editable proposals, not a generated backend**. Review paths, operation
  IDs, bodies, responses and authorization before publishing. Enable/disable or remove
  proposals, or add manual endpoints. This version supports GET, POST, PUT, PATCH,
  DELETE and success statuses 200/201/204. New path placeholders default to required
  string parameters; proposed ERD keys retain their inferred types.
- Optional JSON/YAML schema sources contribute reusable `components.schemas` without
  inventing endpoints. Choose schema import, instance inference, or XML/XSD sample
  inference explicitly. Bind components independently to endpoint requests/responses;
  responses can be arrays. Component names are prefixed by source workbench names
  to avoid accidental merging; duplicate names are reported rather than overwritten.
- **Schemas** edits snapshot components as JSON with an explicit **Apply** action.
  Source workbenches are not modified. Legacy definitions, tuple arrays and local
  references are normalized for OpenAPI 3.1/JSON Schema 2020-12. External references,
  anchors, dynamic references and nested schema IDs need explicit conversion.
  Missing references, invalid schemas, duplicate routes/operation IDs and missing
  component bindings block export and preview.
- **XML/XSD conversion is intentionally sample-based and lossy**: element structure,
  repeated sample elements and `@attribute` properties become JSON payload schemas.
  XSD facets, types, choices, namespaces, mixed text and occurrence constraints are not
  preserved; a diagnostic accompanies every such source. XSD-only sources need the
  .NET default-instance endpoint. Use an explicit JSON schema where fidelity matters.
- Source snapshots survive closed source workbenches. Changed live sources are flagged;
  **Refresh snapshot** replaces schemas but keeps endpoint edits. Review affected
  bindings afterwards; new ERD tables do not silently add routes during refresh.
  Removing a source retains endpoint bindings for explicit repair.
- Export standalone `openapi.json` or `openapi.yaml`. **Save Workbench** exports the
  editable design, snapshots and endpoints; workspace autosave includes this state.
- **Generate form** on an enabled POST/PUT/PATCH endpoint with a request binding opens
  a new JSON workbench directly in **Instance Form**. Its request schema and local
  component graph are bundled without network references, preserving shared and
  recursive references. Edit payloads using the existing Instance Form and JSON Input
  tools, and use the existing validation/export actions. No API request is sent.
  Boolean schemas have no editable fields and are rejected with an explanation.
  Origin metadata survives workbench save/reopen. A banner flags changed or closed
  OpenAPI sources; regeneration creates a new workbench rather than overwriting form
  edits or payload data. This is a schema snapshot with provenance, not a live two-way
  binding or generated application source code.
- Swagger UI is bundled locally and loaded only for **Swagger Preview**. Try-it-out,
  the remote validator badge, query configuration and preview network requests are
  disabled. Preview does not contact the API server.
- Bundled [external schemas](public/schemas/README.md) include the official OpenAPI
  3.1 document schema, W3C XSLT schemas and an explicitly identified Apache FOP
  XSL-FO schema. The OpenAPI document schema validates structure, not embedded
  Schema Objects; component schemas receive separate JSON Schema checks.

### Styling & Theming

- This project uses CSS modules as the styling solution, Radix as the component library, and Open Props for styling tokens and theming.
- Project theme is defined in [app/styles/theme.css](app/styles/theme.css), used as a design system for all UI building.
- Base design tokens are defined in [app/styles/tokens](app/styles/tokens), used as an immutable base design system for theme and UI.

## Getting Started

### Installation

Install the dependencies:

```bash
npm install
```

### Development

Start the development server with HMR:

```bash
npm run dev
```

Your application will be available at `http://localhost:5173`.

## Building for Production

Create a production build:

```bash
npm run build
```

## Deployment

If you're familiar with deploying Node applications, the built-in app server is production-ready. Make sure to deploy the output of `npm run build`.

Typical build layout:

```
├── package.json
├── package-lock.json (or pnpm-lock.yaml, or bun.lockb)
├── build/
│   ├── client/    # Static assets
│   └── server/    # Server-side code
```

## Features Added by This Project

- **Provenance marker (`__from`)**: The reducer now annotates inlined resolved schema nodes with a `__from` property referencing the original `$ref` (or the `$ref` found in an `allOf`). This makes provenance authoritative and lets UI layers detect imported definitions reliably.

- **isSchemaImported helper**: `isSchemaImported` (exported from the reducer) inspects reducer state or a schema node and returns whether the node was imported. Workbench passes a simple helper to editors which prefers the reducer's `__from` marker.

- **Override behavior in SchemaEditorForm**: Creating a local override (`allOf` wrapper) now only pre-populates properties when the current JSON instance contains keys at the editor `path`. The editor uses the instance values to generate appropriate property schemas so the override won't add arbitrary fields unless the instance indicates they should exist.

- **Instance-aware editing**: `Workbench` passes `instanceData` into `SchemaEditorForm` so form-level override logic can consult the current JSON instance before adding properties.

## Tests

- XML form regression tests cover schema-scoped child traversal, optional choices,
  and repeated-element attribute editing. Schema Form choice rows start collapsed;
  expand a row to edit its declaration fields.
- Schema compilation and walking avoid per-node console tracing: large XSDs can
  generate enough output to stall the VS Code Jest runner and cause timeouts.
  Regression tests check that normal traversal stays quiet; warnings and errors
  remain available.

- A focused provenance test was added: [app/state/__tests__/schemaReducer.provenance.test.ts](app/state/__tests__/schemaReducer.provenance.test.ts) which asserts `__from` is attached to inlined nodes and that `isSchemaImported` returns `true` for those nodes.

Run tests with:

```bash
npm test
```
# Schema Sculptor — JSON Schema Workbench

Schema Sculptor is an interactive workbench for generating, inspecting, and editing JSON Schemas. It provides both a form-based editor and a graphical editor, synchronizes a canonical source schema with a resolved editor view, and lets you author safe local overrides of imported schema definitions.

## Key Features

- Editor types: form-based editor (`SchemaEditorForm`) and graphical editor (`GraphicalSchemaEditor`).
- Authoritative reducer normalization: the reducer owns dereferencing, normalization, and provenance metadata so UI layers remain simple.
- Provenance metadata (`__from`): inlined or rehydrated schema nodes are annotated with `__from` to indicate the original `$ref` source.
- Instance-aware overrides: creating a local `allOf` override is instance-aware — the editor will only pre-populate properties when the current JSON instance contains keys at the editor path.
- Rehydration and persistence: edits made to the resolved/editor view are rehydrated into the canonical `source` for persistence.
- Tests and automation: Jest unit tests and Playwright e2e tests are provided to validate behavior and integrations.

### Styling & Theming

- This project uses CSS modules as the styling solution, Radix as the component library, and Open Props for styling tokens and theming.
- Project theme is defined in [app/styles/theme.css](app/styles/theme.css), used as a design system for all UI building.
- Base design tokens are defined in [app/styles/tokens](app/styles/tokens), used as an immutable base design system for theme and UI.

## Getting Started

### Installation

Install the dependencies:

```bash
npm install
Run tests with:

```bash
npm test
```
├── package.json
├── package-lock.json (or pnpm-lock.yaml, or bun.lockb)
├── build/
│   ├── client/    # Static assets
│   └── server/    # Server-side code
```

## Features Added by This Project

- **Provenance marker (`__from`)**: The reducer now annotates inlined resolved schema nodes with a `__from` property referencing the original `$ref` (or the `$ref` found in an `allOf`). This makes provenance authoritative and lets UI layers detect imported definitions reliably.

- **isSchemaImported helper**: `isSchemaImported` (exported from the reducer) inspects reducer state or a schema node and returns whether the node was imported. Workbench passes a simple helper to editors which prefers the reducer's `__from` marker.

- **Override behavior in SchemaEditorForm**: Creating a local override (`allOf` wrapper) now only pre-populates properties when the current JSON instance contains keys at the editor `path`. The editor uses the instance values to generate appropriate property schemas so the override won't add arbitrary fields unless the instance indicates they should exist.

- **Instance-aware editing**: `Workbench` passes `instanceData` into `SchemaEditorForm` so form-level override logic can consult the current JSON instance before adding properties.

## Tests

- A focused provenance test was added: [app/state/__tests__/schemaReducer.provenance.test.ts](app/state/__tests__/schemaReducer.provenance.test.ts) which asserts `__from` is attached to inlined nodes and that `isSchemaImported` returns `true` for those nodes.

Run tests with:

```bash
npm test
```
# Schema Sculptor — JSON Schema Workbench

Schema Sculptor is an interactive workbench for generating, inspecting, and editing JSON Schemas. It provides both a form-based editor and a graphical editor, synchronizes a canonical source schema with a resolved editor view, and lets you author safe local overrides of imported schema definitions.

## Key Features

- Editor types: form-based editor (`SchemaEditorForm`) and graphical editor (`GraphicalSchemaEditor`).
- Authoritative reducer normalization: the reducer owns dereferencing, normalization, and provenance metadata so UI layers remain simple.
- Provenance metadata (`__from`): inlined or rehydrated schema nodes are annotated with `__from` to indicate the original `$ref` source.
- Instance-aware overrides: creating a local `allOf` override is instance-aware — the editor will only pre-populate properties when the current JSON instance contains keys at the editor path.
- Rehydration and persistence: edits made to the resolved/editor view are rehydrated into the canonical `source` for persistence.
- Tests and automation: Jest unit tests and Playwright e2e tests are provided to validate behavior and integrations.

### Styling & Theming

- This project uses CSS modules as the styling solution, Radix as the component library, and Open Props for styling tokens and theming.
- Project theme is defined in [app/styles/theme.css](app/styles/theme.css), used as a design system for all UI building.
- Base design tokens are defined in [app/styles/tokens](app/styles/tokens), used as an immutable base design system for theme and UI.
Run tests with:

```bash
npm test
```

Start the development server with HMR:

```bash
npm run dev
```

Your application will be available at `http://localhost:5173`.

## Building for Production

Create a production build:

```bash
npm run build
```

## Deployment

### DIY Deployment

If you're familiar with deploying Node applications, the built-in app server is production-ready.

Make sure to deploy the output of `npm run build`.

```
├── package.json
├── package-lock.json (or pnpm-lock.yaml, or bun.lockb)
├── build/
│   ├── client/    # Static assets
│   └── server/    # Server-side code
```

## Features Added by This Project

- **Provenance marker (`__from`)**: The reducer now annotates inlined resolved schema nodes with a `__from` property referencing the original `$ref` (or the `$ref` found in an `allOf`). This makes provenance authoritative and lets UI layers detect imported definitions reliably.

- **isSchemaImported helper**: `isSchemaImported` (exported from the reducer) inspects reducer state or a schema node and returns whether the node was imported. Workbench passes a simple helper to editors which prefers the reducer's `__from` marker.

- **Override behavior in SchemaEditorForm**: Creating a local override (`allOf` wrapper) now only pre-populates properties when the current JSON instance contains keys at the editor `path`. The editor uses the instance values to generate appropriate property schemas so the override won't add arbitrary fields (e.g., `username`) unless the instance indicates they should exist.

- **Instance-aware editing**: `Workbench` passes `instanceData` into `SchemaEditorForm` so form-level override logic can consult the current JSON instance before adding properties.

## Tests

- A focused provenance test was added: `app/state/__tests__/schemaReducer.provenance.test.ts` which asserts `__from` is attached to inlined nodes and that `isSchemaImported` returns `true` for those nodes.

Run tests with:

```bash
npm test
```
