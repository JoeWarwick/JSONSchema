import type { MarkupLanguage } from '../utils/markup';
import { canonicalizeForPersist } from './schemaReducer';
import { emptyTransform, parseTransform, TRANSFORM_STORAGE_KEY } from '../utils/transform';
import { emptyOpenApi, parseOpenApi, OPENAPI_STORAGE_KEY } from '../utils/openapi';

export const WORKSPACE_STORAGE_KEY = 'schema-sculptor-workspace-v1';
export type WorkbenchKind = MarkupLanguage | 'erd' | 'transform' | 'openapi';
export type WorkbenchEntries = Record<string, string>;

export interface WorkbenchDocument {
  id: string;
  name: string;
  kind: WorkbenchKind;
  entries: WorkbenchEntries;
  savedContent: string;
}

export interface WorkspaceDocument {
  version: 1;
  activeId: string | null;
  workbenches: WorkbenchDocument[];
}

const contentKeys = new Set([
  'schema-sculptor-schema', 'schema-sculptor-schema-xml',
  'schema-sculptor-instance', 'schema-sculptor-instance-json',
  'schema-sculptor-instance-yaml', 'schema-sculptor-instance-xml',
  'schema-sculptor-erd', 'schema-sculptor-markup-language',
  TRANSFORM_STORAGE_KEY,
  OPENAPI_STORAGE_KEY,
  'schema-sculptor-api-form-origin',
]);

export function contentFingerprint({ name, kind, entries }: Pick<WorkbenchDocument, 'name' | 'kind' | 'entries'>): string {
  const normalized = Object.entries(entries).filter(([key]) => {
    if (!contentKeys.has(key)) return false;
    if (key === 'schema-sculptor-instance' && entries['schema-sculptor-instance-json'] !== undefined) return false;
    return true;
  });
  const content = normalized.map(([key, value]) => [
    key,
    key === 'schema-sculptor-schema' || key === 'schema-sculptor-schema-xml'
      ? JSON.stringify(canonicalizeForPersist(JSON.parse(value))) : value,
  ]);
  return JSON.stringify([name, kind, content.sort(([left], [right]) => left.localeCompare(right))]);
}

export function createWorkbench(kind: WorkbenchKind, id: string, name: string): WorkbenchDocument {
  if (kind === 'openapi') {
    const entries = { [OPENAPI_STORAGE_KEY]: JSON.stringify(emptyOpenApi()) };
    return { id, name, kind, entries, savedContent: contentFingerprint({ name, kind, entries }) };
  }
  if (kind === 'transform') {
    const entries = { [TRANSFORM_STORAGE_KEY]: JSON.stringify(emptyTransform()) };
    return { id, name, kind, entries, savedContent: contentFingerprint({ name, kind, entries }) };
  }
  const entries: WorkbenchEntries = {
    'schema-sculptor-markup-language': kind === 'erd' ? 'json' : kind,
    'schema-sculptor-active-tab': kind === 'erd' ? 'erd' : 'json',
  };
  if (kind === 'xml') {
    entries['schema-sculptor-schema-xml'] = JSON.stringify({
      'xs:schema': { '@attributes': { 'xmlns:xs': 'http://www.w3.org/2001/XMLSchema' } },
    });
  } else {
    entries['schema-sculptor-schema'] = JSON.stringify({ additionalProperties: true, type: 'object' });
  }
  if (kind === 'erd') {
    entries['schema-sculptor-erd'] = JSON.stringify({
      tables: [], relationships: [], sourceFiles: [], diagnostics: [],
    });
  }
  return { id, name, kind, entries, savedContent: contentFingerprint({ name, kind, entries }) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isWorkbench(value: unknown): value is WorkbenchDocument {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0
    && typeof value.name === 'string' && value.name.trim().length > 0
    && ['json', 'yaml', 'xml', 'erd', 'transform', 'openapi'].includes(String(value.kind))
    && isRecord(value.entries) && Object.values(value.entries).every(entry => typeof entry === 'string')
    && typeof value.savedContent === 'string';
}

export function parseWorkspace(text: string): WorkspaceDocument {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.workbenches)
    || !value.workbenches.every(isWorkbench)
    || !(value.activeId === null || typeof value.activeId === 'string')) {
    throw new Error('Invalid or unsupported workspace format.');
  }
  const workbenches = value.workbenches;
  if (new Set(workbenches.map(bench => bench.id)).size !== workbenches.length
    || (workbenches.length === 0 ? value.activeId !== null : !workbenches.some(bench => bench.id === value.activeId))) {
    throw new Error('Workspace contains duplicate IDs or an invalid active workbench.');
  }
  workbenches.forEach(bench => {
    contentFingerprint(bench);
    if (bench.kind === 'transform') parseTransform(bench.entries[TRANSFORM_STORAGE_KEY]);
    if (bench.kind === 'openapi') parseOpenApi(bench.entries[OPENAPI_STORAGE_KEY]);
  });
  return { version: 1, activeId: value.activeId, workbenches };
}

