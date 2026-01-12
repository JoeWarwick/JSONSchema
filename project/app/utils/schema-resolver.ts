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
            } catch (_) {}
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
          } catch (_) {}
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
    if (preparedForParser) return preparedForParser;
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
      } catch (_) {}
      const res = await fetch(target);
      if (!res.ok) throw new Error(`Failed to fetch ${file.url}: ${res.status}`);
      const ct = res.headers.get?.('content-type') || '';
      if (ct.includes('application/json') || ct.includes('application/ld+json')) return res.json();
      return res.text();
    }
  };

  try {
    let deref = await parserModule.dereference(docForParser, { resolve: { http: httpResolver } });
    // Normalize dereferenced output: hoist any top-level $defs into a root object
    const normalize = (obj: any) => {
      if (!obj || typeof obj !== 'object') return obj;
      try {
        if (obj.$defs && !obj.properties) {
          const props = JSON.parse(JSON.stringify(obj.$defs));
          const out: any = { type: 'object', properties: props };
          // carry through any other non-$defs top-level keys except $id/$schema
          for (const k of Object.keys(obj)) {
            if (k === '$defs' || k === '$id' || k === '$schema') continue;
            if (k === 'type' || k === 'properties') continue;
            out[k] = obj[k];
          }
          obj = out;
        } else if (obj.$defs && obj.properties) {
          // merge defs into properties, prefer existing properties keys
          obj.properties = { ...(obj.$defs || {}), ...(obj.properties || {}) };
        }
        if (obj.$defs) delete obj.$defs;
      } catch (_) {}
      return obj;
    };
    deref = normalize(deref);
    // Inline local references that point to anchors or $defs in the original schema.
    const inlineLocalRefsFromOriginal = (root: any, original: any) => {
      if (!root || typeof root !== 'object' || !original || typeof original !== 'object') return;
      try {
        const defs = original.$defs && typeof original.$defs === 'object' ? original.$defs : null;
        const anchorMap: Record<string, any> = {};
        if (defs) {
          for (const k of Object.keys(defs)) {
            const v = defs[k];
            if (v && typeof v === 'object') {
              if (v.$anchor && typeof v.$anchor === 'string') {
                // register anchor both with and without leading '#'
                anchorMap[v.$anchor] = v;
                anchorMap[`#${v.$anchor}`] = v;
                anchorMap[`#/$defs/${v.$anchor}`] = v;
              }
              // register by def key forms
              anchorMap[`#/$defs/${k}`] = v;
              anchorMap[`#${k}`] = v;
            }
          }
        }
        const walk = (node: any, parent: any, key?: string | number) => {
          if (!node || typeof node !== 'object') return;
          if (Array.isArray(node)) return node.forEach((n, i) => walk(n, node, i));
          if (node.$ref && typeof node.$ref === 'string' && node.$ref.startsWith('#')) {
            const ref = node.$ref as string;
            // try exact match against anchorMap keys
            const target = anchorMap[ref] || anchorMap[ref.replace(/^#\/?/, '#/$defs/')] || null;
            if (target) {
              const clone = JSON.parse(JSON.stringify(target));
              // remove transient metadata
              if (clone && typeof clone === 'object') { delete clone.$anchor; delete clone.$id; delete clone.$schema; }
              if (parent && typeof key !== 'undefined') parent[key as any] = clone;
              // continue walking the inlined clone
              walk(clone, parent, key);
              return;
            }
          }
          for (const k of Object.keys(node)) walk(node[k], node, k);
        };
        walk(root, null);
      } catch (_) {}
    };
    try { inlineLocalRefsFromOriginal(deref, schema); } catch (_) {}
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
      try { mergePrepared(deref, preparedForParser); } catch (_) {}
    }

    try { await postInlineRemotes(deref); } catch (e) { if (debug) console.warn('[schema-resolver] post-pass inline failed', e); }
    // ensure normalization after post-inlines too
    try { deref = (function(o){ if (!o) return o; try{ if (o.$defs) { const p = o.properties || {}; o.properties = { ...(o.$defs || {}), ...(p || {}) }; delete o.$defs; if (!o.type) o.type = 'object'; } return o;}catch(e){return o;} })(deref); } catch(_) {}
    try { if (debug && typeof window !== 'undefined') (window as any).__schemaResolverDebug = { preparedForParser, deref, timestamp: Date.now() }; } catch (_) {}
    return deref as Record<string, unknown>;
  } catch (e) {
    if (debug) console.warn('[schema-resolver] parser dereference failed', e);
    if (preparedForParser) {
      try { preparedForParser = (function(o){ if (!o) return o; try{ if (o.$defs && !o.properties) { const props = JSON.parse(JSON.stringify(o.$defs)); const out: any = { type: 'object', properties: props }; for (const k of Object.keys(o)) { if (k === '$defs' || k === '$id' || k === '$schema') continue; if (k === 'type' || k === 'properties') continue; out[k] = o[k]; } return out; } if (o.$defs && o.properties) { o.properties = { ...(o.$defs || {}), ...(o.properties || {}) }; } if (o.$defs) delete o.$defs; return o;}catch(_){return o;} })(preparedForParser); } catch(_) {}
      return preparedForParser as Record<string, unknown>;
    }
    throw e;
  }
}

export function rehydrateToRefs(original: Record<string, any>, edited: Record<string, any>): Record<string, any> {
  // If original has $defs and edited hoisted defs into `properties`, write edits back into $defs.
  if (!original || typeof original !== 'object') return edited;
  if (!edited || typeof edited !== 'object') return original;
  const out = JSON.parse(JSON.stringify(original));
  try {
    const defs = out.$defs && typeof out.$defs === 'object' ? out.$defs : null;
    const props = edited.properties && typeof edited.properties === 'object' ? edited.properties : null;
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
        // Score defs by whether they contain this property name under their properties
        const scores: Array<{ key: string; score: number }> = [];
        for (const dk of Object.keys(defs)) {
          const defProps = defs[dk] && defs[dk].properties ? defs[dk].properties : {};
          const score = Object.prototype.hasOwnProperty.call(defProps, propName) ? 1 : 0;
          if (score > 0) scores.push({ key: dk, score });
        }
        if (scores.length === 0) continue;
        // pick highest score, tie-breaker alphabetical
        scores.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
        const winner = scores[0].key;
        try {
          const existing = defs[winner] || {};
          if (!existing.properties) existing.properties = {};
          const merged = deepMerge(existing.properties[propName], propVal as any);
          existing.properties[propName] = merged;
          defs[winner] = existing;
        } catch (_) {}
      }
      out.$defs = defs;
      return out;
    }
  } catch (_) {}
  // Fallback: no $defs to rehydrate into — return edited merged onto original properties
  try {
    if (!out.properties) out.properties = {};
    if (edited.properties && typeof edited.properties === 'object') {
      out.properties = { ...(out.properties || {}), ...(edited.properties as Record<string, any>) };
    }
  } catch (_) {}
  return out;
}

// Public name: clearer API for rehydration roundtrip
export function rehydrateSchema(original: Record<string, any>, edited: Record<string, any>): Record<string, any> {
  return rehydrateToRefs(original, edited);
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
