import { createContext, useContext, useState, useEffect, useMemo, useRef } from "react";
import { AutoFormFields } from './form-field-layout';
import { useWorkbenchStorage } from "../state/workbench-context";
import styles from "./xml-instance-form.module.css";
import { Trash2, ChevronDown, ChevronRight, Plus, Maximize2, Minimize2 } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip/tooltip";
import { XmlNodeRhsEditor as XmlInstanceNodeRhsEditor, getXsdAuthoringChildOptions } from './xml-instance-rhs-editors';
import {
  renderCountryInput,
  renderLanguageInput,
  normalizeColorInputValue,
  renderSimpleValueInput,
} from './xml-instance-value-input';
import { 
  walkSchema, 
  compileSchemaForWalking,
  getXmlAttrs,
  getTypeAttributes,
  getAttributeEnumerations,
  getAttributeFacets,
  getAllTypeNames,
} from '../utils/schema-walker';
import type { SchemaNode } from '../utils/schema-walker';
import type { ValidationFacets } from '../utils/schema-compiler';
import type {
  TopLevelXsdKind,
  XmlAttribute,
  XmlElement,
  XmlElementNodeProps,
  XmlInstanceFormProps,
} from './xml-instance-form.types';
import {
  facetsToHint,
  facetsToInputAttrs,
  findRootWrapperKey,
  getSchemaRootNode,
  getReferencedElementNames,
  getXmlInstanceExpansionStorageKey,
  normalizeXmlName,
  restoreChoiceDataFromStorage,
  resolveInstanceChildData,
  resolveInstanceChildKey,
  synchronizeXmlChildOrder,
  saveChoiceDataToStorage,
  sortElementsByReferenceUsage,
  toArray,
} from './xml-instance-form.utils';

const FieldGroupsContext = createContext<Readonly<Record<string, string>>>({});
const XsdAuthoringContext = createContext(true);
const XmlNamespacesContext = createContext<Readonly<Record<string, string>>>({});
const WalkingSchemaContext = createContext<unknown>(undefined);
const XSD_NAMESPACE = 'http://www.w3.org/2001/XMLSchema';

function readXmlNamespaces(attributes: readonly XmlAttribute[], inherited: Readonly<Record<string, string>>) {
  const namespaces = { ...inherited };
  for (const { name, value } of attributes) {
    if (name === 'xmlns') namespaces[''] = String(value);
    else if (name.startsWith('xmlns:')) namespaces[name.slice(6)] = String(value);
  }
  return namespaces;
}

export function XmlInstanceForm(props: XmlInstanceFormProps) {
  const documentNamespaces = readXmlNamespaces(
    Object.entries(getXmlAttrs(getSchemaRootNode(props.rootSchema !== props.schema ? props.rootSchema : undefined)))
      .map(([name, value]) => ({ name, value })),
    {},
  );
  return <FieldGroupsContext.Provider value={props.fieldGroups ?? {}}>
    <XsdAuthoringContext.Provider value={props.xsdAuthoring ?? true}>
    <WalkingSchemaContext.Provider value={props.schema}>
    <XmlNamespacesContext.Provider value={documentNamespaces}>
    <XmlInstanceFormContent {...props} />
    </XmlNamespacesContext.Provider>
    </WalkingSchemaContext.Provider>
    </XsdAuthoringContext.Provider>
  </FieldGroupsContext.Provider>;
}

/**
 * XmlInstanceForm renders an interactive form for XML document instance editing.
 * It displays XML elements and attributes with expandable/collapsible sections,
 * allowing users to add/remove elements and modify attribute values.
 * 
 * Since XSD schemas are themselves XML documents, this same component can be
 * used to render and edit XSD schema definitions by treating the schema XML
 * as an instance of the XML format.
 */

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


// Try to locate an element declaration in the XSD-like `rootSchema` object and return its type.

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

      const childLocalName = String(key).replace(/^.*:/, '').toLowerCase();
      if (childLocalName === 'element') {
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

function qualifyInsertedInstanceChildren(
  next: unknown,
  previous: unknown,
  schema: unknown,
  bindings: Record<string, string> = {},
  documentWrapper = false,
  schemaNode?: SchemaNode,
): void {
  if (!next || typeof next !== 'object') return;
  if (Array.isArray(next)) {
    next.forEach((entry, index) => qualifyInsertedInstanceChildren(
      entry, Array.isArray(previous) ? previous[index] : undefined, schema, bindings, false, schemaNode,
    ));
    return;
  }
  const record = next as Record<string, unknown>;
  const old = previous && typeof previous === 'object' ? previous as Record<string, unknown> : {};
  const namespaces = { ...bindings };
  const attrs = record['@attributes'];
  if (attrs && typeof attrs === 'object') {
    for (const [name, uri] of Object.entries(attrs)) {
      if (typeof uri === 'string' && (name === 'xmlns' || name.startsWith('xmlns:'))) {
        namespaces[name === 'xmlns' ? '' : name.slice(6)] = uri;
      }
    }
  }
  const schemaRoot = getSchemaRootNode(schema);
  const schemaAttrs = schemaRoot?.['@attributes'] || schemaRoot || {};
  for (const name of Object.keys(record)) {
    if (name.startsWith('@') || name.startsWith('_') || name.startsWith('#')) continue;
    let key = name;
    const child = record[name];
    const childSchemaNode = documentWrapper ? schemaNode : schemaNode?.children.find(node =>
      normalizeXmlName(node.label || node.tagName) === normalizeXmlName(name));
    const previousCount = Array.isArray(old[name]) ? old[name].length : old[name] === undefined ? 0 : 1;
    const hasNewOccurrences = Array.isArray(child) && child.length > previousCount;
    // Preserve existing imported names; qualify only inserted elements.
    if (!documentWrapper && (!Object.prototype.hasOwnProperty.call(old, name) || hasNewOccurrences) && !name.includes(':')) {
      const definition = childSchemaNode?.schemaObj || findElementDefinitionInRootSchema(schema, name);
      const declaration = definition?.['@attributes'] || definition;
      if (declaration) {
        const ref = typeof declaration.ref === 'string' ? declaration.ref : '';
        const qualified = Boolean(ref) || (declaration.form || schemaAttrs.elementFormDefault) === 'qualified';
        const refPrefix = ref.includes(':') ? ref.split(':')[0] : '';
        const uri = ref
          ? schemaAttrs[refPrefix ? `xmlns:${refPrefix}` : 'xmlns']
          : qualified ? schemaAttrs.targetNamespace : '';
        if (qualified && typeof uri === 'string' && uri) {
          let prefix = Object.keys(namespaces).find(candidate => namespaces[candidate] === uri);
          if (prefix === undefined) {
            const schemaPrefix = Object.keys(schemaAttrs).find(candidate =>
              candidate.startsWith('xmlns:') && schemaAttrs[candidate] === uri);
            const preferred = schemaPrefix?.slice(6) || 'ns';
            prefix = preferred;
            let suffix = 1;
            while (namespaces[prefix] && namespaces[prefix] !== uri) prefix = `${preferred}${suffix++}`;
            const currentAttrs = record['@attributes'];
            record['@attributes'] = { ...(currentAttrs && typeof currentAttrs === 'object' ? currentAttrs : {}), [`xmlns:${prefix}`]: uri };
            namespaces[prefix] = uri;
          }
          key = prefix ? `${prefix}:${name}` : name;
        } else if (!qualified && namespaces['']) {
          const inserted = Array.isArray(child) ? child.slice(previousCount) : [child];
          for (const entry of inserted) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
            const childRecord = entry as Record<string, unknown>;
            const childAttrs = childRecord['@attributes'];
            childRecord['@attributes'] = { ...(childAttrs && typeof childAttrs === 'object' ? childAttrs : {}), xmlns: '' };
          }
        }
      }
    }
    if (key !== name) {
      record[key] = child;
      delete record[name];
      if (Array.isArray(record.__childrenInOrder)) {
        record.__childrenInOrder = record.__childrenInOrder.map(entry =>
          entry?.tagName === name ? { ...entry, tagName: key } : entry);
      }
    }
    qualifyInsertedInstanceChildren(child, old[key] ?? old[name], schema, namespaces, false, childSchemaNode);
  }
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

      const childLocalName = String(key).replace(/^.*:/, '').toLowerCase();
      if (childLocalName === 'complextype') {
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

function getEntriesByLocalName(node: any, localName: string): any[] {
  const target = String(localName || '').replace(/^.*:/, '').toLowerCase();
  if (!node || typeof node !== 'object' || !target) return [];

  const matches: any[] = [];
  const seen = new Set<string>();

  const canonicalKey = (entry: any): string => {
    if (!entry || typeof entry !== 'object') return '';
    const attrs = entry['@attributes'] && typeof entry['@attributes'] === 'object'
      ? { ...entry['@attributes'] }
      : { ...entry };
    delete attrs['@attributes'];
    delete attrs['__childrenInOrder'];
    delete attrs['__parent'];
    delete attrs['nodeName'];
    return JSON.stringify(attrs);
  };

  const visit = (value: any) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      const childLocal = String(key || '').replace(/^.*:/, '').toLowerCase();
      if (childLocal === target) {
        const list = Array.isArray(child) ? child : [child];
        for (const entry of list) {
          if (!entry || typeof entry !== 'object') continue;
          const keyString = canonicalKey(entry);
          if (!keyString || seen.has(`${target}:${keyString}`)) continue;
          seen.add(`${target}:${keyString}`);
          matches.push(entry);
        }
      }

      if (key.startsWith('@') || key === 'nodeName') continue;
      if (child && typeof child === 'object') {
        visit(child);
      }
    }
  };

  visit(node);
  return matches;
}

function getSchemaImports(root: any): Array<{ namespace: string; schemaLocation: string }> {
  const schemaRoot = getSchemaRootNode(root);
  if (!schemaRoot || typeof schemaRoot !== 'object') return [];
  const raw = getEntriesByLocalName(schemaRoot, 'import');
  if (raw.length === 0) return [];
  return raw
    .map((it: any) => ({
      namespace: String(it?.['@namespace'] || it?.namespace || ''),
      schemaLocation: String(it?.['@schemaLocation'] || it?.schemaLocation || ''),
    }))
    .filter((it: any) => it.namespace || it.schemaLocation);
}

