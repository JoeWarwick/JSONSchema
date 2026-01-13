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
