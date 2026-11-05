import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { XmlCompositorEditor } from './xml-compositor-editor';
import { XmlNodeRhsEditor } from './xml-instance-rhs-editors';
import type { XmlNodeRhsEditorProps } from './types';

describe.each([
  ['graph', XmlCompositorEditor],
  ['form', XmlNodeRhsEditor],
] as const)('%s particle editor', (_surface, Editor) => {
  test.each(['sequence', 'choice', 'all'])('%s occurrence fields share a row and retain edits', kind => {
    const node: NonNullable<XmlNodeRhsEditorProps['node']> = {
      id: kind,
      position: { x: 0, y: 0 },
      data: { xmlNodeKind: kind, xmlMinOccurs: '0', xmlMaxOccurs: 'unbounded' },
    };
    const onChange = jest.fn();
    render(<Editor node={node} onChange={onChange} />);
    const min = screen.getByRole('textbox', { name: 'minOccurs' });
    const max = screen.getByRole('textbox', { name: 'maxOccurs' });
    const row = min.parentElement!.parentElement!;
    expect(max.parentElement!.parentElement).toBe(row);
    expect(row).toHaveAttribute('data-field-group', 'occurrence');
    expect(min).toHaveValue('0');
    expect(max).toHaveValue('unbounded');
    fireEvent.change(min, { target: { value: '1' } });
    fireEvent.blur(min);
    expect(onChange).toHaveBeenLastCalledWith({ id: kind, xmlMinOccurs: '1' });
    fireEvent.change(max, { target: { value: '5' } });
    fireEvent.blur(max);
    expect(onChange).toHaveBeenLastCalledWith({ id: kind, xmlMaxOccurs: '5' });
  });
});
