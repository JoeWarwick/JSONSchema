import React from 'react';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { JsonInstanceForm } from './json-instance-form';
import { TooltipProvider } from './ui/tooltip/tooltip';

describe('JsonInstanceForm extras', () => {
  const renderForm = (ui: React.ReactElement) => {
    const res = render(<TooltipProvider>{ui}</TooltipProvider>);
    return {
      ...res,
      rerender: (newUi: React.ReactElement) => res.rerender(<TooltipProvider>{newUi}</TooltipProvider>)
    };
  };

  beforeEach(() => {
    localStorage.clear();
  });

  test('auto-deduplicates unique primitive arrays on blur', () => {
    const schema = {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
    };
    const onChange = jest.fn();
    const { container } = renderForm(<JsonInstanceForm schema={schema} value={['a','b','a']} onChange={onChange} />);
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
    const schema = { type: 'string', const: 'fixed' };
    const onChange = jest.fn();
    renderForm(<JsonInstanceForm schema={schema} value={undefined} onChange={onChange} />);
    // const display should be present
    expect(screen.getByText('fixed')).toBeTruthy();
    // advance timers to allow setTimeout propagation
    act(() => { jest.runOnlyPendingTimers(); });
    expect(onChange).toHaveBeenCalledWith('fixed');
    jest.useRealTimers();
  });

  test('hides draft select when all enum options already present (object parent)', () => {
    const schema = { 
      type: 'object',
      properties: {
        dietary: { type: 'array', items: { type: 'string', enum: ['Vegetarian', 'Lactose Intolerant'] }, uniqueItems: true }
      },
      required: ['dietary']
    };
    const onChange = jest.fn();
    const { container } = renderForm(<JsonInstanceForm schema={schema} value={{ dietary: ['Vegetarian', 'Lactose Intolerant'] }} onChange={onChange} />);
    // there should be one select per existing enum item inside the array plus the parent property UI
    const selects = container.querySelectorAll('select');
    expect(selects.length).toBe(2);
  });

  test('shows writeOnly badge in object property list and password input for field', () => {
    const schema: any = { type: 'object', properties: { secret: { type: 'string', writeOnly: true } } };
    const onChange = jest.fn();
    renderForm(<JsonInstanceForm schema={schema} value={{ secret: '' }} onChange={onChange} />);
    // badge
    expect(screen.getByText('writeOnly')).toBeTruthy();
    // find input for secret and expect type=password
    const pwd = screen.getByPlaceholderText('Enter value...') as HTMLInputElement;
    expect(pwd.getAttribute('type')).toBe('password');
  });

  test('oneOf initial selection chooses matching variant', () => {
    const schema: any = { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] };
    const onChange = jest.fn();
    renderForm(<JsonInstanceForm schema={schema} value={5} onChange={onChange} />);
    const numBtn = screen.getByRole('button', { name: /Number/i });
    expect(numBtn.getAttribute('aria-pressed')).toBe('true');
  });

  test('switching replaces with default when incompatible', () => {
    const schema: any = { oneOf: [{ type: 'string' }, { type: 'number' }] };
    const onChange = jest.fn();
    renderForm(<JsonInstanceForm schema={schema} value={'abc'} onChange={onChange} />);
    const numBtn = screen.getByRole('button', { name: /Number/i });
    numBtn.click();
    expect(onChange).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(0);
  });

  test('switching preserves value when compatible', () => {
    const schema: any = { oneOf: [{ type: 'number', title: 'A' }, { type: 'number', title: 'B' }] };
    const onChange = jest.fn();
    renderForm(<JsonInstanceForm schema={schema} value={3} onChange={onChange} />);
    const btnB = screen.getByRole('button', { name: /B/ });
    btnB.click();
    expect(onChange).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(3);
  });

  test('shows error when value matches none', () => {
    const schema: any = { oneOf: [{ type: 'number' }, { type: 'boolean' }] };
    const onChange = jest.fn();
    renderForm(<JsonInstanceForm schema={schema} value={'bad'} onChange={onChange} />);
    expect(screen.getByText(/Value does not match any option/i)).toBeTruthy();
  });

  test('chip keyboard navigation replaces with default when incompatible', () => {
    jest.useFakeTimers();
    const schema: any = { oneOf: [{ type: 'string' }, { type: 'number' }] };
    const onChange = jest.fn();
    renderForm(<JsonInstanceForm schema={schema} value={'abc'} onChange={onChange} />);
    const strBtn = screen.getByRole('button', { name: /String/i });
    strBtn.focus();
    fireEvent.keyDown(strBtn, { key: 'ArrowRight' });
    // onChange should be called with default number 0
    expect(onChange).toHaveBeenCalledWith(0);
    // advance timers to allow selection state to update
    act(() => { jest.runOnlyPendingTimers(); });
    const numBtn = screen.getByRole('button', { name: /Number/i });
    // focus should move to the newly-selected chip
    expect(document.activeElement).toBe(numBtn);
    jest.useRealTimers();
  });

  test('chip keyboard navigation preserves value when compatible', () => {
    jest.useFakeTimers();
    const schema: any = { oneOf: [{ type: 'number', title: 'A' }, { type: 'number', title: 'B' }] };
    const onChange = jest.fn();
    renderForm(<JsonInstanceForm schema={schema} value={3} onChange={onChange} />);
    const btnA = screen.getByRole('button', { name: /A/ });
    btnA.focus();
    fireEvent.keyDown(btnA, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith(3);
    act(() => { jest.runOnlyPendingTimers(); });
    const btnB = screen.getByRole('button', { name: /B/ });
    // focus should move to the newly-selected chip
    expect(document.activeElement).toBe(btnB);
    jest.useRealTimers();
  });

  test('variantMemoryKey is isolated between different schemas', () => {
    const schemaA = { title: 'SchemaA', oneOf: [{ type: 'string' }, { type: 'number' }] };
    const schemaB = { title: 'SchemaB', oneOf: [{ type: 'string' }, { type: 'number' }] };
    const onChange = jest.fn();

    // 1. Set a value for 'Number' in SchemaA
    const { rerender, unmount } = renderForm(<JsonInstanceForm schema={schemaA} value="abc" onChange={onChange} />);
    const numBtnA = screen.getByRole('button', { name: /Number/i });
    numBtnA.click();
    expect(onChange).toHaveBeenCalledWith(0);
    
    // Update value to 42 so it saves to memory for index 1
    rerender(<JsonInstanceForm schema={schemaA} value={42} onChange={onChange} />);
    unmount();

    // 2. Render SchemaB with value "xyz" (index 0)
    renderForm(<JsonInstanceForm schema={schemaB} value="xyz" onChange={onChange} />);
    const numBtnB = screen.getByRole('button', { name: /Number/i });
    
    // Click 'Number' (index 1) in SchemaB. 
    // It should NOT restore 42, but instead use default (0) because memory is isolated.
    numBtnB.click();
    expect(onChange).toHaveBeenLastCalledWith(0); 
  });
});
