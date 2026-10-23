import { createWorkbench } from '../state/workspace';
import { datasourceRevision, isXmlDatasource, readApiResponse, schemaRoots, snapshotDatasource } from './transform-datasource';
import { parseMarkup } from './markup';

describe('Transform workspace datasources', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('takes an independent XML snapshot and detects changes without mutating the workbench', async () => {
    const bench = createWorkbench('xml', 'source', 'Orders');
    bench.entries['schema-sculptor-instance-xml'] = '<orders><number>1</number></orders>';
    const revision = datasourceRevision(bench);
    const snapshot = await snapshotDatasource(bench);
    bench.entries['schema-sculptor-instance-xml'] = '<orders><number>2</number></orders>';
    expect(snapshot.xml).toContain('>1<');
    expect(snapshot.revision).toBe(revision);
    expect(datasourceRevision(bench)).not.toBe(revision);
  });

  it('generates XSD-only samples with an explicitly selected root', async () => {
    const bench = createWorkbench('xml', 'schema', 'Order schema');
    const xsd = '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="order" type="xs:string"/><xs:element name="invoice" type="xs:string"/><xs:element name="abstractRoot" abstract="true"/></xs:schema>';
    bench.entries['schema-sculptor-schema-xml'] = JSON.stringify(parseMarkup(xsd, 'xml'));
    expect(schemaRoots(xsd)).toEqual(['order', 'invoice']);
    const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>(async () => ({
      ok: true, status: 200, text: async () => '{"xml":"<invoice/>"}',
    } as Response));
    global.fetch = fetchMock;
    const snapshot = await snapshotDatasource(bench, 'invoice');
    expect(snapshot.rootElement).toBe('invoice');
    expect(snapshot.xml).toBe('<invoice/>');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ rootElementName: 'invoice' });
    expect(bench.entries['schema-sculptor-instance-xml']).toBeUndefined();
  });

  it('keeps saved XML selectable regardless of the current editor language or original workbench kind', async () => {
    for (const kind of ['xml', 'json', 'yaml'] as const) {
      const bench = createWorkbench(kind, kind, kind);
      bench.entries['schema-sculptor-markup-language'] = 'json';
      bench.entries['schema-sculptor-instance-xml'] = '<orders/>';
      expect(isXmlDatasource(bench)).toBe(true);
      expect((await snapshotDatasource(bench)).xml).toBe('<orders/>');
    }
    for (const kind of ['erd', 'transform'] as const) {
      const bench = createWorkbench(kind, kind, kind);
      bench.entries['schema-sculptor-instance-xml'] = '<orders/>';
      expect(isXmlDatasource(bench)).toBe(false);
    }
  });

  it('recognizes saved XSD even when another language is active', () => {
    const bench = createWorkbench('json', 'schema', 'Schema');
    bench.entries['schema-sculptor-schema-xml'] = JSON.stringify(parseMarkup(
      '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="order" type="xs:string"/></xs:schema>', 'xml',
    ));
    expect(isXmlDatasource(bench)).toBe(true);
  });

  it('explicitly rejects unsupported sources and empty XSDs', async () => {
    expect(isXmlDatasource(createWorkbench('json', 'json', 'JSON'))).toBe(false);
    await expect(snapshotDatasource(createWorkbench('json', 'json', 'JSON'))).rejects.toThrow('XML/XSD');
    await expect(snapshotDatasource(createWorkbench('xml', 'empty', 'Empty'))).rejects.toThrow('sample XML');
  });

  it('reports service Problem Details and non-JSON proxy errors', async () => {
    await expect(readApiResponse({
      ok: false, status: 400, text: async () => '{"detail":"Invalid XSD"}',
    } as Response)).rejects.toThrow('Invalid XSD');
    await expect(readApiResponse({
      ok: false, status: 502, text: async () => '<html>Bad gateway</html>',
    } as Response)).rejects.toThrow('.NET API');
  });
});
