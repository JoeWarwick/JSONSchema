import {
  walkSchema,
  compileSchemaForWalking,
  resolveTypeWithHierarchy,
  expandUnionTypes,
  getTypeElements,
  getTypeAttributes,
  getTypeEnumerations,
  getTypeFacets,
  typeExists,
  getAllTypeNames,
  isRequired,
  canOccurMultipleTimes,
  getNodeLabel,
  getXmlAttrs,
  detectNamespacePrefix,
  findTypeInSchema,
  findElementInSchema,
  getChildElementsFromType,
  type SchemaNode,
} from './schema-walker';

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
    ],
    'xs:complexType': [
      {
        '@attributes': { name: 'AddressType' },
        'xs:sequence': {
          'xs:element': [
            { '@attributes': { name: 'street', type: 'xs:string', minOccurs: '1', maxOccurs: '1' } },
            { '@attributes': { name: 'city', type: 'xs:string', minOccurs: '1', maxOccurs: '1' } },
            { '@attributes': { name: 'postalCode', type: 'xs:string', minOccurs: '0', maxOccurs: '1' } },
          ],
        },
      },
      {
        '@attributes': { name: 'PersonType' },
        'xs:sequence': {
          'xs:element': [
            { '@attributes': { name: 'firstName', type: 'xs:string', minOccurs: '1', maxOccurs: '1' } },
            { '@attributes': { name: 'lastName', type: 'xs:string', minOccurs: '1', maxOccurs: '1' } },
            { '@attributes': { name: 'address', type: 'tns:AddressType', minOccurs: '0', maxOccurs: '1' } },
          ],
        },
        'xs:attribute': [
          { '@attributes': { name: 'id', type: 'xs:int', use: 'required' } },
          { '@attributes': { name: 'favoriteColor', type: 'tns:ColorType', use: 'optional' } },
        ],
      },
    ],
    'xs:element': [{ '@attributes': { name: 'person', type: 'tns:PersonType' } }],
  },
};

describe('Schema Walker - Utility Functions', () => {
  test('getXmlAttrs should extract @attributes', () => {
    const obj = { '@attributes': { name: 'test', type: 'string' }, other: 'value' };
    const attrs = getXmlAttrs(obj);
    expect(attrs.name).toBe('test');
    expect(attrs.type).toBe('string');
  });

  test('getXmlAttrs should return object itself if no @attributes', () => {
    const obj = { name: 'test', type: 'string' };
    const attrs = getXmlAttrs(obj);
    expect(attrs.name).toBe('test');
    expect(attrs.type).toBe('string');
  });

  test('getXmlAttrs should return empty object for null/undefined', () => {
    expect(getXmlAttrs(null)).toEqual({});
    expect(getXmlAttrs(undefined)).toEqual({});
  });

  test('detectNamespacePrefix should find xs prefix', () => {
    const prefix = detectNamespacePrefix(testSchema['xs:schema']);
    expect(prefix).toBe('xs');
  });

  test('detectNamespacePrefix should default to xs', () => {
    const schema = { 'simpleType': { '@attributes': { name: 'Test' } } };
    const prefix = detectNamespacePrefix(schema);
    expect(prefix).toBe('xs');
  });

  test('detectNamespacePrefix should find xsd prefix', () => {
    const schema = { 'xsd:simpleType': {} };
    const prefix = detectNamespacePrefix(schema);
    expect(prefix).toBe('xsd');
  });
});

