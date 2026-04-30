import { schemaNodeDataToSchema } from './schema-behaviors';

describe('schemaNodeDataToSchema property constraints', () => {
  it('serializes minProperties/maxProperties on object nodes', () => {
    const result = schemaNodeDataToSchema({
      id: '1',
      label: 'Root',
      type: 'object',
      minProperties: 1,
      maxProperties: 5,
    } as any);

    expect((result as any).minProperties).toBe(1);
    expect((result as any).maxProperties).toBe(5);
  });

  it('omits minProperties/maxProperties when undefined', () => {
    const result = schemaNodeDataToSchema({
      id: '1',
      label: 'Root',
      type: 'object',
    } as any);

    expect((result as any).minProperties).toBeUndefined();
    expect((result as any).maxProperties).toBeUndefined();
  });
});
