import { z } from 'zod';
import type { WorkbenchDocument } from '../state/workspace';
import { generateSchema } from './schema-generator';
import { parseMarkup } from './markup';
import { flattenTransformNodes, xmlStructure } from './transform';
import { snapshotDatasource } from './transform-datasource';
import { componentName, newApiEndpoint, type ApiSchema, type ApiSource } from './openapi';

const erdModel = z.object({
  tables: z.array(z.object({
    name: z.string(), columns: z.array(z.object({
      name: z.string(), type: z.string(), isNullable: z.boolean(), isPrimaryKey: z.boolean(),
    })),
  })),
  relationships: z.array(z.unknown()), diagnostics: z.array(z.object({ message: z.string() })),
});

export function apiSourceRevision(bench: WorkbenchDocument): string {
  return JSON.stringify([
    bench.kind, bench.entries['schema-sculptor-markup-language'],
    ...['schema-sculptor-erd', 'schema-sculptor-schema', 'schema-sculptor-schema-xml',
      'schema-sculptor-instance-json', 'schema-sculptor-instance-yaml', 'schema-sculptor-instance-xml']
      .map(key => bench.entries[key] ?? ''),
  ]);
}

function columnSchema(type: string, diagnostics: string[]): Record<string, unknown> {
  const normalized = type.replace(/\?$/, '').replace(/^System\./, '').toLowerCase();
  if (['int', 'int32', 'short', 'int16', 'byte', 'sbyte', 'uint', 'ushort'].includes(normalized)) return { type: 'integer', format: 'int32' };
  if (['long', 'int64', 'ulong'].includes(normalized)) return { type: 'integer', format: 'int64' };
  if (['float', 'single', 'double', 'decimal'].includes(normalized)) return { type: 'number', ...(normalized === 'decimal' ? {} : { format: normalized === 'double' ? 'double' : 'float' }) };
  if (['bool', 'boolean'].includes(normalized)) return { type: 'boolean' };
  if (['datetime', 'datetimeoffset'].includes(normalized)) return { type: 'string', format: 'date-time' };
  if (normalized === 'dateonly') return { type: 'string', format: 'date' };
  if (normalized === 'timeonly') return { type: 'string', format: 'time' };
  if (normalized === 'guid') return { type: 'string', format: 'uuid' };
  if (normalized === 'byte[]') return { type: 'string', contentEncoding: 'base64' };
  if (['string', 'char'].includes(normalized)) return { type: 'string', ...(normalized === 'char' ? { maxLength: 1 } : {}) };
  diagnostics.push(`Unknown ERD type "${type}" was represented as a string. Review its schema.`);
  return { type: 'string' };
}

