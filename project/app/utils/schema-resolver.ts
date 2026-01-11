// Lightweight resolver utility used across components.
// Tries to use `json-schema-ref-parser` dynamically, with a local fallback
// that can handle hoisting top-level $ref -> $defs and $anchor -> $ref mapping.
export async function resolveSchema(schema: Record<string, unknown> | null): Promise<Record<string, unknown> | null> {
  if (!schema || typeof schema !== 'object') return schema;

  try {
    const parser = await import('json-schema-ref-parser');
    const deref = await (parser as any).default.dereference(schema);
    return deref as Record<string, unknown>;
  } catch (_e) {
    // Fallback: attempt a lightweight local dereference
    try {
      const root: any = schema;
      // If top-level $ref points into $defs, hoist that definition
      if (typeof root.$ref === 'string' && root.$defs && root.$ref.startsWith('#/$defs/')) {
        const key = root.$ref.replace('#/$defs/', '');
        let candidate = (root.$defs && (root.$defs as any)[key]) || null;
        if (candidate) {
          // Build anchor map from $defs
          const anchorMap: Record<string, any> = {};
          for (const [k, v] of Object.entries(root.$defs || {})) {
            if ((v as any).$anchor) anchorMap[`#${(v as any).$anchor}`] = v;
          }
          // Replace any inner $ref that is a local anchor
          const replaceRefs = (obj: any): any => {
            if (!obj || typeof obj !== 'object') return obj;
            if (Array.isArray(obj)) return obj.map(replaceRefs);
            if (obj.$ref && typeof obj.$ref === 'string' && anchorMap[obj.$ref]) return anchorMap[obj.$ref];
            const out: any = {};
            for (const [kk, vv] of Object.entries(obj)) {
              out[kk] = replaceRefs(vv);
            }
            return out;
          };
          candidate = JSON.parse(JSON.stringify(candidate));
          const resolved = replaceRefs(candidate);
          return resolved as Record<string, unknown>;
        }
      }
    } catch (_) {
      // fall through
    }
    return schema;
  }
}

export function resolveSchemaSync(schema: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!schema || typeof schema !== 'object') return schema;
  try {
    const root: any = schema;
    if (typeof root.$ref === 'string' && root.$defs && root.$ref.startsWith('#/$defs/')) {
      const key = root.$ref.replace('#/$defs/', '');
      const def = (root.$defs as any)[key];
      if (def) return (!def.type && def.properties) ? { ...def, type: 'object' } : def;
    }
    if (!('type' in root) && !('properties' in root) && root.$defs && typeof root.$defs === 'object') {
      const keys = Object.keys(root.$defs as Record<string, unknown>);
      if (keys.length > 0) {
        const def = (root.$defs as any)[keys[0]];
        if (def) return (!def.type && def.properties) ? { ...def, type: 'object' } : def;
      }
    }
  } catch (_) {}
  return schema;
}

// Given the original (possibly $ref/$defs-based) schema and an edited resolved schema,
// rehydrate attempts to place edits back into the original $defs/$ref structure.
export function rehydrateToRefs(original: Record<string, unknown> | null, resolved: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!original || typeof original !== 'object') return resolved;
  if (!resolved || typeof resolved !== 'object') return original;

  try {
    const root: any = JSON.parse(JSON.stringify(original));

    // If original had a top-level $ref pointing into $defs, map resolved back into that def
    if (typeof root.$ref === 'string' && root.$defs && root.$ref.startsWith('#/$defs/')) {
      const key = root.$ref.replace('#/$defs/', '');
      // preserve original metadata in def (like $anchor) while applying edits from resolved
      const baseDef = (root.$defs && (root.$defs as any)[key]) || {};
      // Merge resolved onto baseDef (shallow merge for properties, deeper merge for `properties` and `items`)
      const merged = deepMerge(baseDef, resolved);
      root.$defs = { ...(root.$defs || {}), [key]: merged };
      return root;
    }

    // If original has $defs but no top-level $ref, try to find a matching def to update.
    if (root.$defs && typeof root.$defs === 'object') {
      const defs = root.$defs as Record<string, any>;
      // Heuristic: find a def whose shape (property names) overlaps most with resolved
      const resolvedKeys = new Set(Object.keys(resolved));
      let bestKey: string | null = null;
      let bestScore = -1;
      for (const [k, v] of Object.entries(defs)) {
        if (!v || typeof v !== 'object') continue;
        const keys = Object.keys(v as any);
        let score = 0;
        for (const kk of keys) if (resolvedKeys.has(kk)) score++;
        if (score > bestScore) {
          bestScore = score;
          bestKey = k;
        }
      }
      if (bestKey) {
        const baseDef = defs[bestKey] || {};
        const merged = deepMerge(baseDef, resolved);
        root.$defs = { ...defs, [bestKey]: merged };
        return root;
      }
    }

    // Fallback: if nothing to rehydrate into, return the resolved schema as-is
    return resolved;
  } catch (_) {
    return resolved;
  }
}

function deepMerge(a: any, b: any): any {
  if (a === null || a === undefined) return b;
  if (b === null || b === undefined) return a;
  if (Array.isArray(a) || Array.isArray(b)) return b;
  if (typeof a !== 'object' || typeof b !== 'object') return b;
  const out: any = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (k === 'properties' && typeof v === 'object' && typeof a[k] === 'object') {
      out[k] = { ...(a[k] || {}), ...(v || {}) };
    } else if (k === 'items' && typeof v === 'object' && typeof a[k] === 'object') {
      out[k] = { ...(a[k] || {}), ...(v || {}) };
    } else if (typeof v === 'object' && v !== null && typeof a[k] === 'object') {
      out[k] = deepMerge(a[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
