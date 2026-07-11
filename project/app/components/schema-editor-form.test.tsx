import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaEditorForm } from './schema-editor-form';
import { TooltipProvider } from "./ui/tooltip/tooltip";

describe('SchemaEditorForm UI', () => {
  beforeEach(() => {
    // Clear localStorage before each test to ensure clean state
    localStorage.clear();
  });

  it('renders the root type as object', async () => {
    // Resolved form of schema (4).json where top-level $ref -> $defs/order
    const resolvedSchema = {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              price: { type: 'number', minimum: 0 }
            }
          }
        }
      }
    } as any;
    const handleChange = jest.fn();
    const isSchemaImportedStub = (n: any) => !!(n && (n.$ref || n.__from || (Array.isArray(n?.allOf) && n.allOf.some((e: any) => e.$ref))));
    render(
      <TooltipProvider>
        <SchemaEditorForm schema={resolvedSchema} onChange={handleChange} isSchemaImported={isSchemaImportedStub} />
      </TooltipProvider>
    );

    const objectButtons = await screen.findAllByRole('button', { name: /Object/i });
    // Root type button should be visible
    expect(objectButtons.length).toBeGreaterThan(0);
    expect(objectButtons[0]).toBeInTheDocument();
  });

  it('resolves $defs/$ref and renders root as object when given unresolved schema', async () => {
    const unresolved = {
      $id: 'https://example.com/ecommerce.schema.json',
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $ref: '#/$defs/order',
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

    // Use the same dereferencer the app uses if available
    let resolved: any = unresolved;
    try {
      const parser = await import('json-schema-ref-parser');
      resolved = await (parser as any).default.dereference(unresolved);
    } catch (_) {
      // ignore here; we'll fallback to hoist below
    }

    // If dereferencer did not produce a concrete root `type`, fall back to hoisting
    if (!resolved.type && typeof unresolved.$ref === 'string' && unresolved.$defs && unresolved.$ref.startsWith('#/$defs/')) {
      const key = unresolved.$ref.replace('#/$defs/', '');
      resolved = (unresolved.$defs as any)[key] || resolved;
    }

    const handleChange = jest.fn();
    const isSchemaImportedStub = (n: any) => !!(n && (n.$ref || n.__from || (Array.isArray(n?.allOf) && n.allOf.some((e: any) => e && typeof e === 'object' && e.$ref))));
    render(
      <TooltipProvider>
        <SchemaEditorForm schema={resolved} onChange={handleChange} isSchemaImported={isSchemaImportedStub} />
      </TooltipProvider>
    );

    const objectButtons = await screen.findAllByRole('button', { name: /Object/i });
    // Root type button should exist
    expect(objectButtons.length).toBeGreaterThan(0);
    expect(objectButtons[0]).toBeInTheDocument();
  });

  it('allows adding patternProperties when Strict mode (additionalProperties:false) is on and hides Add Property', async () => {
    const schema = { type: 'object', additionalProperties: false } as any;
    const handleChange = jest.fn();

    render(
      <TooltipProvider>
        <SchemaEditorForm schema={schema} onChange={handleChange} />
      </TooltipProvider>
    );

    // Add Property should be hidden
    expect(screen.queryByRole('button', { name: /Add Property/i })).toBeNull();

    // + pattern property should still be available
    const patternBtn = screen.getByRole('button', { name: /pattern property/i });
    expect(patternBtn).toBeInTheDocument();

    // Clicking it should call onChange and add patternProperties
    fireEvent.click(patternBtn);
    expect(handleChange).toHaveBeenCalled();
    const next = handleChange.mock.calls[0][0];
    expect(next.patternProperties).toBeDefined();
  });

  it('additionalProperties control supports boolean or schema and shows nested editor', async () => {
    const initial = { type: 'object' } as any;
    const calls: any[] = [];

    function Controlled() {
      const [s, setS] = React.useState(initial);
      return (
        <TooltipProvider>
          <SchemaEditorForm
            schema={s}
            onChange={(next) => { calls.push(next); setS(next); }}
          />
        </TooltipProvider>
      );
    }

    render(<Controlled />);

    // By default 'Allow extra properties' should be selected
    const allowRadio = screen.getByLabelText('additional-allow-root');
    const blockRadio = screen.getByLabelText('additional-block-root');
    const schemaRadio = screen.getByLabelText('additional-schema-root');
    expect(allowRadio).toBeChecked();
    expect(blockRadio).not.toBeChecked();
    expect(schemaRadio).not.toBeChecked();

    // Select 'Strict' -> additionalProperties: false
    fireEvent.click(blockRadio);
    expect(calls[0].additionalProperties).toBe(false);

    // Select 'Apply schema to extras' -> additionalProperties becomes an object (no floating popover or inline editor automatically shown)
    fireEvent.click(schemaRadio);
    expect(calls[1].additionalProperties).toBeDefined();
    expect(typeof calls[1].additionalProperties).toBe('object');

    // Choose 'Allow' explicitly -> additionalProperties becomes true
    fireEvent.click(allowRadio);
    expect(calls[2].additionalProperties).toBe(true);
  });

  it('shows "+ default" add-button next to +format and +pattern for string nodes (when no enum)', async () => {
    const schema = { type: 'string' } as any;
    const handleChange = jest.fn();
    render(
      <TooltipProvider>
        <SchemaEditorForm schema={schema} onChange={handleChange} />
      </TooltipProvider>
    );

    const formatBtn = screen.getByRole('button', { name: '+ format' });
    const patternBtn = screen.getByRole('button', { name: '+ pattern' });
    expect(formatBtn).toBeInTheDocument();
    expect(patternBtn).toBeInTheDocument();

    // + default should live in the same inlineAdd container as format/pattern for string nodes
    const parent = formatBtn.parentElement!;
    expect(within(parent).getByRole('button', { name: '+ default' })).toBeInTheDocument();
  });

  it('renders ref buttons in the type control row even when no local definitions exist', async () => {
    const schema = {
      type: 'object',
      properties: {
        child: { type: 'string' }
      }
    } as any;

    render(
      <TooltipProvider>
        <SchemaEditorForm schema={schema} onChange={() => {}} />
      </TooltipProvider>
    );

    // Properties are collapsed by default, so expand to see ref buttons
    const expandButtons = screen.getAllByRole('button', { name: /^Expand/i });
    if (expandButtons.length > 0) {
      fireEvent.click(expandButtons[0]);
    }

    const refButtons = screen.getAllByRole('button', { name: /^ref/i });
    expect(refButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('keeps root $defs available for nested ref dropdowns when rootSchema is not explicitly passed', async () => {
    const schema = {
      type: 'object',
      $defs: {
        SharedType: {
          type: 'string'
        }
      },
      properties: {
        child: { type: 'string' }
      }
    } as any;

    render(
      <TooltipProvider>
        <SchemaEditorForm schema={schema} onChange={() => {}} />
      </TooltipProvider>
    );

    // Properties are collapsed by default, so expand to see ref buttons
    const expandButtons = screen.getAllByRole('button', { name: /^Expand/i });
    if (expandButtons.length > 0) {
      fireEvent.click(expandButtons[0]);
    }

    const refButtons = screen.getAllByRole('button', { name: /^ref/i });
    expect(refButtons.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(refButtons[0]);
    expect(await screen.findByRole('button', { name: 'SharedType' })).toBeInTheDocument();
  });

  it('renders number facet + buttons above the Enum checkbox', async () => {
    const schema = { type: 'number' } as any;
    render(
      <TooltipProvider>
        <SchemaEditorForm schema={schema} onChange={() => {}} />
      </TooltipProvider>
    );

    const minBtn = screen.getByRole('button', { name: '+ minimum' });
    const enumLabel = screen.getByText(/Enum \(constrained values\)/i);
    // add-button should appear before the enum control in the DOM
    expect(minBtn.compareDocumentPosition(enumLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders array facet + buttons above the Enum checkbox', async () => {
    const schema = { type: 'array' } as any;
    render(
      <TooltipProvider>
        <SchemaEditorForm schema={schema} onChange={() => {}} />
      </TooltipProvider>
    );

    const uniqueBtn = screen.getByRole('button', { name: '+ uniqueItems' });
    const enumLabels = screen.getAllByText(/Enum \(constrained values\)/i);
    const enumLabel = enumLabels.find((el) => el.getAttribute('for') === 'enum-root');
    expect(enumLabel).toBeDefined();
    expect(uniqueBtn.compareDocumentPosition(enumLabel!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('places "+ default" in the facet toolbar for number nodes', async () => {
    const schema = { type: 'number' } as any;
    render(
      <TooltipProvider>
        <SchemaEditorForm schema={schema} onChange={() => {}} />
      </TooltipProvider>
    );

    const toolbar = screen.getByTestId('facet-add-flow');
    expect(within(toolbar).getByRole('button', { name: '+ default' })).toBeInTheDocument();
  });

  it('places "+ default" in the facet toolbar for array nodes', async () => {
    const schema = { type: 'array' } as any;
    render(
      <TooltipProvider>
        <SchemaEditorForm schema={schema} onChange={() => {}} />
      </TooltipProvider>
    );

    // There may be multiple `facet-add-flow` containers on the page (root + items);
    // find the one that contains the array-specific '+ uniqueItems' button and assert
    const toolbars = screen.getAllByTestId('facet-add-flow');
    const toolbar = toolbars.find((t) => within(t).queryByRole('button', { name: '+ uniqueItems' }));
    expect(toolbar).toBeDefined();
    expect(within(toolbar!).getByRole('button', { name: '+ default' })).toBeInTheDocument();
  });

  it('opens floating additionalProperties popover and auto-saves draft on close', async () => {
    const initial = { type: 'object', additionalProperties: { type: 'string' } } as any;
    const calls: any[] = [];

    function Controlled() {
      const [s, setS] = React.useState(initial);
      return (
        <TooltipProvider>
          <SchemaEditorForm
            schema={s}
            onChange={(next) => { calls.push(next); setS(next); }}
          />
        </TooltipProvider>
      );
    }

    render(<Controlled />);

    const editBtn = screen.getByLabelText('edit-additional-properties-root');
    fireEvent.click(editBtn);

    const pop = await screen.findByTestId('ap-popover-content');
    // inside popover, change the subschema type from string -> number
    const numberBtn = within(pop).getByRole('button', { name: /Number/i });
    fireEvent.click(numberBtn);

    // Close the popover (Close button commits draft on close)
    const closeBtn = within(pop).getByRole('button', { name: /Close/i });
    fireEvent.click(closeBtn);

    // Parent should receive the updated additionalProperties schema
    expect(calls.length).toBeGreaterThan(0);
    const last = calls[calls.length - 1];
    expect(last.additionalProperties).toBeDefined();
    expect((last.additionalProperties as any).type).toBe('number');
  });

  it('Edit button opens the floating editor', async () => {
    const initial = { type: 'object', additionalProperties: { type: 'string' } } as any;


    it('wraps long nested ref paths in the imported ref banner', async () => {
      const schema = {
        type: 'object',
        $ref: '#/$defs/SomeExtremelyLongDefinitionNameThatWouldOtherwiseStretchThePanel',
        $defs: {
          SomeExtremelyLongDefinitionNameThatWouldOtherwiseStretchThePanel: {
            type: 'object',
            properties: {
              child: { type: 'string' },
            },
          },
        },
      } as any;

      render(
        <TooltipProvider>
          <SchemaEditorForm schema={schema} path={['child']} onChange={() => {}} />
        </TooltipProvider>
      );

      const refBanner = await screen.findByText(/Ref:/i);
      const banner = refBanner.closest('div');
      const code = refBanner.querySelector?.('code') ?? refBanner.parentElement?.querySelector('code');

      expect(banner).toBeInTheDocument();
      expect(code).toBeInTheDocument();
      expect(banner).toHaveStyle({
        maxWidth: '100%',
        minWidth: '0px',
        flexWrap: 'wrap',
      });
      expect(code).toHaveStyle({
        whiteSpace: 'normal',
        overflowWrap: 'anywhere',
        wordBreak: 'break-word',
      });
    });
    function Controlled() {
      const [s, setS] = React.useState(initial);
      return (
        <TooltipProvider>
          <SchemaEditorForm schema={s} onChange={(next) => setS(next)} />
        </TooltipProvider>
      );
    }

    render(<Controlled />);

    // radio is already checked; click the Edit button to open the floating popover editor
    const editBtn = screen.getByLabelText('edit-additional-properties-root');
    expect(screen.getByLabelText('additional-schema-root')).toBeChecked();

    fireEvent.click(editBtn);

    const pop = await screen.findByTestId('ap-popover-content');
    expect(pop).toBeInTheDocument();
  });

  it('allows adding and removing properties', () => {
    const schema = {
      type: 'object',
      properties: {
        prop1: { type: 'string' }
      }
    } as any;
    const handleChange = jest.fn();

    render(
      <TooltipProvider>
        <SchemaEditorForm schema={schema} onChange={handleChange} />
      </TooltipProvider>
    );

    // Find the property group by test ID
    const prop1Group = screen.getByTestId('prop-prop1');
    expect(prop1Group).toBeInTheDocument();

    // Expand the property first to see the Remove button
    const expandBtn = within(prop1Group).getByRole('button', { name: /Expand/i });
    fireEvent.click(expandBtn);

    // Now find and click Remove button
    const removeBtn = within(prop1Group).getByRole('button', { name: /Remove/i });
    fireEvent.click(removeBtn);

    // After clicking remove, handleChange should be called with properties: {}
    expect(handleChange).toHaveBeenCalled();
    const lastCall = handleChange.mock.calls[handleChange.mock.calls.length - 1][0];
    expect(lastCall.properties).toEqual({});
  });

  it('displays ref button in nested property when root schema has definitions', async () => {
    const schema = {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        metadata: {
          type: 'object',
          properties: {
            created: { type: 'string' }
          }
        }
      },
      $defs: {
        user: { type: 'object', properties: { name: { type: 'string' } } }
      }
    } as any;

    const handleChange = jest.fn();

    render(
      <TooltipProvider>
        <SchemaEditorForm schema={schema} onChange={handleChange} />
      </TooltipProvider>
    );

    // Properties are collapsed by default; need to expand at least one to see ref buttons
    const expandButtons = screen.getAllByRole('button', { name: /^Expand/i });
    if (expandButtons.length > 0) {
      fireEvent.click(expandButtons[0]);
    }
    
    // After expanding, ref buttons should be visible
    const refButtons = screen.queryAllByRole('button', { name: /^ref/i });
    expect(refButtons.length).toBeGreaterThan(0);
  });
});