function normalizeSchema(schema: ApiSchema, name: string, diagnostics: string[]): ApiSchema {
  const maps = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);
  const singles = new Set(['items', 'additionalProperties', 'contains', 'not', 'if', 'then', 'else', 'propertyNames', 'unevaluatedProperties', 'unevaluatedItems', 'additionalItems']);
  const arrays = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
  const visit = (value: unknown, isRoot = false): unknown => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    if ('definitions' in value && '$defs' in value) throw new Error(`${name}: merge definitions and $defs explicitly before import.`);
    if ('dependencies' in value && ('dependentRequired' in value || 'dependentSchemas' in value)) {
      throw new Error(`${name}: merge legacy and modern dependency keywords explicitly before import.`);
    }
    const entries: [string, unknown][] = [];
    for (const [key, item] of Object.entries(value)) {
      if (key.startsWith('__')) continue;
      if (key === '$id' && !isRoot) throw new Error(`${name}: nested schema IDs need explicit conversion before import.`);
      if (key === '$schema' || key === '$id') continue;
      if (key === '$anchor' || key === '$dynamicAnchor' || key === '$dynamicRef' || key === '$recursiveRef') {
        throw new Error(`${name}: anchor and dynamic/recursive references need explicit conversion before import.`);
      }
      if (key === '$ref' && typeof item === 'string' && item.startsWith('#')) {
        entries.push([key, `#/components/schemas/${name}${item.slice(1).replace(/^\/definitions(?=\/|$)/, '/$defs')}`]);
      } else if (maps.has(key) && item && typeof item === 'object' && !Array.isArray(item)) {
        entries.push([key === 'definitions' ? '$defs' : key,
          Object.fromEntries(Object.entries(item).map(([name, schema]) => [name, visit(schema)]))]);
      } else if (key === 'items' && Array.isArray(item)) {
        entries.push(['prefixItems', item.map(item => visit(item))]);
      } else if (key === 'additionalItems') {
        if (Array.isArray((value as Record<string, unknown>).items)) entries.push(['items', visit(item)]);
      } else if (singles.has(key)) entries.push([key, visit(item)]);
      else if (arrays.has(key) && Array.isArray(item)) entries.push([key, item.map(item => visit(item))]);
      else if (key === 'dependencies' && item && typeof item === 'object' && !Array.isArray(item)) {
        const dependencies = Object.entries(item);
        entries.push(['dependentRequired', Object.fromEntries(dependencies.filter(([, item]) => Array.isArray(item)))]);
        entries.push(['dependentSchemas', Object.fromEntries(dependencies.filter(([, item]) => !Array.isArray(item)).map(([name, schema]) => [name, visit(schema)]))]);
      } else if (key === 'exclusiveMinimum' && typeof item === 'boolean') {
        const minimum = (value as Record<string, unknown>).minimum;
        if (item && typeof minimum === 'number') entries.push([key, minimum]);
      } else if (key === 'exclusiveMaximum' && typeof item === 'boolean') {
        const maximum = (value as Record<string, unknown>).maximum;
        if (item && typeof maximum === 'number') entries.push([key, maximum]);
      } else entries.push([key, item]);
    }
    return Object.fromEntries(entries);
  };
  if (typeof schema === 'object' && schema.$schema && !String(schema.$schema).includes('2020-12')) {
    diagnostics.push(`${name}: legacy JSON Schema keywords were normalized to 2020-12; review dialect-specific behavior.`);
  }
  return visit(schema, true) as ApiSchema;
}

