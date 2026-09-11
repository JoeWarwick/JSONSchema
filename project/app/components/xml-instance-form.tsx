import { useState, useEffect, useMemo, useRef } from "react";
import styles from "./xml-instance-form.module.css";
import { Trash2, ChevronDown, ChevronRight, Plus } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip/tooltip";
import { XmlNodeRhsEditor as XmlInstanceNodeRhsEditor } from './xml-instance-rhs-editors';
import {
  renderCountryInput,
  renderLanguageInput,
  normalizeColorInputValue,
  renderSimpleValueInput,
} from './xml-instance-value-input';
import { 
  walkSchema, 
  compileSchemaForWalking,
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
  getSchemaRootNode,
  getXmlInstanceExpansionStorageKey,
  normalizeXmlName,
  restoreChoiceDataFromStorage,
  saveChoiceDataToStorage,
  toArray,
} from './xml-instance-form.utils';

export function XmlInstanceForm(props: XmlInstanceFormProps) {
  return <XmlInstanceFormContent {...props} />;
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
  rootXsdAddButtons,
  onAddTopLevelXsdDefinition,
  suppressElementLabel = false,
  suppressExpander = false,
}: XmlElementNodeProps) {
  const pathKey = path.join('.');
  if (autoExpandAll && autoExpandCaptureActiveRef?.current) {
    initialAutoExpandPathsRef?.current.add(pathKey);
  }

  const collapsedKey = `__collapsed__:${pathKey}`;
  const initiallyExpanded = Boolean(autoExpandAll && initialAutoExpandPathsRef?.current.has(pathKey));
  const explicitlyExpanded = expandedPaths.has(pathKey);
  const explicitlyCollapsed = expandedPaths.has(collapsedKey);
  const expanded = explicitlyExpanded || (autoExpandAll && isSchemaForm && path.length === 0 && !explicitlyCollapsed) || (initiallyExpanded && !explicitlyCollapsed);
  const elementTagName = typeof element.tagName === 'string' ? element.tagName : '';
  const localTagName = elementTagName.replace(/^.*:/, '');
  
  // DEBUG: Always log for first few renders to verify component is running
  console.log(`[XmlElementNode START] element="${elementTagName}" path.len=${path.length}`);
  if (element.tagName === 'xs:schema' || localTagName === 'schema') {
    console.log(`[XmlElementNode] *** SCHEMA ELEMENT *** tagName="${elementTagName}" localTagName="${localTagName}" schemaNode.children=${schemaNode?.children?.length}`);
  }
  
  // Debug: Log schemaNode for simpleType and restriction nodes
  if (isSchemaForm && (localTagName === 'simpleType' || localTagName === 'restriction')) {
    console.log(`[XmlElementNode] ${localTagName} - schemaNode:`, {
      tagName: schemaNode?.tagName,
      label: schemaNode?.label,
      hasEnumerations: !!schemaNode?.enumerations,
      enumerationCount: schemaNode?.enumerations?.length || 0,
      enumerations: schemaNode?.enumerations,
      childrenCount: schemaNode?.children?.length || 0,
    });
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
    
    const childrenWithCompositorInfo = schemaNode.children.map(c => ({
      name: c.label || c.tagName || '',
      compositorType: c.compositorType,
      minOccurs: c.minOccurs,
      maxOccurs: c.maxOccurs,
    }));
    
    if (element?.tagName === 'xs:schema') {
      console.log(`[ChoiceGroups] xs:schema has ${schemaNode.children.length} children:`, childrenWithCompositorInfo);
      console.log(`[ChoiceGroups] schemaNode.children raw:`, schemaNode.children);
    }
    
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
    
    if (element?.tagName === 'xs:schema') {
      console.log(`[ChoiceGroups] Found ${groups.length} choice groups for xs:schema with ${groups.reduce((sum, g) => sum + g.options.length, 0)} total options`);
    }
    
    return groups;
  }, [schemaNode?.children, element?.tagName]);
  
  // For each choice group, determine the selected option
  const choiceInfo = useMemo(() => {
    return choiceGroups.map(group => {
      const choiceKey = `choice_${pathKey}_${group.groupIndex}`;
      
      const optionStates = group.options.map((opt) => {
        const optionData = compiledSchema
          ? compiledSchema.resolveChildData(
              opt.name,
              element?.tagName,
              value,
              path.length === 0
            )
          : value?.[opt.name];
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
      const isExclusive = !hasRepeatableOption && presentOptionCount <= 1;
      const isChoiceGroupRequired = group.options.some((opt) => {
        const min = Number(opt.node.minOccurs ?? 0);
        return Number.isFinite(min) && min > 0;
      });
      
      // Determine selected option by checking which element has a value in the data
      if (isExclusive) {
        // For exclusive choices, find which option exists in the data
        for (const option of optionStates) {
          if (option.hasValue) {
            selectedOption = option.name;
            break;
          }
        }
        // If no value found, only default when the choice is required by schema
        if (!selectedOption && !isSchemaForm && isChoiceGroupRequired && group.options.length > 0) {
          selectedOption = group.options[0].name;
        }
      }
      
      return {
        groupIndex: group.groupIndex,
        options: group.options,
        selectedOption,
        isRequired: isChoiceGroupRequired,
        choiceKey,
        isExclusive,
      };
    });
  }, [choiceGroups, pathKey, value, compiledSchema, element?.tagName, path.length, isSchemaForm]);

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
  
  // Debug: Show element.attributes for schema elements
  if (isSchemaForm) {
    const attrDetails = elementAttributes.map(a => {
      const valStr = typeof a.value === 'string' ? a.value.substring(0, 40) : String(a.value).substring(0, 40);
      return `${a.name}="${valStr}${(String(a.value).length || 0) > 40 ? '...' : ''}"`;
    }).join(', ');
    console.log('[ELEMENT ATTRS]', element?.tagName, '- count:', elementAttributes.length, 'details:', attrDetails);
  }
  const elementText = typeof element.text === 'string' ? element.text : '';

  const visibleChildren = elementChildren
    .map((child, rawIndex) => ({ child, rawIndex }))
    .filter(({ child }) => !shouldHideChildInInferredView(child));

  const hasChildren = visibleChildren.length > 0;
  const hasAttributes = elementAttributes.length > 0;
  const hasSchemaChildren = (schemaNode?.children?.length || 0) > 0;
  const hasSchemaAttributes = (schemaNode?.attributes?.length || 0) > 0;
  const isSchemaCompositorTag = (tagName: string) => ['xs:sequence', 'sequence', 'xs:choice', 'choice', 'xs:all', 'all'].includes(tagName);
  const isSchemaRestrictionTag = (tagName: string) => ['xs:restriction', 'restriction'].includes(tagName);
  const compactAddLabel = (label: string): string => label.replace(/^Add\s+/i, '').trim();
  const currentNodeCompositorAddOptions = isSchemaForm && isSchemaCompositorTag(elementTagName)
    ? [{ name: 'xs:element', label: 'Add xs:element', maxOccurs: Number.POSITIVE_INFINITY, minOccurs: 0 }]
    : [];
  const currentNodeRestrictionFacetAddOptions = isSchemaForm && isSchemaRestrictionTag(elementTagName)
    ? [
        { name: 'xs:enumeration', label: 'Add xs:enumeration', maxOccurs: Number.POSITIVE_INFINITY, minOccurs: 0 },
        { name: 'xs:length', label: 'Add xs:length', maxOccurs: 1, minOccurs: 0 },
        { name: 'xs:minLength', label: 'Add xs:minLength', maxOccurs: 1, minOccurs: 0 },
        { name: 'xs:maxLength', label: 'Add xs:maxLength', maxOccurs: 1, minOccurs: 0 },
        { name: 'xs:pattern', label: 'Add xs:pattern', maxOccurs: 1, minOccurs: 0 },
      ]
    : [];
  const hasExpandableContent = hasChildren || hasAttributes || hasSchemaChildren || hasSchemaAttributes || currentNodeCompositorAddOptions.length > 0 || currentNodeRestrictionFacetAddOptions.length > 0;
  const hasText = elementText.length > 0;
  const isCompositor = !!element.isCompositor;
  const nodeNameAttribute = elementAttributes.find((a) => a.name === 'name')?.value 
    || schemaNode?.attributes?.find((a) => a.name === 'name')?.default;
  
  // Debug: Log @name attribute discovery for schema elements
  if (isSchemaForm) {
    console.log('[NAME BADGE DEBUG]', element?.tagName, ':', {
      nodeNameAttribute,
      elementAttributesCount: elementAttributes.length,
      elementAttributeNames: elementAttributes.map(a => a.name),
      schemaNodeAttributesCount: schemaNode?.attributes?.length || 0,
      schemaNodeAttributeNames: schemaNode?.attributes?.map(a => a.name) || [],
    });
  }
  
  const rootTopLevelKinds = new Set(
    (rootXsdAddButtons || []).map(({ kind }) => String(kind || '').toLowerCase())
  );
  // Show @name attribute in schema form only (instance form uses element tag name as identifier)
  const schemaNodeName = isSchemaForm && typeof nodeNameAttribute === 'string' && nodeNameAttribute.trim().length > 0
    ? nodeNameAttribute.trim()
    : null;
  
  // Debug: Log when @name badge should render
  if (isSchemaForm) {
    console.log('[NAME BADGE RENDER]', element?.tagName, '- schemaNodeName:', schemaNodeName, 'isSchemaForm:', isSchemaForm, 'nodeNameAttribute:', nodeNameAttribute);
  }
  
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

    onUpdateValue(path, (current) => {
      const updated = asMutableElementObject(current);

      // Enforce choice semantics by clearing sibling options when selecting a different branch.
      if (choiceGroupData?.isExclusive) {
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
    // choiceKey: string;
  }, choicePath: string[]) => {
    const selected = choiceGroupData.selectedOption;
    if (!selected) return;

    onUpdateValue(choicePath.slice(0, -1), (current) => {
      const updated = { ...(current || {}) };
      delete updated[selected];

      if (Array.isArray(updated['__childrenInOrder'])) {
        updated['__childrenInOrder'] = (updated['__childrenInOrder'] as any[]).filter(
          (item) => item?.tagName !== selected
        );
      }

      return updated;
    });
  };

  const inferChoiceDisplayName = (choiceNode: any): string | undefined => {
    if (!choiceNode || typeof choiceNode !== 'object') {
      return undefined;
    }

    if (Array.isArray(choiceNode)) {
      for (const item of choiceNode) {
        const inferred = inferChoiceDisplayName(item);
        if (inferred) return inferred;
      }
      return undefined;
    }

    const attributes = choiceNode['@attributes'];
    if (attributes && typeof attributes === 'object' && !Array.isArray(attributes)) {
      const attributeName = attributes.name ?? attributes['@name'];
      if (typeof attributeName === 'string' && attributeName.trim().length > 0) {
        return attributeName.trim();
      }
    }

    if (typeof choiceNode.name === 'string' && choiceNode.name.trim().length > 0) {
      return choiceNode.name.trim();
    }

    if (typeof choiceNode['@name'] === 'string' && choiceNode['@name'].trim().length > 0) {
      return choiceNode['@name'].trim();
    }

    for (const key of Object.keys(choiceNode)) {
      if (key.startsWith('@') || key.startsWith('_') || key === 'nodeName') continue;
      const inferred = inferChoiceDisplayName(choiceNode[key]);
      if (inferred) return inferred;
    }

    return undefined;
  };

  const ensureChoiceSelectionLabel = (choiceNode: any, optionName: string) => {
    const inferredName = inferChoiceDisplayName(choiceNode);

    if (!choiceNode || typeof choiceNode !== 'object' || Array.isArray(choiceNode)) {
      return isSchemaForm
        ? { '@attributes': { name: inferredName || optionName } }
        : { _text: '' };
    }

    const nextNode = { ...choiceNode };
    if (!isSchemaForm) {
      if (nextNode['@attributes'] && typeof nextNode['@attributes'] === 'object') {
        const nextAttributes = { ...nextNode['@attributes'] };
        delete nextAttributes.name;
        if (Object.keys(nextAttributes).length > 0) {
          nextNode['@attributes'] = nextAttributes;
        } else {
          delete nextNode['@attributes'];
        }
      }
      return nextNode;
    }

    const nextAttributes = {
      ...(nextNode['@attributes'] && typeof nextNode['@attributes'] === 'object' && !Array.isArray(nextNode['@attributes'])
        ? nextNode['@attributes']
        : {}),
    };

    if (!nextAttributes.name) {
      nextAttributes.name = inferredName || optionName;
    }

    nextNode['@attributes'] = nextAttributes;
    return nextNode;
  };

  const applyExclusiveChoiceSwitch = (
    current: any,
    choiceGroupData: { selectedOption: string | null; options: Array<{ name: string; node: SchemaNode }> },
    newSelectedOption: string,
  ) => {
    const updated = { ...(current || {}) };
    const currentlySelectedOption = choiceGroupData.selectedOption || (() => {
      for (const opt of choiceGroupData.options) {
        if (updated[opt.name] !== undefined) {
          return opt.name;
        }
      }
      return null;
    })();

    for (const opt of choiceGroupData.options) {
      if (opt.name !== newSelectedOption) {
        if (updated[opt.name] !== undefined) {
          saveChoiceDataToStorage(value, path, opt.name, updated[opt.name]);
        }
        delete updated[opt.name];
      }
    }

    if (!updated[newSelectedOption]) {
      const restored = restoreChoiceDataFromStorage(value, path, newSelectedOption);
      const previousName = currentlySelectedOption
        ? current?.[currentlySelectedOption]?.['@attributes']?.name
          ?? current?.[currentlySelectedOption]?.name
          ?? current?.[currentlySelectedOption]?.['@name']
        : undefined;
      const previousSelection = isSchemaForm && previousName
        ? { '@attributes': { name: previousName } }
        : undefined;
      updated[newSelectedOption] = ensureChoiceSelectionLabel(
        restored || previousSelection || { _text: '' },
        newSelectedOption,
      );
    } else {
      updated[newSelectedOption] = ensureChoiceSelectionLabel(updated[newSelectedOption], newSelectedOption);
    }

    if (Array.isArray(updated['__childrenInOrder'])) {
      const childrenOrder = updated['__childrenInOrder'] as any[];
      updated['__childrenInOrder'] = childrenOrder.map((item: any) => {
        if (item?.tagName === currentlySelectedOption) {
          return { ...item, tagName: newSelectedOption };
        }
        return item;
      });
    }

    return updated;
  };

  const applyRepeatingChoiceSwitch = (
    current: any,
    currentOption: string,
    newSelectedOption: string,
    selectedValue: any,
  ) => {
    const updated = { ...(current || {}) };
    const childrenOrder = Array.isArray(updated['__childrenInOrder'])
      ? updated['__childrenInOrder'] as any[]
      : [];
    const serializedSelectedValue = JSON.stringify(selectedValue);
    let selectedIndex = childrenOrder.findIndex((item) => (
      item?.tagName === currentOption
      && JSON.stringify(item?.value) === serializedSelectedValue
    ));
    if (selectedIndex < 0) {
      selectedIndex = childrenOrder.findIndex((item) => item?.tagName === currentOption);
    }
    if (selectedIndex < 0) return updated;

    const replacementValue = ensureChoiceSelectionLabel(selectedValue, newSelectedOption);
    const nextChildrenOrder = childrenOrder.map((item, index) => (
      index === selectedIndex
        ? { ...item, tagName: newSelectedOption, value: replacementValue }
        : item
    ));

    const orderedChildNames = new Set(
      nextChildrenOrder
        .map((item) => item?.tagName)
        .filter((tagName): tagName is string => typeof tagName === 'string' && tagName.length > 0),
    );
    const choiceChildNames = new Set(
      choiceGroups.flatMap((group) => group.options.map((option) => option.name)),
    );
    for (const childName of new Set([...orderedChildNames, ...choiceChildNames])) {
      delete updated[childName];
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

  const renderExclusiveChoiceSelector = ({
    choiceGroupData,
    choicePath,
    children,
    showExpander = true,
  }: {
    choiceGroupData: {
      selectedOption: string | null;
      options: Array<{ name: string; node: SchemaNode }>;
      isRequired: boolean;
    };
    choicePath: string[];
    children?: React.ReactNode;
    showExpander?: boolean;
  }) => {
    const showChoiceRemove = canRemoveChoiceSelection(choiceGroupData);
    const selectorPathKey = choicePath.join('.');
    const collapsedKey = `__collapsed__:${selectorPathKey}`;
    const isExpanded = expandedPaths.has(selectorPathKey);
    const isCollapsed = expandedPaths.has(collapsedKey);
    const shouldShowChildren = !isCollapsed && (isExpanded || !isSchemaForm);
    const selectedChoiceData = isSchemaForm && choiceGroupData.selectedOption
      ? compiledSchema?.resolveChildData(choiceGroupData.selectedOption, element?.tagName, value, path.length === 0)
      : null;
    const activeChoiceLabel = selectedChoiceData
      ? (selectedChoiceData['@attributes']?.name
        ?? selectedChoiceData.name
        ?? selectedChoiceData['@name']
        ?? choiceGroupData.selectedOption)
      : null;

    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 8, width: 'auto', maxWidth: '100%' }}>
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
            console.log('[choice-select-change]', { newSelectedOption, currentChoice: choiceGroupData.selectedOption, choicePath });
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

        {children}

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
    itemIndexOrValue: number | any,
    newElementType: string,
  ) => {
    const updated = { ...(current || {}) };
    const oldValues = Array.isArray(updated[childElementName])
      ? [...updated[childElementName]]
      : updated[childElementName] === undefined
        ? []
        : [updated[childElementName]];
    const itemIndex = typeof itemIndexOrValue === 'number'
      ? itemIndexOrValue
      : oldValues.findIndex((value) => JSON.stringify(value) === JSON.stringify(itemIndexOrValue));
    const oldData = oldValues[itemIndex];
    if (oldData === undefined) return updated;

    const childrenOrder = Array.isArray(updated['__childrenInOrder'])
      ? updated['__childrenInOrder'] as any[]
      : [];
    const selectedOrderIndexes = childrenOrder
      .map((item, index) => item?.tagName === childElementName ? index : -1)
      .filter((index) => index >= 0);
    const selectedOrderIndex = selectedOrderIndexes[itemIndex];

    if (selectedOrderIndex < 0) return updated;

    const replacementValue = ensureChoiceSelectionLabel(oldData, newElementType);
    const switchedChildrenOrder = childrenOrder.map((item, index) => (
      index === selectedOrderIndex
        ? { ...item, tagName: newElementType, value: replacementValue }
        : item
    ));
    const singletonMetadataNames = new Set(['annotation', 'import', 'include', 'redefine']);
    const seenMetadata = new Set<string>();
    const nextChildrenOrder = switchedChildrenOrder.filter((item) => {
      const localName = String(item?.tagName || '').replace(/^.*:/, '').toLowerCase();
      if (!singletonMetadataNames.has(localName)) return true;
      const identity = `${localName}:${JSON.stringify(item?.value)}`;
      if (seenMetadata.has(identity)) return false;
      seenMetadata.add(identity);
      return true;
    });

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
      delete updated[childName];
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
    const shouldShowChildren = !isRowCollapsed && (isRowExpanded || !isSchemaForm);

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
        </div>
        )}
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
          {(() => {
            const cond1 = hasChildren;
            const cond2 = hasSchemaChildren;
            const cond3 = path.length === 0 && isSchemaForm && rootXsdAddButtons && rootXsdAddButtons.length > 0;
            const cond4 = isSchemaForm && (currentNodeCompositorAddOptions.length > 0 || currentNodeRestrictionFacetAddOptions.length > 0);
            const shouldRender = cond1 || cond2 || cond3 || cond4;
            const isSchema = element?.tagName === 'xs:schema' || element?.tagName?.endsWith(':schema');
            if (isSchema || path.length === 0) {
              console.log(`[ChildrenSection] ${element?.tagName} (path.len=${path.length}): hasChildren=${cond1}, hasSchemaChildren=${cond2}, rootXsd=${cond3}, compositorOrFacet=${cond4}, overall=${shouldRender}`);
            }
            return shouldRender;
          })() && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                {isSchemaForm || !hasInferredEditor ? (
                  <div className={styles.elementTriggerRow} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    {path.length === 0 && isSchemaForm && rootXsdAddButtons && rootXsdAddButtons.length > 0 && rootXsdAddButtons.map(({ kind, label }) => (
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
                    {currentNodeCompositorAddOptions.concat(currentNodeRestrictionFacetAddOptions).map((trigger) => (
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
                      return schemaNode.children.map((childSchemaNode, triggerIndex) => {
                      const childElementName = childSchemaNode.label || childSchemaNode.tagName || `child-${triggerIndex}`;
                      const normalizedChildLocal = String(childElementName).replace(/^.*:/, '').toLowerCase();
                      if (renderedTriggerNames.has(normalizedChildLocal)) return null;
                      renderedTriggerNames.add(normalizedChildLocal);
                      const shouldSkipDuplicateRootTrigger =
                        isSchemaForm &&
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
                      });
                    })() : null}
                  </div>
                ) : null}
              </div>
              {/* Walk the compiled schema structure, use instance data for values */}
              {(() => {
                console.log(`[XmlElementNode] DEBUG: Rendering children section, schemaNode=${!!schemaNode}, schemaNode.children=${schemaNode?.children?.length}`);
                const keys = value ? Object.keys(value).filter(k => !k.startsWith('@')) : [];
                const actualValue = value ? JSON.stringify(value).substring(0, 100) : 'null';
                const firstKey = keys.length > 0 ? keys[0] : 'none';
                const elementChildrenCount = element?.children?.length || 0;
                console.log(`[XmlElementNode] schemaNode for ${element?.tagName}: firstKey=${firstKey}, elementChildren=${elementChildrenCount}, allKeys=[${keys.join(', ')}], valuePreview=${actualValue}`);
                if (element?.tagName === 'xs:schema') {
                  console.log(`[XmlElementNode] xs:schema children condition check: schemaNode=${!!schemaNode}, schemaNode.children=${schemaNode?.children?.length}, choiceGroups=${choiceGroups.length}, choiceInfo=${choiceInfo.length}`);
                }
                return null;
              })()}
              

              
              {(schemaNode?.children && schemaNode.children.length > 0) || (schemaNode?.enumerations && schemaNode.enumerations.length > 0) ? (
                (() => {
                  // Safeguard: ensure schemaNode and children exist
                  if (!schemaNode || (!schemaNode.children || schemaNode.children.length === 0) && (!schemaNode.enumerations || schemaNode.enumerations.length === 0)) {
                    return [];
                  }
                  
                  // Check if we have a repeating choice specifically for xs:schema with XMLSchema.xsd
                  // Only apply instance-driven rendering for xs:schema elements, not general elements
                  const isXmlSchemaElement = element?.tagName === 'xs:schema';
                  // IMPORTANT: For xs:schema (meta-schema elements), ALWAYS use schema-driven rendering
                  // to show the schema structure defined by XMLSchema.xsd, not instance data.
                  // Instance-driven rendering is only for regular element types with repeating choices.
                  const hasRepeatableChoice = false; // Disabled for xs:schema - always use schema-driven rendering
                  
                  if (hasRepeatableChoice && value) {
                    // Repeating choice: render instance data as rows (xs:schema only)
                    // First unwrap xs:schema if needed (when value is wrapped with xs:schema key)
                    let schemaData = value;
                    if (element?.tagName === 'xs:schema' && value['xs:schema']) {
                      schemaData = value['xs:schema'];
                    }
                    
                    // Build array of instance children from value object
                    const instanceChildren: any[] = [];
                    for (const [key, val] of Object.entries(schemaData)) {
                      // Skip metadata/internal keys and empty values
                      if (!key.startsWith('@') && 
                          !key.startsWith('_') && 
                          key !== '#text' && 
                          val !== undefined && 
                          val !== null) {
                        if (Array.isArray(val)) {
                          for (const item of val) {
                            instanceChildren.push({
                              tagName: key,
                              data: item,
                            });
                          }
                        } else {
                          instanceChildren.push({
                            tagName: key,
                            data: val,
                          });
                        }
                      }
                    }
                    
                    return instanceChildren
                      .map((instanceChild: any, index: number) => ({
                        childElement: instanceChild.data,
                        childSchemaNode: null,
                        index,
                        instanceDriven: true,
                        childElementName: instanceChild.tagName,
                      }));
                  } else {
                    // Schema-driven rendering (default for all non-repeating-choice elements)
                    const localTagName = (schemaNode.tagName || '').replace(/^xs:/, '').toLowerCase();
                    if (isSchemaForm) {
                      console.log('[SCHEMA DRIVEN]', localTagName, 'schemaNode.children.length:', schemaNode.children?.length);
                    }
                    const filtered = schemaNode.children
                      .map((childSchemaNode, index) => ({ childSchemaNode, index, instanceDriven: false }))
                      .filter(({ childSchemaNode }) => {
                        // For xs:schema: prefer direct (non-choice) elements over choice duplicates
                        const childElementName = childSchemaNode.label || childSchemaNode.tagName;
                        const childLocalName = String(childElementName).replace(/^.*:/, '').toLowerCase();

                        // The XMLSchema meta-schema declares xs:schema recursively. In the
                        // Schema Form, that declaration is the type definition for the
                        // document root, not another document node to render.
                        if (isSchemaForm && isXmlSchemaElement && childLocalName === 'schema') {
                          return false;
                        }
                        
                        // Skip choice elements if there's a non-choice version of the same element
                        if (childSchemaNode.compositorType === 'choice' && isXmlSchemaElement) {
                          const hasNonChoiceVersion = schemaNode.children.some(
                            child => child.compositorType !== 'choice' && 
                                     (child.label || child.tagName) === childElementName
                          );
                          if (hasNonChoiceVersion) {
                            return false; // Skip this choice element, use the non-choice version instead
                          }
                          
                          // For choice elements without a non-choice duplicate: only show if they have data or are required
                          const count = getChildOccurrenceCount(value, childElementName);
                          const minOccurs = getChildMinOccurs(childSchemaNode);
                          return count > 0 || minOccurs > 0;
                        }
                        
                        // For non-choice elements in xs:schema: always show them (they're preferred over choice duplicates)
                        if (isXmlSchemaElement && childSchemaNode.compositorType !== 'choice') {
                          return true;
                        }
                        
                        // Standard filtering for non-repeating choice or non-choice children
                        if (childSchemaNode.compositorType === 'choice') {
                          for (const choice of choiceInfo) {
                            const matchingOption = choice.options.find(opt => opt.name === childElementName);
                            if (matchingOption) {
                              if (!choice.isExclusive) {
                                return true;
                              }
                              return choice.selectedOption === childElementName;
                            }
                          }
                        }
                        return true;
                      });
                    
                    if (isSchemaForm) {
                      console.log(`[FILTERED CHILDREN] node=${localTagName}, count=${filtered.length}, children:`, filtered.map(f => f.childSchemaNode.label || f.childSchemaNode.tagName));
                    }

                    const finalFiltered: any[] = [];
                    for (const item of filtered) {
                      finalFiltered.push(item);
                    }

                    if (isSchemaForm && value && typeof value === 'object' && !Array.isArray(value)) {
                      const existingSchemaNames = new Set(
                        finalFiltered
                          .map((entry: any) => entry?.childSchemaNode?.label || entry?.childSchemaNode?.tagName)
                          .filter((name: unknown): name is string => typeof name === 'string' && name.length > 0)
                          .map((name) => name.replace(/^.*:/, '').toLowerCase())
                      );

                      const valueForInstanceChildren =
                        path.length === 0 &&
                        Object.prototype.hasOwnProperty.call(value, element?.tagName || '') &&
                        value[element?.tagName || ''] &&
                        typeof value[element?.tagName || ''] === 'object' &&
                        !Array.isArray(value[element?.tagName || ''])
                          ? value[element?.tagName || '']
                          : value;

                      const instanceChildrenInOrder = Array.isArray((valueForInstanceChildren as any)['__childrenInOrder'])
                        ? (valueForInstanceChildren as any)['__childrenInOrder'] as Array<{ tagName?: string; value?: any }>
                        : [];

                      const instanceChildEntries = instanceChildrenInOrder.length > 0
                        ? instanceChildrenInOrder
                            .map((entry) => {
                              const tagName = typeof entry?.tagName === 'string' ? entry.tagName : '';
                              if (!tagName) return null;
                              const childValue = (entry as any).value !== undefined
                                ? (entry as any).value
                                : (valueForInstanceChildren as any)[tagName];
                              return { tagName, childValue };
                            })
                            .filter((entry): entry is { tagName: string; childValue: any } => Boolean(entry))
                        : Object.entries(valueForInstanceChildren as Record<string, any>)
                            .filter(([key]) => !key.startsWith('@') && !key.startsWith('_') && key !== '__childrenInOrder')
                            .map(([tagName, childValue]) => ({ tagName, childValue }));

                      const hasInstanceEnumerations = instanceChildEntries.some(({ tagName }) =>
                        tagName.replace(/^.*:/, '').toLowerCase() === 'enumeration'
                      );

                      if (hasInstanceEnumerations) {
                        for (let i = finalFiltered.length - 1; i >= 0; i -= 1) {
                          const schemaTagName = String(finalFiltered[i]?.childSchemaNode?.tagName || '').replace(/^.*:/, '').toLowerCase();
                          if (schemaTagName === 'enumeration' && !finalFiltered[i]?.instanceDriven) {
                            finalFiltered.splice(i, 1);
                          }
                        }
                        existingSchemaNames.delete('xs:enumeration');
                        existingSchemaNames.delete('enumeration');
                      }

                      for (const { tagName, childValue } of instanceChildEntries) {
                        const localTagName = tagName.replace(/^.*:/, '').toLowerCase();
                        const isEnumerationTag = localTagName === 'enumeration';
                        const normalizedTagName = tagName.replace(/^.*:/, '').toLowerCase();
                        if (!tagName || (existingSchemaNames.has(normalizedTagName) && !isEnumerationTag)) continue;

                        if (Array.isArray(childValue)) {
                          for (const item of childValue) {
                            finalFiltered.push({
                              childElement: item,
                              childSchemaNode: null,
                              index: finalFiltered.length,
                              instanceDriven: true,
                              childElementName: tagName,
                            });
                          }
                        } else {
                          finalFiltered.push({
                            childElement: childValue,
                            childSchemaNode: null,
                            index: finalFiltered.length,
                            instanceDriven: true,
                            childElementName: tagName,
                          });
                        }
                      }
                    }

                    return finalFiltered;
                  }
                })()
                
                  .map(({ childElement, childSchemaNode, index, instanceDriven, childElementName: providedName }: any) => {
                  // Get the element name
                  let childElementName = '';
                  let childInstanceData: any = null;
                  
                  if (instanceDriven && childElement) {
                    // Instance-driven (repeating choice): use provided name and instance child
                    childElementName = providedName || '';
                    childInstanceData = childElement;
                  } else if (childSchemaNode) {
                    // Schema-driven: use schema node
                    childElementName = childSchemaNode.label || childSchemaNode.tagName || '';
                    // Resolve instance data from schema node name
                    if (compiledSchema) {
                      childInstanceData = compiledSchema.resolveChildData(
                        childElementName,
                        element?.tagName,
                        value,
                        path.length === 0
                      );
                    } else {
                      childInstanceData = value?.[childElementName];
                    }

                    if (
                      isSchemaForm &&
                      (childInstanceData === undefined || childInstanceData === null) &&
                      value &&
                      typeof value === 'object' &&
                      !Array.isArray(value)
                    ) {
                      const currentValue = value as Record<string, any>;
                      const localChildName = childElementName.replace(/^.*:/, '');
                      const namespaceMatchKey = Object.keys(currentValue).find((key) => {
                        if (key === childElementName || key === localChildName) return true;
                        return key.replace(/^.*:/, '') === localChildName;
                      });

                      if (namespaceMatchKey) {
                        childInstanceData = currentValue[namespaceMatchKey];
                      }
                    }

                    if (isSchemaForm && path.length === 0 && value && typeof value === 'object') {
                      const rootValue = value[element?.tagName || ''] && typeof value[element?.tagName || ''] === 'object'
                        ? value[element?.tagName || '']
                        : value;
                      const singletonMetadataNames = new Set(['annotation', 'import', 'include', 'redefine']);
                      const childLocalName = childElementName.replace(/^.*:/, '').toLowerCase();
                      const orderedEntries = Array.isArray(rootValue?.__childrenInOrder)
                        ? rootValue.__childrenInOrder.filter((entry: any) => (
                            String(entry?.tagName || '').replace(/^.*:/, '').toLowerCase() === childLocalName
                          ))
                        : [];
                      if (singletonMetadataNames.has(childLocalName) && orderedEntries.length === 1) {
                        childInstanceData = orderedEntries[0].value;
                      }
                    }

                  }
                  
                  if (!childElementName) return null;
                  
                  // Debug: Log all choice lookups in non-schema forms
                  if (!isSchemaForm && choiceGroups.length > 0) {
                    console.log('[CHOICE DEBUG] Element:', element?.tagName, 'child:', childElementName, 'choiceGroups.length:', choiceGroups.length);
                  }
                  
                  // Find the actual child element from DOM for instance-driven rendering
                  const childElement_: any = instanceDriven 
                    ? childElement
                    : element?.children?.find(child => 
                        typeof child !== 'string' && 
                        (child.tagName === childElementName || 
                         child.tagName?.replace(/^.*:/, '') === childElementName)
                      );
                  
                  const choiceGroupInfo = getChoiceGroupForChild(childElementName);
                  const choiceGroupIndex = choiceGroupInfo?.groupIndex ?? -1;
                  
                  // Debug: Log choice group lookup in non-schema forms
                  if (!isSchemaForm && choiceGroupIndex >= 0) {
                    console.log('[CHOICE DEBUG] Element:', element?.tagName, '- child:', childElementName, 'in choice group:', choiceGroupIndex);
                  }
                  
                  let choiceGroupData = null;
                  if (choiceGroupIndex >= 0) {
                    choiceGroupData = choiceInfo[choiceGroupIndex];
                    
                    // Debug: Log final choice group data in non-schema forms
                    if (!isSchemaForm) {
                      console.log('[CHOICE DEBUG] choiceGroupData:', {
                        childElementName,
                        selectedOption: choiceGroupData?.selectedOption,
                        options: choiceGroupData?.options?.map(o => o.name),
                        isExclusive: choiceGroupData?.isExclusive,
                      });
                    }
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
                      : (isSelectedChoiceOption && selectedChoiceIsRequired && !isSchemaForm ? { _text: '' } : childInstanceData);

                  // In schema form, prefer editable instance data when present so we do not
                  // lose real child rows (e.g. restriction/enumeration) to walking-metadata stubs.
                  // Outside schema form, keep the existing element-first behavior.
                  let elementToRender = (isSchemaForm && effectiveChildInstanceData !== undefined && effectiveChildInstanceData !== null)
                    ? effectiveChildInstanceData
                    : (childElement_ || effectiveChildInstanceData);
                  if (
                    isSchemaForm &&
                    effectiveChildInstanceData &&
                    typeof effectiveChildInstanceData === 'object' &&
                    !Array.isArray(effectiveChildInstanceData) &&
                    typeof (effectiveChildInstanceData as any).tagName !== 'string'
                  ) {
                    elementToRender = parseXmlElement(effectiveChildInstanceData, childElementName) || elementToRender;
                  }
                  if (!elementToRender && isSchemaForm && choiceGroupData && !choiceGroupData.isExclusive) {
                    elementToRender = { '@attributes': {} }; // Synthetic element for schema form choice
                  }
                  // For schema form facet and container elements without data, create synthetic element so they render as expandable nodes.
                  const isFacetOrContainer = ['xs:enumeration', 'enumeration', 'xs:length', 'length', 'xs:minLength', 'minLength',
                    'xs:maxLength', 'maxLength', 'xs:pattern', 'pattern', 'xs:whiteSpace', 'whiteSpace',
                    'xs:minInclusive', 'minInclusive', 'xs:maxInclusive', 'maxInclusive',
                    'xs:minExclusive', 'minExclusive', 'xs:maxExclusive', 'maxExclusive',
                    'xs:fractionDigits', 'fractionDigits', 'xs:totalDigits', 'totalDigits',
                    'xs:restriction', 'restriction', 'xs:union', 'union', 'xs:list', 'list',
                    'xs:simpleType', 'simpleType', 'xs:complexType', 'complexType',
                    'xs:sequence', 'sequence', 'xs:choice', 'choice', 'xs:all', 'all',
                    'xs:group', 'group', 'xs:attributeGroup', 'attributeGroup'].includes(childElementName);
                  if (!elementToRender && isSchemaForm && isFacetOrContainer) {
                    elementToRender = { '@attributes': {} }; // Synthetic element for facet/container elements
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
                          if (k !== '@attributes' || isSchemaForm) return false;
                          const attributes = (effectiveChildInstanceData as any)['@attributes'];
                          return attributes && typeof attributes === 'object' && Object.keys(attributes).every((name) => name === 'name');
                        })
                      )
                    )
                  );
                  
                  // Don't treat container or facet elements as simple text inputs
                  // Containers: restriction, union, list, simpleType, complexType, sequence, choice, all, group, attributeGroup
                  // Facets: enumeration, length, pattern, etc.
                  const isContainerElement = ['xs:restriction', 'restriction', 'xs:union', 'union', 'xs:list', 'list',
                    'xs:simpleType', 'simpleType', 'xs:complexType', 'complexType',
                    'xs:sequence', 'sequence', 'xs:choice', 'choice', 'xs:all', 'all',
                    'xs:group', 'group', 'xs:attributeGroup', 'attributeGroup'].includes(childElementName);
                  
                  const isFacetElement = ['xs:enumeration', 'enumeration', 'xs:length', 'length', 'xs:minLength', 'minLength', 
                    'xs:maxLength', 'maxLength', 'xs:pattern', 'pattern', 'xs:whiteSpace', 'whiteSpace',
                    'xs:minInclusive', 'minInclusive', 'xs:maxInclusive', 'maxInclusive', 
                    'xs:minExclusive', 'minExclusive', 'xs:maxExclusive', 'maxExclusive',
                    'xs:fractionDigits', 'fractionDigits', 'xs:totalDigits', 'totalDigits'].includes(childElementName);
                  
                  const isSimpleChild = !isContainerElement && !isFacetElement && schemaSaysSimple && schemaHasNoAttrs && (parsedElementIsSimple || instanceValueIsTextOnly);
                  
                  // Debug: Log what we're about to render for schema form
                  if (isSchemaForm) {
                    console.log('[CHILD RENDER]', childElementName, '- isArray:', Array.isArray(effectiveChildInstanceData), 'isSimple:', isSimpleChild, 'hasElementToRender:', !!elementToRender);
                  }
                  
                  // For choice group elements, log and continue to normal rendering
                  // We want all choice members to render as individual expandable nodes
                  // Only render with choice dropdown if this element is actually marked as choice type
                  if (choiceGroupData && !choiceGroupData.isExclusive && childSchemaNode?.compositorType === 'choice') {
                    console.log('[REPEATING CHOICE SCHEMA]', childElementName, '- choiceKey:', choiceGroupData.choiceKey);
                    
                    // For non-array choice children, render as single choice item
                    if (!Array.isArray(effectiveChildInstanceData) && elementToRender) {
                      console.log('[NON-ARRAY CHOICE]', childElementName, '- rendering as choice item');
                      const rowPath = [...path, childElementName];
                      const rowPathKey = rowPath.join('.');
                      const rowCollapsedKey = `__collapsed__:${rowPathKey}`;
                      const isRowExpanded = expandedPaths.has(rowPathKey);
                      const isRowCollapsed = expandedPaths.has(rowCollapsedKey);
                      const shouldShowChildren = !isRowCollapsed && (isRowExpanded || !isSchemaForm);
                      
                      // Extract @name attribute for display from element's attributes
                      const elementNameAttr = elementToRender?.['@attributes']?.name
                        ?? elementToRender?.attributes?.find((attribute: XmlAttribute) => attribute.name === 'name')?.value;
                      const displayName = isSchemaForm && typeof elementNameAttr === 'string' && elementNameAttr.trim().length > 0
                        ? elementNameAttr.trim()
                        : null;
                      
                      return (
                        <div key={`choice-non-array-${childElementName}-${index}`} style={{ display: 'inline-flex', width: 'auto', maxWidth: '100%' }}>
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
                              onChange={(e) => {
                                const newElementType = e.target.value;
                                if (newElementType === childElementName) return;
                                onUpdateValue(path, (current) => choiceGroupData.isExclusive
                                  ? applyExclusiveChoiceSwitch(current, choiceGroupData, newElementType)
                                  : applyRepeatingChoiceSwitch(current, childElementName, newElementType, effectiveChildInstanceData));
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
                            <div style={{ marginLeft: '20px' }}>
                              <XmlElementNode
                                element={elementToRender}
                                path={rowPath}
                                expandedPaths={expandedPaths}
                                onToggleExpand={onToggleExpand}
                                value={effectiveChildInstanceData}
                                onChange={onChange}
                                onUpdateValue={onUpdateValue}
                                rootSchema={rootSchema}
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
                    }
                    // Don't return early - continue to normal rendering below for arrays
                  }
                  
                  // Handle both single and multiple occurrences
                  if (Array.isArray(effectiveChildInstanceData)) {
                    const childMinOccurs = getChildMinOccurs(childSchemaNode);
                    if (isSchemaForm) {
                      console.log('[ARRAY BRANCH]', childElementName, '- arrayLength:', effectiveChildInstanceData.length, 'childMinOccurs:', childMinOccurs);
                    }
                    // Render each array element
                    // For choice groups, show the dropdown before the first element
                    const arrayItems = effectiveChildInstanceData.map((child, arrayIndex) => (
                      <div key={`${childElementName}-${arrayIndex}`} style={{ position: 'relative' }}>
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
                    ));
                    
                    // If this element is the currently selected option in a choice group, wrap array items with choice dropdown
                    // For exclusive choices: show one dropdown for all occurrences
                    // For repeatable choices: show dropdown for each occurrence
                    if (isSchemaForm) {
                      console.log('[ARRAY CHOICE CHECK]', childElementName, '- choiceGroupData:', !!choiceGroupData, 'isExclusive:', choiceGroupData?.isExclusive, 'selectedOption:', choiceGroupData?.selectedOption);
                    }
                    if (choiceGroupData?.isExclusive && choiceGroupData.selectedOption === childElementName && childSchemaNode?.compositorType === 'choice') {
                      // Setup expansion tracking for exclusive choice array
                      const choiceArrayPath = [...path, childElementName];
                      const choiceArrayPathKey = choiceArrayPath.join('.');
                      const choiceArrayCollapsedKey = `__collapsed__:${choiceArrayPathKey}`;
                      const isChoiceArrayExpanded = expandedPaths.has(choiceArrayPathKey);
                      const isChoiceArrayCollapsed = expandedPaths.has(choiceArrayCollapsedKey);
                      const shouldShowChoiceArrayChildren = !isChoiceArrayCollapsed && (isChoiceArrayExpanded || !isSchemaForm);
                      
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
                            const shouldShowChildren = !isRowCollapsed && (isRowExpanded || !isSchemaForm);

                            const childElement = {
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
                                  const instanceNameAttr = child?.['@attributes']?.name;
                                  const displayName = isSchemaForm && typeof instanceNameAttr === 'string' && instanceNameAttr.trim().length > 0
                                    ? instanceNameAttr.trim()
                                    : null;
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
                                              if (Array.isArray(updated[childElementName])) {
                                                updated[childElementName].splice(itemIndex, 1);
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
                    
                    if (isSchemaForm) {
                      console.log('[RETURN ARRAY ITEMS]', childElementName, '- arrayItems count:', arrayItems.length);
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
                              </>
                            ),
                          })}
                        </div>
                      );
                    }
                    
                    return (
                      <div key={`simple-${childElementName}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                    if (isSchemaForm) {
                      console.log('[ABOUT TO RENDER XmlElementNode]', childElementName, '- key:', index, 'elementToRender:', elementToRender, 'childSchemaNode:', childSchemaNode);
                    }
                    
                    if (choiceGroupData && choiceGroupData.selectedOption === childElementName) {
                      const complexChoicePath = [...path, childElementName];
                      const complexChoicePathKey = complexChoicePath.join('.');
                      const complexChoiceCollapsedKey = `__collapsed__:${complexChoicePathKey}`;
                      const isComplexChoiceExpanded = expandedPaths.has(complexChoicePathKey);
                      const isComplexChoiceCollapsed = expandedPaths.has(complexChoiceCollapsedKey);
                      const shouldShowComplexChoiceChildren = !isComplexChoiceCollapsed && (isComplexChoiceExpanded || !isSchemaForm);

                      return (
                        <div key={`choice-${childElementName}-${index}`}>
                          {renderExclusiveChoiceSelector({
                            choiceGroupData,
                            choicePath: complexChoicePath,
                            showExpander: true,
                            children: shouldShowComplexChoiceChildren ? (
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
                                  autoExpandAll={true}
                                  schemaNode={childSchemaNode}
                                  compiledSchema={compiledSchema}
                                  initialAutoExpandPathsRef={initialAutoExpandPathsRef}
                                  autoExpandCaptureActiveRef={autoExpandCaptureActiveRef}
                                  isSchemaForm={isSchemaForm}
                                />
                              </div>
                            ) : null,
                          })}
                        </div>
                      );
                    }
                    
                    return (
                      <div key={`element-${childElementName}-${index}`} style={{ position: 'relative' }}>
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
                  }
                  
                  if (isSchemaForm) {
                    console.log('[NO RENDER PATH]', childElementName, '- isArray:', Array.isArray(effectiveChildInstanceData), 'isSimple:', isSimpleChild, 'hasElementToRender:', !!elementToRender, 'isFacetOrContainer:', isFacetOrContainer, 'childSchemaNode:', childSchemaNode);
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
                // However, for container elements (restriction, union, list, simpleType, complexType, sequence, choice, etc.),
                // always render as full nodes, not text inputs
                const isContainerParent = ['xs:restriction', 'restriction', 'xs:union', 'union', 'xs:list', 'list',
                  'xs:simpleType', 'simpleType', 'xs:complexType', 'complexType',
                  'xs:sequence', 'sequence', 'xs:choice', 'choice', 'xs:all', 'all',
                  'xs:group', 'group', 'xs:attributeGroup', 'attributeGroup'].includes(elementTagName);
                const isSimpleChild = !isContainerParent && child.children.length === 0 && child.attributes.length === 0;
                
                if (isContainerParent && isSchemaForm) {
                  console.log(`[Container parent child] tagName=${child.tagName}, children=${child.children.length}, attrs=${child.attributes.length}, text="${(child.text || '').substring(0, 30)}"`);
                }
                
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

          {/* Render enumeration facets directly if this simpleType has a restriction with enumerations */}
          {isSchemaForm && localTagName === 'simpleType' && (
            (() => {
              console.log(`[SIMPLETYPE CHECK] schemaNode.schemaObj:`, schemaNode?.schemaObj);
              const schemaFormValue = value && typeof value === 'object' && !Array.isArray(value)
                ? value
                : null;
              const simpleTypeDef = schemaFormValue;
              if (!simpleTypeDef || typeof simpleTypeDef !== 'object') {
                console.log('[SIMPLETYPE] No simpleType value found');
                return null;
              }
              const restriction = simpleTypeDef['xs:restriction'] || simpleTypeDef['restriction'];
              if (!restriction) {
                return null;
              }
              
              const enums = restriction['xs:enumeration'] || restriction['enumeration'];
              if (!enums) {
                return null;
              }
              
              const enumArray = Array.isArray(enums) ? enums : [enums];
              const enumerationValues = enumArray.map((e: any) => {
                const attrs = e['@attributes'] || e;
                return attrs?.value || (typeof attrs === 'string' ? attrs : '');
              }).filter((v: string) => v);

              if (enumerationValues.length > 0) {
                console.log(`[SIMPLETYPE ENUMS] Found ${enumerationValues.length} enumerations:`, enumerationValues);
                return (
                  <div style={{ marginTop: 12, paddingLeft: 20, backgroundColor: '#f0f8ff', border: '1px solid #4da6ff', padding: '8px' }}>
                    <div style={{ fontSize: 12, color: '#0047b2', marginBottom: 8, textTransform: 'uppercase', fontWeight: 'bold' }}>
                      ✓ Enumeration Values:
                    </div>
                    {enumerationValues.map((enumValue: string, idx: number) => {
                      const enumPath = [...path, 'xs:restriction', `enum-${idx}`];
                      const enumPathKey = enumPath.join('.');
                      const isEnumExpanded = expandedPaths.has(enumPathKey);
                      
                      return (
                        <div key={`enum-${idx}`} style={{ marginBottom: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <button
                              type="button"
                              onClick={() => onToggleExpand(enumPath)}
                              style={{
                                padding: '2px 6px',
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                display: 'flex',
                                fontSize: 12,
                                color: '#666',
                              }}
                            >
                              {isEnumExpanded ? '▼' : '▶'}
                            </button>
                            <span style={{ fontSize: 12, fontWeight: 500, color: '#a78bfa', minWidth: 140 }}>
                              xs:enumeration
                            </span>
                            <span style={{ fontSize: 12, color: '#0047b2', fontFamily: 'monospace', backgroundColor: '#e6f2ff', padding: '2px 6px', borderRadius: 3 }}>
                              value = "{enumValue}"
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              }
              return null;
            })()
          )}

          {/* Render enumeration facets directly if this is a restriction element with enumerations from parent simpleType */}
          {isSchemaForm && (localTagName === 'restriction' || localTagName === 'xs:restriction') && (
            <div style={{ marginTop: 12 }}>
              {(() => {
                const values = new Set<string>();

                const extractEnumValue = (entry: any): string | null => {
                  if (!entry) return null;

                  if (typeof entry === 'string') {
                    const trimmed = entry.trim();
                    return trimmed.length > 0 ? trimmed : null;
                  }

                  const attrsObj = entry?.['@attributes'] && typeof entry['@attributes'] === 'object'
                    ? entry['@attributes']
                    : null;
                  if (attrsObj?.value) return String(attrsObj.value);

                  if (entry?.attributes && Array.isArray(entry.attributes)) {
                    const valueAttr = entry.attributes.find((attr: any) => attr?.name === 'value');
                    if (valueAttr?.value !== undefined && valueAttr?.value !== null) {
                      return String(valueAttr.value);
                    }
                  }

                  if (entry?.attributes && typeof entry.attributes === 'object' && entry.attributes.value !== undefined) {
                    return String(entry.attributes.value);
                  }

                  if (entry?.value !== undefined && entry?.value !== null) return String(entry.value);
                  return null;
                };

                const children = Array.isArray((element as any)?.children) ? (element as any).children : [];
                for (const child of children) {
                  const tag = String((child as any)?.tagName || '').toLowerCase();
                  if (!tag.includes('enumeration')) continue;
                  const enumValue = extractEnumValue(child);
                  if (enumValue) values.add(enumValue);
                }

                const directValueObj = value && typeof value === 'object' && !Array.isArray(value)
                  ? value as Record<string, any>
                  : null;
                const valueObj = directValueObj;

                if (valueObj) {
                  const valueEnums = valueObj['xs:enumeration'] ?? valueObj['enumeration'];
                  const valueEnumArray = Array.isArray(valueEnums) ? valueEnums : (valueEnums ? [valueEnums] : []);
                  for (const entry of valueEnumArray) {
                    const enumValue = extractEnumValue(entry);
                    if (enumValue) values.add(enumValue);
                  }

                  const ordered = Array.isArray(valueObj['__childrenInOrder']) ? valueObj['__childrenInOrder'] : [];
                  for (const entry of ordered) {
                    const tagName = String((entry as any)?.tagName || '').toLowerCase();
                    if (!tagName.includes('enumeration')) continue;
                    const enumValue = extractEnumValue((entry as any).value);
                    if (enumValue) values.add(enumValue);
                  }
                }

                const enumerationValues = Array.from(values);

                if (enumerationValues.length > 0) {
                  return (
                    <div style={{ marginTop: 12 }}>
                      {enumerationValues.map((enumValue: string, idx: number) => {
                        return (
                          <div key={`enum-${idx}`} style={{ 
                            padding: '8px', 
                            backgroundColor: '#f0f0f0', 
                            marginBottom: 8,
                            borderRadius: 4,
                            fontSize: 12
                          }}>
                            <strong>xs:enumeration</strong>: value = "{enumValue}"
                          </div>
                        );
                      })}
                    </div>
                  );
                }
                
                return null;
              })()}
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
    console.log('[XmlInstanceForm] rootElement computed:', {
      tagName: parsed?.tagName,
      childrenCount: parsed?.children?.length || 0,
      valueLength: JSON.stringify(value || {}).length,
    });
    return parsed;
  }, [schema, value]);

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
        console.log('[compiledSchema] For xs:schema element:', {
          rootSchemaExists: !!rootSchema,
          schemaExists: !!schema,
          schemaTargetNamespace: unwrappedSchema?.['@attributes']?.targetNamespace || unwrappedSchema?.targetNamespace,
          schemaElementDefFound: !!schemaElem,
          schemaElementType: schemaElem?.['@attributes']?.type || schemaElem?.type,
        });
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
        console.log('[schemaNode] Missing dependencies for xs:schema:', { rootElement: !!rootElement, compiledSchema: !!compiledSchema });
      }
      return undefined;
    }
    
    try {
      // Get the element definition directly from compiled schema
      const elementDef = compiledSchema.getElement(rootElement.tagName);
      if (rootElement?.tagName === 'xs:schema' || rootElement?.tagName?.endsWith(':schema')) {
        console.log('[schemaNode] Looking for element:', rootElement.tagName, '-> found:', !!elementDef);
      }
      if (!elementDef) {
        if (rootElement?.tagName === 'xs:schema' || rootElement?.tagName?.endsWith(':schema')) {
          console.log('[schemaNode] Element not found in compiled schema:', rootElement.tagName);
        }
        return undefined;
      }
      
      // Extract the type from the element definition
      const attrs = elementDef['@attributes'] || elementDef;
      let typeName = attrs?.type;
      
      // If no explicit type, check for synthetic type (e.g., "schema__type" for xs:schema)
      if (!typeName) {
        const localName = rootElement.tagName.includes(':') 
          ? rootElement.tagName.split(':')[1] 
          : rootElement.tagName;
        const syntheticTypeName = `${localName}__type`;
        // Try to get the synthetic type from compiledSchema
        const syntheticType = compiledSchema.getType?.(syntheticTypeName);
        if (syntheticType) {
          typeName = syntheticTypeName;
        }
      }
      
      if (!typeName) {
        if (rootElement?.tagName === 'xs:schema' || rootElement?.tagName?.endsWith(':schema')) {
          console.log('[schemaNode] No type found for element:', rootElement.tagName);
        }
        return undefined;
      }
      
      // Walk the type to get its schema node structure
      const unwrappedRootSchema = rootSchema ? (rootSchema['xs:schema'] || rootSchema['schema'] || rootSchema) : null;
      const walked = walkSchema(compiledSchema, {
        rootSchema: unwrappedRootSchema || schema,
        compiledSchema,
        visitedTypes: new Set(),
        typeName,
        inlineTypeDefinition: elementDef['xs:complexType'] || elementDef['complexType'] || elementDef['xs:simpleType'] || elementDef['simpleType'],
        depth: 0,
        maxDepth: 50,
        path: [],
      });
      
      if (rootElement?.tagName === 'xs:schema' || rootElement?.tagName?.endsWith(':schema')) {
        console.log('[schemaNode] Schema walked successfully:', {
          tagName: walked?.tagName,
          label: walked?.label,
          nodeType: walked?.nodeType,
          compositorType: walked?.compositorType,
          elementType: walked?.elementType,
          children: walked?.children?.length,
          attributes: walked?.attributes?.length,
          minOccurs: walked?.minOccurs,
          maxOccurs: walked?.maxOccurs,
          childNames: walked?.children?.map(c => c.tagName || c.label),
        });
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

    console.log('[debug-handleUpdateValue-start]', { pathArray, current, wrapperKey });

    // Deep clone the current value.
    const updated = JSON.parse(JSON.stringify(current));

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
        onChange(updated);
      } else {
        onChange(result);
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
        if (target[segment] === undefined) {
          target[segment] = nextIsIndex ? [] : {};
        }
        target = target[segment];
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
        rootXsdAddButtons={isSchemaForm ? topLevelXsdAddButtons : undefined}
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
