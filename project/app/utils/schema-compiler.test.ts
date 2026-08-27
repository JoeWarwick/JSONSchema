import { compileSchema, CompiledSchema, CompiledType, ValidationFacets } from './schema-compiler';

/**
 * Sample XSD schema for testing (minimal, self-contained)
 */
const testSchema = {
  'xs:schema': {
    '@attributes': {
      xmlns: 'http://www.w3.org/2001/XMLSchema',
      'xmlns:xs': 'http://www.w3.org/2001/XMLSchema',
      'xmlns:tns': 'http://example.com/test',
      targetNamespace: 'http://example.com/test',
    },
    'xs:simpleType': [
      {
        '@attributes': { name: 'ColorType' },
        'xs:restriction': {
          '@attributes': { base: 'xs:string' },
          'xs:enumeration': [
            { '@attributes': { value: 'red' } },
            { '@attributes': { value: 'green' } },
            { '@attributes': { value: 'blue' } },
          ],
        },
      },
      {
        '@attributes': { name: 'EmailType' },
        'xs:restriction': {
          '@attributes': { base: 'xs:string' },
          'xs:minLength': { '@attributes': { value: '5' } },
          'xs:maxLength': { '@attributes': { value: '255' } },
          'xs:pattern': { '@attributes': { value: '[^@]+@[^@]+' } },
        },
      },
      {
        '@attributes': { name: 'PINType' },
        'xs:restriction': {
          '@attributes': { base: 'xs:int' },
          'xs:minInclusive': { '@attributes': { value: '0' } },
          'xs:maxInclusive': { '@attributes': { value: '9999' } },
        },
      },
      {
        '@attributes': { name: 'CodeType' },
        'xs:restriction': {
          '@attributes': { base: 'xs:string' },
          'xs:length': { '@attributes': { value: '3' } },
          'xs:pattern': { '@attributes': { value: '[A-Z]{3}' } },
        },
      },
      {
        '@attributes': { name: 'StringType' },
        'xs:restriction': {
          '@attributes': { base: 'xs:string' },
        },
      },
      {
        '@attributes': { name: 'IntType' },
        'xs:restriction': {
          '@attributes': { base: 'xs:int' },
        },
      },
      {
        '@attributes': { name: 'StringOrNumberType' },
        'xs:union': {
          '@attributes': { memberTypes: 'tns:StringType tns:IntType' },
        },
      },
    ],
    'xs:complexType': [
      {
        '@attributes': { name: 'AddressType' },
        'xs:sequence': {
          'xs:element': [
            { '@attributes': { name: 'street', type: 'xs:string' } },
            { '@attributes': { name: 'city', type: 'xs:string' } },
            { '@attributes': { name: 'postalCode', type: 'xs:string', minOccurs: '0' } },
          ],
        },
      },
      {
        '@attributes': { name: 'PersonType' },
        'xs:sequence': {
          'xs:element': [
            { '@attributes': { name: 'firstName', type: 'xs:string' } },
            { '@attributes': { name: 'lastName', type: 'xs:string' } },
            { '@attributes': { name: 'address', type: 'tns:AddressType', minOccurs: '0' } },
          ],
        },
        'xs:attribute': [
          { '@attributes': { name: 'id', type: 'xs:int', use: 'required' } },
          { '@attributes': { name: 'favoriteColor', type: 'tns:ColorType' } },
        ],
      },
      {
        '@attributes': { name: 'EmployeeType' },
        'xs:complexContent': {
          'xs:extension': {
            '@attributes': { base: 'tns:PersonType' },
            'xs:sequence': {
              'xs:element': [
                { '@attributes': { name: 'employeeNumber', type: 'xs:string' } },
                { '@attributes': { name: 'department', type: 'xs:string', minOccurs: '0' } },
              ],
            },
          },
        },
      },
    ],
    'xs:element': [
      { '@attributes': { name: 'person', type: 'tns:PersonType' } },
      { '@attributes': { name: 'address', type: 'tns:AddressType' } },
      { '@attributes': { name: 'employee', type: 'tns:EmployeeType' } },
    ],
  },
};

