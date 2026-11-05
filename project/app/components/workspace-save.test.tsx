import React, { useContext } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Workspace } from './workspace';
import { Menubar } from './ui/menubar/menubar';
import { WorkbenchContext } from '../state/workbench-context';
import { contentFingerprint, createWorkbench, parseWorkspace, WORKSPACE_STORAGE_KEY } from '../state/workspace';
import {
  chooseLocalFile, downloadWorkbenchCopy, loadLocalLocations, localWorkbenchProvider, storeLocalLocation,
  supportsLocalSave, type LocalSaveLocation, type WorkbenchSnapshot,
} from '../utils/workbench-storage';

jest.mock('../utils/workbench-storage', () => ({
  ...jest.requireActual('../utils/workbench-storage'),
  supportsLocalSave: jest.fn(),
  chooseLocalFile: jest.fn(),
  loadLocalLocations: jest.fn(),
  storeLocalLocation: jest.fn(),
  downloadWorkbenchCopy: jest.fn(),
  localWorkbenchProvider: { write: jest.fn() },
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

const location: LocalSaveLocation = {
  provider: 'local', revision: 'old-revision',
  handle: {
    kind: 'file', name: 'One.workbench.json',
    getFile: jest.fn(), createWritable: jest.fn(),
  },
};
const supports = jest.mocked(supportsLocalSave);
const choose = jest.mocked(chooseLocalFile);
const write = jest.mocked(localWorkbenchProvider.write);
const load = jest.mocked(loadLocalLocations);
const store = jest.mocked(storeLocalLocation);
let storage: Storage;

function TestEditor({ menu }: { menu: React.ReactNode }) {
  const context = useContext(WorkbenchContext);
  if (!context) throw new Error('Missing workbench context');
  storage = context.storage;
  return <><Menubar>{menu}</Menubar><label>Draft<input onChange={event =>
    context.storage.setItem('schema-sculptor-instance-json', event.target.value)} /></label></>;
}

async function menuItem(name: string) {
  fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'File' }), { button: 0 });
  const item = await screen.findByRole('menuitem', { name });
  await waitFor(() => expect(item).not.toHaveAttribute('data-disabled'));
  fireEvent.click(item);
}

async function setup() {
  const bench = createWorkbench('json', 'one', 'One');
  localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({ version: 1, activeId: 'one', workbenches: [bench] }));
  const view = render(<Workspace renderWorkbench={menu => <TestEditor menu={menu} />} />);
  await screen.findByRole('tab', { name: /One/ });
  await waitFor(() => expect(load).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText('Draft'), { target: { value: '{"draft":1}' } });
  await waitFor(() => expect(savedBench().savedContent).not.toBe(contentFingerprint(savedBench())));
  return view;
}

function savedBench() {
  return parseWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)!).workbenches[0];
}

