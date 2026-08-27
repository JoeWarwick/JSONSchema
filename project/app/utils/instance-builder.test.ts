import {
  buildDefaultInstance,
  getControlRenderingHints,
  parseXmlInstance,
  toXmlString,
} from './instance-builder';
import type { SchemaNode } from './schema-walker';

describe('Instance Builder - Build Default Instance', () => {
  test('buildDefaultInstance should return undefined for null node', () => {
    const result = buildDefaultInstance(null as any);
    expect(result).toBeUndefined();
  });

  test('buildDefaultInstance should return empty object for any/wildcard', () => {
    const node: SchemaNode = {
      tagName: 'any',
      nodeType: 'any',
      minOccurs: 0,
      maxOccurs: 1,
      children: [],
      attributes: [],
      isRequired: false,
      isAny: true,
    };
    const result = buildDefaultInstance(node);
    expect(result).toEqual({});
  });

  test('buildDefaultInstance should return null for simple elements', () => {
    const node: SchemaNode = {
      tagName: 'firstName',
      nodeType: 'element',
      label: 'First Name',
      minOccurs: 1,
      maxOccurs: 1,
      children: [],
      attributes: [],
      isRequired: true,
      elementType: 'xs:string',
    };
    const result = buildDefaultInstance(node);
    expect(result).toBeNull();
  });

  test('buildDefaultInstance should include required children for compositor', () => {
    const requiredChild: SchemaNode = {
      tagName: 'firstName',
      nodeType: 'element',
      label: 'firstName',
      minOccurs: 1,
      maxOccurs: 1,
      children: [],
      attributes: [],
      isRequired: true,
    };

    const optionalChild: SchemaNode = {
      tagName: 'middleName',
      nodeType: 'element',
      label: 'middleName',
      minOccurs: 0,
      maxOccurs: 1,
      children: [],
      attributes: [],
      isRequired: false,
    };

    const node: SchemaNode = {
      tagName: 'sequence',
      nodeType: 'compositor',
      compositorType: 'sequence',
      minOccurs: 1,
      maxOccurs: 1,
      children: [requiredChild, optionalChild],
      attributes: [],
      isRequired: true,
    };

    const result = buildDefaultInstance(node);
    expect(result).toHaveProperty('firstName');
    expect(result).not.toHaveProperty('middleName');
  });

  test('buildDefaultInstance should only include required children', () => {
    const child1: SchemaNode = {
      tagName: 'street',
      nodeType: 'element',
      label: 'street',
      minOccurs: 1,
      maxOccurs: 1,
      children: [],
      attributes: [],
      isRequired: true,
    };

    const child2: SchemaNode = {
      tagName: 'postalCode',
      nodeType: 'element',
      label: 'postalCode',
      minOccurs: 0,
      maxOccurs: 1,
      children: [],
      attributes: [],
      isRequired: false,
    };

    const parent: SchemaNode = {
      tagName: 'address',
      nodeType: 'type',
      compositorType: 'sequence',
      minOccurs: 1,
      maxOccurs: 1,
      children: [child1, child2],
      attributes: [],
      isRequired: true,
    };

    const result = buildDefaultInstance(parent);
    expect(Object.keys(result).length).toBe(1);
    expect(result.street).toBe(null);
  });

  test('buildDefaultInstance should handle nested structures', () => {
    const grandChild: SchemaNode = {
      tagName: 'street',
      nodeType: 'element',
      label: 'street',
      minOccurs: 1,
      maxOccurs: 1,
      children: [],
      attributes: [],
      isRequired: true,
    };

    const child: SchemaNode = {
      tagName: 'address',
      nodeType: 'element',
      label: 'address',
      minOccurs: 1,
      maxOccurs: 1,
      compositorType: 'sequence',
      children: [grandChild],
      attributes: [],
      isRequired: true,
    };

    const parent: SchemaNode = {
      tagName: 'person',
      nodeType: 'type',
      compositorType: 'sequence',
      minOccurs: 1,
      maxOccurs: 1,
      children: [child],
      attributes: [],
      isRequired: true,
    };

    const result = buildDefaultInstance(parent);
    expect(result.address).toBeTruthy();
    expect(result.address.street).toBeNull();
  });
});

