import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ErdModel } from '../types/erd';
import { ErdEditor } from './erd-editor';

function createModel(tableIds: string[]): ErdModel {
  return {
    tables: tableIds.map((id) => ({
      id,
      name: id,
      clrName: id,
      columns: [],
      navigations: [],
    })),
    relationships: [],
    sourceFiles: [],
    diagnostics: [],
  };
}

describe('ErdEditor context menu', () => {
  it('opens the RHS editor for the entity selected through its context menu', async () => {
    render(<ErdEditor model={createModel(['Customer'])} />);

    fireEvent.contextMenu(document.querySelector('[data-id="Customer"]')!);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit entity' }));

    expect(screen.getByLabelText('Table name')).toHaveValue('Customer');
  });

  it('deletes the context-menu target entity rather than the previously selected entity', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    let updatedModel: ErdModel | undefined;
    const onChange = jest.fn((nextModel: ErdModel) => { updatedModel = nextModel; });
    render(<ErdEditor model={createModel(['Customer', 'Order'])} onChange={onChange} />);

    fireEvent.click(document.querySelector('[data-id="Customer"]')!);
    fireEvent.contextMenu(document.querySelector('[data-id="Order"]')!);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete entity' }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(updatedModel?.tables.map((table) => table.id)).toEqual(['Customer']);
    confirmSpy.mockRestore();
  });

  it('adds an entity from the empty graph context menu and opens it in the RHS editor', async () => {
    let updatedModel = createModel([]);
    const onChange = jest.fn((nextModel: ErdModel) => { updatedModel = nextModel; });
    const { rerender } = render(<ErdEditor model={createModel([])} onChange={onChange} />);
    const pane = document.querySelector('.react-flow__pane');
    expect(pane).toBeTruthy();

    fireEvent.contextMenu(pane!, { button: 2 });
    fireEvent.click(await screen.findByRole('button', { name: 'Add entity' }));
    const viewport = document.querySelector('.react-flow__viewport');
    rerender(<ErdEditor model={updatedModel} onChange={onChange} />);

    expect(await screen.findByLabelText('Table name')).toHaveValue('NewEntity');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      tables: [expect.objectContaining({ id: 'NewEntity', name: 'NewEntity' })],
    }));
    await waitFor(() => {
      expect(viewport).not.toHaveStyle({ transform: 'translate(0px,0px) scale(1)' });
    });
  });
});
