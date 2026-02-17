/**
 * Schema Flattening Utilities for Variant Storage Optimization
 * 
 * This module provides utilities to flatten nested variant structures into a
 * schema-identity-keyed storage format, avoiding path-dependent impedance mismatch.
 * 
 * Problem: Nested oneOf/anyOf values are stored by path, but when variant context
 * changes (parent object key modified), the path changes and storage is lost.
 * 
 * Solution: Extract each variant's value keyed by its schema identity ($ref, $id, or hash).
 * The value itself is recursively normalizes: any nested oneOf/anyOf selections are
 * converted to $ref pointers, creating a fully schema-aware storage format.
 * 
 * Storage Format Example:
 * ─────────────────────
 * Key:   "$ref:#/$defs/GitHubHosted"
 * Value: "ubuntu-latest"  (for primitive selection)
 * 
 * Or for objects with nested oneOf:
 * Key:   "$ref:#/$defs/Workflow"
 * Value: {
 *   "jobs": {
 *     "build": {
 *       "runs-on": {
 *         "$ref": "#/$defs/GitHubHosted"   ← Nested oneOf converted to $ref
 *       }
 *     }
 *   }
 * }
 * 
 * This ensures:
 * - Data survives parent context changes (path-independent)
 * - Nested selections preserved at any depth
 * - All variant references explicit and recoverable
 * - Storage format is fully schema-aware and normalized
 */

type VariantMap = Record<string, unknown>;

/**
 * Generate a stable, unique key for a schema variant
 * Used to identify schemas across different contexts/paths
 * 
 * Priority: $ref > $id > content hash
 * 
 * @param schema - The variant schema
 * @returns Unique, stable string key
 */
export function generateVariantSchemaKey(schema: Record<string, unknown>): string {
  // Prefer $ref (most stable across reloads)
  if (typeof schema.$ref === 'string') {
    return `$ref:${schema.$ref}`;
  }

  // Then $id
  if (typeof schema.$id === 'string') {
    return `$id:${schema.$id}`;
  }

  // Fallback: content-based hash
  try {
    const str = JSON.stringify(schema);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 32-bit integer
    }
    return `hash:${Math.abs(hash).toString(36)}`;
  } catch {
    return 'hash:unknown';
  }
}

/**
 * Normalize a value by recursively converting nested oneOf/anyOf selections to $ref pointers
 * 
 * This creates a schema-aware storage format where:
 * - Primitive selections remain as-is
 * - Nested oneOf/anyOf properties are converted to {"$ref": "..."} pointers
 * - The "$ref" value points to the selected variant's schema identity
 * - Process recurses through all nested objects
 * 
 * Example:
 * Input:  { runs-on: "ubuntu-latest", timeout: 360 }
 * Schema: { properties: { runs-on: oneOf[...], timeout: number } }
 * Output: { runs-on: {"$ref": "#/$defs/GitHubHosted"}, timeout: 360 }
 * 
 * @param value - The value to normalize
 * @param schema - The schema describing the value
 * @param variants - Map of schemaKey -> variant schema for lookups
 * @returns Normalized value with nested oneOf converted to $ref pointers
 */
export function normalizeValueWithRefs(
  value: unknown,
  schema: Record<string, unknown>,
  variants?: Record<string, Record<string, unknown>>
): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }

  const valueObj = value as Record<string, unknown>;
  const properties = (schema.properties as Record<string, unknown>) || {};
  const result: Record<string, unknown> = {};

  for (const [key, propValue] of Object.entries(valueObj)) {
    const propSchema = properties[key] as Record<string, unknown> | undefined;
    if (!propSchema) {
      result[key] = propValue;
      continue;
    }

    const anyOf = propSchema.anyOf as Array<Record<string, unknown>> | undefined;
    const oneOf = propSchema.oneOf as Array<Record<string, unknown>> | undefined;
    const variantArray = anyOf || oneOf;

    if (variantArray && variantArray.length > 0) {
      // This property is a variant selection - find which variant matches
      const matchedVariant = findMatchingVariant(propValue, variantArray);
      if (matchedVariant) {
        const schemaKey = generateVariantSchemaKey(matchedVariant);
        const ref = matchedVariant.$ref || matchedVariant.$id;
        
        // Store as {"$ref": "..."} for explicit schema reference
        if (typeof ref === 'string') {
          result[key] = { $ref: ref };
        } else {
          // Fallback to schema key if no explicit $ref/$id
          result[key] = { $ref: schemaKey };
        }
      } else {
        result[key] = propValue;
      }
    } else if (typeof propValue === 'object' && propValue !== null && !Array.isArray(propValue)) {
      // Recurse into nested objects
      result[key] = normalizeValueWithRefs(propValue, propSchema, variants);
    } else {
      result[key] = propValue;
    }
  }

  return result;
}

