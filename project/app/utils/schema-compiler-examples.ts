/**
 * Compiled Schema Usage Examples
 *
 * Shows how to use the new CompiledSchema API for efficient type resolution
 * instead of fiddly manual searching through nested schema objects.
 */

import {
  compileSchemaForWalking,
  resolveTypeWithHierarchy,
  getTypeElements,
  getTypeAttributes,
  getTypeEnumerations,
  getTypeFacets,
  expandUnionTypes,
  walkSchemaWithCompiled,
} from './schema-walker';

/**
 * EXAMPLE 1: Basic type resolution
 * 
 * Problem: Finding a type and its properties requires recursive searching
 * Solution: Compile once, lookup anytime
 */
export function example_basicTypeResolution(parsedXsd: any) {
  // Compile the schema once at load time
  const compiled = compileSchemaForWalking(parsedXsd);

  // Later, resolve types instantly
  const personType = resolveTypeWithHierarchy(compiled, 'PersonType');
  console.log('PersonType name:', personType?.name);
  console.log('PersonType is complex?', personType?.kind === 'complexType');
}

/**
 * EXAMPLE 2: Get child elements (with inheritance flattened)
 *
 * Before: Had to manually walk type hierarchy and search for xs:sequence
 * After: One line, handles inheritance automatically
 */
export function example_getChildElements(parsedXsd: any) {
  const compiled = compileSchemaForWalking(parsedXsd);

  // Get ALL child elements, including inherited ones
  const elements = getTypeElements(compiled, 'EmployeeType');
  
  for (const elem of elements) {
    console.log(`- ${elem.name}: ${elem.type || 'unknown'} (min: ${elem.minOccurs}, max: ${elem.maxOccurs})`);
  }
}

/**
 * EXAMPLE 3: Get attributes (with inheritance flattened)
 *
 * Before: Had to search through xs:attribute elements nested in complexType
 * After: Direct access to all attributes
 */
export function example_getAttributes(parsedXsd: any) {
  const compiled = compileSchemaForWalking(parsedXsd);

  const attrs = getTypeAttributes(compiled, 'PersonType');
  
  for (const attr of attrs) {
    console.log(`@${attr.name}: ${attr.type} (${attr.use})`);
  }
}

/**
 * EXAMPLE 4: Handle enumerations without type lookup
 *
 * Before: Had to find simpleType, find xs:restriction, extract xs:enumeration
 * After: Direct enumeration access
 */
export function example_getEnumerations(parsedXsd: any) {
  const compiled = compileSchemaForWalking(parsedXsd);

  const colors = getTypeEnumerations(compiled, 'ColorType');
  console.log('Color options:', colors); // ["red", "green", "blue"]
}

/**
 * EXAMPLE 5: Resolve union types
 *
 * Before: Had to manually parse xs:union memberTypes and look up each
 * After: Automatic expansion of all member types
 */
export function example_expandUnions(parsedXsd: any) {
  const compiled = compileSchemaForWalking(parsedXsd);

  // xs:union memberTypes="xs:string xs:int"
  const memberTypes = expandUnionTypes(compiled, 'StringOrIntType');
  
  for (const type of memberTypes) {
    console.log(`Union member: ${type.name} (${type.kind})`);
  }
}

/**
 * EXAMPLE 6: Type hierarchies and inheritance
 *
 * Before: Had to manually traverse xs:extension chain
 * After: Resolved type includes all inherited properties
 */
export function example_typeInheritance(parsedXsd: any) {
  const compiled = compileSchemaForWalking(parsedXsd);

  // EmployeeType extends PersonType
  const employeeType = resolveTypeWithHierarchy(compiled, 'EmployeeType');
  
  if (employeeType) {
    console.log('Elements in EmployeeType (including inherited from PersonType):');
    for (const elem of employeeType.elements) {
      console.log(`  - ${elem.name}`);
    }
  }
}

/**
 * EXAMPLE 7: Walking a schema with compiled type resolution
 *
 * Use walkSchemaWithCompiled instead of walkSchema for better performance
 * and automatic type hierarchy handling
 */
export function example_walkWithCompiled(parsedXsd: any, element: any) {
  const compiled = compileSchemaForWalking(parsedXsd);

  // Walk using compiled schema (no need to pass rootSchema separately)
  const schemaNode = walkSchemaWithCompiled(compiled, element);
  
  console.log('Walked schema tree:', schemaNode);
}

/**
 * EXAMPLE 8: Real-world scenario - building a form from XML Schema
 *
 * Before: Lots of manual type lookups and nested property searching
 * After: Clean, straightforward data gathering
 */
