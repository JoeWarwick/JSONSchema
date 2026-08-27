/**
 * Instance Builder
 *
 * Converts schema structures into instance defaults and XML text.
 * Handles bidirectional conversion between instance objects and XML strings.
 *
 * Key concepts:
 * - Instance object: JavaScript object mirroring XML structure (nested objects, arrays for repeated elements)
 * - XML string: Actual XML text with proper namespace handling
 * - Round-trip: Parse XML → Edit in form → Serialize back to XML (with no loss)
 */

import type { SchemaNode } from './schema-walker';
import { isRequired, canOccurMultipleTimes } from './schema-walker';

/**
 * Build a default instance from a SchemaNode.
 * Creates appropriate default values based on type and multiplicity.
 */
export function buildDefaultInstance(node: SchemaNode): any {
  if (!node) return undefined;

  // For any/wildcard, return empty object
  if (node.isAny) {
    return {};
  }

  // For compositor nodes (sequence/choice/all), create object with required children
  if (node.compositorType) {
    const instance: Record<string, any> = {};
    
    for (const child of node.children) {
      // Only include required children by default
      if (isRequired(child)) {
        instance[child.label || child.tagName] = buildDefaultInstance(child);
      }
    }
    
    return instance;
  }

  // For elements without children, return null (will be populated by user)
  return null;
}

/**
 * Get rendering hints for a schema node.
 * Returns information about how to render an input control for this node.
 */
export function getControlRenderingHints(node: SchemaNode): {
  controlType: 'text' | 'email' | 'number' | 'checkbox' | 'date' | 'url' | 'select' | 'textarea';
  options?: string[]; // For select controls
  placeholder?: string;
} {
  // If has enumerations, render as select
  if (node.enumerations && node.enumerations.length > 0) {
    return {
      controlType: 'select',
      options: node.enumerations,
      placeholder: `Choose a ${node.label || 'value'}`,
    };
  }

  // Use the inputType hint if available
  if (node.inputType) {
    return {
      controlType: node.inputType,
      placeholder: `Enter ${node.label || 'value'}`,
    };
  }

  // Default to text
  return {
    controlType: 'text',
    placeholder: `Enter ${node.label || 'value'}`,
  };
}

/**
 * Parse an XML string into an instance object.
 * Returns a JavaScript object mirroring the XML structure.
 *
 * Simple implementation: handles elements, attributes, text content.
 * Does NOT handle all XML features (comments, CDATA, etc.) — extend as needed.
 */
export function parseXmlInstance(xmlString: string): any {
  if (!xmlString || typeof xmlString !== 'string') return null;

  try {
    // Parse XML string
    const parser = typeof window !== 'undefined' && window.DOMParser
      ? new DOMParser()
      : null;

    if (!parser) {
      console.warn('DOMParser not available; cannot parse XML');
      return null;
    }

    const doc = parser.parseFromString(xmlString, 'text/xml');
    if ((doc as any).parseError && (doc as any).parseError.errorCode !== 0) {
      console.warn('XML parse error:', (doc as any).parseError);
      return null;
    }

    return xmlElementToObject(doc.documentElement);
  } catch (err) {
    console.warn('Failed to parse XML:', err);
    return null;
  }
}

/**
 * Convert DOM Element to instance object.
 * Handles attributes, child elements, and text content.
 */
function xmlElementToObject(element: Element): any {
  const obj: Record<string, any> = {};

  // Extract attributes (prefix with @)
  if (element.attributes && element.attributes.length > 0) {
    for (let i = 0; i < element.attributes.length; i++) {
      const attr = element.attributes[i];
      obj[`@${attr.name}`] = attr.value;
    }
  }

  // Extract children and text
  let hasElementChildren = false;
  const childMap: Record<string, any> = {};

  for (let i = 0; i < element.childNodes.length; i++) {
    const child = element.childNodes[i];

    if (child.nodeType === 1) { // Element node
      hasElementChildren = true;
      const childObj = xmlElementToObject(child as Element);
      const childName = (child as Element).tagName;

      if (childMap[childName]) {
        // Multiple children with same name — convert to array
        if (!Array.isArray(childMap[childName])) {
          childMap[childName] = [childMap[childName]];
        }
        childMap[childName].push(childObj);
      } else {
        childMap[childName] = childObj;
      }
    } else if (child.nodeType === 3) { // Text node
      const text = child.textContent?.trim();
      if (text) {
        obj._text = (obj._text || '') + text;
      }
    }
  }

  // Merge child elements
  Object.assign(obj, childMap);

  return hasElementChildren || Object.keys(obj).length > 0 ? obj : null;
}

/**
 * Convert instance object to XML string.
 * Handles attributes, child elements, text content, and namespace prefixes.
 *
 * @param obj - Instance object
 * @param rootTagName - Root element name (required if obj is the root)
 * @param nsPrefix - Namespace prefix to use (default: 'xs')
 * @returns XML string
 */
