import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'node:util';
import schemastoreWorkflow from '../test-fixtures/schemastore-workflow.json';

jest.mock('@dazl/color-scheme/react', () => ({
  useColorScheme: () => ({
    configScheme: 'light',
    resolvedScheme: 'light',
    setColorScheme: jest.fn(),
  }),
}));

import Workbench from './workbench';

Object.assign(global, { TextEncoder, TextDecoder });

const STORAGE_KEY = 'schema-sculptor-schema';
const ERD_STORAGE_KEY = 'schema-sculptor-erd-model';

describe('Workbench integration - load unresolved $defs schema', () => {
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

  beforeEach(() => {
    localStorage.clear();
  });

  it('does not read persisted storage during the initial render pass', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(unresolved));
    const getItemSpy = jest.spyOn(Storage.prototype, 'getItem');

    render(<Workbench />);

    expect(getItemSpy).not.toHaveBeenCalled();
    getItemSpy.mockRestore();
  });

  it('restores the raw saved instance text without reserializing it', async () => {
    const rawInstance = '{"alpha":1,"beta":{"nested":true}}';
    localStorage.setItem(STORAGE_KEY, JSON.stringify(unresolved));
    localStorage.setItem('schema-sculptor-instance', rawInstance);

    render(<Workbench />);

    await waitFor(() => {
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      expect(textarea.value).toBe(rawInstance);
    });
  });

  it('rehydrates the GitHub workflow schema and a simple myStyles/myHtml instance from localStorage', async () => {
    const workflowInstance = {
      name: 'demo-workflow',
      myStyles: 'body { color: #123456; }',
      myHtml: '<div>hello</div>',
      on: 'push',
      jobs: {
        build: {
          'runs-on': 'ubuntu-latest',
          steps: [
            { run: 'echo hi' }
          ]
        }
      }
    } as any;

    localStorage.setItem(STORAGE_KEY, JSON.stringify(schemastoreWorkflow));
    localStorage.setItem('schema-sculptor-instance', JSON.stringify(workflowInstance));

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      render(<Workbench />);

      await waitFor(() => {
        const badge = screen.getByTestId('schema-source-badge');
        expect(badge).toHaveTextContent(/resolved/i);
      });

      const textarea = await screen.findByRole('textbox') as HTMLTextAreaElement;
      expect(textarea.value).toContain('"myStyles"');
      expect(textarea.value).toContain('"myHtml"');

      const hasStackOverflow = errorSpy.mock.calls.some((args) =>
        args.some((arg) => typeof arg === 'string' && arg.includes('Maximum call stack size exceeded'))
      );

      expect(hasStackOverflow).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('does not emit a useLayoutEffect warning during server rendering', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { renderToString } = await import('react-dom/server');
      renderToString(<Workbench />);

      const containsWarning = errorSpy.mock.calls.some((args) => {
        const [firstArg] = args;
        return typeof firstArg === 'string' && firstArg.includes('useLayoutEffect does nothing on the server');
      });

      expect(containsWarning).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('renders SchemaEditorForm root type as object when schema loaded from storage', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(unresolved));
    render(<Workbench />);

    // Wait for reducer to produce a resolved schema before interacting with the UI
    await waitFor(() => {
      const badge = screen.getByTestId('schema-source-badge');
      expect(badge).toHaveTextContent(/resolved/i);
    });

    // Open the Schema Input tab
    const schemaTab = screen.getByRole('button', { name: /Schema Input/i });
    expect(schemaTab).toBeInTheDocument();
    fireEvent.click(schemaTab);

    // The SchemaEditorForm renders Object buttons for the root type
    // Wait for these to appear after clicking the Schema Input tab
    await waitFor(() => {
      const objectBtns = screen.getAllByRole('button', { name: /^Object$/ });
      expect(objectBtns.length).toBeGreaterThan(0);
      // The first one should be the root object button
      expect(objectBtns[0]).toHaveStyle('font-weight: 700');
    });
  });

  it('updates UI when uploading a schema file', async () => {
    render(<Workbench />);

    // Open Schema Input tab first, then upload the file
    const schemaTab = screen.getByRole('button', { name: /Schema Input/i });
    fireEvent.click(schemaTab);

    // Find the hidden file input and simulate uploading JSON content
    const fileInput = document.querySelector('input[accept=".cs,text/plain"]') as HTMLInputElement | null;
    expect(fileInput).toBeTruthy();
    const file = new File([JSON.stringify(unresolved)], 'schema.json', { type: 'application/json' });
    // fire change event to load schema into reducer
    fireEvent.change(fileInput!, { target: { files: [file] } });

    // Wait for reducer to produce a resolved schema
    await waitFor(() => {
      const badge = screen.getByTestId('schema-source-badge');
      expect(badge).toHaveTextContent(/resolved/i);
    });

    // The SchemaEditorForm renders Object buttons for the root type
    // Wait for these to appear after the schema is resolved
    await waitFor(() => {
      const objectBtns = screen.getAllByRole('button', { name: /^Object$/ });
      expect(objectBtns.length).toBeGreaterThan(0);
      expect(objectBtns[0]).toHaveStyle('font-weight: 700');
    });
  });

  it('persists and restores the ERD model from localStorage', async () => {
    const initialModel = {
      tables: [
        {
          id: 'Instructor',
          name: 'Instructor',
          clrName: 'Instructor',
          columns: [],
          navigations: [],
        }
      ],
      relationships: [],
      sourceFiles: [],
      diagnostics: [],
    };
    localStorage.setItem(ERD_STORAGE_KEY, JSON.stringify(initialModel));

    render(<Workbench />);

    const erdTab = screen.getByRole('button', { name: /ERD/i });
    fireEvent.click(erdTab);

    await waitFor(() => {
      expect(screen.getByText(/Entity Relationship Diagram/i)).toBeInTheDocument();
    });

    expect(JSON.parse(localStorage.getItem(ERD_STORAGE_KEY) || '{}')).toEqual(initialModel);
  });

  it('creates a blank ERD from scratch', async () => {
    render(<Workbench />);

    fireEvent.click(screen.getByRole('button', { name: /ERD/i }));

    await waitFor(() => {
      expect(screen.getByText(/start from scratch/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Create blank ERD/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Entity/i })).toBeInTheDocument();
      expect(JSON.parse(localStorage.getItem(ERD_STORAGE_KEY) || '{}')).toEqual({
        tables: [],
        relationships: [],
        sourceFiles: [],
        diagnostics: [],
      });
    });
  });

  it('prints the ERD graph from the sidebar button', async () => {
    localStorage.setItem(ERD_STORAGE_KEY, JSON.stringify({
      tables: [
        {
          id: 'Instructor',
          name: 'Instructor',
          clrName: 'Instructor',
          columns: [],
          navigations: [],
        },
      ],
      relationships: [],
      sourceFiles: [],
      diagnostics: [],
    }));

    const originalCreateObjectURL = (URL as any).createObjectURL;
    const originalRevokeObjectURL = (URL as any).revokeObjectURL;
    (URL as any).createObjectURL = jest.fn(() => 'blob:print-preview');
    (URL as any).revokeObjectURL = jest.fn(() => {});
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => {
      const listeners: Record<string, Array<() => void>> = {};
      return {
        focus: jest.fn(),
        print: jest.fn(),
        close: jest.fn(),
        addEventListener: jest.fn((event: string, handler: () => void) => {
          listeners[event] = listeners[event] ?? [];
          listeners[event].push(handler);
          if (event === 'load') {
            handler();
          }
        }),
      } as any;
    });

    render(<Workbench />);
    fireEvent.click(screen.getByRole('button', { name: /ERD/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Print graph/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Print graph/i }));

    await waitFor(() => expect(openSpy).toHaveBeenCalled());
    expect((URL as any).createObjectURL).toHaveBeenCalled();
    expect((URL as any).revokeObjectURL).not.toHaveBeenCalled();
    (URL as any).createObjectURL = originalCreateObjectURL;
    (URL as any).revokeObjectURL = originalRevokeObjectURL;
    openSpy.mockRestore();
  });

  it('adds and deletes ERD items from the sidebar', async () => {
    const initialModel = {
      tables: [
        {
          id: 'Department',
          name: 'Department',
          clrName: 'Department',
          columns: [
            { name: 'DepartmentID', type: 'int', isNullable: false, isPrimaryKey: true, isForeignKey: false },
            { name: 'InstructorID', type: 'int', isNullable: true, isPrimaryKey: false, isForeignKey: false },
          ],
          navigations: [],
        },
        {
          id: 'Instructor',
          name: 'Instructor',
          clrName: 'Instructor',
          columns: [{ name: 'ID', type: 'int', isNullable: false, isPrimaryKey: true, isForeignKey: false }],
          navigations: [],
        },
      ],
      relationships: [],
      sourceFiles: [],
      diagnostics: [],
    };

    localStorage.setItem(ERD_STORAGE_KEY, JSON.stringify(initialModel));


    render(<Workbench />);

    fireEvent.click(screen.getByRole('button', { name: /ERD/i }));

    await waitFor(() => {
      expect(document.querySelector('.react-flow__node')).toBeTruthy();
    });

    fireEvent.click(document.querySelector('.react-flow__node') as Element);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add property/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Add property/i }));
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(ERD_STORAGE_KEY) || '{}');
      expect(stored.tables[0].columns.some((column: any) => column.name === 'NewProperty')).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: /Add relationship/i }));
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(ERD_STORAGE_KEY) || '{}');
      expect(stored.relationships).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole('button', { name: /Delete property InstructorID/i }));
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(ERD_STORAGE_KEY) || '{}');
      expect(stored.tables[0].columns.some((column: any) => column.name === 'InstructorID')).toBe(false);
    });
  });

  it('keeps diagnostics collapsed by default and opens them from the toggle', async () => {
    localStorage.setItem(ERD_STORAGE_KEY, JSON.stringify({
      tables: [
        {
          id: 'Node',
          name: 'Node',
          clrName: 'Node',
          columns: [],
          navigations: [],
        },
      ],
      relationships: [],
      sourceFiles: [],
      diagnostics: [{ severity: 'warning', message: 'Inferred relationship Node -> Node from navigation Parent.' }],
    }));

    render(<Workbench />);

    fireEvent.click(screen.getByRole('button', { name: /ERD/i }));

    await waitFor(() => {
      expect(screen.getByText(/Entity Relationship Diagram/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/Inferred relationship Node -> Node from navigation Parent\./i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Expand diagnostics/i }));

    await waitFor(() => {
      expect(screen.getByText(/Inferred relationship Node -> Node from navigation Parent\./i)).toBeInTheDocument();
    });
  });

  it('deletes an ERD relationship from the sidebar', async () => {
    const initialModel = {
      tables: [
        {
          id: 'Department',
          name: 'Department',
          clrName: 'Department',
          columns: [
            { name: 'DepartmentID', type: 'int', isNullable: false, isPrimaryKey: true, isForeignKey: false },
            { name: 'InstructorID', type: 'int', isNullable: true, isPrimaryKey: false, isForeignKey: true, foreignKeyTarget: 'Instructor' },
          ],
          navigations: [],
        },
        {
          id: 'Instructor',
          name: 'Instructor',
          clrName: 'Instructor',
          columns: [{ name: 'ID', type: 'int', isNullable: false, isPrimaryKey: true, isForeignKey: false }],
          navigations: [],
        },
      ],
      relationships: [
        {
          id: 'Department->Instructor:InstructorID',
          dependentTable: 'Department',
          principalTable: 'Instructor',
          foreignKeyColumns: ['InstructorID'],
          principalCardinality: 'one',
          dependentCardinality: 'zero-or-one',
          explicit: true,
        },
      ],
      sourceFiles: [],
      diagnostics: [],
    };

    localStorage.setItem(ERD_STORAGE_KEY, JSON.stringify(initialModel));

    render(<Workbench />);

    fireEvent.click(screen.getByRole('button', { name: /ERD/i }));

    await waitFor(() => {
      expect(document.querySelector('.react-flow__node')).toBeTruthy();
    });

    fireEvent.click(document.querySelector('.react-flow__node') as Element);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Delete relationship Department to Instructor/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Delete relationship Department to Instructor/i }));

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(ERD_STORAGE_KEY) || '{}');
      expect(stored.relationships).toHaveLength(0);
    });
  });

  it('commits foreign key columns on blur', async () => {
    const initialModel = {
      tables: [
        {
          id: 'Department',
          name: 'Department',
          clrName: 'Department',
          columns: [
            { name: 'DepartmentID', type: 'int', isNullable: false, isPrimaryKey: true, isForeignKey: false },
            { name: 'InstructorID', type: 'int', isNullable: true, isPrimaryKey: false, isForeignKey: true, foreignKeyTarget: 'Instructor' },
          ],
          navigations: [],
        },
        {
          id: 'Instructor',
          name: 'Instructor',
          clrName: 'Instructor',
          columns: [{ name: 'ID', type: 'int', isNullable: false, isPrimaryKey: true, isForeignKey: false }],
          navigations: [],
        },
      ],
      relationships: [
        {
          id: 'Department->Instructor:InstructorID',
          dependentTable: 'Department',
          principalTable: 'Instructor',
          foreignKeyColumns: ['InstructorID'],
          principalCardinality: 'one',
          dependentCardinality: 'zero-or-one',
          explicit: true,
        },
      ],
      sourceFiles: [],
      diagnostics: [],
    };

    localStorage.setItem(ERD_STORAGE_KEY, JSON.stringify(initialModel));

    render(<Workbench />);

    fireEvent.click(screen.getByRole('button', { name: /ERD/i }));

    await waitFor(() => {
      expect(document.querySelector('.react-flow__node')).toBeTruthy();
    });

    fireEvent.click(document.querySelector('.react-flow__node') as Element);

    const foreignKeyInput = await screen.findByLabelText(/Foreign key columns/i);
    fireEvent.change(foreignKeyInput, { target: { value: 'InstructorID, DepartmentID' } });

    const storedBeforeBlur = JSON.parse(localStorage.getItem(ERD_STORAGE_KEY) || '{}');
    expect(storedBeforeBlur.relationships[0].foreignKeyColumns).toEqual(['InstructorID']);

    fireEvent.blur(foreignKeyInput);

    await waitFor(() => {
      const storedAfterBlur = JSON.parse(localStorage.getItem(ERD_STORAGE_KEY) || '{}');
      expect(storedAfterBlur.relationships[0].foreignKeyColumns).toEqual(['InstructorID', 'DepartmentID']);
    });
  });

  it('reorders ERD properties by dragging a card', async () => {
    const initialModel = {
      tables: [
        {
          id: 'Department',
          name: 'Department',
          clrName: 'Department',
          columns: [
            { name: 'DepartmentID', type: 'int', isNullable: false, isPrimaryKey: true, isForeignKey: false },
            { name: 'InstructorID', type: 'int', isNullable: true, isPrimaryKey: false, isForeignKey: true, foreignKeyTarget: 'Instructor' },
          ],
          navigations: [],
        },
        {
          id: 'Instructor',
          name: 'Instructor',
          clrName: 'Instructor',
          columns: [{ name: 'ID', type: 'int', isNullable: false, isPrimaryKey: true, isForeignKey: false }],
          navigations: [],
        },
      ],
      relationships: [
        {
          id: 'Department->Instructor:InstructorID',
          dependentTable: 'Department',
          principalTable: 'Instructor',
          foreignKeyColumns: ['InstructorID'],
          principalCardinality: 'one',
          dependentCardinality: 'zero-or-one',
          explicit: true,
        },
      ],
      sourceFiles: [],
      diagnostics: [],
    };

    localStorage.setItem(ERD_STORAGE_KEY, JSON.stringify(initialModel));

    render(<Workbench />);
    fireEvent.click(screen.getByRole('button', { name: /ERD/i }));

    await waitFor(() => {
      expect(document.querySelector('.react-flow__node')).toBeTruthy();
    });

    fireEvent.click(document.querySelector('.react-flow__node') as Element);

    const instructorCard = await screen.findByTestId('property-card-InstructorID');
    const departmentCard = await screen.findByTestId('property-card-DepartmentID');

    fireEvent.dragStart(instructorCard);
    fireEvent.dragOver(departmentCard);
    fireEvent.drop(departmentCard);

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(ERD_STORAGE_KEY) || '{}');
      expect(stored.tables[0].columns.map((column: any) => column.name)).toEqual(['InstructorID', 'DepartmentID']);
    });
  });

  it('adds and deletes ERD entities from the sidebar', async () => {
    const initialModel = {
      tables: [
        {
          id: 'Department',
          name: 'Department',
          clrName: 'Department',
          columns: [
            { name: 'DepartmentID', type: 'int', isNullable: false, isPrimaryKey: true, isForeignKey: false },
          ],
          navigations: [],
        },
      ],
      relationships: [],
      sourceFiles: [],
      diagnostics: [],
    };

    localStorage.setItem(ERD_STORAGE_KEY, JSON.stringify(initialModel));

    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);

    render(<Workbench />);
    fireEvent.click(screen.getByRole('button', { name: /ERD/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Entity/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Add Entity/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Delete entity NewEntity/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Delete entity NewEntity/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Entity/i })).toBeInTheDocument();
      const stored = JSON.parse(localStorage.getItem(ERD_STORAGE_KEY) || '{}');
      expect(stored.tables.some((table: any) => table.id === 'NewEntity')).toBe(false);
    });

    confirmSpy.mockRestore();
  });

  it('Save Intermediate includes definition maps in downloaded schema', async () => {
    const draft7WithDefinitions = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        concurrency: { $ref: '#/definitions/concurrency' }
      },
      definitions: {
        concurrency: {
          type: 'object',
          properties: {
            group: { type: 'string' }
          },
          required: ['group']
        }
      }
    } as any;

    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft7WithDefinitions));

    const OriginalBlob = (global as any).Blob;
    class MockBlob {
      private readonly textValue: string;
      readonly type: string;
      readonly size: number;
      constructor(parts: any[], options?: { type?: string }) {
        this.textValue = (parts || []).map((p) => (typeof p === 'string' ? p : String(p))).join('');
        this.type = options?.type || '';
        this.size = this.textValue.length;
      }
      text() {
        return Promise.resolve(this.textValue);
      }
    }
    (global as any).Blob = MockBlob as any;

    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = jest.fn();

    const originalCreateObjectURL = (URL as any).createObjectURL;
    const originalRevokeObjectURL = (URL as any).revokeObjectURL;
    const createObjectURLSpy = jest.fn(() => 'blob:mock-schema');
    const revokeObjectURLSpy = jest.fn(() => {});
    (URL as any).createObjectURL = createObjectURLSpy;
    (URL as any).revokeObjectURL = revokeObjectURLSpy;

    render(<Workbench />);

    await waitFor(() => {
      const badge = screen.getByTestId('schema-source-badge');
      expect(badge).toHaveTextContent(/resolved/i);
    });

    // Open the Schema menu in the menu bar via pointer interaction (Radix Menubar uses pointerdown)
    const schemaTrigger = screen.getByRole('menuitem', { name: /^Schema$/ });
    fireEvent.pointerDown(schemaTrigger, { bubbles: true, cancelable: true });

    const saveIntermediate = await screen.findByRole('menuitem', { name: /Save Intermediate/i });
    fireEvent.click(saveIntermediate);

    await waitFor(async () => {
      expect(createObjectURLSpy).toHaveBeenCalled();
      const firstArg = (createObjectURLSpy.mock.calls[0] as any)[0] as Blob;
      expect(firstArg).toBeDefined();
      const text = await firstArg?.text();
      expect(text).toContain('"definitions"');
      expect(text).toContain('"concurrency"');
    });

    (URL as any).createObjectURL = originalCreateObjectURL;
    (URL as any).revokeObjectURL = originalRevokeObjectURL;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
    (global as any).Blob = OriginalBlob;
  });

  it('clears persisted local storage from dev schema menu action', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(unresolved));
    localStorage.setItem('schema-sculptor-instance', JSON.stringify({ foo: 'bar' }));
    localStorage.setItem('schema-sculptor-deref-complete', JSON.stringify({ ts: Date.now() }));
    localStorage.setItem('schema-sculptor-deref-error', JSON.stringify({ message: 'x' }));
    localStorage.setItem('json-instance-variants:v1:test', JSON.stringify({}));
    localStorage.setItem(ERD_STORAGE_KEY, JSON.stringify({ tables: [], relationships: [], sourceFiles: [], diagnostics: [] }));

    render(<Workbench />);

    const schemaTrigger = screen.getByRole('menuitem', { name: /^Schema$/ });
    fireEvent.pointerDown(schemaTrigger, { bubbles: true, cancelable: true });

    const clearStorageItem = await screen.findByRole('menuitem', { name: /Clear local storage \(dev\)/i });
    fireEvent.click(clearStorageItem);

    await waitFor(() => {
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(localStorage.getItem('schema-sculptor-instance')).toBeNull();
      expect(localStorage.getItem(ERD_STORAGE_KEY)).toBeNull();
      expect(localStorage.getItem('schema-sculptor-deref-complete')).toBeNull();
      expect(localStorage.getItem('schema-sculptor-deref-error')).toBeNull();
      expect(localStorage.getItem('json-instance-variants:v1:test')).toBeNull();
    });
  });

});
