/**
 * XSD Schema Constants and Utilities
 * Shared constants for XML Schema Definition (W3C XSD) editing
 */

// XSD Compositor types - these represent sequence/choice/all structures
export const XML_COMPOSITOR_TYPES = ['xs:sequence', 'xs:choice', 'xs:all'] as const;
export type XmlCompositorType = typeof XML_COMPOSITOR_TYPES[number];

export const isXmlCompositor = (tag: string): tag is XmlCompositorType => 
  XML_COMPOSITOR_TYPES.includes(tag as XmlCompositorType);

// Simple type facet tags (constraints for xs:simpleType)
export const SIMPLE_TYPE_FACET_TAGS = [
  'xs:minInclusive',
  'xs:maxInclusive',
  'xs:minExclusive',
  'xs:maxExclusive',
  'xs:minLength',
  'xs:maxLength',
  'xs:length',
  'xs:pattern',
  'xs:whiteSpace',
  'xs:enumeration',
  'xs:fractionDigits',
  'xs:totalDigits',
] as const;

// Built-in XSD simple types
export const XSD_BUILTIN_SIMPLE_TYPES = [
  'xs:string',
  'xs:integer',
  'xs:decimal',
  'xs:boolean',
  'xs:date',
  'xs:time',
  'xs:dateTime',
  'xs:duration',
  'xs:float',
  'xs:double',
  'xs:base64Binary',
  'xs:hexBinary',
  'xs:anyURI',
  'xs:QName',
  'xs:normalizedString',
  'xs:token',
  'xs:language',
  'xs:Name',
  'xs:NCName',
  'xs:long',
  'xs:int',
  'xs:short',
  'xs:byte',
  'xs:nonNegativeInteger',
  'xs:positiveInteger',
  'xs:nonPositiveInteger',
  'xs:negativeInteger',
  'xs:unsignedLong',
  'xs:unsignedInt',
  'xs:unsignedShort',
  'xs:unsignedByte',
] as const;

// Attribute use values (required/optional/prohibited)
export const ATTRIBUTE_USE_VALUES = ['required', 'optional', 'prohibited'] as const;
export type AttributeUse = typeof ATTRIBUTE_USE_VALUES[number];

// Storage key prefix for ref expansions
export const REF_EXPANSION_STORAGE_PREFIX = 'xml-schema-ref-expanded';

// Storage key prefix for compositor variants
export const COMPOSITOR_VARIANT_STORAGE_PREFIX = 'xml-schema-compositor';

// Storage key prefix for editor layout state
export const EDITOR_LAYOUT_STORAGE_PREFIX = 'xml-schema-layout';

/**
 * Generate a storage key for tracking expanded refs
 * @param schemaIdentity - $ref, $id, or hash of schema
 * @param refName - The name of the ref being expanded
 * @returns Storage key suitable for localStorage
 */
export const generateRefExpansionKey = (schemaIdentity: string, refName: string): string => {
  return `${REF_EXPANSION_STORAGE_PREFIX}:${schemaIdentity}:${refName}`;
};

/**
 * Generate a storage key for tracking compositor variant selection
 * @param schemaIdentity - $ref, $id, or hash of schema
 * @param path - XML path to compositor
 * @returns Storage key suitable for localStorage
 */
export const generateCompositorVariantKey = (schemaIdentity: string, path: string): string => {
  return `${COMPOSITOR_VARIANT_STORAGE_PREFIX}:${schemaIdentity}:${path}`;
};

/**
 * Generate a storage key for tracking editor layout/expansion state
 * @param schemaIdentity - $ref, $id, or hash of schema
 * @param path - XML path to node
 * @returns Storage key suitable for localStorage
 */
export const generateEditorLayoutKey = (schemaIdentity: string, path: string): string => {
  return `${EDITOR_LAYOUT_STORAGE_PREFIX}:${schemaIdentity}:${path}`;
};
