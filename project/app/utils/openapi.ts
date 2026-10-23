import { z } from 'zod';
import Ajv2020 from 'ajv/dist/2020';

export const OPENAPI_STORAGE_KEY = 'schema-sculptor-openapi';
export const OPENAPI_TAB_KEY = 'schema-sculptor-openapi-tab';
export const httpMethods = ['get', 'post', 'put', 'patch', 'delete'] as const;
const schemaValidator = new Ajv2020({ strict: false, validateFormats: false });
const schemaValue = z.union([z.boolean(), z.record(z.string(), z.unknown())]);
export type ApiSchema = z.infer<typeof schemaValue>;
const parameter = z.object({ name: z.string(), schema: schemaValue });
const endpoint = z.object({
  id: z.string(), enabled: z.boolean(), method: z.enum(httpMethods), path: z.string(),
  operationId: z.string(), summary: z.string(), requestSchema: z.string(),
  responseSchema: z.string(), responseArray: z.boolean(), status: z.enum(['200', '201', '204']),
  parameters: z.array(parameter),
});
export type ApiEndpoint = z.infer<typeof endpoint>;
const source = z.object({
  id: z.string(), workbenchId: z.string(), name: z.string(), revision: z.string(),
  format: z.enum(['schema', 'instance', 'xml']),
  schemas: z.record(z.string(), schemaValue), diagnostics: z.array(z.string()),
  proposals: z.array(endpoint),
});
export type ApiSource = z.infer<typeof source>;
const definition = z.object({
  version: z.literal(1), title: z.string(), apiVersion: z.string(), description: z.string(),
  server: z.string(), sources: z.array(source), endpoints: z.array(endpoint),
});
export type OpenApiDefinition = z.infer<typeof definition>;

export function emptyOpenApi(): OpenApiDefinition {
  return { version: 1, title: 'My API', apiVersion: '1.0.0', description: '', server: '', sources: [], endpoints: [] };
}

export function parseOpenApi(text: string): OpenApiDefinition {
  const result = definition.safeParse(JSON.parse(text));
  if (!result.success) throw new Error('Invalid or unsupported OpenAPI workbench definition.');
  return result.data;
}

export function newApiEndpoint(): ApiEndpoint {
  return {
    id: crypto.randomUUID(), enabled: true, method: 'get', path: '/resource', operationId: '',
    summary: '', requestSchema: '', responseSchema: '', responseArray: false, status: '200', parameters: [],
  };
}

export function componentName(name: string): string {
  const result = name.replace(/[^A-Za-z0-9._-]/g, '_');
  if (!result) throw new Error('A schema component name is required.');
  return result;
}

export function schemaReference(name: string): Record<string, string> {
  return { $ref: `#/components/schemas/${name}` };
}

export function collectApiSchemas(sources: ApiSource[]): Record<string, ApiSchema> {
  const schemas = new Map<string, ApiSchema>();
  for (const source of sources) {
    for (const [name, schema] of Object.entries(source.schemas)) {
      if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error(`Invalid schema component name: ${name}`);
      if (schemas.has(name)) throw new Error(`Schema component "${name}" is duplicated. Remove or rename the conflicting source.`);
      schemas.set(name, schema);
    }
  }
  return Object.fromEntries(schemas);
}

