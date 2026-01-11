import { resolveSchema } from "~/utils/schema-resolver";

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
    expect(resolved).toBeTruthy();
    expect((resolved as any).properties).toBeTruthy();
    const ec = (resolved as any).properties.emergencyContact;
    expect(ec).toBeTruthy();
    expect(ec.type).toBe('object');
    expect(ec.properties.firstName).toBeTruthy();
  });
});
