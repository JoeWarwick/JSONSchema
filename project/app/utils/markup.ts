/**
 * Markup language abstraction layer.
 *
 * Internal data is always plain JS values. This module handles serialisation
 * and deserialisation between JSON/YAML/XML and the user-selected markup
 * language so that the rest of the app only ever works with plain objects.
 */

import yaml from "js-yaml";

const { load: loadYaml, dump: dumpYaml } = yaml;

export type MarkupLanguage = 'json' | 'yaml' | 'xml';

/** Human-readable display label for the language */
export const markupLabel: Record<MarkupLanguage, string> = {
  json: 'JSON',
  yaml: 'YAML',
  xml: 'XML',
};

/** File extension (with leading dot) */
export function fileExtension(lang: MarkupLanguage): string {
  switch (lang) {
    case 'yaml': return '.yaml';
    case 'xml':  return '.xml';
    default:     return '.json';
  }
}

/** MIME type for Blob / Content-Type */
export function mimeType(lang: MarkupLanguage): string {
  switch (lang) {
    case 'yaml': return 'text/yaml';
    case 'xml':  return 'application/xml';
    default:     return 'application/json';
  }
}

/** Value for <input type="file" accept="…"> */
export function acceptAttr(lang: MarkupLanguage): string {
  switch (lang) {
    case 'yaml': return '.yaml,.yml,text/yaml';
    case 'xml':  return '.xml,.xsd,application/xml';
    default:     return '.json,application/json';
  }
}

export function detectMarkupLanguageFromPath(path: string): MarkupLanguage {
  const lower = String(path || '').toLowerCase();
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  if (lower.endsWith('.xml') || lower.endsWith('.xsd')) return 'xml';
  return 'json';
}

/**
 * Whether this language requires the textarea to display the *serialised*
 * form (true) rather than raw JSON (false).
 *
 * XML has namespaces and a fundamentally different structure, so the Input tab
 * must show properly serialised XML.  JSON and YAML share a compatible value
 * model and can use pass-through JSON for the internal textarea.
 */
export function isFullDisplay(lang: MarkupLanguage): boolean {
  return lang === 'xml';
}

export function extractXmlSchemaLocations(text: string): string[] {
  if (!text || typeof text !== 'string' || typeof DOMParser === 'undefined') return [];

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'application/xml');
    const parseError = doc.getElementsByTagName('parsererror')[0];
    if (parseError) return [];

    const root = doc.documentElement;
    if (!root) return [];

    const locations: string[] = [];
    const noNamespace = root.getAttribute('xsi:noNamespaceSchemaLocation') || root.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'noNamespaceSchemaLocation');
    if (noNamespace) locations.push(noNamespace.trim());

    const schemaLocation = root.getAttribute('xsi:schemaLocation') || root.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'schemaLocation');
    if (schemaLocation) {
      const tokens = schemaLocation.trim().split(/\s+/).filter(Boolean);
      for (let index = 1; index < tokens.length; index += 2) {
        const location = tokens[index];
        if (location) locations.push(location.trim());
      }
    }

    return Array.from(new Set(locations.filter(Boolean)));
  } catch {
    return [];
  }
}

