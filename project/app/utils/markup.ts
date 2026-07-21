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
    case 'xml':  return '.xml,application/xml';
    default:     return '.json,application/json';
  }
}

export function detectMarkupLanguageFromPath(path: string): MarkupLanguage {
  const lower = String(path || '').toLowerCase();
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  if (lower.endsWith('.xml')) return 'xml';
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
      // TODO: import a DOM/XMLParser and replace this stub
      throw new Error('XML support coming soon');
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
      // TODO: implement XML serialiser and replace this stub
      throw new Error('XML support coming soon');
    }
  }
}