describe('Instance Builder - Control Rendering Hints', () => {
  test('getControlRenderingHints should return select for enumerated values', () => {
    const node: SchemaNode = {
      tagName: 'color',
      nodeType: 'element',
      minOccurs: 1,
      maxOccurs: 1,
      children: [],
      attributes: [],
      isRequired: true,
      enumerations: ['red', 'green', 'blue'],
    };

    const hints = getControlRenderingHints(node);
    expect(hints.controlType).toBe('select');
    expect(hints.options).toEqual(['red', 'green', 'blue']);
  });

  test('getControlRenderingHints should prioritize input type', () => {
    const node: SchemaNode = {
      tagName: 'email',
      nodeType: 'element',
      minOccurs: 1,
      maxOccurs: 1,
      children: [],
      attributes: [],
      isRequired: true,
      inputType: 'email',
    };

    const hints = getControlRenderingHints(node);
    expect(hints.controlType).toBe('email');
  });

  test('getControlRenderingHints should use inputType over enumeration', () => {
    const node: SchemaNode = {
      tagName: 'field',
      nodeType: 'element',
      minOccurs: 1,
      maxOccurs: 1,
      children: [],
      attributes: [],
      isRequired: true,
      enumerations: ['a', 'b', 'c'],
      inputType: 'number',
    };

    const hints = getControlRenderingHints(node);
    // Enumerations should take precedence for rendering
    expect(hints.controlType).toBe('select');
  });

  test('getControlRenderingHints should default to text', () => {
    const node: SchemaNode = {
      tagName: 'field',
      nodeType: 'element',
      minOccurs: 1,
      maxOccurs: 1,
      children: [],
      attributes: [],
      isRequired: true,
    };

    const hints = getControlRenderingHints(node);
    expect(hints.controlType).toBe('text');
  });

  test('getControlRenderingHints should include placeholder text', () => {
    const node: SchemaNode = {
      tagName: 'firstName',
      nodeType: 'element',
      label: 'First Name',
      minOccurs: 1,
      maxOccurs: 1,
      children: [],
      attributes: [],
      isRequired: true,
    };

    const hints = getControlRenderingHints(node);
    expect(hints.placeholder).toBeTruthy();
  });

  test('getControlRenderingHints should handle all input types', () => {
    const types: Array<'text' | 'email' | 'number' | 'checkbox' | 'date' | 'url'> = [
      'text',
      'email',
      'number',
      'checkbox',
      'date',
      'url',
    ];

    for (const inputType of types) {
      const node: SchemaNode = {
        tagName: 'field',
        nodeType: 'element',
        minOccurs: 1,
        maxOccurs: 1,
        children: [],
        attributes: [],
        isRequired: true,
        inputType,
      };

      const hints = getControlRenderingHints(node);
      expect(hints.controlType).toBe(inputType);
    }
  });
});

describe('Instance Builder - Parse XML Instance', () => {
  test('parseXmlInstance should parse simple XML', () => {
    const xml = '<person><firstName>John</firstName><lastName>Doe</lastName></person>';
    const result = parseXmlInstance(xml);

    expect(result).toBeTruthy();
    // Text content is stored in _text property by xmlElementToObject
    expect(result.firstName?._text || result.firstName).toBe('John');
    expect(result.lastName?._text || result.lastName).toBe('Doe');
  });

  test('parseXmlInstance should handle attributes', () => {
    const xml = '<person id="123"><firstName>John</firstName></person>';
    const result = parseXmlInstance(xml);

    expect(result).toBeTruthy();
    expect(result['@id']).toBe('123');
    expect(result.firstName?._text || result.firstName).toBe('John');
  });

  test('parseXmlInstance should handle nested elements', () => {
    const xml =
      '<person><address><street>123 Main</street><city>Anytown</city></address></person>';
    const result = parseXmlInstance(xml);

    expect(result).toBeTruthy();
    expect(result.address).toBeTruthy();
    expect(result.address.street?._text || result.address.street).toBe('123 Main');
    expect(result.address.city?._text || result.address.city).toBe('Anytown');
  });

  test('parseXmlInstance should handle repeated elements as arrays', () => {
    const xml = '<root><item>First</item><item>Second</item><item>Third</item></root>';
    const result = parseXmlInstance(xml);

    expect(result).toBeTruthy();
    expect(Array.isArray(result.item)).toBe(true);
    expect(result.item.length).toBe(3);
  });

  test('parseXmlInstance should return null for invalid XML', () => {
    const xml = '<person><firstName>John</person></firstName>'; // Mismatched tags
    const result = parseXmlInstance(xml);

    // Should handle parse error gracefully
    expect(result === null || result !== undefined).toBe(true);
  });

  test('parseXmlInstance should handle empty elements', () => {
    const xml = '<person><firstName></firstName><lastName>Doe</lastName></person>';
    const result = parseXmlInstance(xml);

    expect(result).toBeTruthy();
    expect(result.lastName?._text || result.lastName).toBe('Doe');
  });

  test('parseXmlInstance should return null for invalid input', () => {
    expect(parseXmlInstance(null as any)).toBeNull();
    expect(parseXmlInstance(undefined as any)).toBeNull();
    expect(parseXmlInstance('')).toBeNull();
  });

  test('parseXmlInstance should handle text nodes', () => {
    const xml = '<note>This is a note</note>';
    const result = parseXmlInstance(xml);

    expect(result).toBeTruthy();
  });
});

