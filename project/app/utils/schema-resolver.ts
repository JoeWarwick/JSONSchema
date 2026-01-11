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
              delete clone.$anchor;
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
            const propsClone = JSON.parse(JSON.stringify(root));
            for (const pk of Object.keys(propsClone)) {
              const pv = propsClone[pk];
              if (pv && typeof pv === 'object' && ('$anchor' in pv)) {
                delete propsClone[pk];
              }
            }
            return { type: 'object', properties: propsClone };
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
          // Remove any transient anchor metadata from the hoisted candidate
          if ((candidate as any).$anchor) {
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
                delete (target as any).$anchor;
              }
              return replaceRefs(target);
            }
            // support local #Anchor (without leading /$defs)
            if (ref.startsWith('#') && anchorMap[ref]) {
              const target = JSON.parse(JSON.stringify(anchorMap[ref]));
              if ((target as any).$anchor) {
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
                  delete (target as any).$anchor;
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
            delete clone.$anchor;
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
    // If there is a top-level $defs and no meaningful root properties, hoist defs
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
          delete clone.$anchor;
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

    // (debug logs removed)
    // Helper: if a merged def accidentally contains its own `$defs`, absorb
    // those entries into the top-level `root.$defs` to avoid creating
    // nested `$defs` which break idempotence across rehydrate cycles.
    const absorbNestedDefs = (rootObj: any, mergedObj: any) => {
      if (!mergedObj || typeof mergedObj !== 'object') return;
      if (!mergedObj.$defs || typeof mergedObj.$defs !== 'object') return;
      if (!rootObj.$defs || typeof rootObj.$defs !== 'object') rootObj.$defs = {};
      for (const [nk, nv] of Object.entries(mergedObj.$defs)) {
        if (!Object.prototype.hasOwnProperty.call(rootObj.$defs, nk)) {
          rootObj.$defs[nk] = nv;
        } else {
          try {
            rootObj.$defs[nk] = deepMerge(rootObj.$defs[nk], nv);
          } catch (_) {}
        }
      }
      delete mergedObj.$defs;
    };

    // If original had a top-level $ref pointing into $defs, map resolved back into that def
    if (typeof root.$ref === 'string' && root.$defs && root.$ref.startsWith('#/$defs/')) {
      const key = root.$ref.replace('#/$defs/', '');
      // preserve original metadata in def (like $anchor) while applying edits from resolved
      const baseDef = (root.$defs && (root.$defs as any)[key]) || {};
      // Merge resolved onto baseDef (shallow merge for properties, deeper merge for `properties` and `items`)
      let merged = deepMerge(baseDef, resolved);
      // prevent nested $defs inside this merged def
      absorbNestedDefs(root, merged);
      // remove top-level metadata that shouldn't be copied into a def
      if (merged && typeof merged === 'object') {
        delete merged.$id;
        delete merged.$schema;
      }
      root.$defs = { ...(root.$defs || {}), [key]: merged };
      return root;
    }

    // If original has $defs but no top-level $ref, try to find a matching def to update.
    if (root.$defs && typeof root.$defs === 'object') {
      const defs = root.$defs as Record<string, any>;
      // If resolved contains inline copies, mapping rules below will try
      // to move them back into `$defs` and replace with `$ref` where
      // possible. This uses deterministic heuristics (single-key match,
      // property-overlap scoring, alphabetical tie-breakers).
        // First, if the resolved payload contains properties whose keys
        // directly match def keys, merge those per-key into `$defs`.
        try {
          const resolvedPropsMap = resolved && resolved.properties && typeof resolved.properties === 'object'
            ? (resolved.properties as Record<string, any>)
            : {};
          let mutatedByName = false;
          for (const pname of Object.keys(resolvedPropsMap)) {
            if (Object.prototype.hasOwnProperty.call(defs, pname)) {
              const pschema = resolvedPropsMap[pname];
              const baseDef = defs[pname] || {};
              const clone = JSON.parse(JSON.stringify(pschema));
              if (clone && typeof clone === 'object') delete clone.__from;
              let merged = deepMerge(baseDef, clone);
              // (debug logs removed)
              absorbNestedDefs(root, merged);
              if (merged && typeof merged === 'object') {
                delete merged.$id;
                delete merged.$schema;
              }
              root.$defs = { ...(root.$defs || {}), [pname]: merged };
              try { if (!root.properties) root.properties = {}; root.properties[pname] = { $ref: `#/$defs/${pname}` }; } catch (_) {}
              mutatedByName = true;
            }
          }
          if (mutatedByName) return root;
        } catch (_) {}

        // Deterministic mapping rules (in priority order):
        // 1. If resolved has `properties` and it contains a single key that matches a def key, pick that def.
        // 2. Otherwise, score defs by overlap between their `properties` keys and resolved.properties keys.
        // 3. Tie-breaker: alphabetical order of def key.
        const defKeys = Object.keys(defs);
        const resolvedProps = resolved && typeof resolved === 'object' && resolved.properties && typeof resolved.properties === 'object'
          ? Object.keys(resolved.properties as Record<string, any>)
          : [];

        // If resolved.properties contains keys that match def keys, prefer
        // merging those resolved property bodies back into the corresponding
        // `$defs` entries. This handles the common case where an editor
        // inlines defs under their original names (e.g. `product`, `order`).
        if (resolvedProps.length > 0) {
          let handled = false;
          for (const rp of resolvedProps) {
            if (defKeys.includes(rp)) {
              const key = rp;
              const baseDef = defs[key] || {};
              const resolvedBody = (resolved && resolved.properties && (resolved.properties as any)[key]) || resolved;
              let merged = deepMerge(baseDef, resolvedBody);
              absorbNestedDefs(root, merged);
              if (merged && typeof merged === 'object') {
                delete merged.$id;
                delete merged.$schema;
              }
              root.$defs = { ...defs, [key]: merged };
              try {
                if (!root.properties) root.properties = {};
                if (Object.prototype.hasOwnProperty.call(root.properties, key)) {
                  root.properties[key] = { $ref: `#/$defs/${key}` };
                }
              } catch (_) {}
              handled = true;
            }
          }
          if (handled) return root;
        }

        if (resolvedProps.length === 1 && defKeys.includes(resolvedProps[0])) {
          const key = resolvedProps[0];
          const baseDef = defs[key] || {};
          let merged = deepMerge(baseDef, resolved);
          absorbNestedDefs(root, merged);
          if (merged && typeof merged === 'object') {
            delete merged.$id;
            delete merged.$schema;
          }
          root.$defs = { ...defs, [key]: merged };
          // Replace the inlined resolved property with a $ref to the defs entry
          try {
            if (!root.properties) root.properties = {};
            if (Object.prototype.hasOwnProperty.call(root.properties, key)) {
              root.properties[key] = { $ref: `#/$defs/${key}` };
            }
          } catch (_) {}
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
          let merged = deepMerge(baseDef, resolved);
          absorbNestedDefs(root, merged);
          if (merged && typeof merged === 'object') {
            delete merged.$id;
            delete merged.$schema;
          }
          root.$defs = { ...defs, [bestKey]: merged };
          // Ensure we don't keep an inlined copy of the merged def in properties
          try {
            if (!root.properties) root.properties = {};
            if (Object.prototype.hasOwnProperty.call(root.properties, bestKey)) {
              root.properties[bestKey] = { $ref: `#/$defs/${bestKey}` };
            }
          } catch (_) {}
          return root;
        }
    }

    // Fallback: if nothing to rehydrate into, try to preserve any original
    // $defs that are still referenced by $ref in the resolved payload. This
    // prevents losing canonical defs when edits produce $ref nodes but the
    // heuristic couldn't pick a single def to merge into.
    try {
      if (root.$defs && typeof root.$defs === 'object') {
        const referenced = new Set<string>();
        const collectRefs = (obj: any) => {
          if (!obj || typeof obj !== 'object') return;
          if (Array.isArray(obj)) return obj.forEach(collectRefs);
          if (typeof obj.$ref === 'string' && obj.$ref.startsWith('#/$defs/')) {
            referenced.add(obj.$ref.replace('#/$defs/', ''));
          }
          for (const v of Object.values(obj)) collectRefs(v);
        };
        collectRefs(resolved);
        if (referenced.size > 0) {
          const out = JSON.parse(JSON.stringify(resolved));
          out.$defs = out.$defs || {};
          for (const k of Array.from(referenced)) {
            if (root.$defs && Object.prototype.hasOwnProperty.call(root.$defs, k)) {
              out.$defs[k] = JSON.parse(JSON.stringify(root.$defs[k]));
            }
          }
          return out;
        }
      }
    } catch (_) {}
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
