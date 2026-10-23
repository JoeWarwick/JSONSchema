import { createXmlCollection } from './xml-collection';
import { parseTransformXml } from './transform';

const XSD = 'http://www.w3.org/2001/XMLSchema';

describe('XML collection creation', () => {
  it('wraps one existing record without changing its contents or namespace', () => {
    const xml = '<p:person xmlns:p="urn:people" id="1"><p:firstName>Alice</p:firstName></p:person>';
    const result = createXmlCollection(xml, '', 'person', 'persons');
    const doc = parseTransformXml(result.xml);
    expect(doc.documentElement.localName).toBe('persons');
    expect(doc.documentElement.namespaceURI).toBe('urn:people');
    expect(doc.documentElement.children).toHaveLength(1);
    expect(doc.documentElement.firstElementChild?.getAttribute('id')).toBe('1');
    expect(doc.documentElement.firstElementChild?.textContent).toBe('Alice');
    expect(result.schema).toBe('');
    expect(createXmlCollection('<person/>', '', 'person', 'persons').xml).toBe('<persons><person/></persons>');
  });

  it('reuses a global record via a repeatable reference and retains all existing schema definitions', () => {
    const schema = '<s:schema xmlns:s="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:people" elementFormDefault="qualified"><s:import namespace="urn:other" schemaLocation="other.xsd"/><s:element name="person"><s:complexType><s:sequence><s:element name="firstName" type="s:string"/></s:sequence></s:complexType></s:element><s:element name="employee" type="s:string"/></s:schema>';
    const result = createXmlCollection('<person xmlns="urn:people"><firstName>A</firstName></person>', schema, 'person', 'persons');
    const doc = parseTransformXml(result.schema);
    const globals = Array.from(doc.documentElement.children);
    expect(globals.map(e => e.getAttribute('name'))).toEqual([null, 'person', 'employee', 'persons']);
    expect(globals[0].getAttribute('schemaLocation')).toBe('other.xsd');
    expect(globals[1].getElementsByTagNameNS(XSD, 'complexType')).toHaveLength(1);
    const ref = globals[3].getElementsByTagNameNS(XSD, 'element')[0];
    expect(ref.getAttribute('ref')).toBe('record:person');
    expect(ref.lookupNamespaceURI('record')).toBe('urn:people');
    expect(ref.getAttribute('minOccurs')).toBe('0');
    expect(ref.getAttribute('maxOccurs')).toBe('unbounded');
    expect(parseTransformXml(result.xml).documentElement.namespaceURI).toBe('urn:people');
  });

  it('supports schema-only collections and no-target-namespace schemas with a default XSD namespace', () => {
    const schema = '<schema xmlns="http://www.w3.org/2001/XMLSchema"><element name="person" type="string"/></schema>';
    const result = createXmlCollection('', schema, 'person', 'persons');
    expect(result.xml).toBe('');
    const doc = parseTransformXml(result.schema);
    const local = Array.from(doc.getElementsByTagNameNS(XSD, 'element'))
      .find(e => e.getAttribute('name') === 'person' && e.getAttribute('maxOccurs') === 'unbounded')!;
    expect(local.getAttribute('minOccurs')).toBe('0');
    expect(local.getAttribute('type')).toBe('string');
  });

  it.each(['', '9persons', 'two words', 'p:persons', '<persons>'])('rejects invalid collection name %s', name => {
    expect(() => createXmlCollection('<person/>', '', 'person', name)).toThrow();
  });

  it('rejects collisions, mismatched samples, abstract roots and invalid documents', () => {
    const schema = '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:p"><xs:element name="person"/><xs:element name="persons"/><xs:element name="abstract" abstract="true"/></xs:schema>';
    expect(() => createXmlCollection('', schema, 'person', 'persons')).toThrow('already uses');
    expect(() => createXmlCollection('', schema, 'abstract', 'items')).toThrow('concrete global');
    expect(() => createXmlCollection('<person/>', schema, 'person', 'items')).toThrow('namespace');
    expect(() => createXmlCollection('<employee/>', '', 'person', 'items')).toThrow('root');
    expect(() => createXmlCollection('<person/>', '', 'person', 'person')).toThrow('different');
    expect(() => createXmlCollection('', '', 'person', 'persons')).toThrow('Provide XML');
    expect(() => createXmlCollection('<broken>', '', 'person', 'persons')).toThrow('Invalid XML');
  });
});
