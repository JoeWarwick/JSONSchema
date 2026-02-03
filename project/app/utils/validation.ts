import { resolveSchema } from './schema-resolver';
import type { ValidateFunction } from 'ajv';

// Preserve legacy behavior for empty values
export function isEmptyValue(value: unknown): boolean {
  if (value === '' || value === undefined || value === null) return true;
  if (typeof value === 'object') {
    if (Array.isArray(value)) return value.length === 0;
    try {
      return Object.keys(value as Record<string, unknown>).length === 0;
    } catch (_) { return false; }
  }
  return false;
}

const validatorCache = new Map<string, any>();

// Attempt to use Ajv at runtime; fall back to a lightweight validator if Ajv isn't available
// lightweight local merge helper for simple allOf cases (avoid external dependency)
function makeSimpleValidator(schema: Record<string, unknown>) {
  const fn: any = (data: any) => {
    const errors: any[] = [];
    try {
      if (schema.enum && Array.isArray(schema.enum) && !schema.enum.includes(data)) {
        errors.push({ instancePath: '', message: `Value must be one of: ${(schema.enum as any[]).map(String).join(', ')}` });
      }
      const type = schema.type as string | string[] | undefined;
      if (type) {
        const types = Array.isArray(type) ? type : [type];
        const ok = types.some(t => {
          switch (t) {
            case 'string': return typeof data === 'string';
            case 'number': return typeof data === 'number' && !Number.isNaN(data);
            case 'boolean': return typeof data === 'boolean';
            case 'object': return typeof data === 'object' && data !== null && !Array.isArray(data);
            case 'array': return Array.isArray(data);
            case 'null': return data === null;
            default: return true;
          }
        });
        if (!ok) errors.push({ instancePath: '', message: `must be ${typeof type === 'string' ? type : 'one of types'}` });
      }

      // required properties
      if (schema.required && Array.isArray(schema.required) && typeof data === 'object' && data !== null && !Array.isArray(data)) {
        for (const req of schema.required) {
          if (!(req in data)) {
            errors.push({ instancePath: '', message: `must have required property '${req}'` });
          }
        }
      }

      // additionalProperties: false
      if (schema.additionalProperties === false && typeof data === 'object' && data !== null && !Array.isArray(data)) {
        const props = (schema.properties as Record<string, unknown>) || {};
        const patterns = Object.keys((schema.patternProperties as Record<string, unknown>) || {});
        for (const key of Object.keys(data)) {
          if (props[key]) continue;
          let matchedPattern = false;
          for (const p of patterns) {
            try { if (new RegExp(p).test(key)) { matchedPattern = true; break; } } catch (_) {
              /* ignore */
            }
          }
          if (!matchedPattern) {
            errors.push({ instancePath: '', message: `property '${key}' is not allowed` });
          }
        }
      }

      if (schema.pattern && typeof data === 'string') {
        try { const re = new RegExp(String(schema.pattern)); if (!re.test(data)) errors.push({ instancePath: '', message: 'must match pattern' }); } catch (e) { /* ignore */ errors.push({ instancePath: '', message: 'Invalid pattern' }); }
      }
      // minimal formats
      if (schema.format && typeof data === 'string') {
        const fmt = String(schema.format);
        const isIsoDateTime = (s: string) => !Number.isNaN(Date.parse(s)) && /T/.test(s);
        const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
        const isTime = (s: string) => /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s);
        const isEmail = (s: string) => /\S+@\S+\.\S+/.test(s);
        const isIPv4 = (s: string) => /^(25[0-5]|2[0-4]\d|[01]?\d?\d)(\.(25[0-5]|2[0-4]\d|[01]?\d?\d)){3}$/.test(s);
        const isIPv6 = (s: string) => /^[0-9a-fA-F:]+$/.test(s);
        const isUUID = (s: string) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(s);
        const isHostname = (s: string) => /^[a-zA-Z0-9.-]+$/.test(s);

        switch (fmt) {
          case 'date-time': if (!isIsoDateTime(data)) errors.push({ instancePath: '', message: 'must match format date-time' }); break;
          case 'date': if (!isDate(data)) errors.push({ instancePath: '', message: 'must match format date' }); break;
          case 'time': if (!isTime(data)) errors.push({ instancePath: '', message: 'must match format time' }); break;
          case 'email': if (!isEmail(data)) errors.push({ instancePath: '', message: 'must match format email' }); break;
          case 'uri': try { new URL(data); } catch (_) { /* ignore */ errors.push({ instancePath: '', message: 'must match format uri' }); } break;
          case 'ipv4': if (!isIPv4(data)) errors.push({ instancePath: '', message: 'must match format ipv4' }); break;
          case 'ipv6': if (!isIPv6(data)) errors.push({ instancePath: '', message: 'must match format ipv6' }); break;
          case 'uuid': if (!isUUID(data)) errors.push({ instancePath: '', message: 'must match format uuid' }); break;
          case 'hostname': if (!isHostname(data)) errors.push({ instancePath: '', message: 'must match format hostname' }); break;
          default: break;
        }
      }
    } catch (_) { /* ignore */ }

    // Combinators: oneOf/anyOf/allOf (best-effort via recursive validation)
    try {
      if (Array.isArray((schema as any).oneOf)) {
        let matched = 0;
        for (const sub of (schema as any).oneOf) {
          try { const sv = getValidator(sub || {}); if (sv(data)) matched++; } catch (_) { /* ignore */ }
        }
        if (matched !== 1) errors.push({ instancePath: '', message: 'must match exactly one schema in oneOf' });
      }
      if (Array.isArray((schema as any).anyOf)) {
        let matched = 0;
        for (const sub of (schema as any).anyOf) {
          try { const sv = getValidator(sub || {}); if (sv(data)) matched++; } catch (_) { /* ignore */ }
        }
        if (matched === 0) errors.push({ instancePath: '', message: 'must match at least one schema in anyOf' });
      }
      if (Array.isArray((schema as any).allOf)) {
        let matchedAll = true;
        for (const sub of (schema as any).allOf) {
          try { const sv = getValidator(sub || {}); if (!sv(data)) matchedAll = false; } catch (_) { matchedAll = false; }
        }
        if (!matchedAll) errors.push({ instancePath: '', message: 'must match all schemas in allOf' });
      }
    } catch (_) { /* ignore */ }

    fn.errors = errors.length > 0 ? errors : null;
    return errors.length === 0;
  };
  fn.errors = null;
  return fn;
}

