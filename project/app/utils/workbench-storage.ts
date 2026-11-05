import { contentFingerprint, exportWorkbench, type WorkbenchDocument } from '../state/workspace';

export interface WorkbenchSnapshot {
  text: string;
  fingerprint: string;
}

export interface LocalFileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: string): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
  queryPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
}

export interface LocalSaveLocation {
  provider: 'local';
  handle: LocalFileHandle;
  revision: string;
}

export interface WorkbenchStorageProvider<Location> {
  write(snapshot: WorkbenchSnapshot, location: Location): Promise<Location>;
}

type SavePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<LocalFileHandle>;

function savePicker(): SavePicker | undefined {
  return (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
}

export function supportsLocalSave(): boolean {
  return window.isSecureContext && typeof savePicker() === 'function';
}

export function suggestedWorkbenchFilename(name: string): string {
  const base = Array.from(name.replace(/[<>:"/\\|?*]/g, '_'), char =>
    char.charCodeAt(0) < 32 ? '_' : char).join('').replace(/[. ]+$/, '') || 'Workbench';
  const safe = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(base) ? `_${base}` : base;
  return workbenchFilename(safe.slice(0, 230));
}

export function workbenchFilename(value: string): string {
  if (!value.trim() || /[<>:"/\\|?*]/.test(value) || Array.from(value).some(char => char.charCodeAt(0) < 32) || /[. ]$/.test(value)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(value)) {
    throw new Error('Enter a filename without path separators, reserved names or trailing dots/spaces.');
  }
  const filename = /\.workbench\.json$/i.test(value) ? value : `${value}.workbench.json`;
  if (filename.length > 255) throw new Error('The filename must not exceed 255 characters, including its extension.');
  return filename;
}

export function snapshotWorkbench(bench: WorkbenchDocument): WorkbenchSnapshot {
  const snapshot = { ...bench, entries: { ...bench.entries } };
  return { text: exportWorkbench(snapshot), fingerprint: contentFingerprint(snapshot) };
}

export function isPickerCancellation(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export async function chooseLocalFile(filename: string): Promise<LocalFileHandle | null> {
  const picker = savePicker();
  if (!supportsLocalSave() || !picker) throw new Error('Native file saving is unavailable. Use Download Copy instead.');
  try {
    return await picker.call(window, {
      suggestedName: workbenchFilename(filename),
      types: [{ description: 'Schema Sculptor workbench', accept: { 'application/json': ['.workbench.json'] } }],
    });
  } catch (error) {
    if (isPickerCancellation(error)) return null;
    throw error;
  }
}

async function revision(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export class LocalSaveConflictError extends Error {
  constructor() {
    super('The file has changed outside this app. Use Save As to save a separate copy, or reopen the changed file.');
    this.name = 'LocalSaveConflictError';
  }
}

export const localWorkbenchProvider: WorkbenchStorageProvider<LocalSaveLocation> = {
  async write(snapshot, location) {
    const { handle } = location;
    if (handle.queryPermission && await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
      if (!handle.requestPermission || await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
        throw new Error('Permission to write this file was denied. Grant access or use Save As.');
      }
    }
    if (location.revision && await revision(await (await handle.getFile()).text()) !== location.revision) {
      throw new LocalSaveConflictError();
    }
    const nextRevision = await revision(snapshot.text);
    const writable = await handle.createWritable();
    try {
      await writable.write(snapshot.text);
      await writable.close();
    } catch (error) {
      try {
        await writable.abort();
      } catch (abortError) {
        console.error('Failed to abort the workbench file write:', abortError);
      }
      throw error;
    }
    return { provider: 'local', handle, revision: nextRevision };
  },
};

const DATABASE_NAME = 'schema-sculptor-file-locations-v1';
const STORE_NAME = 'locations';

async function locationDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error('File-location storage is blocked by another browser tab. Close the other tab and retry.'));
    };
  });
}

export async function loadLocalLocations(ids: string[]): Promise<Map<string, LocalSaveLocation>> {
  if (!ids.length) return new Map();
  const database = await locationDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const locations = new Map<string, LocalSaveLocation>();
      for (const id of ids) {
        const request = transaction.objectStore(STORE_NAME).get(id);
        request.onsuccess = () => {
          const value: unknown = request.result;
          if (value === undefined) return;
          if (!isLocalLocation(value)) {
            transaction.abort();
            return;
          }
          locations.set(id, value);
        };
      }
      transaction.oncomplete = () => resolve(locations);
      transaction.onerror = () => reject(transaction.error ?? new Error('Unable to read saved file locations.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Invalid saved file location.'));
    });
  } finally {
    database.close();
  }
}

function isLocalLocation(value: unknown): value is LocalSaveLocation {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const handle = record.handle;
  return record.provider === 'local' && typeof record.revision === 'string'
    && !!handle && typeof handle === 'object' && 'kind' in handle && handle.kind === 'file'
    && 'name' in handle && typeof handle.name === 'string'
    && 'getFile' in handle && typeof handle.getFile === 'function'
    && 'createWritable' in handle && typeof handle.createWritable === 'function';
}

export async function storeLocalLocation(id: string, location: LocalSaveLocation | null): Promise<void> {
  const database = await locationDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      if (location) store.put(location, id);
      else store.delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Unable to store the file location.'));
    });
  } finally {
    database.close();
  }
}

export function downloadWorkbenchCopy(snapshot: WorkbenchSnapshot, filename: string): void {
  const downloadName = workbenchFilename(filename);
  const revoke = URL.revokeObjectURL.bind(URL);
  const url = URL.createObjectURL(new Blob([snapshot.text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = downloadName;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Allow the browser to start consuming the download before releasing its URL.
    setTimeout(() => revoke(url), 1000);
  }
}
