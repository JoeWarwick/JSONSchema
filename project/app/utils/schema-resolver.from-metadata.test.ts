import { rehydrateSchema } from "~/utils/schema-resolver";

describe('schema-resolver __from metadata syncing', () => {
  test('multiple properties with same __from reference sync edits back to definition', () => {
    const original = {
      $defs: {
        address: {
          type: 'object',
          properties: {
            street: { type: 'string' },
            city: { type: 'string' }
          }
        }
      },
      type: 'object',
      properties: {
        homeAddress: { $ref: '#/$defs/address' },
        workAddress: { $ref: '#/$defs/address' }
      }
    } as any;

    // Simulate editor view with inlined properties and __from metadata
    // This is what produceResolvedCache creates
    const edited = {
      type: 'object',
      properties: {
        homeAddress: {
          type: 'object',
          properties: {
            street: { type: 'string' },
            city: { type: 'string' }
          },
          __from: '#/$defs/address'
        },
        workAddress: {
          type: 'object',
          properties: {
            street: { type: 'string' },
            city: { type: 'string' }
          },
          __from: '#/$defs/address'
        }
      }
    } as any;

    // User edits homeAddress.street to add maxLength
    edited.properties.homeAddress.properties.street = {
      type: 'string',
      maxLength: 100
    };

    const rehydrated = rehydrateSchema(original, edited) as any;

    // The edit should be synced back to the definition
    expect(rehydrated.$defs).toBeTruthy();
    expect(rehydrated.$defs.address).toBeTruthy();
    expect(rehydrated.$defs.address.properties.street).toBeTruthy();
    expect(rehydrated.$defs.address.properties.street.maxLength).toBe(100);

    // __from should be cleaned up
    expect((rehydrated.$defs.address.properties.street as any).__from).toBeUndefined();
  });

  test('__from metadata takes precedence over heuristic matching when present', () => {
    const original = {
      $defs: {
        address: {
          type: 'object',
          properties: {
            street: { type: 'string' }
          }
        },
        location: {
          type: 'object',
          properties: {
            street: { type: 'string' }
          }
        }
      },
      type: 'object',
      properties: {
        place: { $ref: '#/$defs/location' }
      }
    } as any;

    // Edited view with __from explicitly marking which definition to sync to
    const edited = {
      type: 'object',
      properties: {
        place: {
          type: 'object',
          properties: {
            street: { type: 'string', minLength: 5 }
          },
          __from: '#/$defs/address'  // Explicitly mark it as coming from address, not location
        }
      }
    } as any;

    const rehydrated = rehydrateSchema(original, edited) as any;

    // Should sync to address (per __from), not location (heuristic)
    expect(rehydrated.$defs.address.properties.street.minLength).toBe(5);
    // location should remain unchanged
    expect((rehydrated.$defs.location.properties.street as any).minLength).toBeUndefined();
  });

  test('handles properties without __from using fallback heuristic matching', () => {
    const original = {
      $defs: {
        address: {
          type: 'object',
          properties: {
            street: { type: 'string' }
          }
        }
      },
      type: 'object',
      properties: {
        address: { $ref: '#/$defs/address' }
      }
    } as any;

    // Edited view WITHOUT __from metadata - property name matches definition name
    // so it will use direct name matching, not heuristic
    const edited = {
      type: 'object',
      properties: {
        address: {
          type: 'object',
          properties: {
            street: { type: 'string', minLength: 3 }
          }
          // No __from - will use name matching (address -> defs.address)
        }
      }
    } as any;

    const rehydrated = rehydrateSchema(original, edited) as any;

    // Should sync via name matching
    expect(rehydrated.$defs.address.properties.street.minLength).toBe(3);
  });

  test('__from cleanup removes metadata from all levels', () => {
    const original = {
      $defs: {
        address: {
          type: 'object',
          properties: {
            street: { type: 'string' },
            nested: {
              type: 'object',
              properties: {
                deep: { type: 'string' }
              }
            }
          }
        }
      },
      type: 'object',
      properties: {
        homeAddress: { $ref: '#/$defs/address' }
      }
    } as any;

    const edited = {
      type: 'object',
      properties: {
        homeAddress: {
          type: 'object',
          properties: {
            street: { type: 'string', __from: '#/$defs/address/properties/street' },
            nested: {
              type: 'object',
              properties: {
                deep: { type: 'string', __from: '#/$defs/address/properties/nested/properties/deep' }
              },
              __from: '#/$defs/address/properties/nested'
            }
          },
          __from: '#/$defs/address'
        }
      }
    } as any;

    const rehydrated = rehydrateSchema(original, edited) as any;

    // All __from markers should be cleaned up
    expect((rehydrated.$defs.address as any).__from).toBeUndefined();
    expect((rehydrated.$defs.address.properties.street as any).__from).toBeUndefined();
    expect((rehydrated.$defs.address.properties.nested as any).__from).toBeUndefined();
    expect((rehydrated.$defs.address.properties.nested.properties.deep as any).__from).toBeUndefined();

    // Root properties should also be clean
    const rootProps = rehydrated.properties || {};
    expect((rootProps.homeAddress as any).__from).toBeUndefined();
  });

  test('invalid __from references fall back to heuristic matching', () => {
    const original = {
      $defs: {
        address: {
          type: 'object',
          properties: {
            street: { type: 'string' }
          }
        }
      },
      type: 'object',
      properties: {
        address: { $ref: '#/$defs/address' }
      }
    } as any;

    const edited = {
      type: 'object',
      properties: {
        address: {
          type: 'object',
          properties: {
            street: { type: 'string', minLength: 2 }
          },
          __from: '#/$defs/nonexistent'  // Invalid reference
        }
      }
    } as any;

    const rehydrated = rehydrateSchema(original, edited) as any;

    // Should fall back to heuristic name matching (address -> defs.address) and still sync
    expect(rehydrated.$defs.address.properties.street.minLength).toBe(2);
  });

  test('mixed properties with and without __from sync correctly', () => {
    const original = {
      $defs: {
        address: {
          type: 'object',
          properties: {
            street: { type: 'string' }
          }
        },
        person: {
          type: 'object',
          properties: {
            name: { type: 'string' }
          }
        }
      },
      type: 'object',
      properties: {
        homeAddress: { $ref: '#/$defs/address' },
        person: { $ref: '#/$defs/person' }
      }
    } as any;

    const edited = {
      type: 'object',
      properties: {
        homeAddress: {
          type: 'object',
          properties: {
            street: { type: 'string', maxLength: 100 }
          },
          __from: '#/$defs/address'  // Has explicit __from
        },
        person: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1 }
          }
          // No __from - property name matches definition name, uses direct name matching
        }
      }
    } as any;

    const rehydrated = rehydrateSchema(original, edited) as any;

    // Both should sync correctly - first via __from, second via name matching
    expect(rehydrated.$defs.address.properties.street.maxLength).toBe(100);
    expect(rehydrated.$defs.person.properties.name.minLength).toBe(1);
  });
});
