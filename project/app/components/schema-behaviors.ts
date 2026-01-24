/**
 * Converts SchemaNodeData to a JSON Schema object (Record<string, unknown>).
 */
export function schemaNodeDataToSchema(node: SchemaNodeData): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    type: node.type === 'image' ? 'string' : node.type,
    title: node.label,
  };
  // Default annotations for internal `image` node type
  if (node.type === 'image') {
    if (node.format === undefined) schema.format = 'data-url';
    if (node.contentMediaType === undefined) schema.contentMediaType = 'image/*';
  }
  if (node.format !== undefined) schema.format = node.format;
  if (node.contentMediaType !== undefined) schema.contentMediaType = node.contentMediaType;
  if (node.pattern !== undefined) schema.pattern = node.pattern;
  if (node.description !== undefined) schema.description = node.description;
  if (node.minimum !== undefined) schema.minimum = node.minimum;
  if (node.maximum !== undefined) schema.maximum = node.maximum;
  if (node.exclusiveMinimum !== undefined) schema.exclusiveMinimum = node.exclusiveMinimum;
  if (node.exclusiveMaximum !== undefined) schema.exclusiveMaximum = node.exclusiveMaximum;
  if (node.minLength !== undefined) schema.minLength = node.minLength;
  if (node.maxLength !== undefined) schema.maxLength = node.maxLength;
  if (node.multipleOf !== undefined) schema.multipleOf = node.multipleOf;
  if (node.minItems !== undefined) schema.minItems = node.minItems;
  if (node.maxItems !== undefined) schema.maxItems = node.maxItems;
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
  return schema;
}
/**
 * Adds a new property to an object schema.
 */
export function addPropertyToSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = (schema.properties as Record<string, unknown>) || {};
  // Count only visible properties (ignore internal markers)
  const visibleCount = Object.keys(properties).filter(k => !k.startsWith('__')).length;
  const newPropertyName = `newProperty${visibleCount + 1}`;
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
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: boolean | number;
  exclusiveMaximum?: boolean | number;
  minLength?: number;
  maxLength?: number;
  multipleOf?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  deprecated?: boolean;
  const?: any;
  examples?: unknown[];
  imported?: boolean;
  $ref?: string;
  contentMediaType?: string;
}

export interface GraphicalSchemaEditorProps {
  schema: Record<string, unknown>;
  onChange: (schema: Record<string, unknown>) => void;
  useTestData?: boolean;
}

/**
 * Returns a patch object for a node when its type is changed, applying special behaviors.
 * For example, clearing incompatible fields, setting defaults, etc.
 */
export function handleTypeChange(newType: SchemaNodeType, prevData: SchemaNodeData): Partial<SchemaNodeData> {
  const patch: Partial<SchemaNodeData> = { type: newType };

  // Reset fields that are not compatible with the new type
  if (newType === "array") {
    patch.ofType = prevData.ofType || "string"; // default to string if not set
    patch.enum = undefined;
    patch.default = undefined;
  } else if (newType === "object") {
    patch.ofType = undefined;
    patch.enum = undefined;
    patch.default = undefined;
  } else if (["string", "number", "boolean", "null", "image"].includes(newType)) {
    patch.ofType = undefined;
    // Keep enum and default for primitives
  }
  return patch;
}

/**
 * Returns a patch object for a node when its ofType is changed (for arrays).
 */
export function handleOfTypeChange(newOfType: SchemaNodeType, prevData: SchemaNodeData): Partial<SchemaNodeData> {
  const patch: Partial<SchemaNodeData> = { ofType: newOfType };
  // If switching to a primitive, allow enum/default; if to object, clear enum/default
  if (newOfType === "object") {
    patch.enum = undefined;
    patch.default = undefined;
  }
  return patch;
}
