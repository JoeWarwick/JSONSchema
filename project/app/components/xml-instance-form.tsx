import { useState, useEffect, useMemo, useRef } from "react";
import styles from "./xml-instance-form.module.css";
import { Trash2, ChevronDown, ChevronRight, Plus } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip/tooltip";
import { XmlNodeRhsEditor as XmlInstanceNodeRhsEditor } from './xml-instance-rhs-editors';
import { readPreferredLocale } from '../i18n/intl';
import type { SchemaNode } from '../utils/schema-walker';
import { 
  walkSchema, 
  compileSchemaForWalking,
  getTypeAttributes,
  getAttributeEnumerations,
  getAttributeFacets,
  findElementInSchema,
  getAllTypeNames,
} from '../utils/schema-walker';
import type { CompiledSchema, ValidationFacets } from '../utils/schema-compiler';

/**
 * XmlInstanceForm renders an interactive form for XML document instance editing.
 * It displays XML elements and attributes with expandable/collapsible sections,
 * allowing users to add/remove elements and modify attribute values.
 * 
 * Since XSD schemas are themselves XML documents, this same component can be
 * used to render and edit XSD schema definitions by treating the schema XML
 * as an instance of the XML format.
 */

/**
 * Generates a unique key for storing choice data in localStorage.
 * Key format: "choice_<instanceHash>_<path>_<optionName>"
 */
function generateChoiceStorageKey(instanceXml: any, path: string[], optionName: string): string {
  // Create a simple hash of the instance XML for uniqueness
  const instanceStr = JSON.stringify(instanceXml).substring(0, 100);
  const instanceHash = String(instanceStr.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a; // Convert to 32bit integer
  }, 0));
  
  const pathStr = path.join('/');
  return `choice_${instanceHash}_${pathStr}_${optionName}`;
}

/**
 * Save a choice option's data to localStorage.
 */
function saveChoiceDataToStorage(instanceXml: any, path: string[], optionName: string, data: any): void {
  try {
    const key = generateChoiceStorageKey(instanceXml, path, optionName);
    localStorage.setItem(key, JSON.stringify(data));
    console.log(`[ChoiceStorage] Saved ${optionName} to ${key}`);
  } catch (e) {
    console.warn('[ChoiceStorage] Failed to save choice data:', e);
  }
}

/**
 * Restore a choice option's data from localStorage.
 */
function restoreChoiceDataFromStorage(instanceXml: any, path: string[], optionName: string): any {
  try {
    const key = generateChoiceStorageKey(instanceXml, path, optionName);
    const stored = localStorage.getItem(key);
    if (stored) {
      console.log(`[ChoiceStorage] Restored ${optionName} from ${key}`);
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn('[ChoiceStorage] Failed to restore choice data:', e);
  }
  return null;
}

/**
 * Clear all stored choice data for a specific path and option.
 * Can be exposed via UI if needed to allow users to reset saved choice branches.
 */
// function clearChoiceDataFromStorage(instanceXml: any, path: string[], optionName: string): void {
//   try {
//     const key = generateChoiceStorageKey(instanceXml, path, optionName);
//     localStorage.removeItem(key);
//     console.log(`[ChoiceStorage] Cleared ${optionName} from ${key}`);
//   } catch (e) {
//     console.warn('[ChoiceStorage] Failed to clear choice data:', e);
//   }
// }

interface XmlInstanceFormProps {
  schema: any; // The XML element/schema to render
  value: any; // Current XML instance value 
  onChange: (value: any) => void;
  path?: string[];
  rootSchema?: any;
  autoFocus?: boolean;
  autoExpandAll?: boolean; // If true, automatically expand all nested elements
  showRootElementTriggers?: boolean;
  expansionStateKey?: string;
}

function getXmlInstanceExpansionStorageKey(schema: any, path: string[], expansionStateKey: string) {
  const payload = JSON.stringify(schema ?? {});
  let hash = 0;
  for (let i = 0; i < payload.length; i += 1) {
    hash = (hash * 31 + payload.charCodeAt(i)) >>> 0;
  }
  return `${expansionStateKey}:${path.join('.')}:${hash}`;
}

interface XmlAttribute {
  name: string;
  value: any;
}

interface XmlElement {
  tagName: string;
  attributes: XmlAttribute[];
  children: (XmlElement | string)[];
  text: string;
  isCompositor?: boolean;
}

function getSuggestedAttributeNamesForTag(tagName: string): string[] {
  const local = (tagName || '').replace(/^.*:/, '');
  const map: Record<string, string[]> = {
    schema: ['targetNamespace', 'version', 'finalDefault', 'blockDefault', 'attributeFormDefault', 'elementFormDefault', 'id', 'xml:lang'],
    annotation: ['id'],
    documentation: ['source', 'xml:lang'],
    appinfo: ['source'],
    import: ['namespace', 'schemaLocation', 'id'],
    include: ['schemaLocation', 'id'],
    redefine: ['schemaLocation', 'id'],
    complexType: ['name', 'mixed', 'abstract', 'final', 'block', 'id'],
    simpleType: ['name', 'id', 'final'],
    element: ['name', 'ref', 'type', 'substitutionGroup', 'minOccurs', 'maxOccurs', 'default', 'fixed', 'nillable', 'abstract', 'final', 'block', 'form', 'id'],
    attribute: ['name', 'ref', 'type', 'use', 'default', 'fixed', 'form', 'id'],
    attributeGroup: ['name', 'ref', 'id'],
    group: ['name', 'ref', 'minOccurs', 'maxOccurs', 'id'],
    sequence: ['minOccurs', 'maxOccurs', 'id'],
    choice: ['minOccurs', 'maxOccurs', 'id'],
    all: ['minOccurs', 'maxOccurs', 'id'],
    any: ['namespace', 'processContents', 'minOccurs', 'maxOccurs', 'id'],
    anyAttribute: ['namespace', 'processContents', 'id'],
  };
  return map[local] || [];
}

// Heuristic to pick an HTML input type for an attribute based on value or name
function detectAttributeInputType(name: string, value: any) {
  if (typeof value === 'boolean') return 'checkbox';
  if (value === null || value === undefined) return 'text';
  const s = String(value);
  // booleans as strings
  if (/^(true|false)$/i.test(s)) return 'checkbox';
  // integers or floats
  if (!isNaN(Number(s)) && s.trim() !== '') return 'number';
  // ISO date-ish
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?/.test(s)) return 'date';
  // simple url
  if (/^https?:\/\//.test(s)) return 'url';
  // simple email
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return 'email';
  return 'text';
}

/**
 * Schema Walking Utilities
 * These functions traverse the XML Schema (XSD) structure to extract type information
 * and element/attribute definitions for generating instance forms.
 */


/**
 * Generate HTML validation attributes from facets.
 * Returns attributes object for input elements (minLength, maxLength, pattern, etc.)
 */
function facetsToInputAttrs(facets: ValidationFacets | undefined): Record<string, string | number> {
  const attrs: Record<string, string | number> = {};
  if (!facets) return attrs;

  if (facets.minLength !== undefined) attrs.minLength = facets.minLength;
  if (facets.maxLength !== undefined) attrs.maxLength = facets.maxLength;
  if (facets.length !== undefined) attrs.maxLength = facets.length;
  if (facets.pattern) attrs.pattern = facets.pattern;
  if (facets.minInclusive !== undefined) attrs.min = facets.minInclusive;
  if (facets.maxInclusive !== undefined) attrs.max = facets.maxInclusive;

  return attrs;
}

/**
 * Generate validation hint text from facets.
 * Returns a human-readable description of constraints.
 */
function facetsToHint(facets: ValidationFacets | undefined): string | null {
  if (!facets) return null;

  const hints: string[] = [];
  if (facets.minLength !== undefined && facets.maxLength !== undefined) {
    hints.push(`${facets.minLength}-${facets.maxLength} characters`);
  } else if (facets.minLength !== undefined) {
    hints.push(`min ${facets.minLength} characters`);
  } else if (facets.maxLength !== undefined) {
    hints.push(`max ${facets.maxLength} characters`);
  }

  if (facets.length !== undefined) {
    hints.push(`exactly ${facets.length} characters`);
  }

  if (facets.pattern) {
    hints.push(`matches: ${facets.pattern}`);
  }

  if (facets.minInclusive !== undefined && facets.maxInclusive !== undefined) {
    hints.push(`${facets.minInclusive} to ${facets.maxInclusive}`);
  } else if (facets.minInclusive !== undefined) {
    hints.push(`≥ ${facets.minInclusive}`);
  } else if (facets.maxInclusive !== undefined) {
    hints.push(`≤ ${facets.maxInclusive}`);
  }

  if (facets.fractionDigits !== undefined) {
    hints.push(`${facets.fractionDigits} decimal places`);
  }

  if (facets.totalDigits !== undefined) {
    hints.push(`max ${facets.totalDigits} digits`);
  }

  return hints.length > 0 ? hints.join(', ') : null;
}

// Try to locate an element declaration in the XSD-like `rootSchema` object and return its type.
const normalizeXmlName = (name: unknown): string => String(name ?? '').replace(/^.*:/, '');

const toArray = <T,>(value: T | T[] | null | undefined): T[] =>
  Array.isArray(value) ? value : (value == null ? [] : [value]);

function findElementDefinitionInRootSchema(root: any, elementName: string): any | null {
  if (!root || typeof root !== 'object') return null;

  const targetName = normalizeXmlName(elementName);
  let found: any | null = null;

  const walk = (node: any) => {
    if (!node || typeof node !== 'object' || found) return;

    for (const key of Object.keys(node)) {
      if (found) return;

      const val = node[key];
      if (!val) continue;

      if (key === 'xs:element' || key === 'element') {
        const candidates = toArray(val);
        for (const elem of candidates) {
          if (!elem) continue;
          const attrs = elem['@attributes'] || elem;
          const candidateName = normalizeXmlName(attrs?.name || attrs?.['@name']);
          if (candidateName && candidateName === targetName) {
            found = elem;
            return;
          }
        }
      }

      if (Array.isArray(val)) {
        for (const item of val) {
          walk(item);
          if (found) return;
        }
      } else if (typeof val === 'object') {
        walk(val);
      }
    }
  };

  walk(root);
  return found;
}

function findElementTypeInRootSchema(root: any, elementName: string): string | null {
  const elementDef = findElementDefinitionInRootSchema(root, elementName);
  if (!elementDef || typeof elementDef !== 'object') return null;
  const attrs = elementDef['@attributes'] || elementDef;
  const elemType = attrs?.type || attrs?.['@type'];
  return typeof elemType === 'string' ? elemType : null;
}

function readWidgetValue(candidate: any): string | null {
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    return trimmed ? trimmed : null;
  }
  if (!candidate || typeof candidate !== 'object') return null;

  const attrs = candidate['@attributes'] && typeof candidate['@attributes'] === 'object'
    ? candidate['@attributes']
    : candidate;

  const direct = attrs['ui:widget']
    || attrs['x-ui:widget']
    || attrs.widget
    || attrs['@ui:widget']
    || attrs['@widget'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const typeAttr = attrs.type || attrs['@type'];
  if (typeof typeAttr === 'string' && typeAttr.trim()) return typeAttr.trim();

  const text = candidate._text || candidate['#text'];
  if (typeof text === 'string' && text.trim()) return text.trim();

  return null;
}

function findElementWidgetInRootSchema(root: any, elementName: string): string | null {
  const elementDef = findElementDefinitionInRootSchema(root, elementName);
  if (!elementDef || typeof elementDef !== 'object') return null;

  const attrs = elementDef['@attributes'] || elementDef;
  const directWidget = readWidgetValue({
    'ui:widget': attrs?.['ui:widget'],
    'x-ui:widget': attrs?.['x-ui:widget'],
    widget: attrs?.widget,
  });
  if (directWidget) return directWidget;

  const annotations = toArray(elementDef['xs:annotation'] || elementDef.annotation);
  for (const annotation of annotations) {
    const appInfos = toArray(annotation?.['xs:appinfo'] || annotation?.appinfo);
    for (const appInfo of appInfos) {
      if (!appInfo || typeof appInfo !== 'object') continue;

      const explicitWidget = readWidgetValue(appInfo['ui:widget'] || appInfo['x-ui:widget'] || appInfo.widget);
      if (explicitWidget) return explicitWidget;

      for (const [key, value] of Object.entries(appInfo)) {
        if (key === 'ui:widget' || key === 'x-ui:widget' || key === 'widget' || key.endsWith(':widget')) {
          const namedWidget = readWidgetValue(value);
          if (namedWidget) return namedWidget;
        }
      }
    }
  }

  return null;
}

function findComplexTypeDefinitionInRootSchema(root: any, typeName: string): any | null {
  if (!root || typeof root !== 'object' || !typeName) return null;
  const targetType = normalizeXmlName(typeName);
  let found: any | null = null;

  const walk = (node: any) => {
    if (!node || typeof node !== 'object' || found) return;
    for (const key of Object.keys(node)) {
      if (found) return;
      const val = node[key];
      if (!val) continue;

      if (key === 'xs:complexType' || key === 'complexType') {
        const candidates = toArray(val);
        for (const candidate of candidates) {
          if (!candidate || typeof candidate !== 'object') continue;
          const attrs = candidate['@attributes'] || candidate;
          const name = normalizeXmlName(attrs?.name || attrs?.['@name']);
          if (name && name === targetType) {
            found = candidate;
            return;
          }
        }
      }

      if (Array.isArray(val)) {
        for (const item of val) {
          walk(item);
          if (found) return;
        }
      } else if (typeof val === 'object') {
        walk(val);
      }
    }
  };

  walk(root);
  return found;
}

function getAttributeDeclarations(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  const direct = toArray(node['xs:attribute'] || node.attribute);
  const extensions = toArray(node['xs:extension'] || node.extension);
  const restrictions = toArray(node['xs:restriction'] || node.restriction);
  const simpleContent = toArray(node['xs:simpleContent'] || node.simpleContent);
  const complexContent = toArray(node['xs:complexContent'] || node.complexContent);

  return [
    ...direct,
    ...extensions.flatMap(getAttributeDeclarations),
    ...restrictions.flatMap(getAttributeDeclarations),
    ...simpleContent.flatMap(getAttributeDeclarations),
    ...complexContent.flatMap(getAttributeDeclarations),
  ];
}

function extractWidgetFromAnnotatedNode(node: any): string | null {
  if (!node || typeof node !== 'object') return null;
  const attrs = node['@attributes'] || node;

  const directWidget = readWidgetValue({
    'ui:widget': attrs?.['ui:widget'],
    'x-ui:widget': attrs?.['x-ui:widget'],
    widget: attrs?.widget,
  });
  if (directWidget) return directWidget;

  const annotations = toArray(node['xs:annotation'] || node.annotation);
  for (const annotation of annotations) {
    const appInfos = toArray(annotation?.['xs:appinfo'] || annotation?.appinfo);
    for (const appInfo of appInfos) {
      if (!appInfo || typeof appInfo !== 'object') continue;
      const explicitWidget = readWidgetValue(appInfo['ui:widget'] || appInfo['x-ui:widget'] || appInfo.widget);
      if (explicitWidget) return explicitWidget;

      for (const [key, value] of Object.entries(appInfo)) {
        if (key === 'ui:widget' || key === 'x-ui:widget' || key === 'widget' || key.endsWith(':widget')) {
          const namedWidget = readWidgetValue(value);
          if (namedWidget) return namedWidget;
        }
      }
    }
  }

  return null;
}

function findAttributeWidgetInRootSchema(root: any, elementName: string, attributeName: string): string | null {
  if (!root || typeof root !== 'object') return null;
  const targetAttr = normalizeXmlName(attributeName);
  if (!targetAttr) return null;

  const elementDef = findElementDefinitionInRootSchema(root, elementName);
  const elementAttrs = elementDef && typeof elementDef === 'object' ? (elementDef['@attributes'] || elementDef) : null;
  const typeName = normalizeXmlName(elementAttrs?.type || elementAttrs?.['@type']);

  const declarationCandidates: any[] = [];
  if (elementDef) {
    declarationCandidates.push(...getAttributeDeclarations(elementDef));
    const inlineComplexType = toArray(elementDef['xs:complexType'] || elementDef.complexType);
    inlineComplexType.forEach((ct) => {
      declarationCandidates.push(...getAttributeDeclarations(ct));
    });
  }

  if (typeName) {
    const complexTypeDef = findComplexTypeDefinitionInRootSchema(root, typeName);
    declarationCandidates.push(...getAttributeDeclarations(complexTypeDef));
  }

  declarationCandidates.push(...toArray((root && typeof root === 'object') ? (root['xs:attribute'] || root.attribute) : undefined));
  const schemaRoot = getSchemaRootNode(root);
  declarationCandidates.push(...toArray((schemaRoot && typeof schemaRoot === 'object') ? (schemaRoot['xs:attribute'] || schemaRoot.attribute) : undefined));

  for (const decl of declarationCandidates) {
    if (!decl || typeof decl !== 'object') continue;
    const declAttrs = decl['@attributes'] || decl;
    const declName = normalizeXmlName(declAttrs?.name || declAttrs?.['@name'] || declAttrs?.ref || declAttrs?.['@ref']);
    if (!declName || declName !== targetAttr) continue;
    const widget = extractWidgetFromAnnotatedNode(decl);
    if (widget) return widget;
  }

  if (targetAttr === 'xml:lang' || targetAttr === 'lang') {
    return 'lang';
  }

  return null;
}

function normalizeColorInputValue(value: string): string {
  const trimmed = String(value || '').trim();
  const shortHexMatch = /^#([0-9a-fA-F]{3})$/.exec(trimmed);
  if (shortHexMatch) {
    const [r, g, b] = shortHexMatch[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const fullHexMatch = /^#([0-9a-fA-F]{6})$/.exec(trimmed);
  if (fullHexMatch) return `#${fullHexMatch[1]}`.toLowerCase();
  return '#000000';
}

const COUNTRY_CODES = [
  'US',
  'GB',
  'CA',
  'AU',
  'NZ',
  'IE',
  'FR',
  'DE',
  'ES',
  'IT',
  'NL',
  'BE',
  'CH',
  'AT',
  'SE',
  'NO',
  'DK',
  'FI',
  'PT',
  'PL',
  'CZ',
  'HU',
  'GR',
  'TR',
  'JP',
  'KR',
  'CN',
  'IN',
  'SG',
  'MY',
  'TH',
  'VN',
  'PH',
  'ID',
  'BR',
  'MX',
  'AR',
  'CL',
  'CO',
  'PE',
  'ZA',
  'NG',
  'EG',
  'KE',
  'MA',
] as const;

const LANGUAGE_TAGS = [
  'en',
  'en-US',
  'en-GB',
  'fr',
  'fr-CA',
  'de',
  'es',
  'es-MX',
  'it',
  'pt',
  'pt-BR',
  'nl',
  'sv',
  'no',
  'da',
  'fi',
  'pl',
  'cs',
  'hu',
  'el',
  'tr',
  'ru',
  'uk',
  'ja',
  'ko',
  'zh',
  'zh-CN',
  'zh-TW',
  'ar',
  'hi',
] as const;

function getCountryOptions() {
  const locale = readPreferredLocale();
  const displayNames = typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames([locale], { type: 'region' })
    : null;

  return COUNTRY_CODES.map((code) => ({
    code,
    label: displayNames?.of(code) || code,
  }));
}

function getLanguageTagOptions() {
  const locale = readPreferredLocale();
  const displayNames = typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames([locale], { type: 'language' })
    : null;

  return LANGUAGE_TAGS.map((tag) => ({
    tag,
    label: displayNames?.of(tag) || tag,
  }));
}

function renderCountryInput(
  textValue: string,
  onValueChange: (nextValue: string) => void,
  testId?: string,
) {
  const listId = testId ? `${testId}-country-list` : 'country-list';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, maxWidth: 320 }}>
      <input
        data-testid={testId}
        type="text"
        list={listId}
        value={textValue}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder="Select or type a country"
        style={{
          flex: 1,
          maxWidth: 320,
          padding: '6px 8px',
          border: '1px solid #ddd',
          borderRadius: 3,
          fontSize: 12,
        }}
      />
      <datalist id={listId}>
        {getCountryOptions().map((country) => (
          <option key={country.code} value={country.label} />
        ))}
      </datalist>
    </div>
  );
}

