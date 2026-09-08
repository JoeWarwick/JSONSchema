/**
 * XML Schema Compiler
 *
 * Pre-processes XSD schemas to create a compiled type system similar to .NET's XmlSchemaSet.
 * Builds global type indices, resolves imports/includes, flattens type hierarchies, and
 * handles unions—eliminating the need for fiddly recursive searching.
 *
 * Core concepts:
 * - CompiledSchema: Pre-processed schema with indexed types, attributes, and elements
 * - TypeResolution: Handles inheritance chains (extension, restriction, union)
 * - ImportResolution: Resolves xs:import and xs:include references
 */

import { getXmlAttrs, detectNamespacePrefix } from './schema-walker';

/**
 * Represents a compiled/indexed type for quick lookup.
 */
export interface CompiledType {
  name: string;
  namespace?: string;
  kind: 'simpleType' | 'complexType';
  
  // Base type information (for restriction/extension)
  baseType?: string;
  baseTypeNamespace?: string;
  
  // For simpleTypes: enumeration values or union members
  enumerations?: string[];
  unionMemberTypes?: string[];
  
  // For complexTypes: child elements and attributes
  elements: CompiledElement[];
  attributes: CompiledAttribute[];
  
  // Compositor type for this type
  compositorType?: 'sequence' | 'choice' | 'all';
  
  // Validation facets from xs:restriction
  facets?: ValidationFacets;
  
  // Raw schema object reference
  schemaObj?: any;
}

/**
 * Represents a compiled element for quick access.
 */
export interface CompiledElement {
  name: string;
  type?: string;
  typeNamespace?: string;
  minOccurs: number;
  maxOccurs: number | 'unbounded';
  compositorType?: 'sequence' | 'choice' | 'all';
}

/**
 * Represents a compiled attribute for quick access.
 */
export interface CompiledAttribute {
  name: string;
  type?: string;
  typeNamespace?: string;
  use: 'required' | 'optional' | 'prohibited';
  default?: string;
  fixed?: string;
}

/**
 * Validation facets extracted from xs:restriction elements.
 * These define constraints on values (length, pattern, range, etc.)
 */
export interface ValidationFacets {
  // String constraints
  minLength?: number;
  maxLength?: number;
  length?: number;
  pattern?: string;          // Regular expression pattern
  whiteSpace?: 'preserve' | 'replace' | 'collapse';
  
  // Numeric constraints
  minInclusive?: number | string;
  maxInclusive?: number | string;
  minExclusive?: number | string;
  maxExclusive?: number | string;
  
  // Decimal constraints
  fractionDigits?: number;   // Max decimal places
  totalDigits?: number;      // Max total digits
  
  // Other constraints
  enumeration?: string[];    // Allowed values (alternative to enumerations)
}

/**
 * Represents a compiled schema (like XmlSchemaSet in .NET).
 * Provides fast lookup and resolution of types without recursive searching.
 */
export class CompiledSchema {
  private typeMap: Map<string, CompiledType> = new Map(); // Maps "name" or "namespace:name"
  private elementMap: Map<string, any> = new Map(); // Global elements
  private schemasByNamespace: Map<string, any> = new Map(); // Imported schemas by namespace
  private nsPrefix: string;
  
  constructor(private rootSchema: any) {
    this.nsPrefix = detectNamespacePrefix(rootSchema);
    this.compile();
  }

  /**
   * Compile the schema: index all types, resolve imports, build lookup tables.
   */
  private compile(): void {
    // Phase 1: Index all types from root schema
    this.indexTypes(this.rootSchema);
    
    // Phase 2: Load imported schemas (if resolver available)
    this.loadImports(this.rootSchema);
    
    // Debug logging for xs:schema
    if (this.elementMap.size > 0 && (this.elementMap.has('schema') || this.elementMap.has('xs:schema'))) {
      console.log('[SchemaCompiler.compile] After indexing, elementMap keys:', Array.from(this.elementMap.keys()).slice(0, 20));
    }
    
    // Phase 3: Clear the root schema from memory after compilation is complete
    // This frees memory for large meta-schemas like XMLSchema.xsd
    this.rootSchema = null;
  }

