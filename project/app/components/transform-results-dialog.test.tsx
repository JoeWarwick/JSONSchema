import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AddWorkbenchContext } from '../state/workbench-context';
import { TransformResultsDialog } from './transform-results-dialog';
import { type WorkbenchDocument } from '../state/workspace';

describe('Transform output import dialog', () => {
  const results = [
    { id: 'primary', name: 'People', xml: '<people/>', schema: '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="people"/></xs:schema>' },
    { id: 'second', name: 'Other', xml: '<other/>', schema: '' },
  ];

  it('creates only checked outputs with their schemas, with one atomic workspace update', () => {
    const add = jest.fn();
    const close = jest.fn();
    render(<AddWorkbenchContext.Provider value={add}><TransformResultsDialog results={results} onClose={close} /></AddWorkbenchContext.Provider>);
    fireEvent.click(screen.getByLabelText('Include output 2'));
    fireEvent.change(screen.getByLabelText('Workbench name for output 1'), { target: { value: '  Edited people  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create workbenches' }));
    expect(add).toHaveBeenCalledTimes(1);
    const benches: WorkbenchDocument[] = add.mock.calls[0][0];
    expect(benches).toHaveLength(1);
    expect(benches[0].name).toBe('Edited people');
    expect(benches[0].kind).toBe('xml');
    expect(benches[0].entries['schema-sculptor-schema-xml']).toContain('people');
    expect(benches[0].entries['schema-sculptor-instance-xml']).toBe('<people/>');
    expect(add.mock.calls[0][1]).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('disables creation for empty selections and blank selected names; cancellation adds nothing', () => {
    const add = jest.fn();
    const close = jest.fn();
    render(<AddWorkbenchContext.Provider value={add}><TransformResultsDialog results={results} onClose={close} /></AddWorkbenchContext.Provider>);
    fireEvent.change(screen.getByLabelText('Workbench name for output 1'), { target: { value: ' ' } });
    expect(screen.getByRole('button', { name: 'Create workbenches' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Include output 1'));
    expect(screen.getByRole('button', { name: 'Create workbenches' })).not.toBeDisabled();
    fireEvent.click(screen.getByLabelText('Include output 2'));
    expect(screen.getByRole('button', { name: 'Create workbenches' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('does not add a partial set when any selected result is invalid', () => {
    const add = jest.fn();
    render(<AddWorkbenchContext.Provider value={add}><TransformResultsDialog
      results={[results[0], { ...results[1], xml: '<broken>' }]} onClose={jest.fn()} /></AddWorkbenchContext.Provider>);
    fireEvent.click(screen.getByRole('button', { name: 'Create workbenches' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid XML');
    expect(add).not.toHaveBeenCalled();
  });
});
