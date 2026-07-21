declare module "js-yaml" {
  const yaml: {
    load(input: string, options?: Record<string, unknown>): unknown;
    dump(input: unknown, options?: Record<string, unknown>): string;
  };

  export default yaml;
}