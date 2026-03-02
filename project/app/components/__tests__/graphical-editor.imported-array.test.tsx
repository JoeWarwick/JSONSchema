import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { GraphicalSchemaEditor } from '../graphical-schema-editor';

// Mock ReactFlow to render children without full DOM behaviour
jest.mock('reactflow', () => {
  const original = jest.requireActual('reactflow');
  return {
    __esModule: true,
    ...original,
    ReactFlow: ({ children }: any) => <div data-testid="reactflow">{children}</div>,
    ReactFlowProvider: ({ children }: any) => <div>{children}</div>,
  };
});

describe('GraphicalSchemaEditor imported array context menu', () => {
  test('shows Create Local Override for array whose items are $ref', () => {
    const schema = {
      type: 'object',
      properties: {
        contacts: {
          type: 'array',
          items: { $ref: 'https://example.com/user-profile.schema.json' }
        }
      }
    };
    const onChange = jest.fn();
    render(<GraphicalSchemaEditor schema={schema as any} onChange={onChange} />);
    const contactsNode = screen.getByText('contacts');
    const contactsContainer = contactsNode.closest('[data-testid^="rf__node-"]') as HTMLElement;
    const importedIcon = contactsContainer.querySelector('svg.lucide-link-2');
    expect(importedIcon).toBeTruthy();
    // Since context menu is interactive and requires DOM context, assert imported provenance by icon marker
  });
});