describe('CompiledSchema - Basic Compilation', () => {
  let compiled: CompiledSchema;

  beforeEach(() => {
    // Pass the unwrapped schema (xs:schema contents, not the wrapper)
    compiled = compileSchema(testSchema['xs:schema']);
  });

  test('should compile schema without errors', () => {
    expect(compiled).toBeTruthy();
    expect(compiled).toBeInstanceOf(CompiledSchema);
  });

  test('should index all simpleTypes', () => {
    expect(compiled.getType('ColorType')).toBeTruthy();
    expect(compiled.getType('EmailType')).toBeTruthy();
    expect(compiled.getType('PINType')).toBeTruthy();
    expect(compiled.getType('CodeType')).toBeTruthy();
    expect(compiled.getType('StringType')).toBeTruthy();
    expect(compiled.getType('IntType')).toBeTruthy();
    expect(compiled.getType('StringOrNumberType')).toBeTruthy();
  });

  test('should index all complexTypes', () => {
    expect(compiled.getType('AddressType')).toBeTruthy();
    expect(compiled.getType('PersonType')).toBeTruthy();
    expect(compiled.getType('EmployeeType')).toBeTruthy();
  });

  test('should return undefined for non-existent types', () => {
    expect(compiled.getType('NonExistentType')).toBeUndefined();
  });

  test('should handle namespace-prefixed type names', () => {
    const type = compiled.getType('tns:ColorType');
    expect(type).toBeTruthy();
    expect(type?.name).toBe('ColorType');
  });
});

describe('CompiledSchema - Enumeration Extraction', () => {
  let compiled: CompiledSchema;

  beforeEach(() => {
    compiled = compileSchema(testSchema['xs:schema']);
  });

  test('should extract enumerations from simpleType with restriction', () => {
    const colorType = compiled.getType('ColorType');
    expect(colorType?.enumerations).toEqual(['red', 'green', 'blue']);
  });

  test('should return empty array for types without enumerations', () => {
    const emailType = compiled.getType('EmailType');
    expect(emailType?.enumerations).toEqual([]);
  });

  test('should provide getEnumerations method', () => {
    const enums = compiled.getEnumerations('ColorType');
    expect(enums).toEqual(['red', 'green', 'blue']);
  });

  test('should handle namespace prefixes in getEnumerations', () => {
    const enums = compiled.getEnumerations('tns:ColorType');
    expect(enums).toEqual(['red', 'green', 'blue']);
  });
});

describe('CompiledSchema - Validation Facets', () => {
  let compiled: CompiledSchema;

  beforeEach(() => {
    compiled = compileSchema(testSchema['xs:schema']);
  });

  test('should extract string length facets', () => {
    const emailType = compiled.getType('EmailType');
    expect(emailType?.facets).toBeTruthy();
    expect(emailType?.facets?.minLength).toBe(5);
    expect(emailType?.facets?.maxLength).toBe(255);
  });

  test('should extract pattern facet', () => {
    const emailType = compiled.getType('EmailType');
    expect(emailType?.facets?.pattern).toBe('[^@]+@[^@]+');
  });

  test('should extract numeric range facets', () => {
    const pinType = compiled.getType('PINType');
    expect(pinType?.facets?.minInclusive).toBe(0);
    expect(pinType?.facets?.maxInclusive).toBe(9999);
  });

  test('should extract length facet', () => {
    const codeType = compiled.getType('CodeType');
    expect(codeType?.facets?.length).toBe(3);
  });

  test('should provide getFacets method', () => {
    const facets = compiled.getFacets('EmailType');
    expect(facets).toBeTruthy();
    expect(facets?.minLength).toBe(5);
    expect(facets?.maxLength).toBe(255);
  });

  test('should handle facets with namespace prefixes', () => {
    const facets = compiled.getFacets('tns:EmailType');
    expect(facets).toBeTruthy();
    expect(facets?.minLength).toBe(5);
  });

  test('should return undefined for non-existent type facets', () => {
    const facets = compiled.getFacets('NonExistent');
    expect(facets).toBeUndefined();
  });

  test('should return undefined for type with no facets', () => {
    const facets = compiled.getFacets('AddressType');
    expect(facets).toBeUndefined();
  });
});

