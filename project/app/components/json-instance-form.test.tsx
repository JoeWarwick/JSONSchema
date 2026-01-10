import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { JsonInstanceForm } from './json-instance-form';

describe('JsonInstanceForm extras', () => {
  test('auto-deduplicates unique primitive arrays on blur', () => {
    const schema = { type: 'array', items: { type: 'string' }, uniqueItems: true } as any;
    const onChange = jest.fn();
    const { container } = render(<JsonInstanceForm schema={schema} value={['a','b','a']} onChange={onChange} />);
    // find all text inputs
    const inputs = container.querySelectorAll('input[type="text"], input[type="email"], input[type="url"], input[type="datetime-local"], input[type="date"]');
    expect(inputs.length).toBeGreaterThanOrEqual(3);
    const last = inputs[inputs.length - 1];
    // blur the last input to trigger dedupe
    fireEvent.blur(last);
    // onChange should have been called with deduped array ['a','b']
    expect(onChange).toHaveBeenCalled();
    const calledWith = onChange.mock.calls.find(call => Array.isArray(call[0]));
    expect(calledWith[0]).toEqual(['a','b']);
  });

  test('renders const value readonly and sets parent value', () => {
    jest.useFakeTimers();
    const schema = { type: 'string', const: 'fixed' } as any;
    const onChange = jest.fn();
    render(<JsonInstanceForm schema={schema} value={undefined} onChange={onChange} />);
    // const display should be present
    expect(screen.getByText('fixed')).toBeTruthy();
    // advance timers to allow setTimeout propagation
    jest.runOnlyPendingTimers();
    expect(onChange).toHaveBeenCalledWith('fixed');
    jest.useRealTimers();
  });

  test('shows writeOnly badge in object property list and password input for field', () => {
    const schema = { type: 'object', properties: { secret: { type: 'string', writeOnly: true } } } as any;
    const onChange = jest.fn();
    render(<JsonInstanceForm schema={schema} value={{ secret: '' }} onChange={onChange} />);
    // badge
    expect(screen.getByText('writeOnly')).toBeTruthy();
    // find input for secret and expect type=password
    const pwd = screen.getByPlaceholderText('Enter value...') as HTMLInputElement;
    expect(pwd.getAttribute('type')).toBe('password');
  });
});
