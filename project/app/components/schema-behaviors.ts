/**
 * Converts SchemaNodeData to a JSON Schema object (Record<string, unknown>).
 */
export function schemaNodeDataToSchema(node: SchemaNodeData): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    type: node.type,
    title: node.label,
  };
  if (node.format !== undefined) schema.format = node.format;
  if (node.contentMediaType !== undefined) schema.contentMediaType = node.contentMediaType;
  if (node.pattern !== undefined) schema.pattern = node.pattern;
  if (node.description !== undefined) schema.description = node.description;
  // Support round-tripping of JSON Schema "$comment" into the editor node model
  if ((node as any).$comment !== undefined) (schema as any).$comment = (node as any).$comment;
  if (node.minimum !== undefined) schema.minimum = node.minimum;
  if (node.maximum !== undefined) schema.maximum = node.maximum;
  if (node.exclusiveMinimum !== undefined) schema.exclusiveMinimum = node.exclusiveMinimum;
  if (node.exclusiveMaximum !== undefined) schema.exclusiveMaximum = node.exclusiveMaximum;
  if (node.minLength !== undefined) schema.minLength = node.minLength;
  if (node.maxLength !== undefined) schema.maxLength = node.maxLength;
  if (node.multipleOf !== undefined) schema.multipleOf = node.multipleOf;
  if (node.minItems !== undefined) schema.minItems = node.minItems;
  if (node.maxItems !== undefined) schema.maxItems = node.maxItems;
  if (node.minProperties !== undefined) (schema as any).minProperties = node.minProperties;
  if (node.maxProperties !== undefined) (schema as any).maxProperties = node.maxProperties;
  if (node.uniqueItems !== undefined) schema.uniqueItems = node.uniqueItems;
  if (node.readOnly !== undefined) schema.readOnly = node.readOnly;
  if (node.writeOnly !== undefined) schema.writeOnly = node.writeOnly;
  if (node.deprecated !== undefined) schema.deprecated = node.deprecated;
  if (node.const !== undefined) schema.const = node.const;
  if (node.examples !== undefined) schema.examples = node.examples;
  if (node.ofType) {
    schema.items = { type: node.ofType };
    // If the node has an enum and it's an array type, treat the enum as items.enum
    if (Array.isArray(node.enum) && node.enum.length > 0) {
      (schema.items as any).enum = node.enum;
    }
    // If items object explicitly contains enum, prefer that
    if (node.items && typeof node.items === 'object' && Array.isArray((node.items as any).enum) && (node.items as any).enum.length > 0) {
      (schema.items as any).enum = (node.items as any).enum;
    }
  }
  // For primitive nodes (non-array), serialize node.enum as schema.enum
  if (!(node.ofType) && node.enum && Array.isArray(node.enum) && node.enum.length > 0) {
    schema.enum = node.enum;
  }
  if (node.default !== undefined && node.default !== "") {
    schema.default = node.default;
  }
  // `required` is represented on the parent object as an array of property names.
  // Individual property nodes should not serialize their own `required` array here.
  // Recursively serialize properties for object type
  if (node.type === "object" && node.properties && typeof node.properties === "object") {
    const serializedProps: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node.properties)) {
      // Skip internal markers which are not real property names
      if (key.startsWith('__')) continue;
      if (value && typeof value === 'object') {
        // Recursively serialize each property node
        serializedProps[key] = schemaNodeDataToSchema(value as SchemaNodeData);
      } else {
        serializedProps[key] = value;
      }
    }
    schema.properties = serializedProps;
  }
  // Support additionalProperties on object nodes
  if (node.type === 'object' && (node as any).additionalProperties !== undefined) {
    schema.additionalProperties = (node as any).additionalProperties;
  }
  return schema;
}
/**
 * Adds a new property to an object schema.
 */
export function addPropertyToSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = (schema.properties as Record<string, unknown>) || {};
  
  let i = 1;
  while (properties[`newProperty${i}`]) {
    i++;
  }
  const newPropertyName = `newProperty${i}`;
  
  return {
    ...schema,
    properties: {
      ...properties,
      [newPropertyName]: { type: "string" },
    },
  };
}

/**
 * Removes a property from an object schema.
 */
export function removePropertyFromSchema(schema: Record<string, unknown>, propertyName: string): Record<string, unknown> {
  const properties = { ...(schema.properties as Record<string, unknown>) };
  delete properties[propertyName];
  const required = (schema.required as string[]) || [];
  const newRequired = required.filter((r) => r !== propertyName);
  return {
    ...schema,
    properties,
    required: newRequired.length > 0 ? newRequired : undefined,
  };
}

/**
 * Updates a nested property in an object schema.
 */
export function updateNestedPropertyInSchema(schema: Record<string, unknown>, propertyName: string, newValue: Record<string, unknown>): Record<string, unknown> {
  const properties = (schema.properties as Record<string, unknown>) || {};
  return {
    ...schema,
    properties: {
      ...properties,
      [propertyName]: newValue,
    },
  };
}

/**
 * Adds a patternProperties entry to an object schema. The key will be the provided regex
 * (or an auto-generated one if none provided). Returns the updated schema.
 */
