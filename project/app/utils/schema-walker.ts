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
  typeName?: string; // Specific type name to walk (if not provided, defaults to first element/type)
  inlineTypeDefinition?: any; // Inline complexType/simpleType defined directly on an element
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
  if (obj['@attributes'] && typeof obj['@attributes'] === 'object') {
    return obj['@attributes'];
  }

  const attrs: Record<string, any> = { ...obj };
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('@')) {
      attrs[key.slice(1)] = value;
    }
  }
  return attrs;
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
function findNamedGroup(rootSchema: any, groupName: string): any {
  if (!rootSchema || typeof rootSchema !== 'object') return undefined;

  const schemaRoot = rootSchema['xs:schema'] && typeof rootSchema['xs:schema'] === 'object'
    ? rootSchema['xs:schema']
    : rootSchema;

  const rawGroups = schemaRoot['xs:group'] || schemaRoot['group'];
  if (!rawGroups) return undefined;

  const groups = Array.isArray(rawGroups) ? rawGroups : [rawGroups];
  const normalized = groupName.replace(/^.*:/, '');
  return groups.find((groupNode: any) => {
    const attrs = getXmlAttrs(groupNode);
    return (attrs.name || '').replace(/^.*:/, '') === normalized || (attrs.ref || '').replace(/^.*:/, '') === normalized;
  });
}

function parseOccurs(attrs: Record<string, any>): { minOccurs: number; maxOccurs: string } {
  return {
    minOccurs: parseInt(attrs.minOccurs ?? '1', 10),
    maxOccurs: String(attrs.maxOccurs ?? '1'),
  };
}

function mergeOccurs(parent: { minOccurs: number; maxOccurs: string }, child: { minOccurs: number; maxOccurs: string }): { minOccurs: number; maxOccurs: string } {
  const minOccurs = parent.minOccurs === 0 ? 0 : child.minOccurs;
  const maxOccurs = parent.maxOccurs === 'unbounded' || child.maxOccurs === 'unbounded'
    ? 'unbounded'
    : child.maxOccurs;
  return { minOccurs, maxOccurs };
}

function gatherGroupChildren(
  groupNode: any,
  rootSchema: any,
  seen = new Set<string>(),
  inheritedOccurs: { minOccurs: number; maxOccurs: string } = { minOccurs: 1, maxOccurs: '1' }
): Array<{ name: string; type: string | null; minOccurs: number; maxOccurs: string; definition: any; compositorType?: string }> {
  const result: Array<{ name: string; type: string | null; minOccurs: number; maxOccurs: string; definition: any; compositorType?: string }> = [];
  if (!groupNode || typeof groupNode !== 'object') return result;

  const attrs = getXmlAttrs(groupNode);
  const currentOccurs = mergeOccurs(inheritedOccurs, parseOccurs(attrs));
  if (typeof attrs.ref === 'string') {
    const refName = attrs.ref.replace(/^.*:/, '');
    if (refName && !seen.has(refName)) {
      seen.add(refName);
      const resolved = findNamedGroup(rootSchema, refName);
      if (resolved) {
        return gatherGroupChildren(resolved, rootSchema, seen, currentOccurs);
      }
    }
  }

  const childContainers: Array<{ kind: 'choice' | 'sequence' | 'all' | 'group'; node: any }> = [
    { kind: 'choice' as const, node: groupNode['xs:choice'] ?? groupNode['choice'] },
    { kind: 'sequence' as const, node: groupNode['xs:sequence'] ?? groupNode['sequence'] },
    { kind: 'all' as const, node: groupNode['xs:all'] ?? groupNode['all'] },
    { kind: 'group' as const, node: groupNode['xs:group'] ?? groupNode['group'] },
  ].filter(({ node }) => Boolean(node));

  for (const { kind, node } of childContainers) {
    const entries = Array.isArray(node) ? node : [node];
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;

      // Resolve nested xs:group refs rather than surfacing group names as pseudo-children.
      if (kind === 'group') {
        result.push(...gatherGroupChildren(entry, rootSchema, new Set(seen), currentOccurs));
        continue;
      }

      const directElementList = entry['xs:element'] || entry['element'];
      if (directElementList) {
        const elementEntries = Array.isArray(directElementList) ? directElementList : [directElementList];
        for (const elementEntry of elementEntries) {
          const elementAttrs = getXmlAttrs(elementEntry);
          const resolvedName = (typeof elementAttrs.ref === 'string' ? elementAttrs.ref : undefined)
            || (typeof elementAttrs.name === 'string' ? elementAttrs.name : undefined)
            || '';
          if (!resolvedName) continue;
          const mergedElementOccurs = mergeOccurs(currentOccurs, parseOccurs(elementAttrs));
          result.push({
            name: resolvedName,
            type: typeof elementAttrs.type === 'string' ? elementAttrs.type : null,
            minOccurs: mergedElementOccurs.minOccurs,
            maxOccurs: mergedElementOccurs.maxOccurs,
            definition: elementEntry,
            compositorType: kind,
          });
        }
      }

      // Mixed model groups may contain both xs:element and nested sequence/choice/all/group branches.
      // Traverse nested branches too so particles from all legal alternatives are inferred.
      const nestedBranches: Array<{ key: string; node: any }> = [
        { key: 'xs:choice', node: entry['xs:choice'] },
        { key: 'choice', node: entry['choice'] },
        { key: 'xs:sequence', node: entry['xs:sequence'] },
        { key: 'sequence', node: entry['sequence'] },
        { key: 'xs:all', node: entry['xs:all'] },
        { key: 'all', node: entry['all'] },
        { key: 'xs:group', node: entry['xs:group'] },
        { key: 'group', node: entry['group'] },
      ].filter(({ node }) => Boolean(node));

      for (const { key, node: nestedBranch } of nestedBranches) {
        const nestedEntries = Array.isArray(nestedBranch) ? nestedBranch : [nestedBranch];
        for (const nestedEntry of nestedEntries) {
          result.push(...gatherGroupChildren({ [key]: nestedEntry }, rootSchema, new Set(seen), currentOccurs));
        }
      }
    }
  }

  return result;
}

