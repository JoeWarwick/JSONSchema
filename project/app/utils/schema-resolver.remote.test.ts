import { resolveSchema } from './schema-resolver';
import * as fs from 'fs';
import * as path from 'path';

// Ensure Jest has sufficient time if resolver tries dynamic imports
jest.setTimeout(30000);

const remoteSchema = {
  $id: 'https://example.com/user-profile.schema.json',
  type: 'object',
  properties: {
    firstName: { type: 'string' },
    phone: { type: 'string' }
  }
};

const unresolved = {
  $id: 'https://example.com/health-record.schema.json',
  type: 'object',
  properties: {
    emergencyContact: { $ref: 'https://example.com/user-profile.schema.json' }
  }
} as any;

describe('schema-resolver remote $ref', () => {
  const schemaFile = path.resolve(process.cwd(), 'public/schemas/user-profile.schema.json');
  let originalFetch: any;

  beforeAll(() => {
    originalFetch = (global as any).fetch;
  });

  afterAll(() => {
    (global as any).fetch = originalFetch;
  });

  test('resolveSchema inlines remote https $ref via fetch', async () => {
    const unresolved = {
      $id: 'https://example.com/health-record.schema.json',
      type: 'object',
      properties: {
        emergencyContact: { $ref: 'https://example.com/user-profile.schema.json' }
      }
    } as any;

    const body = fs.readFileSync(schemaFile, 'utf-8');
    let parsed = {} as any;
    try { parsed = JSON.parse(body); } catch (_) { parsed = {}; }

    // Mock global fetch to return the local schema file
    (global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
      return {
        ok: true,
        json: async () => parsed,
        text: async () => body,
        headers: { get: (_: string) => 'application/json' }
      } as any;
    });

    const resolved = await resolveSchema(unresolved);

    // Expect the emergencyContact to be expanded into an object with nested properties
    expect(resolved).toBeTruthy();
    // properties -> emergencyContact -> properties -> firstName/phone should exist
    const em = (resolved as any).properties?.emergencyContact;
    expect(em).toBeTruthy();
    expect(em.properties).toBeTruthy();
    expect(em.properties.firstName).toBeTruthy();
    expect(em.properties.phone).toBeTruthy();
  });
});

// Ensure Jest has sufficient time if resolver tries dynamic imports
jest.setTimeout(30000);

describe('schema-resolver remote $ref', () => {
  const schemaFile = path.resolve(process.cwd(), 'public/schemas/user-profile.schema.json');
  let originalFetch: any;

  beforeAll(() => {
    originalFetch = (global as any).fetch;
  });

  afterAll(() => {
    (global as any).fetch = originalFetch;
  });

  test('resolveSchema inlines remote https $ref via fetch', async () => {
    const unresolved = {
      $id: 'https://example.com/health-record.schema.json',
      type: 'object',
      properties: {
        emergencyContact: { $ref: 'https://example.com/user-profile.schema.json' }
      }
    } as any;

    const body = fs.readFileSync(schemaFile, 'utf-8');
    let parsed = {};
    try { parsed = JSON.parse(body); } catch (_) { parsed = {}; }

    // Mock global fetch to return the local schema file
    (global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
      return {
        ok: true,
        json: async () => parsed,
        text: async () => body,
        headers: { get: (_: string) => 'application/json' }
      } as any;
    });

    const resolved = await resolveSchema(unresolved);

    // Expect the emergencyContact to be expanded into an object with nested properties
    expect(resolved).toBeTruthy();
    // properties -> emergencyContact -> properties -> firstName/phone should exist
    const em = (resolved as any).properties?.emergencyContact;
    expect(em).toBeTruthy();
    expect(em.properties).toBeTruthy();
    expect(em.properties.firstName).toBeTruthy();
    expect(em.properties.phone).toBeTruthy();
  });
});

describe('remote $ref resolution', () => {
  beforeAll(() => {
    (global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url === 'https://example.com/user-profile.schema.json') {
        return {
          ok: true,
          headers: { get: (k: string) => 'application/json' },
          json: async () => remoteSchema,
          text: async () => JSON.stringify(remoteSchema)
        };
      }
      return { ok: false, status: 404, headers: { get: () => 'text/plain' }, text: async () => 'Not found' };
    });
  });

  afterAll(() => {
    delete (global as any).fetch;
  });

  test('resolves https remote $ref via fetch', async () => {
    const resolved = await resolveSchema(unresolved as any);
    // Debug logging removed
    expect(resolved).toBeTruthy();
    expect((resolved as any).properties).toBeTruthy();
    const ec = (resolved as any).properties.emergencyContact;
    expect(ec).toBeTruthy();
    expect(ec.type).toBe('object');
    expect(ec.properties.firstName).toBeTruthy();
  });
});