export function addPatternPropertyToSchema(schema: Record<string, unknown>, pattern?: string): Record<string, unknown> {
  const patternProperties = schema.patternProperties ? { ...(schema.patternProperties as Record<string, unknown>) } : {};
  // Choose a safe default pattern if none provided
  let key = pattern || '^pattern$';
  // Ensure uniqueness by appending a counter if required
  if (patternProperties[key]) {
    let i = 1;
    while (patternProperties[`${key.replace(/\$$/, '')}_${i}$`]) i++;
    key = `${key.replace(/\$$/, '')}_${i}$`;
  }
  return {
    ...schema,
    patternProperties: {
      ...patternProperties,
      [key]: { type: 'string' },
    },
  };
}

/**
 * Removes a patternProperties entry by key and cleans up the parent if empty.
 */
export function removePatternPropertyFromSchema(schema: Record<string, unknown>, patternKey: string): Record<string, unknown> {
  const patternProperties = schema.patternProperties ? { ...(schema.patternProperties as Record<string, unknown>) } : {};
  delete patternProperties[patternKey];
  return {
    ...schema,
    patternProperties: Object.keys(patternProperties).length > 0 ? patternProperties : undefined,
  };
}

/**
 * Updates (replaces) the subschema for a given patternProperties key.
 */
export function updatePatternPropertyInSchema(schema: Record<string, unknown>, patternKey: string, newSubschema: Record<string, unknown>): Record<string, unknown> {
  const patternProperties = schema.patternProperties ? { ...(schema.patternProperties as Record<string, unknown>) } : {};
  return {
    ...schema,
    patternProperties: {
      ...patternProperties,
      [patternKey]: newSubschema,
    },
  };
}

/**
 * Rename a patternProperties key from `oldKey` to `newKey`.
 * If `newKey` already exists, will append a suffix `_1`, `_2`, ... until unique.
 */
export function renamePatternPropertyInSchema(schema: Record<string, unknown>, oldKey: string, newKey: string): Record<string, unknown> {
  const patternProperties = schema.patternProperties ? { ...(schema.patternProperties as Record<string, unknown>) } : {};
  if (!Object.prototype.hasOwnProperty.call(patternProperties, oldKey)) return schema;
  let key = newKey;
  if (oldKey !== newKey && Object.prototype.hasOwnProperty.call(patternProperties, key)) {
    let i = 1;
    while (Object.prototype.hasOwnProperty.call(patternProperties, `${key}_${i}`)) i++;
    key = `${key}_${i}`;
  }
  const value = patternProperties[oldKey];
  delete patternProperties[oldKey];
  patternProperties[key] = value;
  return {
    ...schema,
    patternProperties: Object.keys(patternProperties).length > 0 ? patternProperties : undefined,
  };
}

/**
 * Resolves the schema for additionalProperties (which can be boolean or object).
 * Returns a Record<string, unknown> if allowed, or null if denied (false).
 */
export function getAdditionalPropertiesSchema(ap: any): Record<string, unknown> | null {
  if (ap === false) return null;
  if (ap === true || ap === undefined) return {};
  if (typeof ap === 'object' && ap !== null) return ap as Record<string, unknown>;
  return {};
}

// schema-behaviors.ts
// Centralized types and shared edit actions for schema-form and graphical-schema-editor

// Node types: object, array, primitive
export type SchemaNodeType = "object" | "array" | "string" | "number" | "boolean" | "null" | "image";

export interface SchemaNodeData {
  id: string;
  label: string;
  type: SchemaNodeType;
  ofType?: SchemaNodeType;
  parent?: string;
  enum?: Array<string | number> | boolean;
  default?: any;
  required?: boolean;
  items?: SchemaNodeData[] | Record<string, unknown>;
  properties?: Record<string, unknown>;
  // Additional optional annotations
  format?: string;
  pattern?: string;
  description?: string;
  // Used for patternProperties nodes to store the regex key (UI-only)
  patternKey?: string;
  // Optional $comment annotation mapped from JSON Schema
  $comment?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: boolean | number;
  exclusiveMaximum?: boolean | number;
  minLength?: number;
  maxLength?: number;
  multipleOf?: number;
  minItems?: number;
  maxItems?: number;
  minProperties?: number;
  maxProperties?: number;
  uniqueItems?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  deprecated?: boolean;
  const?: any;
  examples?: unknown[];
  imported?: boolean;
  $ref?: string;
  contentMediaType?: string;
  contentEncoding?: string;
  additionalProperties?: boolean | Record<string, unknown>;
  // Combiner node fields (type === 'combiner')
  combinerType?: 'oneOf' | 'anyOf' | 'allOf';
  variantCount?: number;
  // Variant node fields (type === 'variant')
  isCombinerVariant?: boolean;
  variantIndex?: number;
  variantRef?: string;
  variantResolved?: boolean;
  variantExpanded?: boolean;
  variantSchema?: Record<string, unknown>;
  isResolving?: boolean;
  // Handler callbacks injected into combiner/variant node data by GraphicalSchemaEditor
  onToggleVariant?: (id: string) => void;
  onAddVariant?: (id: string) => void;
  onChangeCombinerType?: (id: string, type: string) => void;
  onDeleteVariant?: (id: string) => void;
  // Combiner expand/collapse all variants at once
  variantsExpanded?: boolean;
  onToggleVariants?: (id: string) => void;
}

export interface GraphicalSchemaEditorProps {
  schema: Record<string, unknown>;
  onChange: (schema: Record<string, unknown>) => void;
  useTestData?: boolean;
}
