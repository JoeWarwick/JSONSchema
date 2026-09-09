import { compileSchema, CompiledSchema } from './schema-compiler';

describe('SchemaCompiler: Choice Compositors and Enumerations', () => {
  let compiled: CompiledSchema;
  
  beforeAll(() => {
    // Schema with choice compositor and enumeration attribute
    const demoSchema = {
      'xs:schema': {
        '@attributes': {
          'xmlns:xs': 'http://www.w3.org/2001/XMLSchema',
          'xmlns:tns': 'http://example.com/demo',
          targetNamespace: 'http://example.com/demo',
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
        ],
        'xs:complexType': [
          {
            '@attributes': { name: 'AddressType' },
            'xs:all': {
              'xs:element': [
                { '@attributes': { name: 'street', type: 'xs:string' } },
                { '@attributes': { name: 'city', type: 'xs:string' } },
              ],
            },
          },
          {
            '@attributes': { name: 'PersonType' },
            'xs:sequence': {
              'xs:element': [
                { '@attributes': { name: 'firstName', type: 'xs:string' } },
                { '@attributes': { name: 'lastName', type: 'xs:string' } },
                { '@attributes': { name: 'birthDate', type: 'xs:date', minOccurs: '0' } },
                { '@attributes': { name: 'address', type: 'tns:AddressType' } },
              ],
              'xs:choice': {
                '@attributes': { minOccurs: '0' },
                'xs:element': [
                  { '@attributes': { name: 'homeEmail', type: 'xs:string' } },
                  { '@attributes': { name: 'workEmail', type: 'xs:string' } },
                ],
              },
            },
            'xs:attribute': [
              { '@attributes': { name: 'id', type: 'xs:int', use: 'required' } },
              { '@attributes': { name: 'active', type: 'xs:boolean', default: 'true' } },
              { '@attributes': { name: 'favoriteColor', type: 'tns:ColorType' } },
            ],
          },
        ],
        'xs:element': [
          { '@attributes': { name: 'person', type: 'tns:PersonType' } },
        ],
      },
    };
    
    compiled = compileSchema(demoSchema['xs:schema']);
  });
  
  test('PersonType should be indexed in compiled schema', () => {
    const personType = compiled.getType('PersonType');
    expect(personType).toBeDefined();
    expect(personType?.name).toBe('PersonType');
    expect(personType?.kind).toBe('complexType');
  });
  
  test('PersonType should have correct attributes including favoriteColor', () => {
    const personType = compiled.getType('PersonType');
    expect(personType?.attributes).toBeDefined();
    expect(personType?.attributes.length).toBeGreaterThan(0);
    
    const fcAttr = personType?.attributes.find(a => a.name === 'favoriteColor');
    expect(fcAttr).toBeDefined();
    expect(fcAttr?.type).toBe('tns:ColorType');
    
    console.log('PersonType attributes:', personType?.attributes.map(a => ({
      name: a.name,
      type: a.type,
      use: a.use,
    })));
  });
  
  test('ColorType should be indexed with enumerations', () => {
    const colorType = compiled.getType('ColorType');
    expect(colorType).toBeDefined();
    expect(colorType?.kind).toBe('simpleType');
    expect(colorType?.enumerations).toBeDefined();
    expect(colorType?.enumerations?.length).toBe(3);
    expect(colorType?.enumerations).toEqual(['red', 'green', 'blue']);
    
    console.log('ColorType:', colorType);
  });
  
  test('getEnumerations("ColorType") should return color values', () => {
    const enums = compiled.getEnumerations('ColorType');
    expect(enums).toBeDefined();
    expect(enums.length).toBe(3);
    expect(enums).toEqual(['red', 'green', 'blue']);
  });
  
  test('getEnumerations("tns:ColorType") should also work with namespace prefix', () => {
    const enums = compiled.getEnumerations('tns:ColorType');
    expect(enums).toBeDefined();
    expect(enums.length).toBe(3);
    expect(enums).toEqual(['red', 'green', 'blue']);
  });
  
  test('PersonType should have choice compositor elements', () => {
    const personType = compiled.getType('PersonType');
    expect(personType?.elements).toBeDefined();
    
    // Log all elements
    console.log('PersonType elements:', personType?.elements.map(e => ({
      name: e.name,
      type: e.type,
      compositorType: e.compositorType,
      minOccurs: e.minOccurs,
      maxOccurs: e.maxOccurs,
    })));
    
    // Check for homeEmail and workEmail with choice compositor
    const homeEmail = personType?.elements.find(e => e.name === 'homeEmail');
    const workEmail = personType?.elements.find(e => e.name === 'workEmail');
    
    expect(homeEmail).toBeDefined();
    expect(workEmail).toBeDefined();
    expect(homeEmail?.compositorType).toBe('choice');
    expect(workEmail?.compositorType).toBe('choice');
  });
  
  test('favoriteColor attribute should resolve to ColorType with enumerations', () => {
    const personType = compiled.getType('PersonType');
    const fcAttr = personType?.attributes.find(a => a.name === 'favoriteColor');
    
    expect(fcAttr?.type).toBe('tns:ColorType');
    
    // Resolve the type and get enumerations
    const colorType = compiled.getType(fcAttr!.type!);
    const enums = compiled.getEnumerations(fcAttr!.type!);
    
    console.log('favoriteColor attribute type resolution:', {
      attrType: fcAttr?.type,
      resolvedType: colorType?.name,
      enumerations: enums,
    });
    
    expect(colorType).toBeDefined();
    expect(colorType?.enumerations).toEqual(['red', 'green', 'blue']);
    expect(enums).toEqual(['red', 'green', 'blue']);
  });
  
  test('All elements in PersonType should be properly compiled', () => {
    const personType = compiled.getType('PersonType');
    
    expect(personType?.elements.length).toBeGreaterThanOrEqual(5);
    
    const elementNames = personType?.elements.map(e => e.name);
    console.log('All PersonType element names:', elementNames);
    
    expect(elementNames).toContain('firstName');
    expect(elementNames).toContain('lastName');
    expect(elementNames).toContain('homeEmail');
    expect(elementNames).toContain('workEmail');
    expect(elementNames).toContain('address');
  });
  
  test('resolveType should return flattened PersonType with all inherited info', () => {
    const personType = compiled.resolveType('PersonType');
    
    console.log('Resolved PersonType:', {
      name: personType?.name,
      elementCount: personType?.elements.length,
      attributeCount: personType?.attributes.length,
      compositorType: personType?.compositorType,
      elements: personType?.elements.map(e => ({
        name: e.name,
        compositorType: e.compositorType,
      })),
    });
    
    expect(personType?.elements).toBeDefined();
    expect(personType?.attributes).toBeDefined();
    expect(personType?.attributes?.some(a => a.name === 'favoriteColor')).toBe(true);
  });
});
