import type { WorkbenchDocument } from '../state/workspace';
import { serializeMarkup } from './markup';
import { parseTransformXml, type TransformDatasource } from './transform';

export function isXmlDatasource(bench: WorkbenchDocument): boolean {
  return bench.kind !== 'transform' && bench.kind !== 'erd' && bench.kind !== 'openapi'
    && (bench.kind === 'xml' || bench.entries['schema-sculptor-markup-language'] === 'xml'
      || !!bench.entries['schema-sculptor-instance-xml']?.trim()
      || !!bench.entries['schema-sculptor-schema-xml']?.trim());
}

export function datasourceRevision(bench: WorkbenchDocument): string {
  return JSON.stringify([
    bench.entries['schema-sculptor-instance-xml'] ?? '',
    bench.entries['schema-sculptor-schema-xml'] ?? '',
    bench.entries['schema-sculptor-markup-language'] ?? bench.kind,
  ]);
}

export function datasourceSchema(bench: WorkbenchDocument): string {
  const raw = bench.entries['schema-sculptor-schema-xml'];
  if (!raw) return '';
  return serializeMarkup(JSON.parse(raw), 'xml');
}

export function schemaRoots(schema: string): string[] {
  const doc = parseTransformXml(schema);
  const root = doc.documentElement;
  if (root.namespaceURI !== 'http://www.w3.org/2001/XMLSchema' || root.localName !== 'schema') return [];
  return Array.from(root.children)
    .filter(element => element.localName === 'element' && element.namespaceURI === root.namespaceURI && element.getAttribute('abstract') !== 'true')
    .map(element => element.getAttribute('name') ?? '').filter(Boolean);
}

export async function readApiResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`The XML service returned an invalid response (${response.status}). Ensure the .NET API is running.`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The XML service returned an invalid response.');
  }
  const body = value as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof body.detail === 'string' ? body.detail
      : typeof body.title === 'string' ? body.title : `XML service failed (${response.status}).`);
  }
  return body;
}

export async function snapshotDatasource(bench: WorkbenchDocument, rootElement?: string, signal?: AbortSignal): Promise<TransformDatasource> {
  if (!isXmlDatasource(bench)) throw new Error('XSLT 1.0 mapping currently supports XML/XSD workbenches only.');
  const revision = datasourceRevision(bench);
  const schema = datasourceSchema(bench);
  let xml = bench.entries['schema-sculptor-instance-xml'] ?? '';
  const roots = schema ? schemaRoots(schema) : [];
  let selectedRoot = rootElement ?? roots[0] ?? '';
  if (rootElement || !xml.trim()) {
    if (!schema || !selectedRoot) throw new Error('This workbench needs sample XML or an XSD with a concrete global root element.');
    const response = await fetch('/api/schema/default-instance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schema, rootElementName: selectedRoot }), signal,
    });
    const result = await readApiResponse(response);
    if (typeof result.xml !== 'string') throw new Error('The XML service did not return a default instance.');
    xml = result.xml;
  } else {
    selectedRoot = parseTransformXml(xml).documentElement.localName;
  }
  parseTransformXml(xml);
  return { workbenchId: bench.id, name: bench.name, revision, xml, schema, rootElement: selectedRoot };
}
