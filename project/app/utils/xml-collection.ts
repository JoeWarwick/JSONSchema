import { parseTransformXml } from './transform';
import { schemaRoots } from './transform-datasource';

const XSD = 'http://www.w3.org/2001/XMLSchema';

export function createXmlCollection(xml: string, schema: string, recordName: string, collectionName: string): { xml: string; schema: string } {
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(collectionName)) {
    throw new Error('Use a collection name starting with a letter or underscore, followed by letters, digits, underscores, hyphens or dots (no prefix).');
  }
  if (!recordName || collectionName === recordName) throw new Error('Choose a collection name different from the record element.');
  const instance = xml.trim() ? parseTransformXml(xml) : null;
  let xsd = schema.trim() ? parseTransformXml(schema) : null;
  if (instance && xsd?.documentElement.namespaceURI === XSD
    && xsd.documentElement.localName === 'schema' && xsd.documentElement.children.length === 0) xsd = null;
  if (!instance && !xsd) throw new Error('Provide XML or an XSD with a concrete global record element.');
  if (instance && instance.documentElement.localName !== recordName) {
    throw new Error('The sample XML root does not match the selected record element.');
  }
  let namespace = instance?.documentElement.namespaceURI ?? '';
  if (xsd) {
    if (!schemaRoots(schema).includes(recordName)) throw new Error('Select a concrete global XSD element as the record.');
    const root = xsd.documentElement;
    if (Array.from(root.children).some(child => child.namespaceURI === XSD
      && child.localName === 'element' && child.getAttribute('name') === collectionName)) {
      throw new Error('An XSD element already uses this collection name.');
    }
    namespace = root.getAttribute('targetNamespace') ?? '';
    if (instance && (instance.documentElement.namespaceURI ?? '') !== namespace) {
      throw new Error('The sample XML namespace does not match the XSD target namespace.');
    }
    let prefix = root.prefix || root.lookupPrefix(XSD) || 'xs';
    while (root.lookupNamespaceURI(prefix) && root.lookupNamespaceURI(prefix) !== XSD) prefix += '_';
    root.setAttributeNS('http://www.w3.org/2000/xmlns/', `xmlns:${prefix}`, XSD);
    const element = xsd.createElementNS(XSD, `${prefix}:element`);
    element.setAttribute('name', collectionName);
    const type = xsd.createElementNS(XSD, `${prefix}:complexType`);
    const sequence = xsd.createElementNS(XSD, `${prefix}:sequence`);
    const record = xsd.createElementNS(XSD, `${prefix}:element`);
    if (namespace) {
      record.setAttribute('minOccurs', '0');
      record.setAttribute('maxOccurs', 'unbounded');
      record.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:record', namespace);
      record.setAttribute('ref', `record:${recordName}`);
      sequence.appendChild(record);
    } else {
      const global = Array.from(root.children)
        .find(child => child.namespaceURI === XSD && child.localName === 'element' && child.getAttribute('name') === recordName);
      if (!global) throw new Error('Select a concrete global XSD element as the record.');
      const local = xsd.createElementNS(XSD, `${prefix}:element`);
      local.setAttribute('name', recordName);
      local.setAttribute('minOccurs', '0');
      local.setAttribute('maxOccurs', 'unbounded');
      ['type', 'nillable', 'default', 'fixed', 'form'].forEach(attribute => {
        const value = global.getAttribute(attribute);
        if (value !== null) local.setAttribute(attribute, value);
      });
      if (!global.getAttribute('type')) {
        Array.from(global.children).filter(child =>
          child.namespaceURI === XSD && (child.localName === 'complexType' || child.localName === 'simpleType'),
        ).forEach(child => local.appendChild(child.cloneNode(true)));
      }
      sequence.appendChild(local);
    }
    type.appendChild(sequence);
    element.appendChild(type);
    root.appendChild(element);
  }
  if (instance) {
    const record = instance.documentElement;
    const wrapper = instance.createElementNS(namespace || null, collectionName);
    instance.replaceChild(wrapper, record);
    wrapper.appendChild(record);
  }
  const serializer = new XMLSerializer();
  return { xml: instance ? serializer.serializeToString(instance) : '', schema: xsd ? serializer.serializeToString(xsd) : '' };
}
