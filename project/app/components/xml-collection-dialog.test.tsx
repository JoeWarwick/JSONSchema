import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AddWorkbenchContext } from '../state/workbench-context';
import { XmlCollectionDialog } from './xml-collection-dialog';
import { datasourceSchema } from '../utils/transform-datasource';

describe('XML collection dialog', () => {
  it('allows choosing an XSD-only root and creates a new workbench with a repeatable record', () => {
    const add = jest.fn();
    const close = jest.fn();
    const schema = '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="person" type="xs:string"/><xs:element name="employee" type="xs:string"/></xs:schema>';
    render(<AddWorkbenchContext.Provider value={add}>
      <XmlCollectionDialog input={{ xml: '', schema }} onClose={close} />
    </AddWorkbenchContext.Provider>);
    fireEvent.change(screen.getByLabelText('Record element'), { target: { value: 'employee' } });
    fireEvent.change(screen.getByLabelText('Collection root name'), { target: { value: 'employees' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create collection' }));
    expect(add).toHaveBeenCalledTimes(1);
    const [bench, activate] = add.mock.calls[0];
    expect(activate).toBe(true);
    expect(bench.name).toBe('employees');
    expect(datasourceSchema(bench)).toContain('name="employee"');
    expect(datasourceSchema(bench)).toContain('maxOccurs="unbounded"');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('shows conversion errors without creating a workbench and supports cancelling', () => {
    const add = jest.fn();
    const close = jest.fn();
    render(<AddWorkbenchContext.Provider value={add}>
      <XmlCollectionDialog input={{ xml: '<person/>', schema: '' }} onClose={close} />
    </AddWorkbenchContext.Provider>);
    expect(screen.getByLabelText('Record element')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Collection root name'), { target: { value: 'bad:name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create collection' }));
    expect(screen.getByRole('alert')).toHaveTextContent('no prefix');
    expect(add).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalled();
  });

  it('validates both collections before adding either and submits them as one workspace update', () => {
    const add = jest.fn();
    const close = jest.fn();
    const created = jest.fn();
    render(<AddWorkbenchContext.Provider value={add}>
      <XmlCollectionDialog input={{ xml: '<person/>', schema: '' }}
        targetInput={{ xml: '<employee/>', schema: '' }} onPairCreated={created} onClose={close} />
    </AddWorkbenchContext.Provider>);
    fireEvent.change(screen.getByLabelText('Target collection root name'), { target: { value: 'invalid:name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create collections' }));
    expect(screen.getByRole('alert')).toHaveTextContent('no prefix');
    expect(add).not.toHaveBeenCalled();
    expect(created).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Target collection root name'), { target: { value: 'employees' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create collections' }));
    expect(add).toHaveBeenCalledTimes(1);
    const [benches, activate] = add.mock.calls[0];
    expect(activate).toBe(false);
    expect(benches.map((bench: { name: string }) => bench.name)).toEqual(['persons', 'employees']);
    expect(benches[0].entries['schema-sculptor-instance-xml']).toBe('<persons><person/></persons>');
    expect(benches[1].entries['schema-sculptor-instance-xml']).toBe('<employees><employee/></employees>');
    expect(created).toHaveBeenCalledWith(...benches);
  });

  it('cancels paired creation without modifying the workspace', () => {
    const add = jest.fn();
    const close = jest.fn();
    render(<AddWorkbenchContext.Provider value={add}>
      <XmlCollectionDialog input={{ xml: '<person/>', schema: '' }}
        targetInput={{ xml: '<employee/>', schema: '' }} onClose={close} />
    </AddWorkbenchContext.Provider>);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(add).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
