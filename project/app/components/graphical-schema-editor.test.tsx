import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GraphicalSchemaEditor } from './graphical-schema-editor';
import { TooltipProvider } from './ui/tooltip/tooltip';
import { waitFor } from '@testing-library/react';
import schemastoreWorkflow from '../test-fixtures/schemastore-workflow.json';

describe('GraphicalSchemaEditor - Enum Editing', () => {

  it('renders the graphical schema RHS control shell', () => {
    render(<GraphicalSchemaEditor schema={{ type: 'object', properties: {} } as any} onChange={() => {}} />);

    expect(screen.getByLabelText('Graphical schema RHS control')).toBeInTheDocument();
  });

  beforeEach(() => {
    delete (globalThis as any).__graphicalSchemaExpansionState;
  });

  it('renders combiner variant numbers starting at 1', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        env: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: { type: 'string' }
            },
            {
              type: 'string'
            }
          ]
        }
      }
    } as any;

    render(<GraphicalSchemaEditor schema={testSchema} onChange={() => {}} />);

    const expandCombinerToggle = screen.queryByTitle('Expand variants');
    if (expandCombinerToggle) {
      fireEvent.click(expandCombinerToggle);
    }

    expect(await screen.findByText('1. Object')).toBeInTheDocument();
    expect(await screen.findByText('2. String')).toBeInTheDocument();
  });

  it('prints the graph from the sidebar button', async () => {
    const printSpy = jest.spyOn(window, 'print').mockImplementation(() => {});

    render(<GraphicalSchemaEditor schema={{ type: 'object', properties: {} } as any} onChange={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /Print graph/i }));

    await waitFor(() => expect(printSpy).toHaveBeenCalled());
    printSpy.mockRestore();
  });

  it('shows Delete Variant in context menu for variant nodes', async () => {
    render(<GraphicalSchemaEditor schema={schemastoreWorkflow as any} onChange={() => {}} />);

    const combinerToggles = await screen.findAllByTitle(/(Expand|Collapse) variants/i);
    fireEvent.click(combinerToggles[0]);

    const variantNode = document.querySelector('.react-flow__node-variant') as HTMLElement | null;
    expect(variantNode).toBeTruthy();
    fireEvent.contextMenu(variantNode!);

    expect(await screen.findByRole('button', { name: 'Delete Variant' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Property' })).not.toBeInTheDocument();
  });

  it('shows Add Combiner in context menu for variant nodes', async () => {
    render(<GraphicalSchemaEditor schema={schemastoreWorkflow as any} onChange={() => {}} />);

    const combinerToggles = await screen.findAllByTitle(/(Expand|Collapse) variants/i);
    fireEvent.click(combinerToggles[0]);

    const variantNode = document.querySelector('.react-flow__node-variant') as HTMLElement | null;
    expect(variantNode).toBeTruthy();
    fireEvent.contextMenu(variantNode!);

    expect(await screen.findByRole('button', { name: 'Add Combiner' })).toBeInTheDocument();
  });

  it('keeps combiner vertical position stable when expanding variants', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        env: {
          oneOf: [
            {
              type: 'object',
              properties: {
                foo: { type: 'string' },
                bar: { type: 'number' },
              },
            },
            {
              type: 'string',
            },
          ],
        },
      },
    } as any;

    render(<GraphicalSchemaEditor schema={testSchema} onChange={() => {}} />);

    const combinerToggles = await screen.findAllByTitle(/(Expand|Collapse) variants/i);
    const toggleButton = combinerToggles[0];
    const combinerNode = toggleButton.closest('.react-flow__node') as HTMLElement | null;
    expect(combinerNode).toBeTruthy();
    const combinerId = combinerNode!.getAttribute('data-id') as string;

    const parseY = (transform: string | null) => {
      if (!transform) return 0;
      const match = transform.match(/translate\([^,]+,\s*([-\d.]+)px\)/);
      return match ? Number(match[1]) : 0;
    };

    const yBefore = parseY(combinerNode!.style.transform || null);

    fireEvent.click(toggleButton);

    await waitFor(() => {
      const updatedNode = document.querySelector(`.react-flow__node[data-id="${combinerId}"]`) as HTMLElement | null;
      expect(updatedNode).toBeTruthy();
      const yAfter = parseY(updatedNode!.style.transform || null);
      expect(Math.abs(yAfter - yBefore)).toBeLessThan(1);
    });
  });

  it('lays out root children in alphabetical top-to-bottom order', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        zeta: { type: 'string' },
        alpha: { type: 'string' },
        mu: { type: 'string' },
      },
    } as any;

    render(<GraphicalSchemaEditor schema={testSchema} onChange={() => {}} />);

    const parseY = (transform: string | null) => {
      if (!transform) return 0;
      const match = transform.match(/translate\([^,]+,\s*([-\d.]+)px\)/);
      return match ? Number(match[1]) : 0;
    };

    await waitFor(() => {
      expect(document.querySelector('.react-flow__node[data-id="1.alpha"]')).not.toBeNull();
      expect(document.querySelector('.react-flow__node[data-id="1.mu"]')).not.toBeNull();
      expect(document.querySelector('.react-flow__node[data-id="1.zeta"]')).not.toBeNull();
    });

    const alphaNode = document.querySelector('.react-flow__node[data-id="1.alpha"]') as HTMLElement;
    const muNode = document.querySelector('.react-flow__node[data-id="1.mu"]') as HTMLElement;
    const zetaNode = document.querySelector('.react-flow__node[data-id="1.zeta"]') as HTMLElement;

    const alphaY = parseY(alphaNode.style.transform || null);
    const muY = parseY(muNode.style.transform || null);
    const zetaY = parseY(zetaNode.style.transform || null);

    expect(alphaY).toBeLessThan(muY);
    expect(muY).toBeLessThan(zetaY);
  });

  it('does not show expand toggle for array variants with primitive items', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        env: {
          oneOf: [
            {
              type: 'array',
              items: { type: 'string' }
            }
          ]
        }
      }
    } as any;

    render(<GraphicalSchemaEditor schema={testSchema} onChange={() => {}} />);

    const combinerToggles = await screen.findAllByTitle(/(Expand|Collapse) variants/i);
    fireEvent.click(combinerToggles[0]);

    expect(screen.queryByTitle('Expand variant')).toBeNull();
    expect(screen.queryByTitle('Collapse variant')).toBeNull();
  });

  it('shows Of Type as string for self-hosted-runners tuple array variant', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        'runs-on': {
          anyOf: [
            {
              $comment: 'https://help.github.com/en/actions/automating-your-workflow-with-github-actions/workflow-syntax-for-github-actions#github-hosted-runners',
              type: 'string',
            },
            {
              $comment: 'https://help.github.com/en/actions/automating-your-workflow-with-github-actions/workflow-syntax-for-github-actions#self-hosted-runners',
              type: 'array',
              anyOf: [
                {
                  items: [{ type: 'string' }],
                  minItems: 1,
                  additionalItems: { type: 'string' },
                },
              ],
            },
          ],
        },
      },
    } as any;

    render(<GraphicalSchemaEditor schema={testSchema} onChange={() => {}} />);

    const combinerToggle = await screen.findByTitle(/(Expand|Collapse) variants/i);
    fireEvent.click(combinerToggle);

    const selfHostedVariant = await screen.findByText(/Self-hosted-runners/i);
    fireEvent.click(selfHostedVariant);

    expect(screen.getByLabelText('Type: array')).toBeChecked();
    expect(screen.getByLabelText('Of Type')).toHaveValue('string');
    expect(screen.queryByText('+ multipleOf')).toBeNull();
  });

  it('keeps RHS selected when changing self-hosted-runners variant type', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        'runs-on': {
          anyOf: [
            {
              $comment: 'https://help.github.com/en/actions/automating-your-workflow-with-github-actions/workflow-syntax-for-github-actions#github-hosted-runners',
              type: 'string',
            },
            {
              $comment: 'https://help.github.com/en/actions/automating-your-workflow-with-github-actions/workflow-syntax-for-github-actions#self-hosted-runners',
              type: 'array',
              anyOf: [
                {
                  items: [{ type: 'string' }],
                  minItems: 1,
                  additionalItems: { type: 'string' },
                },
              ],
            },
          ],
        },
      },
    } as any;

    let latestSchema = testSchema;
    render(
      <GraphicalSchemaEditor
        schema={testSchema}
        onChange={(next) => {
          latestSchema = next as any;
        }}
      />
    );

    const combinerToggle = await screen.findByTitle(/(Expand|Collapse) variants/i);
    fireEvent.click(combinerToggle);

    const selfHostedVariant = await screen.findByText(/Self-hosted-runners/i);
    fireEvent.click(selfHostedVariant);

    const numberType = screen.getByLabelText('Type: number');
    fireEvent.click(numberType);

    await waitFor(() => {
      expect(latestSchema.properties['runs-on'].anyOf[1].type).toContain('array');
      expect(screen.getByLabelText('Name')).toBeInTheDocument();
      expect(screen.getByLabelText('Type: number')).toBeChecked();

      const runsOnAnyOf = ((latestSchema as any)?.properties?.['runs-on']?.anyOf || []) as any[];
      const hasNumericVariant = runsOnAnyOf.some((entry) => {
        const emittedType = entry?.type;
        return emittedType === 'number' || (Array.isArray(emittedType) && emittedType.includes('number'));
      });
      expect(hasNumericVariant).toBe(true);
    });
  });

  it('switches additionalProperties mode from schema to false', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        env: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: { type: 'string' },
            },
            {
              type: 'string',
            },
          ],
        },
      },
    } as any;

    let latestSchema = testSchema;
    render(
      
      <GraphicalSchemaEditor
        schema={testSchema}
        onChange={(next) => {
          latestSchema = next as any;
        }}
      />
    );

    const combinerToggles = await screen.findAllByTitle(/(Expand|Collapse) variants/i);
    fireEvent.click(combinerToggles[0]);

    const variantExpandToggle = screen.queryByTitle('Expand variant');
    if (variantExpandToggle) {
      fireEvent.click(variantExpandToggle);
    }

    let variantObjectNode: HTMLElement | null = null;
    await waitFor(() => {
      variantObjectNode = document.querySelector('.react-flow__node-variant') as HTMLElement | null;
      expect(latestSchema.properties.env.oneOf[0].additionalProperties).toBeDefined();
      expect(variantObjectNode).not.toBeNull();
    });
    fireEvent.click(variantObjectNode!);

    const apModeSelects = await screen.findAllByRole('combobox', { name: 'additionalProperties' });
    const apModeSelect = apModeSelects.find(
      (el) => (el as HTMLSelectElement).value === 'schema'
    ) as HTMLSelectElement | undefined;
    expect(apModeSelect).toBeTruthy();

    await waitFor(() => {
      expect(document.querySelector('.react-flow__node[data-id$=".additionalProperties"]')).not.toBeNull();
    });

    fireEvent.change(apModeSelect!, { target: { value: 'false' } });

    await waitFor(() => {
      const apSelect = screen.getByRole('combobox', { name: 'additionalProperties' }) as HTMLSelectElement;
      expect(apSelect.value).toBe('false');
    });

  });

  it('shows schema mode on owner Object and false mode on synthetic additionalProperties node', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        env: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: {
                oneOf: [
                  { type: 'string' },
                  { type: 'number' },
                  { type: 'boolean' },
                ],
              },
            },
            {
              type: 'string',
            },
          ],
        },
      },
    } as any;

    render(<GraphicalSchemaEditor schema={testSchema} onChange={() => {}} />);

    const combinerToggles = await screen.findAllByTitle(/(Expand|Collapse) variants/i);
    fireEvent.click(combinerToggles[0]);

    const variantExpandToggle = screen.queryByTitle('Expand variant');
    if (variantExpandToggle) {
      fireEvent.click(variantExpandToggle);
    }

    let variantObjectNode: HTMLElement | null = null;
    await waitFor(() => {
      variantObjectNode = document.querySelector('.react-flow__node-variant') as HTMLElement | null;
      expect(variantObjectNode).not.toBeNull();
    });
    fireEvent.click(variantObjectNode!);
    expect(await screen.findByRole('combobox', { name: 'additionalProperties' })).toHaveValue('schema');

    let additionalPropertiesNode: HTMLElement | null = null;
    await waitFor(() => {
      additionalPropertiesNode = document.querySelector('.react-flow__node[data-id$=".additionalProperties"]') as HTMLElement | null;
      expect(additionalPropertiesNode).not.toBeNull();
    });
    fireEvent.click(additionalPropertiesNode!);
    expect(await screen.findByRole('combobox', { name: 'additionalProperties' })).toHaveValue('false');
  });

  it('places synthetic additionalProperties node one rank from its source node', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        env: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: {
                oneOf: [
                  { type: 'string' },
                  { type: 'number' },
                ],
              },
            },
            { type: 'string' },
          ],
        },
      },
    } as any;

    render(<GraphicalSchemaEditor schema={testSchema} onChange={() => {}} />);

    const combinerToggles = await screen.findAllByTitle(/(Expand|Collapse) variants/i);
    fireEvent.click(combinerToggles[0]);

    const variantExpandToggle = screen.queryByTitle('Expand variant');
    if (variantExpandToggle) {
      fireEvent.click(variantExpandToggle);
    }

    let additionalPropertiesNode: HTMLElement | null = null;
    await waitFor(() => {
      additionalPropertiesNode = document.querySelector('.react-flow__node[data-id$=".additionalProperties"]') as HTMLElement | null;
      expect(additionalPropertiesNode).not.toBeNull();
    });

    const parseX = (transform: string | null) => {
      if (!transform) return 0;
      const match = transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
      return match ? Number(match[1]) : 0;
    };

    const additionalNodeId = additionalPropertiesNode!.getAttribute('data-id') || '';
    let sourceNode: HTMLElement | null = null;
    const segments = additionalNodeId.split('.');
    while (!sourceNode && segments.length > 1) {
      segments.pop();
      const candidateId = segments.join('.');
      sourceNode = document.querySelector(`.react-flow__node[data-id="${candidateId}"]`) as HTMLElement | null;
    }
    expect(sourceNode).not.toBeNull();

    const sourceX = parseX(sourceNode!.style.transform || null);
    const additionalX = parseX(additionalPropertiesNode!.style.transform || null);
    const rankDeltaX = additionalX - sourceX;

    expect(rankDeltaX).toBeGreaterThan(80);
    expect(rankDeltaX).toBeLessThan(400);
  });

  it('resolves $defs and $ref and renders referenced properties', async () => {
    const testSchema = {
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
    render(<GraphicalSchemaEditor schema={testSchema} onChange={() => {}} />);

    // After dereferencing, the referenced properties should appear in the graph
    const orderIdNode = await screen.findByText('orderId');
    expect(orderIdNode).toBeInTheDocument();
    const nameNode = await screen.findByText('name');
    expect(nameNode).toBeInTheDocument();
  });

  it('preserves sibling items enum when resolving $ref for branch_protection_rule types', async () => {
    const testSchema = {
      type: 'object',
      definitions: {
        eventObject: {
          oneOf: [{ type: 'object' }, { type: 'null' }],
          additionalProperties: true,
        },
        types: {
          oneOf: [{ type: 'array', minItems: 1 }, { type: 'string' }],
        },
      },
      properties: {
        on: {
          oneOf: [
            {
              properties: {
                branch_protection_rule: {
                  $ref: '#/definitions/eventObject',
                  properties: {
                    types: {
                      $ref: '#/definitions/types',
                      items: {
                        type: 'string',
                        enum: ['created', 'edited', 'deleted'],
                      },
                      default: ['created', 'edited', 'deleted'],
                    },
                  },
                },
              },
            },
          ],
        },
      },
    } as any;

    render(<GraphicalSchemaEditor schema={testSchema} onChange={() => {}} />);

    const onCombinerToggle = await screen.findByTitle(/(Expand|Collapse) variants/i);
    fireEvent.click(onCombinerToggle);

    const variantExpandToggle = screen.queryByTitle('Expand variant');
    if (variantExpandToggle) {
      fireEvent.click(variantExpandToggle);
    }

    const branchNode = await screen.findByText('branch_protection_rule');
    fireEvent.click(branchNode);

    const typesNode = await screen.findByText('types');
    fireEvent.click(typesNode);

    await waitFor(() => {
      expect(screen.getByLabelText('Type: array')).toBeChecked();
      expect(screen.getByText('created')).toBeInTheDocument();
      expect(screen.getByText('edited')).toBeInTheDocument();
      expect(screen.getByText('deleted')).toBeInTheDocument();
    });
  });

  it('can add a property via context menu and it appears in the schema', async () => {
    const testSchema = {
      type: 'object',
      properties: {}
    };
    let latestSchema = testSchema;
    const handleChange = (schema: any) => {
      latestSchema = schema;
    };
    render(<GraphicalSchemaEditor schema={testSchema} onChange={handleChange} />);

    // Right-click the root node to open context menu
    const rootNode = await screen.findByText('Root');
    fireEvent.contextMenu(rootNode);

    // Click "Add Property" in the context menu
    const addPropertyItem = await screen.findByText('Add Property');
    fireEvent.click(addPropertyItem);

    // The new property node should be selected and the name input focused
    const nameInput = await screen.findByLabelText('Name');
    fireEvent.change(nameInput, { target: { value: 'foo' } });
    fireEvent.blur(nameInput);

    // Wait for the schema to update with the new property
    await waitFor(() => {
      expect(Object.keys(latestSchema.properties)).toContain('foo');
    });
  });

  it('can add a pattern property via context menu and it appears in the schema', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        jobs: {
          type: 'object',
          properties: {}
        }
      }
    };
    let latestSchema = testSchema;
    const handleChange = (schema: any) => {
      latestSchema = schema;
    };
    render(<GraphicalSchemaEditor schema={testSchema} onChange={handleChange} />);

    // Right-click the 'jobs' node to open context menu
    const jobsNode = await screen.findByText('jobs');
    fireEvent.contextMenu(jobsNode);

    // Click "Add Pattern Property" in the context menu
    const addPatternItem = await screen.findByText('Add Pattern Property');
    fireEvent.click(addPatternItem);

    // The new pattern node should appear with a concise label 'pattern'
    const patternNodes = await screen.findAllByText((content) => typeof content === 'string' && content.trim().toLowerCase() === 'pattern');
    expect(patternNodes.length).toBeGreaterThan(0);
    // Choose the one that is part of the react-flow node display (if present)
    const patternNode = patternNodes.find(n => n.closest('[data-testid^="rf__node-"]')) || patternNodes[0];

    // Selecting the pattern node should show the Pattern Key editor
    fireEvent.click(patternNode);
    const patternKeyInput = await screen.findByLabelText('Pattern Key');
    expect(patternKeyInput).toBeInTheDocument();

    // Update the pattern key to trigger schema emission
    fireEvent.change(patternKeyInput, { target: { value: '^jobX_' } });
    fireEvent.blur(patternKeyInput);

    // And the emitted schema should include a patternProperties entry under jobs with the updated key
    await waitFor(() => {
      expect((latestSchema.properties.jobs as any).patternProperties).toBeDefined();
      expect(Object.keys((latestSchema.properties.jobs as any).patternProperties)).toContain('^jobX_');
    });
  });

  it('adds a property to a nested object path (deep object)', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        users: {
          type: 'object',
          properties: {
            profile: {
              type: 'object',
              properties: {
                address: {
                  type: 'object',
                  properties: {}
                }
              }
            }
          }
        }
      }
    };
    let latestSchema = testSchema;
    const handleChange = (schema: any) => {
      latestSchema = schema;
    };
    render(<GraphicalSchemaEditor schema={testSchema} onChange={handleChange} />);

    // Right-click the deep 'address' node to open context menu
    const addressNode = await screen.findByText('address');
    fireEvent.contextMenu(addressNode);

    // Click "Add Property"
    const addPropertyItem = await screen.findByText('Add Property');
    fireEvent.click(addPropertyItem);

    // The new property node should be selected and the name input focused
    const nameInput = await screen.findByLabelText('Name');
    fireEvent.change(nameInput, { target: { value: 'city' } });
    fireEvent.blur(nameInput);

    // Wait for the schema to update with the new nested property
    await waitFor(() => {
      const props = latestSchema?.properties?.users?.properties?.profile?.properties?.address?.properties || {};
      expect(Object.keys(props)).toContain('city');
    });
  });

  it('renames an existing generated property and updates the schema key', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        users: {
          type: 'object',
          properties: {
            profile: {
              type: 'object',
              properties: {
                address: {
                  type: 'object',
                  properties: {
                    newProperty1: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      }
    };
    let latestSchema = testSchema;
    const handleChange = (schema: any) => {
      latestSchema = schema;
    };
    render(<GraphicalSchemaEditor schema={testSchema} onChange={handleChange} />);

    // Select the node that currently has the generated name
    const generatedNode = await screen.findByText('newProperty1');
    fireEvent.click(generatedNode);

    // Rename it to 'city'
    const nameInput = await screen.findByLabelText('Name');
    fireEvent.change(nameInput, { target: { value: 'city' } });
    fireEvent.blur(nameInput);

    // Ensure the emitted schema reflects the renamed key
    await waitFor(() => {
      const props = latestSchema?.properties?.users?.properties?.profile?.properties?.address?.properties || {};
      expect(Object.keys(props)).toContain('city');
      expect(Object.keys(props)).not.toContain('newProperty1');
    });
  });

  it('renames an existing property and updates the schema key', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        person: {
          type: 'object',
          properties: {
            name: { type: 'string' }
          }
        }
      }
    };
    let latestSchema = testSchema;
    const handleChange = (schema: any) => {
      latestSchema = schema;
    };
    render(<GraphicalSchemaEditor schema={testSchema} onChange={handleChange} />);

    // Select the existing 'name' node and rename it to 'fullName'
    const nameNode = await screen.findByText('name');
    fireEvent.click(nameNode);

    const nameInput = await screen.findByLabelText('Name');
    fireEvent.change(nameInput, { target: { value: 'fullName' } });
    fireEvent.blur(nameInput);

    // Wait for the schema to reflect the renamed key
    await waitFor(() => {
      const props = latestSchema?.properties?.person?.properties || {};
      expect(Object.keys(props)).toContain('fullName');
      expect(Object.keys(props)).not.toContain('name');
    });
  });

  it('renaming an existing nested property updates the schema key', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        users: {
          type: 'object',
          properties: {
            profile: {
              type: 'object',
              properties: {
                address: {
                  type: 'object',
                  properties: {
                    street: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      }
    };
    let latestSchema = testSchema;
    const handleChange = (schema: any) => { latestSchema = schema; };
    render(<GraphicalSchemaEditor schema={testSchema} onChange={handleChange} />);

    // Open the existing 'street' node
    const streetNode = await screen.findByText('street');
    fireEvent.click(streetNode);

    // Rename to 'city'
    const nameInput = await screen.findByLabelText('Name');
    fireEvent.change(nameInput, { target: { value: 'city' } });
    fireEvent.blur(nameInput);

    // Wait for the schema to reflect the rename (no more 'street', now 'city')
    await waitFor(() => {
      const addrProps = latestSchema?.properties?.users?.properties?.profile?.properties?.address?.properties || {};
      expect(Object.keys(addrProps)).toContain('city');
      expect(Object.keys(addrProps)).not.toContain('street');
    });
  });

  it('focuses enum input after adding value with Enter, after toggling enum off and on', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['A', 'B']
          },
          id: 'tags-id'
        }
      }
    };
    render(<GraphicalSchemaEditor schema={testSchema} onChange={() => { }} />);

    // Select the node
    const tagsNode = await screen.findByText('tags');
    fireEvent.click(tagsNode);

    // Uncheck enum
    let checkbox = await screen.findByTestId('enum-checkbox');
    fireEvent.click(checkbox); // disables enum
    // Re-check enum
    checkbox = await screen.findByTestId('enum-checkbox');
    fireEvent.click(checkbox); // enables enum

    // Add a value with Enter
    const input = await screen.findByTestId('enum-input');
    fireEvent.change(input, { target: { value: 'C' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    // Wait for the new value to appear
    await screen.findByText('C');

    // The input should be focused again
    expect(document.activeElement).toBe(input);
  });

  it('can add an enum value via the full GraphicalSchemaEditor UI', async () => {
    // Start with a schema with one array property with enum
    const testSchema = {
      type: 'object',
      properties: {
        roles: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['A', 'B']
          }
        }
      }
    };
    let latestSchema = testSchema;
    const handleChange = (schema: any) => {
      latestSchema = schema;
    };
    render(<GraphicalSchemaEditor schema={testSchema} onChange={handleChange} />);

    // Find and click the node for 'roles' (should be a button or div with label 'roles')
    const rolesNode = await screen.findByText('roles');
    fireEvent.click(rolesNode);

    // The property editor should now be open for 'roles'. Find the enum input and add a value
    const input = await screen.findByTestId('enum-input');
    fireEvent.change(input, { target: { value: 'C' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    // Wait for the new value to appear in the UI
    await screen.findByText('C');

    // Wait for the schema to be updated with the new enum value
    await waitFor(() => {
      const enumArr = latestSchema.properties.roles.items.enum;
      expect(enumArr).toContain('C');
    });
  });

  it('persists enum value after closing and reopening the node editor', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        roles: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['A', 'B']
          }
        }
      }
    };
    let latestSchema = testSchema;
    const handleChange = (schema: any) => {
      latestSchema = schema;
    };
    let show = true;
    const { rerender } = render(
      show ? <GraphicalSchemaEditor schema={testSchema} onChange={handleChange} /> : null
    );

    // Open the roles node
    const rolesNode = await screen.findByText('roles');
    fireEvent.click(rolesNode);

    // Add a new enum value
    const input = await screen.findByTestId('enum-input');
    fireEvent.change(input, { target: { value: 'Y' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    // Wait for the enum value to appear in the UI
    await screen.findByText('Y');

    // Simulate closing the editor
    show = false;
    rerender(show ? <GraphicalSchemaEditor schema={latestSchema} onChange={handleChange} /> : null);

    // Simulate reopening the editor with the updated schema
    show = true;
    rerender(show ? <GraphicalSchemaEditor schema={latestSchema} onChange={handleChange} /> : null);

    // Reopen the roles node
    const rolesNode2 = await screen.findByText('roles');
    fireEvent.click(rolesNode2);

    // The new enum value should still be present
    expect(screen.getByText('Y')).toBeInTheDocument();
    // And in the schema
    expect(latestSchema.properties.roles.items.enum).toContain('Y');
  });

  it('keeps the property editor visible after adding enum with Enter', async () => {
    // Use a schema with an array property with enum
    const testSchema = {
      "type": "object",
      "properties": {
        "users": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "number",
                "id": "25"
              },
              "name": {
                "type": "string",
                "id": "26"
              },
              "email": {
                "type": "string",
                "id": "27"
              },
              "isActive": {
                "type": "boolean",
                "id": "28"
              },
              "roles": {
                "type": "array",
                "items": {
                  "type": "string",
                  "enum": [
                    "Admin",
                    "Worker",
                    "Customer"
                  ]
                },
                "id": "29"
              },
              "profile": {
                "type": "object",
                "properties": {
                  "age": {
                    "type": "number",
                    "id": "31"
                  },
                  "location": {
                    "type": "string",
                    "enum": [
                      "Sydney",
                      "London",
                      "New York",
                      "Remote",
                      "Perth"
                    ],
                    "id": "32"
                  },
                  "dietary": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "enum": [
                        "Vegetarian",
                        "Gluten Free",
                        "Nut Allergy",
                        "Lactose Intolerant"
                      ]
                    },
                    "id": "33"
                  }
                },
                "required": [
                  "age",
                  "location"
                ],
                "id": "30"
              }
            },
            "required": [
              "id",
              "name",
              "email",
              "isActive",
              "roles",
              "profile"
            ]
          },
          "id": "24"
        }
      },
      "id": "23"
    };
    render(<GraphicalSchemaEditor schema={testSchema} onChange={() => { }} />);

    // Find and click the node for 'dietary'
    const dietaryNode = await screen.findByText('dietary');
    fireEvent.click(dietaryNode);

    // The property editor should now be open for 'roles'. Find the enum input and add a value
    const input = await screen.findByTestId('enum-input');
    fireEvent.change(input, { target: { value: "Lactose Intolerant" } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await new Promise(res => setTimeout(res, 800));
    // The property editor (form) should still be visible
    expect(screen.getByText((content) => content.includes('Enum Values'))).toBeInTheDocument();
    // The new value should appear in the UI
    expect(screen.getByText('Lactose Intolerant')).toBeInTheDocument();
  });

  it('adds a new enum value to array items', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        roles: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['A', 'B']
          }
        }
      }
    };
    render(<GraphicalSchemaEditor schema={testSchema} onChange={() => { }} />);

    // Find and click the node for 'roles'
    const rolesNode = await screen.findByText('roles');
    fireEvent.click(rolesNode);

    // Find the enum input and add a new value
    const input = await screen.findByTestId('enum-input');
    fireEvent.change(input, { target: { value: 'C' } });
    const addButton = screen.getByTestId('add-enum-button');
    fireEvent.click(addButton);

    // The new value should appear in the UI
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('schema contains new enum value after a wait', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        roles: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['A', 'B']
          }
        }
      }
    };
    let latestSchema = testSchema;
    const handleChange = (schema: any) => {
      latestSchema = schema;
    };
    render(<GraphicalSchemaEditor schema={testSchema} onChange={handleChange} />);

    // Find and click the node for 'roles'
    const rolesNode = await screen.findByText('roles');
    fireEvent.click(rolesNode);

    // Add a new enum value
    const input = await screen.findByTestId('enum-input');
    fireEvent.change(input, { target: { value: 'Z' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    // Wait for the enum value to appear in the schema
    await screen.findByText('Z');
    await waitFor(() => {
      const enumArr = latestSchema.properties.roles.items.enum;
      expect(enumArr).toContain('Z');
    });
  });

  it('keeps the enum checkbox visible after clicking', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        dietary: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'Vegetarian',
              'Gluten Free',
              'Nut Allergy'
            ]
          },
          id: '33'
        }
      }
    };
    render(<GraphicalSchemaEditor schema={testSchema} onChange={() => { }} />);

    // Find and click the node for 'dietary'
    const dietaryNode = await screen.findByText('dietary');
    fireEvent.click(dietaryNode);

    // Find the enum checkbox
    let checkbox = await screen.findByTestId('enum-checkbox');
    fireEvent.click(checkbox);

    // The checkbox should still be visible
    expect(screen.getByTestId('enum-checkbox')).toBeInTheDocument();

    checkbox = await screen.findByTestId('enum-checkbox');
    fireEvent.click(checkbox);
    expect(screen.getByTestId('enum-values-label')).toBeInTheDocument();
  });

  it('shows description and $comment tooltips on nodes', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        bio: { type: 'string', description: 'Author biography' },
        note: { type: 'string', $comment: 'Internal note for editors' }
      }
    };
    render(
      <TooltipProvider delayDuration={0}>
        <GraphicalSchemaEditor schema={testSchema} onChange={() => { }} />
      </TooltipProvider>
    );

    // The nodes should be present
    const bioNode = await screen.findByText('bio');
    expect(bioNode).toBeInTheDocument();
    const noteNode = await screen.findByText('note');
    expect(noteNode).toBeInTheDocument();

    // There should be a description icon and a separate comment icon accessible by aria-label
    const descTrigger = await screen.findByLabelText('Node description');
    fireEvent.mouseEnter(descTrigger);
    fireEvent.focus(descTrigger);
    // Tooltip content should appear
    const descContent = await screen.findAllByText('Author biography');
    expect(descContent.length).toBeGreaterThan(0);

    const commentTrigger = await screen.findByLabelText('Node comment');
    fireEvent.mouseEnter(commentTrigger);
    fireEvent.focus(commentTrigger);
    const commentContent = await screen.findAllByText('Internal note for editors');
    expect(commentContent.length).toBeGreaterThan(0);
  });

  it('renders $comment URL as link in tooltip', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        note: { type: 'string', $comment: 'https://example.com/foo' }
      }
    };
    render(
      <TooltipProvider delayDuration={0}>
        <GraphicalSchemaEditor schema={testSchema} onChange={() => { }} />
      </TooltipProvider>
    );

    await screen.findByText('note');
    const commentTrigger = await screen.findByLabelText('Node comment');
    fireEvent.mouseEnter(commentTrigger);
    fireEvent.focus(commentTrigger);

    // Tooltip content should render a link
    // Find the URL text inside the tooltip and assert at least one visible tooltip instance is a link
    const matches = await screen.findAllByText('https://example.com/foo');
    const visible = matches.find(el => Boolean(el.closest('[data-state="instant-open"]') || el.parentElement?.getAttribute('data-state') === 'instant-open'));
    expect(visible).toBeTruthy();
    const anchor = visible!.closest('a');
    expect(anchor).toBeTruthy();
    expect(anchor).toHaveAttribute('href', 'https://example.com/foo');
    expect(anchor).toHaveAttribute('target', '_blank');
    expect(String(anchor!.getAttribute('rel'))).toMatch(/noreferrer/);
  });

  it('root node editor restricts type choices to object/array and hides enum/default and shows description/$comment', async () => {
    const testSchema = { type: 'object', properties: {}, description: 'Root desc', $comment: 'Root note' };
    const onChange = jest.fn();
    render(<GraphicalSchemaEditor schema={testSchema} onChange={onChange} />);

    const rootNode = await screen.findByText('Root');
    fireEvent.click(rootNode);

    // Types control should only include object and array for root
    expect(screen.queryByLabelText('Type: string')).toBeNull();
    expect(screen.queryByLabelText('Type: number')).toBeNull();
    expect(screen.getByLabelText('Type: object')).toBeInTheDocument();
    expect(screen.getByLabelText('Type: array')).toBeInTheDocument();

    // Enum checkbox and Default input should not be visible for root
    expect(screen.queryByTestId('enum-checkbox')).toBeNull();
    expect(screen.queryByLabelText('Default value')).toBeNull();

    // Description and $comment fields should be present and prefilled
    const desc = await screen.findByLabelText('Description');
    expect((desc as HTMLTextAreaElement).value).toBe('Root desc');
    const comment = await screen.findByLabelText('Comment ($comment)');
    expect((comment as HTMLInputElement).value).toBe('Root note');

    // Editing description should call onChange with updated schema
    fireEvent.change(desc, { target: { value: 'New root description' } });
    fireEvent.blur(desc);
    expect(onChange).toHaveBeenCalled();
    const nextSchema = onChange.mock.calls[0][0];
    expect(nextSchema.description).toBe('New root description');

    // Editing $comment should call onChange with updated schema
    fireEvent.change(comment, { target: { value: 'Updated note' } });
    fireEvent.blur(comment);
    expect(onChange).toHaveBeenCalledTimes(2);
    const nextSchema2 = onChange.mock.calls[1][0];
    expect(nextSchema2.$comment).toBe('Updated note');
  });

  it('object node editor hides enum/default', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        obj: {
          type: 'object',
          properties: {}
        }
      }
    };
    render(<GraphicalSchemaEditor schema={testSchema} onChange={() => { }} />);

    const objNode = await screen.findByText('obj');
    fireEvent.click(objNode);

    expect(screen.queryByTestId('enum-checkbox')).toBeNull();
    expect(screen.queryByLabelText('Default value')).toBeNull();
  });

  it('non-object node editor shows description and $comment and emits changes', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'Note desc', $comment: 'Note comment' }
      }
    };
    const onChange = jest.fn();
    render(<GraphicalSchemaEditor schema={testSchema} onChange={onChange} />);

    const noteNode = await screen.findByText('note');
    fireEvent.click(noteNode);

    const desc = await screen.findByLabelText('Description');
    expect((desc as HTMLTextAreaElement).value).toBe('Note desc');

    const comment = await screen.findByLabelText('Comment ($comment)');
    expect((comment as HTMLInputElement).value).toBe('Note comment');

    // Edit description and assert onChange emitted updated schema
    fireEvent.change(desc, { target: { value: 'Updated note desc' } });
    fireEvent.blur(desc);
    expect(onChange).toHaveBeenCalled();
    const nextSchema = onChange.mock.calls[0][0];
    expect((nextSchema.properties.note as any).description).toBe('Updated note desc');

    // Edit $comment and assert emission
    fireEvent.change(comment, { target: { value: 'Edited comment' } });
    fireEvent.blur(comment);
    expect(onChange).toHaveBeenCalledTimes(2);
    const nextSchema2 = onChange.mock.calls[1][0];
    expect((nextSchema2.properties.note as any)['$comment']).toBe('Edited comment');
  });

  it('multi-type editor shows union types and emits array type changes', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        cond: { type: ['boolean', 'number', 'string'] }
      }
    };
    const onChange = jest.fn();
    render(<GraphicalSchemaEditor schema={testSchema} onChange={onChange} />);

    const condNode = await screen.findByText('cond');
    fireEvent.click(condNode);

    const boolCheckbox = await screen.findByLabelText('Type: boolean');
    const numCheckbox = await screen.findByLabelText('Type: number');
    const strCheckbox = await screen.findByLabelText('Type: string');
    expect(boolCheckbox).toBeChecked();
    expect(numCheckbox).toBeChecked();
    expect(strCheckbox).toBeChecked();

    // Uncheck 'number'
    fireEvent.click(numCheckbox);
    expect(onChange).toHaveBeenCalled();
    const nextSchema = onChange.mock.calls[0][0];
    expect(Array.isArray((nextSchema.properties.cond as any).type)).toBeTruthy();
    expect((nextSchema.properties.cond as any).type).toEqual(expect.arrayContaining(['boolean', 'string']));
    expect((nextSchema.properties.cond as any).type).not.toContain('number');
  });

  it('does not render min/max pills on node', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        count: { type: 'number', minimum: 1, maximum: 5 }
      }
    };
    render(<GraphicalSchemaEditor schema={testSchema} onChange={() => { }} />);

    const countNode = await screen.findByText('count');
    const countContainer = countNode.closest('[data-testid^="rf__node-"]') as HTMLElement;
    expect(within(countContainer).queryByLabelText('Badge minimum')).toBeNull();
    expect(within(countContainer).queryByLabelText('Badge maximum')).toBeNull();
  });

  it('renders format and imported badges', async () => {
    const testSchema = {
      type: 'object',
      definitions: {
        refd: { type: 'string' }
      },
      properties: {
        remote: { allOf: [{ $ref: '#/definitions/refd' }], format: 'date-time' }
      }
    };
    render(<GraphicalSchemaEditor schema={testSchema} onChange={() => { }} />);

    const remoteNode = await screen.findByText('remote');
    const remoteContainer = remoteNode.closest('[data-testid^="rf__node-"]') as HTMLElement;
    // Assert format badge + imported indicator icon
    expect(within(remoteContainer).getByLabelText('Badge format')).toBeInTheDocument();
    const importedIcon = remoteContainer.querySelector('svg.lucide-link-2');
    expect(importedIcon).toBeTruthy();
  });

  it('supports editing union types (type: [..]) via the Types control', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        if: { type: ['boolean', 'number', 'string'] }
      }
    };
    const onChange = jest.fn();
    render(<GraphicalSchemaEditor schema={testSchema} onChange={onChange} />);

    const ifNode = await screen.findByText('if');
    fireEvent.click(ifNode);

    // The Types control should show checkboxes for boolean, number, string
    const boolCheckbox = await screen.findByLabelText('Type: boolean') as HTMLInputElement;
    const numCheckbox = await screen.findByLabelText('Type: number') as HTMLInputElement;
    const strCheckbox = await screen.findByLabelText('Type: string') as HTMLInputElement;

    expect(boolCheckbox.checked).toBe(true);
    expect(numCheckbox.checked).toBe(true);
    expect(strCheckbox.checked).toBe(true);

    // Uncheck number and ensure an onChange is emitted with the updated type array
    fireEvent.click(numCheckbox);
    expect(onChange).toHaveBeenCalled();
    const emitted = onChange.mock.calls[0][0];
    expect((emitted.properties.if as any).type).toEqual(expect.arrayContaining(['boolean','string']));
    expect((emitted.properties.if as any).type).not.toContain('number');
  });

  it('renders child nodes when property type is an array including object', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        maybe: {
          type: ['object', 'null'],
          properties: {
            child: { type: 'string' }
          }
        }
      }
    };
    render(<GraphicalSchemaEditor schema={testSchema} onChange={() => { }} />);

    // Child node should be rendered under the 'maybe' node
    expect(await screen.findByText('child')).toBeInTheDocument();
  });

  it('renders child nodes when type omitted but properties present', async () => {
    const testSchema = {
      type: 'object',
      properties: {
        anon: {
          properties: {
            inner: { type: 'number' }
          }
        }
      }
    };
    render(<GraphicalSchemaEditor schema={testSchema} onChange={() => { }} />);

    expect(await screen.findByText('inner')).toBeInTheDocument();
  });

  it('hydrates $ref variant nodes under the correct parent rank', async () => {
    const testSchema = {
      type: 'object',
      definitions: {
        permissionEvent: {
          type: 'object',
          properties: {
            permissions: {
              type: 'object',
              properties: {
                read: { type: 'boolean' },
                write: { type: 'boolean' }
              }
            }
          }
        }
      },
      properties: {
        event: {
          oneOf: [
            { $ref: '#/definitions/permissionEvent' }
          ]
        }
      }
    } as any;

    render(<GraphicalSchemaEditor schema={testSchema} onChange={() => { }} />);

    const combinerToggle = await screen.findByTitle('Expand variants');
    fireEvent.click(combinerToggle);

    const variantToggle = await screen.findByTitle('Expand variant');
    fireEvent.click(variantToggle);

    await screen.findByText('permissions');
    await screen.findByText('read');
    await screen.findByText('write');

    const variantId = '1.event.__combiner.v0';
    const permissionsId = `${variantId}.__1.permissions`;
    const readId = `${permissionsId}.read`;
    const writeId = `${permissionsId}.write`;

    // Hydrated nodes should exist under deterministic hydrated IDs
    const variantNode = document.querySelector(`[data-testid="rf__node-${variantId}"]`) as HTMLElement | null;
    const permissionsNode = document.querySelector(`[data-testid="rf__node-${permissionsId}"]`) as HTMLElement | null;
    const readNode = document.querySelector(`[data-testid="rf__node-${readId}"]`) as HTMLElement | null;
    const writeNode = document.querySelector(`[data-testid="rf__node-${writeId}"]`) as HTMLElement | null;

    expect(variantNode).toBeTruthy();
    expect(permissionsNode).toBeTruthy();
    expect(readNode).toBeTruthy();
    expect(writeNode).toBeTruthy();

    const getTranslateX = (el: HTMLElement) => {
      const transform = el.style.transform || '';
      const match = transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
      return match ? Number(match[1]) : Number.NaN;
    };

    const variantX = getTranslateX(variantNode!);
    const permissionsX = getTranslateX(permissionsNode!);
    const readX = getTranslateX(readNode!);
    const writeX = getTranslateX(writeNode!);

    expect(Number.isNaN(variantX)).toBe(false);
    expect(Number.isNaN(permissionsX)).toBe(false);
    expect(Number.isNaN(readX)).toBe(false);
    expect(Number.isNaN(writeX)).toBe(false);

    // Parent rank ordering: variant -> permissions -> leaf properties
    expect(permissionsX).toBeGreaterThan(variantX);
    expect(readX).toBeGreaterThan(permissionsX);
    expect(writeX).toBeGreaterThan(permissionsX);
  });

  it('loads a reduced Schemastore GitHub workflow fixture and maps object children/patternProperties', async () => {
    // Use a reduced fixture resembling https://www.schemastore.org/github-workflow.json
    const fixture = schemastoreWorkflow;
    render(<GraphicalSchemaEditor schema={fixture as any} onChange={() => { }} />);

    // Top-level 'jobs' should exist
    const jobsNode = await screen.findByText('jobs');
    expect(jobsNode).toBeInTheDocument();

    // Pattern node for job keys should be present (rendered with concise 'pattern' label)
    const patternNodes = await screen.findAllByText((c) => typeof c === 'string' && c.trim().toLowerCase() === 'pattern');
    expect(patternNodes.length).toBeGreaterThan(0);
    const patternNode = patternNodes.find(n => n.closest('[data-testid^="rf__node-"]')) || patternNodes[0];
    expect(patternNode).toBeInTheDocument();

    // Variants/combiners are icon-first now; assert at least one combiner icon trigger exists.
    const combinerIconTriggers = await screen.findAllByTitle(/(oneOf|anyOf|allOf) —/i);
    expect(combinerIconTriggers.length).toBeGreaterThan(0);

    // Also check defaults -> run -> shell
    const defaultsNodes = await screen.findAllByText('defaults');
    expect(defaultsNodes.length).toBeGreaterThan(0);
    const runMatches  = await screen.findAllByText('run');
    expect(runMatches.length).toBeGreaterThan(0);
    // Full Schemastore workflow uses 'shell' and 'working-directory' under defaults.run
    const shellMatches = await screen.findAllByText('shell');
    expect(shellMatches.length).toBeGreaterThan(0);

    // Ensure the jobs patternProperties key appears: check node id/testid includes the regex and confirm via RHS editor when possible
    const desiredRegex = '^[_a-zA-Z][a-zA-Z0-9_-]*$';
    // First, assert there's a node element under jobs whose id starts with the deterministic prefix for pattern nodes (ids are deterministic)
    const hasJobsPatternNode = !!document.querySelector('[data-testid*="rf__node-1.jobs.pattern"]');
    expect(hasJobsPatternNode).toBe(true);

    // Also try the Pattern Key editor approach and assert exact regex equality
    const allPatternNodes = await screen.findAllByText((c) => typeof c === 'string' && c.trim().toLowerCase() === 'pattern');
    expect(allPatternNodes.length).toBeGreaterThan(0);
    let foundPatternExact = false;
    for (const pnode of allPatternNodes) {
      fireEvent.click(pnode);
      const patternInput = await screen.findByLabelText('Pattern Key');
      const val = (patternInput as HTMLInputElement).value || '';
      // Now require exact match of the original regex
      if (val === desiredRegex) { foundPatternExact = true; break; }
    }
    expect(foundPatternExact).toBe(true);

    // Combiner behavior is represented by icon+toggle controls.
    const combinerToggles = await screen.findAllByTitle(/(Expand|Collapse) variants/i);
    expect(combinerToggles.length).toBeGreaterThan(0);
  });

  it('shows jobs minProperties and exposes maxProperties facet action when selecting jobs node', async () => {
    render(<GraphicalSchemaEditor schema={schemastoreWorkflow as any} onChange={() => { }} />);

    const jobsNode = document.querySelector('[data-testid="rf__node-1.jobs"]') as HTMLElement | null;
    expect(jobsNode).toBeTruthy();
    // Keep this to ensure the label exists while selecting by deterministic node id
    await screen.findByText('jobs');
    fireEvent.click(jobsNode!);

    const minPropsInput = await screen.findByLabelText('Min Properties');
    const maxPropsAction = await screen.findByRole('button', { name: '+ Max Properties' });

    expect((minPropsInput as HTMLInputElement).value).toBe('1');
    expect(maxPropsAction).toBeInTheDocument();
  });
});

