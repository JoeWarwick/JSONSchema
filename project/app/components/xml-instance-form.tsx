import { useState, useEffect, useMemo } from "react";
import styles from "./xml-instance-form.module.css";
import { Trash2, ChevronDown, ChevronRight, Plus } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip/tooltip";
import { XmlNodeRhsEditor as XmlInstanceNodeRhsEditor } from './xml-instance-rhs-editors';
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
function clearChoiceDataFromStorage(instanceXml: any, path: string[], optionName: string): void {
  try {
    const key = generateChoiceStorageKey(instanceXml, path, optionName);
    localStorage.removeItem(key);
    console.log(`[ChoiceStorage] Cleared ${optionName} from ${key}`);
  } catch (e) {
    console.warn('[ChoiceStorage] Failed to clear choice data:', e);
  }
}

interface XmlInstanceFormProps {
  schema: any; // The XML element/schema to render
  value: any; // Current XML instance value 
  onChange: (value: any) => void;
  path?: string[];
  rootSchema?: any;
  autoFocus?: boolean;
  autoExpandAll?: boolean; // If true, automatically expand all nested elements
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
function findElementTypeInRootSchema(root: any, elementName: string): string | null {
  if (!root || typeof root !== 'object') {
    if (elementName === 'birthDate' || elementName === 'homeEmail') {
      console.log(`[findElementTypeInRootSchema] root is not object for ${elementName}`);
    }
    return null;
  }

  let found: string | null = null;

  const walk = (node: any, depth = 0) => {
    if (!node || typeof node !== 'object' || found) return;
    
    for (const key of Object.keys(node)) {
      if (found) return; // Exit early if found
      
      const val = node[key];
      if (!val) continue;
      
      // Look for element declarations like { 'xs:element': { '@attributes': { 'name': 'foo', 'type': 'xs:date' } } }
      if (key === 'xs:element' || key === 'element') {
        if (Array.isArray(val)) {
          for (const elem of val) {
            if (elem) {
              // Try both @attributes structure (from XML parser) and direct properties
              const attrs = elem['@attributes'] || elem;
              const elemName = attrs?.name || attrs?.['@name'];
              const elemType = attrs?.type || attrs?.['@type'];
              
              if (elemName === elementName) {
                found = elemType || null;
                if (elementName === 'birthDate' || elementName === 'homeEmail') {
                  console.log(`[findElementTypeInRootSchema] Found ${elementName} in xs:element array, type: ${found}`);
                }
                return;
              }
            }
          }
        } else if (val) {
          // Try both @attributes structure and direct properties
          const attrs = val['@attributes'] || val;
          const elemName = attrs?.name || attrs?.['@name'];
          const elemType = attrs?.type || attrs?.['@type'];
          
          if (elemName === elementName) {
            found = elemType || null;
            if (elementName === 'birthDate' || elementName === 'homeEmail') {
              console.log(`[findElementTypeInRootSchema] Found ${elementName} in xs:element object, type: ${found}`);
            }
            return;
          }
        }
      }
      
      // Recurse into arrays
      if (Array.isArray(val)) {
        for (const item of val) {
          walk(item, depth + 1);
          if (found) return;
        }
      } else if (typeof val === 'object') {
        walk(val, depth + 1);
      }
    }
  };

  walk(root, 0);
  if ((elementName === 'birthDate' || elementName === 'homeEmail') && !found) {
    console.log(`[findElementTypeInRootSchema] NOT FOUND ${elementName}`);
  }
  return found;
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
}) {
  // State for tracking which choice option is selected
  const [selectedChoices, setSelectedChoices] = useState<Record<string, string>>({});
  
  const pathKey = path.join('.');
  const expanded = autoExpandAll || expandedPaths.has(pathKey);
  const localTagName = (element.tagName || '').replace(/^.*:/, '');
  
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
      
      // Check if user has manually selected a choice
      if (selectedChoices[choiceKey]) {
        selectedOption = selectedChoices[choiceKey];
      } else {
        // Otherwise, check if any choice element has a value
        for (const option of group.options) {
          const optionData = value?.[option.name];
          if (optionData !== undefined && optionData !== null) {
            selectedOption = option.name;
            break;
          }
        }
        // If no value found, default to first option
        if (!selectedOption && group.options.length > 0) {
          selectedOption = group.options[0].name;
        }
      }
      
      return {
        groupIndex: group.groupIndex,
        options: group.options,
        selectedOption,
        choiceKey,
      };
    });
  }, [choiceGroups, pathKey, selectedChoices, value]);

  const shouldHideChildInInferredView = (child: XmlElement | string): boolean => {
    if (typeof child === 'string') return false;
    if (!hasInferredEditor) return false;
    if (!['complexType', 'attributeGroup', 'element'].includes(String(inferredSchemaKind))) return false;

    const childLocalTag = (child.tagName || '').replace(/^.*:/, '');
    // These are managed by the badge-based editors on the parent RHS panel.
    return childLocalTag === 'attribute' || childLocalTag === 'anyAttribute';
  };

  const visibleChildren = element.children
    .map((child, rawIndex) => ({ child, rawIndex }))
    .filter(({ child }) => !shouldHideChildInInferredView(child));

  const hasChildren = visibleChildren.length > 0;
  const hasAttributes = element.attributes.length > 0;
  const hasText = element.text.length > 0;
  const isCompositor = !!element.isCompositor;

  const handleAttributeChange = (attrName: string, newValue: string) => {
    onUpdateValue(path, (current) => {
      const updated = { ...current };
      // Set the attribute as @name property
      updated['@' + attrName] = newValue;
      
      // Remove from both possible legacy attribute storage formats
      // Try @attributes format
      if (updated['@attributes'] && typeof updated['@attributes'] === 'object') {
        const attrs = { ...updated['@attributes'] };
        delete attrs[attrName];
        if (Object.keys(attrs).length > 0) {
          updated['@attributes'] = attrs;
        } else {
          delete updated['@attributes'];
        }
      }
      // Try attributes format
      if (updated.attributes && typeof updated.attributes === 'object') {
        const attrs = { ...updated.attributes };
        delete attrs[attrName];
        if (Object.keys(attrs).length > 0) {
          updated.attributes = attrs;
        } else {
          delete updated.attributes;
        }
      }
      return updated;
    });
  };

  const handleAddAttribute = () => {
    const newAttrName = prompt('Enter attribute name:');
    if (newAttrName && newAttrName.trim()) {
      onUpdateValue(path, (current) => {
        const updated = { ...current };
        updated['@' + newAttrName.trim()] = '';
        return updated;
      });
    }
  };

  const handleRemoveAttribute = (attrName: string) => {
    onUpdateValue(path, (current) => {
      const updated = { ...current };
      delete updated['@' + attrName];
      return updated;
    });
  };

  const handleTextContentChange = (newText: string) => {
    onUpdateValue(path, (current) => {
      const updated = { ...current };
      if (newText.trim()) {
        updated._text = newText;
      } else {
        delete updated._text;
      }
      return updated;
    });
  };

  // Helper to sanitize test ids
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9-_]/g, '_');
  const suggestedAttrNames = getSuggestedAttributeNamesForTag(element.tagName);
  const canAddCustomAttribute = canAddCustomAttributeForElement(element, rootSchema);

  const applyInferredEditorPatch = (patch: Record<string, any>) => {
    const tagPrefix = element.tagName.includes(':') ? `${element.tagName.split(':')[0]}:` : '';
    const importKey = `${tagPrefix}import`;
    const annotationKey = `${tagPrefix}annotation`;
    const documentationKey = `${tagPrefix}documentation`;
    const attributeDeclKey = `${tagPrefix}attribute`;
    const anyAttributeKey = `${tagPrefix}anyAttribute`;

    const setAttr = (obj: any, attrName: string, attrValue: any) => {
      if (attrValue === undefined || attrValue === null || attrValue === '') {
        delete obj[`@${attrName}`];
      } else {
        obj[`@${attrName}`] = attrValue;
      }
    };

    onUpdateValue(path, (current) => {
      const updated = { ...(current || {}) };

      if ('xmlName' in patch) setAttr(updated, 'name', patch.xmlName);
      if ('xmlElementType' in patch) setAttr(updated, 'type', patch.xmlElementType);
      if ('xmlAttributeType' in patch) setAttr(updated, 'type', patch.xmlAttributeType);
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
      if ('xmlAnyAttributeNamespace' in patch) {
        const nextNs = patch.xmlAnyAttributeNamespace;
        if (nextNs === undefined || nextNs === null || nextNs === '') {
          if (updated[anyAttributeKey] && typeof updated[anyAttributeKey] === 'object') {
            delete updated[anyAttributeKey]['@namespace'];
            if (Object.keys(updated[anyAttributeKey]).length === 0) delete updated[anyAttributeKey];
          }
        } else {
          const anyAttrNode = (updated[anyAttributeKey] && typeof updated[anyAttributeKey] === 'object') ? { ...updated[anyAttributeKey] } : {};
          anyAttrNode['@namespace'] = String(nextNs);
          updated[anyAttributeKey] = anyAttrNode;
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
        const raw = updated[attributeDeclKey];
        if (!raw) return [];
        return Array.isArray(raw) ? [...raw] : [raw];
      };
      const setAttributeDecls = (decls: any[]) => {
        if (!decls || decls.length === 0) {
          delete updated[attributeDeclKey];
          return;
        }
        updated[attributeDeclKey] = decls.length === 1 ? decls[0] : decls;
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
      {/* Element header with toggle */}
      <div className={styles.propertyHeader} style={{ marginBottom: hasChildren || hasAttributes ? 8 : 0 }}>
        {hasChildren || hasAttributes ? (
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
      {expanded && (hasChildren || hasAttributes) && (
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
              const getDeclaredAttributes = () => {
                // Use actual xs:attribute child declarations for editor attribute rows.
                // This avoids treating node metadata attributes (@name/@type/etc.) as declarations.
                const childAttrs = element.children
                  .filter((c): c is XmlElement => typeof c !== 'string')
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

              const anyAttributeNode = element.children
                .filter((c): c is XmlElement => typeof c !== 'string')
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(() => {
                  // Normalize attributes: if there's an attribute named 'attributes' whose value
                  // is an object of primitive key/values, expand those into individual attributes
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
                          // If it's non-primitive, represent it as a nested object attribute
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

                  // Filter out xmlns and id attributes - they should be hidden/readonly
                  const editableAttrs = normalized.filter((a) => a.name !== 'xmlns' && a.name !== 'id');

                  return (
                    <>
                      {editableAttrs.map((attr) => (
                    <div key={attr.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {
                        (() => {
                          const inputId = `xml-attr-input-${sanitize(element.tagName)}-${sanitize(attr.name)}`;
                          return (
                            <label htmlFor={inputId} className={styles.label} style={{ minWidth: 100 }}>{attr.name}:</label>
                          );
                        })()
                      }
                      {typeof attr.value === 'object' ? (
                        <textarea className={styles.input} readOnly value={JSON.stringify(attr.value, null, 2)} style={{ flex: 1, maxWidth: 400, minHeight: 40 }} />
                      ) : (
                        (() => {
                          // Use compiled schema for efficient type/enumeration lookup
                          let enumerations: string[] = [];
                          let facets: ValidationFacets | undefined = undefined;
                          let attrType: string | undefined;
                          
                          // Strategy 1: Try schemaNode first (attributes list from schema)
                          if (schemaNode?.attributes) {
                            const attrDef = schemaNode.attributes.find((a) => a.name === attr.name);
                            if (attrDef?.type) {
                              attrType = attrDef.type;
                            }
                          }
                          
                          // Strategy 2: Look up element type in compiledSchema (forward-only lookup)
                          // This works because schemaNode.elementType is now properly populated
                          if (!attrType && compiledSchema && schemaNode?.elementType) {
                            // Get attributes for this element's type from compiled schema
                            const elementTypeAttrs = getTypeAttributes(compiledSchema, schemaNode.elementType);
                            if (elementTypeAttrs) {
                              const attrDef = elementTypeAttrs.find((a: any) => a.name === attr.name);
                              if (attrDef?.type) {
                                attrType = attrDef.type;
                              }
                            }
                          }
                          
                          // Now look up enumerations and facets for the attribute type
                          if (attrType && compiledSchema) {
                            enumerations = getAttributeEnumerations(compiledSchema, attrType);
                            facets = getAttributeFacets(compiledSchema, attrType);
                          }
                          
                          // Infer input type
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
                          const inputType = xsdMapped || detectAttributeInputType(attr.name, attr.value);
                          const validationAttrs = facetsToInputAttrs(facets);
                          const validationHint = facetsToHint(facets);
                          
                          if (enumerations.length > 0) {
                            // Render select control for enumerated values
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                                <select
                                  id={`xml-attr-input-${sanitize(element.tagName)}-${sanitize(attr.name)}`}
                                  data-testid={`xml-attr-${sanitize(element.tagName)}-${sanitize(attr.name)}`}
                                  className={styles.input}
                                  value={String(attr.value ?? '')}
                                  onChange={(e) => handleAttributeChange(attr.name, e.target.value)}
                                  style={{ flex: 1, maxWidth: 200 }}
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
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
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
                                style={{ flex: 1, maxWidth: 200 }}
                                {...validationAttrs}
                              />
                              {validationHint && (
                                <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{validationHint}</div>
                              )}
                            </div>
                          );
                        })()
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => handleRemoveAttribute(attr.name)}
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
                        <TooltipContent>Remove attribute</TooltipContent>
                      </Tooltip>
                    </div>
                      ))}

                      {suggestedAttrNames.filter((name) => !presentNames.has(name) && name !== 'xmlns' && name !== 'id').length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                          {suggestedAttrNames
                            .filter((name) => !presentNames.has(name) && name !== 'xmlns' && name !== 'id')
                            .map((name) => (
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
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Add Attribute button (when no attributes yet) */}
          {!hasAttributes && !hasInferredEditor && (
            <div style={{ marginBottom: 12 }}>
              {suggestedAttrNames.filter((name) => name !== 'xmlns' && name !== 'id').length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {suggestedAttrNames.filter((name) => name !== 'xmlns' && name !== 'id').map((name) => (
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
                  {canAddCustomAttribute ? (
                    <button className={styles.addButton} onClick={handleAddAttribute}>
                      <Plus size={14} />
                      <span style={{ marginLeft: 6 }}>Custom</span>
                    </button>
                  ) : null}
                </div>
              ) : (
                canAddCustomAttribute ? (
                  <button className={styles.addButton} onClick={handleAddAttribute}>
                    <Plus size={14} />
                    <span style={{ marginLeft: 6 }}>Add Attribute</span>
                  </button>
                ) : null
              )}
            </div>
          )}

          {/* Children section */}
          {hasChildren && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className={styles.addButton}
                      onClick={() => {
                        const newElementName = prompt('Enter element name:');
                        if (newElementName && newElementName.trim()) {
                          onUpdateValue(path, (current) => {
                            const updated = { ...current };
                            const newElement = { _text: '' };
                            if (updated[newElementName]) {
                              if (!Array.isArray(updated[newElementName])) {
                                updated[newElementName] = [updated[newElementName]];
                              }
                              updated[newElementName].push(newElement);
                            } else {
                              updated[newElementName] = newElement;
                            }
                            return updated;
                          });
                        }
                      }}
                      title="Add new child element"
                    >
                      <Plus size={12} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Add child element</TooltipContent>
                </Tooltip>
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
                  
                  // Use element structure if available; use data as fallback
                  const elementToRender = childElement || childInstanceData;
                  
                  console.log(`[XmlElementNode] Child schema element ${index}: name="${childElementName}", element=${!!childElement}, data type=${typeof childInstanceData}, found=${!!elementToRender}`);
                  
                  // Check if this child element is simple (no nested children in schema and no complex structure in data)
                  const isSimpleChild = childSchemaNode.children && childSchemaNode.children.length === 0 &&
                    elementToRender && typeof elementToRender === 'object' && 
                    elementToRender.children && elementToRender.children.length === 0 &&
                    elementToRender.attributes && elementToRender.attributes.length === 0;
                  
                  // Handle both single and multiple occurrences
                  if (Array.isArray(childInstanceData)) {
                    // Render each array element
                    // For choice groups, show the dropdown before the first element
                    const arrayItems = childInstanceData.map((child, arrayIndex) => (
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
                        />
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
                      </div>
                    ));
                    
                    // If this element is the currently selected option in a choice group, wrap array items with choice dropdown
                    if (choiceGroupData && choiceGroupData.selectedOption === childElementName) {
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
                          </div>
                          
                          {/* Array items */}
                          {arrayItems}
                        </div>
                      );
                    }
                    
                    return arrayItems;
                  } else if (isSimpleChild && childInstanceData) {
                    // Render simple text elements as inline inputs
                    // Use the data value, not the parsed element
                    const elementType = rootSchema ? findElementTypeInRootSchema(rootSchema, childElementName) : null;
                    const htmlInputType = (elementType ? mapXsdTypeToHtmlInput(elementType) : null) || 'text';
                    
                    // Get the text value from data (which is what gets updated)
                    // Support both _text (internal format) and #text (from parseMarkup)
                    const dataElement = childInstanceData && typeof childInstanceData === 'object' ? childInstanceData : {};
                    const textValue = dataElement._text !== undefined ? dataElement._text : (dataElement['#text'] || '');
                    
                    // Render choice dropdown if this element is the currently selected option in a choice group
                    // Show dropdown for whichever element is selected, not just the first in schema order
                    if (choiceGroupData && choiceGroupData.selectedOption === childElementName) {
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
                          <input
                            type={htmlInputType as any}
                            value={textValue}
                            onChange={(e) => {
                              onUpdateValue([...path, childElementName], (current) => {
                                return { ...current, _text: e.target.value };
                              });
                            }}
                            style={{
                              flex: 1,
                              maxWidth: 200,
                              padding: '6px 8px',
                              border: '1px solid #ddd',
                              borderRadius: 3,
                              fontSize: 12,
                            }}
                          />
                        </div>
                      );
                    }
                    
                    return (
                      <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <label style={{ minWidth: 100, fontSize: 14, fontWeight: 500, color: '#a78bfa' }}>
                          {childElementName}:
                        </label>
                        <input
                          type={htmlInputType as any}
                          value={textValue}
                          onChange={(e) => {
                            onUpdateValue([...path, childElementName], (current) => {
                              return { ...current, _text: e.target.value };
                            });
                          }}
                          style={{
                            flex: 1,
                            maxWidth: 200,
                            padding: '6px 8px',
                            border: '1px solid #ddd',
                            borderRadius: 3,
                            fontSize: 12,
                          }}
                        />
                      </div>
                    );
                  } else if (elementToRender) {
                    // Render complex child elements as expandable nodes
                    
                    // Render choice dropdown if this element is the currently selected option in a choice group
                    if (choiceGroupData && choiceGroupData.selectedOption === childElementName) {
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
                          </div>
                          
                          {/* Element Node */}
                          <div style={{ position: 'relative', marginLeft: 8 }}>
                            <XmlElementNode
                              element={elementToRender}
                              path={[...path, childElementName]}
                              expandedPaths={expandedPaths}
                              onToggleExpand={onToggleExpand}
                              value={childInstanceData}
                              onChange={onChange}
                              onUpdateValue={onUpdateValue}
                              rootSchema={rootSchema}
                              autoExpandAll={autoExpandAll}
                              schemaNode={childSchemaNode}
                              compiledSchema={compiledSchema}
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
                          value={childInstanceData}
                          onChange={onChange}
                          onUpdateValue={onUpdateValue}
                          rootSchema={rootSchema}
                          autoExpandAll={autoExpandAll}
                          schemaNode={childSchemaNode}
                          compiledSchema={compiledSchema}
                        />
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
                  const htmlInputType = (elementType ? mapXsdTypeToHtmlInput(elementType) : null) || 'text';
                  
                  // Render simple text elements as inline inputs, like attributes
                  return (
                    <div key={rawIndex} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={{ minWidth: 100, fontSize: 14, fontWeight: 500, color: '#a78bfa' }}>
                        {child.tagName}:
                      </label>
                      <input
                        type={htmlInputType as any}
                        value={child.text || ''}
                        onChange={(e) => {
                          onUpdateValue([...path, String(rawIndex)], (current) => {
                            return { ...current, _text: e.target.value };
                          });
                        }}
                        style={{
                          flex: 1,
                          maxWidth: 200,
                          padding: '6px 8px',
                          border: '1px solid #ddd',
                          borderRadius: 3,
                          fontSize: 12,
                        }}
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

  // Reset expansion state when schema changes
  useEffect(() => {
    const initial = new Set<string>();
    initial.add(path.join('.')); // Always expand root element
    setExpandedPaths(initial);
  }, [schema, rootSchema]);

  // Initialize expansion state
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    initial.add(path.join('.')); // Always expand root element
    return initial;
  });

  // Detect if value is wrapped (e.g., { person: {...} }) and track the wrapper key
  const wrapperKey = useMemo(() => {
    if (!value || typeof value !== 'object') return null;
    // Look for a non-@ key with an object value
    for (const key in value) {
      if (!key.startsWith('@') && !key.startsWith('_') && typeof (value as any)[key] === 'object') {
        return key;
      }
    }
    return null;
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
        typeName, // Pass the element's type to walkSchema
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
    if (newExpanded.has(pathKey)) {
      newExpanded.delete(pathKey);
    } else {
      newExpanded.add(pathKey);
    }
    setExpandedPaths(newExpanded);
  };

  // Update nested value at path
  // If value is wrapped (e.g., {person: {...}}), adjust path to account for wrapper
  const handleUpdateValue = (pathArray: string[], updateFn: (v: any) => any) => {
    const current = value || schema;
    if (!current || typeof current !== 'object') return;

    // Deep clone the current value
    const updated = JSON.parse(JSON.stringify(current));

    // Adjust path for wrapped values: if path is [] and we have a wrapperKey,
    // we should actually update at path=[wrapperKey]
    let adjustedPath = pathArray;
    if (adjustedPath.length === 0 && wrapperKey) {
      adjustedPath = [wrapperKey];
    }

    // If path is empty, update root
    if (adjustedPath.length === 0) {
      const result = updateFn(updated);
      onChange(result);
      return;
    }

    // Navigate to parent and apply update
    let target = updated;
    for (let i = 0; i < adjustedPath.length - 1; i++) {
      const key = adjustedPath[i];
      if (!target[key]) target[key] = {};
      target = target[key];
      if (Array.isArray(target)) {
        const index = parseInt(adjustedPath[i + 1], 10);
        if (!isNaN(index) && target[index]) {
          target = target[index];
          i++; // Skip the next index since we handled it
        }
      }
    }

    // Apply the update function to the target
    const lastKey = adjustedPath[adjustedPath.length - 1];
    const isNumericIndex = /^\d+$/.test(lastKey);

    if (isNumericIndex && Array.isArray(target)) {
      const index = parseInt(lastKey, 10);
      target[index] = updateFn(target[index]);
    } else if (!isNumericIndex && target) {
      target[lastKey] = updateFn(target[lastKey]);
    }

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
        rootSchema={rootSchema}
        schemaNode={schemaNode}
        compiledSchema={compiledSchema}
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