  /**
   * Index all types in a schema.
   */
  private indexTypes(schema: any, namespace?: string): void {
    if (!schema || typeof schema !== 'object') return;

    const elementKey = `${this.nsPrefix}:element`;
    const hasDirectElements = !!schema[elementKey] || !!schema['element'];
    
    if (!namespace && hasDirectElements) {
      console.log('[SchemaCompiler.indexTypes] Found elements in root schema:', {
        nsPrefix: this.nsPrefix,
        elementKey,
        has_prefixed: !!schema[elementKey],
        has_unprefixed: !!schema['element'],
        elementCount: Array.isArray(schema[elementKey] || schema['element']) 
          ? (schema[elementKey] || schema['element']).length 
          : 1,
      });
    }

    // Index simpleTypes
    const simpleTypes = schema[`${this.nsPrefix}:simpleType`] || schema['simpleType'];
    if (simpleTypes) {
      const asArray = Array.isArray(simpleTypes) ? simpleTypes : [simpleTypes];
      for (const st of asArray) {
        this.indexSimpleType(st, namespace);
      }
    }

    // Index complexTypes
    const complexTypes = schema[`${this.nsPrefix}:complexType`] || schema['complexType'];
    if (complexTypes) {
      const asArray = Array.isArray(complexTypes) ? complexTypes : [complexTypes];
      for (const ct of asArray) {
        this.indexComplexType(ct, namespace);
      }
    }

    // Index global elements
    const elements = schema[`${this.nsPrefix}:element`] || schema['element'];
    if (elements) {
      const asArray = Array.isArray(elements) ? elements : [elements];
      for (const elem of asArray) {
        const attrs = getXmlAttrs(elem);
        const key = attrs.name;
        if (key) {
          this.elementMap.set(key, elem);
          if (key === 'schema' || key === 'xs:schema') {
            console.log('[SchemaCompiler.indexTypes] Indexed element:', key, 'with attrs:', attrs);
          }
          
          // ONLY create synthetic type for the root "schema" element (special handling for XMLSchema.xsd)
          // Other elements with inline types are handled dynamically by the walker
          if (!attrs.type && key === 'schema') {
            const inlineComplexType = elem[`${this.nsPrefix}:complexType`] || elem['complexType'];
            if (inlineComplexType) {
              console.log(`[SchemaCompiler] Found inlineComplexType for schema element, keys:`, Object.keys(inlineComplexType));
              const syntheticName = `${key}__type`; // e.g., "schema__type"
              if (!this.typeMap.has(syntheticName)) {
                const inlineCompiled: CompiledType = {
                  name: syntheticName,
                  namespace,
                  kind: 'complexType',
                  elements: [],
                  attributes: [],
                  schemaObj: inlineComplexType,
                };

                // Handle xs:complexContent/xs:extension
                const complexContent = inlineComplexType[`${this.nsPrefix}:complexContent`] || inlineComplexType['complexContent'];
                if (complexContent) {
                  const extension = complexContent[`${this.nsPrefix}:extension`] || complexContent['extension'];
                  if (extension) {
                    const extAttrs = getXmlAttrs(extension);
                    if (extAttrs.base) {
                      inlineCompiled.baseType = extAttrs.base;
                    }
                    this.extractElementsAndAttributes(extension, inlineCompiled);
                  }
                }

                // Handle direct sequence/choice/all
                if (syntheticName === 'schema__type') {
                  console.log(`[SchemaCompiler] About to extract from schema__type inlineComplexType, keys:`, Object.keys(inlineComplexType));
                }
                this.extractElementsAndAttributes(inlineComplexType, inlineCompiled);
                
                const elementDetails = inlineCompiled.elements.map(e => ({
                  name: e.name,
                  compositorType: e.compositorType,
                  maxOccurs: e.maxOccurs,
                  minOccurs: e.minOccurs,
                }));
                console.log(`[SchemaCompiler] Created ${syntheticName}:`, {
                  totalElements: inlineCompiled.elements.length,
                  elements: elementDetails,
                  typeCompositorType: inlineCompiled.compositorType,
                });

                this.typeMap.set(syntheticName, inlineCompiled);
              }
            }
          }
        }
      }
    }
  }

  /**
   * Index a simpleType: extract enumerations, union members, base type, and validation facets.
   */
  private indexSimpleType(typeObj: any, namespace?: string): void {
    const attrs = getXmlAttrs(typeObj);
    const name = attrs.name;
    if (!name) return;

    const compiled: CompiledType = {
      name,
      namespace,
      kind: 'simpleType',
      elements: [],
      attributes: [],
      enumerations: [], // Initialize empty array for types without enumerations
      schemaObj: typeObj,
    };

    // Handle xs:restriction (with possible enumerations, base type, or facets)
    const restriction = typeObj[`${this.nsPrefix}:restriction`] || typeObj['restriction'];

    if (restriction && typeof restriction === 'object') {
      const restrictAttrs = getXmlAttrs(restriction);
      if (restrictAttrs.base) {
        compiled.baseType = restrictAttrs.base;
      }

      // Extract enumerations
      const enumerations = restriction[`${this.nsPrefix}:enumeration`] || restriction['enumeration'];

      if (enumerations) {
        const enumArray = Array.isArray(enumerations) ? enumerations : [enumerations];
        compiled.enumerations = enumArray
          .map((e: any) => getXmlAttrs(e).value)
          .filter((v: any): v is string => typeof v === 'string');
      }
      
      // Extract validation facets
      const facets = this.extractFacets(restriction);
      if (Object.keys(facets).length > 0) {
        compiled.facets = facets;
      }
    }

    // Handle xs:union
    const union = typeObj[`${this.nsPrefix}:union`] || typeObj['union'];
    if (union && typeof union === 'object') {
      const unionAttrs = getXmlAttrs(union);
      if (unionAttrs.memberTypes) {
        compiled.unionMemberTypes = String(unionAttrs.memberTypes)
          .split(/\s+/)
          .filter(Boolean);
      }
    }

    this.typeMap.set(name, compiled);
  }

