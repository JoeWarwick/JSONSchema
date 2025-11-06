/**
 * Generates a JSON Schema from a given JSON object
 */
export function generateSchema(json: unknown): Record<string, unknown> {
  if (json === null) {
    return { type: "null" };
  }

  if (Array.isArray(json)) {
    if (json.length === 0) {
      return {
        type: "array",
        items: {},
      };
    }
    return {
      type: "array",
      items: generateSchema(json[0]),
    };
  }

  const type = typeof json;

  if (type === "object") {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
      properties[key] = generateSchema(value);
      if (value !== null && value !== undefined) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  if (type === "string") {
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