function getValidator(schema: Record<string, unknown>): ValidateFunction {
  const key = JSON.stringify(schema || {});
  const cached = validatorCache.get(key);
  if (cached) return cached;
  try {
    // Try to load Ajv dynamically (Node require or dynamic import)
    let AjvCtor: any = null;
    try { AjvCtor = typeof require === 'function' ? require('ajv') : null; } catch (_) { AjvCtor = null; }
    if (!AjvCtor && (globalThis as any).Ajv) AjvCtor = (globalThis as any).Ajv;
    if (AjvCtor) {
      const AjvImpl = AjvCtor.default || AjvCtor;
      const ajv = new AjvImpl({ allErrors: true, strict: false, allowUnionTypes: true });
      try {
        // add format validators (email, date-time, uri, ipv4, uuid, etc.) when available
        const addFormats = typeof require === 'function' ? require('ajv-formats') : (globalThis as any).ajvFormats;
        if (addFormats) {
          const fn = addFormats.default || addFormats;
          fn(ajv);
        }
      } catch (_) { /* ignore */ }
      const v = ajv.compile(schema as any);
      validatorCache.set(key, v);
      return v;
    }
  } catch (_) { /* ignore */ }
  // fallback simple validator when Ajv is not available
  const simple = makeSimpleValidator(schema);
  validatorCache.set(key, simple);
  return simple as any;
}

export function validateValueAgainstSchema(value: unknown, schema: Record<string, unknown> | null): string | null {
  // Preserve existing behavior for primitive empty inputs: allow empty string/null/undefined to bypass validation
  // but do NOT treat empty arrays/objects as 'empty' so variant detection can make an explicit choice.
  if (value === '' || value === undefined || value === null) return null;
  if (!schema || typeof schema !== 'object') return null;

  try {
    const validate = getValidator(schema);
    const ok = validate(value);
    if (ok) return null;
    const errors = validate.errors || [];
    const msgs = errors.map((e: any) => {
      const dataPath = (e.instancePath && e.instancePath.length > 0) ? `${e.instancePath} ` : '';
      return `${dataPath}${e.message}`.trim();
    }).filter(Boolean);
    return msgs.length > 0 ? msgs.join('; ') : 'Invalid value';
  } catch (e) {
    // Fallback to null (no validation) on schema compilation errors
    return 'Invalid schema or validation error';
  }
}

export default validateValueAgainstSchema;

// Async validation: resolve remote $ref first when schema may reference external resources
export async function validateValueAgainstSchemaAsync(value: unknown, schema: Record<string, unknown> | null): Promise<string | null> {
  if (!schema || typeof schema !== 'object') return validateValueAgainstSchema(value, schema);
  try {
    const resolved = await resolveSchema(schema);
    return validateValueAgainstSchema(value, resolved || schema);
  } catch (_) {
    /* ignore */
    // If resolution fails, fall back to local validation
    return validateValueAgainstSchema(value, schema);
  }
}

// Collapse allOf into a single schema (useful for downstream conversions)
export function flattenSchemaAllOf(schema: Record<string, unknown>): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return schema;
  try {
    const s = JSON.parse(JSON.stringify(schema));
    if (!Array.isArray((s as any).allOf) || (s as any).allOf.length === 0) return s;
    const parts: any[] = (s as any).allOf;
    const out: any = { ...(s || {}) };
    // Merge properties and required arrays in a best-effort manner
    const mergedProps: Record<string, any> = { ...(out.properties || {}) };
    const mergedRequired: string[] = [];
    for (const p of parts) {
      if (p && typeof p === 'object') {
        if (p.properties && typeof p.properties === 'object') {
          Object.assign(mergedProps, p.properties);
        }
        if (Array.isArray(p.required)) {
          for (const r of p.required) if (!mergedRequired.includes(r)) mergedRequired.push(r);
        }
        if (p.type && !out.type) out.type = p.type;
      }
    }
    if (Object.keys(mergedProps).length > 0) out.properties = mergedProps;
    if (mergedRequired.length > 0) out.required = mergedRequired;
    delete out.allOf;
    return out;
  } catch (_) {
    /* ignore */
    return schema;
  }
}
