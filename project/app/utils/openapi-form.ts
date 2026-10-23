import { z } from 'zod';
import { createWorkbench, type WorkbenchDocument } from '../state/workspace';
import { collectApiSchemas, generateOpenApi, parseOpenApi, OPENAPI_STORAGE_KEY, type OpenApiDefinition } from './openapi';

export const API_FORM_ORIGIN_KEY = 'schema-sculptor-api-form-origin';
const originSchema = z.object({
  version: z.literal(1), workbenchId: z.string(), workbenchName: z.string(),
  endpointId: z.string(), method: z.string(), path: z.string(),
  schemaName: z.string(), contract: z.string(),
});
export type ApiFormOrigin = z.infer<typeof originSchema>;

export function parseApiFormOrigin(text: string): ApiFormOrigin {
  const result = originSchema.safeParse(JSON.parse(text));
  if (!result.success) throw new Error('Invalid API form origin metadata.');
  return result.data;
}

export function requestFormSchema(definition: OpenApiDefinition, endpointId: string): Record<string, unknown> {
  generateOpenApi(definition);
  const endpoint = definition.endpoints.find(endpoint => endpoint.id === endpointId);
  if (!endpoint?.enabled || !['post', 'put', 'patch'].includes(endpoint.method) || !endpoint.requestSchema) {
    throw new Error('Choose an enabled POST, PUT or PATCH endpoint with a request schema.');
  }
  const schemas = collectApiSchemas(definition.sources);
  const selected = schemas[endpoint.requestSchema];
  if (typeof selected === 'boolean') throw new Error('Boolean request schemas do not define editable fields. Bind an object schema to generate a form.');
  // Keep the complete component graph, including cycles, without dereferencing
  // into recursive JavaScript objects. Existing editors resolve local references.
  return {
    ...selected, $schema: 'https://json-schema.org/draft/2020-12/schema',
    components: { schemas },
  };
}

function contract(definition: OpenApiDefinition, endpointId: string): string {
  const endpoint = definition.endpoints.find(endpoint => endpoint.id === endpointId);
  return JSON.stringify([endpoint?.method, endpoint?.path, endpoint?.requestSchema, requestFormSchema(definition, endpointId)]);
}

export function createRequestForm(definition: OpenApiDefinition, endpointId: string, source: { id: string; name: string }): WorkbenchDocument {
  const schema = requestFormSchema(definition, endpointId);
  const endpoint = definition.endpoints.find(endpoint => endpoint.id === endpointId)!;
  const bench = createWorkbench('json', crypto.randomUUID(), `${endpoint.method.toUpperCase()} ${endpoint.path} request`);
  bench.entries['schema-sculptor-schema'] = JSON.stringify(schema);
  bench.entries['schema-sculptor-active-tab'] = 'instance';
  bench.entries[API_FORM_ORIGIN_KEY] = JSON.stringify({
    version: 1, workbenchId: source.id, workbenchName: source.name,
    endpointId, method: endpoint.method, path: endpoint.path, schemaName: endpoint.requestSchema,
    contract: contract(definition, endpointId),
  } satisfies ApiFormOrigin);
  return bench;
}

export function apiFormStatus(origin: ApiFormOrigin, documents: WorkbenchDocument[]): 'current' | 'changed' | 'closed' {
  const source = documents.find(document => document.id === origin.workbenchId);
  if (!source) return 'closed';
  const definition = parseOpenApi(source.entries[OPENAPI_STORAGE_KEY]);
  if (!definition.endpoints.some(endpoint => endpoint.id === origin.endpointId)) return 'changed';
  return contract(definition, origin.endpointId) === origin.contract ? 'current' : 'changed';
}
