// Lightweight resolver utility used across components.
// Async-only: no sync fallback. Exports:
// - `resolveSchema(schema)` async dereference (uses json-schema-ref-parser when available)
// - `rehydrateToRefs(original, edited)` writes edits back into original $defs
// - `deepMerge(a,b)` deep-merge helper

export async function resolveSchema(schema: Record<string, unknown> | null): Promise<Record<string, unknown> | null> {
  if (!schema || typeof schema !== 'object') return schema;
  const debug = typeof process !== 'undefined' && !!(process as any).env && !!(process as any).env.SCHEMA_RESOLVER_DEBUG;

  // Inline external https refs by fetching and replacing $ref nodes.
  const inlineExternalRefs = async (input: any) => {
    if (!input || typeof input !== 'object') return input;
    const remoteCache = new Map<string, any>();
    const fetchUrl = async (url: string) => {
      if (remoteCache.has(url)) return remoteCache.get(url);
      if (typeof fetch !== 'function') throw new Error('fetch not available');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
      const ct = res.headers.get?.('content-type') || '';
      const body = ct.includes('application/json') || ct.includes('application/ld+json') ? await res.json() : await res.text();
      remoteCache.set(url, body);
      return body;
    };

    const cloned = JSON.parse(JSON.stringify(input));
    const walk = async (node: any, parent: any, key?: string) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) await walk(node[i], node, i.toString());
        return;
      }
      if (node.$ref && typeof node.$ref === 'string' && /^https?:\/\//i.test(node.$ref)) {
        try {
          const remote = await fetchUrl(node.$ref);
          let clone = typeof remote === 'string' ? JSON.parse(remote) : JSON.parse(JSON.stringify(remote));
          if (clone && typeof clone === 'object') {
            delete clone.$id;
            delete clone.$schema;
            try {
              const keys = Object.keys(clone || {});
              const looksLikeDefs = keys.length > 0 && keys.every(k => {
                const v = (clone as any)[k];
                return v && typeof v === 'object' && !Array.isArray(v);
              });
              if (looksLikeDefs && !('properties' in clone) && !('type' in clone)) {
                clone = { type: 'object', properties: clone };
              }
            } catch (_) {
              // ignore
            }
          }
          if (parent && typeof key !== 'undefined') parent[key] = clone;
          await walk(clone, parent, key);
          return;
        } catch (_) {
          return;
        }
      }
      for (const k of Object.keys(node)) await walk(node[k], node, k);
    };
    await walk(cloned, null);
    return cloned;
  };

  const postInlineRemotes = async (root: any) => {
    if (!root || typeof root !== 'object') return root;
    const remoteCache = new Map<string, any>();
    const fetchRemote = async (url: string) => {
      if (remoteCache.has(url)) return remoteCache.get(url);
      if (typeof fetch !== 'function') throw new Error('fetch not available');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
      const ct = res.headers.get?.('content-type') || '';
      const body = ct.includes('application/json') || ct.includes('application/ld+json') ? await res.json() : await res.text();
      remoteCache.set(url, body);
      return body;
    };
    const replaceRemoteRefs = async (node: any, parent: any, key?: string) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) await replaceRemoteRefs(node[i], node, i.toString());
        return;
      }
      if (node.$ref && typeof node.$ref === 'string' && /^https?:\/\//i.test(node.$ref)) {
        try {
          const remote = await fetchRemote(node.$ref);
          let clone = typeof remote === 'string' ? JSON.parse(remote) : JSON.parse(JSON.stringify(remote));
          try {
            const keys = Object.keys(clone || {});
            const looksLikeDefs = keys.length > 0 && keys.every(k => {
              const v = (clone as any)[k];
              return v && typeof v === 'object' && !Array.isArray(v);
            });
            if (looksLikeDefs && !('properties' in clone) && !('type' in clone)) {
              clone = { type: 'object', properties: clone };
            }
          } catch (_) {
            // ignore
          }
          if (parent && typeof key !== 'undefined') parent[key] = clone;
          await replaceRemoteRefs(clone, parent, key);
          return;
        } catch (_) {
          return;
        }
      }
      for (const k of Object.keys(node)) await replaceRemoteRefs(node[k], node, k);
    };
    await replaceRemoteRefs(root, null);
    return root;
  };

  // Helper to normalize dereferenced/fallback output: hoist top-level $defs/definitions
  const normalizeResult = (obj: any) => {
    if (!obj || typeof obj !== 'object') return obj;
    try {
      const dk = obj.$defs ? '$defs' : (obj.definitions ? 'definitions' : null);
      if (dk && !obj.properties) {
        const props = JSON.parse(JSON.stringify(obj[dk]));
        const out: any = { type: 'object', properties: props };
        for (const k of Object.keys(obj)) {
          if (k === dk || k === '$id' || k === '$schema' || k === 'type' || k === 'properties') continue;
          out[k] = obj[k];
        }
        obj = out;
      } else if (dk && obj.properties) {
        obj.properties = { ...(obj.properties || {}), ...(obj[dk] || {}) };
      }
      if (obj.$defs) delete obj.$defs;
      if (obj.definitions) delete obj.definitions;
      if (obj.properties && !obj.type) obj.type = 'object';
    } catch (_) {
      // ignore
    }
    return obj;
  };

  // Helper to inline local references pointing to anchors or $defs in original
  const inlineLocalRefsFromOriginal = (root: any, original: any) => {
    if (!root || typeof root !== 'object' || !original || typeof original !== 'object') return;
    try {
      const defsKey = original.$defs ? '$defs' : (original.definitions ? 'definitions' : null);
      const defs = defsKey ? original[defsKey] : null;
      const anchorMap: Record<string, any> = {};
      if (defs) {
        for (const k of Object.keys(defs)) {
          const v = defs[k];
          if (v && typeof v === 'object') {
            if (v.$anchor && typeof v.$anchor === 'string') {
              anchorMap[v.$anchor] = v;
              anchorMap[`#${v.$anchor}`] = v;
              anchorMap[`#/${defsKey}/${v.$anchor}`] = v;
            }
            anchorMap[`#/${defsKey}/${k}`] = v;
            anchorMap[`#${k}`] = v;
          }
        }
      }

      const visited = new Set<any>();
      const walk = (node: any, parent: any, key?: string | number, depth = 0) => {
        if (!node || typeof node !== 'object' || depth > 25) return;
        if (visited.has(node)) return;

        if (Array.isArray(node)) {
          node.forEach((n, i) => walk(n, node, i, depth + 1));
          return;
        }

        visited.add(node);

        if (node.$ref && typeof node.$ref === 'string' && node.$ref.startsWith('#')) {
          const ref = node.$ref as string;
          const target = anchorMap[ref] ||
            (defsKey ? anchorMap[ref.replace(/^#\/?/, `#/${defsKey}/`)] : null) ||
            anchorMap[ref.replace(/^#\/?/, '#/$defs/')] ||
            null;
          if (target) {
            const clone = JSON.parse(JSON.stringify(target));
            if (clone && typeof clone === 'object') { delete clone.$anchor; delete clone.$id; delete clone.$schema; }
            if (clone && typeof clone === 'object' && !clone.$ref) clone.$ref = ref;
            if (parent && typeof key !== 'undefined') parent[key as any] = clone;
            walk(clone, parent, key, depth + 1);
            return;
          }
        }
        for (const k of Object.keys(node)) walk(node[k], node, k, depth + 1);
      };
      walk(root, null);
    } catch (_) {
      // ignore
    }
  };

  let preparedForParser: any = null;
  try {
    preparedForParser = await inlineExternalRefs(schema);
  } catch (e) {
    if (debug) console.warn('[schema-resolver] pre-pass inline failed', e);
    preparedForParser = null;
  }

  const docForParser = preparedForParser || schema;

  // Try to load parser dynamically; if not available, and we have prepared clone, return it; otherwise fail.
  let parserModule: any = null;
  try {
    const parser = await import('json-schema-ref-parser');
    parserModule = (parser as any).default || parser;
  } catch (impErr) {
    if (debug) console.warn('[schema-resolver] parser import failed', impErr);
    if (preparedForParser) {
      const res = normalizeResult(JSON.parse(JSON.stringify(preparedForParser)));
      inlineLocalRefsFromOriginal(res, schema);
      return res;
    }
    throw impErr;
  }

  const httpResolver = {
    order: 1,
    canRead: (file: any) => typeof file.url === 'string' && /^https?:\/\//i.test(file.url),
    read: async (file: any) => {
      if (typeof fetch !== 'function') throw new Error('fetch not available to resolve remote $ref');
      let target = file.url as string;
      try {
        if (typeof window !== 'undefined' && typeof target === 'string' && target.startsWith('https://example.com/')) {
          const parts = target.split('/');
          const name = parts[parts.length - 1] || 'schema.json';
          target = `${window.location.origin}/schemas/${name}`;
        }
      } catch (_) {
        // ignore
      }
      const res = await fetch(target);
      if (!res.ok) throw new Error(`Failed to fetch ${file.url}: ${res.status}`);
      const ct = res.headers.get?.('content-type') || '';
      if (ct.includes('application/json') || ct.includes('application/ld+json')) return res.json();
      return res.text();
    }
  };

  try {
    let deref = await parserModule.dereference(docForParser, { resolve: { http: httpResolver } });
    deref = normalizeResult(deref);
    try { inlineLocalRefsFromOriginal(deref, schema); } catch (_) {
      // ignore
    }

    if (preparedForParser) {
      const mergePrepared = (target: any, src: any) => {
        if (!src || typeof src !== 'object') return;
        if (!target || typeof target !== 'object') return;
        for (const k of Object.keys(src)) {
          const s = src[k];
          const t = target[k];
          if (s && typeof s === 'object' && (!t || (t && typeof t === 'object' && (t.$ref && typeof t.$ref === 'string')))) {
            target[k] = JSON.parse(JSON.stringify(s));
          } else if (s && typeof s === 'object' && t && typeof t === 'object') {
            mergePrepared(t, s);
          }
        }
      };
      try { mergePrepared(deref, preparedForParser); } catch (_) {
        // ignore
      }
    }

    try { await postInlineRemotes(deref); } catch (e) { if (debug) console.warn('[schema-resolver] post-pass inline failed', e); }
    deref = normalizeResult(deref);

    try { if (debug && typeof window !== 'undefined') (window as any).__schemaResolverDebug = { preparedForParser, deref, timestamp: Date.now() }; } catch (_) {
      // ignore
    }
    return deref as Record<string, unknown>;
  } catch (e) {
    if (debug) console.warn('[schema-resolver] parser dereference failed', e);
    if (preparedForParser) {
      const fallback = normalizeResult(JSON.parse(JSON.stringify(preparedForParser)));
      try {
        inlineLocalRefsFromOriginal(fallback, schema);
      } catch (_) { /* ignore */ }
      return fallback as Record<string, unknown>;
    }
    throw e;
  }
}

export function rehydrateToRefs(original: Record<string, any>, edited: Record<string, any>): Record<string, any> {
  if (!original || typeof original !== 'object') return edited;
  if (!edited || typeof edited !== 'object') return original;

  const out = JSON.parse(JSON.stringify(original));
  const defsKey = out.$defs ? '$defs' : (out.definitions ? 'definitions' : null);
  const defs = defsKey ? out[defsKey] : null;
  const props = edited.properties && typeof edited.properties === 'object' ? edited.properties : null;

  try {
    if (defs && props) {
      // First pass: direct name matches (edited prop name matches def key)
      for (const [k, v] of Object.entries(props)) {
        if (Object.prototype.hasOwnProperty.call(defs, k)) {
          const existing = defs[k] || {};
          const merged = deepMerge(existing, v as any);
          if (existing && existing.$anchor) (merged as any).$anchor = existing.$anchor;
          defs[k] = merged;
        }
      }

      // Second pass: ambiguous mapping - map edited prop names into defs that contain those property names
      for (const [propName, propVal] of Object.entries(props)) {
        if (Object.prototype.hasOwnProperty.call(defs, propName)) continue; // already handled
        const scores: Array<{ key: string; score: number }> = [];
        for (const dk of Object.keys(defs)) {
          const defProps = defs[dk] && defs[dk].properties ? defs[dk].properties : {};
          const score = Object.prototype.hasOwnProperty.call(defProps, propName) ? 1 : 0;
          if (score > 0) scores.push({ key: dk, score });
        }
        if (scores.length === 0) continue;
        scores.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
        const winner = scores[0].key;
        try {
          const existing = defs[winner] || {};
          if (!existing.properties) existing.properties = {};
          const merged = deepMerge(existing.properties[propName], propVal as any);
          existing.properties[propName] = merged;
          defs[winner] = existing;
        } catch (_) {
          // ignore
        }
      }
      out[defsKey!] = defs;
    }
  } catch (_) {
    // ignore
  }

  // Root Sync: Now handle properties and metadata that AREN'T in $defs
  const { $defs: _unused1, definitions: _unused2, properties: editedProps, ...rootFacets } = edited;

  // Merge metadata / logic facets (oneOf, title, etc)
  Object.assign(out, deepMerge(out, rootFacets));

  // Merge root properties
  if (editedProps && typeof editedProps === 'object') {
    if (!out.properties) out.properties = {};
    for (const [k, v] of Object.entries(editedProps)) {
      const existsInOriginalProps = out.properties && Object.prototype.hasOwnProperty.call(out.properties, k);
      const existsInDefs = defs && Object.prototype.hasOwnProperty.call(defs, k);

      if (existsInOriginalProps || !existsInDefs) {
        out.properties[k] = deepMerge(out.properties[k], v);
      }
    }
  }

  return out;
}

// Public name: clearer API for rehydration roundtrip
export function rehydrateSchema(original: Record<string, any>, edited: Record<string, any>): Record<string, any> {
  if (!original || typeof original !== 'object') return edited;
  if (!edited || typeof edited !== 'object') return original;

  // Use the specialized ref rehydrator if $defs or definitions are present
  if (original.$defs || edited.$defs || original.definitions || edited.definitions) {
    return rehydrateToRefs(original, edited);
  }

  // Otherwise, perform a smart deep merge at the root level.
  // This ensures that top-level logic types (oneOf, anyOf) added in the editor
  // are actually preserved in the canonical source.
  return deepMerge(original, edited);
}

function deepMerge(a: any, b: any, options: any = {}): any {
  if (a === null || a === undefined) return b;
  if (b === null || b === undefined) return a;

  // If we are merging two objects and the new one (b) is introducing polymorphic logic,
  // we must discard constraints (like 'type' or '$ref') from the old one (a)
  // to avoid hybrid schemas or ambiguous references.
  if (typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const isBPolymorphic = !!(b.oneOf || b.anyOf || b.oneOnly);
    const isAPolymorphic = !!(a.oneOf || a.anyOf || a.oneOnly);

    // If moving from simple/$ref to polymorphic, drop conflicting keys from A
    if (isBPolymorphic && !isAPolymorphic) {
      const { type: _unusedT, $ref: _unusedR, ...restA } = a;
      a = restA;
    }
    // If moving from polymorphic back to simple, drop logic keys from A
    if (!isBPolymorphic && isAPolymorphic) {
      const { oneOf: _u1, anyOf: _u2, oneOnly: _u3, ...restA } = a;
      a = restA;
    }
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    // For arrays, if it's a structural list like oneOf/anyOf, we usually want B's state to be authoritative,
    // reflecting exactly what the editor sees. But we'll still deep merge elements that align by index.
    const out = [...b];
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      out[i] = deepMerge(a[i], b[i]);
    }
    return out;
  }

  if (Array.isArray(a) || Array.isArray(b)) return b;
  if (typeof a !== 'object' || typeof b !== 'object') return b;

  const out: any = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v !== null && typeof v === 'object' && a[k] !== null && typeof a[k] === 'object') {
      out[k] = deepMerge(a[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
