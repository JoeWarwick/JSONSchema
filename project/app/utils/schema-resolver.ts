// Lightweight resolver utility used across components.
// Tries to use `json-schema-ref-parser` dynamically, with a local fallback
// that can handle hoisting top-level $ref -> $defs and $anchor -> $ref mapping.
export async function resolveSchema(schema: Record<string, unknown> | null): Promise<Record<string, unknown> | null> {
  if (!schema || typeof schema !== 'object') return schema;

  try {
    const parser = await import('json-schema-ref-parser');
    const deref = await (parser as any).default.dereference(schema);
    // Normalize parser output: if it still contains $defs or appears to be
    // a defs map, hoist/inline into a root object with `properties` so editors
    // always receive a concrete root-object schema.
    try {
      const root: any = deref;
      if (root && typeof root === 'object') {
        if (root.$defs && typeof root.$defs === 'object') {
          const defs = JSON.parse(JSON.stringify(root.$defs));
          const anchorMap: Record<string, any> = {};
          for (const [k, v] of Object.entries(defs)) {
            if ((v as any).$anchor) anchorMap[`#${(v as any).$anchor}`] = v;
            anchorMap[`#/$defs/${k}`] = v;
          }
          // Build properties by inlining each def and tagging with a non-standard marker
          const props: Record<string, any> = {};
          const replaceRefs = (obj: any): any => {
            if (!obj || typeof obj !== 'object') return obj;
            if (Array.isArray(obj)) return obj.map(replaceRefs);
            if (obj.$ref && typeof obj.$ref === 'string') {
              const ref = obj.$ref as string;
              if (anchorMap[ref]) return replaceRefs(anchorMap[ref]);
              if (ref.startsWith('#/$defs/')) {
                const key = ref.replace('#/$defs/', '');
                if (defs[key]) return replaceRefs(defs[key]);
              }
              return obj;
            }
            const out: any = {};
            for (const [kk, vv] of Object.entries(obj)) out[kk] = replaceRefs(vv);
            return out;
          };
          for (const [k, v] of Object.entries(defs)) {
            const clone = JSON.parse(JSON.stringify(v));
            // attach marker indicating original def anchor/key
            if ((clone as any).$anchor) {
              clone.__from = `#${(clone as any).$anchor}`;
              delete clone.$anchor;
            } else {
              clone.__from = `#/$defs/${k}`;
            }
            props[k] = replaceRefs(clone);
          }
          return { type: 'object', properties: props };
        }
        // If parser returned a plain object whose keys look like def names
        // (each value is a schema object), treat it as properties.
        const keys = Object.keys(root || {});
        if (!('type' in root) && !('properties' in root) && keys.length > 0) {
          let looksLikeDefs = true;
          for (const k of keys) {
            const v = (root as any)[k];
            if (!v || typeof v !== 'object') { looksLikeDefs = false; break; }
          }
          if (looksLikeDefs) {
            return { type: 'object', properties: JSON.parse(JSON.stringify(root)) };
          }
        }
      }
    } catch (_) {}
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
            if (obj.$ref && typeof obj.$ref === 'string' && anchorMap[obj.$ref]) {
              const target = JSON.parse(JSON.stringify(anchorMap[obj.$ref]));
              // remove anchor metadata and ensure no nested $ref remains
              delete target.$anchor;
              return replaceRefs(target);
            }
            const out: any = {};
            for (const [kk, vv] of Object.entries(obj)) {
              out[kk] = replaceRefs(vv);
            }
            return out;
          };
          candidate = JSON.parse(JSON.stringify(candidate));
          const resolved = replaceRefs(candidate);
            // Ensure inlined candidate gets __from marker when hoisted in fallback path
            if ((candidate as any).$anchor) {
              (resolved as any).__from = `#${(candidate as any).$anchor}`;
              delete (candidate as any).$anchor;
            }
            return resolved as Record<string, unknown>;
        }
      }
    } catch (_) {
      // fall through
    }
    // If we couldn't dereference, but schema contains $defs and no top-level properties/type,
    // hoist $defs into a root `properties` object so editors receive a usable object root.
    try {
      const root: any = schema;
      if (!root.type && !root.properties && root.$defs && typeof root.$defs === 'object') {
        // Deep clone defs
        const defs = JSON.parse(JSON.stringify(root.$defs));
        // Build anchor and defs map for local ref replacement
        const anchorMap: Record<string, any> = {};
        for (const [k, v] of Object.entries(defs)) {
          if ((v as any).$anchor) anchorMap[`#${(v as any).$anchor}`] = v;
          // also map by defs path
          anchorMap[`#/$defs/${k}`] = v;
        }
        const replaceRefs = (obj: any): any => {
          if (!obj || typeof obj !== 'object') return obj;
          if (Array.isArray(obj)) return obj.map(replaceRefs);
          // If this is a $ref node, inline it where possible
          if (obj.$ref && typeof obj.$ref === 'string') {
            const ref = obj.$ref as string;
            if (anchorMap[ref]) {
              const target = JSON.parse(JSON.stringify(anchorMap[ref]));
              // mark original anchor on the inlined copy
              if ((target as any).$anchor) {
                (target as any).__from = `#${(target as any).$anchor}`;
                delete (target as any).$anchor;
              }
              return replaceRefs(target);
            }
            // support local #Anchor (without leading /$defs)
            if (ref.startsWith('#') && anchorMap[ref]) {
              const target = JSON.parse(JSON.stringify(anchorMap[ref]));
              if ((target as any).$anchor) {
                (target as any).__from = `#${(target as any).$anchor}`;
                delete (target as any).$anchor;
              }
              return replaceRefs(target);
            }
            // support #/$defs/key
            if (ref.startsWith('#/$defs/')) {
              const key = ref.replace('#/$defs/', '');
              if (defs[key]) {
                const target = JSON.parse(JSON.stringify(defs[key]));
                if ((target as any).$anchor) {
                  (target as any).__from = `#${(target as any).$anchor}`;
                  delete (target as any).$anchor;
                } else {
                  (target as any).__from = `#/$defs/${key}`;
                }
                return replaceRefs(target);
              }
            }
            // otherwise leave as-is
            return obj;
          }
          const out: any = {};
          for (const [kk, vv] of Object.entries(obj)) {
            out[kk] = replaceRefs(vv);
          }
          return out;
        };

        const props: Record<string, any> = {};
        for (const [k, v] of Object.entries(defs)) {
          const clone = JSON.parse(JSON.stringify(v));
          if ((clone as any).$anchor) {
            clone.__from = `#${(clone as any).$anchor}`;
            delete clone.$anchor;
          } else {
            clone.__from = `#/$defs/${k}`;
          }
          props[k] = replaceRefs(clone);
        }
        const out: any = { type: 'object', properties: props };
        return out;
      }
    } catch (_) {}
    return schema;
  }
}