export function resolveXmlSchemaLocation(location: string, baseUrl?: string): string | null {
  const raw = String(location || '').trim();
  if (!raw) return null;

  if (/^(https?:|file:)/i.test(raw)) return raw;

  if (baseUrl) {
    try {
      return new URL(raw, baseUrl).toString();
    } catch {
      // ignore and fall back below
    }
  }

  if (raw.startsWith('/')) {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return new URL(raw, window.location.origin).toString();
    }
    return raw;
  }

  const name = raw.split(/[\\/]/).filter(Boolean).pop() || raw;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/schemas/${name}`;
  }

  return raw;
}

type XmlNodeValue = string | XmlElementValue | XmlNodeValue[];

type XmlElementValue = {
  [key: string]: XmlNodeValue;
};

const XML_TEXT_KEY = '#text';
const XML_ATTRIBUTES_KEY = '@attributes';

function isElementNode(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

function isTextNode(node: Node): node is Text {
  return node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE;
}

function getXmlParser(): DOMParser | null {
  if (typeof DOMParser === 'undefined') return null;
  return new DOMParser();
}

function parseXmlElement(element: Element): XmlElementValue {
  const out: XmlElementValue = {};
  const childrenInOrder: Array<{ tagName: string; value: XmlElementValue }> = [];

  if (element.attributes.length > 0) {
    const attributes: Record<string, string> = {};
    for (const attr of Array.from(element.attributes)) {
      attributes[attr.name] = attr.value;
    }
    if (Object.keys(attributes).length > 0) {
      out[XML_ATTRIBUTES_KEY] = attributes;
    }
  }

  const textParts: string[] = [];

  for (const child of Array.from(element.childNodes)) {
    if (isTextNode(child)) {
      const value = child.nodeValue ?? '';
      if (value.trim().length > 0) textParts.push(value);
      continue;
    }

    if (!isElementNode(child)) continue;

    const childValue = parseXmlElement(child);
    
    // Store in order, preserving document sequence
    childrenInOrder.push({ tagName: child.tagName, value: childValue });
  }

  if (textParts.length > 0) {
    const text = textParts.join('').trim();
    if (text.length > 0) {
      if (childrenInOrder.length === 0) {
        return { [XML_TEXT_KEY]: text };
      }
      out[XML_TEXT_KEY] = text;
    }
  }

  // Build final structure: group by tag name for compatibility, but also store ordered list
  for (const { tagName, value } of childrenInOrder) {
    const existing = out[tagName];
    if (typeof existing === 'undefined') {
      out[tagName] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      out[tagName] = [existing, value];
    }
  }

  // Store the document-order list for graph building to use
  if (childrenInOrder.length > 0) {
    out['__childrenInOrder'] = childrenInOrder as any;
  }

  return out;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlElementToString(name: string, value: XmlNodeValue, indent = '', step = '  '): string {
  if (Array.isArray(value)) {
    return value.map(entry => xmlElementToString(name, entry, indent, step)).join('\n');
  }

  if (typeof value === 'string') {
    return `${indent}<${name}>${xmlEscape(value)}</${name}>`;
  }

  if (!value || typeof value !== 'object') {
    return `${indent}<${name} />`;
  }

  const attrs = (value as XmlElementValue)[XML_ATTRIBUTES_KEY] as Record<string, string> | undefined;
  const text = (value as XmlElementValue)[XML_TEXT_KEY];
  const childKeys = Object.keys(value as XmlElementValue).filter(key => key !== XML_ATTRIBUTES_KEY && key !== XML_TEXT_KEY);

  const attrText = attrs
    ? Object.entries(attrs).map(([key, attrValue]) => ` ${key}="${xmlEscape(String(attrValue))}"`).join('')
    : '';

  if (childKeys.length === 0 && typeof text === 'undefined') {
    return `${indent}<${name}${attrText} />`;
  }

  const childIndent = `${indent}${step}`;
  const body: string[] = [];

  if (typeof text !== 'undefined') {
    body.push(xmlEscape(String(text)));
  }

  for (const key of childKeys) {
    const childValue = (value as XmlElementValue)[key];
    if (Array.isArray(childValue)) {
      for (const entry of childValue) {
        body.push(xmlElementToString(key, entry, childIndent, step));
      }
    } else {
      body.push(xmlElementToString(key, childValue, childIndent, step));
    }
  }

  const bodyText = body.length > 0 ? `\n${body.join('\n')}\n${indent}` : '';
  return `${indent}<${name}${attrText}>${bodyText}</${name}>`;
}

function serializeXmlValue(data: unknown): string {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('XML serialization expects an object value');
  }

  const rootEntries = Object.entries(data as Record<string, unknown>);
  if (rootEntries.length !== 1) {
    throw new Error('XML serialization expects a single root element');
  }

  const [rootName, rootValue] = rootEntries[0];
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xmlElementToString(rootName, rootValue as XmlNodeValue)}`;
}

// ---------------------------------------------------------------------------
// Core parse / serialize
// ---------------------------------------------------------------------------

/**
 * Parse a markup string into a plain JS value.
 * Throws an Error (with a user-friendly message) when the language is not yet
 * supported or the input is syntactically invalid.
 */
export function parseMarkup(text: string, lang: MarkupLanguage): unknown {
  switch (lang) {
    case 'json': {
      return JSON.parse(text); // throws SyntaxError on bad input
    }
    case 'yaml': {
      return loadYaml(text, { json: true });
    }
    case 'xml': {
      const parser = getXmlParser();
      if (!parser) {
        throw new Error('XML parsing is not available in this environment');
      }

      const doc = parser.parseFromString(text, 'application/xml');
      const parseError = doc.getElementsByTagName('parsererror')[0];
      if (parseError) {
        throw new Error(parseError.textContent?.trim() || 'Invalid XML input');
      }

      const root = doc.documentElement;
      if (!root) {
        throw new Error('XML input did not contain a document element');
      }

      return { [root.tagName]: parseXmlElement(root) };
    }
  }
}

/**
 * Serialise a plain JS value to a markup string.
 * Throws an Error (with a user-friendly message) when the language is not yet
 * supported.
 */
export function serializeMarkup(data: unknown, lang: MarkupLanguage): string {
  switch (lang) {
    case 'json': {
      return JSON.stringify(data, null, 2);
    }
    case 'yaml': {
      return dumpYaml(data, {
        noRefs: true,
        sortKeys: false,
        lineWidth: -1,
      });
    }
    case 'xml': {
      return serializeXmlValue(data);
    }
  }
}
