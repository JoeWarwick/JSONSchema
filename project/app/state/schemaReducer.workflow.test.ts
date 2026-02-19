import { initialSchemaState, getResolvedSource, type Schema } from "./schemaReducer";

describe("Full workflow: Load, Hydrate, Download, Reload with ref button", () => {
  // Minimal workflow schema with definitions
  const simpleWorkflowSchema: Schema = {
    type: "object",
    properties: {
      name: { type: "string" },
      jobs: { type: "object", additionalProperties: true },
    },
    $defs: {
      job: {
        type: "object",
        properties: {
          name: { type: "string" },
          steps: { type: "array", items: { type: "object" } },
        },
      },
      step: {
        type: "object",
        properties: {
          run: { type: "string" },
        },
      },
    },
  } as any;

  it("should preserve $defs through full workflow", () => {
    const state = {
      ...initialSchemaState(simpleWorkflowSchema),
    };

    const exported = getResolvedSource(state);
    expect(exported).toBeDefined();
    expect((exported as any).$defs).toBeDefined();
    expect((exported as any).$defs?.job).toBeDefined();
    expect((exported as any).$defs?.step).toBeDefined();

    const defNames = Object.keys((exported as any).$defs || {});
    expect(defNames.length).toBeGreaterThan(0);
    expect(defNames).toContain("job");
  });

  it("should maintain defs through 3 download cycles", () => {
    let current = simpleWorkflowSchema;

    for (let i = 0; i < 3; i++) {
      const state = {
        ...initialSchemaState(current),
      };

      const exported = getResolvedSource(state);

      expect(exported).toBeDefined();
      expect((exported as any).$defs).toBeDefined();
      expect(Object.keys((exported as any).$defs || {}).length).toBeGreaterThan(0);

      current = exported!;
    }

    expect((current as any).$defs?.job).toBeDefined();
    expect((current as any).$defs?.step).toBeDefined();
  });

  it("should preserve nested ref structures", () => {
    const nestedSchema: Schema = {
      type: "object",
      properties: {
        config: { type: "object" },
      },
      $defs: {
        config: {
          type: "object",
          properties: {
            items: { type: "array", items: { type: "object" } },
          },
        },
        item: {
          type: "object",
          properties: {
            name: { type: "string" },
          },
        },
      },
    } as any;

    const state = {
      ...initialSchemaState(nestedSchema),
    };

    const exported = getResolvedSource(state);

    expect(exported).toBeDefined();
    expect((exported as any).$defs).toBeDefined();
    expect((exported as any).$defs?.config).toBeDefined();
    expect((exported as any).$defs?.item).toBeDefined();
  });
});