export function example_buildFormFromSchema(parsedXsd: any) {
  const compiled = compileSchemaForWalking(parsedXsd);

  // Build form field info for PersonType
  const personFields = [];

  const elements = getTypeElements(compiled, 'PersonType');
  for (const elem of elements) {
    // Get enumerations if this type has them
    const enums = elem.type ? getTypeEnumerations(compiled, elem.type) : [];

    personFields.push({
      name: elem.name,
      type: elem.type,
      required: elem.minOccurs > 0,
      canRepeat: elem.maxOccurs === 'unbounded',
      options: enums.length > 0 ? enums : undefined,
    });
  }

  const personAttrs = getTypeAttributes(compiled, 'PersonType');
  for (const attr of personAttrs) {
    const enums = attr.type ? getTypeEnumerations(compiled, attr.type) : [];

    personFields.push({
      name: `@${attr.name}`,
      type: attr.type,
      required: attr.use === 'required',
      canRepeat: false,
      options: enums.length > 0 ? enums : undefined,
    });
  }

  return personFields;
}

/**
 * EXAMPLE 9: Get validation facets (min/max length, pattern, numeric bounds, etc.)
 *
 * Before: Had to manually search xs:restriction and find xs:minLength, xs:maxLength, xs:pattern
 * After: One line call returns all facets, ready for form validation
 */
export function example_getValidationFacets(parsedXsd: any) {
  const compiled = compileSchemaForWalking(parsedXsd);

  // Get all facets for a type
  const facets = getTypeFacets(compiled, 'EmailAddressType');
  
  if (facets) {
    console.log('Email address constraints:');
    if (facets.minLength) console.log(`  - Min length: ${facets.minLength}`);
    if (facets.maxLength) console.log(`  - Max length: ${facets.maxLength}`);
    if (facets.pattern) console.log(`  - Must match: ${facets.pattern}`);
  }
}

/**
 * EXAMPLE 10: Use facets to generate form validation
 * 
 * Real-world usage: Build HTML5 input attributes from XSD facets
 */
export function example_facetsToFormValidation(parsedXsd: any) {
  const compiled = compileSchemaForWalking(parsedXsd);

  // Get constraints from schema
  const phoneFacets = getTypeFacets(compiled, 'PhoneNumberType');
  
  // Generate HTML input element with validation
  const inputAttrs: Record<string, string | number> = {};
  
  if (phoneFacets?.minLength) inputAttrs.minLength = phoneFacets.minLength;
  if (phoneFacets?.maxLength) inputAttrs.maxLength = phoneFacets.maxLength;
  if (phoneFacets?.pattern) inputAttrs.pattern = phoneFacets.pattern;
  
  // Use in form:
  // <input type="tel" {...inputAttrs} />
  
  return inputAttrs;
}

/**
 * EXAMPLE 11: Validate a value against facets
 * 
 * Use case: Check if a user-entered value meets schema constraints before saving
 */
export function example_validateValueAgainstFacets(
  parsedXsd: any,
  typeName: string,
  value: string
): { valid: boolean; errors: string[] } {
  const compiled = compileSchemaForWalking(parsedXsd);
  const facets = getTypeFacets(compiled, typeName);
  const errors: string[] = [];
  
  if (!facets) return { valid: true, errors: [] };
  
  // Check string length
  if (facets.minLength && value.length < facets.minLength) {
    errors.push(`Must be at least ${facets.minLength} characters`);
  }
  if (facets.maxLength && value.length > facets.maxLength) {
    errors.push(`Must be at most ${facets.maxLength} characters`);
  }
  if (facets.length && value.length !== facets.length) {
    errors.push(`Must be exactly ${facets.length} characters`);
  }
  
  // Check pattern
  if (facets.pattern) {
    try {
      const regex = new RegExp(`^${facets.pattern}$`);
      if (!regex.test(value)) {
        errors.push(`Must match pattern: ${facets.pattern}`);
      }
    } catch (e) {
      errors.push(`Invalid pattern constraint`);
    }
  }
  
  // Check numeric constraints
  if (facets.minInclusive || facets.maxInclusive) {
    const num = Number(value);
    if (!isNaN(num)) {
      if (facets.minInclusive !== undefined && num < Number(facets.minInclusive)) {
        errors.push(`Must be at least ${facets.minInclusive}`);
      }
      if (facets.maxInclusive !== undefined && num > Number(facets.maxInclusive)) {
        errors.push(`Must be at most ${facets.maxInclusive}`);
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * PERFORMANCE TIP:
 *
 * Compile the schema ONCE when the app starts or schema is loaded:
 *
 *   const compiled = compileSchemaForWalking(parsedXsd);
 *   
 *   // Store in state or pass through context
 *   setState({ compiled });
 *
 * Then use the compiled schema for ALL subsequent type lookups.
 * This is much faster than the old recursive searching approach.
 */
