import { createHash } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { createWorkbench, importWorkbench } from '../state/workspace';
import {
  chooseLocalFile, loadLocalLocations, localWorkbenchProvider, LocalSaveConflictError,
  snapshotWorkbench, storeLocalLocation, suggestedWorkbenchFilename, supportsLocalSave, workbenchFilename,
  type LocalFileHandle,
} from './workbench-storage';

function fakeHandle(initial = '') {
  let text = initial;
  const writable = {
    write: jest.fn(async (value: string) => { text = value; }),
    close: jest.fn(async () => {}),
    abort: jest.fn(async () => {}),
  };
  const handle: LocalFileHandle = {
    kind: 'file', name: 'Test.workbench.json',
    getFile: jest.fn(async () => ({ text: async () => text } as File)),
    createWritable: jest.fn(async () => writable),
    queryPermission: jest.fn(async () => 'granted'),
    requestPermission: jest.fn(async () => 'granted'),
  };
  return { handle, writable, externalEdit: (value: string) => { text = value; } };
}

describe('workbench local storage', () => {
  beforeAll(() => {
    Object.defineProperty(global, 'TextEncoder', { configurable: true, value: TextEncoder });
    Object.defineProperty(crypto, 'subtle', {
      configurable: true, value: {
        digest: async (_algorithm: string, value: Uint8Array) =>
          new Uint8Array(createHash('sha256').update(value).digest()).buffer,
      },
    });
  });

  it.each(['json', 'yaml', 'xml', 'erd', 'transform', 'openapi'] as const)(
    'captures an immutable portable %s workbench snapshot', kind => {
      const bench = createWorkbench(kind, 'original', 'Original');
      const snapshot = snapshotWorkbench(bench);
      bench.name = 'Later edits';
      bench.entries.later = 'not in snapshot';
      const reopened = importWorkbench(snapshot.text, 'reopened');
      expect(reopened.name).toBe('Original');
      expect(reopened.entries.later).toBeUndefined();
      expect(reopened.savedContent).toBe(snapshot.fingerprint);
      expect(snapshot.text).not.toContain('"handle"');
    },
  );

  it('normalizes suggestions, appends the extension once and validates unsafe names', () => {
    expect(suggestedWorkbenchFilename('Orders / Draft')).toBe('Orders _ Draft.workbench.json');
    expect(suggestedWorkbenchFilename('CON')).toBe('_CON.workbench.json');
    expect(workbenchFilename('Orders')).toBe('Orders.workbench.json');
    expect(workbenchFilename('Orders.WORKBENCH.JSON')).toBe('Orders.WORKBENCH.JSON');
    for (const name of ['', ' ', 'file.', 'file ', 'a/b', 'a\\b', 'CON.json', 'nul', 'bad\u0000', 'a'.repeat(256)]) {
      expect(() => workbenchFilename(name)).toThrow();
    }
  });

  it('writes and closes before returning a destination revision', async () => {
    const { handle, writable } = fakeHandle();
    const snapshot = snapshotWorkbench(createWorkbench('json', 'one', 'One'));
    const location = await localWorkbenchProvider.write(snapshot, { provider: 'local', handle, revision: '' });
    expect(writable.write).toHaveBeenCalledWith(snapshot.text);
    expect(writable.close).toHaveBeenCalledTimes(1);
    expect(location.revision).toBe(createHash('sha256').update(snapshot.text).digest('hex'));
    await localWorkbenchProvider.write(snapshot, location);
    expect(writable.write).toHaveBeenCalledTimes(2);
  });

  it('detects external modifications and never overwrites the changed file', async () => {
    const { handle, writable, externalEdit } = fakeHandle();
    const snapshot = snapshotWorkbench(createWorkbench('json', 'one', 'One'));
    const location = await localWorkbenchProvider.write(snapshot, { provider: 'local', handle, revision: '' });
    externalEdit('other application changes');
    await expect(localWorkbenchProvider.write(snapshot, location)).rejects.toBeInstanceOf(LocalSaveConflictError);
    expect(writable.write).toHaveBeenCalledTimes(1);
  });

  it('requests renewed write permission and does not write when denied', async () => {
    const { handle, writable } = fakeHandle();
    handle.queryPermission = jest.fn(async () => 'prompt');
    handle.requestPermission = jest.fn(async () => 'denied');
    const snapshot = snapshotWorkbench(createWorkbench('json', 'one', 'One'));
    await expect(localWorkbenchProvider.write(snapshot, { provider: 'local', handle, revision: '' }))
      .rejects.toThrow('denied');
    expect(handle.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
    expect(writable.write).not.toHaveBeenCalled();
  });

  it('aborts failed writes and propagates disk errors instead of reporting success', async () => {
    const { handle, writable } = fakeHandle();
    writable.close.mockRejectedValueOnce(new DOMException('Disk full', 'QuotaExceededError'));
    await expect(localWorkbenchProvider.write(snapshotWorkbench(createWorkbench('xml', 'one', 'One')), {
      provider: 'local', handle, revision: '',
    })).rejects.toThrow('Disk full');
    expect(writable.abort).toHaveBeenCalled();
  });

  it('treats only native-picker cancellation as cancellation, not permission or write failures', async () => {
    const picker = jest.fn();
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: picker });
    try {
      expect(supportsLocalSave()).toBe(true);
      const { handle } = fakeHandle();
      picker.mockResolvedValueOnce(handle);
      expect(await chooseLocalFile('One')).toBe(handle);
      expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'One.workbench.json' }));
      picker.mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError'));
      expect(await chooseLocalFile('One')).toBeNull();
      picker.mockRejectedValueOnce(new DOMException('Not allowed', 'SecurityError'));
      await expect(chooseLocalFile('One')).rejects.toThrow('Not allowed');
    } finally {
      Reflect.deleteProperty(window, 'showSaveFilePicker');
      Reflect.deleteProperty(window, 'isSecureContext');
    }
  });

  it('reports unavailable IndexedDB storage rather than silently dropping locations', async () => {
    await expect(loadLocalLocations(['one'])).rejects.toThrow();
    await expect(storeLocalLocation('one', null)).rejects.toThrow();
    expect(await loadLocalLocations([])).toEqual(new Map());
  });
});
