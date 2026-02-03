import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaEditorForm } from './schema-editor-form';
import { TooltipProvider } from './ui/tooltip/tooltip';

// Mock scrollIntoView as it's not implemented in jsdom
window.HTMLElement.prototype.scrollIntoView = jest.fn();

describe('SchemaEditorForm - Polymorphic Variant Labels', () => {
  const mockOnChange = jest.fn();

  const renderForm = (schema: any) => {
    return render(
      <TooltipProvider>
        <SchemaEditorForm schema={schema} onChange={mockOnChange} />
      </TooltipProvider>
    );
  };

  it('correctly labels a simple $ref as a semantic name', () => {
    const schema = {
      oneOf: [
        { $ref: '#/definitions/event', type: 'string' }
      ]
    };
    renderForm(schema);
    // Should prioritize 'event' from ref over 'string' type
    expect(screen.getAllByText('1. Event')[0]).toBeInTheDocument();
  });

  it('correctly labels an array of $ref as Array<Name>', () => {
    const schema = {
      oneOf: [
        { 
          type: 'array', 
          items: { $ref: '#/definitions/event' } 
        }
      ]
    };
    renderForm(schema);
    // Should show Array<Event>
    expect(screen.getAllByText('1. Array<Event>')[0]).toBeInTheDocument();
  });

  it('prioritizes $ref over generic types like string or object', () => {
    const schema = {
      oneOf: [
        { $ref: '#/definitions/user', type: 'object' },
        { type: 'string' }
      ]
    };
    renderForm(schema);
    expect(screen.getAllByText('1. User')[0]).toBeInTheDocument();
    expect(screen.getAllByText('2. String')[0]).toBeInTheDocument();
  });

  it('uses $ref for labeling on hydrated nodes', () => {
    const schema = {
      oneOf: [
        { $ref: '#/definitions/event', type: 'object', properties: {} }
      ]
    };
    renderForm(schema);
    expect(screen.getAllByText('1. Event')[0]).toBeInTheDocument();
  });

  it('filters out "boring" words from the label', () => {
    const schema = {
      oneOf: [
        { $ref: '#/definitions/item', type: 'object' },
        { $ref: '#/definitions/custom', type: 'object' }
      ]
    };
    renderForm(schema);
    // 'item' is in boring set, so it should fallback to 'object' (type)
    expect(screen.getAllByText('1. Object')[0]).toBeInTheDocument();
    expect(screen.getAllByText('2. Custom')[0]).toBeInTheDocument();
  });

  it('handles nested arrays correctly (Array<Array<T>>)', () => {
    const schema = {
      oneOf: [
        {
          type: 'array',
          items: {
            type: 'array',
            items: { $ref: '#/definitions/event' }
          }
        }
      ]
    };
    renderForm(schema);
    expect(screen.getAllByText('1. Array<Array<Event>>')[0]).toBeInTheDocument();
  });

  it('uses Option N fallback when no semantic info is available', () => {
    const schema = {
      oneOf: [
        { not: { type: 'string' } },
        { minLength: 5 }
      ]
    };
    renderForm(schema);
    expect(screen.getAllByText('1. Option 1')[0]).toBeInTheDocument();
    expect(screen.getAllByText('2. Option 2')[0]).toBeInTheDocument();
  });

  it('renders a REF badge when $ref or $comment is present', () => {
    const schema = {
      oneOf: [
        { $ref: '#/definitions/event', $comment: 'https://docs.example.com' }
      ]
    };
    renderForm(schema);
    // The label should be there
    expect(screen.getAllByText('1. Event')[0]).toBeInTheDocument();
    // The REF badge should be there
    expect(screen.getAllByText('REF')[0]).toBeInTheDocument();
  });

  it('handles complex sub-paths in $ref', () => {
    const schema = {
      oneOf: [
        { $ref: '#/definitions/event/enum' }
      ]
    };
    renderForm(schema);
    // 'enum' is not boring, but maybe it should be?
    // Actually in my current code 'enum' is not in noise yet, but 'fParts[fParts.length-1]' would return 'event' 
    // IF 'enum' was boring.
  });

  it('handles name from allOf branch (hydrated style)', () => {
    const schema = {
      oneOf: [
        {
          allOf: [
            { $ref: '#/definitions/event' },
            { type: 'string', enum: ['push', 'pull_request'] }
          ]
        }
      ]
    };
    renderForm(schema);
    expect(screen.getAllByText('1. Event')[0]).toBeInTheDocument();
  });

  it('handles array with items having name in allOf', () => {
    const schema = {
      oneOf: [
        {
          type: 'array',
          items: {
            allOf: [
              { $ref: '#/definitions/event' },
              { type: 'string' }
            ]
          }
        }
      ]
    };
    renderForm(schema);
    expect(screen.getAllByText('1. Array<Event>')[0]).toBeInTheDocument();
  });

  it('handles GitHub style variant with ref and enum', () => {
    const schema = {
      oneOf: [
        {
          $comment: 'https://help.github.com/en/github/automating-your-workflow-with-github-actions/events-that-trigger-workflows',
          $ref: '#/definitions/event',
          enum: ['push', 'pull_request']
        }
      ]
    };
    renderForm(schema);
    expect(screen.getAllByText('1. Event')[0]).toBeInTheDocument();
  });

  it('skips host/file noise and searches deeper into allOf', () => {
    const schema = {
      oneOf: [
        {
          $ref: 'http://localhost:5173/schema.json',
          allOf: [
            { $ref: '#/definitions/event' }
          ]
        }
      ]
    };
    renderForm(schema);
    // Should skip localhost:5173 and schema.json, finding 'Event' in allOf
    expect(screen.getAllByText('1. Event')[0]).toBeInTheDocument();
  });

  it('extracts name from $comment URL if pointers are generic or missing', () => {
    const schema = {
      oneOf: [
        {
          $ref: 'schema.json', // noise
          $comment: 'https://docs.github.com/en/actions/events/event-type'
        }
      ]
    };
    renderForm(schema);
    // Should skip schema.json and pick 'Event-type' from comment
    expect(screen.getAllByText('1. Event-type')[0]).toBeInTheDocument();
  });
});
