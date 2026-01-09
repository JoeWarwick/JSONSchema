/**
 * Converts SchemaNodeData to a JSON Schema object (Record<string, unknown>).
 */
export function schemaNodeDataToSchema(node: SchemaNodeData): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    type: node.type,
    title: node.label,
  };
  if (node.ofType) {
    schema.items = { type: node.ofType };
  }
  if (node.enum && Array.isArray(node.enum) && node.enum.length > 0) {
    schema.enum = node.enum;
  }
  if (node.default !== undefined && node.default !== "") {
    schema.default = node.default;
  }
  if (node.required) {
    schema.required = [node.label];
  }
  // Add properties if present (for object type)
  if (node.type === "object" && node.properties && typeof node.properties === "object") {
    schema.properties = node.properties;
  }
  return schema;
}
/**
 * Adds a new property to an object schema.
 */
export function addPropertyToSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = (schema.properties as Record<string, unknown>) || {};
  const newPropertyName = `newProperty${Object.keys(properties).length + 1}`;
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

// schema-behaviors.ts
// Centralized types and shared edit actions for schema-form and graphical-schema-editor

// Node types: object, array, primitive
export type SchemaNodeType = "object" | "array" | "string" | "number" | "boolean" | "null";

export interface SchemaNodeData {
  id: string;
  label: string;
  type: SchemaNodeType;
  ofType?: SchemaNodeType;
  parent?: string;
  enum?: boolean;
  default?: string;
  required?: boolean;
  items?: SchemaNodeData[];
  properties?: Record<string, unknown>;
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
  } else if (["string", "number", "boolean", "null"].includes(newType)) {
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
