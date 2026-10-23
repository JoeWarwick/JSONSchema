import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import WorkspaceRoute from '../routes/workbench';
import { contentFingerprint, createWorkbench, parseWorkspace, WORKSPACE_STORAGE_KEY } from '../state/workspace';

async function openFileMenu() {
  fireEvent.pointerDown(screen.getByRole('menuitem', { name: /^File$/ }), { button: 0 });
}

async function newWorkbench(label: string) {
  await openFileMenu();
  const newItem = await screen.findByRole('menuitem', { name: /^New$/ });
  fireEvent.keyDown(newItem, { key: 'ArrowRight' });
  fireEvent.click(await screen.findByRole('menuitem', { name: label }));
}

describe('workspace integration', () => {
  beforeEach(() => localStorage.clear());

  it('creates typed workbenches, preserves input/view state and restores the active tab after remount', async () => {
    const view = render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: /JSON 1/ });
    const firstInput = await screen.findByPlaceholderText(/Paste your JSON here/);
    fireEvent.change(firstInput, { target: { value: '{"first":1}' } });
    fireEvent.click(screen.getByRole('button', { name: /^Schema Input$/ }));

    await newWorkbench('YAML Workbench');
    await screen.findByRole('tab', { name: /YAML 1/ });
    const yamlInput = await screen.findByPlaceholderText(/Paste your YAML here/);
    fireEvent.change(yamlInput, { target: { value: 'second: 2' } });

    fireEvent.click(screen.getByRole('tab', { name: /JSON 1/ }));
    expect(screen.getByText('Schema Input', { selector: 'h2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^JSON Input$/ }));
    expect(screen.getByPlaceholderText(/Paste your JSON here/)).toHaveValue('{"first":1}');
    fireEvent.click(screen.getByRole('tab', { name: /YAML 1/ }));
    expect(screen.getByPlaceholderText(/Paste your YAML here/)).toHaveValue('second: 2');

    await waitFor(() => {
      const saved = parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
      expect(saved.workbenches).toHaveLength(2);
      expect(saved.workbenches[1].entries['schema-sculptor-instance-yaml']).toBe('second: 2');
      expect(saved.activeId).toBe(saved.workbenches[1].id);
    });
    view.unmount();
    render(<WorkspaceRoute />);
    expect(await screen.findByRole('tab', { name: /YAML 1/ })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByPlaceholderText(/Paste your YAML here/)).toHaveValue('second: 2'));
  });

  it('protects modified workbenches and supports keyboard tab navigation and closing the last tab', async () => {
    render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: /JSON 1/ });
    fireEvent.change(await screen.findByPlaceholderText(/Paste your JSON here/), { target: { value: '{"keep":true}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close JSON 1' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByPlaceholderText(/Paste your JSON here/)).toHaveValue('{"keep":true}');

    await newWorkbench('Entity Workbench');
    expect(await screen.findByRole('tab', { name: /Entity 1/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: /^Entity Graph$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(JSON Input|Instance Form|Schema Input|Schema Form|Schema Graph)$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^Schema$/ })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^ERD$/ })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('tab', { name: /Entity 1/ }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: /JSON 1/ })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Close Entity 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close JSON 1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!).workbenches).toHaveLength(0);
  });

  it('migrates legacy content without overwriting the old storage keys', async () => {
    localStorage.setItem('schema-sculptor-instance-json', '{"legacy":true}');
    render(<WorkspaceRoute />);
    await waitFor(() => expect(screen.getByPlaceholderText(/Paste your JSON here/)).toHaveValue('{"legacy":true}'));
    fireEvent.change(screen.getByPlaceholderText(/Paste your JSON here/), { target: { value: '{"new":true}' } });
    await waitFor(() => {
      const saved = parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
      expect(saved.workbenches[0].entries['schema-sculptor-instance-json']).toBe('{"new":true}');
    });
    expect(localStorage.getItem('schema-sculptor-instance-json')).toBe('{"legacy":true}');
  });

  it('restores invalid in-progress input instead of discarding it', async () => {
    const bench = createWorkbench('json', 'invalid', 'Draft');
    bench.entries['schema-sculptor-instance-json'] = '{"unfinished":';
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({ version: 1, activeId: bench.id, workbenches: [bench] }));
    render(<WorkspaceRoute />);
    await waitFor(() => expect(screen.getByPlaceholderText(/Paste your JSON here/)).toHaveValue('{"unfinished":'));
    await waitFor(() => {
      expect(parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!).workbenches[0].entries['schema-sculptor-instance-json'])
        .toBe('{"unfinished":');
    });
  });

  it('exports and reopens an editable workbench without replacing the current document', async () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let blob: Blob | undefined;
    URL.createObjectURL = jest.fn((value: Blob | MediaSource) => {
      if (value instanceof Blob) blob = value;
      return 'blob:workbench';
    });
    URL.revokeObjectURL = jest.fn();
    try {
      render(<WorkspaceRoute />);
      fireEvent.change(await screen.findByPlaceholderText(/Paste your JSON here/), { target: { value: '{"saved":42}' } });
      await openFileMenu();
      fireEvent.click(await screen.findByRole('menuitem', { name: /Save Workbench/ }));
      await waitFor(() => expect(blob).toBeDefined());
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsText(blob!);
      });
      const file = new File([text], 'saved.workbench.json', { type: 'application/json' });
      Object.defineProperty(file, 'text', { value: async () => text });
      fireEvent.change(screen.getByLabelText('Open...'), { target: { files: [file] } });
      await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));
      await waitFor(() => expect(within(screen.getByRole('tabpanel')).getByPlaceholderText(/Paste your JSON here/))
        .toHaveValue('{"saved":42}'));
      await waitFor(() => {
        const saved = parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
        expect(saved.workbenches[0].savedContent).toBe(contentFingerprint(saved.workbenches[0]));
      });
    } finally {
      click.mockRestore();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it('leaves corrupt persisted workspaces untouched and shows an explicit error', async () => {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, '{corrupt');
    render(<WorkspaceRoute />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to restore');
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe('{corrupt');
  });

  it('opens JSON schemas and XML instances into new workbenches and keeps their state isolated', async () => {
    render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: /JSON 1/ });
    const schemaText = '{"type":"object","properties":{"name":{"type":"string"}}}';
    const schema = new File([schemaText], 'person.json');
    Object.defineProperty(schema, 'text', { value: async () => schemaText });
    fireEvent.change(screen.getByLabelText('Open...'), { target: { files: [schema] } });
    const schemaDialog = await screen.findByRole('dialog');
    fireEvent.click(within(schemaDialog).getByRole('button', { name: /^Schema$/ }));
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));
    await waitFor(() => {
      expect(within(screen.getByRole('tabpanel')).getByText('Schema Input', { selector: 'h2' })).toBeInTheDocument();
    });

    const xml = new File(['<orders><id>7</id></orders>'], 'orders.xml');
    Object.defineProperty(xml, 'text', { value: async () => '<orders><id>7</id></orders>' });
    fireEvent.change(screen.getByLabelText('Open...'), { target: { files: [xml] } });
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Instance data' }));
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(3));
    await waitFor(() => {
      const saved = parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
      const xmlBench = saved.workbenches[2];
      expect(xmlBench.entries['schema-sculptor-instance-xml']).toContain('<orders>');
      expect(xmlBench.entries['schema-sculptor-schema-xml']).toContain('xs:schema');
      expect(xmlBench.entries['schema-sculptor-schema']).toBeUndefined();
      expect(saved.workbenches[1].entries['schema-sculptor-schema']).toContain('"name"');
      expect(contentFingerprint(saved.workbenches[1])).toBe(saved.workbenches[1].savedContent);
      expect(contentFingerprint(xmlBench)).toBe(xmlBench.savedContent);
    });
    expect(screen.getByRole('radio', { name: 'XML' })).toHaveAttribute('aria-checked', 'true');
  });

  it('renames a workbench and protects the changed name on close', async () => {
    render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: /JSON 1/ });
    await openFileMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: /Rename Workbench/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Customers' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('tab', { name: /Customers/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close Customers' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Customers');
  });

  it.each(['json', 'yaml', 'xml'] as const)('hides Entity Graph and ignores a stale ERD view in a %s workbench', async kind => {
    const bench = createWorkbench(kind, 'document', 'Document');
    bench.entries['schema-sculptor-active-tab'] = 'erd';
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({ version: 1, activeId: bench.id, workbenches: [bench] }));
    render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: /Document/ });
    expect(screen.queryByRole('button', { name: 'Entity Graph' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'ERD' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Schema Graph' })).toBeInTheDocument();
    await waitFor(() => {
      const saved = parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!);
      expect(saved.workbenches[0].entries['schema-sculptor-active-tab']).toBe('json');
    });
    expect(screen.getByRole('heading', { name: `${kind.toUpperCase()} Input` })).toBeInTheDocument();
  });

  it('restores an Entity workbench to its sole graph view even when an old schema view was saved', async () => {
    const bench = createWorkbench('erd', 'entity', 'Entities');
    bench.entries['schema-sculptor-active-tab'] = 'schema';
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({ version: 1, activeId: bench.id, workbenches: [bench] }));
    render(<WorkspaceRoute />);
    await screen.findByRole('tab', { name: /Entities/ });
    expect(screen.getByRole('button', { name: 'Entity Graph' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Schema Form' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Add Entity' })).toBeInTheDocument();
    await waitFor(() => {
      expect(parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!).workbenches[0].entries['schema-sculptor-active-tab']).toBe('erd');
    });
  });
});
