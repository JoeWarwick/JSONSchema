import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GraphicalSchemaEditor } from './graphical-schema-editor';
import { waitFor } from '@testing-library/react';

describe('GraphicalSchemaEditor - Enum Editing', () => {

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
});