  /**
   * Index a complexType: extract base type, elements, attributes.
   */
  private indexComplexType(typeObj: any, namespace?: string): void {
    const attrs = getXmlAttrs(typeObj);
    const name = attrs.name;
    if (!name) return;

    const compiled: CompiledType = {
      name,
      namespace,
      kind: 'complexType',
      elements: [],
      attributes: [],
      schemaObj: typeObj,
    };

    // Handle xs:complexContent/xs:extension
    const complexContent = typeObj[`${this.nsPrefix}:complexContent`] || typeObj['complexContent'];
    if (complexContent) {
      const extension = complexContent[`${this.nsPrefix}:extension`] || complexContent['extension'];
      if (extension) {
        const extAttrs = getXmlAttrs(extension);
        if (extAttrs.base) {
          compiled.baseType = extAttrs.base;
        }
        this.extractElementsAndAttributes(extension, compiled);
      }
    }

    // Handle xs:simpleContent/xs:restriction
    const simpleContent = typeObj[`${this.nsPrefix}:simpleContent`] || typeObj['simpleContent'];
    if (simpleContent) {
      const restriction = simpleContent[`${this.nsPrefix}:restriction`] || simpleContent['restriction'];
      if (restriction) {
        const restAttrs = getXmlAttrs(restriction);
        if (restAttrs.base) {
          compiled.baseType = restAttrs.base;
        }
      }
    }

    // Handle direct sequence/choice/all
    this.extractElementsAndAttributes(typeObj, compiled);

    this.typeMap.set(name, compiled);
  }

  /**
   * Create (or reuse) a synthetic compiled type for an inline anonymous complexType.
   * This preserves inline children/attributes and extension base inheritance.
   */
  private getOrCreateInlineComplexType(
    ownerTypeName: string,
    elementName: string,
    inlineComplexType: any,
    namespace?: string
  ): string {
    const syntheticName = `${ownerTypeName}__${elementName}`;
    if (this.typeMap.has(syntheticName)) {
      return syntheticName;
    }

    const inlineCompiled: CompiledType = {
      name: syntheticName,
      namespace,
      kind: 'complexType',
      elements: [],
      attributes: [],
      schemaObj: inlineComplexType,
    };

    const inlineComplexContent = inlineComplexType?.[`${this.nsPrefix}:complexContent`] || inlineComplexType?.['complexContent'];
    if (inlineComplexContent) {
      const inlineExtension = inlineComplexContent[`${this.nsPrefix}:extension`] || inlineComplexContent['extension'];
      if (inlineExtension) {
        const extAttrs = getXmlAttrs(inlineExtension);
        if (extAttrs.base) {
          inlineCompiled.baseType = extAttrs.base;
        }
        this.extractElementsAndAttributes(inlineExtension, inlineCompiled);
      }
    }

    this.extractElementsAndAttributes(inlineComplexType, inlineCompiled);
    this.typeMap.set(syntheticName, inlineCompiled);
    return syntheticName;
  }

