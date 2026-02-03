import React from 'react';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { JsonInstanceForm } from './json-instance-form';
import { TooltipProvider } from './ui/tooltip/tooltip';

describe('JsonInstanceForm extras', () => {
  const renderForm = (ui: React.ReactElement) => {
    const res = render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
    return {
      ...res,
      rerender: (newUi: React.ReactElement) => res.rerender(<TooltipProvider delayDuration={0}>{newUi}</TooltipProvider>)
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
    // There should be no native selects (draft list hidden) but the react-select control should remain.
    const selects = container.querySelectorAll('select');
    const rsControls = container.querySelectorAll('.react-select__control');
    expect(selects.length).toBe(0);
    expect(rsControls.length).toBeGreaterThanOrEqual(1);
  });

  test('array enum values render a react-select multi control', () => {
    const schema = { type: 'array', items: { type: 'string', enum: ['push', 'pull_request', 'workflow_dispatch'] }, description: 'Select events' };
    const onChange = jest.fn();
    const { container } = renderForm(<JsonInstanceForm schema={schema} value={['push']} onChange={onChange} />);
    expect(container.querySelector('.react-select__control')).toBeTruthy();
    const multiValues = container.querySelectorAll('.react-select__multi-value');
    expect(multiValues.length).toBe(1);
  });

  test('string enum values render a native single select', () => {
    const schema = { type: 'string', enum: ['push', 'pull_request'] };
    const onChange = jest.fn();
    renderForm(<JsonInstanceForm schema={schema} value={'push'} onChange={onChange} />);
    const select = screen.getByRole('combobox');
    expect(select.tagName).toBe('SELECT');
    expect(select.getAttribute('multiple')).toBeNull();
  });

  test('oneOf string enum variant uses native select while array variant uses react-select multi', () => {
    const schema: any = {
      oneOf: [
        { title: 'Single enum', type: 'string', enum: ['push', 'pull_request'] },
        { title: 'Multi enum', type: 'array', minItems: 1, items: { type: 'string', enum: ['push', 'pull_request'] } },
      ],
    };
    const onChange = jest.fn();
    const { container } = renderForm(<JsonInstanceForm schema={schema} value={undefined} onChange={onChange} />);

    const singleBtn = screen.getByRole('button', { name: /Single enum/i });
    fireEvent.click(singleBtn);
    const nativeSelect = screen.getByRole('combobox');
    expect(nativeSelect.tagName).toBe('SELECT');
    expect(nativeSelect.getAttribute('multiple')).toBeNull();
    expect(container.querySelector('.react-select__control')).toBeNull();

    const multiBtn = screen.getByRole('button', { name: /Multi enum/i });
    fireEvent.click(multiBtn);
    expect(container.querySelector('.react-select__control')).toBeTruthy();
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

  test('shows add buttons for non-required root properties when value is undefined', () => {
    const schema: any = { properties: { alpha: { type: 'string' }, beta: { type: 'number' } }, required: [] };
    const onChange = jest.fn();
    renderForm(<JsonInstanceForm schema={schema} value={undefined} onChange={onChange} />);
    // Buttons for non-required defined properties should be present
    expect(screen.getByRole('button', { name: /\+ alpha/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /\+ beta/i })).toBeTruthy();
  });

  test('required properties are present by default when value is undefined', () => {
    const schema: any = { properties: { a: { type: 'string' }, b: { type: 'number' } }, required: ['a'] };
    const onChange = jest.fn();
    renderForm(<JsonInstanceForm schema={schema} value={undefined} onChange={onChange} />);

    // onChange should be called to populate required properties
    expect(onChange).toHaveBeenCalled();
    const calledWith = onChange.mock.calls.find(c => c[0] && Object.prototype.hasOwnProperty.call(c[0], 'a'));
    expect(calledWith).toBeTruthy();
    expect(calledWith[0].a).toBe('');

    // UI should render the required property editor
    expect(screen.getByText('A')).toBeTruthy();
  });

  test('polymorphic additionalProperties show variant chips and use selected variant on add (jobs example)', async () => {
    const schema: any = {
      type: 'object',
      properties: {
        jobs: {
          type: 'object',
          description: 'Jobs desc — https://example.com/jobs',
          patternProperties: {
            '^[_a-zA-Z][a-zA-Z0-9_-]*$': {
              oneOf: [
                { type: 'object', title: 'Job Object', properties: { runs: { type: 'string' } } },
                { type: 'string', title: 'Job String' }
              ]
            }
          },
          additionalProperties: false
        }
      },
      required: ['jobs']
    };

    const onChange = jest.fn();
    renderForm(<JsonInstanceForm schema={schema} value={{ jobs: {} }} onChange={onChange} />);

    // Find the jobs property group by locating the label 'Jobs'
    const label = screen.getByText('Jobs');


    // Pattern chips were removed — the PATTERN label and variant buttons should not be present anywhere
    expect(screen.queryByText(/pattern:/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /NormalJob/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /ReusableWorkflowCallJob/ })).toBeNull();

    // Description should still be present via tooltip on the Jobs label
    fireEvent.mouseEnter(label);
    fireEvent.focus(label);
    const jobLinks = await screen.findAllByRole('link', { name: /https?:\/\/example\.com\/jobs/ });
    expect(jobLinks.length).toBeGreaterThan(0);

  });


  test('available property shows name as label and description/comment tooltips (linkify)', async () => {
    const schema: any = { properties: { trigger: { type: 'string', description: 'A test description — https://example.com/docs', $comment: 'https://example.com/doc' } }, required: [] };
    const onChange = jest.fn();
    const { container } = renderForm(<JsonInstanceForm schema={schema} value={undefined} onChange={onChange} />);

    // The add button should use the property name as the label
    const addBtn = screen.getByRole('button', { name: /\+ trigger/i });
    expect(addBtn).toBeTruthy();

    // Hover to show description tooltip (contains a link)
    fireEvent.mouseEnter(addBtn);
    fireEvent.focus(addBtn);
    const links = await screen.findAllByRole('link', { name: /https?:\/\/example\.com\/docs/ });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].getAttribute('target')).toBe('_blank');

    // The comment icon should be present (hidden by CSS until hover)
    const commentBtn = container.querySelector('button[aria-label="comment-trigger"]') as HTMLElement | null;
    expect(commentBtn).toBeTruthy();

    // Hovering the comment icon should close the description tooltip and open the comment tooltip
    if (commentBtn) {
      fireEvent.mouseEnter(commentBtn);
      fireEvent.focus(commentBtn);
      // The description tooltip should no longer be visible
      const descQuery = screen.queryByText('A test description —');
      expect(descQuery).toBeNull();

      // Now the comment tooltip link should appear
      const commentLinks = await screen.findAllByRole('link', { name: /https?:\/\/example\.com\/doc/ });
      expect(commentLinks.length).toBeGreaterThan(0);
      expect(commentLinks[0].getAttribute('target')).toBe('_blank');

      // Keyboard focus reveal: focus the comment button (simulate tab focus)
      commentBtn.focus();
      const commentLinks2 = await screen.findAllByRole('link', { name: /https?:\/\/example\.com\/doc/ });
      expect(commentLinks2.length).toBeGreaterThan(0);
    }
  });

  test('remove buttons show delete tooltip on hover', async () => {
    const schema: any = { properties: { a: { type: 'string' } }, required: [] };
    const onChange = jest.fn();
    renderForm(<JsonInstanceForm schema={schema} value={{ a: 'x' }} onChange={onChange} />);

    // Find the remove button via its accessible label
    const removeBtn = screen.getByLabelText('Delete A?');
    fireEvent.mouseEnter(removeBtn);
    fireEvent.focus(removeBtn);

    const tips = await screen.findAllByText(/Delete A\?/);
    expect(tips.length).toBeGreaterThan(0);
  });

  test('pattern property remove button shows delete tooltip (jobs example)', async () => {
    const schema: any = {
      type: 'object',
      properties: {
        jobs: {
          type: 'object',
          patternProperties: {
            '^[_a-zA-Z][a-zA-Z0-9_-]*$': {
              type: 'object',
              properties: {
                'runs-on': { type: 'string' },
                'timeout-minutes': { type: 'number' }
              }
            }
          },
          additionalProperties: false
        }
      },
      required: ['jobs']
    };

    const onChange = jest.fn();
    const instance = { jobs: { job: { 'runs-on': '', 'timeout-minutes': 360 } } };
    renderForm(<JsonInstanceForm schema={schema} value={instance} onChange={onChange} />);

    // Find the Job property group by locating the label 'Job'
    const label = screen.getByText('Job');
    let group: HTMLElement | null = label.closest('div');
    while (group && !Array.from(group.querySelectorAll('button')).some(b => b.getAttribute('aria-label') && b.getAttribute('aria-label')!.startsWith('Delete'))) {
      group = group.parentElement;
    }
    expect(group).toBeTruthy();

    // The job header remove button should have an accessible label
    const jobRemove = group!.querySelector('button[aria-label="Delete Job?"]') as HTMLElement | null;
    expect(jobRemove).toBeTruthy();

    // Hover to show tooltip
    fireEvent.mouseEnter(jobRemove!);
    fireEvent.focus(jobRemove!);

    const tips = await screen.findAllByText(/Delete Job\?/);
    expect(tips.length).toBeGreaterThan(0);
  });

  test('available row has no empty placeholders for required properties', () => {
    const schema: any = { properties: { a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' } }, required: ['a'] };
    const onChange = jest.fn();
    renderForm(<JsonInstanceForm schema={schema} value={{ b: 'x' }} onChange={onChange} />);

    const header = screen.getByText('Available properties');
    const row = header.nextElementSibling as HTMLElement | null;
    expect(row).toBeTruthy();
    const children = Array.from(row!.children).filter((ch) => ch.nodeType === 1);
    // Only c (not present, addable) should be rendered — present properties are removed from the Available list
    expect(children.length).toBe(1);
    expect(children[0].textContent).toMatch(/\+\s*C/i);
  });

  test('hides Available properties when there are no non-required properties', () => {
    const schema: any = { properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a','b'] };
    const onChange = jest.fn();
    renderForm(<JsonInstanceForm schema={schema} value={{ a: 'x', b: 'y' }} onChange={onChange} />);

    const header = screen.queryByText('Available properties');
    expect(header).toBeNull();
  });

  test('oneOf with no selection shows unselected chips and no content', () => {
    const schema: any = { description: 'Choose option', oneOf: [ { type: 'object', title: 'Obj', properties: { a: { type: 'string' } } }, { type: 'string', title: 'String' } ] };
    const onChange = jest.fn();
    const { container, rerender } = renderForm(<JsonInstanceForm schema={schema} value={undefined} onChange={onChange} />);

    const objBtn = screen.getByRole('button', { name: /Obj/ });
    const strBtn = screen.getByRole('button', { name: /String/ });
    expect(objBtn.getAttribute('aria-pressed')).toBe('false');
    expect(strBtn.getAttribute('aria-pressed')).toBe('false');

    // No inner content should be present when none selected
    expect(screen.queryByPlaceholderText('Enter value...')).toBeNull();

    // Within the field area, no '+ Add' buttons should be present
    const field = container.querySelector('label')!.closest('div') as HTMLElement;
    expect(field).toBeTruthy();
    const addInside = Array.from(field.querySelectorAll('button')).some(b => b.textContent && b.textContent.includes('+ Add'));
    expect(addInside).toBe(false);

    // Also treat empty object as no-selection state
    rerender(<JsonInstanceForm schema={schema} value={{}} onChange={onChange} />);
    const objBtn2 = screen.getByRole('button', { name: /Obj/ });
    const strBtn2 = screen.getByRole('button', { name: /String/ });
    expect(objBtn2.getAttribute('aria-pressed')).toBe('false');
    expect(strBtn2.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByPlaceholderText('Enter value...')).toBeNull();
  });

  test('selecting a oneOf variant populates default and shows content', () => {
    const schema: any = { description: 'Choose option', oneOf: [ { type: 'object', title: 'Obj', properties: { a: { type: 'string' } } }, { type: 'string', title: 'String' } ] };
    const onChange = jest.fn();
    const { rerender } = renderForm(<JsonInstanceForm schema={schema} value={undefined} onChange={onChange} />);

    const strBtn = screen.getByRole('button', { name: /String/ });
    fireEvent.click(strBtn);
    // onChange should have been called to populate default for string ("")
    expect(onChange).toHaveBeenCalled();
    const called = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(called).toBe('');

    // Simulate parent updating the value prop to the selected default
    // and rerender the component with the new value
    act(() => rerender(<TooltipProvider><JsonInstanceForm schema={schema} value={called} onChange={onChange} /></TooltipProvider>));

    // Now content (an input for string) should be present
    expect(screen.getByPlaceholderText('Enter value...')).toBeTruthy();
    const strBtnAfter = screen.getByRole('button', { name: /String/ });
    expect(strBtnAfter.getAttribute('aria-pressed')).toBe('true');

    // Additional tests: empty object and empty array should NOT auto-select
    const schema2: any = { description: 'Choose', oneOf: [ { type: 'object', title: 'Obj', properties: { a: { type: 'string' } } }, { type: 'array', title: 'Array', items: { type: 'string' } } ] };
    const onChange2 = jest.fn();
    rerender(<JsonInstanceForm schema={schema2} value={{}} onChange={onChange2} />);
    const objBtn = screen.getByRole('button', { name: /Obj/ });
    const arrBtn = screen.getByRole('button', { name: /Array/ });
    expect(objBtn.getAttribute('aria-pressed')).toBe('false');
    expect(arrBtn.getAttribute('aria-pressed')).toBe('false');

    // empty array - should select the Array variant and show content
    const onChange3 = jest.fn();
    rerender(<JsonInstanceForm schema={schema2} value={[]} onChange={onChange3} />);
    const objBtn2 = screen.getByRole('button', { name: /Obj/ });
    const arrBtn2 = screen.getByRole('button', { name: /Array/ });
    expect(objBtn2.getAttribute('aria-pressed')).toBe('false');
    expect(arrBtn2.getAttribute('aria-pressed')).toBe('true');
    // array editor should be present (add item button for primitive list)
    expect(screen.getByRole('button', { name: '+ Add Item' })).toBeTruthy();
  });
});
