import {
  contentFingerprint, createWorkbench, createWorkbenchStorage, exportWorkbench, importWorkbench,
  migrateLegacyWorkspace, parseWorkspace,
} from './workspace';
import { parseTransform, TRANSFORM_STORAGE_KEY } from '../utils/transform';

describe('workspace persistence', () => {
  beforeEach(() => localStorage.clear());

  it('isolates documents with identical schema and variant keys', () => {
    const left = createWorkbench('json', 'left', 'Left');
    const right = createWorkbench('json', 'right', 'Right');
    const changed = jest.fn();
    const leftStorage = createWorkbenchStorage(left.entries, changed);
    const rightStorage = createWorkbenchStorage(right.entries, changed);
    leftStorage.setItem('schema-sculptor-schema', '{"type":"string"}');
    rightStorage.setItem('schema-sculptor-schema', '{"type":"number"}');
    leftStorage.setItem('json-instance-variants:shared', 'left');
    rightStorage.setItem('json-instance-variants:shared', 'right');
    leftStorage.removeItem('json-instance-variants:shared');
    expect(rightStorage.getItem('json-instance-variants:shared')).toBe('right');
    expect(leftStorage.getItem('schema-sculptor-schema')).toBe('{"type":"string"}');
    expect(localStorage.length).toBe(0);
    const calls = changed.mock.calls.length;
    leftStorage.setItem('schema-sculptor-schema', '{"type":"string"}');
    expect(changed).toHaveBeenCalledTimes(calls);
  });

  it('migrates language-specific content, ERD and view state without deleting legacy storage', () => {
    localStorage.setItem('schema-sculptor-markup-language', 'xml');
    localStorage.setItem('schema-sculptor-schema-xml', '{"xs:schema":{}}');
    localStorage.setItem('schema-sculptor-instance-json', '{"legacy":true}');
    localStorage.setItem('schema-sculptor-erd', '{"tables":[]}');
    localStorage.setItem('xml-schema-layout:example:', '["root"]');
    localStorage.setItem('schema-sculptor-locale', 'fr');
    const value = migrateLegacyWorkspace(localStorage);
    expect(value.workbenches[0].kind).toBe('xml');
    expect(value.workbenches[0].entries['schema-sculptor-instance-json']).toBe('{"legacy":true}');
    expect(value.workbenches[0].entries['schema-sculptor-erd']).toBe('{"tables":[]}');
    expect(value.workbenches[0].entries['xml-schema-layout:example:']).toBe('["root"]');
    expect(value.workbenches[0].entries['schema-sculptor-locale']).toBeUndefined();
    expect(localStorage.getItem('schema-sculptor-schema-xml')).toBe('{"xs:schema":{}}');
    expect(parseWorkspace(JSON.stringify(value))).toEqual(value);
  });

  it('round-trips an editable workbench and assigns a fresh ID on import', () => {
    const bench = createWorkbench('xml', 'original', 'Orders');
    bench.entries['schema-sculptor-instance-xml'] = '<orders/>';
    const reopened = importWorkbench(exportWorkbench(bench), 'new');
    expect(reopened.id).toBe('new');
    expect(reopened.entries).toEqual(bench.entries);
    expect(reopened.savedContent).toBe(contentFingerprint(reopened));
  });

  it('does not mark view navigation as a content modification', () => {
    const bench = createWorkbench('json', 'one', 'One');
    bench.entries['schema-sculptor-active-tab'] = 'schema';
    bench.entries['schema-sculptor-graph-collapse-state'] = '{}';
    expect(contentFingerprint(bench)).toBe(bench.savedContent);
    bench.entries['schema-sculptor-instance-json'] = '{"changed":true}';
    expect(contentFingerprint(bench)).not.toBe(bench.savedContent);
  });

  it('marks renamed workbenches as modified', () => {
    const bench = createWorkbench('json', 'one', 'Original');
    bench.name = 'Renamed';
    expect(contentFingerprint(bench)).not.toBe(bench.savedContent);
    bench.name = 'Original';
    expect(contentFingerprint(bench)).toBe(bench.savedContent);
  });

  it('does not mark canonical schema key ordering as a user edit', () => {
    const bench = createWorkbench('json', 'one', 'One');
    bench.entries['schema-sculptor-schema'] = '{"type":"object","additionalProperties":true}';
    expect(contentFingerprint(bench)).toBe(bench.savedContent);
  });

  it.each([
    '{',
    '{"version":2,"workbenches":[],"activeId":null}',
    '{"version":1,"workbenches":[],"activeId":"missing"}',
    JSON.stringify({ version: 1, activeId: 'bad', workbenches: [{
      ...createWorkbench('json', 'bad', 'Bad'), entries: { 'schema-sculptor-schema': '{invalid' },
    }] }),
    JSON.stringify({ version: 1, activeId: 'same', workbenches: [
      createWorkbench('json', 'same', 'One'), createWorkbench('xml', 'same', 'Two'),
    ] }),
  ])('rejects invalid workspace data instead of overwriting it: %s', text => {
    expect(() => parseWorkspace(text)).toThrow();
  });

  it('supports closing every workbench without resurrecting a legacy session', () => {
    expect(parseWorkspace('{"version":1,"activeId":null,"workbenches":[]}').workbenches).toEqual([]);
  });

  it('exports, imports and tracks Transform definitions independently of the selected view', () => {
    const bench = createWorkbench('transform', 'mapping', 'Mapping');
    const reopened = importWorkbench(exportWorkbench(bench), 'reopened');
    const definition = parseTransform(reopened.entries[TRANSFORM_STORAGE_KEY]);
    definition.input = '<input/>';
    reopened.entries[TRANSFORM_STORAGE_KEY] = JSON.stringify(definition);
    expect(contentFingerprint(reopened)).not.toBe(reopened.savedContent);
    expect(reopened.entries['schema-sculptor-schema']).toBeUndefined();
  });
});