describe('local workbench saving', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    supports.mockReturnValue(true);
    load.mockResolvedValue(new Map());
    store.mockResolvedValue();
    choose.mockResolvedValue(location.handle);
    write.mockResolvedValue(location);
  });

  it('saves a new destination and subsequent Save writes there without another picker', async () => {
    await setup();
    await menuItem('Save Workbench...');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Filename')).toHaveValue('One.workbench.json');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save File...' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(choose).toHaveBeenCalledTimes(1);
    expect(store).toHaveBeenCalledWith('one', location);
    await waitFor(() => expect(savedBench().savedContent).toBe(contentFingerprint(savedBench())));
    fireEvent.change(screen.getByLabelText('Draft'), { target: { value: '{"draft":2}' } });
    await menuItem('Save Workbench...');
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(choose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(savedBench().savedContent).toBe(contentFingerprint(savedBench())));
  });

  it('restores the remembered destination and Save As selects a new one', async () => {
    load.mockResolvedValue(new Map([['one', location]]));
    await setup();
    await menuItem('Save Workbench...');
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(choose).not.toHaveBeenCalled();
    await menuItem('Save Workbench As...');
    fireEvent.change(await screen.findByLabelText('Filename'), { target: { value: 'Another' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save File...' }));
    await waitFor(() => expect(choose).toHaveBeenCalledWith('Another.workbench.json'));
  });

  it('does not change the saved baseline or existing destination when the picker is cancelled', async () => {
    load.mockResolvedValue(new Map([['one', location]]));
    choose.mockResolvedValueOnce(null);
    await setup();
    await menuItem('Save Workbench As...');
    fireEvent.click(await screen.findByRole('button', { name: 'Save File...' }));
    await waitFor(() => expect(choose).toHaveBeenCalled());
    expect(write).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(savedBench().savedContent).not.toBe(contentFingerprint(savedBench()));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await menuItem('Save Workbench...');
    await waitFor(() => expect(write).toHaveBeenCalledWith(expect.anything(), location));
  });

  it('shows invalid filenames inline without opening a picker or starting a write', async () => {
    await setup();
    await menuItem('Save Workbench...');
    fireEvent.change(await screen.findByLabelText('Filename'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save File...' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a filename');
    fireEvent.change(screen.getByLabelText('Filename'), { target: { value: 'folder/file' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save File...' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('path separators');
    expect(choose).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('preserves edits made during a write and keeps Save and Close open for newer changes', async () => {
    load.mockResolvedValue(new Map([['one', location]]));
    let finish: ((value: LocalSaveLocation) => void) | undefined;
    let snapshot: WorkbenchSnapshot | undefined;
    write.mockImplementationOnce(value => {
      snapshot = value;
      return new Promise(resolve => { finish = resolve; });
    });
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Close One' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save and Close' }));
    await waitFor(() => expect(write).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Save and Close' })).toBeDisabled();
    act(() => storage.setItem('schema-sculptor-instance-json', '{"newer":true}'));
    await act(async () => finish?.(location));
    expect(screen.getByRole('tab', { name: /One/, hidden: true })).toBeInTheDocument();
    await waitFor(() => expect(savedBench().savedContent).toBe(snapshot?.fingerprint));
    expect(savedBench().savedContent).not.toBe(contentFingerprint(savedBench()));
    expect(JSON.parse(snapshot!.text).workbench.entries['schema-sculptor-instance-json']).toBe('{"draft":1}');
    expect(screen.getByRole('dialog')).toHaveTextContent('changes that have not been saved');
  });

  it('waits for the file write before closing and prevents duplicate close/save actions', async () => {
    load.mockResolvedValue(new Map([['one', location]]));
    let finish: ((value: LocalSaveLocation) => void) | undefined;
    write.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Close One' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save and Close' }));
    expect(screen.getByRole('tab', { name: /One/, hidden: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save and Close' }));
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => finish?.(location));
    await waitFor(() => expect(screen.queryByRole('tab')).not.toBeInTheDocument());
    expect(store).toHaveBeenCalledWith('one', null);
  });

  it('keeps dirty content and the dialog open on failed writes', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    write.mockRejectedValueOnce(new Error('Disk full'));
    await setup();
    await menuItem('Save Workbench...');
    fireEvent.click(await screen.findByRole('button', { name: 'Save File...' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk full');
    expect(savedBench().savedContent).not.toBe(contentFingerprint(savedBench()));
    expect(store).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('does not report failed saves when only remembering the successful destination fails', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    store.mockRejectedValueOnce(new Error('IndexedDB quota exceeded'));
    await setup();
    await menuItem('Save Workbench...');
    fireEvent.click(await screen.findByRole('button', { name: 'Save File...' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('file was saved');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(savedBench().savedContent).toBe(contentFingerprint(savedBench())));
    log.mockRestore();
  });

  it('keeps downloaded copies distinct from confirmed saves and does not close on download', async () => {
    await setup();
    supports.mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Close One' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save and Close' }));
    expect(await screen.findByText(/cannot write directly/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download Copy' }));
    expect(downloadWorkbenchCopy).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Download requested, not confirmed');
    expect(savedBench().savedContent).not.toBe(contentFingerprint(savedBench()));
    expect(write).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: 'Discard' })).toBeInTheDocument();
  });
});
