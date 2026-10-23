import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createWorkbench, exportWorkbench, importWorkbench, contentFingerprint } from '../state/workspace';
import { emptyOpenApi, generateOpenApi, newApiEndpoint, OPENAPI_STORAGE_KEY, parseOpenApi, type ApiSource } from './openapi';
import { snapshotApiSource } from './openapi-source';
import { parseMarkup } from './markup';

export function entityFixture() {
  const bench = createWorkbench('erd', 'entity', 'Store');
  bench.entries['schema-sculptor-erd'] = JSON.stringify({
    tables: [{
      id: 'Customers', name: 'Customers', clrName: 'Customer', navigations: [],
      columns: [
        { name: 'TenantId', type: 'Guid', isNullable: false, isPrimaryKey: true, isForeignKey: false },
        { name: 'Id', type: 'int', isNullable: false, isPrimaryKey: true, isForeignKey: false },
        { name: 'Name', type: 'string', isNullable: false, isPrimaryKey: false, isForeignKey: false },
        { name: 'Email', type: 'string', isNullable: true, isPrimaryKey: false, isForeignKey: false },
      ],
    }], relationships: [], sourceFiles: [], diagnostics: [],
  });
  return bench;
}

describe('OpenAPI 3.1 generation', () => {
  it('converts ERD columns and composite keys into editable CRUD proposals and validates against the official schema', async () => {
    const source = await snapshotApiSource(entityFixture());
    const definition = { ...emptyOpenApi(), sources: [source], endpoints: source.proposals, server: 'https://api.example.test/v1' };
    const document = generateOpenApi(definition);
    expect(source.proposals).toHaveLength(5);
    expect(source.proposals[0]).toMatchObject({ method: 'get', responseArray: true, path: '/Customers' });
    expect(source.proposals[2]).toMatchObject({
      path: '/Customers/{TenantId}/{Id}',
      parameters: [{ name: 'TenantId', schema: { type: 'string', format: 'uuid' } }, { name: 'Id', schema: { type: 'integer', format: 'int32' } }],
    });
    expect(source.schemas.Store_Customers).toMatchObject({
      type: 'object', required: ['TenantId', 'Id', 'Name'],
      properties: { Email: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
    });
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    // AJV cannot resolve this document's nested dynamic anchor correctly. There
    // are no dialect overrides here, so bind it to the same local schema rule.
    const officialSchema = JSON.parse(readFileSync(resolve(process.cwd(), 'public', 'schemas', 'openapi-3.1.schema.json'), 'utf8'), (_key, value) =>
      value?.$dynamicRef === '#meta' ? { $ref: '#/$defs/schema' } : value);
    const validate = ajv.compile(officialSchema);
    const valid = validate(document);
    if (!valid) throw new Error(JSON.stringify(validate.errors, null, 2));
    expect(valid).toBe(true);
    expect(validate.errors).toBeNull();
    expect(JSON.stringify(document)).toContain('"Location"');
    source.proposals[4].enabled = false;
    const withoutDelete = JSON.stringify(generateOpenApi(definition));
    expect(withoutDelete).not.toContain('"delete"');
  });

  it('does not invent a primary key for tables without one', async () => {
    const bench = entityFixture();
    const model = JSON.parse(bench.entries['schema-sculptor-erd']);
    model.tables[0].columns.forEach((column: { isPrimaryKey: boolean }) => { column.isPrimaryKey = false; });
    model.tables[0].columns[2].type = 'CustomValue';
    bench.entries['schema-sculptor-erd'] = JSON.stringify(model);
    const source = await snapshotApiSource(bench);
    expect(source.proposals).toHaveLength(2);
    expect(source.diagnostics.join(' ')).toContain('no primary key');
    expect(source.diagnostics.join(' ')).toContain('Unknown ERD type');
  });

  it('keeps schema sources optional and binds multiple schemas manually', async () => {
    const a = createWorkbench('json', 'a', 'Request');
    a.entries['schema-sculptor-schema'] = '{"type":"object","properties":{"text":{"type":"string"}}}';
    const b = createWorkbench('yaml', 'b', 'Response');
    b.entries['schema-sculptor-schema'] = '{"type":"object","properties":{"ok":{"type":"boolean"}}}';
    const sources = await Promise.all([snapshotApiSource(a), snapshotApiSource(b)]);
    expect(sources.every(source => !source.proposals.length)).toBe(true);
    const document = generateOpenApi({
      ...emptyOpenApi(), sources,
      endpoints: [{ ...newApiEndpoint(), method: 'post', path: '/messages', requestSchema: 'Request', responseSchema: 'Response', status: '201' }],
    });
    expect(document).toMatchObject({
      paths: { '/messages': { post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Request' } } } } } } },
    });
    expect(generateOpenApi(emptyOpenApi())).toMatchObject({ openapi: '3.1.0', paths: {} });
  });

  it('normalizes legacy definitions, references, tuple arrays and dependencies without changing property names or example data', async () => {
    const bench = createWorkbench('json', 'json', 'Example');
    bench.entries['schema-sculptor-schema'] = JSON.stringify({
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      definitions: { Value: { type: 'string' } },
      properties: {
        definitions: { type: 'string' }, $ref: { type: 'string' },
        item: { $ref: '#/definitions/Value' },
        tuple: { type: 'array', items: [{ type: 'string' }], additionalItems: false },
      },
      dependencies: { item: ['definitions'] }, examples: [{ $ref: 'literal-value', definitions: 1 }],
    });
    const source = await snapshotApiSource(bench);
    expect(source.schemas.Example).toMatchObject({
      $defs: { Value: { type: 'string' } },
      properties: {
        definitions: { type: 'string' }, $ref: { type: 'string' },
        item: { $ref: '#/components/schemas/Example/$defs/Value' },
        tuple: { prefixItems: [{ type: 'string' }], items: false },
      },
      dependentRequired: { item: ['definitions'] }, examples: [{ $ref: 'literal-value', definitions: 1 }],
    });
    expect(() => generateOpenApi({ ...emptyOpenApi(), sources: [source] })).not.toThrow();
  });

  it('infers YAML instance data only when requested and warns about sample limits', async () => {
    const bench = createWorkbench('yaml', 'yaml', 'Sample');
    bench.entries['schema-sculptor-instance-yaml'] = 'name: Alice\nactive: true';
    const source = await snapshotApiSource(bench, 'instance');
    expect(source.schemas.Sample).toMatchObject({ properties: { name: { type: 'string' }, active: { type: 'boolean' } } });
    expect(source.diagnostics.join(' ')).toContain('inferred');
  });

  it('represents XML samples explicitly as lossy JSON contracts including repeated elements and attributes', async () => {
    const bench = createWorkbench('xml', 'xml', 'People');
    bench.entries['schema-sculptor-instance-xml'] = '<people><person id="1"><name>A</name></person><person id="2"><name>B</name></person></people>';
    const source = await snapshotApiSource(bench, 'xml');
    expect(source.schemas.People).toMatchObject({
      properties: { person: { type: 'array', items: { properties: { '@id': { type: 'string' }, name: { type: 'string' } } } } },
    });
    expect(source.diagnostics.join(' ')).toContain('not preserved');
    expect(source.proposals).toEqual([]);
    bench.entries['schema-sculptor-schema-xml'] = JSON.stringify(parseMarkup(
      '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="people" type="xs:string"/></xs:schema>', 'xml',
    ));
    expect(() => generateOpenApi({ ...emptyOpenApi(), sources: [source] })).not.toThrow();
  });

  it.each([
    { path: 'relative' }, { path: '/bad path' }, { path: '/items/{id}/{id}' },
    { path: '/items/{id' }, { responseSchema: 'Missing' },
    { method: 'get' as const, requestSchema: 'Data' },
    { status: '204' as const, responseSchema: 'Data' },
  ])('rejects invalid endpoint configuration %#', update => {
    const source: ApiSource = { id: 's', workbenchId: 'b', name: 'Data', revision: '', format: 'schema', schemas: { Data: { type: 'string' } }, proposals: [], diagnostics: [] };
    expect(() => generateOpenApi({
      ...emptyOpenApi(), sources: [source], endpoints: [{ ...newApiEndpoint(), ...update }],
    })).toThrow();
  });

  it('rejects duplicate routes, inconsistent parameter names, operation IDs and schema names', async () => {
    const source = await snapshotApiSource(entityFixture());
    const endpoint = { ...newApiEndpoint(), operationId: 'getOne', path: '/items/{id}' };
    const definition = { ...emptyOpenApi(), endpoints: [endpoint, { ...endpoint, id: 'b' }] };
    expect(() => generateOpenApi(definition)).toThrow('Duplicate endpoint');
    definition.endpoints[1] = { ...endpoint, path: '/other' };
    expect(() => generateOpenApi(definition)).toThrow('Duplicate operation ID');
    definition.endpoints[1] = { ...endpoint, operationId: 'putOne', method: 'put', path: '/items/{name}' };
    expect(() => generateOpenApi(definition)).toThrow('inconsistent parameter');
    expect(() => generateOpenApi({ ...emptyOpenApi(), sources: [source, source] })).toThrow('duplicated');
  });

  it('rejects invalid schemas and unresolved/external references before preview or export', async () => {
    const bench = createWorkbench('json', 'a', 'Data');
    for (const schema of [{ type: 'nonsense' }, { $ref: 'https://example.test/schema' }, { $ref: '#/definitions/Missing' },
      { type: 'object', properties: { default: { $ref: '#/definitions/Missing' } } }]) {
      bench.entries['schema-sculptor-schema'] = JSON.stringify(schema);
      const source = await snapshotApiSource(bench);
      expect(() => generateOpenApi({ ...emptyOpenApi(), sources: [source] })).toThrow();
    }
    expect(() => generateOpenApi({ ...emptyOpenApi(), server: 'file:///secret' })).toThrow('HTTP');
  });

  it('rejects unsupported scoped IDs, anchors and conflicting legacy maps rather than silently changing meaning', async () => {
    const bench = createWorkbench('json', 'a', 'Data');
    for (const schema of [
      { type: 'object', properties: { nested: { $id: 'nested', type: 'string' } } },
      { $anchor: 'root', type: 'string' }, { definitions: {}, $defs: {} },
      { dependencies: {}, dependentRequired: {} },
    ]) {
      bench.entries['schema-sculptor-schema'] = JSON.stringify(schema);
      await expect(snapshotApiSource(bench)).rejects.toThrow('explicit');
    }
  });

  it('round-trips standalone workbenches, tracks dirty content and rejects malformed persisted state', () => {
    const bench = createWorkbench('openapi', 'api', 'API');
    expect(parseOpenApi(bench.entries[OPENAPI_STORAGE_KEY])).toEqual(emptyOpenApi());
    const saved = bench.savedContent;
    bench.entries[OPENAPI_STORAGE_KEY] = JSON.stringify({ ...emptyOpenApi(), title: 'Updated' });
    expect(contentFingerprint(bench)).not.toBe(saved);
    expect(importWorkbench(exportWorkbench(bench), 'copy').entries).toEqual(bench.entries);
    expect(() => parseOpenApi('{"version":2}')).toThrow('unsupported');
  });
});