  /**
   * Extract elements and attributes from a type or content model.
   */
  private extractElementsAndAttributes(container: any, compiled: CompiledType): void {
    if (!container || typeof container !== 'object') return;

    // Extract elements from compositor
    for (const compositorKey of [
      `${this.nsPrefix}:sequence`,
      `${this.nsPrefix}:choice`,
      `${this.nsPrefix}:all`,
      'sequence',
      'choice',
      'all',
    ]) {
      const compositor = container[compositorKey];
      if (compiled.name === 'schema__type') {
        console.log(`[SchemaCompiler.extractElementsAndAttributes] Checking ${compositorKey} - found:`, !!compositor);
      }
      if (!compositor) continue;

      const compositorAttrs = getXmlAttrs(compositor);
      const compositorMinOccurs = parseInt(compositorAttrs.minOccurs ?? '1', 10);
      const compositorMaxOccursRaw = compositorAttrs.maxOccurs ?? '1';
      const compositorMaxOccurs = compositorMaxOccursRaw === 'unbounded' ? 'unbounded' : parseInt(String(compositorMaxOccursRaw), 10);

      const compositorType = compositorKey.replace(/^.*:/, '') as 'sequence' | 'choice' | 'all';
      if (!compiled.compositorType) {
        compiled.compositorType = compositorType;
      }

      // Get elements from compositor
      const elements = compositor[`${this.nsPrefix}:element`] || compositor['element'];
      if (elements) {
        const elemArray = Array.isArray(elements) ? elements : [elements];
        if (compiled.name === 'schema__type' && compositorType === 'choice') {
          console.log(`[SchemaCompiler] Found ${compositorType} in schema__type with ${elemArray.length} elements`);
          console.log(`[SchemaCompiler] Element refs in choice:`, elemArray.map((e: any) => {
            const attrs = getXmlAttrs(e);
            return { name: attrs.name, ref: attrs.ref };
          }));
          // Log all keys in the compositor to see if there are other child types
          console.log(`[SchemaCompiler] All keys in choice compositor:`, Object.keys(compositor));
        }
        for (const elem of elemArray) {
          const attrs = getXmlAttrs(elem);
          const resolvedName = attrs.name || attrs.ref || '';
          if (!resolvedName) continue;
          let inferredType = attrs.type;
          const inlineComplexType = elem[`${this.nsPrefix}:complexType`] || elem['complexType'];
          if (!inferredType && inlineComplexType && attrs.name) {
            inferredType = this.getOrCreateInlineComplexType(compiled.name, attrs.name, inlineComplexType, compiled.namespace);
          }
          const declaredMinOccurs = parseInt(attrs.minOccurs ?? '1', 10);
          const effectiveMinOccurs = compositorMinOccurs === 0 ? 0 : declaredMinOccurs;
          const declaredMaxOccursRaw = attrs.maxOccurs ?? '1';
          const declaredMaxOccurs = declaredMaxOccursRaw === 'unbounded' ? 'unbounded' : parseInt(String(declaredMaxOccursRaw), 10);
          const effectiveMaxOccurs = compositorMaxOccurs === 'unbounded' || declaredMaxOccurs === 'unbounded'
            ? 'unbounded'
            : declaredMaxOccurs;
          compiled.elements.push({
            name: resolvedName,
            type: inferredType,
            minOccurs: effectiveMinOccurs,
            maxOccurs: effectiveMaxOccurs,
            compositorType,
          });
        }
      }

      // Handle nested compositors (choice within sequence, etc.)
      // This allows proper handling of complex schema structures
      this.extractNestedCompositorElements(compositor, compositorType, compiled);

      // Handle group refs within this compositor
      const groupNodes = compositor[`${this.nsPrefix}:group`] || compositor['group'];
      if (groupNodes) {
        const groupArray = Array.isArray(groupNodes) ? groupNodes : [groupNodes];
        for (const groupNode of groupArray) {
          const groupAttrs = getXmlAttrs(groupNode);
          const groupRef = groupAttrs.ref;
          if (groupRef) {
            // Resolve the named group and extract its elements
            const namedGroup = this.findNamedGroup(groupRef);
            if (compiled.name === 'schema__type') {
              console.log(`[SchemaCompiler] Found group ref: ${groupRef}, resolved:`, !!namedGroup);
            }
            if (namedGroup) {
              if (compiled.name === 'schema__type') {
                console.log(`[SchemaCompiler] Group ${groupRef} keys:`, Object.keys(namedGroup));
              }
              this.extractElementsAndAttributesFromGroup(namedGroup, compositorMinOccurs, compositorMaxOccurs, compositorType, compiled, new Set<string>());
            }
          }
        }
      }
    }

    // Extract attributes
    const attributes = container[`${this.nsPrefix}:attribute`] || container['attribute'];
    if (attributes) {
      const attrArray = Array.isArray(attributes) ? attributes : [attributes];
      for (const attr of attrArray) {
        const attrs = getXmlAttrs(attr);
        compiled.attributes.push({
          name: attrs.name || '',
          type: attrs.type,
          use: attrs.use || 'optional',
          default: attrs.default,
          fixed: attrs.fixed,
        });
      }
    }
  }

  /**
   * Extract nested compositor elements (choice/sequence/all within a parent compositor).
   * This handles cases like xs:sequence containing xs:choice containing xs:element.
   */
  private extractNestedCompositorElements(compositor: any, parentCompositorType: 'sequence' | 'choice' | 'all', compiled: CompiledType): void {
    if (!compositor || typeof compositor !== 'object') return;

    // Look for nested choice, sequence, or all within this compositor
    for (const nestedCompositorKey of [
      `${this.nsPrefix}:choice`,
      `${this.nsPrefix}:sequence`,
      `${this.nsPrefix}:all`,
      'choice',
      'sequence',
      'all',
    ]) {
      const nestedCompositor = compositor[nestedCompositorKey];
      if (!nestedCompositor) continue;

      const nestedCompositorAttrs = getXmlAttrs(nestedCompositor);
      const nestedCompositorMinOccurs = parseInt(nestedCompositorAttrs.minOccurs ?? '1', 10);
      const nestedCompositorMaxOccursRaw = nestedCompositorAttrs.maxOccurs ?? '1';
      const nestedCompositorMaxOccurs = nestedCompositorMaxOccursRaw === 'unbounded' ? 'unbounded' : parseInt(String(nestedCompositorMaxOccursRaw), 10);

      const nestedCompositorType = nestedCompositorKey.replace(/^.*:/, '') as 'sequence' | 'choice' | 'all';
      
      // Extract elements from the nested compositor
      const elements = nestedCompositor[`${this.nsPrefix}:element`] || nestedCompositor['element'];
      if (elements) {
        const elemArray = Array.isArray(elements) ? elements : [elements];
        for (const elem of elemArray) {
          const attrs = getXmlAttrs(elem);
          const resolvedName = attrs.name || attrs.ref || '';
          if (!resolvedName) continue;
          const declaredMinOccurs = parseInt(attrs.minOccurs ?? '1', 10);
          const effectiveMinOccurs = nestedCompositorMinOccurs === 0 ? 0 : declaredMinOccurs;
          const declaredMaxOccursRaw = attrs.maxOccurs ?? '1';
          const declaredMaxOccurs = declaredMaxOccursRaw === 'unbounded' ? 'unbounded' : parseInt(String(declaredMaxOccursRaw), 10);
          const effectiveMaxOccurs = nestedCompositorMaxOccurs === 'unbounded' || declaredMaxOccurs === 'unbounded'
            ? 'unbounded'
            : declaredMaxOccurs;
          compiled.elements.push({
            name: resolvedName,
            type: attrs.type,
            minOccurs: effectiveMinOccurs,
            maxOccurs: effectiveMaxOccurs,
            compositorType: nestedCompositorType, // Mark with the nested compositor type
          });
        }
      }

      // Recursively handle deeper nesting
      this.extractNestedCompositorElements(nestedCompositor, nestedCompositorType, compiled);

      // Handle group refs within nested compositor
      const groupNodes = nestedCompositor[`${this.nsPrefix}:group`] || nestedCompositor['group'];
      if (groupNodes) {
        const groupArray = Array.isArray(groupNodes) ? groupNodes : [groupNodes];
        for (const groupNode of groupArray) {
          const groupAttrs = getXmlAttrs(groupNode);
          const groupRef = groupAttrs.ref;
          if (groupRef) {
            // Resolve the named group and extract its elements
            const namedGroup = this.findNamedGroup(groupRef);
            if (namedGroup) {
              this.extractElementsAndAttributesFromGroup(namedGroup, nestedCompositorMinOccurs, nestedCompositorMaxOccurs, nestedCompositorType, compiled);
            }
          }
        }
      }
    }
  }

