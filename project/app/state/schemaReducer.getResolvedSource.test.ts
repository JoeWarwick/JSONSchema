import { getResolvedSource, initialSchemaState, type Schema } from "./schemaReducer";
import fs from 'fs';
import path from 'path';

describe("schemaReducer getResolvedSource - $defs preservation", () => {
  const sourceWithDefs: Schema = {
    $id: "https://example.com/schema.json",
    type: "object",
    properties: {
      name: { type: "string" },
      address: { $ref: "#/$defs/address" },
    },
    $defs: {
      address: {
        type: "object",
        properties: {
          street: { type: "string" },
          city: { type: "string" },
        },
      },
    },
  } as any;

  const resolvedCacheWithoutDefs: Schema = {
    type: "object",
    properties: {
      name: { type: "string" },
      address: {
        type: "object",
        properties: {
          street: { type: "string" },
          city: { type: "string" },
        },
      },
    },
  } as any;

  it("should preserve $defs from source when resolvedCache doesn't have them", () => {
    const state = {
      ...initialSchemaState(sourceWithDefs),
      resolvedCache: resolvedCacheWithoutDefs,
    };

    const result = getResolvedSource(state);

    expect(result).toBeDefined();
    expect((result as any).$defs).toBeDefined();
    expect((result as any).$defs?.address).toBeDefined();
    if (sourceWithDefs && typeof sourceWithDefs === 'object' && sourceWithDefs.$defs) {
      expect((result as any).$defs?.address).toEqual((sourceWithDefs as any).$defs?.address);
    }
  });

  it("should not overwrite $defs if they already exist in resolved cache", () => {
    const resolvedWithDefs = {
      ...resolvedCacheWithoutDefs,
      $defs: {
        address: {
          type: "object",
          properties: {
            street: { type: "string" },
          },
        },
      },
    } as any;

    const state = {
      ...initialSchemaState(sourceWithDefs),
      resolvedCache: resolvedWithDefs,
    };

    const result = getResolvedSource(state);

    expect(result).toBeDefined();
    expect((result as any).$defs).toBeDefined();
    expect((result as any).$defs?.address?.properties).toEqual({
      street: { type: "string" },
    });
  });

  it("should handle missing source gracefully", () => {
    const state = {
      ...initialSchemaState(sourceWithDefs),
      source: null as any,
      resolvedCache: resolvedCacheWithoutDefs,
    };

    const result = getResolvedSource(state);

    expect(result).toBeDefined();
    expect((result as any).$defs).toBeUndefined();
  });

  it("should inline definitions when exporting for download", () => {
    const stateWithComplexDefs: Schema = {
      $id: "https://example.com/schema.json",
      type: "object",
      properties: {
        homeAddress: { $ref: "#/$defs/address" },
        workAddress: { $ref: "#/$defs/address" },
      },
      $defs: {
        address: {
          type: "object",
          properties: {
            street: { type: "string" },
            city: { type: "string" },
            zip: { type: "string" },
          },
        },
      },
    } as any;

    const resolvedWithInline: Schema = {
      type: "object",
      properties: {
        homeAddress: {
          type: "object",
          properties: {
            street: { type: "string" },
            city: { type: "string" },
            zip: { type: "string" },
          },
        },
        workAddress: {
          type: "object",
          properties: {
            street: { type: "string" },
            city: { type: "string" },
            zip: { type: "string" },
          },
        },
      },
    } as any;

    const state = {
      ...initialSchemaState(stateWithComplexDefs),
      resolvedCache: resolvedWithInline,
    };

    const result = getResolvedSource(state);

    expect(result).toBeDefined();
    expect((result as any).$defs).toBeDefined();
    expect((result as any).$defs?.address).toBeDefined();

    expect((result as any)?.properties?.homeAddress).toBeDefined();
    expect((result as any)?.properties?.homeAddress.type).toBe("object");
  });

  it("should fail if $defs are lost during export", () => {
    const state = {
      ...initialSchemaState(sourceWithDefs),
      resolvedCache: resolvedCacheWithoutDefs,
    };

    const result = getResolvedSource(state);

    expect(result).toBeDefined();
    expect((result as any).$defs).toBeTruthy();
    expect(Object.keys((result as any).$defs || {})).toContain("address");
  });

  it("should preserve definitions from source when resolvedCache doesn't have them", () => {
    const sourceWithDefinitions: Schema = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        concurrency: { $ref: "#/definitions/concurrency" },
      },
      definitions: {
        concurrency: {
          type: "object",
          properties: {
            group: { type: "string" },
          },
          required: ["group"],
        },
      },
    } as any;

    const resolvedWithoutDefinitions: Schema = {
      type: "object",
      properties: {
        concurrency: {
          type: "object",
          properties: {
            group: { type: "string" },
          },
        },
      },
    } as any;

    const state = {
      ...initialSchemaState(sourceWithDefinitions),
      resolvedCache: resolvedWithoutDefinitions,
    };

    const result = getResolvedSource(state) as any;

    expect(result).toBeDefined();
    expect(result.definitions).toBeDefined();
    expect(result.definitions?.concurrency).toBeDefined();
  });

  it("should preserve definitions for full schemastore workflow fixture", () => {
    const fixturePath = path.join(process.cwd(), 'app', 'test-fixtures', 'schemastore-workflow.json');
    const fullWorkflowSchema = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as Schema;

    const state = {
      ...initialSchemaState(fullWorkflowSchema),
      resolvedCache: { type: 'object', properties: {} } as Schema,
    };

    const result = getResolvedSource(state) as any;

    expect(result).toBeDefined();
    expect(result.definitions).toBeDefined();
    expect(result.definitions?.architecture).toBeDefined();
    expect(result.definitions?.concurrency).toBeDefined();
  });
});
