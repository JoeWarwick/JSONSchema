import * as fs from 'fs';
import { compileSchema } from './schema-compiler';
import { parseXmlInstance } from './instance-builder';

describe('SchemaCompiler: Load Real Demo XSD', () => {
  let demoXsdText: string;
  let parsed: any;
  let compiled: any;
  
  beforeAll(async () => {
    // Load the actual demo XSD file
    demoXsdText = fs.readFileSync('public/schemas/xml-form-controls-demo.xsd', 'utf-8');
    console.log('[TEST] Loaded demo XSD file, length:', demoXsdText.length);
    
    // Parse it to JSON
    parsed = parseXmlInstance(demoXsdText);
    console.log('[TEST] Parsed XSD, root keys:', Object.keys(parsed));
    const schemaRoot = parsed['xs:schema'] || parsed.schema || parsed;
    console.log('[TEST] Schema object keys:', Object.keys(schemaRoot || {}));
    
    // Get the schema object
    compiled = compileSchema(schemaRoot);
  });
  
  test('Demo XSD should load PersonType', () => {
    const personType = compiled.getType('PersonType');
    expect(personType).toBeDefined();
    expect(personType?.name).toBe('PersonType');
    
    console.log('\n[RESULT] PersonType:');
    console.log('  Elements:', personType?.elements?.map((e: any) => ({
      name: e.name,
      type: e.type,
      compositorType: e.compositorType,
    })));
  });
  
  test('PersonType should have choice elements (homeEmail, workEmail)', () => {
    const personType = compiled.getType('PersonType');
    const hasChoice = personType?.elements?.some((e: any) => e.compositorType === 'choice');
    
    console.log('[CHECK] PersonType has choice elements?', hasChoice);
    
    if (!hasChoice) {
      console.log('[DEBUG] PersonType sequence structure:');
      console.log(JSON.stringify(personType, null, 2).substring(0, 2000));
    }
    
    expect(hasChoice).toBe(true);
  });
  
  test('ColorType should have enumerations', () => {
    const enums = compiled.getEnumerations('ColorType');
    
    console.log('\n[RESULT] ColorType:');
    console.log('  Enumerations:', enums);
    
    expect(enums?.length).toBeGreaterThan(0);
    expect(enums).toContain('red');
    expect(enums).toContain('green');
    expect(enums).toContain('blue');
  });
  
  test('PersonType favoriteColor should resolve to ColorType', () => {
    const personType = compiled.getType('PersonType');
    const fcAttr = personType?.attributes?.find((a: any) => a.name === 'favoriteColor');
    const enums = compiled.getEnumerations(fcAttr?.type || '');
    
    console.log('\n[RESULT] favoriteColor attribute:');
    console.log('  Type:', fcAttr?.type);
    console.log('  Enumerations:', enums);
    
    expect(fcAttr?.type).toBeDefined();
    expect(enums?.length).toBeGreaterThan(0);
  });
});