  /**
   * Load imported schemas (xs:import, xs:include).
   * Note: This requires an external resolver function for URL loading.
   */
  private findNamedGroup(groupRef: string): any {
    if (!groupRef || typeof groupRef !== 'string') return null;
    const normalized = groupRef.replace(/^.*:/, ''); // Strip namespace prefix
    const groups = this.rootSchema[`${this.nsPrefix}:group`] || this.rootSchema['group'];
    if (!groups) return null;
    const groupArray = Array.isArray(groups) ? groups : [groups];
    for (const group of groupArray) {
      const attrs = getXmlAttrs(group);
      if (attrs.name === normalized) return group;
    }
    return null;
  }

  /**
   * Extract elements and attributes from a named group (used when resolving xs:group refs).
   */
  private extractElementsAndAttributesFromGroup(
    groupNode: any,
    parentMinOccurs: number,
    parentMaxOccurs: string | number,
    parentCompositorType: 'sequence' | 'choice' | 'all',
    compiled: CompiledType,
    seen: Set<string> = new Set()
  ): void {
    if (!groupNode || typeof groupNode !== 'object') return;

    // Extract elements from the group's compositor
    for (const compositorKey of [
      `${this.nsPrefix}:choice`,
      `${this.nsPrefix}:sequence`,
      `${this.nsPrefix}:all`,
      'choice',
      'sequence',
      'all',
    ]) {
      const compositor = groupNode[compositorKey];
      if (!compositor) continue;

      const compositorAttrs = getXmlAttrs(compositor);
      const compositorMinOccurs = parseInt(compositorAttrs.minOccurs ?? '1', 10);
      const compositorMaxOccursRaw = compositorAttrs.maxOccurs ?? '1';
      const compositorMaxOccurs = compositorMaxOccursRaw === 'unbounded' ? 'unbounded' : parseInt(String(compositorMaxOccursRaw), 10);

      const compositorType = compositorKey.replace(/^.*:/, '') as 'sequence' | 'choice' | 'all';

      // Set the compositor type on the compiled type (only if not already set)
      if (!compiled.compositorType) {
        compiled.compositorType = compositorType;
      }

      // Get elements from compositor
      const elements = compositor[`${this.nsPrefix}:element`] || compositor['element'];
      if (elements) {
        const elemArray = Array.isArray(elements) ? elements : [elements];
        if (compiled.name === 'schema__type') {
          console.log(`[SchemaCompiler.extractElementsAndAttributesFromGroup] Found ${elemArray.length} elements in ${compositorType}:`, 
            elemArray.map((e: any) => {
              const attrs = getXmlAttrs(e);
              return { name: attrs.name, ref: attrs.ref };
            }));
        }
        for (const elem of elemArray) {
          const attrs = getXmlAttrs(elem);
          const resolvedName = attrs.name || attrs.ref || '';
          if (!resolvedName) continue;
          let inferredType = attrs.type;
          const inlineComplexType = elem[`${this.nsPrefix}:complexType`] || elem['complexType'];
          if (!inferredType && inlineComplexType && attrs.name) {
            inferredType = this.getOrCreateInlineComplexType(compiled.name, attrs.name, inlineComplexType, compiled.namespace);
          }
          const declaredMinOccurs = parseInt(attrs.minOccurs ?? '1', 10);
          const effectiveMinOccurs = parentMinOccurs === 0 ? 0 : (compositorMinOccurs === 0 ? 0 : declaredMinOccurs);
          const declaredMaxOccursRaw = attrs.maxOccurs ?? '1';
          const declaredMaxOccurs = declaredMaxOccursRaw === 'unbounded' ? 'unbounded' : parseInt(String(declaredMaxOccursRaw), 10);
          const effectiveMaxOccurs = 
            (parentMaxOccurs === 'unbounded' || compositorMaxOccurs === 'unbounded' || declaredMaxOccurs === 'unbounded')
              ? 'unbounded'
              : declaredMaxOccurs;
          compiled.elements.push({
            name: resolvedName,
            type: inferredType,
            minOccurs: effectiveMinOccurs,
            maxOccurs: effectiveMaxOccurs,
            compositorType,
          });
        }
      }

      // Handle group refs in this SAME compositor (not nested)
      const groupNodes = compositor[`${this.nsPrefix}:group`] || compositor['group'];
      if (groupNodes) {
        const groupArray = Array.isArray(groupNodes) ? groupNodes : [groupNodes];
        for (const groupNode of groupArray) {
          const groupAttrs = getXmlAttrs(groupNode);
          const groupRef = groupAttrs.ref;
          if (groupRef && !seen.has(groupRef)) {
            seen.add(groupRef);
            // Resolve the named group and extract its elements
            const namedGroup = this.findNamedGroup(groupRef);
            if (namedGroup) {
              this.extractElementsAndAttributesFromGroup(namedGroup, parentMinOccurs, parentMaxOccurs, compositorType, compiled, seen);
            }
          }
        }
      }

      // Recursively handle nested compositors and group refs
      this.extractNestedCompositorElementsWithGroupTracking(compositor, compositorType, compiled, seen);
    }
  }

