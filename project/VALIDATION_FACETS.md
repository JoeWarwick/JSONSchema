# Validation Facets: Extract and Apply XML Schema Constraints

## Overview

This document describes the **Validation Facets** feature, which extracts XML Schema restriction facets (min/max length, pattern, numeric bounds, etc.) and makes them available for form validation and constraint enforcement.

## What are Validation Facets?

XML Schema uses **facets** to define constraints on simple types. For example:

```xml
<xs:simpleType name="EmailType">
  <xs:restriction base="xs:string">
    <xs:minLength value="5"/>
    <xs:maxLength value="255"/>
    <xs:pattern value="[^@]+@[^@]+"/>
  </xs:restriction>
</xs:simpleType>
```

The `minLength`, `maxLength`, and `pattern` are all **facets** that constrain what values are valid.

## Supported Facets

The implementation supports the following facet types:

### String Constraints

- `minLength` - Minimum string length
- `maxLength` - Maximum string length
- `length` - Exact string length
- `pattern` - Regular expression pattern (e.g., `[0-9]{3}-[0-9]{4}`)
- `whiteSpace` - How to handle whitespace: `preserve`, `replace`, or `collapse`

### Numeric Constraints

- `minInclusive` - Minimum value (inclusive)
- `maxInclusive` - Maximum value (inclusive)
- `minExclusive` - Minimum value (exclusive)
- `maxExclusive` - Maximum value (exclusive)

### Decimal Constraints

- `fractionDigits` - Maximum decimal places
- `totalDigits` - Maximum total digits

### Other Constraints

- `enumeration` - List of allowed values

## Architecture

### 1. Facet Extraction Phase

During schema compilation (`indexSimpleType`), facets are extracted from `xs:restriction` elements:

```typescript
// Extract validation facets
const facets = this.extractFacets(restriction);
if (Object.keys(facets).length > 0) {
  compiled.facets = facets;
}
```

The `extractFacets()` method:

- Iterates through all known facet types
- Handles both namespaced (`xs:minLength`) and non-namespaced (`minLength`) variants
- Converts numeric values to `Number` type
- Returns a `ValidationFacets` object

### 2. Facets in Compiled Schema

The `CompiledType` interface now includes:

```typescript
export interface CompiledType {
  // ... existing fields ...
  facets?: ValidationFacets;
}
```

Facets are stored once at compile time and accessed via O(1) lookup:

```typescript
// Get facets for a type
const facets = compiledSchema.getFacets('EmailType');
```

### 3. Public API

New functions in `schema-walker.ts`:

```typescript
// Get all facets for a type
export function getTypeFacets(
  schema: CompiledSchema, 
  typeName: string
): ValidationFacets | undefined

// Example usage:
const emailFacets = getTypeFacets(compiled, 'EmailType');
if (emailFacets?.pattern) {
  console.log('Email must match:', emailFacets.pattern);
}
```

### 4. Form Integration

In `xml-instance-form.tsx`, facets are used to:

1. **Generate HTML input validation attributes**:

   ```typescript
   const inputAttrs = facetsToInputAttrs(facets);
   // Result: { minLength: 5, maxLength: 255, pattern: "[^@]+@[^@]+" }
   ```

2. **Display validation hints to users**:

   ```typescript
   const hint = facetsToHint(facets);
   // Result: "5-255 characters, matches: [^@]+@[^@]+"
   ```

3. **Apply constraints to form inputs**:

   ```typescript
   <input
     type="text"
     minLength={emailFacets?.minLength}
     maxLength={emailFacets?.maxLength}
     pattern={emailFacets?.pattern}
     title={hint}
   />
   ```

## Usage Examples

### Example 1: Get Facets for a Type

```typescript
const compiled = compileSchemaForWalking(parsedXsd);
const facets = getTypeFacets(compiled, 'EmailAddressType');

if (facets) {
  console.log(`Min: ${facets.minLength}, Max: ${facets.maxLength}`);
  console.log(`Pattern: ${facets.pattern}`);
}
```

### Example 2: Generate Form Validation

```typescript
function generateInputElement(typeName: string) {
  const facets = getTypeFacets(compiled, typeName);
  
  const inputAttrs: Record<string, any> = {};
  if (facets?.minLength) inputAttrs.minLength = facets.minLength;
  if (facets?.maxLength) inputAttrs.maxLength = facets.maxLength;
  if (facets?.pattern) inputAttrs.pattern = facets.pattern;
  
  return <input type="text" {...inputAttrs} />;
}
```

