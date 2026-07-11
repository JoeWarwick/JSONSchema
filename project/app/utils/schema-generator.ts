/**
 * Validates a JSON Schema for structural correctness.
 * Specifically checks for invalid array/object hoisting at the root.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateSchema(schema: Record<string, unknown>): string | null {
  if (!schema || typeof schema !== 'object') return 'Schema must be an object.';
  const type = schema.type;
  if (type === 'array') {
    const items = schema.items;
    if (!items || typeof items !== 'object') {
      return 'Array type must have a valid items schema.';
    }
    // items object schema is valid even without properties yet (user can add them)
  }
  // Add more checks as needed
  return null;
}
/**
 * Generates a JSON Schema from a given JSON object
 */
export function generateSchema(json: unknown, depth = 0, ancestors = new WeakSet<object>()): Record<string, unknown> {
  const MAX_DEPTH = 30;

  if (depth >= MAX_DEPTH) {
    return { type: Array.isArray(json) ? "array" : "object", description: "Maximum recursion depth reached" };
  }

  if (json === null) {
    return { type: "null" };
  }

  if (Array.isArray(json)) {
    if (ancestors.has(json)) {
      return { type: "array", description: "Circular reference detected" };
    }

    ancestors.add(json);
    try {
      if (json.length === 0) {
        return {
          type: "array",
          items: {},
        };
      }
      return {
        type: "array",
        items: generateSchema(json[0], depth + 1, ancestors),
      };
    } finally {
      ancestors.delete(json);
    }
  }

  const type = typeof json;

  if (type === "object") {
    const objectValue = json as Record<string, unknown>;

    if (ancestors.has(objectValue)) {
      return { type: "object", description: "Circular reference detected" };
    }

    ancestors.add(objectValue);
    try {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(objectValue)) {
        properties[key] = generateSchema(value, depth + 1, ancestors);
        if (value !== null && value !== undefined) {
          required.push(key);
        }
      }

      return {
        type: "object",
        properties,
        required: required.length > 0 ? required : undefined,
      };
    } finally {
      ancestors.delete(objectValue);
    }
  }

  if (type === "string") {
    const s = json as string;
    // Detect data URLs or common image URLs/extensions
    const dataImage = /^data:image\//i.test(s);
    const urlImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(s) || /^https?:\/\/.+\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(s);
    if (dataImage || urlImage) {
      return { type: "string", format: "data-url", contentMediaType: "image/*" };
    }
    return { type: "string" };
  }

  if (type === "number") {
    return { type: "number" };
  }

  if (type === "boolean") {
    return { type: "boolean" };
  }

  return { type: "string" };
}

/**
 * Validates if a string is valid JSON
 */
export function isValidJSON(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}