  /**
   * Extract nested compositor elements with group ref cycle detection.
   */
  private extractNestedCompositorElementsWithGroupTracking(
    compositor: any,
    parentCompositorType: 'sequence' | 'choice' | 'all',
    compiled: CompiledType,
    seen: Set<string>
  ): void {
    if (!compositor || typeof compositor !== 'object') return;

    // Look for nested choice, sequence, or all within this compositor
    for (const nestedCompositorKey of [
      `${this.nsPrefix}:choice`,
      `${this.nsPrefix}:sequence`,
      `${this.nsPrefix}:all`,
      'choice',
      'sequence',
      'all',
    ]) {
      const nestedCompositor = compositor[nestedCompositorKey];
      if (!nestedCompositor) continue;

      const nestedCompositorAttrs = getXmlAttrs(nestedCompositor);
      const nestedCompositorMinOccurs = parseInt(nestedCompositorAttrs.minOccurs ?? '1', 10);
      const nestedCompositorMaxOccursRaw = nestedCompositorAttrs.maxOccurs ?? '1';
      const nestedCompositorMaxOccurs = nestedCompositorMaxOccursRaw === 'unbounded' ? 'unbounded' : parseInt(String(nestedCompositorMaxOccursRaw), 10);

      const nestedCompositorType = nestedCompositorKey.replace(/^.*:/, '') as 'sequence' | 'choice' | 'all';
      
      // Extract elements from the nested compositor
      const elements = nestedCompositor[`${this.nsPrefix}:element`] || nestedCompositor['element'];
      if (elements) {
        const elemArray = Array.isArray(elements) ? elements : [elements];
        for (const elem of elemArray) {
          const attrs = getXmlAttrs(elem);
          const resolvedName = attrs.name || attrs.ref || '';
          if (!resolvedName) continue;
          const declaredMinOccurs = parseInt(attrs.minOccurs ?? '1', 10);
          const effectiveMinOccurs = nestedCompositorMinOccurs === 0 ? 0 : declaredMinOccurs;
          const declaredMaxOccursRaw = attrs.maxOccurs ?? '1';
          const declaredMaxOccurs = declaredMaxOccursRaw === 'unbounded' ? 'unbounded' : parseInt(String(declaredMaxOccursRaw), 10);
          const effectiveMaxOccurs = nestedCompositorMaxOccurs === 'unbounded' || declaredMaxOccurs === 'unbounded'
            ? 'unbounded'
            : declaredMaxOccurs;
          compiled.elements.push({
            name: resolvedName,
            type: attrs.type,
            minOccurs: effectiveMinOccurs,
            maxOccurs: effectiveMaxOccurs,
            compositorType: nestedCompositorType, // Mark with the nested compositor type
          });
        }
      }

      // Handle group refs within nested compositor (with cycle detection)
      const groupNodes = nestedCompositor[`${this.nsPrefix}:group`] || nestedCompositor['group'];
      if (compiled.name === 'schema__type') {
        console.log(`[SchemaCompiler] Looking for group refs in nested ${nestedCompositorType}, found:`, !!groupNodes, groupNodes ? 'count=' + (Array.isArray(groupNodes) ? groupNodes.length : 1) : 'N/A');
      }
      if (groupNodes) {
        const groupArray = Array.isArray(groupNodes) ? groupNodes : [groupNodes];
        for (const groupNode of groupArray) {
          const groupAttrs = getXmlAttrs(groupNode);
          const groupRef = groupAttrs.ref;
          if (compiled.name === 'schema__type') {
            console.log(`[SchemaCompiler] Group ref: ${groupRef}, already seen:`, seen.has(groupRef));
          }
          if (groupRef && !seen.has(groupRef)) {
            seen.add(groupRef);
            // Resolve the named group and extract its elements
            const namedGroup = this.findNamedGroup(groupRef);
            if (compiled.name === 'schema__type') {
              console.log(`[SchemaCompiler] After findNamedGroup for ${groupRef}:`, !!namedGroup);
            }
            if (namedGroup) {
              if (compiled.name === 'schema__type') {
                console.log(`[SchemaCompiler] Before recursive extract for ${groupRef}, current elements:`, compiled.elements.length);
              }
              this.extractElementsAndAttributesFromGroup(namedGroup, nestedCompositorMinOccurs, nestedCompositorMaxOccurs, nestedCompositorType, compiled, seen);
              if (compiled.name === 'schema__type') {
                console.log(`[SchemaCompiler] After recursive extract for ${groupRef}, new elements:`, compiled.elements.length);
              }
            }
          }
        }
      }

      // Recursively handle deeper nesting
      this.extractNestedCompositorElementsWithGroupTracking(nestedCompositor, nestedCompositorType, compiled, seen);
    }
  }

