import {
  emptyTransform, flattenTransformNodes, generateXslt, MAX_XML_LENGTH, parseTransform,
  parseTransformXml, xmlStructure, OUTPUT_BUNDLE_NAMESPACE, readTransformResults, transformOutputs,
  type TransformDefinition, type TransformDatasource, type MappingRule,
} from './transform';

export function fixtureDatasource(xml: string, name: string): TransformDatasource {
  return { workbenchId: name, name, revision: xml, xml, schema: '', rootElement: new DOMParser().parseFromString(xml, 'application/xml').documentElement.localName };
}

export function fixtureDefinition(): TransformDefinition {
  return {
    ...emptyTransform(),
    source: fixtureDatasource('<orders xmlns="urn:source"><order id="7"><name>Alice</name></order><order id="8"><name>Bob</name></order></orders>', 'Orders'),
    target: fixtureDatasource('<invoices xmlns="urn:target"><invoice code=""><customer/></invoice><invoice code=""><customer/></invoice></invoices>', 'Invoices'),
  };
}

export function fixtureMapping(definition: TransformDefinition, sourceName: string, targetName: string, mode: MappingRule['mode'] = 'value'): MappingRule {
  const source = flattenTransformNodes(xmlStructure(definition.source!.xml)).find(node => node.label === sourceName)!;
  const target = flattenTransformNodes(xmlStructure(definition.target!.xml)).find(node => node.label === targetName)!;
  return { id: `${sourceName}-${targetName}`, source: source.id, target: target.id, mode, constant: '' };
}