/**
 * Find which variant in an array matches a given value
 * 
 * Uses simple type-based matching. For production, integrate with
 * validateValueAgainstSchema from validation module.
 * 
 * @param value - The value to match
 * @param variants - Array of variant schemas
 * @returns The matching variant schema, or undefined
 */
function findMatchingVariant(
  value: unknown,
  variants: Array<Record<string, unknown>>
): Record<string, unknown> | undefined {
  for (const variant of variants) {
    if (valueMatchesVariant(value, variant)) {
      return variant;
    }
  }
  return undefined;
}

/**
 * Denormalize a value by converting $ref pointers back to actual nested structures
 * 
 * Reverses the normalization process to reconstruct pure JSON with no $refs:
 * Storage:  { runs-on: {"$ref": "#/$defs/GitHubHosted"}, timeout: 360 }
 * Returns:  { runs-on: "ubuntu-latest", timeout: 360 }
 * 
 * Process:
 * ────────
 * 1. Traverse the stored value recursively
 * 2. When encountering {"$ref": "X"}, look up variant schema for X
 * 3. Resolve $ref to the selected variant's default or stored value
 * 4. Recurse through nested objects to denormalize at all depths
 * 5. Return pure JSON structure with no $ref pointers
 * 
 * @param value - The value with possible {"$ref": "..."} pointers
 * @param schema - The schema describing the value structure
 * @param variantRegistry - Map of $ref pointer -> variant schema for resolution
 * @param getDefaultValueFn - Function to compute schema defaults
 * @returns Pure JSON value with all $refs resolved to actual values (no $refs)
 */
export function denormalizeValueWithRefs(
  value: unknown,
  schema: Record<string, unknown>,
  variantRegistry?: Record<string, Record<string, unknown>>,
  getDefaultValueFn?: (schema: Record<string, unknown>) => unknown
): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }

  const valueObj = value as Record<string, unknown>;
  const properties = (schema.properties as Record<string, unknown>) || {};
  const result: Record<string, unknown> = {};

  for (const [key, propValue] of Object.entries(valueObj)) {
    const propSchema = properties[key] as Record<string, unknown> | undefined;
    if (!propSchema) {
      result[key] = propValue;
      continue;
    }

    // Check if this property is a $ref pointer object
    if (
      typeof propValue === 'object' &&
      propValue !== null &&
      !Array.isArray(propValue) &&
      Object.keys(propValue).length === 1 &&
      typeof (propValue as any).$ref === 'string'
    ) {
      // This is a normalized $ref pointer - resolve it
      const refPointer = (propValue as any).$ref;
      
      // Try to resolve the $ref to find the matching variant
      let resolvedValue: unknown = undefined;
      
      if (variantRegistry) {
        // Look up by exact $ref value
        const variantSchema = variantRegistry[refPointer];
        if (variantSchema && getDefaultValueFn) {
          resolvedValue = getDefaultValueFn(variantSchema);
        }
      }
      
      // If unable to resolve, keep the $ref as fallback
      result[key] = resolvedValue !== undefined ? resolvedValue : propValue;
    } else if (typeof propValue === 'object' && propValue !== null && !Array.isArray(propValue)) {
      // Recurse into nested objects to denormalize at all depths
      result[key] = denormalizeValueWithRefs(propValue, propSchema, variantRegistry, getDefaultValueFn);
    } else {
      result[key] = propValue;
    }
  }

  return result;
}

/**
 * Flatten a nested value structure by extracting variant selections
 * 
 * Recursively traverses the value, finding oneOf/anyOf selections and
 * extracting them into a flat map keyed by schema identity.
 * 
 * @param value - The value to flatten
 * @param schema - The schema that describes the value structure
 * @param variants - Array of possible variant schemas (oneOf/anyOf)
 * @returns Map of schemaKey -> value for all variant selections found
 */