function getSchemaAnnotations(root: any): string[] {
  const schemaRoot = getSchemaRootNode(root);
  if (!schemaRoot || typeof schemaRoot !== 'object') return [];
  const list = getEntriesByLocalName(schemaRoot, 'annotation');
  if (list.length === 0) return [];
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
  if (Array.isArray(element.children) && element.children.some((c) => typeof c !== 'string' && ['any', 'xs:any'].includes(c.tagName))) {
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

  const elementList = getEntriesByLocalName(schemaRoot, 'element');

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
function ExpandableDocumentationInput({
  value,
  onChange,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  testId?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      {expanded ? (
        <textarea
          data-testid={testId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={5}
          style={{ flex: 1, minWidth: 200, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 3, fontSize: 12, resize: 'vertical' }}
        />
      ) : (
        <input
          data-testid={testId}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          style={{ flex: 1, maxWidth: 200, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 3, fontSize: 12 }}
        />
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setExpanded((current) => !current);
            }}
            aria-label={expanded ? 'Collapse xs:documentation' : 'Expand xs:documentation'}
            title={expanded ? 'Collapse xs:documentation' : 'Expand xs:documentation'}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 4, border: '1px solid #ddd', borderRadius: 3, background: 'transparent', cursor: 'pointer' }}
          >
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </TooltipTrigger>
        <TooltipContent>{expanded ? 'Collapse xs:documentation' : 'Expand xs:documentation'}</TooltipContent>
      </Tooltip>
    </>
  );
}

function XmlElementNode({
  element,
  path,
  expandedPaths,
  onToggleExpand,
  value,
  onChange,
  onUpdateValue,
  rootSchema,
  showRootElementTriggers = true,
  referencedElementNames,
  autoExpandAll = false,
  schemaNode: providedSchemaNode,
  compiledSchema,
  initialAutoExpandPathsRef,
  autoExpandCaptureActiveRef,
  isSchemaForm = false,
  rootXsdAddButtons,
  onAddTopLevelXsdDefinition,
  suppressElementLabel = false,
  suppressExpander = false,
  headerLabel,
  headerAction,
}: XmlElementNodeProps) {
  const fieldGroups = useContext(FieldGroupsContext);
  const xsdAuthoring = useContext(XsdAuthoringContext);
  const inheritedNamespaces = useContext(XmlNamespacesContext);
  const walkingSchema = useContext(WalkingSchemaContext);
  const namespaces = readXmlNamespaces(element.attributes || [], inheritedNamespaces);
  const localStorage = useWorkbenchStorage();
  const pathKey = path.join('.');
  if (autoExpandAll && autoExpandCaptureActiveRef?.current) {
    initialAutoExpandPathsRef?.current.add(pathKey);
  }

  const collapsedKey = `__collapsed__:${pathKey}`;
  const initiallyExpanded = Boolean(autoExpandAll && initialAutoExpandPathsRef?.current.has(pathKey));
  const explicitlyExpanded = expandedPaths.has(pathKey);
  const explicitlyCollapsed = expandedPaths.has(collapsedKey);
  const expanded = suppressExpander || explicitlyExpanded || (autoExpandAll && path.length === 0 && !explicitlyCollapsed) || (initiallyExpanded && !explicitlyCollapsed);
  const elementTagName = typeof element.tagName === 'string' ? element.tagName : '';
  const localTagName = elementTagName.replace(/^.*:/, '');
  // Rewalk truncated instance branches lazily so recursive schemas stay bounded.
  const schemaNode = useMemo(() => {
    const hasNoExpandedChildren = !providedSchemaNode?.children?.length;
    const hasTruncatedChild = providedSchemaNode?.children?.some(
      (child) => child.documentation === 'Maximum recursion depth reached',
    ) || false;
    if (
      !expanded ||
      !compiledSchema ||
      !providedSchemaNode ||
      (
        !hasNoExpandedChildren &&
        providedSchemaNode.documentation !== 'Maximum recursion depth reached' &&
        !hasTruncatedChild
      )
    ) {
      return providedSchemaNode;
    }

    const declaration = providedSchemaNode.schemaObj || compiledSchema.getElement(elementTagName);
    const declarationAttrs = declaration?.['@attributes'] || declaration || {};
    const inlineTypeDefinition =
      declaration?.['xs:complexType'] ||
      declaration?.complexType ||
      declaration?.['xs:simpleType'] ||
      declaration?.simpleType;
    const typeName = providedSchemaNode.elementType ||
      (typeof declarationAttrs.type === 'string' ? declarationAttrs.type : undefined);

    if (!typeName && !inlineTypeDefinition) return providedSchemaNode;

    const walked = walkSchema(compiledSchema, {
      rootSchema: getSchemaRootNode(walkingSchema),
      compiledSchema,
      visitedTypes: new Set(),
      typeName,
      inlineTypeDefinition,
      depth: 0,
      maxDepth: 2,
      path: [elementTagName],
    });
    return {
      ...walked,
      tagName: elementTagName,
      label: elementTagName,
      minOccurs: providedSchemaNode.minOccurs,
      maxOccurs: providedSchemaNode.maxOccurs,
      isRequired: providedSchemaNode.isRequired,
      elementType: typeName,
      schemaObj: declaration,
    };
  }, [compiledSchema, elementTagName, expanded, providedSchemaNode, walkingSchema]);
  const elementPrefix = elementTagName.includes(':') ? elementTagName.split(':')[0] : '';
  const inferredSchemaKind = xsdAuthoring && namespaces[elementPrefix] === XSD_NAMESPACE ? ({
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
  const renderSchemaTextInput = (
    widgetHint: string | null,
    htmlInputType: string,
    textValue: string,
    onValueChange: (nextValue: string) => void,
    fieldTagName: string,
    testId?: string,
  ) => {
    const isDocumentation = isSchemaForm && fieldTagName.replace(/^.*:/, '') === 'documentation';
    if (isDocumentation) return <ExpandableDocumentationInput value={textValue} onChange={onValueChange} testId={testId} />;
    return renderSimpleValueInput(widgetHint, htmlInputType, textValue, onValueChange, testId);
  };
  
  // Helper to find which choice group a child element belongs to
  const getChoiceGroupForChild = (childName: string): { groupIndex: number; isFirst: boolean } | null => {
    if (!choiceGroups.length) return null;

    for (const group of choiceGroups) {
      const optionNames = group.options.map((option) => option.name);
      const optionIndex = optionNames.indexOf(childName);
      if (optionIndex >= 0) {
        return { groupIndex: group.groupIndex, isFirst: optionIndex === 0 };
      }
    }

    return null;
  };

  // Detect contiguous choice-option clusters and de-duplicate repeated members so
  // a single XSD choice set renders as one selector rather than multiple stale copies.
  const choiceGroups = useMemo(() => {
    if (!schemaNode?.children) return [];

    const groups: Array<{
      groupIndex: number;
      options: Array<{ name: string; node: SchemaNode }>;
    }> = [];

    let currentGroup: Array<{ name: string; node: SchemaNode }> = [];
    const seenInGroup = new Set<string>();

    for (const child of schemaNode.children) {
      if (child.compositorType === 'choice') {
        const optionName = child.label || child.tagName || '';
        if (!optionName) continue;
        if (seenInGroup.has(optionName)) continue;
        seenInGroup.add(optionName);
        currentGroup.push({ name: optionName, node: child });
        continue;
      }

      if (currentGroup.length > 0) {
        groups.push({
          groupIndex: groups.length,
          options: currentGroup,
        });
        currentGroup = [];
        seenInGroup.clear();
      }
    }

    if (currentGroup.length > 0) {
      groups.push({
        groupIndex: groups.length,
        options: currentGroup,
      });
    }

    return groups;
  }, [schemaNode]);
  
  // For each choice group, determine the selected option
  const choiceInfo = useMemo(() => {
    const info = choiceGroups.map(group => {
      const choiceKey = `choice_${pathKey}_${group.groupIndex}`;
      
      const optionStates = group.options.map((opt) => {
        const optionData = resolveInstanceChildData(opt.name, element?.tagName, value, path.length === 0);
        return {
          name: opt.name,
          node: opt.node,
          hasValue: optionData !== undefined && optionData !== null,
        };
      });

      let selectedOption: string | null = null;
      const hasRepeatableOption = group.options.some((opt) => {
        const maxRaw = opt.node.maxOccurs;
        if (maxRaw === 'unbounded') return true;
        const max = Number(maxRaw);
        return Number.isFinite(max) && max > 1;
      });
      const presentOptionCount = optionStates.filter((state) => state.hasValue).length;
      const isExclusive = !hasRepeatableOption;
      const isChoiceGroupRequired = group.options.some((opt) => {
        const min = Number(opt.node.minOccurs ?? 0);
        return Number.isFinite(min) && min > 0;
      });

      if (isExclusive) {
        // Keep the currently populated branch selected so the dropdown remains usable
        // even when multiple sibling options are present. We still keep the sibling
        // rows visible instead of collapsing the whole group to a synthetic single
        // branch.
        const populatedOption = optionStates.find((option) => option.hasValue)?.name ?? null;
        if (populatedOption) {
          selectedOption = populatedOption;
        }
      }
      
      return {
        groupIndex: group.groupIndex,
        options: group.options,
        selectedOption,
        isRequired: isChoiceGroupRequired,
        choiceKey,
        isExclusive,
        isRepeatable: hasRepeatableOption,
      };
    });

    return info;
  }, [choiceGroups, pathKey, value, element?.tagName, path.length]);

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

  const elementChildren = element.children || [];
  const elementAttributes = element.attributes || [];
  const elementText = typeof element.text === 'string' ? element.text : '';

  const visibleChildren = elementChildren
    .map((child, rawIndex) => ({ child, rawIndex }))
    .filter(({ child }) => !shouldHideChildInInferredView(child));

  const hasChildren = visibleChildren.length > 0;
  const hasAttributes = elementAttributes.length > 0;
  const hasSchemaChildren = (schemaNode?.children?.length || 0) > 0;
  const hasSchemaAttributes = (schemaNode?.attributes?.length || 0) > 0;
  const compactAddLabel = (label: string): string => label.replace(/^Add\s+/i, '').trim();
  const authoringChildAddOptions = xsdAuthoring && namespaces[elementPrefix] === XSD_NAMESPACE
    ? getXsdAuthoringChildOptions(localTagName, elementPrefix ? `${elementPrefix}:` : '')
    : [];
  const hasExpandableContent = hasChildren || hasAttributes || hasSchemaChildren || hasSchemaAttributes || hasInferredEditor || authoringChildAddOptions.length > 0 || (path.length === 0 && Boolean(rootXsdAddButtons?.length));
  const hasText = elementText.length > 0;
  const isCompositor = namespaces[elementPrefix] === XSD_NAMESPACE && !!element.isCompositor;
  const nodeNameAttribute = elementAttributes.find((a) => a.name === 'name')?.value 
    || schemaNode?.attributes?.find((a) => a.name === 'name')?.default;
  
  const rootTopLevelKinds = new Set(
    (rootXsdAddButtons || []).map(({ kind }) => String(kind || '').toLowerCase())
  );
  // Show @name attribute in schema form only (instance form uses element tag name as identifier)
  const schemaNodeName = isSchemaForm && typeof nodeNameAttribute === 'string' && nodeNameAttribute.trim().length > 0
    ? nodeNameAttribute.trim()
    : null;
  const isAnonymousSchemaType = isSchemaForm
    && (localTagName === 'complexType' || localTagName === 'simpleType')
    && !schemaNodeName;
  
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
        return updated;
      });
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
    if (!showRootElementTriggers || path.length !== 0 || !rootSchema || typeof rootSchema !== 'object') return [];

    const schemaRoot = getSchemaRootNode(rootSchema);
    const elements = getEntriesByLocalName(schemaRoot, 'element');

    const findElementDefinitionByName = (candidateName: string): any | null => {
      if (!candidateName) return null;
      const normalized = String(candidateName).replace(/^.*:/, '');
      for (const entry of elements) {
        const attrs = entry?.['@attributes'] || entry || {};
        const currentName = String(attrs?.name || attrs?.['@name'] || entry?.name || entry?.['@name'] || '');
        if (!currentName) continue;
        if (String(currentName).replace(/^.*:/, '') === normalized) return entry;
      }
      return null;
    };

    const getDisplayTriggerName = (actualName: string, substitutionGroup?: string | null): string => {
      const trimmed = String(actualName || '').trim();
      if (!trimmed) return trimmed;
      const localName = trimmed.replace(/^.*:/, '');
      const group = typeof substitutionGroup === 'string' ? substitutionGroup.trim() : '';
      if (localName === 'template' && group.startsWith('xsl:')) return 'xsl:template';
      return trimmed;
    };

    const rootTriggerMap = new Map<string, { name: string; label: string; maxOccurs: number; minOccurs: number }>();

    for (const entry of elements) {
      const attrs = entry?.['@attributes'] || entry || {};
      const name = String(attrs?.name || attrs?.['@name'] || entry?.name || entry?.['@name'] || '').trim();
      if (!name) continue;

      const localName = String(name).replace(/^.*:/, '').toLowerCase();
      const schemaMetadataNames = new Set(['annotation', 'import', 'include', 'redefine']);
      if (schemaMetadataNames.has(localName) && getRootOccurrenceCount(value, name) > 0) continue;

      const abstractValue = attrs?.abstract ?? attrs?.['@abstract'] ?? attrs?.['abstract'];
      const isAbstract = abstractValue === true || abstractValue === 'true' || abstractValue === '1' || abstractValue === 1;
      if (isAbstract) continue;

      const maxOccursRaw = attrs?.maxOccurs ?? '1';
      const maxOccurs = maxOccursRaw === 'unbounded' ? Number.POSITIVE_INFINITY : Number(maxOccursRaw || '1');
      const minOccurs = Number(attrs?.minOccurs ?? '1');
      const substitutionGroup = attrs?.substitutionGroup ?? attrs?.['@substitutionGroup'] ?? attrs?.['substitutionGroup'];
      const substitutionGroupHead = typeof substitutionGroup === 'string' ? findElementDefinitionByName(substitutionGroup) : null;
      const substitutionHeadAttrs = substitutionGroupHead ? (substitutionGroupHead['@attributes'] || substitutionGroupHead || {}) : null;
      const substitutionHeadAbstract = substitutionHeadAttrs && (
        substitutionHeadAttrs.abstract === true ||
        substitutionHeadAttrs.abstract === 'true' ||
        substitutionHeadAttrs.abstract === '1' ||
        substitutionHeadAttrs.abstract === 1 ||
        substitutionHeadAttrs['@abstract'] === true ||
        substitutionHeadAttrs['@abstract'] === 'true' ||
        substitutionHeadAttrs['@abstract'] === '1' ||
        substitutionHeadAttrs['@abstract'] === 1
      );
      const isConcreteSubstitution = Boolean(substitutionGroup) && !isAbstract && substitutionHeadAbstract;
      const isSingletonChoice = minOccurs === 1 && maxOccurs === 1;
      const isRepeatableRootTrigger = minOccurs === 0 && (maxOccurs === Number.POSITIVE_INFINITY || maxOccurs > 1);

      if (!isSingletonChoice && !isConcreteSubstitution && !isRepeatableRootTrigger) continue;

      const label = getDisplayTriggerName(name, substitutionGroup);
      const normalizedKey = String(name).replace(/^.*:/, '');
      if (rootTriggerMap.has(normalizedKey)) continue;
      rootTriggerMap.set(normalizedKey, { name, label, maxOccurs, minOccurs });
    }

    return [...rootTriggerMap.values()];
  };

  const getRootOccurrenceCount = (currentValue: any, childName: string): number => {
    if (!currentValue || typeof currentValue !== 'object' || Array.isArray(currentValue)) return 0;
    const resolved = currentValue[childName] ?? resolveInstanceChildData(childName, undefined, currentValue, true);
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
    const updated = { ...(current || {}) };

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

  const getChildMinOccurs = (child: SchemaNode | null): number => {
    if (!child) return 1; // Default for instance-driven children without schema
    const min = Number(child.minOccurs);
    return Number.isFinite(min) && min >= 0 ? min : 1;
  };

  const getChildMaxOccurs = (child: SchemaNode | null): number => {
    if (!child) return 1; // Default for instance-driven children without schema
    if (child.maxOccurs === 'unbounded') return Number.POSITIVE_INFINITY;
    const max = Number(child.maxOccurs);
    return Number.isFinite(max) && max >= 0 ? max : 1;
  };

  const getChildOccurrenceCount = (currentValue: any, childName: string): number => {
    const key = resolveInstanceChildKey(currentValue, childName);
    const resolved = key !== undefined ? currentValue[key]
      : resolveInstanceChildData(childName, element?.tagName, currentValue, path.length === 0);
    if (resolved === undefined || resolved === null) return 0;
    return Array.isArray(resolved) ? resolved.length : 1;
  };

  const createDefaultChildValue = (child: SchemaNode): any => {
    const hasNestedChildren = (child.children?.length || 0) > 0;
    const hasAttributes = (child.attributes?.length || 0) > 0;
    if (!hasNestedChildren && !hasAttributes) return { _text: '' };
    const initial: Record<string, any> = {};
    const attributes: Record<string, string> = {};
    for (const attribute of child.attributes || []) {
      const defaultValue = attribute.fixed ?? attribute.default;
      if (defaultValue !== undefined || attribute.use === 'required') {
        attributes[attribute.name] = defaultValue ?? '';
      }
    }
    if (Object.keys(attributes).length > 0) initial['@attributes'] = attributes;
    for (const nested of child.children || []) {
      // Recursive/truncated branches are added explicitly rather than expanded indefinitely.
      if (nested.isRequired && !nested.isCircular && nested.compositorType !== 'choice') {
        initial[nested.label || nested.tagName] = createDefaultChildValue(nested);
      }
    }
    return initial;
  };

  const addChildOccurrence = (childName: string, childSchema: SchemaNode) => {
    const childPath = [...path, childName];
    const childPathKey = childPath.join('.');
    const childCollapsedKey = `__collapsed__:${childPathKey}`;
    const childIsInitiallyExpanded = Boolean(autoExpandAll && initialAutoExpandPathsRef?.current.has(childPathKey));
    const childIsExpanded = expandedPaths.has(childPathKey)
      || (childIsInitiallyExpanded && !expandedPaths.has(childCollapsedKey));
    if (!childIsExpanded && getChildOccurrenceCount(value, childName) < getChildMaxOccurs(childSchema)) {
      onToggleExpand(childPath);
    }

    const choiceGroupInfo = getChoiceGroupForChild(childName);
    const choiceGroupData = choiceGroupInfo ? choiceInfo[choiceGroupInfo.groupIndex] : null;

    onUpdateValue(path, (current) => {
      const wrapperKey = path.length === 0 ? findRootWrapperKey(current, element?.tagName) : null;
      const rootValue = wrapperKey ? current?.[wrapperKey] : current;
      const updated = asMutableElementObject(rootValue);

      // Enforce choice semantics by clearing sibling options when selecting a different branch.
      if (choiceGroupData?.isExclusive) {
        for (const option of choiceGroupData.options) {
          if (option.name !== childName) {
            delete updated[resolveInstanceChildKey(updated, option.name) ?? option.name];
          }
        }
      }

      const count = getChildOccurrenceCount(updated, childName);
      const maxOccurs = getChildMaxOccurs(childSchema);
      if (count >= maxOccurs) return current;

      const nextValue = createDefaultChildValue(childSchema);
      const key = resolveInstanceChildKey(updated, childName) ?? childName;
      if (count === 0) {
        updated[key] = nextValue;
      } else if (Array.isArray(updated[key])) {
        updated[key] = [...updated[key], nextValue];
      } else {
        updated[key] = [updated[key], nextValue];
      }

      if (wrapperKey) {
        const nextCurrent = { ...(current || {}) };
        nextCurrent[wrapperKey] = updated;
        return nextCurrent;
      }

      return updated;
    });
  };

  const removeChildOccurrence = (childName: string, childSchema: SchemaNode) => {
    onUpdateValue(path, (current) => {
      const wrapperKey = path.length === 0 ? findRootWrapperKey(current, element?.tagName) : null;
      const rootValue = wrapperKey ? current?.[wrapperKey] : current;
      const updated = { ...(rootValue || {}) };
      const count = getChildOccurrenceCount(updated, childName);
      const minOccurs = getChildMinOccurs(childSchema);

      if (count <= minOccurs) return current;

      const key = resolveInstanceChildKey(updated, childName) ?? childName;
      const existing = updated[key];

      if (Array.isArray(existing)) {
        const trimmed = existing.slice(0, -1);
        if (trimmed.length === 0) delete updated[key];
        else if (trimmed.length === 1) updated[key] = trimmed[0];
        else updated[key] = trimmed;
      } else {
        delete updated[key];
      }

      if (wrapperKey) {
        const nextCurrent = { ...(current || {}) };
        nextCurrent[wrapperKey] = updated;
        return nextCurrent;
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
    // choiceKey: string;
  }, choicePath: string[]) => {
    const selected = choiceGroupData.selectedOption;
    if (!selected) return;

    onUpdateValue(choicePath.slice(0, -1), (current) => {
      const updated = { ...(current || {}) };
      const key = resolveInstanceChildKey(updated, selected) ?? selected;
      delete updated[key];

      if (Array.isArray(updated['__childrenInOrder'])) {
        updated['__childrenInOrder'] = (updated['__childrenInOrder'] as any[]).filter(
          (item) => item?.tagName !== key
        );
      }

      return updated;
    });
  };

  const createChoiceValue = (optionName: string) => {
    const option = choiceGroups.flatMap(group => group.options).find(candidate => candidate.name === optionName);
    return option ? createDefaultChildValue(option.node) : { _text: '' };
  };

  const getChoiceDisplayName = (data: any): string | null => {
    const name = data?.['@attributes']?.name ?? data?.['@name'];
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  };

  const getChoiceChildKey = (current: unknown, optionName: string, previousKey?: string | null) => {
    const existing = resolveInstanceChildKey(current, optionName);
    if (existing) return existing;
    if (!optionName.includes(':') && previousKey?.includes(':')) {
      return `${previousKey.split(':')[0]}:${optionName}`;
    }
    return optionName;
  };

  const applyExclusiveChoiceSwitch = (
    current: any,
    choiceGroupData: { selectedOption: string | null; options: Array<{ name: string; node: SchemaNode }> },
    newSelectedOption: string,
  ) => {
    const updated = { ...(current || {}) };
    const currentlySelectedOption = choiceGroupData.selectedOption || (() => {
      for (const opt of choiceGroupData.options) {
        if (resolveInstanceChildKey(updated, opt.name) !== undefined) {
          return opt.name;
        }
      }
      return null;
    })();

    for (const opt of choiceGroupData.options) {
      if (opt.name !== newSelectedOption) {
        const key = resolveInstanceChildKey(updated, opt.name) ?? opt.name;
        if (updated[key] !== undefined) {
          saveChoiceDataToStorage(value, path, opt.name, updated[key], localStorage);
        }
        delete updated[key];
      }
    }

    const oldKey = currentlySelectedOption ? resolveInstanceChildKey(current, currentlySelectedOption) ?? currentlySelectedOption : null;
    const newKey = getChoiceChildKey(updated, newSelectedOption, oldKey);
    if (!updated[newKey]) {
      const restored = restoreChoiceDataFromStorage(value, path, newSelectedOption, localStorage);
      updated[newKey] = restored ?? createChoiceValue(newSelectedOption);
    }

    if (Array.isArray(updated['__childrenInOrder'])) {
      const childrenOrder = updated['__childrenInOrder'] as any[];
      updated['__childrenInOrder'] = childrenOrder.map((item: any) => {
        if (item?.tagName === oldKey) {
          return { ...item, tagName: newKey, value: updated[newKey] };
        }
        return item;
      });
    }

    return updated;
  };

  const renderExclusiveChoiceSelector = ({
    choiceGroupData,
    choicePath,
    children,
    showExpander = true,
    childrenBelow = false,
  }: {
    choiceGroupData: {
      selectedOption: string | null;
      options: Array<{ name: string; node: SchemaNode }>;
      isRequired: boolean;
    };
    choicePath: string[];
    children?: React.ReactNode;
    showExpander?: boolean;
    childrenBelow?: boolean;
  }) => {
    const showChoiceRemove = canRemoveChoiceSelection(choiceGroupData);
    const selectorPathKey = choicePath.join('.');
    const collapsedKey = `__collapsed__:${selectorPathKey}`;
    const isExpanded = expandedPaths.has(selectorPathKey);
    const isCollapsed = expandedPaths.has(collapsedKey);
    const shouldShowChildren = !isCollapsed && isExpanded;
    const selectedChoiceData = choiceGroupData.selectedOption
      ? resolveInstanceChildData(choiceGroupData.selectedOption, element?.tagName, value, path.length === 0)
      : null;
    const activeChoiceLabel = selectedChoiceData && choiceGroupData.selectedOption
      ? getChoiceDisplayName(selectedChoiceData)
      : null;

    return (
      <div style={{
        display: childrenBelow ? 'flex' : 'inline-flex',
        flexDirection: childrenBelow ? 'column' : undefined,
        alignItems: childrenBelow ? 'flex-start' : 'center',
        gap: 8,
        marginBottom: 8,
        width: 'auto',
        maxWidth: '100%',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: childrenBelow ? 'space-between' : 'flex-start',
          gap: 8,
          width: childrenBelow ? '100%' : 'auto',
          maxWidth: '100%',
        }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {showExpander && <button
              type="button"
              onClick={() => onToggleExpand(choicePath)}
              style={{
                padding: '2px 6px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '20px',
                fontSize: 12,
                color: '#666',
              }}
              title={shouldShowChildren ? 'Collapse' : 'Expand'}
              aria-label={shouldShowChildren ? 'Collapse' : 'Expand'}
            >
              {shouldShowChildren ? '▼' : '▶'}
            </button>}

            <select
              value={choiceGroupData.selectedOption || ''}
              onChange={(e) => {
                const newSelectedOption = e.target.value;
                if (newSelectedOption === choiceGroupData.selectedOption) return;
                onUpdateValue(choicePath.slice(0, -1), (current) => applyExclusiveChoiceSwitch(current, choiceGroupData, newSelectedOption));
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

            {activeChoiceLabel && (
              <span
                data-testid="xml-name-chip"
                style={{
                  color: '#155e75',
                  backgroundColor: '#ecfeff',
                  border: '1px solid #a5f3fc',
                  borderRadius: 999,
                  padding: '1px 8px',
                  fontSize: 11,
                  fontWeight: 600,
                  lineHeight: 1.6,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                {activeChoiceLabel}
              </span>
            )}
          </div>
        </div>

        {children && (childrenBelow ? (
          <div style={{ marginLeft: 28, width: 'calc(100% - 28px)', minWidth: 0 }}>
            {children}
          </div>
        ) : children)}

        {showChoiceRemove && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => removeChoiceSelection(choiceGroupData, choicePath)}
                className={styles.removeButton}
                title={`Remove selected ${choiceGroupData.selectedOption || 'choice'} option`}
                aria-label={`Remove selected ${choiceGroupData.selectedOption || 'choice'} option`}
              >
                <Trash2 size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{`Remove selected ${choiceGroupData.selectedOption || 'choice'} option`}</TooltipContent>
          </Tooltip>
        )}
      </div>
    );
  };

  const applyRepeatableChoiceSwitch = (
    current: any,
    childElementName: string,
    itemIndex: number,
    newElementType: string,
  ) => {
    const updated = { ...(current || {}) };
    const oldKey = resolveInstanceChildKey(updated, childElementName) ?? childElementName;
    const oldValues = Array.isArray(updated[oldKey])
      ? [...updated[oldKey]]
      : updated[oldKey] === undefined
        ? []
        : [updated[oldKey]];
    const oldData = oldValues[itemIndex];
    if (oldData === undefined) {
      console.warn('[XmlInstanceForm] Choice occurrence not found:', childElementName, itemIndex);
      return current;
    }

    const childrenOrder = Array.isArray(updated['__childrenInOrder'])
      ? updated['__childrenInOrder'] as any[]
      : Object.entries(updated)
        .filter(([key]) => !key.startsWith('@') && !key.startsWith('_') && !key.startsWith('#'))
        .flatMap(([tagName, data]) => (Array.isArray(data) ? data : [data]).map(value => ({ tagName, value })));
    const selectedOrderIndexes = childrenOrder
      .map((item, index) => item?.tagName === oldKey ? index : -1)
      .filter((index) => index >= 0);
    const selectedOrderIndex = selectedOrderIndexes[itemIndex];

    if (selectedOrderIndex === undefined) {
      console.warn('[XmlInstanceForm] Choice occurrence missing from child order:', childElementName, itemIndex);
      return current;
    }

    const occurrencePath = [...path, `choice-${selectedOrderIndex}`];
    saveChoiceDataToStorage(value, occurrencePath, childElementName, oldData, localStorage);
    const replacementValue = restoreChoiceDataFromStorage(value, occurrencePath, newElementType, localStorage)
      ?? createChoiceValue(newElementType);
    const newKey = getChoiceChildKey(updated, newElementType, oldKey);
    const nextChildrenOrder = childrenOrder.map((item, index) => (
      index === selectedOrderIndex
        ? { ...item, tagName: newKey, value: replacementValue }
        : item
    ));

    // __childrenInOrder is the canonical occurrence list. Rebuild every
    // represented bucket from it so stale duplicate arrays cannot survive.
    const orderedChildNames = new Set(
      nextChildrenOrder
        .map((item) => item?.tagName)
        .filter((tagName): tagName is string => typeof tagName === 'string' && tagName.length > 0),
    );
    const choiceChildNames = new Set(
      choiceGroups.flatMap((group) => group.options.map((option) => option.name)),
    );
    for (const childName of new Set([...orderedChildNames, ...choiceChildNames])) {
      delete updated[resolveInstanceChildKey(updated, childName) ?? childName];
    }
    for (const item of nextChildrenOrder) {
      if (!item?.tagName) continue;
      const existing = updated[item.tagName];
      if (existing === undefined) {
        updated[item.tagName] = item.value;
      } else if (Array.isArray(existing)) {
        updated[item.tagName] = [...existing, item.value];
      } else {
        updated[item.tagName] = [existing, item.value];
      }
    }
    updated['__childrenInOrder'] = nextChildrenOrder;

    return updated;
  };

  const renderRepeatableChoiceSelector = ({
    choiceGroupData,
    childElementName,
    rowPath,
    itemIndex,
    onChangeType,
  }: {
    choiceGroupData: {
      options: Array<{ name: string; node: SchemaNode }>;
    };
    childElementName: string;
    rowPath: string[];
    itemIndex: number;
    onChangeType: (newElementType: string) => void;
  }) => {
    const rowPathKey = rowPath.join('.');
    const rowCollapsedKey = `__collapsed__:${rowPathKey}`;
    const isRowExpanded = expandedPaths.has(rowPathKey);
    const isRowCollapsed = expandedPaths.has(rowCollapsedKey);
    const shouldShowChildren = !isRowCollapsed && isRowExpanded;

    return (
      <div key={`repeatable-choice-${childElementName}-${itemIndex}`} style={{ display: 'inline-flex', width: 'auto', maxWidth: '100%' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 8, width: 'auto', maxWidth: '100%' }}>
          <button
            type="button"
            onClick={() => onToggleExpand(rowPath)}
            style={{
              padding: '2px 6px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '20px',
              fontSize: 12,
              color: '#666',
            }}
            title={shouldShowChildren ? 'Collapse' : 'Expand'}
            aria-label={shouldShowChildren ? 'Collapse' : 'Expand'}
          >
            {shouldShowChildren ? '▼' : '▶'}
          </button>

          <select
            value={childElementName || ''}
            aria-label={`Select ${childElementName} type`}
            onChange={(e) => {
              const newElementType = e.target.value;
              if (newElementType === childElementName) return;
              onChangeType(newElementType);
            }}
            style={{
              padding: '6px 8px',
              border: '1px solid #ddd',
              borderRadius: 3,
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: 500,
              minWidth: 120,
              color: '#a78bfa',
            }}
          >
            {choiceGroupData.options.map(opt => (
              <option key={opt.name} value={opt.name}>
                {opt.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  };

  const canRemoveChildOccurrence = (childName: string, childSchema: SchemaNode | null): boolean => {
    const count = getChildOccurrenceCount(value, childName);
    return count > getChildMinOccurs(childSchema);
  };

  // Helper to sanitize test ids
  const sanitize = (s: string) => String(s || '').replace(/[^a-zA-Z0-9-_]/g, '_');
  const suggestedAttrNames = inferredSchemaKind ? getSuggestedAttributeNamesForTag(elementTagName) : [];
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
      const groupedAttributes = obj['@attributes'];
      if (groupedAttributes && typeof groupedAttributes === 'object' && !Array.isArray(groupedAttributes)) {
        obj['@attributes'] = { ...groupedAttributes };
        if (attrValue === undefined || attrValue === null || attrValue === '') {
          delete obj['@attributes'][attrName];
        } else {
          obj['@attributes'][attrName] = attrValue;
        }
        delete obj[`@${attrName}`];
        return;
      }
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

  const renderElementTriggers = () => {
    const renderedTriggerNames = new Set<string>();
    const repeatableChoiceNames = new Set(
      choiceInfo
        .filter((group) => group.isRepeatable)
        .flatMap((group) => group.options.map((option) => option.name)),
    );
    const orderedTriggerNodes = sortElementsByReferenceUsage(
      (schemaNode?.children || []).filter((childSchemaNode) => {
        const childName = childSchemaNode.label || childSchemaNode.tagName || '';
        if (repeatableChoiceNames.has(childName)) return false;
        const childDeclarationAttrs = getXmlAttrs(childSchemaNode.schemaObj);
        const referencedDeclaration = typeof childDeclarationAttrs.ref === 'string'
          ? compiledSchema?.getElement(childDeclarationAttrs.ref)
          : undefined;
        const declaration = referencedDeclaration ||
          childSchemaNode.schemaObj ||
          compiledSchema?.getElement(childName);
        const abstract = getXmlAttrs(declaration).abstract;
        return abstract !== true && abstract !== 'true' && abstract !== '1';
      }),
      (childSchemaNode) => childSchemaNode.label || childSchemaNode.tagName || '',
      referencedElementNames || new Set<string>(),
    );

    return (
      <>
        {path.length === 0 && rootXsdAddButtons?.map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            onClick={() => onAddTopLevelXsdDefinition?.(kind)}
            title={label}
            aria-label={label}
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
            <span>{compactAddLabel(label)}</span>
          </button>
        ))}
        {authoringChildAddOptions.map((trigger) => (
          <button
            key={`${elementTagName}-${trigger.name}`}
            type="button"
            onClick={() => addChildOccurrence(trigger.name, {
              tagName: trigger.name,
              label: trigger.name,
              nodeType: 'element',
              minOccurs: trigger.minOccurs,
              maxOccurs: trigger.maxOccurs,
              children: [],
              attributes: [],
              isRequired: false,
            })}
            title={trigger.label}
            aria-label={trigger.label}
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
            <span>{compactAddLabel(trigger.label)}</span>
          </button>
        ))}
        {choiceInfo.filter((group) => group.isRepeatable).map((group) => (
          <select
            key={`repeatable-choice-${elementTagName}-${group.groupIndex}`}
            aria-label={`Add child to ${elementTagName} from choice group ${group.groupIndex + 1}`}
            title="Choose a child element to add"
            value=""
            onChange={(event) => {
              const selectedOption = group.options.find((option) => option.name === event.target.value);
              if (selectedOption) addChildOccurrence(selectedOption.name, selectedOption.node);
            }}
            style={{
              padding: '4px 8px',
              borderRadius: 12,
              border: '1px solid #ddd',
              backgroundColor: '#f9f9f9',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 500,
              color: '#666',
              maxWidth: '100%',
            }}
          >
            <option value="">Add child element...</option>
            {group.options.map((option) => (
              <option
                key={option.name}
                value={option.name}
                disabled={getChildOccurrenceCount(value, option.name) >= getChildMaxOccurs(option.node)}
              >
                {option.name}
              </option>
            ))}
          </select>
        ))}
        {orderedTriggerNodes.map((childSchemaNode, triggerIndex) => {
          const childElementName = childSchemaNode.label || childSchemaNode.tagName || `child-${triggerIndex}`;
          const normalizedChildLocal = childElementName.replace(/^.*:/, '').toLowerCase();
          if (renderedTriggerNames.has(normalizedChildLocal)) return null;
          renderedTriggerNames.add(normalizedChildLocal);
          if (
            path.length === 0 &&
            rootTopLevelKinds.size > 0 &&
            rootTopLevelKinds.has(normalizedChildLocal)
          ) return null;

          const count = getChildOccurrenceCount(value, childElementName);
          const maxOccurs = getChildMaxOccurs(childSchemaNode);
          const minOccurs = getChildMinOccurs(childSchemaNode);
          const choiceGroupInfo = getChoiceGroupForChild(childElementName);
          const choiceGroupData = choiceGroupInfo ? choiceInfo[choiceGroupInfo.groupIndex] : null;
          const selectedChoiceName = choiceGroupData?.selectedOption || null;
          const isBlockedByChoice = Boolean(selectedChoiceName && selectedChoiceName !== childElementName);
          const isBelowMinimum = count < minOccurs && !isBlockedByChoice;
          const isRequiredSingleton = minOccurs > 0 && maxOccurs === 1;
          if (isRequiredSingleton && !isBelowMinimum) return null;
          const canAdd = !isBlockedByChoice && count < maxOccurs;
          const maxLabel = Number.isFinite(maxOccurs) ? String(maxOccurs) : '∞';
          const addTitle = isBlockedByChoice
            ? `Choice already satisfied by ${selectedChoiceName}`
            : (canAdd ? `Add ${childElementName} (${count}/${maxLabel})` : `${childElementName} reached maxOccurs (${maxLabel})`);
          const addTriggerLabel = `Add ${childElementName}`;

          return (
            <div key={`trigger-${childElementName}-${triggerIndex}`} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => addChildOccurrence(childElementName, childSchemaNode)}
                disabled={!canAdd}
                title={addTitle}
                aria-label={addTriggerLabel}
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
                <span>{compactAddLabel(addTriggerLabel)}</span>
                {isBelowMinimum && <span title="Required until minimum occurrences are met">!</span>}
              </button>
            </div>
          );
        })}
      </>
    );
  };

  return (
    <XmlNamespacesContext.Provider value={namespaces}>
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
                ? `${trigger.label} already selected (${count}/${maxLabel})`
                : (selectedRootOption
                  ? `Switch to ${trigger.label} (${count}/${maxLabel})`
                  : (canAdd ? `Add ${trigger.label} (${count}/${maxLabel})` : `${trigger.label} reached maxOccurs (${maxLabel})`));

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
                  <span>{trigger.label}</span>
                  {isBelowMinimum && !isSelected && <span title="Required until minimum occurrences are met">!</span>}
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* Element header with toggle */}
      {!(suppressElementLabel && suppressExpander) && (
      <div
        className={styles.propertyHeader}
        style={{
          marginBottom: hasChildren || hasAttributes ? 8 : 0,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          width: 'auto',
          maxWidth: '100%',
        }}
      >
        {hasExpandableContent && !suppressExpander ? (
          <button
            onClick={() => onToggleExpand(path)}
            aria-label={expanded ? 'Collapse' : 'Expand'}
            title={expanded ? 'Collapse' : 'Expand'}
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
        {!suppressElementLabel && (
        <div
          className={styles.propertyName}
          data-testid={`xml-tag-${sanitize(element.tagName)}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            minWidth: 0,
            whiteSpace: 'nowrap',
            flexWrap: 'nowrap',
          }}
        >
          {headerLabel ?? (
            <>
              <span style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>{element.tagName}</span>
              {/* Compositor badge for XSD-specific nodes */}
              {isCompositor && (
                <span className={styles.badge} style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>Compositor</span>
              )}
              {/* Always show @name attribute in schema form, inline with the label */}
              {schemaNodeName && (
                <span
                  data-testid="xml-name-chip"
                  style={{
                    color: '#155e75',
                    backgroundColor: '#ecfeff',
                    border: '1px solid #a5f3fc',
                    borderRadius: 999,
                    padding: '1px 8px',
                    fontSize: 11,
                    fontWeight: 600,
                    lineHeight: 1.6,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  {schemaNodeName}
                </span>
              )}
              {isAnonymousSchemaType && (
                <span
                  data-testid="xml-anonymous-type"
                  style={{
                    color: '#92400e',
                    backgroundColor: '#fffbeb',
                    border: '1px solid #fcd34d',
                    borderRadius: 999,
                    padding: '1px 8px',
                    fontSize: 11,
                    fontWeight: 600,
                    lineHeight: 1.6,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  Anonymous type
                </span>
              )}
            </>
          )}
        </div>
        )}
        {hasText && !expanded && (
          <span style={{ fontSize: 12, color: '#666', fontStyle: 'italic' }}>
            {`"${element.text.substring(0, 50)}${element.text.length > 50 ? '...' : ''}"`}
          </span>
        )}
        {headerAction}
      </div>
      )}

      {/* Expanded content: attributes and children */}
      {expanded && hasExpandableContent && (
        <div className={styles.objectContainer}>
          {/* Root schema add buttons: shown outside the inferred-editor guard so xs:schema in non-schema-form
              mode (no expansionStateKey) still gets the Add Element / Add ComplexType buttons.
              Skip when isSchemaForm because that path handles them via the children trigger row. */}
          {path.length === 0 && rootXsdAddButtons && rootXsdAddButtons.length > 0 && hasInferredEditor && !isSchemaForm && (
            <div className={styles.elementTriggerRow} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', maxWidth: '100%', marginBottom: 8 }}>
              {rootXsdAddButtons.map(({ kind, label }) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => onAddTopLevelXsdDefinition?.(kind)}
                  title={label}
                  aria-label={label}
                  style={{ padding: '3px 8px', borderRadius: 12, border: '1px solid #ddd', backgroundColor: '#f9f9f9', cursor: 'pointer', fontSize: 11, fontWeight: 500, color: '#666', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {hasAttributes && !hasInferredEditor && (
            <div
              className={styles.elementTriggerRow}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                alignItems: 'center',
                maxWidth: '100%',
                marginBottom: 8,
              }}
            >
              {renderElementTriggers()}
            </div>
          )}
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
                      return sortedTriggerNames.length > 0 || hasSchemaChildren ? (
                      <div className={styles.attributeTriggerRow} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'flex-start', marginBottom: 8 }}>
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

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <AutoFormFields>
                      {editableAttrs.map((attr) => {
                        const attrType = schemaNode?.attributes?.find(definition => definition.name === attr.name)?.type;
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
                          <div key={attr.name} data-field-type={attrType}
                            data-layout-group={fieldGroups[[...path, `@${attr.name}`].join('.')] ?? fieldGroups[`@${attr.name}`]}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
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
                      </AutoFormFields>
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
          {(() => {
            const cond1 = hasChildren;
            const cond2 = hasSchemaChildren;
            const cond3 = path.length === 0 && rootXsdAddButtons && rootXsdAddButtons.length > 0;
            const cond4 = authoringChildAddOptions.length > 0;
            const shouldRender = cond1 || cond2 || cond3 || cond4;
            const isSchema = element?.tagName === 'xs:schema' || element?.tagName?.endsWith(':schema');
            if (isSchema || path.length === 0) {
            }
            return shouldRender;
          })() && (
            <div>
              {(!hasAttributes || hasInferredEditor) && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                {isSchemaForm || !hasInferredEditor ? (
                  <div className={styles.elementTriggerRow} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    {path.length === 0 && rootXsdAddButtons && rootXsdAddButtons.length > 0 && rootXsdAddButtons.map(({ kind, label }) => (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => onAddTopLevelXsdDefinition?.(kind)}
                        title={label}
                        aria-label={label}
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
                        <span>{compactAddLabel(label)}</span>
                      </button>
                    ))}
                    {authoringChildAddOptions.map((trigger) => (
                      <button
                        key={`${elementTagName}-${trigger.name}`}
                        type="button"
                        onClick={() => addChildOccurrence(trigger.name, {
                          tagName: trigger.name,
                          label: trigger.name,
                          nodeType: 'element',
                          minOccurs: trigger.minOccurs,
                          maxOccurs: trigger.maxOccurs,
                          children: [],
                          attributes: [],
                          isRequired: false,
                        })}
                        title={trigger.label}
                        aria-label={trigger.label}
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
                        <span>{compactAddLabel(trigger.label)}</span>
                      </button>
                    ))}
                    {schemaNode?.children && schemaNode.children.length > 0 ? (() => {
                      const renderedTriggerNames = new Set<string>();
                      const repeatableChoiceNames = new Set(
                        choiceInfo
                          .filter((group) => group.isRepeatable)
                          .flatMap((group) => group.options.map((option) => option.name)),
                      );
                      const orderedTriggerNodes = sortElementsByReferenceUsage(
                        schemaNode.children.filter((childSchemaNode) => {
                          const childName = childSchemaNode.label || childSchemaNode.tagName || '';
                          if (repeatableChoiceNames.has(childName)) return false;
                          const childDeclaration = childSchemaNode.schemaObj;
                          const childDeclarationAttrs = getXmlAttrs(childDeclaration);
                          const referencedDeclaration = typeof childDeclarationAttrs.ref === 'string'
                            ? compiledSchema?.getElement(childDeclarationAttrs.ref)
                            : undefined;
                          const declaration = referencedDeclaration ||
                            childDeclaration ||
                            compiledSchema?.getElement(childName);
                          const declarationAttrs = getXmlAttrs(declaration);
                          const abstract = declarationAttrs.abstract;
                          return abstract !== true && abstract !== 'true' && abstract !== '1';
                        }),
                        (childSchemaNode) => childSchemaNode.label || childSchemaNode.tagName || '',
                        referencedElementNames || new Set<string>(),
                      );
                      return (
                        <>
                          {choiceInfo.filter((group) => group.isRepeatable).map((group) => (
                            <select
                              key={`repeatable-choice-${elementTagName}-${group.groupIndex}`}
                              aria-label={`Add child to ${elementTagName} from choice group ${group.groupIndex + 1}`}
                              title="Choose a child element to add"
                              value=""
                              onChange={(event) => {
                                const selectedOption = group.options.find((option) => option.name === event.target.value);
                                if (selectedOption) {
                                  addChildOccurrence(selectedOption.name, selectedOption.node);
                                }
                              }}
                              style={{
                                padding: '4px 8px',
                                borderRadius: 12,
                                border: '1px solid #ddd',
                                backgroundColor: '#f9f9f9',
                                cursor: 'pointer',
                                fontSize: 11,
                                fontWeight: 500,
                                color: '#666',
                                maxWidth: '100%',
                              }}
                            >
                              <option value="">Add child element...</option>
                              {group.options.map((option) => (
                                <option
                                  key={option.name}
                                  value={option.name}
                                  disabled={getChildOccurrenceCount(value, option.name) >= getChildMaxOccurs(option.node)}
                                >
                                  {option.name}
                                </option>
                              ))}
                            </select>
                          ))}
                          {orderedTriggerNodes.map((childSchemaNode, triggerIndex) => {
                      const childElementName = childSchemaNode.label || childSchemaNode.tagName || `child-${triggerIndex}`;
                      const normalizedChildLocal = String(childElementName).replace(/^.*:/, '').toLowerCase();
                      if (renderedTriggerNames.has(normalizedChildLocal)) return null;
                      renderedTriggerNames.add(normalizedChildLocal);
                      const shouldSkipDuplicateRootTrigger =
                        path.length === 0 &&
                        rootTopLevelKinds.size > 0 &&
                        rootTopLevelKinds.has(normalizedChildLocal);
                      if (shouldSkipDuplicateRootTrigger) return null;

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
                      const addTriggerLabel = `Add ${childElementName}`;

                      return (
                        <div key={`trigger-${childElementName}-${triggerIndex}`} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          <button
                            type="button"
                            onClick={() => addChildOccurrence(childElementName, childSchemaNode)}
                            disabled={!canAdd}
                            title={addTitle}
                            aria-label={addTriggerLabel}
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
                            <span>{compactAddLabel(addTriggerLabel)}</span>
                            {isBelowMinimum && <span title="Required until minimum occurrences are met">!</span>}
                          </button>
                        </div>
                      );
                          })}
                        </>
                      );
                    })() : null}
                  </div>
                ) : null}
              </div>
              )}
              {/* Walk the compiled schema structure, use instance data for values */}
              {schemaNode?.children && schemaNode.children.length > 0 ? (
                <AutoFormFields>{(() => {
                  const seenNames = new Set<string>();
                  return schemaNode.children
                    .map((childSchemaNode, index) => ({ childSchemaNode, index }))
                    .filter(({ childSchemaNode }) => {
                      const name = childSchemaNode.label || childSchemaNode.tagName;
                      if (getChildOccurrenceCount(value, name) === 0) return false;
                      const localName = normalizeXmlName(name);
                      if (seenNames.has(localName)) return false;
                      seenNames.add(localName);
                      return true;
                    });
                })()
                
                  .map(({ childSchemaNode, index }) => {
                  const childElementName = childSchemaNode.label || childSchemaNode.tagName || '';
                  const childInstanceData = resolveInstanceChildData(
                      childElementName,
                      element?.tagName,
                      value,
                      path.length === 0,
                    );

                  if (!childElementName) return null;

                  const childElement_ = element?.children?.find((child): child is XmlElement =>
                        typeof child !== 'string' && 
                        (child.tagName === childElementName || 
                         child.tagName?.replace(/^.*:/, '') === childElementName.replace(/^.*:/, ''))
                      );
                  
                  const choiceGroupInfo = getChoiceGroupForChild(childElementName);
                  const choiceGroupData = choiceGroupInfo ? choiceInfo[choiceGroupInfo.groupIndex] : null;
                  const effectiveChildInstanceData = childInstanceData;

                  let elementToRender = childElement_;
                  if (
                    effectiveChildInstanceData !== undefined &&
                    effectiveChildInstanceData !== null &&
                    !Array.isArray(effectiveChildInstanceData)
                  ) {
                    const instanceTag = childElement_?.tagName || resolveInstanceChildKey(value, childElementName) || childElementName;
                    elementToRender = parseXmlElement(effectiveChildInstanceData, instanceTag) || elementToRender;
                  }
                  
                  // Treat schema-leaf elements as simple when either parsed element shape is simple
                  // or the instance value is scalar/text-only data.
                  const schemaSaysSimple = (childSchemaNode?.children?.length || 0) === 0;
                  const schemaHasNoAttrs = (childSchemaNode?.attributes?.length || 0) === 0;
                  const parsedElementIsSimple = Boolean(
                    childElement_ &&
                    childElement_.children?.length === 0 &&
                    childElement_.attributes?.length === 0
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
                        Object.keys(effectiveChildInstanceData).every((k) => {
                          if (k === '_text' || k === '#text') return true;
                          if (k !== '@attributes') return false;
                          const attributes = (effectiveChildInstanceData as any)['@attributes'];
                          return attributes && typeof attributes === 'object' && Object.keys(attributes).length === 0;
                        })
                      )
                    )
                  );
                  
                  const isSimpleChild = schemaSaysSimple && schemaHasNoAttrs
                    && (parsedElementIsSimple || instanceValueIsTextOnly);
                  
                  if (choiceGroupData && !choiceGroupData.isExclusive && childSchemaNode?.compositorType === 'choice') {
                    
                    // For non-array choice children, render as single choice item
                    if (!Array.isArray(effectiveChildInstanceData) && elementToRender) {
                      const rowPath = [...path, childElementName];
                      const rowPathKey = rowPath.join('.');
                      const rowCollapsedKey = `__collapsed__:${rowPathKey}`;
                      const isRowExpanded = expandedPaths.has(rowPathKey);
                      const isRowCollapsed = expandedPaths.has(rowCollapsedKey);
                      const shouldShowChildren = !isRowCollapsed && isRowExpanded;
                      
                      // Extract @name attribute for display from element's attributes
                      const displayName = getChoiceDisplayName(effectiveChildInstanceData);
                      
                      return (
                        <div
                          key={`choice-non-array-${childElementName}-${index}`}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 8,
                            width: path.length === 0 ? '100%' : 'auto',
                            flexBasis: path.length === 0 ? '100%' : 'auto',
                            maxWidth: '100%',
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0, marginBottom: 0, minWidth: 0, flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <button
                                type="button"
                                onClick={() => onToggleExpand(rowPath)}
                                style={{
                                  padding: '2px 6px',
                                  background: 'transparent',
                                  border: 'none',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  minWidth: '20px',
                                  fontSize: 12,
                                  color: '#666',
                                }}
                                title={shouldShowChildren ? 'Collapse' : 'Expand'}
                                aria-label={shouldShowChildren ? 'Collapse' : 'Expand'}
                              >
                                {shouldShowChildren ? '▼' : '▶'}
                              </button>
                              <select
                                value={childElementName || ''}
                                aria-label={`Select ${childElementName} type`}
                                onChange={(e) => {
                                  const newElementType = e.target.value;
                                  if (newElementType === childElementName) return;
                                  onUpdateValue(path, (current) => choiceGroupData.isExclusive
                                    ? applyExclusiveChoiceSwitch(current, choiceGroupData, newElementType)
                                    : applyRepeatableChoiceSwitch(current, childElementName, 0, newElementType));
                                }}
                                style={{
                                  padding: '6px 8px',
                                  border: '1px solid #ddd',
                                  borderRadius: 3,
                                  fontSize: 12,
                                  cursor: 'pointer',
                                  fontWeight: 500,
                                  minWidth: 120,
                                  color: '#a78bfa',
                                }}
                              >
                                {choiceGroupData.options.map(opt => (
                                  <option key={opt.name} value={opt.name}>
                                    {opt.name}
                                  </option>
                                ))}
                              </select>
                              {displayName && (
                                <span
                                  data-testid="xml-name-chip"
                                  style={{
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
                                  {displayName}
                                </span>
                              )}
                              {canRemoveChildOccurrence(childElementName, childSchemaNode) && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      onClick={() => removeChildOccurrence(childElementName, childSchemaNode)}
                                      className={styles.removeButton}
                                      title={`Remove ${childElementName}`}
                                      aria-label={`Remove ${childElementName}`}
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>{`Remove ${childElementName}`}</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          {shouldShowChildren && (
                            <div style={{ marginLeft: '20px', width: 'calc(100% - 20px)', minWidth: 0 }}>
                              <XmlElementNode
                                element={elementToRender}
                                path={rowPath}
                                expandedPaths={expandedPaths}
                                onToggleExpand={onToggleExpand}
                                value={effectiveChildInstanceData}
                                onChange={onChange}
                                onUpdateValue={onUpdateValue}
                                rootSchema={rootSchema}
                                referencedElementNames={referencedElementNames}
                                autoExpandAll={true}
                                schemaNode={childSchemaNode}
                                compiledSchema={compiledSchema}
                                isSchemaForm={isSchemaForm}
                                suppressElementLabel={true}
                                suppressExpander={true}
                              />
                            </div>
                          )}
                          </div>
                        </div>
                      );
                    }
                    // Don't return early - continue to normal rendering below for arrays
                  }
                  
                  // Handle both single and multiple occurrences
                  if (Array.isArray(effectiveChildInstanceData)) {
                    const childMinOccurs = getChildMinOccurs(childSchemaNode);
                    // Pre-collect parsed XmlElement children matching this tag name from
                    // the parsed element tree, so array items get the correct tagName and
                    // attributes (avoiding passing raw schema objects without tagName).
                    const matchingParsedChildren = (element?.children || [])
                      .filter((c): c is XmlElement => typeof c !== 'string' && (
                        c.tagName === childElementName ||
                        c.tagName.replace(/^.*:/, '') === childElementName.replace(/^.*:/, '')
                      ));
                    // Render each array element
                    // For choice groups, show the dropdown before the first element
                    const arrayItems = effectiveChildInstanceData.map((child, arrayIndex) => {
                      const parsedFromTree = matchingParsedChildren[arrayIndex];
                      const resolvedElement = parsedFromTree
                        ? parsedFromTree
                        : (child && typeof child === 'object' && typeof (child as any).tagName !== 'string'
                          ? (parseXmlElement(child, childElementName) || child)
                          : child);
                      return (
                      <div key={`${childElementName}-${arrayIndex}`} style={{ position: 'relative' }}>
                        <XmlElementNode
                          element={resolvedElement}
                          path={[...path, childElementName, String(arrayIndex)]}
                          expandedPaths={expandedPaths}
                          onToggleExpand={onToggleExpand}
                          value={child}
                          onChange={onChange}
                          onUpdateValue={onUpdateValue}
                          rootSchema={rootSchema}
                          referencedElementNames={referencedElementNames}
                          autoExpandAll={autoExpandAll}
                          schemaNode={childSchemaNode}
                          compiledSchema={compiledSchema}
                          initialAutoExpandPathsRef={initialAutoExpandPathsRef}
                          autoExpandCaptureActiveRef={autoExpandCaptureActiveRef}
                          isSchemaForm={isSchemaForm}
                        />
                        {effectiveChildInstanceData.length > childMinOccurs && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => {
                                  onUpdateValue(path, (current) => {
                                    const updated = { ...current };
                                    const key = resolveInstanceChildKey(updated, childElementName) ?? childElementName;
                                    if (Array.isArray(updated[key])) {
                                      updated[key].splice(arrayIndex, 1);
                                      if (updated[key].length === 0) {
                                        delete updated[key];
                                      } else if (updated[key].length === 1) {
                                        updated[key] = updated[key][0];
                                      }
                                    }
                                    return updated;
                                  });
                                }}
                                className={styles.removeButton}
                                style={{ position: 'absolute', right: 0, top: 8 }}
                                title={`Remove ${childElementName} ${arrayIndex + 1}`}
                                aria-label={`Remove ${childElementName} ${arrayIndex + 1}`}
                              >
                                <Trash2 size={14} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>{`Remove ${childElementName} ${arrayIndex + 1}`}</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      );
                    });
                    
                    // If this element is the currently selected option in a choice group, wrap array items with choice dropdown
                    // For exclusive choices: show one dropdown for all occurrences
                    // For repeatable choices: show dropdown for each occurrence
                    if (choiceGroupData?.isExclusive && choiceGroupData.selectedOption === childElementName && childSchemaNode?.compositorType === 'choice') {
                      // Setup expansion tracking for exclusive choice array
                      const choiceArrayPath = [...path, childElementName];
                      const choiceArrayPathKey = choiceArrayPath.join('.');
                      const choiceArrayCollapsedKey = `__collapsed__:${choiceArrayPathKey}`;
                      const isChoiceArrayExpanded = expandedPaths.has(choiceArrayPathKey);
                      const isChoiceArrayCollapsed = expandedPaths.has(choiceArrayCollapsedKey);
                      const shouldShowChoiceArrayChildren = !isChoiceArrayCollapsed && isChoiceArrayExpanded;
                      
                      return (
                        <div key={`choice-exclusive-array-${childElementName}-${index}`}>
                          {renderExclusiveChoiceSelector({
                            choiceGroupData,
                            choicePath: choiceArrayPath,
                            showExpander: !isSimpleChild,
                            children: shouldShowChoiceArrayChildren ? arrayItems : null,
                          })}
                        </div>
                      );
                    } else if (!choiceGroupData?.isExclusive && choiceGroupData && childSchemaNode?.compositorType === 'choice') {
                      // For repeatable choices, render each occurrence with its own choice dropdown
                      return (
                        <div key={`repeatable-choice-array-${childElementName}-${index}`}>
                          {effectiveChildInstanceData.map((child, itemIndex) => {
                            const rowPath = [...path, childElementName, String(itemIndex)];
                            const rowPathKey = rowPath.join('.');
                            const rowCollapsedKey = `__collapsed__:${rowPathKey}`;
                            const isRowExpanded = expandedPaths.has(rowPathKey);
                            const isRowCollapsed = expandedPaths.has(rowCollapsedKey);
                            const shouldShowChildren = !isRowCollapsed && isRowExpanded;

                            const childElement = matchingParsedChildren[itemIndex] || parseXmlElement(child, childElementName) || {
                              tagName: childElementName,
                              text: typeof child === 'string' ? child : '',
                              children: typeof child === 'object' && child !== null && !Array.isArray(child)
                                ? Object.entries(child)
                                    .filter(([key]) => !key.startsWith('@') && !key.startsWith('_') && key !== '__childrenInOrder')
                                    .map(([key, val]) => ({
                                      tagName: key,
                                      text: typeof val === 'string' ? val : '',
                                      children: [],
                                      attributes: [],
                                    }))
                                : [],
                              attributes: (child?.['@attributes'] && typeof child['@attributes'] === 'object')
                                ? Object.entries(child['@attributes']).map(([name, value]) => ({
                                    name,
                                    value: String(value || ''),
                                  }))
                                : [],
                            };

                            return (
                              <div key={`repeatable-choice-${childElementName}-${itemIndex}`}>
                                {renderRepeatableChoiceSelector({
                                  choiceGroupData,
                                  childElementName,
                                  rowPath,
                                  itemIndex,
                                  onChangeType: (newElementType) => {
                                    onUpdateValue(path, (current) => applyRepeatableChoiceSwitch(current, childElementName, itemIndex, newElementType));
                                  },
                                })}

                                {(() => {
                                  const displayName = getChoiceDisplayName(child);
                                  return displayName ? (
                                      <span
                                        data-testid="xml-name-chip"
                                        style={{
                                          marginLeft: 4,
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
                                        {displayName}
                                      </span>
                                    ) : null;
                                })()}

                                {(() => {
                                  const canRemove = canRemoveChildOccurrence(childElementName, childSchemaNode);
                                  const arrayLength = Array.isArray(effectiveChildInstanceData) ? effectiveChildInstanceData.length : 0;
                                  const minOccurs = getChildMinOccurs(childSchemaNode);
                                  const canRemoveThisOne = canRemove && (arrayLength > minOccurs);

                                  return (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button
                                          onClick={() => {
                                            if (!canRemoveThisOne) return;
                                            onUpdateValue(path, (current) => {
                                              const updated = { ...current };
                                              const key = resolveInstanceChildKey(updated, childElementName) ?? childElementName;
                                              if (Array.isArray(updated[key])) {
                                                updated[key].splice(itemIndex, 1);
                                                if (updated[key].length === 0) {
                                                  delete updated[key];
                                                } else if (updated[key].length === 1) {
                                                  updated[key] = updated[key][0];
                                                }
                                              }
                                              return updated;
                                            });
                                          }}
                                          className={styles.removeButton}
                                          style={{
                                            marginLeft: 4,
                                            opacity: canRemoveThisOne ? 1 : 0.5,
                                            color: canRemoveThisOne ? '#ef4444' : '#999',
                                            cursor: canRemoveThisOne ? 'pointer' : 'not-allowed',
                                          }}
                                          disabled={!canRemoveThisOne}
                                          title={canRemoveThisOne ? `Remove ${childElementName}` : `Cannot remove - schema constraint`}
                                          aria-label={`Remove ${childElementName}`}
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {canRemoveThisOne
                                          ? `Remove ${childElementName}`
                                          : `Cannot remove - schema constraint (minOccurs=${minOccurs})`}
                                      </TooltipContent>
                                    </Tooltip>
                                  );
                                })()}

                                {shouldShowChildren && (
                                  <div style={{ marginLeft: '20px' }}>
                                    <XmlElementNode
                                      element={childElement}
                                      path={rowPath}
                                      expandedPaths={expandedPaths}
                                      onToggleExpand={onToggleExpand}
                                      value={child}
                                      onChange={onChange}
                                      onUpdateValue={onUpdateValue}
                                      rootSchema={rootSchema}
                                      referencedElementNames={referencedElementNames}
                                      autoExpandAll={true}
                                      schemaNode={childSchemaNode}
                                      compiledSchema={compiledSchema}
                                      isSchemaForm={isSchemaForm}
                                      suppressElementLabel={true}
                                      suppressExpander={true}
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    }
                    
                    return <div key={`array-${childElementName}-${index}`}>{arrayItems}</div>;
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
                    // Only render with choice dropdown if this element is actually marked as choice type
                    if (choiceGroupData?.isExclusive && choiceGroupData.selectedOption === childElementName && childSchemaNode?.compositorType === 'choice') {
                      const choicePath = [...path, childElementName];

                      return (
                        <div key={`choice-exclusive-${childElementName}-${index}`}>
                          {renderExclusiveChoiceSelector({
                            choiceGroupData,
                            choicePath,
                            showExpander: false,
                            children: (
                              <>
                                {renderSchemaTextInput(
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
                                  childElementName,
                                  `xml-element-${sanitize(childElementName)}-input`,
                                )}
                              </>
                            ),
                          })}
                        </div>
                      );
                    }
                    
                    return (
                      <div key={`simple-${childElementName}-${index}`}
                        data-field-type={childSchemaNode?.elementType || elementType}
                        data-layout-group={fieldGroups[[...path, childElementName].join('.')] ?? fieldGroups[childElementName]}
                        style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <label style={{ minWidth: 100, fontSize: 14, fontWeight: 500, color: '#a78bfa' }}>
                          {childElementName}:
                        </label>
                        {renderSchemaTextInput(
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
                          childElementName,
                          `xml-element-${sanitize(childElementName)}-input`,
                        )}
                        {canRemoveChildOccurrence(childElementName, childSchemaNode) && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => removeChildOccurrence(childElementName, childSchemaNode)}
                                className={styles.removeButton}
                                title={`Remove ${childElementName}`}
                                aria-label={`Remove ${childElementName}`}
                              >
                                <Trash2 size={14} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>{`Remove ${childElementName}`}</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    );
                  } else if (elementToRender) {
                    // Render complex child elements as expandable nodes
                    
                    if (choiceGroupData && choiceGroupData.selectedOption === childElementName) {
                      const selectedChoiceData = resolveInstanceChildData(childElementName, element?.tagName, value, path.length === 0);
                      const activeChoiceLabel = getChoiceDisplayName(selectedChoiceData);

                      return (
                        <XmlElementNode
                          key={`choice-${childElementName}-${index}`}
                          element={elementToRender}
                          path={[...path, childElementName]}
                          expandedPaths={expandedPaths}
                          onToggleExpand={onToggleExpand}
                          value={effectiveChildInstanceData}
                          onChange={onChange}
                          onUpdateValue={onUpdateValue}
                          rootSchema={rootSchema}
                          referencedElementNames={referencedElementNames}
                          autoExpandAll={true}
                          schemaNode={childSchemaNode}
                          compiledSchema={compiledSchema}
                          initialAutoExpandPathsRef={initialAutoExpandPathsRef}
                          autoExpandCaptureActiveRef={autoExpandCaptureActiveRef}
                          isSchemaForm={isSchemaForm}
                          headerLabel={(
                            <>
                              <select
                                aria-label={`Select ${elementToRender.tagName} type`}
                                value={choiceGroupData.selectedOption || ''}
                                onChange={(event) => {
                                  const newSelectedOption = event.target.value;
                                  if (newSelectedOption === choiceGroupData.selectedOption) return;
                                  onUpdateValue(path, (current) => applyExclusiveChoiceSwitch(current, choiceGroupData, newSelectedOption));
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
                                {choiceGroupData.options.map((option) => (
                                  <option key={option.name} value={option.name}>
                                    {option.name}:
                                  </option>
                                ))}
                              </select>
                              {activeChoiceLabel && (
                                <span
                                  data-testid="xml-name-chip"
                                  style={{
                                    color: '#155e75',
                                    backgroundColor: '#ecfeff',
                                    border: '1px solid #a5f3fc',
                                    borderRadius: 999,
                                    padding: '1px 8px',
                                    fontSize: 11,
                                    fontWeight: 600,
                                    lineHeight: 1.6,
                                    whiteSpace: 'nowrap',
                                    flexShrink: 0,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                  }}
                                >
                                  {activeChoiceLabel}
                                </span>
                              )}
                            </>
                          )}
                          headerAction={canRemoveChoiceSelection(choiceGroupData) ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => removeChoiceSelection(choiceGroupData, [...path, childElementName])}
                                  className={styles.removeButton}
                                  title={`Remove ${childElementName}`}
                                  aria-label={`Remove ${childElementName}`}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>{`Remove ${childElementName}`}</TooltipContent>
                            </Tooltip>
                          ) : null}
                        />
                      );
                    }
                    
                    return (
                      <div key={`element-${childElementName}-${index}`}>
                        <XmlElementNode
                          element={elementToRender}
                          path={[...path, childElementName]}
                          expandedPaths={expandedPaths}
                          onToggleExpand={onToggleExpand}
                          value={effectiveChildInstanceData}
                          onChange={onChange}
                          onUpdateValue={onUpdateValue}
                          rootSchema={rootSchema}
                          referencedElementNames={referencedElementNames}
                          autoExpandAll={autoExpandAll}
                          schemaNode={childSchemaNode}
                          compiledSchema={compiledSchema}
                          initialAutoExpandPathsRef={initialAutoExpandPathsRef}
                          autoExpandCaptureActiveRef={autoExpandCaptureActiveRef}
                          isSchemaForm={isSchemaForm}
                          headerAction={canRemoveChildOccurrence(childElementName, childSchemaNode) ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => removeChildOccurrence(childElementName, childSchemaNode)}
                                  className={styles.removeButton}
                                  title={`Remove ${childElementName}`}
                                  aria-label={`Remove ${childElementName}`}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>{`Remove ${childElementName}`}</TooltipContent>
                            </Tooltip>
                          ) : null}
                        />
                      </div>
                    );
                  }
                  
                  return null;
                })}</AutoFormFields>
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

                const childData = resolveInstanceChildData(child.tagName, elementTagName, value, path.length === 0);
                const occurrenceIndex = elementChildren.slice(0, rawIndex).filter(
                  sibling => typeof sibling !== 'string' && sibling.tagName === child.tagName,
                ).length;
                const childPath = [...path, child.tagName, ...(Array.isArray(childData) ? [String(occurrenceIndex)] : [])];
                const childValue = Array.isArray(childData) ? childData[occurrenceIndex] : childData;
                const removeSchemaChild = () => onUpdateValue(path, current => {
                  const updated = { ...current };
                  const key = resolveInstanceChildKey(updated, child.tagName) ?? child.tagName;
                  const existing = updated[key];
                  if (Array.isArray(existing)) {
                    const remaining = existing.filter((_, index) => index !== occurrenceIndex);
                    if (remaining.length === 0) delete updated[key];
                    else updated[key] = remaining.length === 1 ? remaining[0] : remaining;
                  } else {
                    delete updated[key];
                  }
                  return updated;
                });
                
                // Check if this child element is simple (no nested elements/attributes, only text)
                // However, for container elements (restriction, union, list, simpleType, complexType, sequence, choice, etc.),
                // always render as full nodes, not text inputs
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
                      {renderSchemaTextInput(
                        widgetHint,
                        htmlInputType,
                        child.text || '',
                        (nextValue) => {
                          onUpdateValue(childPath, (current) => {
                            if (current && typeof current === 'object' && !Array.isArray(current)) {
                              const next = { ...current, _text: nextValue };
                              if ('#text' in next) delete next['#text'];
                              return next;
                            }
                            return { _text: nextValue };
                          });
                        },
                        child.tagName,
                        `xml-element-${sanitize(child.tagName)}-input`,
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={removeSchemaChild}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: 0,
                              color: '#999',
                            }}
                            title={`Remove ${child.tagName}`}
                            aria-label={`Remove ${child.tagName}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{`Remove ${child.tagName}`}</TooltipContent>
                      </Tooltip>
                    </div>
                  );
                }
                
                // Render complex child elements as expandable nodes
                return (
                  <div key={rawIndex} style={{ position: 'relative' }}>
                    <XmlElementNode
                      element={child}
                      path={childPath}
                      expandedPaths={expandedPaths}
                      onToggleExpand={onToggleExpand}
                      value={childValue}
                      onChange={onChange}
                      onUpdateValue={onUpdateValue}
                      rootSchema={rootSchema}
                      referencedElementNames={referencedElementNames}
                      autoExpandAll={autoExpandAll}
                      compiledSchema={compiledSchema}
                      initialAutoExpandPathsRef={initialAutoExpandPathsRef}
                      autoExpandCaptureActiveRef={autoExpandCaptureActiveRef}
                      isSchemaForm={isSchemaForm}
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={removeSchemaChild}
                          className={styles.removeButton}
                          style={{ position: 'absolute', right: 0, top: 8 }}
                          title={`Remove ${child.tagName}`}
                          aria-label={`Remove ${child.tagName}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{`Remove ${child.tagName}`}</TooltipContent>
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
    </XmlNamespacesContext.Provider>
  );
}

function XmlInstanceFormContent({
  schema,
  value,
  onChange,
  path = [],
  rootSchema,
  autoExpandAll = false,
  showRootElementTriggers = true,
  expansionStateKey = 'xml-instance-form-expanded',
}: XmlInstanceFormProps) {
  const inheritedNamespaces = useContext(XmlNamespacesContext);
  const xsdAuthoring = useContext(XsdAuthoringContext);
  const localStorage = useWorkbenchStorage();
  const referencedElementNames = useMemo(
    () => getReferencedElementNames(rootSchema),
    [rootSchema],
  );

  // Debug logging
  useEffect(() => {
    if (rootSchema && Object.keys(rootSchema).length > 0) {
      // Log schema structure for debugging
      const schemaKeys = Object.keys(rootSchema);
      if (schemaKeys.includes('xs:schema') || schemaKeys.includes('schema')) {
        const schemaObj = rootSchema['xs:schema'] || rootSchema['schema'];
        if (schemaObj) {
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
      const stored = localStorage.getItem(expansionStorageKey);
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
  const autoExpandScopeRef = useRef({ expansionStorageKey, autoExpandAll });
  if (
    autoExpandScopeRef.current.expansionStorageKey !== expansionStorageKey ||
    autoExpandScopeRef.current.autoExpandAll !== autoExpandAll
  ) {
    autoExpandScopeRef.current = { expansionStorageKey, autoExpandAll };
    initialAutoExpandPathsRef.current = new Set();
    autoExpandCaptureActiveRef.current = Boolean(autoExpandAll);
  }

  useEffect(() => {
    if (!autoExpandAll) {
      autoExpandCaptureActiveRef.current = false;
      return;
    }

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
      localStorage.setItem(expansionStorageKey, JSON.stringify(Array.from(next)));
    } catch {
      // Ignore storage failures.
    }
  }, [expandedPaths, expansionStorageKey, path]);

  // Detect if value is wrapped (e.g., { person: {...} } or { 'xs:schema': {...} }).
  // Ignore namespace declarations and other metadata so wrapped XML schema roots
  // are still recognized even when they contain keys like `xmlns:xs`.
  const wrapperKey = useMemo(() => {
    if (!value || typeof value !== 'object') return null;

    const dataKeys = Object.keys(value).filter((k) => {
      if (k.startsWith('@') || k.startsWith('_') || k.startsWith('__')) return false;
      if (k === 'xmlns' || k.startsWith('xmlns:') || k.startsWith('xml:')) return false;
      return true;
    });

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
    return parsed;
  }, [schema, value]);
  const rootNamespaces = readXmlNamespaces(rootElement?.attributes || [], inheritedNamespaces);
  const rootPrefix = rootElement?.tagName.includes(':') ? rootElement.tagName.split(':')[0] : '';
  const isSchemaForm = rootNamespaces[rootPrefix] === XSD_NAMESPACE;

  const xsdRootButtonOrder: TopLevelXsdKind[] = ['element', 'attribute', 'complexType', 'simpleType', 'group', 'attributeGroup', 'notation'];

  const getTopLevelXsdDefinitionKinds = (schemaObject: any): TopLevelXsdKind[] => {
    const rootSchema = (schemaObject && schemaObject['xs:schema'] && typeof schemaObject['xs:schema'] === 'object')
      ? schemaObject['xs:schema']
      : schemaObject;
    if (!rootSchema || typeof rootSchema !== 'object') {
      return ['element', 'attribute', 'complexType', 'simpleType', 'attributeGroup'];
    }

    const discovered = new Set<TopLevelXsdKind>();
    const collectKindFromRef = (refValue: unknown) => {
      if (typeof refValue !== 'string') return;
      const normalized = refValue.replace(/^xs:/, '').replace(/^xsd:/, '');
      if (normalized === 'element' || normalized === 'attribute' || normalized === 'complexType' || normalized === 'simpleType' || normalized === 'group' || normalized === 'attributeGroup' || normalized === 'notation') {
        discovered.add(normalized as TopLevelXsdKind);
      }
    };

    const walkXsdNode = (node: any) => {
      if (!node || typeof node !== 'object') return;
      const attrs = node['@attributes'] || node;
      const nameFromAttrs = typeof attrs?.name === 'string' ? attrs.name : undefined;
      const refFromAttrs = typeof attrs?.ref === 'string' ? attrs.ref : undefined;
      if (nameFromAttrs) {
        const normalized = nameFromAttrs.replace(/^xs:/, '').replace(/^xsd:/, '');
        if (xsdRootButtonOrder.includes(normalized as TopLevelXsdKind)) {
          discovered.add(normalized as TopLevelXsdKind);
        }
      }
      if (refFromAttrs) collectKindFromRef(refFromAttrs);

      for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
          value.forEach((entry) => walkXsdNode(entry));
        } else if (value && typeof value === 'object') {
          walkXsdNode(value);
        }
      }
    };

    const groupNodes = Array.isArray(rootSchema['xs:group']) ? rootSchema['xs:group'] : rootSchema['group'] ? [rootSchema['group']] : [];
    groupNodes.forEach((groupNode) => {
      const attrs = groupNode?.['@attributes'] || groupNode;
      const groupName = typeof attrs?.name === 'string' ? attrs.name : '';
      if (groupName === 'schemaTop' || groupName === 'redefinable') {
        const choices = [] as any[];
        if (groupNode['xs:choice']) choices.push(groupNode['xs:choice']);
        if (groupNode['choice']) choices.push(groupNode['choice']);
        choices.forEach((choice) => {
          walkXsdNode(choice);
        });
      }
    });

    for (const key of Object.keys(rootSchema)) {
      const normalized = key.replace(/^xs:/, '').replace(/^xsd:/, '');
      if (xsdRootButtonOrder.includes(normalized as TopLevelXsdKind)) {
        discovered.add(normalized as TopLevelXsdKind);
      }
    }

    if (discovered.size === 0) {
      return ['element', 'attribute', 'complexType', 'simpleType', 'attributeGroup'];
    }

    return xsdRootButtonOrder.filter((kind) => discovered.has(kind));
  };

  const addTopLevelXsdDefinition = (kind: TopLevelXsdKind) => {
    if (!schema || typeof schema !== 'object') return;

    const nextSchema = JSON.parse(JSON.stringify(schema)) as Record<string, any>;
    const schemaRoot = (nextSchema['xs:schema'] && typeof nextSchema['xs:schema'] === 'object') ? nextSchema['xs:schema'] : nextSchema;
    const keyMap: Record<TopLevelXsdKind, string> = {
      element: 'xs:element',
      attribute: 'xs:attribute',
      complexType: 'xs:complexType',
      simpleType: 'xs:simpleType',
      group: 'xs:group',
      attributeGroup: 'xs:attributeGroup',
      notation: 'xs:notation',
    };
    const collectionKey = keyMap[kind];
    if (!Array.isArray(schemaRoot[collectionKey])) {
      schemaRoot[collectionKey] = [];
    }

    const index = schemaRoot[collectionKey].length;
    if (kind === 'element') {
      schemaRoot[collectionKey].push({ '@attributes': { name: `element${index + 1}`, type: 'xs:string' } });
    } else if (kind === 'attribute') {
      schemaRoot[collectionKey].push({ '@attributes': { name: `attribute${index + 1}`, type: 'xs:string' } });
    } else if (kind === 'complexType') {
      schemaRoot[collectionKey].push({ '@attributes': { name: `Type${index + 1}` } });
    } else if (kind === 'simpleType') {
      schemaRoot[collectionKey].push({ '@attributes': { name: `SimpleType${index + 1}` } });
    } else if (kind === 'group') {
      schemaRoot[collectionKey].push({ '@attributes': { name: `Group${index + 1}` } });
    } else if (kind === 'attributeGroup') {
      schemaRoot[collectionKey].push({ '@attributes': { name: `AttributeGroup${index + 1}` } });
    } else {
      schemaRoot[collectionKey].push({ '@attributes': { name: `Notation${index + 1}` } });
    }

    onChange(nextSchema['xs:schema'] ? nextSchema : schemaRoot);
  };

  const topLevelXsdAddKinds = useMemo(() => {
    const xsdForRootDefinitions = rootSchema && typeof rootSchema === 'object' ? rootSchema : schema;
    if (!xsdForRootDefinitions || typeof xsdForRootDefinitions !== 'object') {
      return ['element', 'attribute', 'complexType', 'simpleType', 'attributeGroup'];
    }
    return getTopLevelXsdDefinitionKinds(xsdForRootDefinitions);
  }, [rootSchema, schema]);

  const topLevelXsdAddButtons: Array<{ kind: TopLevelXsdKind; label: string }> = (
    [
      { kind: 'element' as const, label: 'Add Element' },
      { kind: 'attribute' as const, label: 'Add Attribute' },
      { kind: 'complexType' as const, label: 'Add ComplexType' },
      { kind: 'simpleType' as const, label: 'Add SimpleType' },
      { kind: 'group' as const, label: 'Add Group' },
      { kind: 'attributeGroup' as const, label: 'Add AttributeGroup' },
      { kind: 'notation' as const, label: 'Add Notation' },
    ] as const
  ).filter(({ kind }) => topLevelXsdAddKinds.includes(kind));

  // Compile the schema for efficient type lookups (replaces fiddly manual searching)
  const compiledSchema = useMemo(() => {
    if (!rootSchema && !schema) return undefined;
    try {
      // Use schema parameter first (which is XMLSchema.xsd in Schema Form mode),
      // fall back to rootSchema for backward compatibility with Instance Form mode
      const schemaToCompile = schema || rootSchema;
      // Unwrap the schema if it's wrapped with xs:schema key
      const unwrappedSchema = schemaToCompile['xs:schema'] || schemaToCompile['schema'] || schemaToCompile;
      const compiled = compileSchemaForWalking(unwrappedSchema);
      
      // Debug for schema element
      if (rootElement?.tagName === 'xs:schema' || rootElement?.tagName?.endsWith(':schema')) {
        const schemaElem = compiled.getElement('schema') || compiled.getElement('xs:schema');
      }
      
      return compiled;
    } catch (e) {
      console.warn('[XmlInstanceForm] Schema compilation failed:', e);
      return undefined;
    }
  }, [schema, rootSchema, rootElement?.tagName]);

  // Compute schema node tree using schema walker
  // This provides structured schema information for rendering
  // Walk the ACTUAL ROOT ELEMENT definition, not xs:schema
  const schemaNode = useMemo(() => {
    if (!rootElement || !compiledSchema) {
      if (rootElement?.tagName === 'xs:schema' || rootElement?.tagName?.endsWith(':schema')) {
      }
      return undefined;
    }
    
    try {
      // Get the element definition directly from compiled schema
      const elementDef = compiledSchema.getElement(rootElement.tagName);
      if (rootElement?.tagName === 'xs:schema' || rootElement?.tagName?.endsWith(':schema')) {
      }
      if (!elementDef) {
        if (rootElement?.tagName === 'xs:schema' || rootElement?.tagName?.endsWith(':schema')) {
        }
        return undefined;
      }
      
      // Extract the type from the element definition
      const attrs = elementDef['@attributes'] || elementDef;
      let typeName = attrs?.type;
      const localName = rootElement.tagName.includes(':')
        ? rootElement.tagName.split(':')[1]
        : rootElement.tagName;
      const inlineTypeDefinition =
        elementDef['xs:complexType'] ||
        elementDef['complexType'] ||
        elementDef['xs:simpleType'] ||
        elementDef['simpleType'];
      const substitutionHead = typeof attrs?.substitutionGroup === 'string'
        ? compiledSchema.getElement(attrs.substitutionGroup)
        : undefined;
      const headInlineTypeDefinition = substitutionHead?.['xs:complexType']
        || substitutionHead?.complexType
        || substitutionHead?.['xs:simpleType']
        || substitutionHead?.simpleType;
      const effectiveInlineTypeDefinition = inlineTypeDefinition || headInlineTypeDefinition;
      
      // If no explicit type, check for synthetic type (e.g., "schema__type" for xs:schema)
      if (!typeName && localName === 'schema') {
        const syntheticTypeName = `${localName}__type`;
        // Try to get the synthetic type from compiledSchema
        const syntheticType = compiledSchema.getType?.(syntheticTypeName);
        if (syntheticType) {
          typeName = syntheticTypeName;
        }
      }

      // Global elements may declare an anonymous complexType instead of a named type.
      // Keep the inline definition so the walker can expand its sequence/choice and attributes.
      if (!typeName) {
        if (effectiveInlineTypeDefinition) {
          typeName = `inline:${localName}`;
        }
      }
      
      if (!typeName) {
        if (rootElement?.tagName === 'xs:schema' || rootElement?.tagName?.endsWith(':schema')) {
        }
        return undefined;
      }
      
      // Walk the type to get its schema node structure
      const walkingSchema = schema || rootSchema;
      const walked = walkSchema(compiledSchema, {
        rootSchema: getSchemaRootNode(walkingSchema) || walkingSchema,
        compiledSchema,
        visitedTypes: new Set(),
        typeName,
        inlineTypeDefinition: effectiveInlineTypeDefinition,
        depth: 0,
        maxDepth: 2,
        path: [],
      });
      
      if (rootElement?.tagName === 'xs:schema' || rootElement?.tagName?.endsWith(':schema')) {
      }
      
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
    setExpandedPaths((currentExpanded) => {
      const newExpanded = new Set(currentExpanded);
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

      return newExpanded;
    });
  };

  // Update nested value at path
  // If value is wrapped (e.g., {person: {...}}), adjust path to account for wrapper
  const handleUpdateValue = (pathArray: string[], updateFn: (v: any) => any) => {
    const current = value || schema;
    if (!current || typeof current !== 'object') return;

    // Deep clone the current value.
    const updated = JSON.parse(JSON.stringify(current));
    const commit = (nextValue: any) => {
      if (!isSchemaForm) {
        qualifyInsertedInstanceChildren(nextValue, current, rootSchema || schema, {}, Boolean(wrapperKey), schemaNode);
      }
      synchronizeXmlChildOrder(nextValue);
      onChange(nextValue);
    };

    // For wrapped roots such as { 'xs:schema': { ... } }, operate on the inner
    // schema payload directly while preserving the wrapper object structure.
    const updateTarget = wrapperKey && updated[wrapperKey] && typeof updated[wrapperKey] === 'object'
      ? updated[wrapperKey]
      : updated;

    // Empty path means update the root payload itself.
    if (pathArray.length === 0) {
      const result = updateFn(updateTarget);
      if (wrapperKey && updated[wrapperKey] && typeof updated[wrapperKey] === 'object') {
        updated[wrapperKey] = result;
        commit(updated);
      } else {
        commit(result);
      }
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

    let target: any = updateTarget;
    for (let i = 0; i < pathArray.length - 1; i++) {
      const segment = pathArray[i];
      const nextSegment = pathArray[i + 1];
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
        const key = resolveInstanceChildKey(target, segment) ?? segment;
        if (target[key] === undefined) {
          target[key] = nextIsIndex ? [] : {};
        }
        target = target[key];
      }
    }

    // Apply the update function at the last path segment.
    const lastSegment = pathArray[pathArray.length - 1];
    const lastIsIndex = /^\d+$/.test(lastSegment);

    if (Array.isArray(target)) {
      if (!lastIsIndex) return;
      const index = Number.parseInt(lastSegment, 10);
      if (!Number.isFinite(index) || index < 0) return;
      const nextValue = updateFn(target[index]);
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
              commit(updated);
              return;
            }
            remaining -= entry.length;
          } else {
            if (remaining === 0) {
              target[key] = updateFn(entry);
              commit(updated);
              return;
            }
            remaining -= 1;
          }
        }
        return;
      }

      const key = resolveInstanceChildKey(target, lastSegment) ?? lastSegment;
      const nextValue = updateFn(target[key]);
      target[key] = nextValue;
    }
    commit(updated);
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
        rootSchema={rootSchema}
        showRootElementTriggers={showRootElementTriggers}
        referencedElementNames={referencedElementNames}
        autoExpandAll={autoExpandAll}
        schemaNode={schemaNode}
        compiledSchema={compiledSchema}
        initialAutoExpandPathsRef={initialAutoExpandPathsRef}
        autoExpandCaptureActiveRef={autoExpandCaptureActiveRef}
        isSchemaForm={isSchemaForm}
        rootXsdAddButtons={xsdAuthoring && isSchemaForm ? topLevelXsdAddButtons : undefined}
        onAddTopLevelXsdDefinition={addTopLevelXsdDefinition}
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