export function generateOpenApi(input: OpenApiDefinition): Record<string, unknown> {
  if (!input.title.trim() || !input.apiVersion.trim()) throw new Error('API title and version are required.');
  if (input.server.trim()) {
    let url: URL;
    try { url = new URL(input.server); } catch { throw new Error('Server URL must be an absolute HTTP or HTTPS URL.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Server URL must use HTTP or HTTPS without embedded credentials.');
    }
  }
  const schemas = collectApiSchemas(input.sources);
  for (const [name, schema] of Object.entries(schemas)) {
    if (!schemaValidator.validateSchema(schema)) throw new Error(`Invalid schema "${name}": ${schemaValidator.errorsText()}`);
  }
  const checkSchema = (name: string) => {
    if (name && !Object.hasOwn(schemas, name)) throw new Error(`Endpoint refers to missing schema "${name}". Repair its binding.`);
  };
  // Only local component references are allowed: no network resolution in the preview.
  const checkReferences = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(checkReferences); return; }
    if (!value || typeof value !== 'object') return;
    const object = value as Record<string, unknown>;
    for (const key of ['$ref', '$dynamicRef', '$recursiveRef']) {
      const ref = object[key];
      if (typeof ref !== 'string') continue;
      if (!ref.startsWith('#/components/schemas/')) throw new Error(`Unsupported schema reference "${ref}". Import and bind a local component instead.`);
      let node: unknown = { components: { schemas } };
      for (const token of ref.slice(2).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
        if (!node || typeof node !== 'object' || !Object.hasOwn(node, token)) throw new Error(`Unresolved schema reference "${ref}".`);
        node = (node as Record<string, unknown>)[token];
      }
    }
    for (const key of ['properties', 'patternProperties', '$defs', 'dependentSchemas']) {
      const map = object[key];
      if (map && typeof map === 'object' && !Array.isArray(map)) Object.values(map).forEach(checkReferences);
    }
    for (const key of ['items', 'additionalProperties', 'contains', 'not', 'if', 'then', 'else', 'propertyNames', 'unevaluatedProperties', 'unevaluatedItems',
      'allOf', 'anyOf', 'oneOf', 'prefixItems']) checkReferences(object[key]);
  };
  Object.values(schemas).forEach(checkReferences);
  const paths = new Map<string, Record<string, unknown>>();
  const ids = new Set<string>();
  const signatures = new Set<string>();
  const pathTemplates = new Map<string, string>();
  for (const route of input.endpoints.filter(endpoint => endpoint.enabled)) {
    if (!route.path.startsWith('/') || /[\s?#]/.test(route.path)) throw new Error(`Invalid endpoint path "${route.path}". Use an absolute path without a query or fragment.`);
    const names = [...route.path.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]);
    if (/[{}]/.test(route.path.replace(/\{[^{}]+\}/g, '')) || new Set(names).size !== names.length) {
      throw new Error(`Invalid or repeated path parameters in "${route.path}".`);
    }
    const signature = `${route.method} ${route.path.replace(/\{[^{}]+\}/g, '{}')}`;
    const template = route.path.replace(/\{[^{}]+\}/g, '{}');
    if (pathTemplates.has(template) && pathTemplates.get(template) !== route.path) {
      throw new Error(`Equivalent endpoint paths use inconsistent parameter names: "${route.path}".`);
    }
    pathTemplates.set(template, route.path);
    if (signatures.has(signature)) throw new Error(`Duplicate endpoint: ${route.method.toUpperCase()} ${route.path}`);
    signatures.add(signature);
    if (route.operationId) {
      if (ids.has(route.operationId)) throw new Error(`Duplicate operation ID "${route.operationId}".`);
      ids.add(route.operationId);
    }
    checkSchema(route.requestSchema);
    checkSchema(route.responseSchema);
    if (route.requestSchema && ['get', 'delete'].includes(route.method)) throw new Error('Request bodies are supported on POST, PUT and PATCH only.');
    if (route.status === '204' && route.responseSchema) throw new Error('A 204 response cannot have a response body.');
    const response: Record<string, unknown> = {
      description: route.status === '201' ? 'Created' : route.status === '204' ? 'No Content' : 'OK',
    };
    if (route.responseSchema) {
      const schema = schemaReference(route.responseSchema);
      response.content = { 'application/json': { schema: route.responseArray ? { type: 'array', items: schema } : schema } };
    }
    const operation: Record<string, unknown> = { responses: { [route.status]: response } };
    if (route.summary) operation.summary = route.summary;
    if (route.operationId) operation.operationId = route.operationId;
    if (names.length) operation.parameters = names.map(name => ({
      name, in: 'path', required: true,
      schema: route.parameters.find(parameter => parameter.name === name)?.schema ?? { type: 'string' },
    }));
    if (route.requestSchema) operation.requestBody = {
      required: true, content: { 'application/json': { schema: schemaReference(route.requestSchema) } },
    };
    if (route.status === '201') response.headers = {
      Location: { description: 'URI of the created resource', schema: { type: 'string', format: 'uri-reference' } },
    };
    const path = paths.get(route.path) ?? {};
    path[route.method] = operation;
    paths.set(route.path, path);
  }
  return {
    openapi: '3.1.0', info: { title: input.title.trim(), version: input.apiVersion.trim(), description: input.description },
    ...(input.server.trim() ? { servers: [{ url: input.server.trim() }] } : {}),
    paths: Object.fromEntries(paths), components: { schemas },
  };
}