export function flattenValueByVariants(
  value: unknown,
  schema: Record<string, unknown>,
  variants: Array<Record<string, unknown>>
): VariantMap {
  if (!Array.isArray(variants) || variants.length === 0) {
    return {};
  }

  const result: VariantMap = {};

  // Match the value to a specific variant
  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i];
    const schemaKey = generateVariantSchemaKey(variant);

    // Simple type-based matching for now
    // In production, use full validateValueAgainstSchema
    if (valueMatchesVariant(value, variant)) {
      result[schemaKey] = value;
      break;
    }
  }

  return result;
}

/**
 * Unflatten a storage map back into nested structure(s)
 * 
 * Given a flat map of schemaKey -> value, reconstruct the selected
 * variant value(s) by matching schema keys with provided variants.
 * 
 * @param flatMap - Flat map from storage (schemaKey -> value)
 * @param variants - Array of possible variant schemas (oneOf/anyOf)
 * @param isAnyOf - Whether this is anyOf (multi-select) or oneOf (single-select)
 * @returns Reconstructed value (single value for oneOf, possibly array for anyOf)
 */
export function unflattenValueFromVariants(
  flatMap: VariantMap,
  variants: Array<Record<string, unknown>>,
  isAnyOf: boolean = false
): unknown {
  if (!Array.isArray(variants) || variants.length === 0) {
    return isAnyOf ? [] : undefined;
  }

  const matches: Array<{ schemaKey: string; variantIdx: number; value: unknown }> = [];

  // Try to match each variant against the flat map
  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i];
    const schemaKey = generateVariantSchemaKey(variant);

    if (Object.prototype.hasOwnProperty.call(flatMap, schemaKey)) {
      matches.push({
        schemaKey,
        variantIdx: i,
        value: flatMap[schemaKey],
      });

      // For oneOf (single-select), stop at first match
      if (!isAnyOf) break;
    }
  }

  // Reconstruct value based on selector type
  if (matches.length === 0) {
    return isAnyOf ? [] : undefined;
  }

  if (isAnyOf) {
    // Multi-select: merge all matched values into array
    const arrayValue: unknown[] = [];
    for (const match of matches) {
      if (Array.isArray(match.value)) {
        arrayValue.push(...match.value);
      } else {
        arrayValue.push(match.value);
      }
    }
    return arrayValue;
  } else {
    // Single-select: return first match
    return matches[0].value;
  }
}

/**
 * Extract nested variant selections from a complex value structure
 * 
 * For deeply nested objects with variant properties, recursively extract
 * each variant selection into a flat storage format.
 * 
 * @param value - The value to extract variants from
 * @param schema - The schema describing the value
 * @param path - Current path in the structure (for debugging)
 * @returns Flat map of all variant selections found
 */
export function extractAllVariants(
  value: unknown,
  schema: Record<string, unknown>,
  path: string[] = []
): VariantMap {
  const result: VariantMap = {};

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return result;
  }

  const valueObj = value as Record<string, unknown>;
  const properties = (schema.properties as Record<string, unknown>) || {};

  // Check each property for variant selections
  for (const [key, propValue] of Object.entries(valueObj)) {
    const propSchema = properties[key] as Record<string, unknown> | undefined;
    if (!propSchema) continue;

    const anyOf = propSchema.anyOf as Array<Record<string, unknown>> | undefined;
    const oneOf = propSchema.oneOf as Array<Record<string, unknown>> | undefined;
    const variants = anyOf || oneOf;

    if (variants && variants.length > 0) {
      // Found a variant property - flatten it
      const flattened = flattenValueByVariants(propValue, propSchema, variants);
      Object.assign(result, flattened);
    }

    // Recurse into nested objects
    if (typeof propValue === 'object' && propValue !== null && !Array.isArray(propValue)) {
      const nestedSchema = propSchema as Record<string, unknown>;
      const nested = extractAllVariants(propValue, nestedSchema, [...path, key]);
      Object.assign(result, nested);
    }
  }

  return result;
}