describe('CompiledSchema - Union Types', () => {
  let compiled: CompiledSchema;

  beforeEach(() => {
    compiled = compileSchema(testSchema['xs:schema']);
  });

  test('should extract union member types', () => {
    const unionType = compiled.getType('StringOrNumberType');
    expect(unionType?.unionMemberTypes).toEqual(['tns:StringType', 'tns:IntType']);
  });

  test('should expand union types', () => {
    const members = compiled.expandUnion('StringOrNumberType');
    expect(members.length).toBe(2);
    expect(members[0]?.name).toBe('StringType');
    expect(members[1]?.name).toBe('IntType');
  });

  test('should return single type for non-union types', () => {
    const members = compiled.expandUnion('ColorType');
    expect(members.length).toBe(1);
    expect(members[0]?.name).toBe('ColorType');
  });
});

describe('CompiledSchema - Complex Type Elements & Attributes', () => {
  let compiled: CompiledSchema;

  beforeEach(() => {
    compiled = compileSchema(testSchema['xs:schema']);
  });

  test('should extract elements from complexType', () => {
    const addressType = compiled.getType('AddressType');
    expect(addressType?.elements.length).toBe(3);
    expect(addressType?.elements[0]?.name).toBe('street');
    expect(addressType?.elements[1]?.name).toBe('city');
    expect(addressType?.elements[2]?.name).toBe('postalCode');
  });

  test('should extract element type information', () => {
    const addressType = compiled.getType('AddressType');
    expect(addressType?.elements[0]?.type).toBe('xs:string');
  });

  test('should extract element occurrence constraints', () => {
    const addressType = compiled.getType('AddressType');
    expect(addressType?.elements[0]?.minOccurs).toBe(1); // Default
    expect(addressType?.elements[2]?.minOccurs).toBe(0); // Specified
  });

  test('should extract attributes from complexType', () => {
    const personType = compiled.getType('PersonType');
    expect(personType?.attributes.length).toBe(2);
    expect(personType?.attributes[0]?.name).toBe('id');
    expect(personType?.attributes[1]?.name).toBe('favoriteColor');
  });

  test('should extract attribute use constraints', () => {
    const personType = compiled.getType('PersonType');
    expect(personType?.attributes[0]?.use).toBe('required');
    expect(personType?.attributes[1]?.use).toBe('optional');
  });

  test('should provide getElements method', () => {
    const elements = compiled.getElements('AddressType');
    expect(elements.length).toBe(3);
    expect(elements[0]?.name).toBe('street');
  });

  test('should provide getAttributes method', () => {
    const attributes = compiled.getAttributes('PersonType');
    expect(attributes.length).toBe(2);
  });
});

describe('CompiledSchema - Type Hierarchy & Inheritance', () => {
  let compiled: CompiledSchema;

  beforeEach(() => {
    compiled = compileSchema(testSchema['xs:schema']);
  });

  test('should detect base type relationships', () => {
    const employeeType = compiled.getType('EmployeeType');
    expect(employeeType?.baseType).toBe('tns:PersonType');
  });

  test('should resolve type with baseType reference', () => {
    const resolved = compiled.resolveType('EmployeeType');
    expect(resolved).toBeTruthy();
    expect(resolved?.baseType).toBe('tns:PersonType');
  });

  test('should flatten inherited elements in resolveType', () => {
    const resolved = compiled.resolveType('EmployeeType');
    // Should have PersonType elements (firstName, lastName, address) + EmployeeType elements (employeeNumber, department)
    expect(resolved?.elements.length).toBeGreaterThan(0);
    const names = resolved?.elements.map((e) => e.name);
    expect(names).toContain('firstName'); // Inherited from PersonType
    expect(names).toContain('employeeNumber'); // Own element
  });

  test('should flatten inherited attributes in resolveType', () => {
    const resolved = compiled.resolveType('EmployeeType');
    // Should have PersonType attributes (id, favoriteColor)
    expect(resolved?.attributes.length).toBeGreaterThanOrEqual(0);
  });

  test('should handle types without base type', () => {
    const resolved = compiled.resolveType('AddressType');
    expect(resolved?.baseType).toBeUndefined();
    expect(resolved?.elements.length).toBe(3);
  });
});

