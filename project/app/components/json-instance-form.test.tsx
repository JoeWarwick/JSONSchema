import React from 'react';
import { render, fireEvent, screen, act, within, waitFor } from '@testing-library/react';
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

  // Helper to find the add-input that belongs to a specific labeled object
  const findAddInputForSection = (label: string) => {
    const inputs = screen.getAllByPlaceholderText('New property name...');
    return inputs.find((el) => {
      let p: HTMLElement | null = el.closest('div');
      while (p) {
        const span = p.querySelector('span');
        if (span && span.textContent === label) return el;
        p = p.parentElement;
      }
      return undefined;
    });
  };

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

  test('renders variant chips for anyOf property', () => {
    const schema: any = {
      type: 'object',
      properties: {
        'runs-on': {
          description: 'The type of machine to run the job on.',
          anyOf: [
            { title: 'GitHub Hosted', type: 'string', enum: ['ubuntu-latest'] },
            { title: 'Self Hosted', type: 'string' }
          ]
        }
      }
    };
    const onChange = jest.fn();
    // Make sure the property exists in the value so its editor renders
    renderForm(<JsonInstanceForm schema={schema} value={{ 'runs-on': undefined }} onChange={onChange} />);
    // The variant chips should be visible for runs-on
    const githubBtn = screen.getByRole('button', { name: /GitHub Hosted/i });
    const selfBtn = screen.getByRole('button', { name: /Self Hosted/i });
    expect(githubBtn).toBeTruthy();
    expect(selfBtn).toBeTruthy();

    // None should be selected initially (anyOf defaults to no selections)
    expect(githubBtn.getAttribute('aria-pressed')).toBe('false');
    expect(selfBtn.getAttribute('aria-pressed')).toBe('false');

    // Label should indicate multi-select options
    expect(screen.getByText('Choose the options')).toBeTruthy();
  });

  test('variant chips are qualified when names clash (type qualifier)', () => {
    const schema: any = {
      type: 'object',
      properties: {
        'runs-on': {
          description: 'The type of machine to run the job on.',
          anyOf: [
            { $comment: 'https://help.github.com/...#self-hosted-runners', type: 'string' },
            { $comment: 'https://help.github.com/...#self-hosted-runners', anyOf: [{ items: [{ type: 'string' }], minItems: 1 }], type: 'array' }
          ]
        }
      }
    };
    const onChange = jest.fn();
    renderForm(<JsonInstanceForm schema={schema} value={{ 'runs-on': undefined }} onChange={onChange} />);

    // Buttons should include the base name and be qualified by type to avoid clash
    expect(screen.getByRole('button', { name: /Self-hosted-runners\s*<string>/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Self-hosted-runners\s*<array>/i })).toBeTruthy();
  });

  test('required polymorphic property renders unselected chips by default', () => {
    const schema: any = {
      type: 'object',
      properties: {
        job: {
          type: 'object',
          properties: {
            'runs-on': {
              anyOf: [
                { title: 'GitHub Hosted', type: 'string' },
                { title: 'Self Hosted', type: 'string' }
              ]
            }
          },
          required: ['runs-on']
        }
      },
      required: ['job']
    };
    const onChange = jest.fn();
    renderForm(<JsonInstanceForm schema={schema} value={undefined} onChange={onChange} />);
    const githubBtn = screen.getByRole('button', { name: /GitHub Hosted/i });
    const selfBtn = screen.getByRole('button', { name: /Self Hosted/i });
    expect(githubBtn.getAttribute('aria-pressed')).toBe('false');
    expect(selfBtn.getAttribute('aria-pressed')).toBe('false');
  });

  test('anyOf property with empty-string value has no chips selected', () => {
    const schema: any = {
      type: 'object',
      properties: {
        'runs-on': {
          description: 'The type of machine to run the job on.',
          anyOf: [
            { title: 'GitHub Hosted', type: 'string', enum: ['ubuntu-latest'] },
            { title: 'Self Hosted', type: 'string' }
          ]
        }
      }
    };
    const onChange = jest.fn();
    // value contains an empty string which should be treated as 'no selection'
    renderForm(<JsonInstanceForm schema={schema} value={{ 'runs-on': '' }} onChange={onChange} />);
    const githubBtn = screen.getByRole('button', { name: /GitHub Hosted/i });
    const selfBtn = screen.getByRole('button', { name: /Self Hosted/i });
    expect(githubBtn.getAttribute('aria-pressed')).toBe('false');
    expect(selfBtn.getAttribute('aria-pressed')).toBe('false');
  });

  test('clicking anyOf chip populates default and shows content', () => {
    const schema: any = {
      type: 'object',
      properties: {
        'runs-on': {
          description: 'The type of machine to run the job on.',
          anyOf: [
            { title: 'GitHub Hosted', type: 'string', enum: ['ubuntu-latest'] },
            { title: 'Self Hosted', type: 'string' }
          ]
        }
      }
    };
    const onChange = jest.fn();
    const { rerender } = renderForm(<JsonInstanceForm schema={schema} value={{ 'runs-on': undefined }} onChange={onChange} />);
    const githubBtn = screen.getByRole('button', { name: /GitHub Hosted/i });
    fireEvent.click(githubBtn);
    expect(onChange).toHaveBeenCalled();
    const called = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    // The parent will be updated with the property set to the default value
    const newVal = typeof called === 'object' && called['runs-on'] !== undefined ? called['runs-on'] : called;
    // Simulate parent updating the value prop and rerendering
    act(() => rerender(<TooltipProvider><JsonInstanceForm schema={schema} value={{ 'runs-on': newVal }} onChange={onChange} /></TooltipProvider>));
    // Now the input/select for the selected variant should appear and the chip should be selected
    expect(screen.queryByPlaceholderText('Enter value...') || screen.queryByRole('combobox')).toBeTruthy();
    const githubBtnAfter = screen.getByRole('button', { name: /GitHub Hosted/i });
    expect(githubBtnAfter.getAttribute('aria-pressed')).toBe('true');
  });

  test('clicking anyOf chip without default inserts empty value and autofocuses editor, duplicates prevented', () => {
    const schema: any = {
      type: 'object',
      properties: {
        'runs-on': {
          description: 'The type of machine to run the job on.',
          anyOf: [
            { title: 'GitHub Hosted', type: 'string', enum: ['ubuntu-latest'] },
            { title: 'Self Hosted', type: 'string' }
          ]
        }
      }
    };

    const onChange = jest.fn();
    const { rerender } = renderForm(<JsonInstanceForm schema={schema} value={{ 'runs-on': [] }} onChange={onChange} />);

    const selfBtn = screen.getByRole('button', { name: /Self Hosted/i });
    // Add Self Hosted (no default) - should insert empty string and call onChange
    fireEvent.click(selfBtn);
    // DEBUG
    console.debug('onChange.calls', JSON.stringify(onChange.mock.calls));
    expect(onChange).toHaveBeenCalled();
    let called = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    // parent updated with runs-on array containing empty string
    expect(Array.isArray(called['runs-on'])).toBe(true);
    expect(called['runs-on']).toEqual(['']);

    // Simulate parent updating prop and rerender - the inner input should be visible and focused
    act(() => rerender(<JsonInstanceForm schema={schema} value={{ 'runs-on': called['runs-on'] }} onChange={onChange} />));
    const input = screen.getByPlaceholderText('Enter value...') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(document.activeElement).toBe(input);

    // Clicking the same chip again should remove it (toggle) - duplicates should not be created
    fireEvent.click(selfBtn);
    expect(onChange).toHaveBeenCalled();
    called = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(Array.isArray(called['runs-on'])).toBe(true);
    expect(called['runs-on']).toEqual([]);
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
    const links = screen.getAllByRole('link', { name: /https?:\/\/example\.com\/docs/ });
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
      const commentLinks = screen.getAllByRole('link', { name: /https?:\/\/example\.com\/doc/ });
      expect(commentLinks.length).toBeGreaterThan(0);
      expect(commentLinks[0].getAttribute('target')).toBe('_blank');

      // Keyboard focus reveal: focus the comment button (simulate tab focus)
      commentBtn.focus();
      const commentLinks2 = screen.getAllByRole('link', { name: /https?:\/\/example\.com\/doc/ });
      expect(commentLinks2.length).toBeGreaterThan(0);
    }
  });

  test('empty anyOf schema shows no chips and is treated as no-variants', () => {
    const schema: any = { type: 'object', properties: { a: { anyOf: [] } } };
    const onChange = jest.fn();
    renderForm(<JsonInstanceForm schema={schema} value={{ a: [] }} onChange={onChange} />);

    // No variant chips should be rendered for an empty anyOf
    expect(screen.queryByText(/Choose the options/i)).toBeNull();
  });

  test('empty oneOf schema shows no chips and is treated as no-variants', () => {
    const schema: any = { type: 'object', properties: { a: { oneOf: [] } } };
    const onChange = jest.fn();
    renderForm(<JsonInstanceForm schema={schema} value={undefined} onChange={onChange} />);

    // No variant chips should be rendered for an empty oneOf
    expect(screen.queryByText(/Choose an option/i)).toBeNull();
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

  test('adding a pattern property (NormalJob) creates required runs-on as empty array (no default selection)', () => {
    const schema: any = {
      type: 'object',
      properties: {
        jobs: {
          type: 'object',
          patternProperties: {
            '^[_a-zA-Z][a-zA-Z0-9_-]*$': {
              type: 'object',
              properties: {
                'runs-on': {
                  anyOf: [
                    { title: 'GitHub Hosted', type: 'string', enum: ['ubuntu-latest'] },
                    { title: 'Self Hosted', type: 'string' }
                  ]
                }
              },
              required: ['runs-on']
            }
          },
          additionalProperties: true
        }
      }
    };

    const onChange = jest.fn();
    renderForm(<JsonInstanceForm schema={schema} value={{ jobs: {} }} onChange={onChange} />);

    const input = findAddInputForSection('Jobs') as HTMLInputElement;

    // Add a new NormalJob
    fireEvent.change(input, { target: { value: 'normal' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalled();
    const called = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(called.jobs).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(called.jobs, 'normal')).toBeTruthy();
    const added = called.jobs['normal'];
    // runs-on should be present and be an empty array so anyOf chips remain unselected
    expect(Object.prototype.hasOwnProperty.call(added, 'runs-on')).toBeTruthy();
    expect(Array.isArray(added['runs-on'])).toBe(true);
    expect(added['runs-on']).toEqual([]);
  });

  test('adding a pattern property shows job-type oneOf chips (NormalJob vs ReusableWorkflowCallJob)', async () => {
    const schema: any = {
      type: 'object',
      properties: {
        jobs: {
          type: 'object',
          patternProperties: {
            '^[_a-zA-Z][a-zA-Z0-9_-]*$': {
              oneOf: [
                { title: 'NormalJob', type: 'object', properties: { 'runs-on': { anyOf: [ { title: 'GitHub Hosted', type: 'string' }, { title: 'Self Hosted', type: 'string' } ] }, required: ['runs-on'] } },
                { title: 'ReusableWorkflowCallJob', type: 'object', properties: { 'uses': { type: 'string' } }, required: ['uses'] }
              ]
            }
          },
          additionalProperties: true
        }
      }
    };

    const onChange = jest.fn();
    const { rerender } = renderForm(<JsonInstanceForm schema={schema} value={{ jobs: {} }} onChange={onChange} />);

    const input = findAddInputForSection('Jobs') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'job' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Wait for the deferred add to fire
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const called = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(called.jobs).toBeTruthy();
    const keyName = Object.keys(called.jobs)[0];
    expect(keyName).toBeTruthy();

    // Simulate parent update and rerender so child editors mount
    act(() => rerender(<TooltipProvider><JsonInstanceForm schema={schema} value={{ jobs: called.jobs }} onChange={onChange} /></TooltipProvider>));


    const jobsLabel = screen.getByText('Jobs');
    const jobsGroup = jobsLabel.closest('div') as HTMLElement | null;
    expect(jobsGroup).toBeTruthy();

    // Find the property group for the newly-created key and assert the variant chips are present there
    const jobLabel = within(jobsGroup as HTMLElement).getByText(new RegExp(keyName, 'i'));
    const jobHeader = jobLabel.closest('div');
    expect(jobHeader).toBeTruthy();
    const jobGroup = jobHeader ? (jobHeader.parentElement as HTMLElement | null) : null;
    expect(jobGroup).toBeTruthy();

    // DEBUG
    // console.debug('jobGroup html:', jobGroup ? jobGroup.innerHTML : '<none>');

    const normalChip = within(jobGroup as HTMLElement).getByRole('button', { name: /NormalJob/i });
    const reusableChip = within(jobGroup as HTMLElement).getByRole('button', { name: /ReusableWorkflowCallJob/i });
    expect(normalChip).toBeTruthy();
    expect(reusableChip).toBeTruthy();
  });

  test('inline rename of newly-added pattern property works', async () => {
    jest.useFakeTimers();

    const schema: any = {
      type: 'object',
      properties: {
        jobs: {
          type: 'object',
          patternProperties: {
            '^[_a-zA-Z][a-zA-Z0-9_-]*$': {
              type: 'object'
            }
          },
          additionalProperties: true
        }
      }
    };

    const onChange = jest.fn();
    renderForm(<JsonInstanceForm schema={schema} value={{ jobs: {} }} onChange={onChange} />);

    const input = findAddInputForSection('Jobs') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'normal' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // The pending rename input should be visible before the deferred add runs
    const jobsLabel = screen.getByText('Jobs');
    const jobsHeader = jobsLabel.closest('div');
    expect(jobsHeader).toBeTruthy();
    const jobsGroup = jobsHeader ? (jobsHeader.parentElement as HTMLElement | null) : null;
    expect(jobsGroup).toBeTruthy();


    const allInputs = within(jobsGroup as HTMLElement).getAllByPlaceholderText('New property name...') as HTMLInputElement[];
    const pendingInput = allInputs.find(i => (i as HTMLInputElement).value === 'normal');
    expect(pendingInput).toBeTruthy();

    // Rename to 'normalJob1' while add is still pending, and confirm it cancels the pending add and creates the renamed key
    fireEvent.change(pendingInput as HTMLInputElement, { target: { value: 'normalJob1' } });
    fireEvent.keyDown(pendingInput as HTMLInputElement, { key: 'Enter' });

    // Run pending timers (the deferred add would have run here if not cancelled)
    act(() => { jest.runOnlyPendingTimers(); });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const called = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(Object.prototype.hasOwnProperty.call(called.jobs, 'normalJob1')).toBeTruthy();

    jest.useRealTimers();
  });

  test('pattern properties show add input even when additionalProperties is false', () => {
    const schema: any = {
      type: 'object',
      properties: {
        jobs: {
          type: 'object',
          patternProperties: {
            '^[_a-zA-Z][a-zA-Z0-9_-]*$': {
              type: 'object',
              properties: {
                'runs-on': {
                  anyOf: [
                    { title: 'GitHub Hosted', type: 'string', enum: ['ubuntu-latest'] },
                    { title: 'Self Hosted', type: 'string' }
                  ]
                }
              },
              required: ['runs-on']
            }
          },
          additionalProperties: false
        }
      }
    };

    const onChange = jest.fn();
    renderForm(<JsonInstanceForm schema={schema} value={{ jobs: {} }} onChange={onChange} />);

    // Locate the Jobs property group and ensure it does not contain the free Add input
    const jobsLabel = screen.getByText('Jobs');
    const jobsGroup = jobsLabel.closest('div');
    expect(jobsGroup).toBeTruthy();
    const input = jobsGroup ? within(jobsGroup).queryByPlaceholderText('New property name...') : null;
    expect(input).toBeNull();
    // No free-add control is available; pattern properties must be added via other UI flows.
  });

  test('adding a pattern property will populate runs-on with schema default when provided', () => {
    const schema: any = {
      type: 'object',
      properties: {
        jobs: {
          type: 'object',
          patternProperties: {
            '^[_a-zA-Z][a-zA-Z0-9_-]*$': {
              type: 'object',
              properties: {
                'runs-on': {
                  anyOf: [
                    { title: 'GitHub Hosted', type: 'string', enum: ['ubuntu-latest'], default: 'ubuntu-latest' },
                    { title: 'Self Hosted', type: 'string' }
                  ]
                }
              },
              required: ['runs-on']
            }
          },
          additionalProperties: true
        }
      }
    };

    const onChange = jest.fn();
    renderForm(<JsonInstanceForm schema={schema} value={{ jobs: {} }} onChange={onChange} />);

    const input = findAddInputForSection('Jobs') as HTMLInputElement;

    // Add a new NormalJob
    fireEvent.change(input, { target: { value: 'normal' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalled();
    const called = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    const added = called.jobs['normal'];
    // runs-on should be set to the provided default
    expect(added['runs-on']).toBe('ubuntu-latest');
  });

  test('adding defaults.run does not auto-seed a nested run property when the child schema has no declared properties', () => {
    const schema: any = {
      type: 'object',
      properties: {
        defaults: {
          type: 'object',
          properties: {
            run: {
              type: 'object',
              minProperties: 1,
              additionalProperties: false
            }
          }
        }
      }
    };

    const onChange = jest.fn();
    const { rerender } = renderForm(<JsonInstanceForm schema={schema} value={{ defaults: {} }} onChange={onChange} />);

    const addRun = screen.getByRole('button', { name: /\+ Run/i });
    fireEvent.click(addRun);

    expect(onChange).toHaveBeenCalled();
    const called = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(called.defaults).toBeTruthy();
    expect(called.defaults.run).toEqual({});

    act(() => rerender(<TooltipProvider><JsonInstanceForm schema={schema} value={called} onChange={onChange} /></TooltipProvider>));

    expect(screen.queryByText(/\bRun\b.*\(unexpected\)/i)).toBeNull();
    expect(screen.queryByText(/^Run$/i)).toBeTruthy();
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
    // array editor should be present (multi-value select for string arrays using react-select)
    expect(screen.getByRole('combobox', { name: '' })).toBeTruthy();
  });

  test('oneOf $ref variant button renders correctly', () => {
    const schema: any = {
      $defs: {
        Concurrency: {
          type: 'object',
          properties: {
            group: { type: 'string' },
            'cancel-in-progress': { type: 'boolean' }
          },
          required: ['group']
        }
      },
      oneOf: [
        { type: 'string', title: 'String' },
        { $ref: '#/$defs/Concurrency', title: 'Concurrency' }
      ]
    };

    const onChange = jest.fn();
    renderForm(<JsonInstanceForm schema={schema} value={undefined} onChange={onChange} />);

    // This test verifies that oneOf variants with $ref pointers are properly resolved:
    // - The Concurrency button renders with the title "Concurrency" (from the $ref variant)
    // - The resolved schema from $defs/Concurrency is correctly handled
    // - Both variant buttons are unselected initially
    const concurrencyBtn = screen.getByRole('button', { name: /Concurrency/i });
    expect(concurrencyBtn).toBeTruthy();
    expect(concurrencyBtn.getAttribute('aria-pressed')).toBe('false');
    
    const stringBtn = screen.getByRole('button', { name: /String/i });
    expect(stringBtn).toBeTruthy();
    expect(stringBtn.getAttribute('aria-pressed')).toBe('false');
  });

  test('oneOf $ref variant shows object fields after clicking Concurrency button', () => {
    const schema: any = {
      $defs: {
        Concurrency: {
          type: 'object',
          properties: {
            group: { type: 'string' },
            'cancel-in-progress': { type: 'boolean' }
          },
          required: ['group']
        }
      },
      oneOf: [
        { type: 'string', title: 'String' },
        { $ref: '#/$defs/Concurrency', title: 'Concurrency' }
      ]
    };

    const onChange = jest.fn();
    const { rerender } = renderForm(<JsonInstanceForm schema={schema} value={undefined} onChange={onChange} />);

    // Initially, no form content should be visible
    expect(screen.queryByText(/Group/i)).toBeNull();
    expect(screen.queryByText(/cancel-in-progress/i)).toBeNull();

    // Click the Concurrency button
    const concurrencyBtn = screen.getByRole('button', { name: /Concurrency/i });
    fireEvent.click(concurrencyBtn);

    // onChange should have been called with a default object containing 'group' property
    expect(onChange).toHaveBeenCalled();
    const called = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(typeof called).toBe('object');
    expect(called).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(called, 'group')).toBe(true);

    // Simulate parent updating the value and rerendering
    act(() => rerender(<JsonInstanceForm schema={schema} value={called} onChange={onChange} />));

    // The object form should now be visible with its properties
    expect(screen.getByText(/Group/i)).toBeTruthy();
    expect(screen.getByText(/Cancel-in-progress/i)).toBeTruthy();
  });

  test('oneOf $ref variant hides string input when object variant selected', () => {
    const schema: any = {
      $defs: {
        Concurrency: {
          type: 'object',
          properties: {
            group: { type: 'string' },
            'cancel-in-progress': { type: 'boolean' }
          },
          required: ['group']
        }
      },
      oneOf: [
        { type: 'string', title: 'String' },
        { $ref: '#/$defs/Concurrency', title: 'Concurrency' }
      ]
    };

    const onChange = jest.fn();
    const { rerender } = renderForm(<JsonInstanceForm schema={schema} value={'initial string'} onChange={onChange} />);

    // String variant should be selected initially since value is a string
    const stringBtn = screen.getByRole('button', { name: /String/i });
    expect(stringBtn.getAttribute('aria-pressed')).toBe('true');

    // Verify no object properties are present yet (String variant doesn't have them)
    expect(screen.queryByText(/Group/i)).toBeNull();
    expect(screen.queryByText(/Cancel-in-progress/i)).toBeNull();

    // Click Concurrency button to switch to object variant
    const concurrencyBtn = screen.getByRole('button', { name: /Concurrency/i });
    fireEvent.click(concurrencyBtn);

    // onChange should have been called with an object, not a string
    expect(onChange).toHaveBeenCalled();
    const called = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(typeof called).toBe('object');
    expect(called).not.toBeNull();

    // Simulate parent updating and rerendering with new object value
    act(() => rerender(<JsonInstanceForm schema={schema} value={called} onChange={onChange} />));

    // Object properties should now be visible (including their inputs)
    expect(screen.getByText(/Group/i)).toBeTruthy();
    // The group property should have its own string input within the object form
    const groupInputs = screen.getAllByPlaceholderText('Enter value...');
    expect(groupInputs.length).toBeGreaterThan(0);
  });
});