export function exportWorkbench(bench: WorkbenchDocument): string {
  return JSON.stringify({
    format: 'schema-sculptor-workbench', version: 1,
    workbench: { ...bench, savedContent: contentFingerprint(bench) },
  }, null, 2);
}

export function importWorkbench(text: string, id: string): WorkbenchDocument {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || value.format !== 'schema-sculptor-workbench'
    || value.version !== 1 || !isWorkbench(value.workbench)) {
    throw new Error('Invalid or unsupported workbench file.');
  }
  if (value.workbench.kind === 'transform') parseTransform(value.workbench.entries[TRANSFORM_STORAGE_KEY]);
  if (value.workbench.kind === 'openapi') parseOpenApi(value.workbench.entries[OPENAPI_STORAGE_KEY]);
  return { ...value.workbench, id, savedContent: contentFingerprint(value.workbench) };
}

export function migrateLegacyWorkspace(storage: Storage): WorkspaceDocument {
  const bench = createWorkbench('json', 'legacy', 'Restored workbench');
  bench.entries = {};
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && (contentKeys.has(key) || key === 'schema-sculptor-active-tab'
      || key === 'schema-sculptor-graph-collapse-state' || key === 'schema-editor-expanded-nodes'
      || key.startsWith('json-instance-variants:') || key.startsWith('xml-instance-')
      || key.startsWith('choice_') || key.startsWith('xml-schema-'))) {
      const value = storage.getItem(key);
      if (value !== null) bench.entries[key] = value;
    }
  }
  if (Object.keys(bench.entries).length === 0) {
    const initial = createWorkbench('json', 'initial', 'JSON 1');
    return { version: 1, activeId: initial.id, workbenches: [initial] };
  }
  const language = bench.entries['schema-sculptor-markup-language'];
  bench.kind = bench.entries['schema-sculptor-active-tab'] === 'erd' ? 'erd'
    : language === 'xml' || language === 'yaml' ? language : 'json';
  bench.entries = { ...createWorkbench(bench.kind, bench.id, bench.name).entries, ...bench.entries };
  bench.savedContent = contentFingerprint(bench);
  return { version: 1, activeId: bench.id, workbenches: [bench] };
}

export function createWorkbenchStorage(entries: WorkbenchEntries, onChange: () => void): Storage {
  return {
    get length() { return Object.keys(entries).length; },
    key(index) { return Object.keys(entries)[index] ?? null; },
    getItem(key) { return Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : null; },
    setItem(key, value) {
      if (entries[key] === value) return;
      Object.defineProperty(entries, key, { value, writable: true, enumerable: true, configurable: true });
      onChange();
    },
    removeItem(key) {
      if (!Object.prototype.hasOwnProperty.call(entries, key)) return;
      delete entries[key];
      onChange();
    },
    clear() {
      if (Object.keys(entries).length === 0) return;
      Object.keys(entries).forEach(key => delete entries[key]);
      onChange();
    },
  };
}
