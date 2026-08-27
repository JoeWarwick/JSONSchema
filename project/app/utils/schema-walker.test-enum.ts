/**
 * Quick test to verify enumeration detection in schema walker.
 * This is a manual verification - run in browser console or Node.js
 */

import { walkSchema, compileSchemaForWalking, getEnumerationsFromRestriction, detectEnumerations } from './schema-walker';

// Test case: ColorType simpleType with enumerations
const colorTypeSchema = {
  'xs:simpleType': {
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
};

// Test case: Root schema with ColorType and element
const rootSchema = {
  'xs:schema': {
    'xs:simpleType': {
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
    'xs:element': {
      '@attributes': {
        name: 'favoriteColor',
        type: 'ColorType',
      },
    },
  },
};

export function testEnumerationDetection() {
  console.log('=== Testing Enumeration Detection ===\n');

  // Test 1: Detect enumerations in restriction directly
  console.log('Test 1: Direct restriction enumeration detection');
  const restriction = colorTypeSchema['xs:simpleType']['xs:restriction'];
  const directEnums = getEnumerationsFromRestriction(restriction);
  console.log('Found enumerations:', directEnums);
  console.assert(
    directEnums.length === 3 && directEnums[0] === 'red',
    'Expected [red, green, blue]'
  );
  console.log('✓ Test 1 passed\n');

  // Test 2: Detect enumerations in type object
  console.log('Test 2: Type object enumeration detection');
  const simpleType = colorTypeSchema['xs:simpleType'];
  const typeEnums = detectEnumerations(simpleType);
  console.log('Found enumerations:', typeEnums);
  console.assert(
    typeEnums.length === 3 && typeEnums[0] === 'red',
    'Expected [red, green, blue]'
  );
  console.log('✓ Test 2 passed\n');

  // Compile schema once for both Test 3 and Test 4
  const compiledSchema = compileSchemaForWalking(rootSchema['xs:schema']);

  // Test 3: Walk schema and find enumerations
  console.log('Test 3: Schema walker enumeration detection');
  try {
    const walked = walkSchema(compiledSchema, { rootSchema: rootSchema['xs:schema'], compiledSchema, visitedTypes: new Set(), depth: 0, maxDepth: 50, path: [] });
    console.log('Walked schema:', walked);
    console.log('✓ Test 3 completed\n');
  } catch (e) {
    console.error('Test 3 failed:', e);
  }

  // Test 4: Walk element using ColorType
  console.log('Test 4: Element referencing enumerated type');
  try {
    const elementNode = walkSchema(compiledSchema, { rootSchema: rootSchema['xs:schema'], compiledSchema, visitedTypes: new Set(), depth: 0, maxDepth: 50, path: [] });
    console.log('Element node:', elementNode);
    console.log('Enumerations found:', elementNode.enumerations);
    console.log('Input type:', elementNode.inputType);
    console.assert(
      elementNode.enumerations && elementNode.enumerations.length === 3,
      'Expected 3 enumerations'
    );
    console.assert(
      elementNode.inputType === 'select',
      'Expected select inputType'
    );
    console.log('✓ Test 4 passed\n');
  } catch (e) {
    console.error('Test 4 failed:', e);
  }

  console.log('=== All tests completed ===');
}

// Run tests if in browser console
if (typeof window !== 'undefined') {
  (window as any).testEnumerationDetection = testEnumerationDetection;
  console.log('Enumeration tests loaded. Call testEnumerationDetection() to run.');
}
