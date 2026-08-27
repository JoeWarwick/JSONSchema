/**
 * XML Schema (XSD) Walker
 *
 * Pure schema traversal logic independent of React rendering.
 * Converts XSD schema definitions into structured SchemaNode tree for form generation.
 *
 * Core concepts:
 * - SchemaNode: Represents a schema element after walking (metadata, children, attributes)
 * - SchemaContext: Current walk state (path, visited types, namespace tracking)
 * - Compositors: sequence, choice, all, any — each has distinct traversal rules
 * - Circular reference detection: Track visited type names to prevent infinite loops
 * - CompiledSchema: Pre-indexed type system for efficient type resolution
 */

import type { CompiledSchema, CompiledType, ValidationFacets } from './schema-compiler';
import { compileSchema } from './schema-compiler';

/**
 * Represents a schema element after walking.
 * Contains all metadata needed for rendering an instance form.
 */
export interface SchemaAttribute {
  name: string;
  type: string | null;
  use: 'required' | 'optional' | 'prohibited';
  default?: string;
  fixed?: string;
}

export interface SchemaNode {
  tagName: string; // Local name (e.g., "element", "complexType", "sequence")
  label?: string; // Display label (element name or type name)
  
  // Type classification
  nodeType: 'element' | 'type' | 'attribute' | 'compositor' | 'any' | 'group';
  
  // For compositors: sequence, choice, all, any
  compositorType?: 'sequence' | 'choice' | 'all' | 'any';
  
  // Multiplicity constraints
  minOccurs: number;
  maxOccurs: number | 'unbounded';
  
  // Child elements (for compositors and complex types)
  children: SchemaNode[];
  
  // Attributes defined on this element/type
  attributes: SchemaAttribute[];
  
  // Type information
  elementType?: string; // Type name for xs:element @type
  restriction?: string; // Base type for xs:restriction
  
  // Enumeration values (if this element/attribute has a restricted set)
  enumerations?: string[];
  
  // Input type hint for rendering (text, email, number, checkbox, date, select)
  inputType?: 'text' | 'email' | 'number' | 'checkbox' | 'date' | 'url' | 'select';
  
  // Metadata for rendering
  documentation?: string;
  annotations?: string[];
  
  // Flags
  isRequired: boolean;
  isCircular?: boolean; // Set if this node references a type already being expanded on this branch
  isAny?: boolean; // Set if this is xs:any or xs:anyAttribute
  isImported?: boolean; // Set if this comes from a $ref or external source
  
  // Raw schema object reference (for advanced use cases)
  schemaObj?: any;
  
  // Path in schema tree (for debugging)
  path?: string;
}

export interface SchemaContext {
  rootSchema: any; // Original schema object (reference only; compiledSchema is what gets walked)
  compiledSchema: CompiledSchema; // Pre-compiled schema for efficient type lookups (required)
  visitedTypes: Set<string>; // Type names being walked (circular ref detection)
  depth: number;
  maxDepth: number;
  path: string[]; // Current path in tree
  nsPrefix?: string; // Namespace prefix (e.g., "xs", "xsd")
}

/**
 * Extract attributes from an XML element.
 * Handles both @attributes wrapper and direct properties.
 */
export function getXmlAttrs(obj: any): Record<string, any> {
  if (!obj || typeof obj !== 'object') return {};
  return obj['@attributes'] || obj;
}

/**
 * Detect namespace prefix used in schema (xs, xsd, etc.)
 */
export function detectNamespacePrefix(schema: any): string {
  if (!schema || typeof schema !== 'object') return 'xs';
  const keys = Object.keys(schema);
  for (const key of keys) {
    const match = key.match(/^(xs|xsd|xml):/);
    if (match) return match[1];
  }
  return 'xs';
}

/**
 * Find a type definition (complexType or simpleType) by name in the schema.
 */