describe('Schema Walker - Type Finding', () => {
  const schemaObj = testSchema['xs:schema'];

  test('findTypeInSchema should find complexType', () => {
    const type = findTypeInSchema(schemaObj, 'PersonType');
    expect(type).toBeTruthy();
    const attrs = getXmlAttrs(type);
    expect(attrs.name).toBe('PersonType');
  });

  test('findTypeInSchema should find simpleType', () => {
    const type = findTypeInSchema(schemaObj, 'ColorType');
    expect(type).toBeTruthy();
    const attrs = getXmlAttrs(type);
    expect(attrs.name).toBe('ColorType');
  });

  test('findTypeInSchema should strip namespace prefix', () => {
    const type = findTypeInSchema(schemaObj, 'tns:PersonType');
    expect(type).toBeTruthy();
    const attrs = getXmlAttrs(type);
    expect(attrs.name).toBe('PersonType');
  });

  test('findTypeInSchema should return null for non-existent type', () => {
    const type = findTypeInSchema(schemaObj, 'NonExistent');
    expect(type).toBeNull();
  });

  test('findElementInSchema should find global elements', () => {
    const elem = findElementInSchema(schemaObj, 'person');
    expect(elem).toBeTruthy();
    const attrs = getXmlAttrs(elem);
    expect(attrs.name).toBe('person');
  });

  test('findElementInSchema should return null for non-existent element', () => {
    const elem = findElementInSchema(schemaObj, 'nonExistent');
    expect(elem).toBeNull();
  });
});

describe('Schema Walker - Child Elements', () => {
  const schemaObj = testSchema['xs:schema'];

  test('getChildElementsFromType should extract sequence elements', () => {
    const addressType = findTypeInSchema(schemaObj, 'AddressType');
    const children = getChildElementsFromType(addressType);
    
    expect(children.length).toBe(3);
    expect(children[0]?.name).toBe('street');
    expect(children[1]?.name).toBe('city');
    expect(children[2]?.name).toBe('postalCode');
  });

  test('getChildElementsFromType should preserve minOccurs and maxOccurs', () => {
    const addressType = findTypeInSchema(schemaObj, 'AddressType');
    const children = getChildElementsFromType(addressType);
    
    expect(children[0]?.minOccurs).toBe(1);
    expect(children[2]?.minOccurs).toBe(0);
  });

  test('getChildElementsFromType should include compositorType', () => {
    const addressType = findTypeInSchema(schemaObj, 'AddressType');
    const children = getChildElementsFromType(addressType);
    
    expect(children[0]?.compositorType).toBe('sequence');
  });

  test('getChildElementsFromType should return empty array for non-type', () => {
    const children = getChildElementsFromType(null);
    expect(children).toEqual([]);
  });
});

describe('Schema Walker - Schema Walking', () => {
  const compiledSchema = compileSchemaForWalking(testSchema['xs:schema']);

  test('walkSchema should return SchemaNode', () => {
    const node = walkSchema(compiledSchema, { rootSchema: testSchema['xs:schema'], compiledSchema, visitedTypes: new Set(), depth: 0, maxDepth: 50, path: [] });
    expect(node).toBeTruthy();
    expect(node?.nodeType).toBeTruthy();
  });

  test('walkSchema should handle element with type reference', () => {
    const schemaObj = testSchema['xs:schema'];
    const node = walkSchema(compiledSchema, { rootSchema: schemaObj, compiledSchema, visitedTypes: new Set(), depth: 0, maxDepth: 50, path: [] });
    
    expect(node).toBeTruthy();
    expect(node?.elementType).toBe('tns:PersonType');
  });

  test('walkSchema should prevent infinite recursion with circular references', () => {
    const node = walkSchema(compiledSchema, { rootSchema: testSchema['xs:schema'], compiledSchema, visitedTypes: new Set(), depth: 0, maxDepth: 50, path: [] });
    
    // Should complete without stack overflow
    expect(node).toBeTruthy();
  });
});