  /**
   * Load imported schemas (xs:import, xs:include).
   * Note: This requires an external resolver function for URL loading.
   */
  private loadImports(schema: any): void {
    if (!schema || typeof schema !== 'object') return;

    const imports = schema[`${this.nsPrefix}:import`] || schema['import'];
    if (imports) {
      const importArray = Array.isArray(imports) ? imports : [imports];
      for (const imp of importArray) {
        const attrs = getXmlAttrs(imp);
        const namespace = attrs.namespace;
        const location = attrs.schemaLocation;
        if (namespace && location) {
          this.schemasByNamespace.set(namespace, { location, loaded: false });
        }
      }
    }

    const includes = schema[`${this.nsPrefix}:include`] || schema['include'];
    if (includes) {
      const includeArray = Array.isArray(includes) ? includes : [includes];
      for (const inc of includeArray) {
        const attrs = getXmlAttrs(inc);
        const location = attrs.schemaLocation;
        if (location) {
          this.schemasByNamespace.set('', { location, loaded: false });
        }
      }
    }
  }

  /**
   * Extract validation facets from an xs:restriction element.
   * Facets define constraints on values (length, pattern, range, etc.)
   */
  private extractFacets(restriction: any): ValidationFacets {
    const facets: ValidationFacets = {};
    if (!restriction || typeof restriction !== 'object') return facets;

    // Define all facet types to look for (both with and without namespace)
    const facetMappings: Record<string, keyof ValidationFacets> = {
      'minLength': 'minLength',
      'maxLength': 'maxLength',
      'length': 'length',
      'pattern': 'pattern',
      'whiteSpace': 'whiteSpace',
      'minInclusive': 'minInclusive',
      'maxInclusive': 'maxInclusive',
      'minExclusive': 'minExclusive',
      'maxExclusive': 'maxExclusive',
      'fractionDigits': 'fractionDigits',
      'totalDigits': 'totalDigits',
      'enumeration': 'enumeration',
    };

    for (const [facetName, facetKey] of Object.entries(facetMappings)) {
      const withPrefix = `${this.nsPrefix}:${facetName}`;
      const facetElements = restriction[withPrefix] || restriction[facetName];
      
      if (facetElements) {
        const facetArray = Array.isArray(facetElements) ? facetElements : [facetElements];
        
        for (const facetElem of facetArray) {
          const attrs = getXmlAttrs(facetElem);
          const value = attrs.value;
          
          if (value !== undefined) {
            if (facetName === 'enumeration') {
              // Collect all enumeration values
              if (!facets.enumeration) {
                facets.enumeration = [];
              }
              if (typeof value === 'string') {
                (facets.enumeration as string[]).push(value);
              }
            } else if (facetName === 'whiteSpace') {
              // whiteSpace is categorical
              (facets as any)[facetKey] = value as 'preserve' | 'replace' | 'collapse';
            } else if (facetName === 'pattern') {
              // pattern is a regex string
              (facets as any)[facetKey] = value;
            } else {
              // Numeric facets
              const numericValue = isNaN(Number(value)) ? value : Number(value);
              (facets as any)[facetKey] = numericValue;
            }
          }
        }
      }
    }

    return facets;
  }

  /**
   * Get a type by name (with optional namespace).
   * Handles namespace prefixes automatically.
   */
  public getType(typeName: string): CompiledType | undefined {
    if (!typeName) return undefined;

    // Try direct lookup
    let type = this.typeMap.get(typeName);
    if (type) return type;

    // Try stripping namespace prefix
    const normalized = typeName.replace(/^.*:/, '');
    type = this.typeMap.get(normalized);
    if (type) return type;

    return undefined;
  }

  /**
   * Get a global element definition by name.
   * Handles namespace prefixes automatically.
   */
  public getElement(elementName: string): any {
    if (!elementName) return undefined;

    console.log('[CompiledSchema.getElement] called with:', elementName, 'elementMap size:', this.elementMap.size);

    // Try direct lookup
    let elem = this.elementMap.get(elementName);
    if (elem) return elem;

    // Try stripping namespace prefix
    const normalized = elementName.replace(/^.*:/, '');
    elem = this.elementMap.get(normalized);
    if (elem) return elem;

    return undefined;
  }

