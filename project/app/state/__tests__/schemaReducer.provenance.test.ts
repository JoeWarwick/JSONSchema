import schemaReducer, { initialSchemaState, SET_RESOLVED_CACHE, isSchemaImported } from '../schemaReducer';

describe('schemaReducer provenance', () => {
  test('inlined defs get __from set to the original $ref', () => {
    const initial = initialSchemaState(null);
    const resolved = {
      properties: {
        person: { $ref: '#/$defs/User' }
      },
      $defs: {
        User: { type: 'object', properties: { name: { type: 'string' } } }
      }
    };
    const next = schemaReducer(initial, { type: SET_RESOLVED_CACHE, payload: resolved } as any);
    expect(next).toBeTruthy();
    const person = (next.resolvedCache as any).properties && (next.resolvedCache as any).properties.person;
    expect(person).toBeTruthy();
    // The inlined person should carry a __from marker with the original ref
    expect(person.__from).toBe('#/$defs/User');
  });

  test('inlined object property ref gets __from set to the original $ref', () => {
    const initial = initialSchemaState(null);
    const resolved = {
      type: 'object',
      properties: {
        address: { $ref: '#/$defs/Address' }
      },
      $defs: {
        Address: { type: 'object', properties: { street: { type: 'string' } } }
      }
    };
    const next = schemaReducer(initial, { type: SET_RESOLVED_CACHE, payload: resolved } as any);
    expect(next).toBeTruthy();
    const address = (next.resolvedCache as any).properties && (next.resolvedCache as any).properties.address;
    expect(address).toBeTruthy();
    // The inlined address should carry a __from marker with the original ref
    expect(address.__from).toBe('#/$defs/Address');
  });

  test('isSchemaImported reports true for an inlined property by path', () => {
    const initial = initialSchemaState(null);
    const resolved = {
      type: 'object',
      properties: {
        address: { $ref: '#/$defs/Address' }
      },
      $defs: {
        Address: { type: 'object', properties: { street: { type: 'string' } } }
      }
    };
    const next = schemaReducer(initial, { type: SET_RESOLVED_CACHE, payload: resolved } as any);
    expect(next).toBeTruthy();
    // Pass the reducer state and the path to the property — should report imported
    expect(isSchemaImported(next, ['address'])).toBe(true);
  });
});