export function getChildElementsFromType(
  typeObj: any,
  rootSchema?: any
): Array<{ name: string; type: string | null; minOccurs: number; maxOccurs: string; definition: any; compositorType?: string }> {
  if (!typeObj || typeof typeObj !== 'object') return [];
  
  const result: Array<{ name: string; type: string | null; minOccurs: number; maxOccurs: string; definition: any; compositorType?: string }> = [];
  const effectiveRootSchema = rootSchema ?? typeObj;
  
  // Handle xs:sequence, xs:choice, xs:all
  for (const compositorKey of ['xs:sequence', 'xs:choice', 'xs:all', 'sequence', 'choice', 'all']) {
    const compositorNode = typeObj[compositorKey];
    if (!compositorNode) continue;

    const compositors = Array.isArray(compositorNode) ? compositorNode : [compositorNode];
    for (const compositor of compositors) {
      if (!compositor || typeof compositor !== 'object') continue;
    
      const compositorType = compositorKey.replace(/^xs:/, '');
    
      // Get elements from compositor
      const elements = compositor['xs:element'] || compositor['element'];
      const compositorOccurs = mergeOccurs({ minOccurs: 1, maxOccurs: '1' }, parseOccurs(getXmlAttrs(compositor)));
      if (elements) {
        const elemArray = Array.isArray(elements) ? elements : [elements];
        for (const elem of elemArray) {
          const attrs = getXmlAttrs(elem);
          const effectiveOccurs = mergeOccurs(compositorOccurs, parseOccurs(attrs));
          result.push({
            name: attrs.name || attrs.ref || '',
            type: attrs.type || null,
            minOccurs: effectiveOccurs.minOccurs,
            maxOccurs: effectiveOccurs.maxOccurs,
            definition: elem,
            compositorType,
          });
        }
      }

      const groupNodes = compositor['xs:group'] || compositor['group'];
      if (groupNodes) {
        const groups = Array.isArray(groupNodes) ? groupNodes : [groupNodes];
        for (const groupNode of groups) {
          result.push(...gatherGroupChildren(groupNode, effectiveRootSchema, new Set<string>(), compositorOccurs));
        }
      }

      // Nested compositors inside compositors (e.g., choice containing sequence branch)
      for (const nestedKey of ['xs:choice', 'choice', 'xs:sequence', 'sequence', 'xs:all', 'all']) {
        const nestedNode = compositor[nestedKey];
        if (!nestedNode) continue;
        const nestedEntries = Array.isArray(nestedNode) ? nestedNode : [nestedNode];
        for (const nestedEntry of nestedEntries) {
          result.push(...gatherGroupChildren({ [nestedKey]: nestedEntry }, effectiveRootSchema, new Set<string>(), compositorOccurs));
        }
      }
    }
  }

  const groupNodes = typeObj['xs:group'] || typeObj['group'];
  if (groupNodes) {
    const groups = Array.isArray(groupNodes) ? groupNodes : [groupNodes];
    for (const groupNode of groups) {
      result.push(...gatherGroupChildren(groupNode, effectiveRootSchema));
    }
  }
  
  // Handle xs:complexContent/xs:extension or xs:restriction
  const complexContent = typeObj['xs:complexContent'] || typeObj['complexContent'];
  if (complexContent) {
    for (const contentKey of ['xs:extension', 'xs:restriction', 'extension', 'restriction']) {
      const content = complexContent[contentKey];
      if (content) {
        const nestedElems = getChildElementsFromType(content, effectiveRootSchema);
        result.push(...nestedElems);
      }
    }
  }

  // If we're walking the XML Schema namespace itself (XMLSchema.xsd), extract facet elements
  // In XMLSchema.xsd, xs:enumeration, xs:pattern, etc. are actual xs:element definitions
  // In user schemas, they're just facets (validation metadata), not structural children
  const restriction = typeObj['xs:restriction'] || typeObj['restriction'];
  if (restriction) {
    const facetKeys = ['xs:enumeration', 'enumeration', 'xs:pattern', 'pattern', 'xs:length', 'length',
                      'xs:minLength', 'minLength', 'xs:maxLength', 'maxLength', 'xs:minInclusive', 'minInclusive',
                      'xs:maxInclusive', 'maxInclusive', 'xs:minExclusive', 'minExclusive', 'xs:maxExclusive', 'maxExclusive',
                      'xs:fractionDigits', 'fractionDigits', 'xs:totalDigits', 'totalDigits', 'xs:whiteSpace', 'whiteSpace'];
    for (const facetKey of facetKeys) {
      const facets = restriction[facetKey];
      if (facets) {
        const facetArray = Array.isArray(facets) ? facets : [facets];
        for (const facet of facetArray) {
          const facetName = facetKey.replace(/^xs:/, '');
          result.push({
            name: facetName,
            type: null,
            minOccurs: 0,
            maxOccurs: 'unbounded',
            definition: facet,
          });
        }
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
 * Dynamically detects namespace prefix (xs:, xsd:, etc.) and handles unprefixed elements.
 * Returns array of enumeration string values.
 */
export function getEnumerationsFromRestriction(restriction: any): string[] {
  if (!restriction || typeof restriction !== 'object') return [];
  
  // Detect namespace prefix from restriction object keys
  let nsPrefix = 'xs';
  const keys = Object.keys(restriction);
  console.log('[getEnumerationsFromRestriction] restriction keys:', keys);
  
  for (const key of keys) {
    const match = key.match(/^(xs|xsd|xml):/);
    if (match) {
      nsPrefix = match[1];
      console.log('[getEnumerationsFromRestriction] detected nsPrefix:', nsPrefix);
      break;
    }
  }
  
  // Try both prefixed and unprefixed versions
  const enumKey = `${nsPrefix}:enumeration`;
  const enumerations = restriction[enumKey] || restriction['enumeration'];
  console.log('[getEnumerationsFromRestriction] Looking for', enumKey, '- found:', !!enumerations);
  
  if (!enumerations) return [];
  
  const enumArray = Array.isArray(enumerations) ? enumerations : [enumerations];
  const result = enumArray
    .map((entry: any) => {
      const attrs = getXmlAttrs(entry);
      return attrs.value;
    })
    .filter((value: any): value is string => typeof value === 'string');
  
  console.log('[getEnumerationsFromRestriction] extracted values:', result);
  return result;
}

/**
 * Detect if a type has enumeration values (is a restricted simpleType with xs:enumeration).
 * Returns the enumerations if found, otherwise empty array.
 */
export function detectEnumerations(typeObj: any): string[] {
  if (!typeObj || typeof typeObj !== 'object') return [];
  
  // Detect namespace prefix from typeObj keys
  let nsPrefix = 'xs';
  const keys = Object.keys(typeObj);
  for (const key of keys) {
    const match = key.match(/^(xs|xsd|xml):/);
    if (match) {
      nsPrefix = match[1];
      break;
    }
  }
  
  // Check for direct restriction with enumeration using detected prefix
  const restriction = typeObj[`${nsPrefix}:restriction`] || typeObj['restriction'];
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
  const result = schema.getEnumerations(typeName);
  console.log(`[getTypeEnumerations] typeName="${typeName}", result=${result ? JSON.stringify(result) : 'null/undefined'}`);
  if (!result) {
    return [];
  }
  return result;
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
  if (elementType && compiled) {
    const typeName = elementType.replace(/^.*:/, '');
    const enums = getTypeEnumerations(compiled, typeName);
    if (enums && enums.length > 0) {
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
function buildInlineTypeNode(typeDef: any, context: SchemaContext): SchemaNode {
  const attrs = getXmlAttrs(typeDef);
  const inlineName = attrs.name || 'inlineType';

  const baseTypeName = (() => {
    const complexContent = typeDef['xs:complexContent'] || typeDef['complexContent'];
    if (complexContent) {
      const ext = complexContent['xs:extension'] || complexContent['extension'];
      if (ext) {
        const extAttrs = getXmlAttrs(ext);
        return typeof extAttrs.base === 'string' ? extAttrs.base : undefined;
      }
      const restriction = complexContent['xs:restriction'] || complexContent['restriction'];
      if (restriction) {
        const restAttrs = getXmlAttrs(restriction);
        return typeof restAttrs.base === 'string' ? restAttrs.base : undefined;
      }
    }
    const simpleContent = typeDef['xs:simpleContent'] || typeDef['simpleContent'];
    if (simpleContent) {
      const ext = simpleContent['xs:extension'] || simpleContent['extension'];
      if (ext) {
        const extAttrs = getXmlAttrs(ext);
        return typeof extAttrs.base === 'string' ? extAttrs.base : undefined;
      }
      const restriction = simpleContent['xs:restriction'] || simpleContent['restriction'];
      if (restriction) {
        const restAttrs = getXmlAttrs(restriction);
        return typeof restAttrs.base === 'string' ? restAttrs.base : undefined;
      }
    }
    return undefined;
  })();

  const inheritedType = baseTypeName && context.compiledSchema
    ? context.compiledSchema.resolveType(baseTypeName.replace(/^.*:/, ''))
    : undefined;

  const inheritedChildren: SchemaNode[] = (inheritedType?.elements || []).map((elem): SchemaNode => ({
    tagName: elem.name,
    label: elem.name,
    nodeType: 'element',
    minOccurs: elem.minOccurs,
    maxOccurs: elem.maxOccurs === 'unbounded' ? 'unbounded' : elem.maxOccurs,
    children: [],
    attributes: [],
    elementType: elem.type,
    isRequired: elem.minOccurs > 0,
    compositorType: elem.compositorType,
  }));

  const directChildren: SchemaNode[] = getChildElementsFromType(typeDef, context.rootSchema).map((elem): SchemaNode => {
    const parsedMaxOccurs = elem.maxOccurs === 'unbounded'
      ? 'unbounded'
      : Number.isFinite(Number(elem.maxOccurs))
        ? Number(elem.maxOccurs)
        : 1;

    return {
      tagName: elem.name,
      label: elem.name,
      nodeType: 'element',
      minOccurs: elem.minOccurs,
      maxOccurs: parsedMaxOccurs,
      children: [],
      attributes: [],
      elementType: elem.type || undefined,
      isRequired: elem.minOccurs > 0,
      compositorType: (elem.compositorType as 'sequence' | 'choice' | 'all' | undefined),
    };
  });

  const elementMap = new Map<string, SchemaNode>();
  for (const child of [...inheritedChildren, ...directChildren]) {
    if (!child.tagName) continue;
    elementMap.set(child.tagName, child);
  }

  const inheritedAttributes = (inheritedType?.attributes || []).map((attr) => ({
    name: attr.name,
    type: attr.type || null,
    use: attr.use,
    default: attr.default,
    fixed: attr.fixed,
  }));
  const directAttributes = getAttributesFromType(typeDef);
  const attributeMap = new Map<string, SchemaAttribute>();
  for (const attr of [...inheritedAttributes, ...directAttributes]) {
    if (!attr.name) continue;
    attributeMap.set(attr.name, attr);
  }

  const node: SchemaNode = {
    tagName: inlineName,
    label: inlineName,
    nodeType: 'element',
    minOccurs: 1,
    maxOccurs: 1,
    children: Array.from(elementMap.values()),
    attributes: Array.from(attributeMap.values()),
    isRequired: true,
    schemaObj: typeDef,
    path: context.path.join('/'),
  };

  if (typeDef['xs:restriction'] || typeDef['restriction']) {
    const restriction = typeDef['xs:restriction'] || typeDef['restriction'];
    node.enumerations = getEnumerationsFromRestriction(restriction);
    const restrictionAttrs = getXmlAttrs(restriction);
    if (restrictionAttrs.base) {
      node.restriction = String(restrictionAttrs.base);
      node.inputType = inferInputType(node);
    }
    
    // Create a child SchemaNode for xs:restriction so it renders as an expandable node
    // This allows enumerations to be displayed as children in the schema form
    const restrictionNode: SchemaNode = {
      tagName: 'xs:restriction',
      label: 'xs:restriction',
      nodeType: 'element',
      minOccurs: 1,
      maxOccurs: 1,
      children: [],
      attributes: [],
      isRequired: true,
      enumerations: node.enumerations.length > 0 ? node.enumerations : [], // Pass parent's enumerations to restriction child
      schemaObj: restriction,
      path: context.path.join('/') + '/xs:restriction',
    };
    
    // Add restriction node as a child so it appears in the tree
    node.children.push(restrictionNode);
  }

  if (typeDef['xs:choice'] || typeDef['choice'] || typeDef['xs:sequence'] || typeDef['sequence'] || typeDef['xs:all'] || typeDef['all']) {
    const compositor = typeDef['xs:choice'] || typeDef['choice'] || typeDef['xs:sequence'] || typeDef['sequence'] || typeDef['xs:all'] || typeDef['all'];
    const key = Object.keys(typeDef).find((candidate) => typeDef[candidate] === compositor);
    if (key) {
      const compositorType = key.replace(/^xs:/, '') as 'sequence' | 'choice' | 'all';
      node.compositorType = compositorType;
    }
  }

  node.inputType = inferInputType(node);
  return node;
}

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
  let typeName: string | undefined = context.typeName; // Use provided typeName if available

  // If inline type is provided (from child element's inline complexType/simpleType),
  // check if compiler created a synthetic type (currently only for "schema" element in XMLSchema.xsd)
  const inlineTypeDefinition = context.inlineTypeDefinition;
  if (!typeName && inlineTypeDefinition) {
    // Get the current element name from path (for nested elements) or rootSchema (for root)
    const elementName = context.path.length > 0 
      ? context.path[context.path.length - 1] 
      : getXmlAttrs(context.rootSchema)?.name;
    
    if (!elementName) {
      // If we can't determine element name, fall back to inline type
      typeName = 'inline:unknown';
    } else if (elementName === 'schema') {
      // For schema element, check for synthetic type first
      const syntheticTypeName = `${elementName}__type`;
      const syntheticType = compiledSchema.resolveType(syntheticTypeName);
      if (syntheticType && syntheticType.elements && syntheticType.elements.length > 0) {
        typeName = syntheticTypeName;
      } else {
        // Fall back to inline type definition
        typeName = `inline:${elementName}`;
      }
    } else {
      // For other elements with inline types, use inline type directly
      typeName = `inline:${elementName}`;
    }
  }
  
  // If no typeName provided, try to get the root type from global elements.
  // Do this only at the root; nested nodes must not fall back to unrelated globals.
  if (!typeName) {
    if (context.path.length === 0) {
      const elementNames = compiledSchema.getAllElementNames();
      if (elementNames.length > 0) {
        const firstElemName = elementNames[0];
        const firstElem = compiledSchema.getElement(firstElemName);
        if (firstElem) {
          const elemAttrs = getXmlAttrs(firstElem);
          if (elemAttrs.type) {
            typeName = elemAttrs.type;
            console.log(`[walkSchema] Root element "${firstElemName}" has type="${typeName}"`);
          } else if (firstElemName === 'schema') {
            // Check for synthetic type for schema element
            const syntheticTypeName = `${firstElemName}__type`;
            const syntheticType = compiledSchema.resolveType(syntheticTypeName);
            console.log(`[walkSchema] Root element "${firstElemName}" has no type, checking for synthetic "${syntheticTypeName}": ${syntheticType ? `found (${syntheticType.elements.length} elements)` : 'NOT FOUND'}`);
            if (syntheticType && syntheticType.elements && syntheticType.elements.length > 0) {
              typeName = syntheticTypeName;
              console.log(`[walkSchema] Using synthetic type "${syntheticTypeName}"`);
            }
          }
        }
      }
    } else {
      return {
        tagName: context.path[context.path.length - 1] || 'element',
        label: context.path[context.path.length - 1] || 'element',
        nodeType: 'element',
        minOccurs: 1,
        maxOccurs: 1,
        children: [],
        attributes: [],
        isRequired: true,
        schemaObj: context.rootSchema,
        path: context.path.join('/'),
      };
    }
  }
  
  // Fall back to first type name only at root if no global element found and no typeName provided
  if (!typeName) {
    if (context.path.length > 0) {
      return {
        tagName: context.path[context.path.length - 1] || 'element',
        label: context.path[context.path.length - 1] || 'element',
        nodeType: 'element',
        minOccurs: 1,
        maxOccurs: 1,
        children: [],
        attributes: [],
        isRequired: true,
        schemaObj: context.rootSchema,
        path: context.path.join('/'),
      };
    }

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

  if ((typeName || '').startsWith('inline:')) {
    const directType = context.inlineTypeDefinition;
    if (directType) {
      return buildInlineTypeNode(directType, context);
    }
  }

  const resolvedType = compiledSchema.resolveType(typeName);
  const activeTypeKey = typeName.replace(/^.*:/, '');
  
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
  if (context.visitedTypes.has(typeName) || context.visitedTypes.has(activeTypeKey)) {
    node.isCircular = true;
    return node;
  }

  if (resolvedType) {
    context.visitedTypes.add(activeTypeKey);
    const resolvedSchemaObj = resolvedType.schemaObj;
    const resolvedRestriction = resolvedSchemaObj?.['xs:restriction'] || resolvedSchemaObj?.['restriction'];

    if (resolvedType.baseType) {
      node.restriction = String(resolvedType.baseType);
    }
    if (resolvedRestriction && typeof resolvedRestriction === 'object') {
      node.schemaObj = resolvedSchemaObj;
    }
    
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

    if (resolvedType.elements.length > 0) {
      // Walk all child elements from the resolved type
      const elementsToWalk = resolvedType.elements;
      
      for (const elem of elementsToWalk) {
        if (elem.compositorType === 'choice') {
          console.log(`[schema-walker] Processing element "${elem.name}" with compositorType='choice'`);
        }
        let childTypeName: string | undefined = elem.type;
        let childInlineTypeDefinition: any = undefined;
        const childLocalName = String(elem.name).replace(/^.*:/, '');
        const ancestorNames = new Set(context.path.map((segment) => String(segment).replace(/^.*:/, '')));

        // The XMLSchema meta-schema intentionally repeats structural names like
        // xs:element / xs:annotation along a single branch. Re-entering the same
        // local name on the current ancestry path does not produce new schema
        // information, so stop descending rather than recursing forever.
        if (ancestorNames.has(childLocalName)) {
          node.children.push({
            tagName: elem.name,
            label: elem.name,
            nodeType: 'element',
            minOccurs: elem.minOccurs,
            maxOccurs: elem.maxOccurs === 'unbounded' ? 'unbounded' : elem.maxOccurs,
            children: [],
            attributes: [],
            elementType: childTypeName,
            isRequired: elem.minOccurs > 0,
            compositorType: elem.compositorType,
          });
          continue;
        }

        // For ref-based children (for example xs:element ref="xs:annotation"), resolve
        // the actual global element definition so recursion stays schema-driven.
        if (!childTypeName && elem.name) {
          const globalElementDef =
            compiledSchema.getElement(childLocalName) ||
            findElementInSchema(context.rootSchema, elem.name);

          if (globalElementDef && typeof globalElementDef === 'object') {
            const globalAttrs = getXmlAttrs(globalElementDef);
            if (typeof globalAttrs.type === 'string' && globalAttrs.type.length > 0) {
              childTypeName = globalAttrs.type;
            }

            // If the global element has an inline complexType/simpleType, pass it along
            childInlineTypeDefinition =
              globalElementDef['xs:complexType'] ||
              globalElementDef['complexType'] ||
              globalElementDef['xs:simpleType'] ||
              globalElementDef['simpleType'];
          }
        }

        if (!childTypeName && !childInlineTypeDefinition) {
          node.children.push({
            tagName: elem.name,
            label: elem.name,
            nodeType: 'element',
            minOccurs: elem.minOccurs,
            maxOccurs: elem.maxOccurs === 'unbounded' ? 'unbounded' : elem.maxOccurs,
            children: [],
            attributes: [],
            elementType: undefined,
            isRequired: elem.minOccurs > 0,
            compositorType: elem.compositorType,
          });
          continue;
        }

        const recursionKey = childTypeName
          ? String(childTypeName).replace(/^.*:/, '')
          : `inline:${childLocalName}`;
        const isTypeRecursion = Boolean(childTypeName) && (
          context.visitedTypes.has(String(childTypeName)) ||
          context.visitedTypes.has(recursionKey)
        );
        if (isTypeRecursion || (!childTypeName && context.visitedTypes.has(recursionKey))) {
          continue;
        }

        if (!childTypeName) {
          context.visitedTypes.add(recursionKey);
        }
        try {
          const childContext = {
            ...context,
            depth: context.depth + 1,
            path: [...context.path, elem.name],
            typeName: childTypeName,
            inlineTypeDefinition: childInlineTypeDefinition,
          };
          const childNode = walkSchema(compiledSchema, childContext);
          childNode.tagName = elem.name;
          childNode.label = elem.name;
          childNode.minOccurs = elem.minOccurs;
          childNode.maxOccurs = elem.maxOccurs === 'unbounded' ? 'unbounded' : elem.maxOccurs;
          if (elem.compositorType) {
            childNode.compositorType = elem.compositorType;
            if (elem.compositorType === 'choice') {
              console.log(`[schema-walker] Set childNode.compositorType='choice' for "${childNode.label}"`);
            }
          }
          node.children.push(childNode);
        } finally {
          if (!childTypeName) {
            context.visitedTypes.delete(recursionKey);
          }
        }
      }
    } else {
      // Fallback: If no resolved type and no inline type, try to extract children directly
      // from the provided schema object (for inline definitions or unresolved schemas).
      const fallbackChildren = getChildElementsFromType(context.rootSchema, context.rootSchema);
      if (fallbackChildren.length > 0) {
        node.children = fallbackChildren.map((elem) => ({
          tagName: elem.name,
          label: elem.name,
          nodeType: 'element',
          minOccurs: elem.minOccurs,
          maxOccurs: elem.maxOccurs === 'unbounded' ? 'unbounded' : Number.isFinite(Number(elem.maxOccurs)) ? Number(elem.maxOccurs) : 1,
          children: [],
          attributes: [],
          elementType: elem.type || undefined,
          isRequired: elem.minOccurs > 0,
          compositorType: (elem.compositorType as 'sequence' | 'choice' | 'all' | undefined),
        }));
      }
    }

    // Get enumerations if available
    const enums = compiledSchema.getEnumerations(typeName);
    
    if (enums.length > 0) {
      node.enumerations = enums;
    }
    
    // Fallback: If no enumerations from compiledSchema but schemaObj has a restriction with enumerations,
    // extract them directly from the schemaObj (for inline/unresolved schemas)
    if ((node.enumerations?.length || 0) === 0 && node.schemaObj) {
      const directRestriction = node.schemaObj['xs:restriction'] || node.schemaObj['restriction'];
      if (directRestriction && typeof directRestriction === 'object') {
        const directEnums = getEnumerationsFromRestriction(directRestriction);
        if (directEnums.length > 0) {
          node.enumerations = directEnums;
        }
      }
    }
    
    // Create a child SchemaNode for xs:restriction if this is a simple type with a restriction
    // This allows restriction facets (enumerations, length, pattern, etc.) to be displayed as children
    if (node.restriction || (node.enumerations?.length || 0) > 0) {
      const restrictionNode: SchemaNode = {
        tagName: 'xs:restriction',
        label: 'xs:restriction',
        nodeType: 'element',
        minOccurs: 1,
        maxOccurs: 1,
        children: [],
        attributes: [],
        isRequired: true,
        enumerations: (node.enumerations?.length || 0) > 0 ? node.enumerations : [], // Pass parent's enumerations to restriction child
        path: context.path.join('/') + '/xs:restriction',
      };
      
      // Add restriction node as a child so it appears in the tree
      node.children.push(restrictionNode);
    }

    context.visitedTypes.delete(activeTypeKey);
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