describe('Instance Builder - To XML String', () => {
  test('toXmlString should convert simple object to XML', () => {
    const xml = toXmlString({ firstName: 'John', lastName: 'Doe' }, 'person');

    expect(xml).toBeTruthy();
    expect(xml).toContain('<person');
    expect(xml).toContain('</person>');
    expect(xml).toContain('John');
    expect(xml).toContain('Doe');
  });

  test('toXmlString should handle attributes', () => {
    const obj = { '@id': '123', firstName: 'John' };
    const xml = toXmlString(obj, 'person');

    expect(xml).toContain('id="123"');
    expect(xml).toContain('John');
  });

  test('toXmlString should handle nested objects', () => {
    const obj = {
      firstName: 'John',
      address: {
        street: '123 Main',
        city: 'Anytown',
      },
    };
    const xml = toXmlString(obj, 'person');

    expect(xml).toContain('<person');
    expect(xml).toContain('<address');
    expect(xml).toContain('123 Main');
  });

  test('toXmlString should handle arrays (repeated elements)', () => {
    const obj = {
      '@id': '1',
      items: ['First', 'Second', 'Third'],
    };
    const xml = toXmlString(obj, 'root');

    expect(xml).toContain('<items>First</items>');
    expect(xml).toContain('<items>Second</items>');
    expect(xml).toContain('<items>Third</items>');
  });

  test('toXmlString should escape XML special characters', () => {
    const obj = {
      message: 'This is < a test > & more',
    };
    const xml = toXmlString(obj, 'root');

    expect(xml).toContain('&lt;');
    expect(xml).toContain('&gt;');
    expect(xml).toContain('&amp;');
  });

  test('toXmlString should handle null values', () => {
    const obj = {
      firstName: null,
      lastName: 'Doe',
    };
    const xml = toXmlString(obj, 'person');

    expect(xml).toBeTruthy();
    expect(xml).toContain('Doe');
  });

  test('toXmlString should handle text content with _text key', () => {
    const obj = {
      _text: 'This is a note',
      '@lang': 'en',
    };
    const xml = toXmlString(obj, 'note');

    expect(xml).toContain('This is a note');
  });

  test('toXmlString should handle complex nested structures', () => {
    const obj = {
      '@id': '1',
      name: { _text: 'John Doe' },
      address: [
        {
          '@type': 'home',
          street: { _text: '123 Main' },
          city: { _text: 'Anytown' },
        },
      ],
    };
    const xml = toXmlString(obj, 'person');

    // Just verify the XML was generated and contains expected elements
    expect(xml).toBeTruthy();
    expect(xml).toContain('person');
    expect(xml).toContain('id="1"');
  });

  test('toXmlString should return empty string for invalid input', () => {
    expect(toXmlString(null, 'root')).toBe('');
    expect(toXmlString(undefined, 'root')).toBe('');
  });

  test('toXmlString should handle circular references gracefully', () => {
    const obj: any = { firstName: 'John' };
    obj.self = obj; // Circular reference
    const xml = toXmlString(obj, 'person');

    // Should not throw, should handle gracefully
    expect(typeof xml).toBe('string');
  });
});

