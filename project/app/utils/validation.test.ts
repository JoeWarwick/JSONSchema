import { validateValueAgainstSchema } from './validation';

describe('validateValueAgainstSchema', () => {
  test('allows empty values', () => {
    expect(validateValueAgainstSchema('', { type: 'string' })).toBeNull();
    expect(validateValueAgainstSchema(null, { type: 'string' })).toBeNull();
  });

  test('validates enum membership', () => {
    const schema = { enum: ['a', 'b'] } as any;
    expect(validateValueAgainstSchema('a', schema)).toBeNull();
    const err = validateValueAgainstSchema('c', schema);
    expect(err).toMatch(/one of/i);
  });

  test('validates types', () => {
    expect(validateValueAgainstSchema('x', { type: 'number' } as any)).toMatch(/number/i);
    expect(validateValueAgainstSchema(3, { type: 'number' } as any)).toBeNull();
    expect(validateValueAgainstSchema({}, { type: 'object' } as any)).toBeNull();
  });

  test('validates pattern', () => {
    const schema = { type: 'string', pattern: '^abc$' } as any;
    expect(validateValueAgainstSchema('abc', schema)).toBeNull();
    expect(validateValueAgainstSchema('ab', schema)).toMatch(/pattern/i);
  });

  test('validates common formats', () => {
    expect(validateValueAgainstSchema('2020-01-01T12:00:00Z', { format: 'date-time' } as any)).toBeNull();
    expect(validateValueAgainstSchema('2020-01-01', { format: 'date' } as any)).toBeNull();
    expect(validateValueAgainstSchema('12:34:56', { format: 'time' } as any)).toBeNull();
    expect(validateValueAgainstSchema('a@b.com', { format: 'email' } as any)).toBeNull();
    expect(validateValueAgainstSchema('http://example.com', { format: 'uri' } as any)).toBeNull();
    expect(validateValueAgainstSchema('127.0.0.1', { format: 'ipv4' } as any)).toBeNull();
    expect(validateValueAgainstSchema('550e8400-e29b-41d4-a716-446655440000', { format: 'uuid' } as any)).toBeNull();

    expect(validateValueAgainstSchema('not-a-date', { format: 'date-time' } as any)).toMatch(/date-time/i);
    expect(validateValueAgainstSchema('not-email', { format: 'email' } as any)).toMatch(/email/i);
    expect(validateValueAgainstSchema('999.999.999.999', { format: 'ipv4' } as any)).toMatch(/IPv4/i);
  });
});