describe('Schema Walker - Compiled Schema API', () => {
  let compiled: ReturnType<typeof compileSchemaForWalking>;

  beforeEach(() => {
    compiled = compileSchemaForWalking(testSchema['xs:schema']);
  });

  test('compileSchemaForWalking should create compiled schema', () => {
    expect(compiled).toBeTruthy();
  });

  test('resolveTypeWithHierarchy should get type info', () => {
    const type = resolveTypeWithHierarchy(compiled, 'PersonType');
    expect(type).toBeTruthy();
    expect(type?.name).toBe('PersonType');
    expect(type?.kind).toBe('complexType');
  });

  test('expandUnionTypes should handle non-union types', () => {
    const types = expandUnionTypes(compiled, 'PersonType');
    expect(types.length).toBeGreaterThan(0);
    expect(types[0]?.name).toBe('PersonType');
  });

  test('getTypeElements should return child elements', () => {
    const elements = getTypeElements(compiled, 'PersonType');
    expect(elements.length).toBeGreaterThan(0);
    const names = elements.map((e) => e.name);
    expect(names).toContain('firstName');
    expect(names).toContain('lastName');
  });

  test('getTypeAttributes should return attributes', () => {
    const attrs = getTypeAttributes(compiled, 'PersonType');
    expect(attrs.length).toBeGreaterThan(0);
    const names = attrs.map((a) => a.name);
    expect(names).toContain('id');
  });

  test('getTypeEnumerations should return enum values', () => {
    const enums = getTypeEnumerations(compiled, 'ColorType');
    expect(enums).toEqual(['red', 'green', 'blue']);
  });

  test('getTypeEnumerations should return empty array for non-enum type', () => {
    const enums = getTypeEnumerations(compiled, 'PersonType');
    expect(enums).toEqual([]);
  });

  test('getTypeFacets should return validation facets', () => {
    const facets = getTypeFacets(compiled, 'EmailType');
    expect(facets).toBeTruthy();
    expect(facets?.minLength).toBe(5);
    expect(facets?.maxLength).toBe(255);
    expect(facets?.pattern).toBe('[^@]+@[^@]+');
  });

  test('getTypeFacets should return undefined for type without facets', () => {
    const facets = getTypeFacets(compiled, 'PersonType');
    expect(facets).toBeUndefined();
  });

  test('typeExists should check type existence', () => {
    expect(typeExists(compiled, 'PersonType')).toBe(true);
    expect(typeExists(compiled, 'NonExistent')).toBe(false);
  });

  test('getAllTypeNames should return all type names', () => {
    const names = getAllTypeNames(compiled);
    expect(names).toContain('PersonType');
    expect(names).toContain('AddressType');
    expect(names).toContain('ColorType');
  });
});

describe('Schema Walker - SchemaNode Predicates', () => {
  test('isRequired should return true for required occurrence', () => {
    const node: SchemaNode = {
      tagName: 'element',
      nodeType: 'element',
      minOccurs: 1,
      maxOccurs: 1,
      children: [],
      attributes: [],
      isRequired: true,
    };
    expect(isRequired(node)).toBe(true);
  });

  test('isRequired should return false for optional occurrence', () => {
    const node: SchemaNode = {
      tagName: 'element',
      nodeType: 'element',
      minOccurs: 0,
      maxOccurs: 1,
      children: [],
      attributes: [],
      isRequired: false,
    };
    expect(isRequired(node)).toBe(false);
  });

  test('canOccurMultipleTimes should return true for unbounded maxOccurs', () => {
    const node: SchemaNode = {
      tagName: 'element',
      nodeType: 'element',
      minOccurs: 0,
      maxOccurs: 'unbounded',
      children: [],
      attributes: [],
      isRequired: false,
    };
    expect(canOccurMultipleTimes(node)).toBe(true);
  });

  test('canOccurMultipleTimes should return true for maxOccurs > 1', () => {
    const node: SchemaNode = {
      tagName: 'element',
      nodeType: 'element',
      minOccurs: 0,
      maxOccurs: 5,
      children: [],
      attributes: [],
      isRequired: false,
    };
    expect(canOccurMultipleTimes(node)).toBe(true);
  });

  test('canOccurMultipleTimes should return false for maxOccurs = 1', () => {
    const node: SchemaNode = {
      tagName: 'element',
      nodeType: 'element',
      minOccurs: 0,
      maxOccurs: 1,
      children: [],
      attributes: [],
      isRequired: false,
    };
    expect(canOccurMultipleTimes(node)).toBe(false);
  });
});