export function resolveSchemaSync(schema: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!schema || typeof schema !== 'object') return schema;
  try {
    const root: any = schema;
    // Intentionally fall through to the unified hoist/inlining fallback below
    // so that resolved output is consistently a root `object` with `properties`.
  } catch (_) {}
  // If there are only $defs and no explicit root, hoist defs into properties for a fast sync fallback
  try {
    const root: any = schema;
    if (!root.type && !root.properties && root.$defs && typeof root.$defs === 'object') {
      const defs = JSON.parse(JSON.stringify(root.$defs));
      const anchorMap: Record<string, any> = {};
      for (const [k, v] of Object.entries(defs)) {
        if ((v as any).$anchor) anchorMap[`#${(v as any).$anchor}`] = v;
        anchorMap[`#/$defs/${k}`] = v;
      }
      const replaceRefs = (obj: any): any => {
        if (!obj || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj.map(replaceRefs);
        if (obj.$ref && typeof obj.$ref === 'string') {
          const ref = obj.$ref as string;
          if (anchorMap[ref]) {
            const target = JSON.parse(JSON.stringify(anchorMap[ref]));
            delete target.$anchor;
            return replaceRefs(target);
          }
          if (ref.startsWith('#/$defs/')) {
            const key = ref.replace('#/$defs/', '');
            if (defs[key]) {
              const target = JSON.parse(JSON.stringify(defs[key]));
              delete target.$anchor;
              return replaceRefs(target);
            }
          }
          return obj;
        }
        const out: any = {};
        for (const [kk, vv] of Object.entries(obj)) out[kk] = replaceRefs(vv);
        return out;
      };
      const props: Record<string, any> = {};
      for (const [k, v] of Object.entries(defs)) {
        const clone = JSON.parse(JSON.stringify(v));
        if ((clone as any).$anchor) {
          clone.__from = `#${(clone as any).$anchor}`;
          delete clone.$anchor;
        } else {
          clone.__from = `#/$defs/${k}`;
        }
        props[k] = replaceRefs(clone);
      }
      return { type: 'object', properties: props };
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
      // If resolved contains inline copies tagged with `__from`, move them back into $defs and replace with $ref
      try {
        const resolvedProps = resolved && resolved.properties && typeof resolved.properties === 'object' ? resolved.properties as Record<string, any> : {};
        let mutated = false;
        for (const [pname, pschema] of Object.entries(resolvedProps)) {
          if (pschema && typeof pschema === 'object' && typeof (pschema as any).__from === 'string') {
            const marker = (pschema as any).__from as string;
            let targetKey: string | null = null;
            if (marker.startsWith('#/$defs/')) {
              targetKey = marker.replace('#/$defs/', '');
            } else if (marker.startsWith('#')) {
              const anchorName = marker.slice(1);
              for (const k of Object.keys(defs)) {
                if ((defs[k] as any).$anchor === anchorName) { targetKey = k; break; }
              }
            }
            // If we couldn't resolve a targetKey from anchor, prefer the property name
            if (!targetKey) targetKey = pname;

            const baseDef = defs[targetKey] || {};
            const clone = JSON.parse(JSON.stringify(pschema));
            delete clone.__from;
            const merged = deepMerge(baseDef, clone);
            root.$defs = { ...(root.$defs || {}), [targetKey]: merged };
            // Replace the inline property with a $ref to the defs entry
            resolved.properties[pname] = { $ref: `#/$defs/${targetKey}` } as any;
            mutated = true;
          }
        }
        if (mutated) {
          return root;
        }
      } catch (_) {}
        // Deterministic mapping rules (in priority order):
        // 1. If resolved has `properties` and it contains a single key that matches a def key, pick that def.
        // 2. Otherwise, score defs by overlap between their `properties` keys and resolved.properties keys.
        // 3. Tie-breaker: alphabetical order of def key.
        const defKeys = Object.keys(defs);
        const resolvedProps = resolved && typeof resolved === 'object' && resolved.properties && typeof resolved.properties === 'object'
          ? Object.keys(resolved.properties as Record<string, any>)
          : [];

        if (resolvedProps.length === 1 && defKeys.includes(resolvedProps[0])) {
          const key = resolvedProps[0];
          const baseDef = defs[key] || {};
          const merged = deepMerge(baseDef, resolved);
          root.$defs = { ...defs, [key]: merged };
          return root;
        }

        // Score by overlap of property names (if available)
        let bestKey: string | null = null;
        let bestScore = -1;
        for (const k of defKeys.sort()) {
          const v = defs[k];
          if (!v || typeof v !== 'object') continue;
          const defProps = v.properties && typeof v.properties === 'object' ? Object.keys(v.properties as Record<string, any>) : [];
          let score = 0;
          for (const p of resolvedProps) if (defProps.includes(p)) score++;
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