export async function snapshotApiSource(bench: WorkbenchDocument, format: 'schema' | 'instance' | 'xml' = 'schema', signal?: AbortSignal): Promise<ApiSource> {
  if (bench.kind === 'transform' || bench.kind === 'openapi') throw new Error('Choose an Entity or schema/data workbench.');
  const result: ApiSource = {
    id: crypto.randomUUID(), workbenchId: bench.id, name: bench.name, revision: apiSourceRevision(bench), format,
    schemas: {}, proposals: [], diagnostics: [],
  };
  const schemas = new Map<string, ApiSchema>();
  const prefix = componentName(bench.name);
  if (bench.kind === 'erd') {
    const model = erdModel.parse(JSON.parse(bench.entries['schema-sculptor-erd'] ?? 'null'));
    if (!model.tables.length) throw new Error('The Entity workbench has no tables.');
    result.diagnostics.push(...model.diagnostics.map(item => item.message));
    result.diagnostics.push('CRUD routes are proposals, not implemented endpoints. Review paths, authorization, request fields and response contracts.');
    if (model.relationships.length) result.diagnostics.push('Relationships remain foreign-key fields; nested resources and navigation expansion are not inferred.');
    for (const table of model.tables) {
      const name = `${prefix}_${componentName(table.name)}`;
      if (schemas.has(name)) throw new Error(`Duplicate ERD component name "${name}". Rename the tables.`);
      const properties = Object.fromEntries(table.columns.map(column => {
        const schema = columnSchema(column.type, result.diagnostics);
        return [column.name, column.isNullable && !column.isPrimaryKey ? { anyOf: [schema, { type: 'null' }] } : schema];
      }));
      schemas.set(name, { type: 'object', properties, required: table.columns.filter(column => !column.isNullable || column.isPrimaryKey).map(column => column.name) });
      const path = `/${encodeURIComponent(table.name)}`;
      const keys = table.columns.filter(column => column.isPrimaryKey);
      const parameters = keys.map(column => ({ name: column.name, schema: columnSchema(column.type, result.diagnostics) }));
      if (parameters.some(parameter => /[{}\s/]/.test(parameter.name))) throw new Error('Primary key names must be valid path parameter names.');
      const itemPath = `${path}${parameters.map(parameter => `/{${parameter.name}}`).join('')}`;
      const propose = (method: 'get' | 'post' | 'put' | 'delete', item: boolean, array = false) => ({
        ...newApiEndpoint(), method, path: item ? itemPath : path,
        operationId: `${method}_${name}${array ? '_list' : ''}`,
        summary: `${method.toUpperCase()} ${table.name}${array ? ' list' : ''}`,
        requestSchema: ['post', 'put'].includes(method) ? name : '',
        responseSchema: method === 'delete' ? '' : name, responseArray: array,
        status: method === 'post' ? '201' as const : method === 'delete' ? '204' as const : '200' as const,
        parameters: item ? parameters : [],
      });
      result.proposals.push(propose('get', false, true), propose('post', false));
      if (keys.length) result.proposals.push(propose('get', true), propose('put', true), propose('delete', true));
      else result.diagnostics.push(`${table.name}: no primary key. Only list and create routes were proposed.`);
    }
  } else if (format === 'xml') {
    const snapshot = await snapshotDatasource(bench, undefined, signal);
    const root = xmlStructure(snapshot.xml);
    const build = (node: typeof root): ApiSchema => {
      if (!node.children.length) return { type: 'string' };
      return {
        type: 'object', properties: Object.fromEntries(node.children.map(child => [
          child.steps.at(-1)?.attribute ? `@${child.steps.at(-1)!.name}` : child.steps.at(-1)!.name,
          child.repeated ? { type: 'array', items: build(child) } : build(child),
        ])),
      };
    };
    const names = flattenTransformNodes(root).map(node => node.children.map(child =>
      `${child.steps.at(-1)!.attribute ? '@' : ''}${child.steps.at(-1)!.name}`));
    if (names.some(children => new Set(children).size !== children.length)) throw new Error('XML contains colliding local names across namespaces. Use an explicit JSON schema for this contract.');
    schemas.set(prefix, build(root));
    result.diagnostics.push('XML/XSD is represented as a JSON payload inferred from sample XML. XSD types, facets, choices, namespaces, mixed text and occurrence constraints are not preserved. Attributes use @name. Review before export; use an explicit JSON schema for fidelity.');
  } else {
    let schema: unknown;
    if (format === 'instance') {
      const language = bench.entries['schema-sculptor-markup-language'] === 'yaml' ? 'yaml' : 'json';
      const raw = bench.entries[`schema-sculptor-instance-${language}`] ?? '';
      if (!raw.trim()) throw new Error('This workbench has no JSON/YAML instance data.');
      schema = generateSchema(parseMarkup(raw, language));
      result.diagnostics.push('Schema inferred from instance data. The first array item determines its item schema; optionality and constraints require review.');
    } else {
      const raw = bench.entries['schema-sculptor-schema'];
      if (!raw) throw new Error('This workbench has no JSON schema. Choose instance inference or XML/XSD instead.');
      schema = JSON.parse(raw);
    }
    if (!(typeof schema === 'boolean' || (schema && typeof schema === 'object' && !Array.isArray(schema)))) {
      throw new Error('A JSON schema must be an object or boolean.');
    }
    schemas.set(prefix, normalizeSchema(schema as ApiSchema, prefix, result.diagnostics));
  }
  result.schemas = Object.fromEntries(schemas);
  return result;
}
