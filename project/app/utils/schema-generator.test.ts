import { generateSchema } from './schema-generator';

describe('generateSchema', () => {
  test('truncates deeply nested objects at the recursion limit', () => {
    const makeDeepObject = (depth: number) => {
      const root: any = {};
      let cursor = root;

      for (let index = 0; index < depth; index++) {
        cursor.child = {};
        cursor = cursor.child;
      }

      cursor.leaf = true;
      return root;
    };

    const schema = generateSchema(makeDeepObject(40));

    let current: any = schema;
    for (let index = 0; index < 29; index++) {
      current = current.properties.child;
    }

    expect(current.properties.child.description).toBe('Maximum recursion depth reached');
  });

  test('handles circular references without overflowing the stack', () => {
    const circular: any = {};
    circular.self = circular;

    const schema = generateSchema(circular);

    expect(schema.type).toBe('object');
    expect((schema.properties as any).self.description).toBe('Circular reference detected');
  });
});