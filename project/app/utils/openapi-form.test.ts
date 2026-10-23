import Ajv2020 from 'ajv/dist/2020';
import { createWorkbench, exportWorkbench, importWorkbench } from '../state/workspace';
import { emptyOpenApi, newApiEndpoint, OPENAPI_STORAGE_KEY, type OpenApiDefinition } from './openapi';
import { API_FORM_ORIGIN_KEY, apiFormStatus, createRequestForm, parseApiFormOrigin, requestFormSchema } from './openapi-form';

function fixture(): OpenApiDefinition {
  return {
    ...emptyOpenApi(),
    sources: [{
      id: 's', workbenchId: 's', name: 'Models', format: 'schema', revision: '', diagnostics: [], proposals: [],
      schemas: {
        Person: { type: 'object', required: ['name'], properties: {
          name: { type: 'string', minLength: 2 }, address: { $ref: '#/components/schemas/Address' },
          friend: { $ref: '#/components/schemas/Person' },
        } },
        Address: { type: 'object', properties: { city: { type: 'string' } } },
      },
    }],
    endpoints: [{ ...newApiEndpoint(), id: 'post', method: 'post', path: '/people', requestSchema: 'Person' }],
  };
}

describe('OpenAPI request forms', () => {
  it('bundles reusable and recursive component references into an independently valid form schema', () => {
    const definition = fixture();
    const original = JSON.stringify(definition);
    const schema = requestFormSchema(definition, 'post');
    const validate = new Ajv2020({ strict: false }).compile(schema);
    expect(validate({ name: 'Alice', address: { city: 'Sydney' }, friend: { name: 'Bob' } })).toBe(true);
    expect(validate({ name: 'A' })).toBe(false);
    expect(validate({ address: { city: 3 } })).toBe(false);
    expect(JSON.stringify(definition)).toBe(original);
    expect(JSON.stringify(schema)).toContain('#/components/schemas/Person');
  });

  it('opens Instance Form and preserves schema and provenance through export/import', () => {
    const bench = createRequestForm(fixture(), 'post', { id: 'api', name: 'People API' });
    expect(bench.kind).toBe('json');
    expect(bench.entries['schema-sculptor-active-tab']).toBe('instance');
    const origin = parseApiFormOrigin(bench.entries[API_FORM_ORIGIN_KEY]);
    expect(origin).toMatchObject({ workbenchId: 'api', endpointId: 'post', schemaName: 'Person', path: '/people' });
    expect(importWorkbench(exportWorkbench(bench), 'copy').entries).toEqual(bench.entries);
  });

  it('detects contract changes and closed sources without altering generated forms', () => {
    const definition = fixture();
    const source = createWorkbench('openapi', 'api', 'API');
    source.entries[OPENAPI_STORAGE_KEY] = JSON.stringify(definition);
    const form = createRequestForm(definition, 'post', source);
    const origin = parseApiFormOrigin(form.entries[API_FORM_ORIGIN_KEY]);
    expect(apiFormStatus(origin, [source])).toBe('current');
    definition.description = 'Unrelated metadata';
    source.entries[OPENAPI_STORAGE_KEY] = JSON.stringify(definition);
    expect(apiFormStatus(origin, [source])).toBe('current');
    definition.endpoints[0].path = '/persons';
    source.entries[OPENAPI_STORAGE_KEY] = JSON.stringify(definition);
    expect(apiFormStatus(origin, [source])).toBe('changed');
    expect(apiFormStatus(origin, [])).toBe('closed');
    expect(form.entries['schema-sculptor-schema']).toContain('"minLength":2');
  });

  it('reports missing, disabled, bodyless and boolean contracts instead of generating empty success-shaped forms', () => {
    const definition = fixture();
    expect(() => createRequestForm(definition, 'missing', { id: 'api', name: 'API' })).toThrow('enabled');
    definition.endpoints[0].enabled = false;
    expect(() => requestFormSchema(definition, 'post')).toThrow('enabled');
    definition.endpoints[0].enabled = true;
    definition.endpoints[0].requestSchema = '';
    expect(() => requestFormSchema(definition, 'post')).toThrow('request schema');
    definition.endpoints[0].requestSchema = 'Person';
    definition.sources[0].schemas.Person = true;
    expect(() => requestFormSchema(definition, 'post')).toThrow('Boolean');
    expect(() => parseApiFormOrigin('{"version":2}')).toThrow('origin');
  });
});
