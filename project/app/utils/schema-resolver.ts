// Lightweight resolver utility used across components.
// Async-only: no sync fallback. Exports:
// - `resolveSchema(schema)` async dereference (uses json-schema-ref-parser when available)
// - `rehydrateToRefs(original, edited)` writes edits back into original $defs
// - `deepMerge(a,b)` deep-merge helper

function cloneSchemaValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (_) {
      // fall through to JSON clone
    }
  }

  return JSON.parse(JSON.stringify(value));
}

export async function resolveSchema(schema: Record<string, unknown> | null): Promise<Record<string, unknown> | null> {
  if (!schema || typeof schema !== 'object') return schema;
  const debug = typeof process !== 'undefined' && !!(process as any).env && !!(process as any).env.SCHEMA_RESOLVER_DEBUG;

  const traverseTree = async (
    root: any,
    visit: (node: any, parent: any, key: string | number | undefined, depth: number, path: string) => Promise<any> | any,
    maxDepth = 30
  ) => {
    if (!root || typeof root !== 'object') return root;

    const visited = new WeakSet<object>();
    const stack: Array<{ node: any; parent: any; key?: string | number; depth: number; path: string }> = [
      { node: root, parent: null, depth: 0, path: '#' }
    ];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;

      const { node, parent, key, depth, path } = current;
      if (!node || typeof node !== 'object' || depth > maxDepth) continue;
      if (visited.has(node)) continue;
      visited.add(node);

      const replacement = await visit(node, parent, key, depth, path);
      const activeNode = typeof replacement !== 'undefined' ? replacement : node;

      if (parent && typeof key !== 'undefined' && typeof replacement !== 'undefined') {
        parent[key as any] = replacement;
      }

      if (!activeNode || typeof activeNode !== 'object') continue;

      if (Array.isArray(activeNode)) {
        for (let i = activeNode.length - 1; i >= 0; i--) {
          stack.push({ node: activeNode[i], parent: activeNode, key: i, depth: depth + 1, path: `${path}[${i}]` });
        }
        continue;
      }

      const keys = Object.keys(activeNode);
      for (let i = keys.length - 1; i >= 0; i--) {
        const childKey = keys[i];
        stack.push({ node: activeNode[childKey], parent: activeNode, key: childKey, depth: depth + 1, path: path === '#' ? `#/${childKey}` : `${path}/${childKey}` });
      }
    }

    return root;
  };

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

    const cloned = cloneSchemaValue(input);
    await traverseTree(cloned, async (node: any) => {
      if (node.$ref && typeof node.$ref === 'string' && /^https?:\/\//i.test(node.$ref)) {
        try {
          const remote = await fetchUrl(node.$ref);
          let clone = typeof remote === 'string' ? JSON.parse(remote) : cloneSchemaValue(remote);
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
            clone.__from = node.$ref;
          }
          return clone;
        } catch (_) {
          return undefined;
        }
      }
      return undefined;
    });
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
    await traverseTree(root, async (node: any) => {
      if (node.$ref && typeof node.$ref === 'string' && /^https?:\/\//i.test(node.$ref)) {
        try {
          const remote = await fetchRemote(node.$ref);
          let clone = typeof remote === 'string' ? JSON.parse(remote) : cloneSchemaValue(remote);
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
          clone.__from = node.$ref;
          return clone;
        } catch (_) {
          return undefined;
        }
      }
      return undefined;
    });
    return root;
  };

  // Helper to normalize dereferenced/fallback output: hoist top-level $defs/definitions
  const normalizeResult = (obj: any) => {
    if (!obj || typeof obj !== 'object') return obj;
    try {
      const dk = obj.$defs ? '$defs' : (obj.definitions ? 'definitions' : null);
      if (dk && !obj.properties) {
        const props = cloneSchemaValue(obj[dk]);
        const out: any = { type: 'object', properties: props };
        for (const k of Object.keys(obj)) {
          if (k === dk || k === '$id' || k === '$schema' || k === 'type' || k === 'properties') continue;
          out[k] = obj[k];
        }
        obj = out;
      } else if (dk && obj.properties) {
        // Ensure existing explicit properties on the object take precedence
        // over `$defs` entries to avoid overwriting inlined local refs.
        obj.properties = { ...(obj[dk] || {}), ...(obj.properties || {}) };
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
  const inlineLocalRefsFromOriginal = async (root: any, original: any) => {
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

      await traverseTree(root, (node: any) => {
        if (node.$ref && typeof node.$ref === 'string' && node.$ref.startsWith('#')) {
          const ref = node.$ref as string;
          const target = anchorMap[ref] ||
            (defsKey ? anchorMap[ref.replace(/^#\/?/, `#/${defsKey}/`)] : null) ||
            anchorMap[ref.replace(/^#\/?/, '#/$defs/')] ||
            null;
          if (target) {
            const clone = cloneSchemaValue(target);
            if (clone && typeof clone === 'object') { delete clone.$anchor; delete clone.$id; delete clone.$schema; }
            if (clone && typeof clone === 'object' && !clone.__from) clone.__from = ref;
            return clone;
          }
        }
        return undefined;
      }, 30);
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
      const res = normalizeResult(preparedForParser);
      await inlineLocalRefsFromOriginal(res, schema);
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
    try { await inlineLocalRefsFromOriginal(deref, schema); } catch (_) {
      // ignore
    }

    if (preparedForParser) {
      const visitedMerge = new Set<any>();
      const mergePrepared = (target: any, src: any) => {
        if (!src || typeof src !== 'object' || visitedMerge.has(src)) return;
        if (!target || typeof target !== 'object') return;
        visitedMerge.add(src);
        for (const k of Object.keys(src)) {
          const s = src[k];
          const t = target[k];
          if (s && typeof s === 'object' && (!t || (t && typeof t === 'object' && (t.$ref && typeof t.$ref === 'string')))) {
              target[k] = s;
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
      const fallback = normalizeResult(preparedForParser);
      try {
        await inlineLocalRefsFromOriginal(fallback, schema);
      } catch (_) { /* ignore */ }
      return fallback as Record<string, unknown>;
    }
    throw e;
  }
}

export function rehydrateToRefs(original: Record<string, any>, edited: Record<string, any>): Record<string, any> {
  if (!original || typeof original !== 'object') return edited;
  if (!edited || typeof edited !== 'object') return original;

  const out = cloneSchemaValue(original);
  const defsKey = out.$defs ? '$defs' : (out.definitions ? 'definitions' : null);
  const defs = defsKey ? out[defsKey] : null;
  const props = edited.properties && typeof edited.properties === 'object' ? edited.properties : null;

  try {
    if (defs && props) {
      // Track which properties have been synced via __from to skip heuristic fallback
      const syncedViaClue = new Set<string>();

      // First pass: direct name matches (edited prop name matches def key)
      for (const [k, v] of Object.entries(props)) {
        if (Object.prototype.hasOwnProperty.call(defs, k)) {
          const existing = defs[k] || {};
          const merged = deepMerge(existing, v as any);
          if (existing && existing.$anchor) (merged as any).$anchor = existing.$anchor;
          defs[k] = merged;
          syncedViaClue.add(k);
        }
      }

      // New pass: detect __from metadata and sync directly to referenced definitions
      // This handles cases like homeAddress and workAddress both referencing #/$defs/address
      for (const [propName, propVal] of Object.entries(props)) {
        if (syncedViaClue.has(propName)) continue; // already handled by name match
        
        const propObj = propVal as any;
        let defKey: string | null = null;
        
        if (propObj && typeof propObj === 'object' && propObj.__from) {
          defKey = parseDefReference(propObj.__from);
          if (defKey && Object.prototype.hasOwnProperty.call(defs, defKey)) {
            // Found a valid reference - sync to that definition directly
            const existing = defs[defKey] || {};
            // Merge the property value (excluding __from metadata) into definition
            const valWithoutClue = { ...propObj };
            delete valWithoutClue.__from;
            const merged = deepMerge(existing, valWithoutClue);
            if (existing && existing.$anchor) (merged as any).$anchor = existing.$anchor;
            defs[defKey] = merged;
            syncedViaClue.add(propName);
            continue;
          }
        }

        // If __from referenced a nested property structure, try to sync nested edits
        // E.g., if propVal is { street: { type: string, __from: #/$defs/address/properties/street }}
        if (propObj && typeof propObj === 'object' && defKey) {
          const nestedSync = syncNestedFromClue(propObj, defs, defKey);
          if (nestedSync) syncedViaClue.add(propName);
        }
      }

      // Second pass: ambiguous mapping - only for properties NOT synced via __from
      for (const [propName, propVal] of Object.entries(props)) {
        if (syncedViaClue.has(propName)) continue; // already handled above
        
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
  const rootProps = { ...edited } as any;
  delete rootProps.$defs;
  delete rootProps.definitions;
  const editedProps = rootProps.properties;
  delete rootProps.properties;
  const rootFacets = rootProps;

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

  // Clean up __from metadata from definitions (it will be re-attached during next hydration)
  if (defs) {
    const cleanNode = (node: any) => {
      if (node && typeof node === 'object') {
        delete node.__from;
        for (const [, v] of Object.entries(node)) {
          if (v && typeof v === 'object') cleanNode(v);
        }
      }
    };
    for (const [, def] of Object.entries(defs)) {
      cleanNode(def);
    }
  }

  // Clean up __from from root properties
  const cleanRoot = (node: any) => {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      delete node.__from;
      for (const [, v] of Object.entries(node)) {
        if (v && typeof v === 'object') cleanRoot(v);
      }
    }
  };
  cleanRoot(out);

  return out;
}

/**
 * Parse a reference string like "#/$defs/address" and extract the definition key.
 * Returns null if the reference is invalid or not a local $defs reference.
 */
function parseDefReference(refString: string): string | null {
  if (typeof refString !== 'string') return null;
  const match = refString.match(/^#\/\$defs\/([^/]+)$/);
  return match ? match[1] : null;
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

function deepMerge(a: any, b: any, visited = new WeakMap()): any {
  return deepMergeWithDepth(a, b, visited, 0, 100);
}

function deepMergeWithDepth(a: any, b: any, visited = new WeakMap(), depth = 0, maxDepth = 100): any {
  if (a === null || a === undefined) return b;
  if (b === null || b === undefined) return a;
  if (depth >= maxDepth) return b;
  
  if (typeof a === 'object' && typeof b === 'object') {
    if (visited.has(a) && visited.get(a) === b) return a;
    visited.set(a, b);
  }

  // If we are merging two objects and the new one (b) is introducing polymorphic logic,
  // we must discard constraints (like 'type' or '$ref') from the old one (a)
  // to avoid hybrid schemas or ambiguous references.
  if (typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const isBPolymorphic = !!(b.oneOf || b.anyOf || b.oneOnly);
    const isAPolymorphic = !!(a.oneOf || a.anyOf || a.oneOnly);

    // If moving from simple/$ref to polymorphic, drop conflicting keys from A
    if (isBPolymorphic && !isAPolymorphic) {
      const restA = { ...a };
      delete restA.type;
      delete restA.$ref;
      a = restA;
    }
    // If moving from polymorphic back to simple, drop logic keys from A
    if (!isBPolymorphic && isAPolymorphic) {
      const restA = { ...a };
      delete restA.oneOf;
      delete restA.anyOf;
      delete restA.oneOnly;
      a = restA;
    }
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    // For arrays, if it's a structural list like oneOf/anyOf, we usually want B's state to be authoritative,
    // reflecting exactly what the editor sees. But we'll still deep merge elements that align by index.
    const out = [...b];
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      out[i] = deepMergeWithDepth(a[i], b[i], visited, depth + 1, maxDepth);
    }
    return out;
  }

  if (Array.isArray(a) || Array.isArray(b)) return b;
  if (typeof a !== 'object' || typeof b !== 'object') return b;

  const out: any = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v !== null && typeof v === 'object' && a[k] !== null && typeof a[k] === 'object') {
      out[k] = deepMergeWithDepth(a[k], v, visited, depth + 1, maxDepth);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Helper to sync nested properties that have __from metadata.
 * Returns true if sync succeeded, false otherwise.
 */
function syncNestedFromClue(propVal: any, defs: Record<string, any>, defKey: string): boolean {
  if (!propVal || typeof propVal !== 'object') return false;

  let synced = false;

  const visited = new Set<any>();
  const stack: Array<{ node: any; defNode: any }> = [{ node: propVal, defNode: defs[defKey] }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const { node, defNode } = current;
    if (!node || typeof node !== 'object' || visited.has(node)) continue;
    visited.add(node);

    for (const [k, v] of Object.entries(node)) {
      if (k === '__from') continue;

      if (v && typeof v === 'object' && (v as any).__from) {
        const nestedDefKey = parseDefReference((v as any).__from);
        if (nestedDefKey && defs[nestedDefKey]) {
          const existing = defs[nestedDefKey] || {};
          const valWithoutClue = { ...(v as any) };
          delete valWithoutClue.__from;
          const merged = deepMerge(existing, valWithoutClue);
          defs[nestedDefKey] = merged;
          synced = true;
        }
      } else if (v && typeof v === 'object' && defNode && defNode[k]) {
        stack.push({ node: v, defNode: defNode[k] });
      }
    }
  }

  return synced;
}

/**
 * Augment schema with known enhancements for compatibility.
 * For example, GitHub Actions concurrency field only defines object type,
 * but it actually supports both string (group name) and object variants.
 * This function wraps such fields with oneOf to reflect reality.
 */
export function augmentSchemaForKnownIssues(schema: Record<string, unknown> | null | undefined): Record<string, unknown> | null | undefined {
  if (!schema || typeof schema !== 'object') return schema;
  try {
    // Targeted clone to avoid mutating the caller while keeping memory use low.
    const augmented: any = {
      ...schema,
      properties: schema.properties && typeof schema.properties === 'object'
        ? { ...(schema.properties as Record<string, any>) }
        : schema.properties,
    };

    // Augment root-level concurrency: GitHub Actions supports concurrency as either
    // a string (group name) or object (group + cancel-in-progress).
    // The schema only defines object (not oneOf and not already string), so wrap with oneOf.
    if (augmented.properties && typeof augmented.properties === 'object') {
      const props = augmented.properties as Record<string, any>;
      if (props.concurrency && typeof props.concurrency === 'object') {
        // Only augment if:
        // 1. Does not already have oneOf
        // 2. Is actually an object definition (has type: 'object' or has properties), not a simple type
        const hasConcurrency = props.concurrency;
        const hasOneOf = !!(hasConcurrency as any).oneOf;
        const looksLikeObjectDef = ((hasConcurrency as any).type === 'object' || (hasConcurrency as any).properties);
        
        if (!hasOneOf && looksLikeObjectDef) {
          props.concurrency = {
            oneOf: [
              { type: 'string', title: 'String' },
              hasConcurrency
            ]
          };
        }
      }
    }

    return augmented;
  } catch (_) {
    return schema;
  }
}