export function findTypeInSchema(schema: any, typeName: string): any {
  if (!schema || typeof schema !== 'object' || !typeName) return null;
  
  const normalized = typeName.replace(/^.*:/, ''); // Strip namespace prefix
  
  // Look through xs:complexType
  const complexTypes = schema['xs:complexType'] || schema['complexType'];
  if (complexTypes) {
    const asArray = Array.isArray(complexTypes) ? complexTypes : [complexTypes];
    for (const ct of asArray) {
      const attrs = getXmlAttrs(ct);
      if (attrs.name === normalized) return ct;
    }
  }
  
  // Look through xs:simpleType
  const simpleTypes = schema['xs:simpleType'] || schema['simpleType'];
  if (simpleTypes) {
    const asArray = Array.isArray(simpleTypes) ? simpleTypes : [simpleTypes];
    for (const st of asArray) {
      const attrs = getXmlAttrs(st);
      if (attrs.name === normalized) return st;
    }
  }
  
  return null;
}

/**
 * Find an element definition by name in the schema.
 */
export function findElementInSchema(schema: any, elementName: string): any {
  if (!schema || typeof schema !== 'object' || !elementName) return null;
  
  const normalized = elementName.replace(/^.*:/, ''); // Strip namespace prefix
  
  const elements = schema['xs:element'] || schema['element'];
  if (elements) {
    const asArray = Array.isArray(elements) ? elements : [elements];
    for (const elem of asArray) {
      const attrs = getXmlAttrs(elem);
      if (attrs.name === normalized) return elem;
    }
  }
  
  return null;
}

/**
 * Get child element definitions from a complexType (via sequence, choice, all).
 */
export function getChildElementsFromType(
  typeObj: any
): Array<{ name: string; type: string | null; minOccurs: number; maxOccurs: string; definition: any; compositorType?: string }> {
  if (!typeObj || typeof typeObj !== 'object') return [];
  
  const result: Array<{ name: string; type: string | null; minOccurs: number; maxOccurs: string; definition: any; compositorType?: string }> = [];
  
  // Handle xs:sequence, xs:choice, xs:all
  for (const compositorKey of ['xs:sequence', 'xs:choice', 'xs:all', 'sequence', 'choice', 'all']) {
    const compositor = typeObj[compositorKey];
    if (!compositor) continue;
    
    const compositorType = compositorKey.replace(/^xs:/, '');
    
    // Get elements from compositor
    const elements = compositor['xs:element'] || compositor['element'];
    if (!elements) continue;
    
    const elemArray = Array.isArray(elements) ? elements : [elements];
    for (const elem of elemArray) {
      const attrs = getXmlAttrs(elem);
      result.push({
        name: attrs.name || '',
        type: attrs.type || null,
        minOccurs: parseInt(attrs.minOccurs ?? '1', 10),
        maxOccurs: attrs.maxOccurs ?? '1',
        definition: elem,
        compositorType,
      });
    }
  }
  
  // Handle xs:complexContent/xs:extension or xs:restriction
  const complexContent = typeObj['xs:complexContent'] || typeObj['complexContent'];
  if (complexContent) {
    for (const contentKey of ['xs:extension', 'xs:restriction', 'extension', 'restriction']) {
      const content = complexContent[contentKey];
      if (content) {
        const nestedElems = getChildElementsFromType(content);
        result.push(...nestedElems);
      }
    }
  }
  
  return result;
}

/**
 * Get attribute definitions from a complexType.
 */
export function getAttributesFromType(typeObj: any): SchemaAttribute[] {
  if (!typeObj || typeof typeObj !== 'object') return [];
  
  const result: SchemaAttribute[] = [];
  
  const attributes = typeObj['xs:attribute'] || typeObj['attribute'];
  if (attributes) {
    const attrArray = Array.isArray(attributes) ? attributes : [attributes];
    for (const attr of attrArray) {
      const attrs = getXmlAttrs(attr);
      result.push({
        name: attrs.name || '',
        type: attrs.type || null,
        use: attrs.use || 'optional',
        default: attrs.default,
        fixed: attrs.fixed,
      });
    }
  }
  
  return result;
}