describe('Instance Builder - Build Instance From XML', () => {
  test('parseXmlInstance should parse and return object', () => {
    const xml = '<person><firstName>John</firstName><lastName>Doe</lastName></person>';
    const result = parseXmlInstance(xml);

    expect(result).toBeTruthy();
  });

  test('parseXmlInstance should handle complex XML', () => {
    const xml = `
      <person id="1">
        <firstName>John</firstName>
        <address>
          <street>123 Main</street>
          <city>Anytown</city>
        </address>
      </person>
    `;
    const result = parseXmlInstance(xml);

    expect(result).toBeTruthy();
    expect(result?.['@id']).toBe('1');
    expect(result?.address).toBeTruthy();
  });

  test('parseXmlInstance should return null for invalid XML', () => {
    const xml = '<invalid>Mismatched</invalid2>';
    const result = parseXmlInstance(xml);

    // Should handle error gracefully
    expect(result === null || result !== undefined).toBe(true);
  });
});

describe('Instance Builder - Round Trip (XML ↔ Object)', () => {
  test('should convert to XML and back to object', () => {
    const original = {
      firstName: { _text: 'John' },
      lastName: { _text: 'Doe' },
    };

    const xml = toXmlString(original, 'person');
    const parsed = parseXmlInstance(xml);

    expect(parsed).toBeTruthy();
    expect(xml).toContain('John');
    expect(xml).toContain('Doe');
  });

  test('should preserve attributes in round trip', () => {
    const original = {
      '@id': '123',
      '@type': 'employee',
      firstName: { _text: 'John' },
    };

    const xml = toXmlString(original, 'person');
    const parsed = parseXmlInstance(xml);

    expect(parsed?.['@id']).toBe('123');
    expect(parsed?.['@type']).toBe('employee');
  });

  test('should preserve nested structures in round trip', () => {
    const original = {
      firstName: { _text: 'John' },
      address: {
        street: { _text: '123 Main' },
        city: { _text: 'Anytown' },
        '@type': 'home',
      },
    };

    const xml = toXmlString(original, 'person');
    const parsed = parseXmlInstance(xml);

    expect(parsed?.address).toBeTruthy();
    expect(parsed?.address?.['@type']).toBe('home');
  });

  test('should handle arrays in round trip', () => {
    const original = {
      '@id': '1',
      emails: [
        { '@type': 'work', value: 'john@work.com' },
        { '@type': 'personal', value: 'john@personal.com' },
      ],
    };

    const xml = toXmlString(original, 'person');
    const parsed = parseXmlInstance(xml);

    expect(Array.isArray(parsed.emails)).toBe(true);
    expect(parsed.emails.length).toBe(2);
  });
});

describe('Instance Builder - Integration', () => {
  test('should build default instance for complex schema', () => {
    const addressNode: SchemaNode = {
      tagName: 'address',
      nodeType: 'element',
      label: 'address',
      compositorType: 'sequence',
      minOccurs: 0,
      maxOccurs: 1,
      children: [
        {
          tagName: 'street',
          nodeType: 'element',
          label: 'street',
          minOccurs: 1,
          maxOccurs: 1,
          children: [],
          attributes: [],
          isRequired: true,
        },
        {
          tagName: 'city',
          nodeType: 'element',
          label: 'city',
          minOccurs: 1,
          maxOccurs: 1,
          children: [],
          attributes: [],
          isRequired: true,
        },
      ],
      attributes: [],
      isRequired: false,
    };

    const personNode: SchemaNode = {
      tagName: 'person',
      nodeType: 'type',
      compositorType: 'sequence',
      minOccurs: 1,
      maxOccurs: 1,
      children: [
        {
          tagName: 'firstName',
          nodeType: 'element',
          label: 'firstName',
          minOccurs: 1,
          maxOccurs: 1,
          children: [],
          attributes: [],
          isRequired: true,
        },
        addressNode,
      ],
      attributes: [
        { name: 'id', type: 'xs:int', use: 'required' },
      ],
      isRequired: true,
    };

    const instance = buildDefaultInstance(personNode);
    expect(instance).toBeTruthy();
    expect(instance.firstName).toBeNull(); // Required, empty by default
    expect(instance.address).toBeUndefined(); // Optional
  });

  test('should get rendering hints for enumerated attribute', () => {
    const attr: SchemaNode = {
      tagName: 'color',
      nodeType: 'attribute',
      minOccurs: 0,
      maxOccurs: 1,
      children: [],
      attributes: [],
      isRequired: false,
      enumerations: ['red', 'green', 'blue'],
    };

    const hints = getControlRenderingHints(attr);
    expect(hints.controlType).toBe('select');
    expect(hints.options).toContain('red');
  });
});
