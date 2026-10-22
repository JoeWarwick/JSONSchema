import { parseMarkup } from './app/utils/markup';
import { compileSchemaForWalking, walkSchema } from './app/utils/schema-walker';

test('debug walk choice', () => {
  const xmlSchema = parseMarkup(`
  <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
    <xs:element name="holder" type="HolderType"/>
    <xs:complexType name="HolderType">
      <xs:choice>
        <xs:element name="xs:import" type="xs:string"/>
        <xs:element name="xs:annotation" type="xs:string"/>
      </xs:choice>
    </xs:complexType>
  </xs:schema>
  `, 'xml') as any;
  console.log('top keys', Object.keys(xmlSchema || {}));
  console.log(JSON.stringify(xmlSchema, null, 2));
  const compiled = compileSchemaForWalking(xmlSchema['xs:schema']);
  console.log('type names', compiled.getAllTypeNames());
  console.log('element names', compiled.getAllElementNames());
  const root = walkSchema(compiled, { rootSchema: xmlSchema['xs:schema'], compiledSchema: compiled, visitedTypes: new Set(), depth: 0, maxDepth: 50, path: [] });
  console.log(JSON.stringify(root, null, 2));
  expect(root).toBeTruthy();
});