  /**
   * Resolve a type, following the inheritance chain (extension/restriction/union).
   * Returns flattened type info with all inherited elements and attributes.
   */
  public resolveType(typeName: string): CompiledType | undefined {
    const type = this.getType(typeName);
    if (!type) return undefined;

    // If no base type, return as-is
    if (!type.baseType) return type;

    // Resolve base type
    const baseType = this.getType(type.baseType);
    if (!baseType) return type;

    // Merge base type elements and attributes
    const resolved: CompiledType = {
      ...type,
      elements: [...(baseType.elements || []), ...(type.elements || [])],
      attributes: [...(baseType.attributes || []), ...(type.attributes || [])],
    };

    // Recursively resolve base of base if needed
    if (baseType.baseType) {
      const furtherResolved = this.resolveType(baseType.name);
      if (furtherResolved && furtherResolved.baseType !== baseType.baseType) {
        resolved.elements = [...(furtherResolved.elements || []), ...resolved.elements];
        resolved.attributes = [...(furtherResolved.attributes || []), ...resolved.attributes];
      }
    }

    return resolved;
  }

  /**
   * Expand union members for a type.
   * Returns all possible types in the union.
   */
  public expandUnion(typeName: string): CompiledType[] {
    const type = this.getType(typeName);
    if (!type || !type.unionMemberTypes) return type ? [type] : [];

    return type.unionMemberTypes
      .map((memberType) => this.getType(memberType))
      .filter((t): t is CompiledType => t !== undefined);
  }

  /**
   * Get all child elements for a type (flattened with inheritance).
   */
  public getElements(typeName: string): CompiledElement[] {
    const type = this.resolveType(typeName);
    return type?.elements || [];
  }

  /**
   * Get all attributes for a type (flattened with inheritance).
   */
  public getAttributes(typeName: string): CompiledAttribute[] {
    const type = this.resolveType(typeName);
    return type?.attributes || [];
  }

  /**
   * Get enumeration values for a type.
   */
  public getEnumerations(typeName: string): string[] {
    const type = this.getType(typeName);
    return type?.enumerations || [];
  }

  /**
   * Get validation facets for a type.
   * Facets include constraints like min/max length, pattern, min/max values, etc.
   */
  public getFacets(typeName: string): ValidationFacets | undefined {
    const type = this.getType(typeName);
    return type?.facets;
  }

  /**
   * Get a global element by name.
   */
  /**
   * Check if a type exists.
   */
  public hasType(typeName: string): boolean {
    return this.getType(typeName) !== undefined;
  }

  /**
   * Get all indexed type names.
   */
  public getAllTypeNames(): string[] {
    return Array.from(this.typeMap.keys());
  }

  /**
   * Get all global element names (elements defined at schema level).
   */
  public getAllElementNames(): string[] {
    return Array.from(this.elementMap.keys());
  }

  /**
   * Resolve child element data, handling wrapped values at the root level.
   * 
   * When the form initializes, instance values may be wrapped like { person: {...} }.
   * This helper checks if value is wrapped and unwraps it if needed before looking up child data.
   * 
   * Usage:
   *   // At root: element.tagName = "person", value = { person: { firstName: "John", ... } }
   *   const firstNameData = compiledSchema.resolveChildData("firstName", "person", value, true);
   *   // Returns: "John"
   * 
   * @param childElementName - Name of the child element to look up (e.g., "firstName")
   * @param rootElementName - Name of the root element (e.g., "person") - only used for root level
   * @param value - The instance data object (may be wrapped or unwrapped)
   * @param isRootLevel - Whether we're at the root level (path.length === 0)
   * @returns The child data value, or undefined if not found
   */
  public resolveChildData(
    childElementName: string,
    rootElementName: string | undefined,
    value: any,
    isRootLevel: boolean
  ): any {
    const candidateNames = new Set<string>();
    const normalizedBase = String(childElementName || '').replace(/^.*:/, '');

    if (childElementName) candidateNames.add(childElementName);
    if (normalizedBase && normalizedBase !== childElementName) candidateNames.add(normalizedBase);
    if (normalizedBase) candidateNames.add(`xs:${normalizedBase}`);
    if (normalizedBase) candidateNames.add(`xsd:${normalizedBase}`);

    for (const key of candidateNames) {
      const result = value?.[key];
      if (result !== undefined) return result;
    }

    // If at root level and value might be wrapped, try unwrapping
    if (isRootLevel && rootElementName && value && typeof value === 'object' && !Array.isArray(value)) {
      // Check if value is wrapped: { person: {...} }
      const nonAttrKeys = Object.keys(value).filter(k => !k.startsWith('@'));
      if (nonAttrKeys.length === 1 && nonAttrKeys[0] === rootElementName) {
        const unwrappedValue = value[rootElementName];
        if (typeof unwrappedValue === 'object' && unwrappedValue !== null) {
          for (const key of candidateNames) {
            const result = unwrappedValue[key];
            if (result !== undefined) return result;
          }
        }
      }
    }

    return undefined;
  }
}

/**
 * Factory function to create a compiled schema from a parsed XSD object.
 */
export function compileSchema(schema: any): CompiledSchema {
  return new CompiledSchema(schema);
}