/**
 * Infer HTML input type from XSD type.
 */
export function mapXsdTypeToHtmlInput(xsdType: string | null): string | null {
  if (!xsdType) return null;
  const t = String(xsdType).toLowerCase();
  if (t.includes('boolean')) return 'checkbox';
  if (t.includes('int') || t.includes('decimal') || t.includes('double') || t.includes('float') || t.includes('integer') || t.includes('number')) return 'number';
  if (t.includes('date') || t.includes('time')) return 'date';
  if (t.includes('anyuri') || t.includes('uri') || t.includes('url')) return 'url';
  if (t.includes('email')) return 'email';
  return 'text';
}

/**
 * Extract enumeration values from an xs:restriction element.
 * Returns array of enumeration string values.
 */
export function getEnumerationsFromRestriction(restriction: any): string[] {
  if (!restriction || typeof restriction !== 'object') return [];
  
  const enumerations = restriction['xs:enumeration'] || restriction['enumeration'];
  if (!enumerations) return [];
  
  const enumArray = Array.isArray(enumerations) ? enumerations : [enumerations];
  return enumArray
    .map((entry: any) => {
      const attrs = getXmlAttrs(entry);
      return attrs.value;
    })
    .filter((value: any): value is string => typeof value === 'string');
}

/**
 * Detect if a type has enumeration values (is a restricted simpleType with xs:enumeration).
 * Returns the enumerations if found, otherwise empty array.
 */
export function detectEnumerations(typeObj: any): string[] {
  if (!typeObj || typeof typeObj !== 'object') return [];
  
  // Check for direct xs:restriction with xs:enumeration
  const restriction = typeObj['xs:restriction'] || typeObj['restriction'];
  if (restriction && typeof restriction === 'object') {
    return getEnumerationsFromRestriction(restriction);
  }
  
  return [];
}

/**
 * Infer the input type for a schema node (select, text, number, etc.)
 * Takes into account enumerations, base type, and structure.
 */