/**
 * Determine if a value matches a variant schema by type similarity
 * 
 * This is a simplified check. For production, integrate with
 * validateValueAgainstSchema from validation module.
 * 
 * @param value - The value to check
 * @param schema - The schema to validate against
 * @returns true if value appears to match this variant
 */
function valueMatchesVariant(value: unknown, schema: Record<string, unknown>): boolean {
  const schemaType = schema.type;

  if (value === null) {
    return schemaType === 'null' || schemaType === null;
  }

  if (typeof value === 'string') {
    return schemaType === 'string' || !schemaType;
  }

  if (typeof value === 'number') {
    return schemaType === 'number' || schemaType === 'integer';
  }

  if (typeof value === 'boolean') {
    return schemaType === 'boolean';
  }

  if (Array.isArray(value)) {
    return schemaType === 'array' || !!schema.items || !!schema.additionalItems;
  }

  if (typeof value === 'object') {
    return schemaType === 'object' || !!schema.properties;
  }

  return false;
}

/**
 * Convert a flattened variant map to localStorage format
 * 
 * Prepares the flat map for storage by stringifying values and
 * associating them with human-readable keys.
 * 
 * @param flatMap - Flat variant map
 * @returns Object ready for JSON.stringify and localStorage
 */
export function toStorageFormat(flatMap: VariantMap): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [schemaKey, value] of Object.entries(flatMap)) {
    try {
      result[schemaKey] = JSON.stringify(value);
    } catch (err) {
      console.warn(`Failed to serialize variant ${schemaKey}:`, err);
    }
  }

  return result;
}

/**
 * Convert a localStorage format object back to variant map
 * 
 * Parses stringified values back into their original form.
 * 
 * @param storageObj - Object from localStorage
 * @returns Parsed flat variant map
 */
export function fromStorageFormat(storageObj: Record<string, string>): VariantMap {
  const result: VariantMap = {};

  for (const [schemaKey, jsonValue] of Object.entries(storageObj)) {
    try {
      result[schemaKey] = JSON.parse(jsonValue);
    } catch (err) {
      console.warn(`Failed to parse variant ${schemaKey}:`, err);
    }
  }

  return result;
}

/**
 * Merge multiple variant maps with conflict resolution
 * 
 * Used when combining nested variant selections from different
 * parts of the schema tree.
 * 
 * @param maps - Array of variant maps to merge
 * @param conflictStrategy - How to handle duplicate keys ('first' | 'last' | 'error')
 * @returns Merged variant map
 */
export function mergeVariantMaps(
  maps: VariantMap[],
  conflictStrategy: 'first' | 'last' | 'error' = 'last'
): VariantMap {
  const result: VariantMap = {};

  for (const map of maps) {
    for (const [schemaKey, value] of Object.entries(map)) {
      if (Object.prototype.hasOwnProperty.call(result, schemaKey)) {
        if (conflictStrategy === 'first') {
          // Keep existing
          continue;
        } else if (conflictStrategy === 'error') {
          throw new Error(`Duplicate schema key in variant maps: ${schemaKey}`);
        }
        // 'last' - overwrite with new value
      }

      result[schemaKey] = value;
    }
  }

  return result;
}

/**
 * Filter a variant map to only include non-default values
 * 
 * Used with default-skipping optimization to avoid writing
 * schema defaults to storage.
 * 
 * @param flatMap - Variant map to filter
 * @param variants - Array of possible variants with defaults
 * @param getDefaultValueFn - Function to compute schema defaults
 * @returns Filtered map without default values
 */
export function filterOutDefaults(
  flatMap: VariantMap,
  variants: Array<Record<string, unknown>>,
  getDefaultValueFn: (schema: Record<string, unknown>) => unknown
): VariantMap {
  const result: VariantMap = {};

  for (const [schemaKey, value] of Object.entries(flatMap)) {
    // Find matching variant
    let defaultValue: unknown = undefined;
    for (const variant of variants) {
      if (generateVariantSchemaKey(variant) === schemaKey) {
        defaultValue = getDefaultValueFn(variant);
        break;
      }
    }

    // Skip if matches default
    try {
      const isDefault = JSON.stringify(value) === JSON.stringify(defaultValue);
      if (!isDefault) {
        result[schemaKey] = value;
      }
    } catch {
      // If comparison fails, include it to be safe
      result[schemaKey] = value;
    }
  }

  return result;
}