describe('GraphicalSchemaEditor - circular $ref handling', () => {
  it('stops expanding a self-referential $ref after one level and shows an isRef badge', async () => {
    const testSchema = {
      type: 'object',
      definitions: {
        node: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            child: { $ref: '#/definitions/node' },
          },
        },
      },
      properties: {
        root: { $ref: '#/definitions/node' },
      },
    } as any;

    render(<GraphicalSchemaEditor schema={testSchema} onChange={() => {}} />);

    // First level expands normally: root -> name, child
    await screen.findByText('root');
    await screen.findByText('name');
    const childNode = await screen.findByText('child');

    // The circular re-encounter of the same $ref is stopped and flagged with a Ref badge
    expect(await screen.findByText('Ref')).toBeInTheDocument();

    // The stopped node must not itself expand into another nested "name"/"child" pair
    expect(screen.getAllByText('name')).toHaveLength(1);
    expect(screen.getAllByText('child')).toHaveLength(1);
    expect(childNode).toBeInTheDocument();
  });

  it('does not infinitely recurse for mutually-referential definitions', async () => {
    const testSchema = {
      type: 'object',
      definitions: {
        a: { type: 'object', properties: { b: { $ref: '#/definitions/b' } } },
        b: { type: 'object', properties: { a: { $ref: '#/definitions/a' } } },
      },
      properties: {
        start: { $ref: '#/definitions/a' },
      },
    } as any;

    render(<GraphicalSchemaEditor schema={testSchema} onChange={() => {}} />);

    await screen.findByText('start');
    await screen.findByText('b');
    await screen.findByText('a');
    expect(await screen.findByText('Ref')).toBeInTheDocument();
  });
});