export function toXmlString(obj: any, rootTagName?: string, nsPrefix = 'xs'): string {
  if (!obj || typeof obj !== 'object') return '';

  const lines: string[] = [];
  const visited = new WeakSet<object>();

  function serializeElement(element: any, tagName: string, depth = 0): void {
    const indent = '  '.repeat(depth);

    // Prevent infinite recursion
    if (typeof element === 'object' && element !== null && visited.has(element)) {
      return;
    }
    if (typeof element === 'object' && element !== null) {
      visited.add(element);
    }

    // Handle null/undefined
    if (element === null || element === undefined) {
      lines.push(`${indent}<${tagName} />`);
      return;
    }

    // Handle primitives
    if (typeof element !== 'object') {
      lines.push(`${indent}<${tagName}>${escapeXml(String(element))}</${tagName}>`);
      return;
    }

    // Handle arrays
    if (Array.isArray(element)) {
      for (const item of element) {
        serializeElement(item, tagName, depth);
      }
      return;
    }

    // Handle objects
    const attrs: string[] = [];
    const children: Array<{ name: string; value: any }> = [];
    let textContent = '';

    for (const [key, value] of Object.entries(element)) {
      if (key.startsWith('@')) {
        // Attribute
        const attrName = key.substring(1);
        attrs.push(`${attrName}="${escapeXmlAttr(String(value))}"`);
      } else if (key === '_text') {
        // Text content
        textContent = String(value);
      } else if (key !== 'nodeName' && key !== 'name' && key !== 'attributes') {
        // Child element
        children.push({ name: key, value });
      }
    }

    // Build opening tag
    let openTag = `${indent}<${tagName}`;
    if (attrs.length > 0) {
      openTag += ' ' + attrs.join(' ');
    }

    if (children.length === 0 && !textContent) {
      // Self-closing tag
      lines.push(`${openTag} />`);
    } else {
      openTag += '>';
      lines.push(openTag);

      // Add text content
      if (textContent) {
        lines.push(`${indent}  ${escapeXml(textContent)}`);
      }

      // Add child elements
      for (const { name, value } of children) {
        serializeElement(value, name, depth + 1);
      }

      // Closing tag
      lines.push(`${indent}</${tagName}>`);
    }
  }

  if (rootTagName) {
    serializeElement(obj, rootTagName);
  } else {
    // If no root tag provided, iterate object keys
    for (const [key, value] of Object.entries(obj)) {
      if (!key.startsWith('@') && key !== '_text') {
        serializeElement(value, key);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Escape special XML characters in text content.
 */
function escapeXml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escape special XML characters in attribute values.
 */
function escapeXmlAttr(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Merge two instance objects.
 * Used when updating a nested field without replacing entire parent.
 *
 * @param parent - Parent instance object
 * @param path - Path to field (e.g., ['jobs', 'build', 'runs-on'])
 * @param value - New value for field
 * @returns Updated parent object
 */
export function updateInstanceAtPath(parent: any, path: string[], value: any): any {
  if (!parent || typeof parent !== 'object' || path.length === 0) {
    return parent;
  }

  const updated = { ...parent };
  let current = updated;

  // Navigate to parent of target
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (current[key] === undefined) {
      current[key] = {};
    }
    current = current[key];
  }

  // Set value
  current[path[path.length - 1]] = value;

  return updated;
}

/**
 * Get value at a specific path in an instance object.
 */
export function getInstanceAtPath(instance: any, path: string[]): any {
  if (!instance || typeof instance !== 'object' || path.length === 0) {
    return instance;
  }

  let current = instance;
  for (const key of path) {
    current = current?.[key];
  }

  return current;
}

/**
 * Extract all values for repeated elements in an instance.
 * For array elements, returns the array; for single elements, returns wrapped in array.
 */
export function getInstanceArrayValues(instance: any, elementName: string): any[] {
  if (!instance || typeof instance !== 'object') return [];

  const value = instance[elementName];
  if (Array.isArray(value)) return value;
  if (value !== undefined && value !== null) return [value];
  return [];
}

/**
 * Add a new item to a repeated element in an instance.
 */
export function addInstanceArrayItem(instance: any, elementName: string, newItem: any): any {
  if (!instance || typeof instance !== 'object') {
    return instance;
  }

  const updated = { ...instance };
  const existing = updated[elementName];

  if (Array.isArray(existing)) {
    updated[elementName] = [...existing, newItem];
  } else if (existing !== undefined && existing !== null) {
    updated[elementName] = [existing, newItem];
  } else {
    updated[elementName] = newItem;
  }

  return updated;
}

/**
 * Remove an item from a repeated element in an instance.
 */
export function removeInstanceArrayItem(instance: any, elementName: string, index: number): any {
  if (!instance || typeof instance !== 'object') {
    return instance;
  }

  const updated = { ...instance };
  const existing = updated[elementName];

  if (Array.isArray(existing)) {
    const newArray = existing.filter((_, i) => i !== index);
    updated[elementName] = newArray.length === 0 ? undefined : newArray;
  } else if (index === 0) {
    delete updated[elementName];
  }

  return updated;
}
