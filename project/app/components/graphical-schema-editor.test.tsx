import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NodePropertyEditor } from './graphical-schema-editor';

// Mock minimal props and schema for the editor
const initialSchema = {
  type: 'array',
  items: {
    type: 'string',
    enum: ['A', 'B']
  }
};

describe('GraphicalSchemaEditor - Enum Editing', () => {
    it('keeps the property editor visible after adding enum with Enter', () => {
      const TestWrapper = () => {
        const [node, setNode] = React.useState({
          id: '1',
          position: { x: 0, y: 0 },
          data: {
            label: 'Root',
            type: 'array',
            ofType: 'string',
            enum: ['A', 'B'],
            items: { type: 'string', enum: ['A', 'B'] }
          }
        });
        const handleChange = (patch: any) => {
          setNode(prev => ({ ...prev, data: { ...prev.data, ...patch } }));
        };
        return <NodePropertyEditor node={node} onChange={handleChange} />;
      };

      render(<TestWrapper />);

      const input = screen.getByTestId('enum-input');
      fireEvent.change(input, { target: { value: 'D' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      // The property editor (form) should still be visible
      expect(screen.getByText('Enum Values')).toBeInTheDocument();
      // The new value should appear in the UI
      expect(screen.getByText('D')).toBeInTheDocument();
    });
  it('adds a new enum value to array items', () => {
    // Mock a node prop for NodePropertyEditor
    // Use React state to force re-render on node change
    const TestWrapper = () => {
      const [node, setNode] = React.useState({
        id: '1',
        position: { x: 0, y: 0 },
        data: {
          label: 'Root',
          type: 'array',
          ofType: 'string',
          enum: ['A', 'B'],
          items: { type: 'string', enum: ['A', 'B'] }
        }
      });
      const handleChange = (patch: any) => {
        setNode(prev => ({ ...prev, data: { ...prev.data, ...patch } }));
      };
      return <NodePropertyEditor node={node} onChange={handleChange} />;
    };

    render(<TestWrapper />);

    // Enum checkbox should be checked by default
    // Find the enum input and add a new value
    const input = screen.getByTestId('enum-input');
    fireEvent.change(input, { target: { value: 'C' } });
    const addButton = screen.getByTestId('add-enum-button');
    fireEvent.click(addButton);

    // The new value should appear in the UI
    expect(screen.getByText('C')).toBeInTheDocument();
  });
});
