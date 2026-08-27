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
  }

  /**
   * Index all types in a schema.
   */
  private indexTypes(schema: any, namespace?: string): void {
    if (!schema || typeof schema !== 'object') return;

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
      if (!compositor) continue;

      const compositorType = compositorKey.replace(/^.*:/, '') as 'sequence' | 'choice' | 'all';
      if (!compiled.compositorType) {
        compiled.compositorType = compositorType;
      }

      // Get elements from compositor
      const elements = compositor[`${this.nsPrefix}:element`] || compositor['element'];
      if (elements) {
        const elemArray = Array.isArray(elements) ? elements : [elements];
        for (const elem of elemArray) {
          const attrs = getXmlAttrs(elem);
          compiled.elements.push({
            name: attrs.name || '',
            type: attrs.type,
            minOccurs: parseInt(attrs.minOccurs ?? '1', 10),
            maxOccurs: attrs.maxOccurs ?? '1',
            compositorType,
          });
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
  public getElement(elementName: string): any {
    return this.elementMap.get(elementName);
  }

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
}

/**
 * Factory function to create a compiled schema from a parsed XSD object.
 */
export function compileSchema(schema: any): CompiledSchema {
  return new CompiledSchema(schema);
}