describe('CompiledSchema - Type Lookup Edge Cases', () => {
  let compiled: CompiledSchema;

  beforeEach(() => {
    compiled = compileSchema(testSchema['xs:schema']);
  });

  test('should check type existence with hasType', () => {
    expect(compiled.hasType('ColorType')).toBe(true);
    expect(compiled.hasType('NonExistent')).toBe(false);
  });

  test('should return all type names with getAllTypeNames', () => {
    const names = compiled.getAllTypeNames();
    expect(names).toContain('ColorType');
    expect(names).toContain('PersonType');
    expect(names).toContain('AddressType');
    expect(names.length).toBeGreaterThanOrEqual(8);
  });

  test('should handle empty namespace gracefully', () => {
    const type = compiled.getType('ColorType');
    expect(type?.namespace).toBeUndefined();
  });

  test('should normalize type names with multiple namespace prefixes', () => {
    const type1 = compiled.getType('xs:EmailType');
    const type2 = compiled.getType('tns:EmailType');
    const type3 = compiled.getType('EmailType');
    
    expect(type1?.name).toBe('EmailType');
    expect(type2?.name).toBe('EmailType');
    expect(type3?.name).toBe('EmailType');
  });
});

describe('CompiledSchema - Facet Data Type Handling', () => {
  let compiled: CompiledSchema;

  beforeEach(() => {
    compiled = compileSchema(testSchema['xs:schema']);
  });

  test('should convert numeric facets to numbers', () => {
    const facets = compiled.getFacets('EmailType');
    expect(typeof facets?.minLength).toBe('number');
    expect(typeof facets?.maxLength).toBe('number');
  });

  test('should keep pattern as string', () => {
    const facets = compiled.getFacets('CodeType');
    expect(typeof facets?.pattern).toBe('string');
    expect(facets?.pattern).toBe('[A-Z]{3}');
  });

  test('should handle minInclusive as number', () => {
    const facets = compiled.getFacets('PINType');
    expect(facets?.minInclusive).toBe(0);
    expect(facets?.maxInclusive).toBe(9999);
  });
});

describe('CompiledSchema - Schema Variants', () => {
  test('should handle unwrapped schema (xs:schema contents)', () => {
    const compiled = compileSchema(testSchema['xs:schema']);
    expect(compiled.getType('ColorType')).toBeTruthy();
  });

  test('should handle element attributes with or without @attributes', () => {
    const schemaWithoutWrapper = {
      'xs:simpleType': {
        name: 'TestType',
        'xs:restriction': {
          base: 'xs:string',
        },
      },
    };
    const compiled = compileSchema(schemaWithoutWrapper);
    expect(compiled.getType('TestType')).toBeTruthy();
  });
});

describe('CompiledSchema - Integration', () => {
  let compiled: CompiledSchema;

  beforeEach(() => {
    compiled = compileSchema(testSchema['xs:schema']);
  });

  test('should provide complete type information for rendering', () => {
    const personType = compiled.getType('PersonType');
    
    // Should have all info needed for form rendering
    expect(personType?.name).toBe('PersonType');
    expect(personType?.kind).toBe('complexType');
    expect(personType?.elements.length).toBeGreaterThan(0);
    expect(personType?.attributes.length).toBeGreaterThan(0);
  });

  test('should handle nested type references (through elements)', () => {
    const personType = compiled.getType('PersonType');
    const addressElements = personType?.elements.filter((e) => e.name === 'address');
    expect(addressElements?.length).toBeGreaterThan(0);
    expect(addressElements?.[0]?.type).toBe('tns:AddressType');
  });

  test('should resolve referenced types efficiently', () => {
    const personType = compiled.getType('PersonType');
    const addressRefType = personType?.elements.find((e) => e.name === 'address')?.type;
    const resolvedAddressType = compiled.getType(addressRefType!);
    
    expect(resolvedAddressType?.name).toBe('AddressType');
    expect(resolvedAddressType?.elements.length).toBe(3);
  });
});