export function inferInputType(node: SchemaNode): 'select' | 'text' | 'email' | 'number' | 'checkbox' | 'date' | 'url' {
  // If has enumerations, render as select
  if (node.enumerations && node.enumerations.length > 0) {
    return 'select';
  }
  
  // If has base type, infer from it
  if (node.restriction) {
    const inferred = mapXsdTypeToHtmlInput(node.restriction);
    if (inferred) return inferred as any;
  }
  
  // If has element type, infer from it
  if (node.elementType) {
    const inferred = mapXsdTypeToHtmlInput(node.elementType);
    if (inferred) return inferred as any;
  }
  
  // Default to text
  return 'text';
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * COMPILED SCHEMA API
 * 
 * New functions that use the compiled schema for efficient type resolution.
 * These replace fiddly manual searching with direct lookups and proper hierarchy handling.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * Resolve a type name to its complete definition including all inherited elements and attributes.
 * Handles type hierarchies (extension/restriction) and unions automatically.
 * 
 * @param schema - Compiled schema
 * @param typeName - Type name to resolve (with or without namespace prefix)
 * @returns Resolved type with flattened inheritance, or undefined if not found
 */
export function resolveTypeWithHierarchy(schema: CompiledSchema, typeName: string): CompiledType | undefined {
  return schema.resolveType(typeName);
}

/**
 * Get all possible types in a union (xs:union).
 * 
 * @param schema - Compiled schema
 * @param typeName - Union type name
 * @returns Array of all member types in the union
 */
export function expandUnionTypes(schema: CompiledSchema, typeName: string): CompiledType[] {
  return schema.expandUnion(typeName);
}

/**
 * Get child elements for a type, with full inheritance chain resolved.
 * No need to manually search through nested types.
 * 
 * @param schema - Compiled schema
 * @param typeName - Type name
 * @returns Array of all child elements (including inherited)
 */
export function getTypeElements(schema: CompiledSchema, typeName: string) {
  return schema.getElements(typeName);
}

/**
 * Get attributes for a type, with full inheritance chain resolved.
 * 
 * @param schema - Compiled schema
 * @param typeName - Type name
 * @returns Array of all attributes (including inherited)
 */
export function getTypeAttributes(schema: CompiledSchema, typeName: string) {
  return schema.getAttributes(typeName);
}

/**
 * Get enumeration values for a simple type.
 * 
 * @param schema - Compiled schema
 * @param typeName - Type name
 * @returns Array of enumeration string values, or empty array
 */
export function getTypeEnumerations(schema: CompiledSchema, typeName: string): string[] {
  return schema.getEnumerations(typeName);
}

/**
 * Get validation facets for a type.
 * Facets include constraints like min/max length, pattern, numeric bounds, etc.
 * 
 * @param schema - Compiled schema
 * @param typeName - Type name
 * @returns ValidationFacets object with constraints, or undefined if none
 */
export function getTypeFacets(schema: CompiledSchema, typeName: string): ValidationFacets | undefined {
  return schema.getFacets(typeName);
}

/**
 * Check if a type exists in the schema.
 * 
 * @param schema - Compiled schema
 * @param typeName - Type name to check
 * @returns true if type exists
 */
export function typeExists(schema: CompiledSchema, typeName: string): boolean {
  return schema.hasType(typeName);
}

/**
 * Get all type names in the schema (useful for debugging/introspection).
 * 
 * @param schema - Compiled schema
 * @returns Array of all type names
 */
export function getAllTypeNames(schema: CompiledSchema): string[] {
  return schema.getAllTypeNames();
}

/**
 * Get enumeration values for an attribute type.
 * Attributes reference types just like elements do, so this delegates to getTypeEnumerations.
 * 
 * @param schema - Compiled schema
 * @param attributeType - Attribute type name
 * @returns Array of enumeration values, or empty array if none
 */
export function getAttributeEnumerations(schema: CompiledSchema, attributeType: string): string[] {
  return getTypeEnumerations(schema, attributeType);
}

/**
 * Get validation facets for an attribute type.
 * Attributes reference types just like elements do, so this delegates to getTypeFacets.
 * 
 * @param schema - Compiled schema
 * @param attributeType - Attribute type name
 * @returns ValidationFacets object, or undefined if none
 */
export function getAttributeFacets(schema: CompiledSchema, attributeType: string): ValidationFacets | undefined {
  return getTypeFacets(schema, attributeType);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SCHEMA COMPILATION
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * Compile a schema into an indexed type system.
 * Do this once at schema load time, then use for all type lookups.
 * 
 * Example:
 *   const compiled = compileSchema(parsedXsd);
 *   const personType = resolveTypeWithHierarchy(compiled, 'PersonType');
 *   const elements = getTypeElements(compiled, 'PersonType');
 * 
 * @param schema - Parsed XSD schema object
 * @returns CompiledSchema with indexed types
 */
export function compileSchemaForWalking(schema: any): CompiledSchema {
  return compileSchema(schema);
}

/**
 * Walk a schema using a pre-compiled schema for efficient type resolution.
 * This is the recommended entry point for new code.
 * 
 * @param compiled - Pre-compiled schema for type lookups
 * @param schema - The schema object to walk (element definition, type, etc.)
 * @param context - Traversal context (optional)
 * @returns SchemaNode representing the schema structure
 */
export function walkSchemaWithCompiled(
  compiled: CompiledSchema,
  schema: any,
  context?: SchemaContext
): SchemaNode {
  if (!context) {
    context = {
      rootSchema: schema,
      compiledSchema: compiled,
      visitedTypes: new Set(),
      depth: 0,
      maxDepth: 50,
      path: [],
    };
  }

  if (context.depth > context.maxDepth) {
    return {
      tagName: 'error',
      nodeType: 'element',
      minOccurs: 0,
      maxOccurs: 0,
      children: [],
      attributes: [],
      isRequired: false,
      documentation: 'Maximum recursion depth reached',
    };
  }

  if (!schema || typeof schema !== 'object') {
    return {
      tagName: 'empty',
      nodeType: 'element',
      minOccurs: 0,
      maxOccurs: 1,
      children: [],
      attributes: [],
      isRequired: false,
    };
  }

  const attrs = getXmlAttrs(schema);
  const schemaName = attrs.name || attrs.ref || '';
  const elementType = attrs.type || null;

  const minOccurs = parseInt(attrs.minOccurs ?? '1', 10);
  const maxOccurs = attrs.maxOccurs === 'unbounded' ? 'unbounded' : (attrs.maxOccurs ?? '1');

  let isCircular = false;
  if (elementType && context.visitedTypes.has(elementType)) {
    isCircular = true;
  }

  const node: SchemaNode = {
    tagName: schemaName,
    label: schemaName,
    nodeType: 'element',
    minOccurs,
    maxOccurs: ((): number | 'unbounded' => {
      if (maxOccurs === 'unbounded') return 'unbounded';
      const parsed = parseInt(String(maxOccurs), 10);
      return isNaN(parsed) ? 1 : parsed;
    })(),
    children: [],
    attributes: [],
    elementType,
    isRequired: minOccurs > 0,
    isCircular,
    schemaObj: schema,
    path: context.path.join('/'),
  };

  if (isCircular) {
    return node;
  }

  // Use compiled schema for efficient type lookup
  if (elementType) {
    const typeName = elementType.replace(/^.*:/, '');
    const resolvedType = resolveTypeWithHierarchy(compiled, typeName);

    if (resolvedType) {
      context.visitedTypes.add(typeName);
      node.label = schemaName || typeName;

      // Use resolved type's elements and attributes (inheritance already flattened)
      node.attributes = resolvedType.attributes.map((attr) => ({
        name: attr.name,
        type: attr.type || null,
        use: attr.use,
        default: attr.default,
        fixed: attr.fixed,
      }));

      if (resolvedType.compositorType) {
        node.compositorType = resolvedType.compositorType;
      }

      // Create child nodes from resolved elements
      for (const elem of resolvedType.elements) {
        const childNode: SchemaNode = {
          tagName: elem.name,
          label: elem.name,
          nodeType: 'element',
          minOccurs: elem.minOccurs,
          maxOccurs: elem.maxOccurs,
          children: [],
          attributes: [],
          elementType: elem.type,
          isRequired: elem.minOccurs > 0,
          compositorType: elem.compositorType,
        };
        node.children.push(childNode);
      }

      context.visitedTypes.delete(typeName);
    }
  }

  // Handle enumerations using compiled schema
  if (elementType) {
    const typeName = elementType.replace(/^.*:/, '');
    const enums = getTypeEnumerations(compiled, typeName);
    if (enums.length > 0) {
      node.enumerations = enums;
    }
  }

  node.inputType = inferInputType(node);

  return node;
}



/**
 * Main schema walker: Converts XSD schema definition into SchemaNode tree.
 * Uses compiled schema as authoritative source of truth for type information.
 *
 * @param compiledSchema - Pre-compiled schema for efficient type lookups (required)
 * @param context - Traversal context (required; rootSchema is the schema object being walked)
 * @returns SchemaNode representing the schema structure
 */
export function walkSchema(compiledSchema: CompiledSchema, context: SchemaContext): SchemaNode {
  if (context.depth > context.maxDepth) {
    return {
      tagName: 'error',
      nodeType: 'element',
      minOccurs: 0,
      maxOccurs: 0,
      children: [],
      attributes: [],
      isRequired: false,
      documentation: 'Maximum recursion depth reached',
    };
  }

  // Only walk the compiled schema, never the raw schema
  let typeName: string | undefined;
  
  // First, try to get the root type from global elements
  const elementNames = compiledSchema.getAllElementNames();
  if (elementNames.length > 0) {
    const firstElem = compiledSchema.getElement(elementNames[0]);
    if (firstElem) {
      const elemAttrs = getXmlAttrs(firstElem);
      if (elemAttrs.type) {
        typeName = elemAttrs.type;
      }
    }
  }
  
  // Fall back to first type name if no global element found
  if (!typeName) {
    const allTypeNames = compiledSchema.getAllTypeNames();
    if (allTypeNames.length === 0) {
      return {
        tagName: 'empty',
        nodeType: 'element',
        minOccurs: 0,
        maxOccurs: 1,
        children: [],
        attributes: [],
        isRequired: false,
      };
    }
    typeName = allTypeNames[0];
  }

  const resolvedType = compiledSchema.resolveType(typeName);
  
  const node: SchemaNode = {
    tagName: typeName,
    label: typeName,
    nodeType: 'element',
    minOccurs: 1,
    maxOccurs: 1,
    children: [],
    attributes: [],
    elementType: typeName,
    isRequired: true,
    schemaObj: context.rootSchema,
    path: context.path.join('/'),
  };

  // If circular reference detected, stop here
  if (context.visitedTypes.has(typeName)) {
    node.isCircular = true;
    return node;
  }

  if (resolvedType) {
    context.visitedTypes.add(typeName);
    
    node.attributes = resolvedType.attributes.map(attr => ({
      name: attr.name,
      type: attr.type || null,
      use: attr.use,
      default: attr.default,
      fixed: attr.fixed,
    }));
    
    if (resolvedType.compositorType) {
      node.compositorType = resolvedType.compositorType;
    }

    // Walk child elements from compiled schema
    for (const elem of resolvedType.elements) {
      const childContext = { ...context, depth: context.depth + 1, path: [...context.path, elem.name] };
      const childNode = walkSchema(compiledSchema, childContext);
      childNode.minOccurs = elem.minOccurs;
      childNode.maxOccurs = elem.maxOccurs === 'unbounded' ? 'unbounded' : elem.maxOccurs;
      node.children.push(childNode);
    }

    // Get enumerations if available
    const enums = compiledSchema.getEnumerations(typeName);
    if (enums.length > 0) {
      node.enumerations = enums;
    }

    context.visitedTypes.delete(typeName);
  }

  node.inputType = inferInputType(node);

  return node;
}

/**
 * Get element definitions for a compositor (sequence/choice/all/any).
 * Used for progressive/lazy traversal of compositors.
 */
export function getCompositorChildren(
  compositorNode: SchemaNode,
  schema: any,
  compiledSchema: CompiledSchema
): SchemaNode[] {
  if (!compositorNode.compositorType) return compositorNode.children;
  
  const children: SchemaNode[] = [];
  const compositorElems = getChildElementsFromType(schema);
  
  for (const elem of compositorElems) {
    const node = walkSchema(compiledSchema, {
      rootSchema: schema,
      compiledSchema,
      visitedTypes: new Set(),
      depth: 0,
      maxDepth: 50,
      path: [elem.name],
    });
    children.push(node);
  }
  
  return children;
}

/**
 * Check if a SchemaNode represents a required element.
 */
export function isRequired(node: SchemaNode): boolean {
  return node.minOccurs > 0;
}

/**
 * Check if a SchemaNode can have multiple occurrences.
 */
export function canOccurMultipleTimes(node: SchemaNode): boolean {
  return node.maxOccurs === 'unbounded' || (typeof node.maxOccurs === 'number' && node.maxOccurs > 1);
}

/**
 * Get display label for a SchemaNode.
 */
export function getNodeLabel(node: SchemaNode): string {
  return node.label || node.tagName || 'Element';
}

/**
 * Check if SchemaNode is a compositor (sequence/choice/all/any).
 */
export function isCompositor(node: SchemaNode): boolean {
  return node.compositorType !== undefined || node.isAny === true;
}