describe('Transform XML mapping', () => {
  it('deduplicates repeated nodes and retains fields observed in later instances', () => {
    const nodes = flattenTransformNodes(xmlStructure('<root><row><a/></row><row><b/></row></root>'));
    expect(nodes.map(node => node.label)).toEqual(['root', 'row', 'a', 'b']);
    expect(nodes[1].repeated).toBe(true);
  });

  it('generates namespace-aware XSLT 1.0 with relative repeated contexts and attributes before elements', () => {
    const definition = fixtureDefinition();
    definition.mappings = [
      fixtureMapping(definition, 'order', 'invoice', 'repeat'),
      fixtureMapping(definition, '@id', '@code'),
      fixtureMapping(definition, 'name', 'customer'),
    ];
    const xslt = generateXslt(definition);
    expect(xslt).toContain('version="1.0"');
    expect(xslt).toContain('<xsl:apply-templates');
    expect(xslt).toContain('<xsl:template match="*" mode="mapping-1">');
    expect(xslt).not.toContain('xsl:for-each');
    expect(xslt).toContain('name="invoice" namespace="urn:target"');
    expect(xslt).toContain("namespace-uri()='urn:source'");
    expect(xslt).toContain(`select="@*[local-name()='id'`);
    expect(xslt).not.toContain('&apos;');
    expect(xslt.indexOf('name="code"')).toBeLessThan(xslt.indexOf('name="customer"'));
    expect(parseTransformXml(xslt).documentElement.localName).toBe('stylesheet');
    expect(generateXslt(definition)).toBe(xslt);
  });

  it('supports constant escaping and text values alongside mapped attributes', () => {
    const definition: TransformDefinition = {
      ...emptyTransform(), source: fixtureDatasource('<a code="9">Text</a>', 'Source'),
      target: fixtureDatasource('<b code="">Example</b>', 'Target'),
    };
    definition.mappings = [
      fixtureMapping(definition, 'a', 'b'),
      { ...fixtureMapping(definition, '@code', '@code', 'constant'), constant: '<hello & "world">' },
    ];
    const xslt = generateXslt(definition);
    expect(xslt).toContain('&lt;hello &amp; &quot;world&quot;&gt;');
    expect(xslt.indexOf('<xsl:attribute')).toBeLessThan(xslt.indexOf('<xsl:value-of'));
  });

  it('dispatches nested repeating groups relative to their enclosing source template', () => {
    const definition: TransformDefinition = {
      ...emptyTransform(),
      source: fixtureDatasource('<orders><order><lines><line><sku>A</sku></line><line><sku>B</sku></line></lines></order><order><lines><line><sku>C</sku></line></lines></order></orders>', 'Source'),
      target: fixtureDatasource('<invoices><invoice><items><item><code/></item><item><code/></item></items></invoice><invoice><items><item><code/></item></items></invoice></invoices>', 'Target'),
    };
    definition.mappings = [
      { ...fixtureMapping(definition, 'order', 'invoice', 'repeat'), templateMode: 'invoices' },
      { ...fixtureMapping(definition, 'line', 'item', 'repeat'), templateMode: 'invoice-items' },
      fixtureMapping(definition, 'sku', 'code'),
    ];
    const stylesheet = parseTransformXml(generateXslt(definition));
    const ns = 'http://www.w3.org/1999/XSL/Transform';
    const calls = Array.from(stylesheet.getElementsByTagNameNS(ns, 'apply-templates'));
    expect(calls).toHaveLength(2);
    const nestedCall = calls.find(call => call.getAttribute('mode') === 'invoice-items')!;
    expect(nestedCall.getAttribute('select')).toBe("*[local-name()='lines' and namespace-uri()='']/*[local-name()='line' and namespace-uri()='']");
    const parentTemplate = Array.from(stylesheet.getElementsByTagNameNS(ns, 'template'))
      .find(template => template.contains(nestedCall));
    expect(parentTemplate?.getAttribute('mode')).toBe('invoices');
    const value = stylesheet.getElementsByTagNameNS(ns, 'value-of')[0];
    expect(value.getAttribute('select')).toBe("*[local-name()='sku' and namespace-uri()='']");
    expect(generateXslt(definition)).not.toContain('xsl:for-each');
  });

  it('uses distinct modes when one source collection maps to multiple target collections', () => {
    const definition: TransformDefinition = {
      ...emptyTransform(),
      source: fixtureDatasource('<root><row><name>A</name></row><row><name>B</name></row></root>', 'Source'),
      target: fixtureDatasource('<output><first><entry><label/></entry></first><second><copy><text/></copy></second></output>', 'Target'),
    };
    definition.mappings = [
      fixtureMapping(definition, 'row', 'entry', 'repeat'),
      fixtureMapping(definition, 'name', 'label'),
      fixtureMapping(definition, 'row', 'copy', 'repeat'),
      fixtureMapping(definition, 'name', 'text'),
    ];
    const ns = 'http://www.w3.org/1999/XSL/Transform';
    const xslt = generateXslt(definition);
    const stylesheet = parseTransformXml(xslt);
    const calls = Array.from(stylesheet.getElementsByTagNameNS(ns, 'apply-templates'));
    expect(calls.map(call => call.getAttribute('mode'))).toEqual(['mapping-1', 'mapping-2']);
    expect(calls[0].getAttribute('select')).toBe(calls[1].getAttribute('select'));
    expect(stylesheet.getElementsByTagNameNS(ns, 'template')).toHaveLength(3);
    definition.mappings.reverse();
    expect(generateXslt(definition)).toBe(xslt);

    const firstGroup = definition.mappings.find(rule => rule.id === 'row-entry')!;
    firstGroup.templateMode = ' mapping-2 ';
    const namedXslt = generateXslt(definition);
    const namedStylesheet = parseTransformXml(namedXslt);
    expect(Array.from(namedStylesheet.getElementsByTagNameNS(ns, 'apply-templates'))
      .map(call => call.getAttribute('mode'))).toEqual(['mapping-2', 'mapping-3']);
    expect(Array.from(namedStylesheet.getElementsByTagNameNS(ns, 'template'))
      .map(template => template.getAttribute('mode'))).toEqual([null, 'mapping-2', 'mapping-3']);
    definition.mappings.reverse();
    expect(generateXslt(definition)).toBe(namedXslt);
    definition.mappings.find(rule => rule.id === 'row-copy')!.templateMode = 'mapping-2';
    expect(() => generateXslt(definition)).toThrow('already used');
  });

  it.each(['9invoice', 'two words', 'prefix:invoice', 'bad"mode', 'a/b', 'a&b'])('rejects invalid template mode %s', templateMode => {
    const definition = fixtureDefinition();
    definition.mappings = [{ ...fixtureMapping(definition, 'order', 'invoice', 'repeat'), templateMode }];
    expect(() => generateXslt(definition)).toThrow('Invalid template mode');
  });

  it('treats blank modes as automatic and ignores template modes on value mappings', () => {
    const definition = fixtureDefinition();
    definition.mappings = [
      { ...fixtureMapping(definition, 'order', 'invoice', 'repeat'), templateMode: '  ' },
      { ...fixtureMapping(definition, 'name', 'customer'), templateMode: 'not a template' },
    ];
    expect(generateXslt(definition)).toContain('mode="mapping-1"');
    expect(generateXslt(definition)).not.toContain('not a template');
    definition.mappings[0].templateMode = '_Invoice.items-2';
    expect(generateXslt(definition)).toContain('mode="_Invoice.items-2"');
  });

  it('requires explicit repeating group rules and flags stale source/target mappings', () => {
    const definition = fixtureDefinition();
    definition.mappings = [fixtureMapping(definition, 'name', 'customer')];
    expect(() => generateXslt(definition)).toThrow('repeating group');
    definition.mappings.unshift(fixtureMapping(definition, 'order', 'invoice', 'repeat'));
    definition.mappings[1].source = 'missing';
    expect(() => generateXslt(definition)).toThrow('source field no longer exists');
    definition.mappings[1].target = 'missing';
    expect(() => generateXslt(definition)).toThrow('target field no longer exists');
  });

  it('rejects duplicate target mappings instead of silently choosing one', () => {
    const definition = fixtureDefinition();
    const rule = fixtureMapping(definition, 'order', 'invoice', 'repeat');
    definition.mappings = [rule, { ...rule, id: 'duplicate' }];
    expect(() => generateXslt(definition)).toThrow('Multiple mappings');
  });

  it('prevents repeating the document root and producing multiple XML documents', () => {
    const definition = fixtureDefinition();
    definition.mappings = [fixtureMapping(definition, 'order', 'invoices', 'repeat')];
    expect(() => generateXslt(definition)).toThrow('document root');
  });

  it('quotes namespace URIs containing apostrophes and double quotes in XPath expressions', () => {
    const definition: TransformDefinition = {
      ...emptyTransform(),
      source: fixtureDatasource('<a xmlns="urn:it&apos;s&quot;quoted">value</a>', 'Source'),
      target: fixtureDatasource('<b/>', 'Target'),
    };
    definition.mappings = [fixtureMapping(definition, 'a', 'b')];
    const xslt = generateXslt(definition);
    expect(xslt).toContain('concat(');
    expect(xslt).not.toContain('&apos;');
    expect(xslt).toContain('&quot;');
    const stylesheet = parseTransformXml(xslt);
    expect(stylesheet.documentElement.localName).toBe('stylesheet');
    const select = stylesheet.getElementsByTagNameNS('http://www.w3.org/1999/XSL/Transform', 'value-of')[0].getAttribute('select');
    expect(select).toBe(`/*[local-name()='a' and namespace-uri()=concat('urn:it', "'", 's"quoted')]`);
  });

  it('round-trips a definition and rejects invalid saved definitions', () => {
    const definition = fixtureDefinition();
    definition.mappings = [fixtureMapping(definition, 'order', 'invoice', 'repeat')];
    expect(parseTransform(JSON.stringify(definition))).toEqual(definition);
    definition.mappings[0].templateMode = 'invoices';
    expect(parseTransform(JSON.stringify(definition))).toEqual(definition);
    expect(() => parseTransform(JSON.stringify({
      ...definition, mappings: [{ ...definition.mappings[0], templateMode: 42 }],
    }))).toThrow('Invalid');
    expect(() => parseTransform('{"version":2}')).toThrow('unsupported');
    expect(() => parseTransform(JSON.stringify({ ...definition, mappings: [{ mode: 'javascript' }] }))).toThrow('Invalid');
  });

  it('bundles outputs using isolated functional modes and preserves existing single-output generation', () => {
    const definition = fixtureDefinition();
    definition.mappings = [
      { ...fixtureMapping(definition, 'order', 'invoice', 'repeat'), templateMode: 'records' },
      fixtureMapping(definition, 'name', 'customer'),
    ];
    const single = generateXslt(definition);
    definition.outputs = [{ id: 'other', name: 'Second output', target: definition.target, mappings: definition.mappings }];
    const stylesheet = parseTransformXml(generateXslt(definition));
    const ns = 'http://www.w3.org/1999/XSL/Transform';
    expect(stylesheet.getElementsByTagNameNS(OUTPUT_BUNDLE_NAMESPACE, 'document')).toHaveLength(2);
    expect(Array.from(stylesheet.getElementsByTagNameNS(ns, 'apply-templates')).map(element => element.getAttribute('mode')))
      .toEqual(['output-1-records', 'output-2-records']);
    expect(Array.from(stylesheet.getElementsByTagNameNS(ns, 'template')).filter(element => element.getAttribute('match') === '/')).toHaveLength(1);
    expect(generateXslt({ ...definition, outputs: [] })).toBe(single);
    expect(parseTransform(JSON.stringify(definition))).toEqual(definition);
    definition.outputs[0].mappings = [];
    expect(() => generateXslt(definition)).toThrow('Second output: Add at least one mapping');
  });

  it('rejects duplicate/reserved output IDs, malformed mappings and over-limit definitions', () => {
    const definition = fixtureDefinition();
    const output = { id: 'second', name: 'Second', target: definition.target, mappings: [] };
    expect(() => parseTransform(JSON.stringify({ ...definition, outputs: [output, output] }))).toThrow('unique');
    expect(() => parseTransform(JSON.stringify({ ...definition, outputs: [{ ...output, id: 'primary' }] }))).toThrow('Invalid');
    expect(() => parseTransform(JSON.stringify({ ...definition, outputs: [{ ...output, mappings: [{}] }] }))).toThrow('Invalid');
    expect(() => parseTransform(JSON.stringify({
      ...definition, outputs: Array.from({ length: 16 }, (_, index) => ({ ...output, id: `output-${index}` })),
    }))).toThrow('16 outputs');
    definition.mappings = [
      fixtureMapping(definition, 'order', 'invoice', 'repeat'), fixtureMapping(definition, 'name', 'customer'),
    ];
    definition.outputs = Array.from({ length: 15 }, (_, index) => ({
      ...output, id: `output-${index}`, mappings: definition.mappings,
    }));
    expect(transformOutputs(parseTransform(JSON.stringify(definition)))).toHaveLength(16);
    expect(parseTransformXml(generateXslt(definition)).getElementsByTagNameNS(OUTPUT_BUNDLE_NAMESPACE, 'document')).toHaveLength(16);
  });

  it('unpacks expected results in definition order, retaining namespaces and target schemas', () => {
    const definition = fixtureDefinition();
    definition.target!.schema = '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"/>';
    definition.outputs = [{ id: 'second', name: 'Other', target: definition.target, mappings: [] }];
    const results = readTransformResults(`<b:outputs xmlns:b="${OUTPUT_BUNDLE_NAMESPACE}" xmlns:t="urn:target">
      <b:document id="second"><t:invoices><t:invoice/></t:invoices></b:document>
      <b:document id="primary"><t:invoices><t:invoice code="7"/></t:invoices></b:document>
    </b:outputs>`, definition);
    expect(results.map(result => result.id)).toEqual(['primary', 'second']);
    expect(results[0].schema).toBe(definition.target!.schema);
    expect(parseTransformXml(results[0].xml).documentElement.namespaceURI).toBe('urn:target');
    expect(transformOutputs(definition).map(output => output.name)).toEqual(['Invoices', 'Other']);
  });

  it.each([
    '<wrong/>',
    '<b:outputs/>',
    '<b:outputs><b:document id="primary"><one/></b:document><b:document id="primary"><two/></b:document></b:outputs>',
    '<b:outputs><b:document id="primary"><one/><two/></b:document><b:document id="second"><two/></b:document></b:outputs>',
    '<b:outputs><b:document id="primary">text<one/></b:document><b:document id="second"><two/></b:document></b:outputs>',
    '<b:outputs><![CDATA[unexpected]]><b:document id="primary"><one/></b:document><b:document id="second"><two/></b:document></b:outputs>',
    '<b:outputs><b:document id="unknown"><one/></b:document><b:document id="second"><two/></b:document></b:outputs>',
  ])('rejects malformed or incomplete bundles instead of importing partial results (%#)', body => {
    const definition = fixtureDefinition();
    definition.outputs = [{ id: 'second', name: 'Other', target: definition.target, mappings: [] }];
    const xml = body.replace(/<([a-z]+:)?([a-z]+)(?=[ />])/, `$& xmlns:b="${OUTPUT_BUNDLE_NAMESPACE}"`);
    expect(() => readTransformResults(xml, definition)).toThrow();
  });

  it.each(['<broken>', '<!DOCTYPE root [<!ENTITY value "bad">]><root>&value;</root>', 'x'.repeat(MAX_XML_LENGTH + 1)])('rejects malformed, DTD or oversized XML (%#)', xml => {
    expect(() => parseTransformXml(xml)).toThrow();
  });
});