function renderLanguageInput(
  textValue: string,
  onValueChange: (nextValue: string) => void,
  testId?: string,
) {
  const listId = testId ? `${testId}-language-list` : 'language-list';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, maxWidth: 320 }}>
      <input
        data-testid={testId}
        type="text"
        list={listId}
        value={textValue}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder="Select or type a language tag"
        style={{
          flex: 1,
          maxWidth: 320,
          padding: '6px 8px',
          border: '1px solid #ddd',
          borderRadius: 3,
          fontSize: 12,
        }}
      />
      <datalist id={listId}>
        {getLanguageTagOptions().map((language) => (
          <option key={language.tag} value={language.tag} label={language.label} />
        ))}
      </datalist>
    </div>
  );
}

function mapXsdTypeToHtmlInput(xsdType: string | null) {
  if (!xsdType) return null;
  const t = String(xsdType).toLowerCase();
  if (t.includes('boolean')) return 'checkbox';
  if (t.includes('int') || t.includes('decimal') || t.includes('double') || t.includes('float') || t.includes('integer') || t.includes('number')) return 'number';
  if (t.includes('date') || t.includes('time')) return 'date';
  if (t.includes('anyuri') || t.includes('uri') || t.includes('url')) return 'url';
  if (t.includes('email')) return 'email';
  return 'text';
}

function renderSimpleValueInput(
  widgetHint: string | null,
  htmlInputType: string,
  textValue: string,
  onValueChange: (nextValue: string) => void,
  testId?: string,
) {
  if (widgetHint === 'lang') {
    return renderLanguageInput(textValue, onValueChange, testId);
  }

  if (widgetHint === 'country') {
    return renderCountryInput(textValue, onValueChange, testId);
  }

  if (htmlInputType !== 'color') {
    return (
      <input
        data-testid={testId}
        type={htmlInputType as any}
        value={textValue}
        onChange={(e) => onValueChange(e.target.value)}
        style={{
          flex: 1,
          maxWidth: 200,
          padding: '6px 8px',
          border: '1px solid #ddd',
          borderRadius: 3,
          fontSize: 12,
        }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, maxWidth: 320 }}>
      <input
        data-testid={testId}
        type="color"
        value={normalizeColorInputValue(textValue)}
        onChange={(e) => onValueChange(e.target.value)}
        style={{ width: 40, height: 30, padding: 0, border: '1px solid #ddd', borderRadius: 3, cursor: 'pointer' }}
      />
      <input
        type="text"
        value={textValue}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder="#rrggbb"
        style={{
          flex: 1,
          minWidth: 90,
          padding: '6px 8px',
          border: '1px solid #ddd',
          borderRadius: 3,
          fontSize: 12,
        }}
      />
    </div>
  );
}



function getSchemaRootNode(root: any): any {
  if (!root || typeof root !== 'object') return null;
  return root['xs:schema'] || root['schema'] || root;
}

function getSchemaImports(root: any): Array<{ namespace: string; schemaLocation: string }> {
  const schemaRoot = getSchemaRootNode(root);
  if (!schemaRoot || typeof schemaRoot !== 'object') return [];
  const raw = schemaRoot['xs:import'] || schemaRoot['import'];
  if (!raw) return [];
  const imports = Array.isArray(raw) ? raw : [raw];
  return imports
    .map((it: any) => ({
      namespace: String(it?.['@namespace'] || it?.namespace || ''),
      schemaLocation: String(it?.['@schemaLocation'] || it?.schemaLocation || ''),
    }))
    .filter((it: any) => it.namespace || it.schemaLocation);
}

function getSchemaAnnotations(root: any): string[] {
  const schemaRoot = getSchemaRootNode(root);
  if (!schemaRoot || typeof schemaRoot !== 'object') return [];
  const annotations = schemaRoot['xs:annotation'] || schemaRoot['annotation'];
  if (!annotations) return [];
  const list = Array.isArray(annotations) ? annotations : [annotations];
  const docs: string[] = [];
  for (const ann of list) {
    const doc = ann?.['xs:documentation'] || ann?.documentation;
    if (!doc) continue;
    const docList = Array.isArray(doc) ? doc : [doc];
    for (const d of docList) {
      if (typeof d === 'string') docs.push(d);
      else if (d && typeof d === 'object' && typeof d._text === 'string') docs.push(d._text);
    }
  }
  return docs.filter(Boolean);
}

function getSchemaAttributeValue(root: any, attributeName: string): string {
  const schemaRoot = getSchemaRootNode(root);
  if (!schemaRoot || typeof schemaRoot !== 'object') return '';

  const direct = schemaRoot[`@${attributeName}`];
  if (direct !== undefined && direct !== null) return String(direct);

  const wrapped = schemaRoot?.['@attributes']?.[attributeName];
  if (wrapped !== undefined && wrapped !== null) return String(wrapped);

  return '';
}

function getSchemaCustomNamespaces(root: any): Array<{ prefix: string; uri: string }> {
  const schemaRoot = getSchemaRootNode(root);
  if (!schemaRoot || typeof schemaRoot !== 'object') return [];

  const namespaces: Array<{ prefix: string; uri: string }> = [];
  const seen = new Set<string>();

  const collectFromContainer = (container: any) => {
    if (!container || typeof container !== 'object') return;
    for (const key of Object.keys(container)) {
      const plainKey = key.startsWith('@') ? key.slice(1) : key;
      if (!plainKey.startsWith('xmlns:')) continue;

      const prefix = plainKey.slice('xmlns:'.length);
      // Keep xmlns:xsi in its dedicated field; include everything else (including xs).
      if (!prefix || prefix === 'xsi' || seen.has(prefix)) continue;

      const val = container[key];
      if (val === undefined || val === null) continue;
      namespaces.push({ prefix, uri: String(val) });
      seen.add(prefix);
    }
  };

  collectFromContainer(schemaRoot);
  collectFromContainer(schemaRoot['@attributes']);

  return namespaces;
}

function hasAnyDeclaration(node: any): boolean {
  if (!node || typeof node !== 'object') return false;
  if (node['xs:any'] || node['any']) return true;
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) {
      if (value.some((item) => hasAnyDeclaration(item))) return true;
    } else if (value && typeof value === 'object') {
      if (hasAnyDeclaration(value)) return true;
    }
  }
  return false;
}

function canAddCustomAttributeForElement(element: XmlElement, rootSchema: any): boolean {
  if (!rootSchema || typeof rootSchema !== 'object') return false;

  const localTag = (element.tagName || '').replace(/^.*:/, '');
  if (!localTag) return false;

  // If this node already directly carries a wildcard declaration, allow custom attributes.
  if (element.children.some((c) => typeof c !== 'string' && ['any', 'xs:any'].includes(c.tagName))) {
    return true;
  }

  const schemaRoot = getSchemaRootNode(rootSchema);
  if (!schemaRoot || typeof schemaRoot !== 'object') return false;

  const typeHasAny = (typeName: string): boolean => {
    if (!typeName) return false;
    const normalized = typeName.replace(/^.*:/, '');
    const complexTypes = schemaRoot['xs:complexType'] || schemaRoot['complexType'];
    if (!complexTypes) return false;
    const list = Array.isArray(complexTypes) ? complexTypes : [complexTypes];
    for (const ct of list) {
      const name = String(ct?.['@name'] || ct?.name || '').replace(/^.*:/, '');
      if (name && name === normalized && hasAnyDeclaration(ct)) return true;
    }
    return false;
  };

  const globalElements = schemaRoot['xs:element'] || schemaRoot['element'];
  const elementList = globalElements ? (Array.isArray(globalElements) ? globalElements : [globalElements]) : [];

  for (const el of elementList) {
    const name = String(el?.['@name'] || el?.name || '').replace(/^.*:/, '');
    if (!name || name !== localTag) continue;

    const declaredType = String(el?.['@type'] || el?.type || '');
    if (declaredType && typeHasAny(declaredType)) return true;

    if (hasAnyDeclaration(el)) return true;
  }

  // Fallback for schema-document editing paths where node tag name may map to a complexType name.
  if (typeHasAny(localTag)) return true;

  return false;
}

// Convert DOM-like structure to XML element interface
function parseXmlElement(node: any, tagNameHint?: string): XmlElement | null {
  if (!node || typeof node !== 'object') return null;

  // Extract tag name
  let tagName = '';
  if (tagNameHint) {
    tagName = tagNameHint;
  } else if (node.nodeName) {
    tagName = node.nodeName;
  } else if (node['@name']) {
    tagName = node['@name'];
  } else if (node.name) {
    tagName = node.name;
  } else {
    // Try to find a key that doesn't start with @ or _
    for (const key in node) {
      if (!key.startsWith('@') && !key.startsWith('_') && key !== 'nodeName' && key !== 'name') {
        const val = node[key];
        // If this key points to an object (not string/number/boolean), it might be an element
        if (typeof val === 'object' && val !== null) {
          tagName = key;
          break;
        }
      }
    }
  }

  if (!tagName) return null;
  // If node contains a nested object under the tag name (format: { 'xs:schema': { ... } }),
  // unwrap it so we read attributes/children from the inner object.
  let nodeContent: any = node;
  if (node && typeof node === 'object' && node[tagName] && typeof node[tagName] === 'object') {
    nodeContent = node[tagName];
  }
  // Prepare attributes container before any merging logic
  const attributes: XmlAttribute[] = [];

  // Support legacy wrapper where attributes are grouped under '@attributes'
  if (nodeContent && typeof nodeContent === 'object' && nodeContent['@attributes'] && typeof nodeContent['@attributes'] === 'object') {
    for (const a in nodeContent['@attributes']) {
      if (!attributes.some(attr => attr.name === a)) {
        const val = nodeContent['@attributes'][a];
        if (val !== null && typeof val !== 'object') {
          attributes.push({ name: a, value: val });
        }
      }
    }
  }

  // Extract @ prefixed attributes from the content
  for (const key in nodeContent) {
    if (key.startsWith('@')) {
      attributes.push({
        name: key.substring(1),
        value: nodeContent[key] ?? '',
      });
    }
  }

  // Also support a legacy or normalized `attributes` object: { attributes: { name: value, ... } }
  if (nodeContent.attributes && typeof nodeContent.attributes === 'object' && !Array.isArray(nodeContent.attributes)) {
    for (const a in nodeContent.attributes) {
      const val = nodeContent.attributes[a];
      // Only treat primitive attribute values as attributes. If the value is an object,
      // it's more likely a nested element (e.g., XSD <attributes> child), so skip it.
      if (val !== null && typeof val === 'object') continue;
      // Avoid duplicating if already present
      if (!attributes.some(attr => attr.name === a)) {
        attributes.push({ name: a, value: val ?? '' });
      }
    }
  }

  // Collect child elements and text content
  const children: (XmlElement | string)[] = [];
  // Support both _text (legacy internal format) and #text (from parseMarkup)
  let text = nodeContent._text || nodeContent['#text'] || '';

  for (const key in nodeContent) {
    // Skip attribute holders we've already consumed
    if (key.startsWith('@') || key.startsWith('_') || key.startsWith('#') || key === 'nodeName' || key === 'name' || key === 'attributes') continue;
    // child entries here are actual nested elements
    const child = nodeContent[key];

    if (typeof child === 'string') {
      text += child;
    } else if (Array.isArray(child)) {
      for (const item of child) {
        const parsed = parseXmlElement(item, key);
        if (parsed) children.push(parsed);
        else if (typeof item === 'string') text += item;
      }
    } else if (child && typeof child === 'object') {
      const parsed = parseXmlElement(child, key);
      if (parsed) {
        // Unwrap element-as-key shapes that may arise from conversion
        children.push(parsed);
      }
    }
  }
  // Mark compositor elements so the renderer can badge them
  const compositorTags = new Set(['xs:sequence', 'xs:choice', 'xs:all', 'sequence', 'choice', 'all']);
  const isCompositor = compositorTags.has(tagName);

  return {
    tagName,
    attributes,
    children,
    text: text.trim(),
    isCompositor,
  };
}