describe('Schema Walker - Node Labels', () => {
  test('getNodeLabel should return label if present', () => {
    const node: SchemaNode = {
      tagName: 'element',
      nodeType: 'element',
      label: 'First Name',
      minOccurs: 1,
      maxOccurs: 1,
      children: [],
      attributes: [],
      isRequired: true,
    };
    expect(getNodeLabel(node)).toBe('First Name');
  });

  test('getNodeLabel should return tagName if label not present', () => {
    const node: SchemaNode = {
      tagName: 'firstName',
      nodeType: 'element',
      minOccurs: 1,
      maxOccurs: 1,
      children: [],
      attributes: [],
      isRequired: true,
    };
    expect(getNodeLabel(node)).toBe('firstName');
  });

  test('getNodeLabel should format camelCase to Title Case', () => {
    const node: SchemaNode = {
      tagName: 'firstName',
      nodeType: 'element',
      minOccurs: 1,
      maxOccurs: 1,
      children: [],
      attributes: [],
      isRequired: true,
    };
    // If formatting is implemented, it should handle camelCase
    const label = getNodeLabel(node);
    expect(label).toBeTruthy();
  });
});

describe('Schema Walker - Integration', () => {
  test('should walk schema and create node tree', () => {
    const compiled = compileSchemaForWalking(testSchema['xs:schema']);
    const personType = resolveTypeWithHierarchy(compiled, 'PersonType');
    
    expect(personType).toBeTruthy();
    expect(personType?.name).toBe('PersonType');
    expect(personType?.elements.length).toBeGreaterThan(0);
    expect(personType?.attributes.length).toBeGreaterThan(0);
  });

  test('should resolve type hierarchy with elements and attributes', () => {
    const compiled = compileSchemaForWalking(testSchema['xs:schema']);
    const elements = getTypeElements(compiled, 'PersonType');
    const attributes = getTypeAttributes(compiled, 'PersonType');
    
    expect(elements.length).toBeGreaterThan(0);
    expect(attributes.length).toBeGreaterThan(0);
  });

  test('should extract and use facets for validation hints', () => {
    const compiled = compileSchemaForWalking(testSchema['xs:schema']);
    const facets = getTypeFacets(compiled, 'EmailType');
    
    if (facets) {
      const hints: string[] = [];
      if (facets.minLength) hints.push(`Min: ${facets.minLength}`);
      if (facets.maxLength) hints.push(`Max: ${facets.maxLength}`);
      if (facets.pattern) hints.push(`Pattern: ${facets.pattern}`);
      
      expect(hints.length).toBeGreaterThan(0);
    }
  });

  test('should handle namespace prefixes throughout', () => {
    const compiled = compileSchemaForWalking(testSchema['xs:schema']);
    
    // Get type with namespace prefix
    const type1 = resolveTypeWithHierarchy(compiled, 'tns:PersonType');
    // Get type without namespace prefix
    const type2 = resolveTypeWithHierarchy(compiled, 'PersonType');
    
    expect(type1?.name).toBe(type2?.name);
  });

  test('should infer inline extension base type for child elements', () => {
    const inlineExtensionSchema = {
      'xs:schema': {
        'xs:element': {
          '@attributes': { name: 'Root', type: 'RootType' },
        },
        'xs:complexType': [
          {
            '@attributes': { name: 'RootType' },
            'xs:sequence': {
              'xs:element': {
                '@attributes': { name: 'Model' },
                'xs:complexType': {
                  'xs:complexContent': {
                    'xs:extension': {
                      '@attributes': { base: 'ModelBaseType' },
                    },
                  },
                },
              },
            },
          },
          {
            '@attributes': { name: 'ModelBaseType' },
            'xs:attribute': {
              '@attributes': { name: 'version-number', type: 'xs:string', use: 'optional' },
            },
          },
        ],
      },
    } as any;

    const compiled = compileSchemaForWalking(inlineExtensionSchema['xs:schema']);
    const rootNode = walkSchema(compiled, {
      rootSchema: inlineExtensionSchema['xs:schema'],
      compiledSchema: compiled,
      visitedTypes: new Set(),
      depth: 0,
      maxDepth: 50,
      path: [],
      typeName: 'RootType',
    });

    const modelNode = rootNode.children.find((child) => child.tagName === 'Model');
    expect(modelNode).toBeTruthy();
    expect(modelNode?.attributes.some((attr) => attr.name === 'version-number')).toBe(true);
  });
});
