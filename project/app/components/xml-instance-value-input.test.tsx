import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderSimpleValueInput } from './xml-instance-value-input';

describe('renderSimpleValueInput schema widgets', () => {
  it('uses the HTML editor for HTML fields', () => {
    render(renderSimpleValueInput('html', 'text', '<p>Copy</p>', jest.fn()));

    expect(screen.getByRole('textbox', { name: 'HTML content' })).toHaveAttribute(
      'aria-placeholder',
      '<!-- Enter HTML here -->',
    );
  });

  it('edits HTML in the WYSIWYG surface and emits controlled content immediately', async () => {
    const onChange = jest.fn();
    const { rerender } = render(renderSimpleValueInput('html', 'text', '<p>Copy</p>', onChange));
    const editor = screen.getByRole('textbox', { name: 'HTML content' });

    await waitFor(() => expect(editor).toHaveTextContent('Copy'));
    editor.innerHTML = '<p>Updated</p>';
    fireEvent.input(editor);

    expect(onChange).toHaveBeenLastCalledWith('<p>Updated</p>');
    rerender(renderSimpleValueInput('html', 'text', '', onChange));
    await waitFor(() => expect(editor).toBeEmptyDOMElement());
  });

  it('uses a URL input for annotated URL fields', () => {
    render(renderSimpleValueInput('url', 'text', 'https://example.test', jest.fn()));

    expect(screen.getByDisplayValue('https://example.test')).toHaveAttribute('type', 'url');
  });

  it('validates URL widget values against the HTTP(S) pattern', () => {
    const onChange = jest.fn();
    render(renderSimpleValueInput('url', 'text', 'not a URL', onChange));
    const input = screen.getByDisplayValue('not a URL');

    expect(input).toHaveAttribute('pattern', 'https?://[^\\s]+');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('valid HTTP or HTTPS URL');

    fireEvent.change(input, { target: { value: 'https://example.test/page' } });
    expect(onChange).toHaveBeenCalledWith('https://example.test/page');
  });

  it('accepts supported image files as data URLs', async () => {
    const onChange = jest.fn();
    render(renderSimpleValueInput('image', 'text', '', onChange));
    const file = new File([new Uint8Array([1, 2, 3])], 'cover.png', { type: 'image/png' });

    fireEvent.change(screen.getByLabelText('Upload image'), {
      target: { files: [file] },
    });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png;base64,/)));
  });
});