// Recursively render an XML element with expansion state
function XmlElementNode({
  element,
  path,
  expandedPaths,
  onToggleExpand,
  value,
  onChange,
  onUpdateValue,
  rootSchema,
  autoExpandAll = false,
  schemaNode,
  compiledSchema,
  initialAutoExpandPathsRef,
  autoExpandCaptureActiveRef,
  isSchemaForm = false,
}: {
  element: XmlElement;
  path: string[];
  expandedPaths: Set<string>;
  onToggleExpand: (path: string[]) => void;
  value: any;
  onChange: (value: any) => void;
  onUpdateValue: (pathArray: string[], updateFn: (v: any) => any) => void;
  rootSchema?: any;
  autoExpandAll?: boolean;
  schemaNode?: SchemaNode;
  compiledSchema?: CompiledSchema | null;
  initialAutoExpandPathsRef?: React.MutableRefObject<Set<string>>;
  autoExpandCaptureActiveRef?: React.MutableRefObject<boolean>;
  isSchemaForm?: boolean;
}) {
  // State for tracking which choice option is selected
  const [selectedChoices, setSelectedChoices] = useState<Record<string, string>>({});
  
  const pathKey = path.join('.');
  if (autoExpandAll && autoExpandCaptureActiveRef?.current) {
    initialAutoExpandPathsRef?.current.add(pathKey);
  }

  const collapsedKey = `__collapsed__:${pathKey}`;
  const initiallyExpanded = Boolean(autoExpandAll && initialAutoExpandPathsRef?.current.has(pathKey));
  const explicitlyExpanded = expandedPaths.has(pathKey);
  const explicitlyCollapsed = expandedPaths.has(collapsedKey);
  const expanded = explicitlyExpanded || (initiallyExpanded && !explicitlyCollapsed);
  const elementTagName = typeof element.tagName === 'string' ? element.tagName : '';
  const localTagName = elementTagName.replace(/^.*:/, '');
  
  // Log schemaNode for root element
  if (path.length === 0) {
    console.log(`[XmlElementNode ROOT] element.tagName=${element.tagName}, schemaNode exists=${!!schemaNode}, schemaNode.children=${schemaNode?.children?.length || 0}`);
  }
  const inferredSchemaKind = rootSchema ? ({
    schema: 'schema',
    simpleType: 'simpleType',
    complexType: 'complexType',
    attributeGroup: 'attributeGroup',
    attribute: 'attribute',
    element: 'element',
    sequence: 'sequence',
    choice: 'choice',
    all: 'all',
    any: 'any',
  } as Record<string, string>)[localTagName] : undefined;
  const hasInferredEditor = Boolean(inferredSchemaKind);
  
  // Helper to find which choice group a child element belongs to
  const getChoiceGroupForChild = (childName: string): { groupIndex: number; isFirst: boolean } | null => {
    if (!schemaNode?.children) return null;
    
    let groupIndex = -1;
    let currentGroup: Array<string> | null = null;
    
    for (const child of schemaNode.children) {
      if (child.compositorType === 'choice') {
        if (!currentGroup) {
          groupIndex++;
          currentGroup = [];
        }
        currentGroup.push(child.label || child.tagName);
      } else {
        if (currentGroup) {
          // Group ended, check if child is first in it
          if (currentGroup.length > 0 && currentGroup[0] === childName) {
            return { groupIndex, isFirst: true };
          }
          // Check if child is in the group (not first)
          if (currentGroup.includes(childName)) {
            return { groupIndex, isFirst: false };
          }
          currentGroup = null;
        }
      }
    }
    
    // Check final group
    if (currentGroup && currentGroup.length > 0) {
      if (currentGroup[0] === childName) {
        return { groupIndex, isFirst: true };
      }
      if (currentGroup.includes(childName)) {
        return { groupIndex, isFirst: false };
      }
    }
    
    return null;
  };
  
  // Detect choice elements and group them
  const choiceGroups = useMemo(() => {
    if (!schemaNode?.children) return [];
    
    const groups: Array<{
      groupIndex: number;
      options: Array<{ name: string; node: SchemaNode }>;
    }> = [];
    let currentGroup: Array<{ name: string; node: SchemaNode }> | null = null;
    
    for (const child of schemaNode.children) {
      if (child.compositorType === 'choice') {
        // This is a choice element
        if (!currentGroup) {
          currentGroup = [];
        }
        currentGroup.push({
          name: child.label || child.tagName || '',
          node: child,
        });
      } else {
        // Non-choice element, close the group if one is open
        if (currentGroup && currentGroup.length > 0) {
          groups.push({
            groupIndex: groups.length,
            options: currentGroup,
          });
          currentGroup = null;
        }
      }
    }
    
    // Don't forget the last group if it exists
    if (currentGroup && currentGroup.length > 0) {
      groups.push({
        groupIndex: groups.length,
        options: currentGroup,
      });
    }
    
    return groups;
  }, [schemaNode?.children]);
  
  // For each choice group, determine the selected option
  const choiceInfo = useMemo(() => {
    return choiceGroups.map(group => {
      const choiceKey = `choice_${pathKey}_${group.groupIndex}`;
      let selectedOption: string | null = null;
      const isChoiceGroupRequired = group.options.some((opt) => {
        const min = Number(opt.node.minOccurs ?? 0);
        return Number.isFinite(min) && min > 0;
      });
      
      // Check if user has manually selected a choice
      if (selectedChoices[choiceKey]) {
        selectedOption = selectedChoices[choiceKey];
      } else {
        // Otherwise, check if any choice element has a value
        for (const option of group.options) {
          const optionData = compiledSchema
            ? compiledSchema.resolveChildData(
                option.name,
                element?.tagName,
                value,
                path.length === 0
              )
            : value?.[option.name];
          if (optionData !== undefined && optionData !== null) {
            selectedOption = option.name;
            break;
          }
        }
        // If no value found, only default when the choice is required by schema.
        if (!selectedOption && isChoiceGroupRequired && group.options.length > 0) {
          selectedOption = group.options[0].name;
        }
      }
      
      return {
        groupIndex: group.groupIndex,
        options: group.options,
        selectedOption,
        isRequired: isChoiceGroupRequired,
        choiceKey,
      };
    });
  }, [choiceGroups, pathKey, selectedChoices, value, compiledSchema, element?.tagName, path.length]);

  const shouldHideChildInInferredView = (child: XmlElement | string): boolean => {
    if (typeof child === 'string') return false;
    // In Schema Form mode we are editing the schema document itself, so show every
    // concrete child node (including xs:attribute/xs:anyAttribute) in the tree.
    if (isSchemaForm) return false;
    if (!hasInferredEditor) return false;
    if (!['complexType', 'attributeGroup', 'element'].includes(String(inferredSchemaKind))) return false;

    const childLocalTag = (child.tagName || '').replace(/^.*:/, '');
    // These are managed by the badge-based editors on the parent RHS panel.
    return childLocalTag === 'attribute' || childLocalTag === 'anyAttribute';
  };

  const elementChildren = Array.isArray(element.children) ? element.children : [];
  const elementAttributes = Array.isArray(element.attributes) ? element.attributes : [];
  const elementText = typeof element.text === 'string' ? element.text : '';

  const visibleChildren = elementChildren
    .map((child, rawIndex) => ({ child, rawIndex }))
    .filter(({ child }) => !shouldHideChildInInferredView(child));

  const hasChildren = visibleChildren.length > 0;
  const hasAttributes = elementAttributes.length > 0;
  const hasSchemaChildren = (schemaNode?.children?.length || 0) > 0;
  const hasSchemaAttributes = (schemaNode?.attributes?.length || 0) > 0;
  const hasExpandableContent = hasChildren || hasAttributes || hasSchemaChildren || hasSchemaAttributes;
  const hasText = elementText.length > 0;
  const isCompositor = !!element.isCompositor;
  const nodeNameAttribute = elementAttributes.find((a) => a.name === 'name')?.value;
  const collapsedSchemaNodeName = !expanded && isSchemaForm && typeof nodeNameAttribute === 'string' && nodeNameAttribute.trim().length > 0
    ? nodeNameAttribute.trim()
    : null;

  const asMutableElementObject = (entry: any): Record<string, any> => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) return { ...entry };
    return {};
  };

  const mutateElementOrArray = (current: any, mutate: (entry: Record<string, any>) => Record<string, any>): any => {
    if (Array.isArray(current)) {
      return current.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
        return mutate(asMutableElementObject(item));
      });
    }
    return mutate(asMutableElementObject(current));
  };

  const handleAttributeChange = (attrName: string, newValue: string) => {
    onUpdateValue(path, (current) => {
      return mutateElementOrArray(current, (updated) => {
        // Ensure @attributes object exists
        if (!updated['@attributes']) {
          updated['@attributes'] = {};
        }
        if (typeof updated['@attributes'] !== 'object') {
          updated['@attributes'] = {};
        }

        const attrs = updated['@attributes'] as Record<string, any>;
        attrs[attrName] = newValue;

        // Clean up old @<name> format if it exists
        delete updated['@' + attrName];

        // Also clean up legacy attributes format
        if (updated.attributes && typeof updated.attributes === 'object') {
          const legacyAttrs = { ...updated.attributes as Record<string, any> };
          delete legacyAttrs[attrName];
          if (Object.keys(legacyAttrs).length > 0) {
            updated.attributes = legacyAttrs;
          } else {
            delete updated.attributes;
          }
        }

        return updated;
      });
    });
  };

  const handleAddAttribute = () => {
    const newAttrName = prompt('Enter attribute name:');
    if (newAttrName && newAttrName.trim()) {
      onUpdateValue(path, (current) => {
        return mutateElementOrArray(current, (updated) => {
          if (!updated['@attributes']) {
            updated['@attributes'] = {};
          }
          if (typeof updated['@attributes'] !== 'object') {
            updated['@attributes'] = {};
          }
          const attrs = updated['@attributes'] as Record<string, any>;
          attrs[newAttrName.trim()] = '';
          return updated;
        });
      });
    }
  };

  const handleRemoveAttribute = (attrName: string) => {
    console.log('[debug-remove-attribute]', { path, attrName, value, currentPathValue: path.length ? (path.reduce((acc, part) => acc?.[part], value)) : value });
    onUpdateValue(path, (current) => {
      const result = mutateElementOrArray(current, (updated) => {
        if (updated['@attributes'] && typeof updated['@attributes'] === 'object') {
          const attrs = { ...updated['@attributes'] as Record<string, any> };
          delete attrs[attrName];
          if (Object.keys(attrs).length > 0) {
            updated['@attributes'] = attrs;
          } else {
            delete updated['@attributes'];
          }
        }
        if (updated.attributes && typeof updated.attributes === 'object' && !Array.isArray(updated.attributes)) {
          const legacyAttrs = { ...updated.attributes as Record<string, any> };
          delete legacyAttrs[attrName];
          if (Object.keys(legacyAttrs).length > 0) {
            updated.attributes = legacyAttrs;
          } else {
            delete updated.attributes;
          }
        }
        // Also clean up old format if it exists
        delete updated['@' + attrName];
        console.log('[debug-remove-attribute-result]', { attrName, updated });
        return updated;
      });
      console.log('[debug-remove-attribute-final]', { attrName, result });
      return result;
    });
  };

  const handleTextContentChange = (newText: string) => {
    onUpdateValue(path, (current) => {
      return mutateElementOrArray(current, (updated) => {
        if (newText.trim()) {
          updated._text = newText;
        } else {
          delete updated._text;
        }
        return updated;
      });
    });
  };

  const getGlobalRootElementTriggers = () => {
    if (path.length !== 0 || !rootSchema || typeof rootSchema !== 'object') return [];

    const schemaRoot = getSchemaRootNode(rootSchema);
    const rawElements = schemaRoot?.['xs:element'] || schemaRoot?.['element'];
    const elements = Array.isArray(rawElements) ? rawElements : rawElements ? [rawElements] : [];

    return elements
      .map((entry: any, index: number) => {
        const attrs = entry?.['@attributes'] || entry || {};
        const name = String(attrs?.name || attrs?.['@name'] || entry?.name || entry?.['@name'] || `root-${index}`);
        if (!name) return null;
        const maxOccursRaw = attrs?.maxOccurs ?? '1';
        const maxOccurs = maxOccursRaw === 'unbounded' ? Number.POSITIVE_INFINITY : Number(maxOccursRaw || '1');
        const minOccurs = Number(attrs?.minOccurs ?? '1');

        if (!(minOccurs === 1 && maxOccurs === 1)) {
          return null;
        }

        return { name, maxOccurs, minOccurs };
      })
      .filter((entry): entry is { name: string; maxOccurs: number; minOccurs: number } => Boolean(entry));
  };

  const getRootOccurrenceCount = (currentValue: any, childName: string): number => {
    if (!currentValue || typeof currentValue !== 'object' || Array.isArray(currentValue)) return 0;
    const resolved = currentValue[childName];
    if (resolved === undefined || resolved === null) return 0;
    return Array.isArray(resolved) ? resolved.length : 1;
  };

  const addRootElementOccurrence = (childName: string, maxOccurs: number) => {
    const current = value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : {};
    const rootTriggers = getGlobalRootElementTriggers();
    const selectedRoot = rootTriggers.find((trigger) => getRootOccurrenceCount(current, trigger.name) > 0)?.name ?? null;
    const count = getRootOccurrenceCount(current, childName);
    if (count >= maxOccurs) return;

    const nextValue = {};
    const updated = { ...current };

    if (selectedRoot && selectedRoot !== childName) {
      delete updated[selectedRoot];
    }

    if (count === 0) {
      updated[childName] = nextValue;
    } else if (Array.isArray(updated[childName])) {
      updated[childName] = [...updated[childName], nextValue];
    } else {
      updated[childName] = [updated[childName], nextValue];
    }

    onChange(updated);
  };

  const getChildMinOccurs = (child: SchemaNode): number => {
    const min = Number(child.minOccurs);
    return Number.isFinite(min) && min >= 0 ? min : 1;
  };

  const getChildMaxOccurs = (child: SchemaNode): number => {
    if (child.maxOccurs === 'unbounded') return Number.POSITIVE_INFINITY;
    const max = Number(child.maxOccurs);
    return Number.isFinite(max) && max >= 0 ? max : 1;
  };

  const getChildOccurrenceCount = (currentValue: any, childName: string): number => {
    const resolved = compiledSchema
      ? compiledSchema.resolveChildData(childName, element?.tagName, currentValue, path.length === 0)
      : currentValue?.[childName];
    if (resolved === undefined || resolved === null) return 0;
    return Array.isArray(resolved) ? resolved.length : 1;
  };

  const createDefaultChildValue = (child: SchemaNode): any => {
    const hasNestedChildren = (child.children?.length || 0) > 0;
    const hasAttributes = (child.attributes?.length || 0) > 0;
    if (!hasNestedChildren && !hasAttributes) return { _text: '' };
    return {};
  };

  const addChildOccurrence = (childName: string, childSchema: SchemaNode) => {
    const choiceGroupInfo = getChoiceGroupForChild(childName);
    const choiceGroupData = choiceGroupInfo ? choiceInfo[choiceGroupInfo.groupIndex] : null;
    if (choiceGroupData) {
      setSelectedChoices((prev) => ({
        ...prev,
        [choiceGroupData.choiceKey]: childName,
      }));
    }

    onUpdateValue(path, (current) => {
      const updated = asMutableElementObject(current);

      // Enforce choice semantics by clearing sibling options when selecting a different branch.
      if (choiceGroupData) {
        for (const option of choiceGroupData.options) {
          if (option.name !== childName) {
            delete updated[option.name];
          }
        }
      }

      const count = getChildOccurrenceCount(updated, childName);
      const maxOccurs = getChildMaxOccurs(childSchema);
      if (count >= maxOccurs) return updated;

      const nextValue = createDefaultChildValue(childSchema);
      if (count === 0) {
        updated[childName] = nextValue;
      } else if (Array.isArray(updated[childName])) {
        updated[childName] = [...updated[childName], nextValue];
      } else {
        updated[childName] = [updated[childName], nextValue];
      }

      return updated;
    });
  };

  const removeChildOccurrence = (childName: string, childSchema: SchemaNode) => {
    onUpdateValue(path, (current) => {
      const updated = { ...(current || {}) };
      const count = getChildOccurrenceCount(updated, childName);
      const minOccurs = getChildMinOccurs(childSchema);

      if (count <= minOccurs) return updated;

      const existing = compiledSchema
        ? compiledSchema.resolveChildData(childName, element?.tagName, updated, path.length === 0)
        : updated?.[childName];

      if (Array.isArray(existing)) {
        const trimmed = existing.slice(0, -1);
        if (trimmed.length === 0) delete updated[childName];
        else if (trimmed.length === 1) updated[childName] = trimmed[0];
        else updated[childName] = trimmed;
      } else {
        delete updated[childName];
      }

      return updated;
    });
  };

  const canRemoveChoiceSelection = (choiceGroupData: {
    selectedOption: string | null;
    options: Array<{ name: string; node: SchemaNode }>;
    isRequired: boolean;
  } | null): boolean => {
    if (!choiceGroupData) return false;
    if (choiceGroupData.isRequired) return false;
    const selected = choiceGroupData.selectedOption;
    if (!selected) return false;
    return getChildOccurrenceCount(value, selected) > 0;
  };

  const removeChoiceSelection = (choiceGroupData: {
    selectedOption: string | null;
    options: Array<{ name: string; node: SchemaNode }>;
    choiceKey: string;
  }) => {
    const selected = choiceGroupData.selectedOption;
    if (!selected) return;

    onUpdateValue(path, (current) => {
      const updated = { ...(current || {}) };
      delete updated[selected];

      if (Array.isArray(updated['__childrenInOrder'])) {
        updated['__childrenInOrder'] = (updated['__childrenInOrder'] as any[]).filter(
          (item) => item?.tagName !== selected
        );
      }

      return updated;
    });

    setSelectedChoices((prev) => {
      const next = { ...prev };
      delete next[choiceGroupData.choiceKey];
      return next;
    });
  };

  const canRemoveChildOccurrence = (childName: string, childSchema: SchemaNode): boolean => {
    const count = getChildOccurrenceCount(value, childName);
    return count > getChildMinOccurs(childSchema);
  };

  // Helper to sanitize test ids
  const sanitize = (s: string) => String(s || '').replace(/[^a-zA-Z0-9-_]/g, '_');
  const suggestedAttrNames = getSuggestedAttributeNamesForTag(elementTagName);
  const canAddCustomAttribute = canAddCustomAttributeForElement({ ...element, tagName: elementTagName }, rootSchema);

  const applyInferredEditorPatch = (patch: Record<string, any>) => {
    const tagPrefix = element.tagName.includes(':') ? `${element.tagName.split(':')[0]}:` : '';
    const importKey = `${tagPrefix}import`;
    const annotationKey = `${tagPrefix}annotation`;
    const documentationKey = `${tagPrefix}documentation`;
    const attributeDeclKey = `${tagPrefix}attribute`;
    const anyAttributeKey = `${tagPrefix}anyAttribute`;
    const complexTypeKey = `${tagPrefix}complexType`;
    const simpleContentKey = `${tagPrefix}simpleContent`;
    const complexContentKey = `${tagPrefix}complexContent`;
    const extensionKey = `${tagPrefix}extension`;
    const restrictionKey = `${tagPrefix}restriction`;

    const setAttr = (obj: any, attrName: string, attrValue: any) => {
      if (attrValue === undefined || attrValue === null || attrValue === '') {
        delete obj[`@${attrName}`];
      } else {
        obj[`@${attrName}`] = attrValue;
      }
    };

    const firstObjectNode = (value: any): Record<string, any> | null => {
      if (Array.isArray(value)) {
        const first = value.find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
        return first && typeof first === 'object' && !Array.isArray(first) ? first : null;
      }
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    };

    const resolveAttributeAuthoringTarget = (entry: Record<string, any>): Record<string, any> => {
      const localTag = String(element.tagName || '').replace(/^.*:/, '');
      let target: Record<string, any> = entry;

      if (localTag === 'element') {
        const inlineComplexType = firstObjectNode(entry[complexTypeKey]);
        if (!inlineComplexType) return entry;
        target = inlineComplexType;
      }

      if (localTag === 'element' || localTag === 'complexType') {
        const simpleContent = firstObjectNode(target[simpleContentKey]);
        if (simpleContent) {
          const derivation = firstObjectNode(simpleContent[extensionKey]) || firstObjectNode(simpleContent[restrictionKey]);
          if (derivation) return derivation;
          return target;
        }

        const complexContent = firstObjectNode(target[complexContentKey]);
        if (complexContent) {
          const derivation = firstObjectNode(complexContent[extensionKey]) || firstObjectNode(complexContent[restrictionKey]);
          if (derivation) return derivation;
        }
      }

      return target;
    };

    onUpdateValue(path, (current) => {
      const updated = { ...(current || {}) };

      if ('xmlName' in patch) setAttr(updated, 'name', patch.xmlName);
      if ('xmlElementType' in patch) setAttr(updated, 'type', patch.xmlElementType);
      if ('xmlAttributeType' in patch) setAttr(updated, 'type', patch.xmlAttributeType);
      if ('xmlWidget' in patch) setAttr(updated, 'ui:widget', patch.xmlWidget);
      if ('xmlAttributeUse' in patch) setAttr(updated, 'use', patch.xmlAttributeUse);
      if ('xmlMinOccurs' in patch) setAttr(updated, 'minOccurs', patch.xmlMinOccurs);
      if ('xmlMaxOccurs' in patch) setAttr(updated, 'maxOccurs', patch.xmlMaxOccurs);
      if ('xmlDefault' in patch) setAttr(updated, 'default', patch.xmlDefault);
      if ('xmlFixed' in patch) setAttr(updated, 'fixed', patch.xmlFixed);
      if ('xmlAttributeDefault' in patch) setAttr(updated, 'default', patch.xmlAttributeDefault);
      if ('xmlTargetNamespace' in patch) setAttr(updated, 'targetNamespace', patch.xmlTargetNamespace);
      if ('xmlElementFormDefault' in patch) setAttr(updated, 'elementFormDefault', patch.xmlElementFormDefault);
      if ('xmlAttributeFormDefault' in patch) setAttr(updated, 'attributeFormDefault', patch.xmlAttributeFormDefault);
      if ('xmlSubstitutionGroupParent' in patch) setAttr(updated, 'substitutionGroup', patch.xmlSubstitutionGroupParent);
      const attributeTarget = resolveAttributeAuthoringTarget(updated);

      if ('xmlAnyAttributeNamespace' in patch) {
        const nextNs = patch.xmlAnyAttributeNamespace;
        if (nextNs === undefined || nextNs === null || nextNs === '') {
          if (attributeTarget[anyAttributeKey] && typeof attributeTarget[anyAttributeKey] === 'object') {
            delete attributeTarget[anyAttributeKey]['@namespace'];
            if (Object.keys(attributeTarget[anyAttributeKey]).length === 0) delete attributeTarget[anyAttributeKey];
          }
        } else {
          const anyAttrNode = (attributeTarget[anyAttributeKey] && typeof attributeTarget[anyAttributeKey] === 'object') ? { ...attributeTarget[anyAttributeKey] } : {};
          anyAttrNode['@namespace'] = String(nextNs);
          attributeTarget[anyAttributeKey] = anyAttrNode;
        }
      }
      if ('xmlBlockDefault' in patch) setAttr(updated, 'blockDefault', patch.xmlBlockDefault);
      if ('xmlFinalDefault' in patch) setAttr(updated, 'finalDefault', patch.xmlFinalDefault);
      if ('xmlVersion' in patch) setAttr(updated, 'version', patch.xmlVersion);
      if ('xmlLang' in patch) setAttr(updated, 'xml:lang', patch.xmlLang);
      if ('xmlnsXsi' in patch) setAttr(updated, 'xmlns:xsi', patch.xmlnsXsi);
      if ('xsiSchemaLocation' in patch) setAttr(updated, 'xsi:schemaLocation', patch.xsiSchemaLocation);

      // Attribute manager operations emitted by XmlAttributesManager
      const getAttributeDecls = (): any[] => {
        const raw = attributeTarget[attributeDeclKey];
        if (!raw) return [];
        return Array.isArray(raw) ? [...raw] : [raw];
      };
      const setAttributeDecls = (decls: any[]) => {
        if (!decls || decls.length === 0) {
          delete attributeTarget[attributeDeclKey];
          return;
        }
        attributeTarget[attributeDeclKey] = decls.length === 1 ? decls[0] : decls;
      };

      if ('xmlAddAttribute' in patch && patch.xmlAddAttribute) {
        const add = patch.xmlAddAttribute;
        const decls = getAttributeDecls();
        decls.push({
          '@name': add.name ?? '',
          '@type': add.type ?? 'xs:string',
          '@use': add.use ?? 'optional',
        });
        setAttributeDecls(decls);
      }

      if ('xmlUpdateAttributeIndex' in patch && patch.xmlUpdateAttributeIndex) {
        const upd = patch.xmlUpdateAttributeIndex;
        const idx = Number(upd.index);
        const decls = getAttributeDecls();
        if (!Number.isNaN(idx) && idx >= 0 && idx < decls.length) {
          const currentDecl = typeof decls[idx] === 'object' && decls[idx] ? { ...decls[idx] } : {};
          currentDecl['@name'] = upd.name ?? currentDecl['@name'] ?? '';
          currentDecl['@type'] = upd.type ?? currentDecl['@type'] ?? 'xs:string';
          currentDecl['@use'] = upd.use ?? currentDecl['@use'] ?? 'optional';
          decls[idx] = currentDecl;
          setAttributeDecls(decls);
        }
      }

      if ('xmlRemoveAttributeIndex' in patch) {
        const idx = Number(patch.xmlRemoveAttributeIndex);
        const decls = getAttributeDecls();
        if (!Number.isNaN(idx) && idx >= 0 && idx < decls.length) {
          decls.splice(idx, 1);
          setAttributeDecls(decls);
        }
      }

      if ('xmlnsNamespaces' in patch && Array.isArray(patch.xmlnsNamespaces)) {
        // Replace custom xmlns:* bindings from editor state (excluding xmlns:xsi)
        Object.keys(updated).forEach((k) => {
          if (k.startsWith('@xmlns:') && k !== '@xmlns:xsi') delete updated[k];
        });
        patch.xmlnsNamespaces.forEach((ns: any) => {
          if (!ns || !ns.prefix) return;
          if (ns.prefix === 'xsi') return;
          updated[`@xmlns:${ns.prefix}`] = ns.uri ?? '';
        });
      }

      if ('xmlImports' in patch) {
        if (Array.isArray(patch.xmlImports) && patch.xmlImports.length > 0) {
          updated[importKey] = patch.xmlImports.map((imp: any) => ({
            '@namespace': imp?.namespace ?? '',
            '@schemaLocation': imp?.schemaLocation ?? '',
          }));
        } else {
          delete updated[importKey];
        }
      }

      if ('xmlAnnotation' in patch || 'xmlAnnotations' in patch) {
        const docs = Array.isArray(patch.xmlAnnotations)
          ? patch.xmlAnnotations
          : (typeof patch.xmlAnnotation === 'string' && patch.xmlAnnotation ? [patch.xmlAnnotation] : []);

        if (docs.length > 0) {
          updated[annotationKey] = {
            [documentationKey]: docs.map((d: string) => ({ _text: d })),
          };
        } else {
          delete updated[annotationKey];
        }
      }

      return updated;
    });
  };

  return (
    <div style={{ marginLeft: 0, marginBottom: 12 }}>
      {path.length === 0 && (() => {
        const globalTriggers = getGlobalRootElementTriggers();
        if (globalTriggers.length === 0) return null;

        const selectedRootOption = globalTriggers.find((trigger) => getRootOccurrenceCount(value, trigger.name) > 0)?.name ?? null;

        return (
          <div className={styles.elementTriggerRow} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 12 }}>
            {globalTriggers.map((trigger) => {
              const count = getRootOccurrenceCount(value, trigger.name);
              const isSelected = selectedRootOption === trigger.name;
              const isBelowMinimum = count < trigger.minOccurs;

              const canAdd = !isSelected && (count < trigger.maxOccurs);
              const maxLabel = Number.isFinite(trigger.maxOccurs) ? String(trigger.maxOccurs) : '∞';
              const addTitle = isSelected
                ? `${trigger.name} already selected (${count}/${maxLabel})`
                : (selectedRootOption
                  ? `Switch to ${trigger.name} (${count}/${maxLabel})`
                  : (canAdd ? `Add ${trigger.name} (${count}/${maxLabel})` : `${trigger.name} reached maxOccurs (${maxLabel})`));

              return (
                <button
                  key={`root-trigger-${trigger.name}`}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => {
                    if (isSelected) return;
                    addRootElementOccurrence(trigger.name, trigger.maxOccurs);
                  }}
                  disabled={false}
                  title={addTitle}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 999,
                    border: isSelected ? '1px solid #a78bfa' : (isBelowMinimum ? '1px solid #f59e0b' : '1px solid #d1d5db'),
                    backgroundColor: isSelected ? '#f3e8ff' : (isBelowMinimum ? '#fffbeb' : '#f8fafc'),
                    cursor: isSelected ? 'default' : 'pointer',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.01em',
                    color: isSelected ? '#5b21b6' : (isBelowMinimum ? '#92400e' : '#374151'),
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    whiteSpace: 'nowrap',
                    boxShadow: isSelected ? 'inset 0 0 0 1px rgba(167, 139, 250, 0.25)' : 'none',
                    opacity: 1,
                  }}
                >
                  <span style={{ fontSize: 10, lineHeight: 1 }}>{isSelected ? '●' : '+'}</span>
                  <span>{trigger.name}</span>
                  {isBelowMinimum && !isSelected && <span title="Required until minimum occurrences are met">!</span>}
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* Element header with toggle */}
      <div className={styles.propertyHeader} style={{ marginBottom: hasChildren || hasAttributes ? 8 : 0 }}>
        {hasExpandableContent ? (
          <button
            onClick={() => onToggleExpand(path)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {expanded ? (
              <ChevronDown size={16} />
            ) : (
              <ChevronRight size={16} />
            )}
          </button>
        ) : (
          <div style={{ width: 16 }} />
        )}
        {/* Render as a label (no angle-bracket markup) to match JSON Instance Form style */}
        <div className={styles.propertyName} data-testid={`xml-tag-${sanitize(element.tagName)}`}>
          <span>{element.tagName}</span>
          {collapsedSchemaNodeName && (
            <span
              style={{
                marginLeft: 8,
                color: '#155e75',
                backgroundColor: '#ecfeff',
                border: '1px solid #a5f3fc',
                borderRadius: 999,
                padding: '1px 8px',
                fontSize: 11,
                fontWeight: 600,
                lineHeight: 1.6,
              }}
            >
              {collapsedSchemaNodeName}
            </span>
          )}
          {/* Compositor badge for XSD-specific nodes */}
          {isCompositor && (
            <span className={styles.badge}>Compositor</span>
          )}
        </div>
        {hasText && !expanded && (
          <span style={{ fontSize: 12, color: '#666', fontStyle: 'italic' }}>
            {`"${element.text.substring(0, 50)}${element.text.length > 50 ? '...' : ''}"`}
          </span>
        )}
      </div>

      {/* Expanded content: attributes and children */}
      {expanded && hasExpandableContent && (
        <div className={styles.objectContainer}>
          {/* If this appears to be an XSD/schema node and a rootSchema was provided,
              render the RHS-style editor in read-only mode using an adapter node. */}
          {rootSchema && (() => {
            if (inferredSchemaKind) {
              const localTag = (tag: string) => tag.replace(/^.*:/, '');
              const getNodeAttr = (name: string) => {
                const found = element.attributes.find((a) => a.name === name);
                return found ? String(found.value ?? '') : '';
              };
              const childElements = (node: XmlElement) => node.children.filter((c): c is XmlElement => typeof c !== 'string');
              const firstChildByLocalTag = (node: XmlElement, tagName: string): XmlElement | null => {
                return childElements(node).find((c) => localTag(c.tagName) === tagName) || null;
              };
              const resolveAttributeDeclNode = (): XmlElement => {
                const elementLocalTag = localTag(element.tagName);
                let targetNode: XmlElement = element;

                if (elementLocalTag === 'element') {
                  const inlineComplexType = firstChildByLocalTag(element, 'complexType');
                  if (!inlineComplexType) return element;
                  targetNode = inlineComplexType;
                }

                if (elementLocalTag === 'element' || elementLocalTag === 'complexType') {
                  const simpleContent = firstChildByLocalTag(targetNode, 'simpleContent');
                  if (simpleContent) {
                    return firstChildByLocalTag(simpleContent, 'extension')
                      || firstChildByLocalTag(simpleContent, 'restriction')
                      || targetNode;
                  }

                  const complexContent = firstChildByLocalTag(targetNode, 'complexContent');
                  if (complexContent) {
                    return firstChildByLocalTag(complexContent, 'extension')
                      || firstChildByLocalTag(complexContent, 'restriction')
                      || targetNode;
                  }
                }

                return targetNode;
              };

              const attributeDeclNode = resolveAttributeDeclNode();
              const getDeclaredAttributes = () => {
                // Use actual xs:attribute child declarations from the authoring target node.
                // This keeps attribute row indices aligned with XmlAttributesManager patches.
                const childAttrs = childElements(attributeDeclNode)
                  .filter((c) => localTag(c.tagName) === 'attribute');

                return childAttrs.map((c) => {
                  const find = (n: string) => c.attributes.find((a) => a.name === n)?.value;
                  return {
                    name: String(find('name') ?? find('ref') ?? ''),
                    type: String(find('type') ?? 'xs:string'),
                    use: String(find('use') ?? 'optional'),
                    inherited: false,
                  };
                }).filter((a) => a.name);
              };

              const anyAttributeNode = childElements(attributeDeclNode)
                .find((c) => localTag(c.tagName) === 'anyAttribute');
              const anyAttributeNamespace = anyAttributeNode
                ? String(anyAttributeNode.attributes.find((a) => a.name === 'namespace')?.value ?? '')
                : '';

              // Build a lightweight adapter node that xml-rhs-editors can consume in read-only mode
              const fakeNode = {
                id: pathKey,
                data: {
                  xmlNodeKind: inferredSchemaKind,
                  xmlName: (element.attributes.find(a => a.name === 'name') || {}).value || element.tagName,
                  xmlAttributes: getDeclaredAttributes(),
                  xmlMyTypeNames: compiledSchema ? getAllTypeNames(compiledSchema) : [],
                  xmlAvailableTypes: compiledSchema ? getAllTypeNames(compiledSchema) : [],
                  xmlMyElementNames: [],
                  xmlElementType: inferredSchemaKind === 'element' ? getNodeAttr('type') : undefined,
                  xmlAttributeType: inferredSchemaKind === 'attribute' ? getNodeAttr('type') : undefined,
                  xmlWidget: getNodeAttr('ui:widget') || getNodeAttr('x-ui:widget') || getNodeAttr('widget') || undefined,
                  xmlAttributeUse: inferredSchemaKind === 'attribute' ? (getNodeAttr('use') || 'optional') : undefined,
                  xmlAttributeDefault: inferredSchemaKind === 'attribute' ? getNodeAttr('default') : undefined,
                  xmlDefault: inferredSchemaKind === 'element' ? getNodeAttr('default') : undefined,
                  xmlFixed: inferredSchemaKind === 'element' ? getNodeAttr('fixed') : undefined,
                  xmlSubstitutionGroupParent: inferredSchemaKind === 'element' ? getNodeAttr('substitutionGroup') : undefined,
                  xmlMinOccurs: getNodeAttr('minOccurs') || '1',
                  xmlMaxOccurs: getNodeAttr('maxOccurs') || '1',
                  xmlMixed: getNodeAttr('mixed') === 'true',
                  xmlIsRef: Boolean(getNodeAttr('ref')),
                  xmlAnyAttribute: anyAttributeNamespace ? { namespace: anyAttributeNamespace } : undefined,
                  xmlImports: inferredSchemaKind === 'schema' ? getSchemaImports(rootSchema) : undefined,
                  xmlAnnotations: inferredSchemaKind === 'schema' ? getSchemaAnnotations(rootSchema) : undefined,
                  xmlnsNamespaces: inferredSchemaKind === 'schema' ? getSchemaCustomNamespaces(rootSchema) : undefined,
                  xmlTargetNamespace: inferredSchemaKind === 'schema' ? getSchemaAttributeValue(rootSchema, 'targetNamespace') : undefined,
                  xmlElementFormDefault: inferredSchemaKind === 'schema' ? getSchemaAttributeValue(rootSchema, 'elementFormDefault') : undefined,
                  xmlAttributeFormDefault: inferredSchemaKind === 'schema' ? getSchemaAttributeValue(rootSchema, 'attributeFormDefault') : undefined,
                  xmlnsXsi: inferredSchemaKind === 'schema' ? getSchemaAttributeValue(rootSchema, 'xmlns:xsi') : undefined,
                  xsiSchemaLocation: inferredSchemaKind === 'schema' ? getSchemaAttributeValue(rootSchema, 'xsi:schemaLocation') : undefined,
                  // expose raw element text as annotation for quick visibility
                  xmlAnnotation: element.text || '',
                },
              } as any;

              return (
                <div style={{ marginBottom: 12 }}>
                  <XmlInstanceNodeRhsEditor node={fakeNode} onChange={applyInferredEditorPatch} />
                </div>
              );
            }
            return null;
          })()}
          {/* Attributes section */}
          {hasAttributes && !hasInferredEditor && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 6 }}>
                {canAddCustomAttribute ? (
                  <button className={styles.addButton} onClick={handleAddAttribute} title="Add new attribute">
                    <Plus size={12} />
                  </button>
                ) : null}
              </div>
              {(() => {
                const normalized: XmlAttribute[] = [];
                const seen = new Set<string>();
                for (const attr of element.attributes) {
                  if (attr.name === 'attributes' && attr.value && typeof attr.value === 'object' && !Array.isArray(attr.value)) {
                    for (const k of Object.keys(attr.value)) {
                      const v = (attr.value as any)[k];
                      if (v !== null && typeof v !== 'object' && !seen.has(k)) {
                        normalized.push({ name: k, value: v });
                        seen.add(k);
                      } else if (!seen.has(k)) {
                        normalized.push({ name: k, value: v });
                        seen.add(k);
                      }
                    }
                  } else if (!seen.has(attr.name)) {
                    normalized.push(attr);
                    seen.add(attr.name);
                  }
                }

                const presentNames = new Set(normalized.map((a) => a.name));
                let schemaAttrs: any[] = [];
                if (schemaNode?.attributes) {
                  schemaAttrs = schemaNode.attributes;
                } else if (compiledSchema && schemaNode?.elementType) {
                  const typeAttrs = getTypeAttributes(compiledSchema, schemaNode.elementType);
                  schemaAttrs = typeAttrs || [];
                }

                for (const schemaAttr of schemaAttrs) {
                  if (schemaAttr.use === 'required' && !presentNames.has(schemaAttr.name) && schemaAttr.name !== 'xmlns') {
                    normalized.push({ name: schemaAttr.name, value: schemaAttr.default || schemaAttr.fixed || '' });
                    presentNames.add(schemaAttr.name);
                  }
                }

                const editableAttrs = normalized.filter((a) => a.name !== 'xmlns');
                const triggerNames = new Set<string>();
                for (const schemaAttr of schemaAttrs) {
                  const attrName = String(schemaAttr?.name || '').trim();
                  if (!attrName || attrName === 'xmlns' || presentNames.has(attrName)) continue;
                  if (schemaAttr.use === 'prohibited') continue;
                  triggerNames.add(attrName);
                }
                for (const name of suggestedAttrNames) {
                  if (name && name !== 'xmlns' && !presentNames.has(name) && !schemaAttrs.some((schemaAttr) => String(schemaAttr?.name || '') === name && schemaAttr.use === 'prohibited')) {
                    triggerNames.add(name);
                  }
                }
                const availableAttributeTriggers = [...triggerNames].sort();

                return (
                  <>
                    {(() => {
                      const triggerNames = new Set<string>(availableAttributeTriggers);
                      editableAttrs.forEach((attr) => triggerNames.add(attr.name));
                      const sortedTriggerNames = [...triggerNames].sort();
                      const schemaUseByName = new Map<string, 'required' | 'optional' | 'prohibited'>();
                      schemaAttrs.forEach((sa) => {
                        if (sa?.name) schemaUseByName.set(String(sa.name), sa.use || 'optional');
                      });
                      return sortedTriggerNames.length > 0 ? (
                      <div className={styles.attributeTriggerRow} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                        {sortedTriggerNames.map((name) => {
                          const isPresent = editableAttrs.some((a) => a.name === name);
                          const isRequired = schemaUseByName.get(name) === 'required';
                          const canAdd = !isPresent;
                          const canRemove = isPresent && !isRequired;

                          return (
                            <div key={`attr-trigger-${name}`} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                              <button
                                type="button"
                                onClick={() => handleAttributeChange(name, '')}
                                disabled={!canAdd}
                                title={canAdd ? `Add ${name} attribute` : `${name} attribute already present`}
                                style={{
                                  padding: '3px 8px',
                                  borderRadius: 12,
                                  border: '1px solid #ddd',
                                  backgroundColor: canAdd ? '#f9f9f9' : '#f3f4f6',
                                  cursor: canAdd ? 'pointer' : 'not-allowed',
                                  fontSize: 11,
                                  fontWeight: 500,
                                  color: canAdd ? '#666' : '#9ca3af',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  whiteSpace: 'nowrap',
                                  opacity: canAdd ? 1 : 0.7,
                                }}
                              >
                                <span>+</span>
                                <span>{name}</span>
                              </button>
                              {canRemove && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveAttribute(name)}
                                      title={`Remove ${name}`}
                                      style={{
                                        padding: '3px 7px',
                                        borderRadius: 12,
                                        border: '1px solid #fecaca',
                                        backgroundColor: '#fef2f2',
                                        cursor: 'pointer',
                                        color: '#b91c1c',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                      }}
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>{`Remove ${name}`}</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      ) : null;
                    })()}

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'flex-start' }}>
                      {editableAttrs.map((attr) => {
                        let isRequired = false;
                        if (schemaNode?.attributes) {
                          const attrDef = schemaNode.attributes.find((a) => a.name === attr.name);
                          isRequired = attrDef?.use === 'required';
                        }
                        if (!isRequired && compiledSchema && schemaNode?.elementType) {
                          const elementTypeAttrs = getTypeAttributes(compiledSchema, schemaNode.elementType);
                          if (elementTypeAttrs) {
                            const attrDef = elementTypeAttrs.find((a: any) => a.name === attr.name);
                            isRequired = attrDef?.use === 'required';
                          }
                        }

                        return (
                          <div key={attr.name} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 'fit-content', flexShrink: 0 }}>
                            {(() => {
                              const inputId = `xml-attr-input-${sanitize(element.tagName)}-${sanitize(attr.name)}`;
                              return (
                                <label htmlFor={inputId} className={styles.label} style={{ minWidth: 100, marginBottom: 0, textAlign: 'right', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 500, color: '#94a3b8' }}>{attr.name}:</label>
                              );
                            })()}
                            {typeof attr.value === 'object' ? (
                              <textarea className={styles.input} readOnly value={JSON.stringify(attr.value, null, 2)} style={{ flex: 1, maxWidth: 400, minHeight: 40 }} />
                            ) : (
                              (() => {
                                let enumerations: string[] = [];
                                let facets: ValidationFacets | undefined = undefined;
                                let attrType: string | undefined;
                                if (schemaNode?.attributes) {
                                  const attrDef = schemaNode.attributes.find((a) => a.name === attr.name);
                                  if (attrDef?.type) attrType = attrDef.type;
                                }
                                if (!attrType && compiledSchema && schemaNode?.elementType) {
                                  const elementTypeAttrs = getTypeAttributes(compiledSchema, schemaNode.elementType);
                                  if (elementTypeAttrs) {
                                    const attrDef = elementTypeAttrs.find((a: any) => a.name === attr.name);
                                    if (attrDef?.type) attrType = attrDef.type;
                                  }
                                }
                                if (attrType && compiledSchema) {
                                  enumerations = getAttributeEnumerations(compiledSchema, attrType);
                                  facets = getAttributeFacets(compiledSchema, attrType);
                                }

                                const mapAttrType = (typeName: string | null) => {
                                  if (!typeName) return null;
                                  const t = String(typeName).toLowerCase();
                                  if (t.includes('boolean')) return 'checkbox';
                                  if (t.includes('int') || t.includes('decimal') || t.includes('double') || t.includes('float') || t.includes('integer') || t.includes('number')) return 'number';
                                  if (t.includes('date') || t.includes('time')) return 'date';
                                  if (t.includes('anyuri') || t.includes('uri') || t.includes('url')) return 'url';
                                  if (t.includes('email')) return 'email';
                                  return 'text';
                                };

                                const xsdMapped = mapAttrType(attrType || null);
                                const widgetHint = rootSchema
                                  ? findAttributeWidgetInRootSchema(rootSchema, elementTagName, attr.name)
                                  : null;
                                const inputType = widgetHint === 'color'
                                  ? 'color'
                                  : widgetHint === 'email'
                                    ? 'email'
                                    : widgetHint === 'lang' || widgetHint === 'country'
                                      ? 'text'
                                      : (xsdMapped || detectAttributeInputType(attr.name, attr.value));
                                const validationAttrs = facetsToInputAttrs(facets);
                                const validationHint = facetsToHint(facets);
                                const subtleControlStyle = {
                                  padding: '4px 6px',
                                  border: '1px solid #d1d5db',
                                  borderRadius: 3,
                                  fontSize: 12,
                                  fontFamily: 'inherit',
                                } as const;

                                if (enumerations.length > 0) {
                                  return (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      <select
                                        id={`xml-attr-input-${sanitize(element.tagName)}-${sanitize(attr.name)}`}
                                        data-testid={`xml-attr-${sanitize(element.tagName)}-${sanitize(attr.name)}`}
                                        className={styles.input}
                                        value={String(attr.value ?? '')}
                                        onChange={(e) => handleAttributeChange(attr.name, e.target.value)}
                                        style={{ width: 180, maxWidth: 180, ...subtleControlStyle }}
                                      >
                                        <option value="">-- Select a value --</option>
                                        {enumerations.map((option) => (
                                          <option key={option} value={option}>{option}</option>
                                        ))}
                                      </select>
                                      {validationHint && (
                                        <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{validationHint}</div>
                                      )}
                                    </div>
                                  );
                                }

                                if (inputType === 'checkbox') {
                                  const checked = String(attr.value).toLowerCase() === 'true' || attr.value === true;
                                  return (
                                    <input
                                      id={`xml-attr-input-${sanitize(element.tagName)}-${sanitize(attr.name)}`}
                                      data-testid={`xml-attr-${sanitize(element.tagName)}-${sanitize(attr.name)}`}
                                      className={styles.input}
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) => handleAttributeChange(attr.name, e.target.checked ? 'true' : 'false')}
                                    />
                                  );
                                }

                                if (inputType === 'color') {
                                  return (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 180, maxWidth: 180 }}>
                                        <input
                                          id={`xml-attr-input-${sanitize(element.tagName)}-${sanitize(attr.name)}`}
                                          data-testid={`xml-attr-${sanitize(element.tagName)}-${sanitize(attr.name)}`}
                                          className={styles.input}
                                          type="color"
                                          value={normalizeColorInputValue(String(attr.value ?? ''))}
                                          onChange={(e) => handleAttributeChange(attr.name, e.target.value)}
                                          style={{ width: 40, height: 30, padding: 0, border: '1px solid #d1d5db', borderRadius: 3, cursor: 'pointer' }}
                                        />
                                        <input
                                          className={styles.input}
                                          type="text"
                                          value={String(attr.value ?? '')}
                                          onChange={(e) => handleAttributeChange(attr.name, e.target.value)}
                                          placeholder="#rrggbb"
                                          style={{ flex: 1, minWidth: 90, ...subtleControlStyle }}
                                        />
                                      </div>
                                      {validationHint && (
                                        <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{validationHint}</div>
                                      )}
                                    </div>
                                  );
                                }

                                if (widgetHint === 'country') {
                                  return (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      {renderCountryInput(
                                        String(attr.value ?? ''),
                                        (nextValue) => handleAttributeChange(attr.name, nextValue),
                                        `xml-attr-${sanitize(element.tagName)}-${sanitize(attr.name)}`
                                      )}
                                    </div>
                                  );
                                }

                                if (widgetHint === 'lang') {
                                  return (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      {renderLanguageInput(
                                        String(attr.value ?? ''),
                                        (nextValue) => handleAttributeChange(attr.name, nextValue),
                                        `xml-attr-${sanitize(element.tagName)}-${sanitize(attr.name)}`
                                      )}
                                    </div>
                                  );
                                }

                                const compactWidth = inputType === 'number' ? 96 : 180;

                                return (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <input
                                      id={`xml-attr-input-${sanitize(element.tagName)}-${sanitize(attr.name)}`}
                                      data-testid={`xml-attr-${sanitize(element.tagName)}-${sanitize(attr.name)}`}
                                      className={styles.input}
                                      type={inputType}
                                      value={String(attr.value ?? '')}
                                      onChange={(e) => {
                                        const v = inputType === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value;
                                        handleAttributeChange(attr.name, v as any);
                                      }}
                                      style={{ width: compactWidth, maxWidth: compactWidth, ...subtleControlStyle }}
                                      {...validationAttrs}
                                    />
                                    {validationHint && (
                                      <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{validationHint}</div>
                                    )}
                                  </div>
                                );
                              })()
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </div>
          )}


          {/* Add Attribute button (when no attributes yet) */}
          {!hasAttributes && !hasInferredEditor && (
            <div style={{ marginBottom: 12 }}>
              {(() => {
                const names = new Set<string>();
                for (const schemaAttr of schemaNode?.attributes || []) {
                  const attrName = String(schemaAttr?.name || '').trim();
                  if (!attrName || attrName === 'xmlns' || schemaAttr.use === 'prohibited') continue;
                  names.add(attrName);
                }
                for (const name of suggestedAttrNames) {
                  if (name && name !== 'xmlns' && !(schemaNode?.attributes || []).some((schemaAttr) => String(schemaAttr?.name || '') === name && schemaAttr.use === 'prohibited')) {
                    names.add(name);
                  }
                }
                const availableTriggers = [...names].sort();

                return (
                  <>
                    {availableTriggers.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                        {availableTriggers.map((name) => (
                          <button
                            key={name}
                            type="button"
                            onClick={() => handleAttributeChange(name, '')}
                            title={`Add ${name} attribute`}
                            style={{
                              padding: '3px 8px',
                              borderRadius: 12,
                              border: '1px solid #ddd',
                              backgroundColor: '#f9f9f9',
                              cursor: 'pointer',
                              fontSize: 11,
                              fontWeight: 500,
                              color: '#666',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <span>+</span>
                            <span>{name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {canAddCustomAttribute ? (
                      <button className={styles.addButton} onClick={handleAddAttribute}>
                        <Plus size={14} />
                        <span style={{ marginLeft: 6 }}>Add Attribute</span>
                      </button>
                    ) : null}
                  </>
                );
              })()}
            </div>
          )}

          {/* Children section */}
          {(hasChildren || hasSchemaChildren) && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                {!hasInferredEditor && schemaNode?.children && schemaNode.children.length > 0 ? (
                  <div className={styles.elementTriggerRow} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    {schemaNode.children.map((childSchemaNode, triggerIndex) => {
                      const childElementName = childSchemaNode.label || childSchemaNode.tagName || `child-${triggerIndex}`;
                      const count = getChildOccurrenceCount(value, childElementName);
                      const maxOccurs = getChildMaxOccurs(childSchemaNode);
                      const minOccurs = getChildMinOccurs(childSchemaNode);
                      const choiceGroupInfo = getChoiceGroupForChild(childElementName);
                      const choiceGroupData = choiceGroupInfo ? choiceInfo[choiceGroupInfo.groupIndex] : null;
                      const selectedChoiceName = choiceGroupData?.selectedOption || null;
                      const isBlockedByChoice = Boolean(selectedChoiceName && selectedChoiceName !== childElementName);
                      const isBelowMinimum = (count < minOccurs) && !isBlockedByChoice;
                      const isRequiredSingleton = minOccurs > 0 && maxOccurs === 1;
                      if (isRequiredSingleton && !isBelowMinimum) return null;
                      const canAdd = !isBlockedByChoice && (count < maxOccurs);
                      const maxLabel = Number.isFinite(maxOccurs) ? String(maxOccurs) : '∞';
                      const addTitle = isBlockedByChoice
                        ? `Choice already satisfied by ${selectedChoiceName}`
                        : (canAdd ? `Add ${childElementName} (${count}/${maxLabel})` : `${childElementName} reached maxOccurs (${maxLabel})`);

                      return (
                        <div key={`trigger-${childElementName}-${triggerIndex}`} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          <button
                            type="button"
                            onClick={() => addChildOccurrence(childElementName, childSchemaNode)}
                            disabled={!canAdd}
                            title={addTitle}
                            style={{
                              padding: '3px 8px',
                              borderRadius: 12,
                              border: isBelowMinimum ? '1px solid #f59e0b' : '1px solid #ddd',
                              backgroundColor: isBelowMinimum ? '#fffbeb' : (canAdd ? '#f9f9f9' : '#f3f4f6'),
                              cursor: canAdd ? 'pointer' : 'not-allowed',
                              fontSize: 11,
                              fontWeight: 500,
                              color: isBelowMinimum ? '#92400e' : (canAdd ? '#666' : '#9ca3af'),
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              whiteSpace: 'nowrap',
                              opacity: canAdd ? 1 : 0.7,
                            }}
                          >
                            <span>+</span>
                            <span>{childElementName}</span>
                            {isBelowMinimum && <span title="Required until minimum occurrences are met">!</span>}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              {/* Walk the compiled schema structure, use instance data for values */}
              {(() => {
                const keys = value ? Object.keys(value).filter(k => !k.startsWith('@')) : [];
                const actualValue = value ? JSON.stringify(value).substring(0, 100) : 'null';
                const firstKey = keys.length > 0 ? keys[0] : 'none';
                const elementChildrenCount = element?.children?.length || 0;
                console.log(`[XmlElementNode] schemaNode for ${element?.tagName}: firstKey=${firstKey}, elementChildren=${elementChildrenCount}, allKeys=[${keys.join(', ')}], valuePreview=${actualValue}`);
                return null;
              })()}
              

              
              {schemaNode?.children && schemaNode.children.length > 0 ? (
                schemaNode.children
                  .map((childSchemaNode, index) => ({ childSchemaNode, index }))
                  // Filter based on choice selections
                  .filter(({ childSchemaNode }) => {
                    // If this is a choice element, only show if it's the selected option in its group
                    if (childSchemaNode.compositorType === 'choice') {
                      // Find which choice group this element belongs to
                      for (const choice of choiceInfo) {
                        const matchingOption = choice.options.find(opt => opt.name === (childSchemaNode.label || childSchemaNode.tagName));
                        if (matchingOption) {
                          // This element is in this choice group, only show if selected
                          return choice.selectedOption === (childSchemaNode.label || childSchemaNode.tagName);
                        }
                      }
                    }
                    // Not a choice element or not in any choice group, show it
                    return true;
                  })
                  .map(({ childSchemaNode, index }) => {
                  // Get the element name from schema
                  const childElementName = childSchemaNode.label || childSchemaNode.tagName || '';
                  
                  // Check if this child is the first in a choice group
                  const choiceGroupInfo = getChoiceGroupForChild(childElementName);
                  const choiceGroupIndex = choiceGroupInfo?.groupIndex ?? -1;
                  
                  // Find the choice group data for rendering the dropdown
                  // Get choiceGroupData for ANY child in a choice group, not just the first one
                  // This allows us to show the dropdown for whichever element is currently selected
                  let choiceGroupData = null;
                  if (choiceGroupIndex >= 0) {
                    choiceGroupData = choiceInfo[choiceGroupIndex];
                  }
                  
                  // Find the element structure from the DOM tree
                  // The element structure is consistent regardless of value wrapping
                  // Find the child element in the DOM tree
                  const childElement: any = element?.children?.find(child => 
                    typeof child !== 'string' && 
                    (child.tagName === childElementName || 
                     child.tagName?.replace(/^.*:/, '') === childElementName)
                  );
                  
                  // Use compiled schema helper to resolve the data value, handling wrapped values at root level
                  let childInstanceData: any;
                  if (compiledSchema) {
                    childInstanceData = compiledSchema.resolveChildData(
                      childElementName,
                      element?.tagName,
                      value,
                      path.length === 0
                    );
                  } else {
                    // Fallback if no compiled schema available
                    childInstanceData = value?.[childElementName];
                  }
                  
                  const isSelectedChoiceOption = Boolean(
                    choiceGroupData && choiceGroupData.selectedOption === childElementName
                  );
                  const selectedChoiceIsRequired = Boolean(
                    choiceGroupData && choiceGroupData.isRequired
                  );
                  const effectiveChildInstanceData =
                    childInstanceData !== undefined && childInstanceData !== null
                      ? childInstanceData
                      : (isSelectedChoiceOption && selectedChoiceIsRequired ? { _text: '' } : childInstanceData);

                  // Use element structure if available; use data as fallback
                  const elementToRender = childElement || effectiveChildInstanceData;
                  
                  console.log(`[XmlElementNode] Child schema element ${index}: name="${childElementName}", element=${!!childElement}, data type=${typeof effectiveChildInstanceData}, found=${!!elementToRender}`);
                  
                  // Treat schema-leaf elements as simple when either parsed element shape is simple
                  // or the instance value is scalar/text-only data.
                  const schemaSaysSimple = (childSchemaNode.children?.length || 0) === 0;
                  const schemaHasNoAttrs = (childSchemaNode.attributes?.length || 0) === 0;
                  const parsedElementIsSimple = Boolean(
                    childElement &&
                    childElement.children?.length === 0 &&
                    childElement.attributes?.length === 0
                  );
                  const instanceValueIsTextOnly = Boolean(
                    effectiveChildInstanceData !== undefined &&
                    effectiveChildInstanceData !== null &&
                    (
                      typeof effectiveChildInstanceData === 'string' ||
                      typeof effectiveChildInstanceData === 'number' ||
                      typeof effectiveChildInstanceData === 'boolean' ||
                      (
                        typeof effectiveChildInstanceData === 'object' &&
                        !Array.isArray(effectiveChildInstanceData) &&
                        Object.keys(effectiveChildInstanceData).every((k) => k === '_text' || k === '#text')
                      )
                    )
                  );
                  const isSimpleChild = schemaSaysSimple && schemaHasNoAttrs && (parsedElementIsSimple || instanceValueIsTextOnly);
                  
                  // Handle both single and multiple occurrences
                  if (Array.isArray(effectiveChildInstanceData)) {
                    const childMinOccurs = getChildMinOccurs(childSchemaNode);
                    // Render each array element
                    // For choice groups, show the dropdown before the first element
                    const arrayItems = effectiveChildInstanceData.map((child, arrayIndex) => (
                      <div key={`${index}-${arrayIndex}`} style={{ position: 'relative' }}>
                        <XmlElementNode
                          element={child}
                          path={[...path, childElementName, String(arrayIndex)]}
                          expandedPaths={expandedPaths}
                          onToggleExpand={onToggleExpand}
                          value={child}
                          onChange={onChange}
                          onUpdateValue={onUpdateValue}
                          rootSchema={rootSchema}
                          autoExpandAll={autoExpandAll}
                          schemaNode={childSchemaNode}
                          compiledSchema={compiledSchema}
                          isSchemaForm={isSchemaForm}
                        />
                        {effectiveChildInstanceData.length > childMinOccurs && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => {
                                  onUpdateValue(path, (current) => {
                                    const updated = { ...current };
                                    if (Array.isArray(updated[childElementName])) {
                                      updated[childElementName].splice(arrayIndex, 1);
                                      if (updated[childElementName].length === 0) {
                                        delete updated[childElementName];
                                      } else if (updated[childElementName].length === 1) {
                                        updated[childElementName] = updated[childElementName][0];
                                      }
                                    }
                                    return updated;
                                  });
                                }}
                                className={styles.removeButton}
                                style={{ position: 'absolute', right: 0, top: 8 }}
                              >
                                <Trash2 size={14} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Remove element</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    ));
                    
                    // If this element is the currently selected option in a choice group, wrap array items with choice dropdown
                    if (choiceGroupData && choiceGroupData.selectedOption === childElementName) {
                      const showChoiceRemove = canRemoveChoiceSelection(choiceGroupData);
                      return (
                        <div key={`choice-${index}`}>
                          {/* Choice Selector Dropdown */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <select
                              value={choiceGroupData.selectedOption || ''}
                              onChange={(e) => {
                                const newSelectedOption = e.target.value;
                                setSelectedChoices(prev => ({
                                  ...prev,
                                  [choiceGroupData.choiceKey]: newSelectedOption,
                                }));
                                
                                // Save old choice option data and restore/initialize new one
                                onUpdateValue(path, (current) => {
                                  const updated = { ...current };
                                  
                                  // Save all other choice options to localStorage before removing them
                                  for (const opt of choiceGroupData.options) {
                                    if (opt.name !== newSelectedOption) {
                                      if (updated[opt.name] !== undefined) {
                                        saveChoiceDataToStorage(value, path, opt.name, updated[opt.name]);
                                      }
                                      delete updated[opt.name];
                                    }
                                  }
                                  
                                  // For the selected option, try to restore from localStorage first
                                  if (!updated[newSelectedOption]) {
                                    const restored = restoreChoiceDataFromStorage(value, path, newSelectedOption);
                                    updated[newSelectedOption] = restored || { _text: '' };
                                  }
                                  
                                  return updated;
                                });
                              }}
                              style={{
                                padding: '6px 8px',
                                border: '1px solid #ddd',
                                borderRadius: 3,
                                fontSize: 12,
                                cursor: 'pointer',
                                fontWeight: 500,
                                minWidth: 100,
                                color: '#a78bfa',
                              }}
                            >
                              {choiceGroupData.options.map(opt => (
                                <option key={opt.name} value={opt.name}>
                                  {opt.name}:
                                </option>
                              ))}
                            </select>
                            {showChoiceRemove && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() => removeChoiceSelection(choiceGroupData)}
                                    className={styles.removeButton}
                                    title="Remove selected choice element"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>Remove selected choice element</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                          
                          {/* Array items */}
                          {arrayItems}
                        </div>
                      );
                    }
                    
                    return arrayItems;
                  } else if (isSimpleChild && effectiveChildInstanceData !== undefined && effectiveChildInstanceData !== null) {
                    // Render simple text elements as inline inputs
                    // Use the data value, not the parsed element
                    const elementType = rootSchema ? findElementTypeInRootSchema(rootSchema, childElementName) : null;
                    const widgetHint = rootSchema ? findElementWidgetInRootSchema(rootSchema, childElementName) : null;
                    const htmlInputType = widgetHint === 'color'
                      ? 'color'
                      : widgetHint === 'email'
                        ? 'email'
                        : widgetHint === 'lang' || widgetHint === 'country'
                          ? 'text'
                          : ((elementType ? mapXsdTypeToHtmlInput(elementType) : null) || 'text');
                    
                    // Get the text value from data (which is what gets updated)
                    // Support both _text (internal format) and #text (from parseMarkup)
                    const dataElement = effectiveChildInstanceData && typeof effectiveChildInstanceData === 'object' ? effectiveChildInstanceData : {};
                    const textValue =
                      effectiveChildInstanceData !== undefined && effectiveChildInstanceData !== null && typeof effectiveChildInstanceData !== 'object'
                        ? String(effectiveChildInstanceData)
                        : (dataElement._text !== undefined ? dataElement._text : (dataElement['#text'] || ''));
                    
                    // Render choice dropdown if this element is the currently selected option in a choice group
                    // Show dropdown for whichever element is selected, not just the first in schema order
                    if (choiceGroupData && choiceGroupData.selectedOption === childElementName) {
                      const showChoiceRemove = canRemoveChoiceSelection(choiceGroupData);
                      return (
                        <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {/* Choice Selector Dropdown as Label */}
                          <select
                            value={choiceGroupData.selectedOption || ''}
                            onChange={(e) => {
                              const newSelectedOption = e.target.value;
                              setSelectedChoices(prev => ({
                                ...prev,
                                [choiceGroupData.choiceKey]: newSelectedOption,
                              }));
                              
                              // Save old choice option data and restore/initialize new one
                              onUpdateValue(path, (current) => {
                                const updated = { ...current };
                                
                                // Find which option is currently selected to know what to replace
                                let currentlySelectedOption: string | null = null;
                                for (const opt of choiceGroupData.options) {
                                  if (updated[opt.name] !== undefined) {
                                    currentlySelectedOption = opt.name;
                                    break;
                                  }
                                }
                                
                                // Save all other choice options to localStorage before removing them
                                for (const opt of choiceGroupData.options) {
                                  if (opt.name !== newSelectedOption) {
                                    if (updated[opt.name] !== undefined) {
                                      saveChoiceDataToStorage(value, path, opt.name, updated[opt.name]);
                                    }
                                    delete updated[opt.name];
                                  }
                                }
                                
                                // For the selected option, try to restore from localStorage first
                                if (!updated[newSelectedOption]) {
                                  const restored = restoreChoiceDataFromStorage(value, path, newSelectedOption);
                                  updated[newSelectedOption] = restored || { _text: '' };
                                }
                                
                                // Update __childrenInOrder to reflect the choice change
                                // This ensures XML serialization uses the correct element order
                                if (Array.isArray(updated['__childrenInOrder'])) {
                                  const childrenOrder = updated['__childrenInOrder'] as any[];
                                  const updatedOrder = childrenOrder.map((item: any) => {
                                    // If this order entry is for the old selected option, replace it with the new one
                                    if (item.tagName === currentlySelectedOption) {
                                      return {
                                        ...item,
                                        tagName: newSelectedOption,
                                      };
                                    }
                                    return item;
                                  });
                                  updated['__childrenInOrder'] = updatedOrder;
                                }
                                
                                return updated;
                              });
                            }}
                            style={{
                              padding: '6px 8px',
                              border: '1px solid #ddd',
                              borderRadius: 3,
                              fontSize: 12,
                              cursor: 'pointer',
                              fontWeight: 500,
                              minWidth: 100,
                              color: '#a78bfa',
                            }}
                          >
                            {choiceGroupData.options.map(opt => (
                              <option key={opt.name} value={opt.name}>
                                {opt.name}:
                              </option>
                            ))}
                          </select>
                          
                          {/* Input Field */}
                          {renderSimpleValueInput(
                            null,
                            htmlInputType,
                            textValue,
                            (nextValue) => {
                              onUpdateValue([...path, childElementName], (current) => {
                                if (current && typeof current === 'object' && !Array.isArray(current)) {
                                  const next = { ...current, _text: nextValue };
                                  if ('#text' in next) delete next['#text'];
                                  return next;
                                }
                                return { _text: nextValue };
                              });
                            }
                          )}
                          {showChoiceRemove && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => removeChoiceSelection(choiceGroupData)}
                                  className={styles.removeButton}
                                  title="Remove selected choice element"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>Remove selected choice element</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      );
                    }
                    
                    return (
                      <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <label style={{ minWidth: 100, fontSize: 14, fontWeight: 500, color: '#a78bfa' }}>
                          {childElementName}:
                        </label>
                        {renderSimpleValueInput(
                          null,
                          htmlInputType,
                          textValue,
                          (nextValue) => {
                            onUpdateValue([...path, childElementName], (current) => {
                              if (current && typeof current === 'object' && !Array.isArray(current)) {
                                const next = { ...current, _text: nextValue };
                                if ('#text' in next) delete next['#text'];
                                return next;
                              }
                              return { _text: nextValue };
                            });
                          },
                          `xml-element-${sanitize(childElementName)}-input`
                        )}
                        {canRemoveChildOccurrence(childElementName, childSchemaNode) && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => removeChildOccurrence(childElementName, childSchemaNode)}
                                className={styles.removeButton}
                                title="Remove element"
                              >
                                <Trash2 size={14} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Remove element</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    );
                  } else if (elementToRender) {
                    // Render complex child elements as expandable nodes
                    
                    // Render choice dropdown if this element is the currently selected option in a choice group
                    if (choiceGroupData && choiceGroupData.selectedOption === childElementName) {
                      const showChoiceRemove = canRemoveChoiceSelection(choiceGroupData);
                      return (
                        <div key={index}>
                          {/* Choice selector as a dropdown label above the element */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <select
                              value={choiceGroupData.selectedOption || ''}
                              onChange={(e) => {
                                const newSelectedOption = e.target.value;
                                setSelectedChoices(prev => ({
                                  ...prev,
                                  [choiceGroupData.choiceKey]: newSelectedOption,
                                }));
                                
                                // Save old choice option data and restore/initialize new one
                                onUpdateValue(path, (current) => {
                                  const updated = { ...current };
                                  
                                  // Save all other choice options to localStorage before removing them
                                  for (const opt of choiceGroupData.options) {
                                    if (opt.name !== newSelectedOption) {
                                      if (updated[opt.name] !== undefined) {
                                        saveChoiceDataToStorage(value, path, opt.name, updated[opt.name]);
                                      }
                                      delete updated[opt.name];
                                    }
                                  }
                                  
                                  // For the selected option, try to restore from localStorage first
                                  if (!updated[newSelectedOption]) {
                                    const restored = restoreChoiceDataFromStorage(value, path, newSelectedOption);
                                    updated[newSelectedOption] = restored || { _text: '' };
                                  }
                                  
                                  return updated;
                                });
                              }}
                              style={{
                                padding: '6px 8px',
                                border: '1px solid #ddd',
                                borderRadius: 3,
                                fontSize: 12,
                                cursor: 'pointer',
                                fontWeight: 500,
                                minWidth: 100,
                                color: '#a78bfa',
                              }}
                            >
                              {choiceGroupData.options.map(opt => (
                                <option key={opt.name} value={opt.name}>
                                  {opt.name}
                                </option>
                              ))}
                            </select>
                            {showChoiceRemove && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() => removeChoiceSelection(choiceGroupData)}
                                    className={styles.removeButton}
                                    title="Remove selected choice element"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>Remove selected choice element</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                          
                          {/* Element Node */}
                          <div style={{ position: 'relative', marginLeft: 8 }}>
                            <XmlElementNode
                              element={elementToRender}
                              path={[...path, childElementName]}
                              expandedPaths={expandedPaths}
                              onToggleExpand={onToggleExpand}
                              value={effectiveChildInstanceData}
                              onChange={onChange}
                              onUpdateValue={onUpdateValue}
                              rootSchema={rootSchema}
                              autoExpandAll={autoExpandAll}
                              schemaNode={childSchemaNode}
                              compiledSchema={compiledSchema}
                              initialAutoExpandPathsRef={initialAutoExpandPathsRef}
                              autoExpandCaptureActiveRef={autoExpandCaptureActiveRef}
                              isSchemaForm={isSchemaForm}
                            />
                          </div>
                        </div>
                      );
                    }
                    
                    return (
                      <div key={index} style={{ position: 'relative' }}>
                        <XmlElementNode
                          element={elementToRender}
                          path={[...path, childElementName]}
                          expandedPaths={expandedPaths}
                          onToggleExpand={onToggleExpand}
                          value={effectiveChildInstanceData}
                          onChange={onChange}
                          onUpdateValue={onUpdateValue}
                          rootSchema={rootSchema}
                          autoExpandAll={autoExpandAll}
                          schemaNode={childSchemaNode}
                          compiledSchema={compiledSchema}
                          initialAutoExpandPathsRef={initialAutoExpandPathsRef}
                          autoExpandCaptureActiveRef={autoExpandCaptureActiveRef}
                          isSchemaForm={isSchemaForm}
                        />
                        {canRemoveChildOccurrence(childElementName, childSchemaNode) && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => removeChildOccurrence(childElementName, childSchemaNode)}
                                className={styles.removeButton}
                                style={{ position: 'absolute', right: 0, top: 8 }}
                                title="Remove element"
                              >
                                <Trash2 size={14} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Remove element</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    );
                  }
                  
                  return null;
                })
              ) : (
                // Fallback to instance-based rendering if no schema children
                visibleChildren.map(({ child, rawIndex }) => {
                if (typeof child === 'string') {
                  return (
                    <div key={rawIndex} style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 6 }}>
                      (text: "{child.substring(0, 60)}{child.length > 60 ? '...' : ''}")
                    </div>
                  );
                }
                
                // Check if this child element is simple (no nested elements/attributes, only text)
                const isSimpleChild = child.children.length === 0 && child.attributes.length === 0;
                
                if (isSimpleChild) {
                  // Infer the element type from the schema
                  const elementType = rootSchema ? findElementTypeInRootSchema(rootSchema, child.tagName) : null;
                  const widgetHint = rootSchema ? findElementWidgetInRootSchema(rootSchema, child.tagName) : null;
                  const htmlInputType = widgetHint === 'color'
                    ? 'color'
                    : widgetHint === 'email'
                      ? 'email'
                      : ((elementType ? mapXsdTypeToHtmlInput(elementType) : null) || 'text');
                  
                  // Render simple text elements as inline inputs, like attributes
                  return (
                    <div key={rawIndex} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={{ minWidth: 100, fontSize: 14, fontWeight: 500, color: '#a78bfa' }}>
                        {child.tagName}:
                      </label>
                      {renderSimpleValueInput(
                        widgetHint,
                        htmlInputType,
                        child.text || '',
                        (nextValue) => {
                          onUpdateValue([...path, String(rawIndex)], (current) => {
                            if (current && typeof current === 'object' && !Array.isArray(current)) {
                              const next = { ...current, _text: nextValue };
                              if ('#text' in next) delete next['#text'];
                              return next;
                            }
                            return { _text: nextValue };
                          });
                        }
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => {
                              onUpdateValue(path, (current) => {
                                const updated = { ...current };
                                // Find and remove the child element
                                let childCount = 0;
                                for (const key in updated) {
                                  if (!key.startsWith('@') && !key.startsWith('_')) {
                                    if (childCount === rawIndex) {
                                      delete updated[key];
                                      return updated;
                                    }
                                    if (Array.isArray(updated[key])) {
                                      childCount += updated[key].length;
                                    } else {
                                      childCount++;
                                    }
                                  }
                                }
                                return updated;
                              });
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: 0,
                              color: '#999',
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Remove element</TooltipContent>
                      </Tooltip>
                    </div>
                  );
                }
                
                // Render complex child elements as expandable nodes
                return (
                  <div key={rawIndex} style={{ position: 'relative' }}>
                    <XmlElementNode
                      element={child}
                      path={[...path, String(rawIndex)]}
                      expandedPaths={expandedPaths}
                      onToggleExpand={onToggleExpand}
                      value={child}
                      onChange={onChange}
                      onUpdateValue={onUpdateValue}
                      rootSchema={rootSchema}
                      autoExpandAll={autoExpandAll}
                      compiledSchema={compiledSchema}
                      initialAutoExpandPathsRef={initialAutoExpandPathsRef}
                      autoExpandCaptureActiveRef={autoExpandCaptureActiveRef}
                      isSchemaForm={isSchemaForm}
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => {
                            onUpdateValue(path, (current) => {
                              const updated = { ...current };
                              // Find and remove the child element
                              let childCount = 0;
                              for (const key in updated) {
                                if (!key.startsWith('@') && !key.startsWith('_')) {
                                  if (childCount === rawIndex) {
                                    delete updated[key];
                                    return updated;
                                  }
                                  if (Array.isArray(updated[key])) {
                                    childCount += updated[key].length;
                                  } else {
                                    childCount++;
                                  }
                                }
                              }
                              return updated;
                            });
                          }}
                          className={styles.removeButton}
                          style={{ position: 'absolute', right: 0, top: 8 }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Remove element</TooltipContent>
                    </Tooltip>
                  </div>
                );
              }))}
            </div>
          )}

          {/* Text content editor */}
          {hasText && (
            <div style={{ marginTop: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                Text Content
              </label>
              <textarea
                value={element.text}
                onChange={(e) => handleTextContentChange(e.target.value)}
                style={{
                  fontSize: 12,
                  padding: '6px 8px',
                  border: '1px solid #ddd',
                  borderRadius: 3,
                  fontFamily: 'monospace',
                  width: '100%',
                  minHeight: 60,
                  maxWidth: 400,
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function XmlInstanceForm({
  schema,
  value,
  onChange,
  path = [],
  rootSchema,
  autoExpandAll = false,
  showRootElementTriggers = true,
  expansionStateKey = 'xml-instance-form-expanded',
}: XmlInstanceFormProps) {
  // Debug logging
  useEffect(() => {
    if (rootSchema && Object.keys(rootSchema).length > 0) {
      console.log('[XmlInstanceForm] rootSchema loaded, keys:', Object.keys(rootSchema).slice(0, 10));
      // Log schema structure for debugging
      const schemaKeys = Object.keys(rootSchema);
      if (schemaKeys.includes('xs:schema') || schemaKeys.includes('schema')) {
        console.log('[XmlInstanceForm] Found xs:schema or schema key');
        const schemaObj = rootSchema['xs:schema'] || rootSchema['schema'];
        if (schemaObj) {
          console.log('[XmlInstanceForm] Schema object keys:', Object.keys(schemaObj).slice(0, 10));
        }
      }
    }
  }, [rootSchema]);

  const expansionStorageKey = useMemo(
    () => getXmlInstanceExpansionStorageKey(schema, path, expansionStateKey),
    [schema, path, expansionStateKey]
  );

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    const rootPath = path.join('.');
    if (rootPath) {
      initial.add(rootPath);
    }

    if (typeof window === 'undefined') {
      return initial;
    }

    try {
      const stored = window.localStorage.getItem(expansionStorageKey);
      if (!stored) {
        return initial;
      }
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) {
        return initial;
      }
      for (const entry of parsed) {
        if (typeof entry === 'string') {
          initial.add(entry);
        }
      }
      return initial;
    } catch {
      return initial;
    }
  });

  const initialAutoExpandPathsRef = useRef<Set<string>>(new Set());
  const autoExpandCaptureActiveRef = useRef(Boolean(autoExpandAll));
  const isSchemaForm = expansionStateKey === 'xml-schema-form-expanded';

  useEffect(() => {
    if (!autoExpandAll) {
      autoExpandCaptureActiveRef.current = false;
      return;
    }

    initialAutoExpandPathsRef.current = new Set();
    autoExpandCaptureActiveRef.current = true;
    const timeoutId = window.setTimeout(() => {
      autoExpandCaptureActiveRef.current = false;
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      autoExpandCaptureActiveRef.current = false;
    };
  }, [autoExpandAll, expansionStorageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const next = new Set(expandedPaths);
      const rootPath = path.join('.');
      if (rootPath) {
        next.add(rootPath);
      }
      window.localStorage.setItem(expansionStorageKey, JSON.stringify(Array.from(next)));
    } catch {
      // Ignore storage failures.
    }
  }, [expandedPaths, expansionStorageKey, path]);

  // Detect if value is wrapped (e.g., { person: {...} }) and track the wrapper key.
  // Only treat as wrapped when there is exactly one top-level non-metadata key.
  const wrapperKey = useMemo(() => {
    if (!value || typeof value !== 'object') return null;
    const dataKeys = Object.keys(value).filter(
      (k) => !k.startsWith('@') && !k.startsWith('_') && !k.startsWith('__')
    );
    if (dataKeys.length !== 1) return null;

    const candidateKey = dataKeys[0];
    const candidateValue = (value as any)[candidateKey];
    if (!candidateValue || typeof candidateValue !== 'object' || Array.isArray(candidateValue)) return null;

    return candidateKey;
  }, [value]);

  // Try to parse the value as XML - it may be a string or object
  const parseValue = () => {
    let toParse = value || schema;

    // If it's a string, we need to parse it first (XML parsers available in browser)
    if (typeof toParse === 'string') {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(toParse, 'application/xml');
        if ((doc as any).parseError) {
          console.error('[XmlInstanceForm] XML Parse error:', (doc as any).parseError);
          return null;
        }
        // Convert DOM to object
        toParse = xmlDomToObject(doc.documentElement);
      } catch (e) {
        console.error('[XmlInstanceForm] Failed to parse XML:', e);
        return null;
      }
    }
    
    // Normalize text key format: convert #text to _text (from parseMarkup uses #text, internal format uses _text)
    const normalizeData = (obj: any): any => {
      if (!obj || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(normalizeData);
      
      const normalized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        if (key === '#text') {
          normalized['_text'] = value;
        } else if (typeof value === 'object' && value !== null) {
          normalized[key] = normalizeData(value);
        } else {
          normalized[key] = value;
        }
      }
      return normalized;
    };
    
    toParse = normalizeData(toParse);
    
    return parseXmlElement(toParse);
  };

  const rootElement = useMemo(() => {
    const parsed = parseValue();
    console.log('[XmlInstanceForm] rootElement computed:', {
      tagName: parsed?.tagName,
      childrenCount: parsed?.children?.length || 0,
      valueLength: JSON.stringify(value || {}).length,
    });
    return parsed;
  }, [schema, value]);

  // Compile the schema for efficient type lookups (replaces fiddly manual searching)
  const compiledSchema = useMemo(() => {
    if (!rootSchema && !schema) return undefined;
    try {
      const schemaToCompile = rootSchema || schema;
      // Unwrap the schema if it's wrapped with xs:schema key
      const unwrappedSchema = schemaToCompile['xs:schema'] || schemaToCompile['schema'] || schemaToCompile;
      return compileSchemaForWalking(unwrappedSchema);
    } catch (e) {
      console.warn('[XmlInstanceForm] Schema compilation failed:', e);
      return undefined;
    }
  }, [schema, rootSchema]);

  // Compute schema node tree using schema walker
  // This provides structured schema information for rendering
  // Walk the ACTUAL ROOT ELEMENT definition, not xs:schema
  const schemaNode = useMemo(() => {
    console.log('[SCHEMA_NODE_MEMO] Computing with:', {
      hasSchema: !!schema,
      hasRootElement: !!rootElement,
      hasCompiledSchema: !!compiledSchema,
      rootElementTag: rootElement?.tagName,
    });
    
    if (!schema || !rootElement || !compiledSchema) return undefined;
    try {
      // Unwrap the schema if it's wrapped with xs:schema key
      const unwrappedSchema = schema['xs:schema'] || schema['schema'] || schema;
      
      // Find the element definition that matches the root element from instance
      const elementDef = findElementInSchema(unwrappedSchema, rootElement.tagName);
      if (!elementDef) {
        console.warn('[XmlInstanceForm] Element not found in schema:', rootElement.tagName);
        return undefined;
      }
      
      // Extract the type from the element definition
      const elementAttrs = elementDef['@attributes'] || elementDef;
      const typeName = elementAttrs.type;
      
      console.log('[XmlInstanceForm] schemaNode recompute:', {
        rootElementTag: rootElement.tagName,
        elementDefKeys: elementDef ? Object.keys(elementDef) : 'none',
        elementDefAtAttrs: elementDef?.['@attributes'] || 'none',
        elementDefType: elementDef?.type,
        elementAttrsKeys: elementAttrs ? Object.keys(elementAttrs) : 'none',
        extractedTypeName: typeName,
      });
      
      // Walk the element definition with the correct type name
      const walked = walkSchema(compiledSchema, {
        rootSchema: unwrappedSchema,
        compiledSchema,
        visitedTypes: new Set(),
        typeName,
        inlineTypeDefinition: elementDef['xs:complexType'] || elementDef['complexType'] || elementDef['xs:simpleType'] || elementDef['simpleType'],
        depth: 0,
        maxDepth: 50,
        path: [],
      });
      console.log('[XmlInstanceForm] Schema walked successfully:', {
        tagName: walked.tagName,
        label: walked.label,
        nodeType: walked.nodeType,
        compositorType: walked.compositorType,
        elementType: walked.elementType,
        children: walked.children.length,
        attributes: walked.attributes.length,
        minOccurs: walked.minOccurs,
        maxOccurs: walked.maxOccurs,
        childNames: walked.children.map(c => c.tagName || c.label),
      });
      return walked;
    } catch (e) {
      console.warn('[XmlInstanceForm] Schema walk failed:', e);
      return undefined;
    }
  }, [schema, rootSchema, compiledSchema, rootElement]);

  if (!rootElement) {
    const debugInfo = (() => {
      const obj = value || schema;
      if (!obj) return 'no value or schema';
      if (typeof obj === 'string') return `string: ${obj.substring(0, 80)}`;
      if (obj.nodeName) return `has nodeName: ${obj.nodeName}`;
      const keys = Object.keys(obj).slice(0, 5);
      return `keys: [${keys.join(', ')}]`;
    })();
    
    return (
      <div style={{ padding: 16, color: '#999' }}>
        No XML elements to display
        {process.env.NODE_ENV === 'development' && (
          <div style={{ fontSize: 11, marginTop: 8, fontFamily: 'monospace', maxWidth: 400, wordBreak: 'break-all' }}>
            Debug: {debugInfo}
          </div>
        )}
      </div>
    );
  }

  const handleToggleExpand = (pathArray: string[]) => {
    const pathKey = pathArray.join('.');
    const newExpanded = new Set(expandedPaths);

    const collapsedKey = `__collapsed__:${pathKey}`;
    const initiallyExpanded = Boolean(autoExpandAll && initialAutoExpandPathsRef.current.has(pathKey));
    const explicitlyExpanded = newExpanded.has(pathKey);
    const explicitlyCollapsed = newExpanded.has(collapsedKey);
    const isExpanded = explicitlyExpanded || (initiallyExpanded && !explicitlyCollapsed);

    if (isExpanded) {
      newExpanded.delete(pathKey);
      newExpanded.add(collapsedKey);
    } else {
      newExpanded.add(pathKey);
      newExpanded.delete(collapsedKey);
    }

    setExpandedPaths(newExpanded);
  };

  // Update nested value at path
  // If value is wrapped (e.g., {person: {...}}), adjust path to account for wrapper
  const handleUpdateValue = (pathArray: string[], updateFn: (v: any) => any) => {
    const current = value || schema;
    if (!current || typeof current !== 'object') return;

    console.log('[debug-handleUpdateValue-start]', { pathArray, current });

    // Deep clone the current value
    const updated = JSON.parse(JSON.stringify(current));

    // Adjust path for wrapped values so child element edits always target
    // the wrapped root object (for example value.person.firstName).
    let adjustedPath = pathArray;
    if (wrapperKey) {
      const startsAtWrapper = adjustedPath.length > 0 && adjustedPath[0] === wrapperKey;
      adjustedPath = startsAtWrapper ? adjustedPath : [wrapperKey, ...adjustedPath];
    }

    // If path is empty, update root
    if (adjustedPath.length === 0) {
      const result = updateFn(updated);
      onChange(result);
      return;
    }

    // Navigate to the parent container for the last path segment.
    const resolveObjectIndex = (container: any, index: number): any => {
      if (!container || typeof container !== 'object') return undefined;
      const orderedKeys = Object.keys(container).filter((key) => {
        if (key.startsWith('@') || key.startsWith('_') || key.startsWith('#')) return false;
        if (key === 'nodeName' || key === 'name') return false;
        if (key.startsWith('__')) return false;
        return true;
      });
      if (orderedKeys.length === 0) return undefined;
      if (index < 0 || index >= orderedKeys.length) return undefined;
      return container[orderedKeys[index]];
    };

    let target: any = updated;
    for (let i = 0; i < adjustedPath.length - 1; i++) {
      const segment = adjustedPath[i];
      const nextSegment = adjustedPath[i + 1];
      const currentIsArray = Array.isArray(target);
      const segmentIsIndex = /^\d+$/.test(segment);
      const nextIsIndex = /^\d+$/.test(nextSegment);

      if (currentIsArray) {
        const index = Number.parseInt(segment, 10);
        if (!Number.isFinite(index) || index < 0) return;
        if (target[index] === undefined) {
          target[index] = nextIsIndex ? [] : {};
        }
        target = target[index];
      } else if (segmentIsIndex) {
        const resolved = resolveObjectIndex(target, Number.parseInt(segment, 10));
        if (resolved === undefined) return;
        target = resolved;
      } else {
        if (target[segment] === undefined) {
          target[segment] = nextIsIndex ? [] : {};
        }
        target = target[segment];
      }
    }

    // Apply the update function at the last path segment.
    const lastSegment = adjustedPath[adjustedPath.length - 1];
    const lastIsIndex = /^\d+$/.test(lastSegment);

    if (Array.isArray(target)) {
      if (!lastIsIndex) return;
      const index = Number.parseInt(lastSegment, 10);
      if (!Number.isFinite(index) || index < 0) return;
      const nextValue = updateFn(target[index]);
      console.log('[debug-handleUpdateValue-array]', { target, index, nextValue });
      target[index] = nextValue;
    } else {
      if (lastIsIndex) {
        let remaining = Number.parseInt(lastSegment, 10);
        if (!Number.isFinite(remaining) || remaining < 0) return;

        const dataKeys = Object.keys(target).filter((k) => !k.startsWith('@') && !k.startsWith('_'));
        for (const key of dataKeys) {
          const entry = target[key];
          if (Array.isArray(entry)) {
            if (remaining < entry.length) {
              const nextArray = [...entry];
              nextArray[remaining] = updateFn(nextArray[remaining]);
              target[key] = nextArray;
              onChange(updated);
              return;
            }
            remaining -= entry.length;
          } else {
            if (remaining === 0) {
              target[key] = updateFn(entry);
              onChange(updated);
              return;
            }
            remaining -= 1;
          }
        }
        return;
      }

      const nextValue = updateFn(target[lastSegment]);
      console.log('[debug-handleUpdateValue-object]', { lastSegment, target, nextValue });
      target[lastSegment] = nextValue;
    }

    console.log('[debug-handleUpdateValue-finish]', { updated });
    onChange(updated);
  };

  return (
    <div style={{ padding: 16 }}>
      <XmlElementNode
        element={rootElement}
        path={path}
        expandedPaths={expandedPaths}
        onToggleExpand={handleToggleExpand}
        value={value || schema}
        onChange={onChange}
        onUpdateValue={handleUpdateValue}
        rootSchema={showRootElementTriggers ? rootSchema : undefined}
        autoExpandAll={autoExpandAll}
        schemaNode={schemaNode}
        compiledSchema={compiledSchema}
        initialAutoExpandPathsRef={initialAutoExpandPathsRef}
        autoExpandCaptureActiveRef={autoExpandCaptureActiveRef}
        isSchemaForm={isSchemaForm}
      />
    </div>
  );
}

// Helper to convert DOM element to object structure
function xmlDomToObject(element: Element): any {
  const obj: any = {
    nodeName: element.nodeName,
  };

  // Add attributes with @ prefix
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes[i];
    obj['@' + attr.name] = attr.value;
  }

  // Add child elements
  let text = '';
  for (const child of element.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const childObj = xmlDomToObject(child as Element);
      if (obj[child.nodeName]) {
        // Multiple children with same name - convert to array
        if (!Array.isArray(obj[child.nodeName])) {
          obj[child.nodeName] = [obj[child.nodeName]];
        }
        obj[child.nodeName].push(childObj);
      } else {
        obj[child.nodeName] = childObj;
      }
    } else if (child.nodeType === Node.TEXT_NODE) {
      const trimmed = (child.textContent || '').trim();
      if (trimmed) text += trimmed + ' ';
    }
  }

  if (text.trim()) {
    obj._text = text.trim();
  }

  return obj;
}
