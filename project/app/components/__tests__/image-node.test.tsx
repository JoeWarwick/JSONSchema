import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { schemaNodeDataToSchema } from '../schema-behaviors';
import { SchemaEditorForm } from '../schema-editor-form';

describe('Image node support', () => {
  test('serializes internal `image` node to string + media annotations', () => {
    const node: any = {
      id: 'img1',
      label: 'Picture',
      type: 'image',
      contentMediaType: 'image/png',
    };

    const schema = schemaNodeDataToSchema(node);
    expect(schema.type).toBe('string');
    expect(schema.format).toBe('data-url');
    expect(schema.contentMediaType).toBe('image/png');
  });

  test('SchemaEditorForm accepts image file and emits data-url default', async () => {
    const onChange = jest.fn();
    const initialSchema = { type: 'string', format: 'data-url', contentMediaType: 'image/*' };

    // Mock FileReader to synchronously call onload with a data URL
    const realFileReader = (global as any).FileReader;
    class MockFileReader {
      onload: ((ev: any) => void) | null = null;
      result: string | null = null;
      readAsDataURL(_file: File) {
        // produce a fake data url
        this.result = 'data:image/png;base64,FAKE';
        if (this.onload) {
          this.onload({ target: { result: this.result } });
        }
      }
    }
    (global as any).FileReader = MockFileReader;

    const { container } = render(<SchemaEditorForm schema={initialSchema as any} onChange={onChange} />);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).toBeTruthy();

    // Create a fake File and fire change
    const file = new File(['x'], 'test.png', { type: 'image/png' });
    fireEvent.change(fileInput as Element, { target: { files: [file] } });

    await waitFor(() => expect(onChange).toHaveBeenCalled());

    // The handler should receive a schema object with a data-url default
    const calledWith = onChange.mock.calls[0][0];
    expect(calledWith).toHaveProperty('default');
    expect(typeof calledWith.default).toBe('string');
    expect((calledWith.default as string).startsWith('data:image')).toBe(true);

    // restore FileReader
    (global as any).FileReader = realFileReader;
  });
});