### Example 3: Client-Side Validation

```typescript
function validateValue(typeName: string, value: string): boolean {
  const facets = getTypeFacets(compiled, typeName);
  if (!facets) return true;
  
  // Check length constraints
  if (facets.minLength && value.length < facets.minLength) return false;
  if (facets.maxLength && value.length > facets.maxLength) return false;
  
  // Check pattern
  if (facets.pattern) {
    const regex = new RegExp(`^${facets.pattern}$`);
    if (!regex.test(value)) return false;
  }
  
  return true;
}
```

### Example 4: Server-Side Validation (Node.js)

```typescript
import { getTypeFacets } from './schema-walker';

app.post('/validate', (req, res) => {
  const { typeName, value } = req.body;
  const facets = getTypeFacets(compiled, typeName);
  
  if (!facets) {
    return res.json({ valid: true });
  }
  
  const errors: string[] = [];
  
  if (facets.minLength && value.length < facets.minLength) {
    errors.push(`Must be at least ${facets.minLength} characters`);
  }
  if (facets.maxLength && value.length > facets.maxLength) {
    errors.push(`Must be at most ${facets.maxLength} characters`);
  }
  if (facets.pattern && !new RegExp(`^${facets.pattern}$`).test(value)) {
    errors.push(`Must match pattern: ${facets.pattern}`);
  }
  
  res.json({
    valid: errors.length === 0,
    errors,
  });
});
```

## Form UI Display

In the form component, facets are displayed as:

1. **HTML Validation Attributes**: Applied to input elements for browser-native validation

   ```html
   <input type="text" minLength="5" maxLength="255" pattern="[^@]+@[^@]+" />
   ```

2. **Validation Hints**: Displayed below the input in small gray text

   ```text
   Email Address: [input field]
   5-255 characters, matches: [^@]+@[^@]+
   ```

3. **Real-Time Feedback**: HTML5 form validation shows red border or error message when constraints violated

## Performance Characteristics

| Operation | Time | Notes |
| --------- | ---- | ----- |
| Extract facets during compilation | O(f) | f = number of facet elements |
| Get facets for a type | O(1) | Direct map lookup |
| Generate input attributes | O(f) | f = number of facets to process |
| Generate validation hint | O(f) | f = number of facets to stringify |

**Memory**: One `ValidationFacets` object per type (typically <1KB)

## Implementation Status

✅ **Completed**:

- ValidationFacets interface with all supported facet types
- extractFacets() method for parsing facets from restrictions
- CompiledSchema.getFacets() public API
- getTypeFacets() export in schema-walker
- Form integration with input attributes and hints
- Usage examples in schema-compiler-examples.ts
- Build verification (no TypeScript errors)

## Future Enhancements

### 1. Advanced Validation

- Create validateValueAgainstFacets() function for comprehensive client-side validation
- Support for facet composition (multiple facets working together)

### 2. Error Reporting

- Show specific validation errors in form UI
- Highlight which facet constraint was violated
- Provide error recovery suggestions

### 3. Facet UI Components

- Pattern builder widget for complex regex patterns
- Range slider for min/max constraints
- Character counter for length constraints

### 4. Server-Side Validation

- Share facet validation logic between client and server
- Generate server-side validation rules from schema

### 5. Enumeration Handling

- Properly handle enumeration facets (currently via enumerations array)
- Support for restrictionEnumeration in facets

## Files Modified

| File | Changes |
| ---- | ------- |
| `app/utils/schema-compiler.ts` | Added ValidationFacets interface, extractFacets(), getFacets() method |
| `app/utils/schema-walker.ts` | Added getTypeFacets() export, ValidationFacets import |
| `app/components/xml-instance-form.tsx` | Added facets helper functions, updated attribute rendering |
| `app/utils/schema-compiler-examples.ts` | Added 3 examples for facets usage and validation |

## Testing Recommendations

1. **Unit Tests**: Test extractFacets() with various facet combinations
2. **Integration Tests**: Verify facets are correctly applied to form inputs
3. **E2E Tests**: Test form validation with facet constraints
4. **Demo Schema**: Create test types with various facet combinations

## References

- [XML Schema Part 2: Datatypes - Facets](https://www.w3.org/TR/xmlschema-2/#facets)
- [XSD Facets Reference](https://www.w3schools.com/xml/schema_facets.asp)
- [Phase 4c: Compiled Schema System](./PHASE_4C_COMPILED_SCHEMA.md)
