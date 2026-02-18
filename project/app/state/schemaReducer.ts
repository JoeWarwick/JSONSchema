import { rehydrateSchema, resolveSchema, augmentSchemaForKnownIssues } from "~/utils/schema-resolver";

export const LOAD_SOURCE_SCHEMA = "LOAD_SOURCE_SCHEMA";
export const APPLY_SOURCE_UPDATE = "APPLY_SOURCE_UPDATE";
export const APPLY_RESOLVED_EDIT = "APPLY_RESOLVED_EDIT";
export const SET_DEREF_IN_PROGRESS = "SET_DEREF_IN_PROGRESS";
export const SET_RESOLVED_CACHE = "SET_RESOLVED_CACHE";
export const MERGE_RESOLVED_PATH = "MERGE_RESOLVED_PATH";
export const MERGE_RESOLVED_ALL_PATHS = "MERGE_RESOLVED_ALL_PATHS";

export type Schema = Record<string, unknown> | null;

export type SchemaState = {
  source: Schema;
  resolvedCache: Schema;
  derefInProgress: boolean;
  sourceIsObject: boolean;
};

export type SchemaAction =
  | { type: typeof LOAD_SOURCE_SCHEMA; payload: Schema }
  | { type: typeof APPLY_SOURCE_UPDATE; payload: Schema }
  | { type: typeof APPLY_RESOLVED_EDIT; payload: Schema }
  | { type: typeof SET_DEREF_IN_PROGRESS; payload: boolean }
  | { type: typeof SET_RESOLVED_CACHE; payload: Schema }
  | { type: typeof MERGE_RESOLVED_PATH; payload: { path: string[], schema: Schema } }
  | { type: typeof MERGE_RESOLVED_ALL_PATHS; payload: { path: string[], schema: Schema }[] };

// Helper: determine whether a source schema should be treated as an object-rooted
// schema for editor normalization purposes.
function isObjectSchema(s: Schema): boolean {
  if (!s || typeof s !== 'object') return false;
  try {
    const obj = s as Record<string, any>;
    if ('type' in obj) {
      const t = obj.type;
      if (typeof t === 'string') return t === 'object';
      if (Array.isArray(t)) return t.includes('object');
    }
    if ('properties' in obj) return true;
  } catch (_) {
    // ignore
  }
  return false;
}

function rewriteExampleComRefs(schema: Schema): Schema {
  if (!schema || typeof schema !== 'object') return schema;
  try {
    if (typeof window === 'undefined') return schema;
    const clone = JSON.parse(JSON.stringify(schema));
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (node.$ref && typeof node.$ref === 'string') {
        try {
          // Rewrite example.com dev refs to local /schemas/ files
          if (node.$ref.startsWith('https://example.com/')) {
            const parts = node.$ref.split('/');
            const name = parts[parts.length - 1] || 'schema.json';
            node.$ref = `${window.location.origin}/schemas/${name}`;
          }
          // Also rewrite refs that point to a local schema server on a different port
          // (e.g. http://localhost:5174/schemas/*.json) to the current dev server origin
          else {
            try {
              const url = new URL(node.$ref);
              if (url.hostname === 'localhost' && (url.port === '5174' || url.port === '5173')) {
                const parts = url.pathname.split('/');
                const name = parts[parts.length - 1] || 'schema.json';
                node.$ref = `${window.location.origin}/schemas/${name}`;
              }
            } catch (_) {
              // ignore invalid URLs
            }
          }
        } catch (_) {
          // ignore
        }
      }
      for (const v of Object.values(node)) walk(v);
    };
    walk(clone);
    return clone;
  } catch (_) {
    return schema;
  }
}

export function initialSchemaState(initialSource: Schema): SchemaState {
  // Use a permissive object schema as the default starting point when no
  // persisted schema is found. This allows immediate use of the instance
  // editor even for undocumented JSON structures.
  const source = initialSource ?? { type: 'object', additionalProperties: true };
  const isObj = isObjectSchema(source);
  return {
    source,
    resolvedCache: produceResolvedCache(source, isObj, source),
    derefInProgress: false,
    sourceIsObject: isObj,
  };
}

export default function schemaReducer(state: SchemaState, action: SchemaAction): SchemaState {
  switch (action.type) {
    case LOAD_SOURCE_SCHEMA:
    case APPLY_SOURCE_UPDATE: {
      const raw = action.payload;
      const src = rewriteExampleComRefs(raw as Schema) as Schema;
      const srcIsObject = isObjectSchema(src);
      return {
        ...state,
        source: src,
        // invalidate cache; component will trigger async resolve
        // Let produceResolvedCache derive a normalized resolved view from `source`.
        resolvedCache: produceResolvedCache(src ?? null, srcIsObject, src),
        sourceIsObject: srcIsObject,
        derefInProgress: true,
      };
    }
    case APPLY_RESOLVED_EDIT: {
      const resolved = action.payload;
      // Map the edited resolved schema back into the canonical source structure.
      // Only attempt rehydration when the current `source` appears to be
      // a $defs/$ref-based document; when the source is already a
      // concrete root-object, prefer assigning the edited resolved schema
      // directly to avoid heuristic/partial rehydration replacing a fully
      // processed schema.
      let newSource: Schema;
      if (state.source && typeof state.source === 'object') {
        const rawSrc = state.source as Schema;
        const src = rewriteExampleComRefs(rawSrc) as Schema;
        const srcObj = src as Record<string, any>;
        if (srcObj.$defs || typeof srcObj.$ref === 'string') {
          newSource = rehydrateSchema(src as Record<string, any>, resolved as Record<string, any>);
        } else {
          newSource = resolved;
        }
      } else {
        newSource = resolved;
      }
      // Keep `state.source` as the live source (preserve insertion order
      // for editor rendering). Persisted canonicalization is handled by
      // `getPersistableSource` when needed.
      const newIsObject = isObjectSchema(newSource);
      // Derive the resolved view from the canonical source so `resolvedCache`
      // always reflects the current authoritative `source` shape. `produceResolvedCache`
      // will use `resolveSchemaSync` internally when necessary, keeping that logic
      // inside the reducer (not the UI) so editors only ever observe an
      // object-rooted schema.
      return {
        ...state,
        source: newSource,
        resolvedCache: produceResolvedCache(newSource ?? null, newIsObject, newSource),
        sourceIsObject: newIsObject,
        derefInProgress: true,
      };
    }
    case SET_DEREF_IN_PROGRESS:
      return { ...state, derefInProgress: action.payload };
    case SET_RESOLVED_CACHE:
      // When an async resolution completes, normalize it so UI layers never
      // receive a top-level `$defs` structure — the reducer owns conversion.
      return { ...state, resolvedCache: produceResolvedCache(action.payload, state.sourceIsObject, state.source), derefInProgress: false };
    case MERGE_RESOLVED_PATH: {
      const { path, schema } = action.payload;
      if (!state.resolvedCache || !path || path.length === 0) return state;
      
      const newCache = JSON.parse(JSON.stringify(state.resolvedCache));
      let current = newCache;
      
      // Navigate to the target node
      for (let i = 0; i < path.length; i++) {
        const p = path[i];
        // Smart navigation: if the path expects 'properties' but we are at a map-root
        // that doesn't have a 'properties' key (common in hoisted/dereferenced views),
        // we skip the 'properties' segment.
        if (p === 'properties' && !current.properties && !current.type && !current.$ref && Object.keys(current).length > 0) {
          continue;
        }
        
        if (!current[p] || typeof current[p] !== 'object') {
          current[p] = {};
        }
        current = current[p];
      }
      
      // Deep merge the new resolved schema part into the target node
      if (schema && typeof schema === 'object') {
        Object.assign(current, schema);
      }

      return {
        ...state,
        resolvedCache: produceResolvedCache(newCache, state.sourceIsObject, state.source)
      };
    }
    case MERGE_RESOLVED_ALL_PATHS: {
      const updates = action.payload;
      if (!state.resolvedCache || !updates || updates.length === 0) return state;
      
      const newCache = JSON.parse(JSON.stringify(state.resolvedCache));
      
      for (const { path, schema } of updates) {
        if (!path || path.length === 0) continue;
        let current = newCache;
        for (let i = 0; i < path.length; i++) {
          const p = path[i];
          // Smart navigation: skip 'properties' if at a map root
          if (p === 'properties' && !current.properties && !current.type && !current.$ref && Object.keys(current).length > 0) {
            continue;
          }

          if (!current[p] || typeof current[p] !== 'object') {
            current[p] = {};
          }
          current = current[p];
        }
        if (schema && typeof schema === 'object') {
          Object.assign(current, schema);
        }
      }

      return {
        ...state,
        resolvedCache: produceResolvedCache(newCache, state.sourceIsObject, state.source)
      };
    }
    default:
      return state;
  }
}

// Public helper: return the normalized schema editors should receive.
// This keeps conversion logic inside the reducer module so UI layers
// never need to call resolver utilities or inspect `$defs` structure.
export function getEditorSchema(state: SchemaState): Schema {
  try {
    return produceResolvedCache(state.resolvedCache, state.sourceIsObject, state.source);
  } catch (_) {
    return state.resolvedCache || state.source;
  }
}

// Helper to detect whether a schema (or a nested path within it) originates
// from an imported $ref. Exported so UI layers can reuse reducer's provenance logic.
export function isSchemaImported(schemaOrState: Schema | SchemaState | null, path?: string[]): boolean {
  try {
    if (!schemaOrState) return false;
    // If we're at a node that has structural content, it's NOT an "unresolved import"
    // regardless of where it came from.
    const isStructural = (n: any) => {
      if (!n || typeof n !== 'object') return false;
      return !!(n.type || n.properties || n.items || n.oneOf || n.anyOf || n.allOf || n.enum || n.const);
    };

    let root: any = schemaOrState as any;
    if (root && typeof root === 'object' && ('source' in root)) {
      // Use the normalized editor-view for provenance checks so we
      // can inspect correctly mapped nodes for `__from` or `$ref`.
      try {
        const st = root as SchemaState;
        root = getEditorSchema(st);
      } catch (_) {
        root = (root as any).resolvedCache || (root as any).source || root;
      }
    }
    
    // Check if the current node itself (if path not provided) is already structural
    if ((!path || path.length === 0) && isStructural(root)) {
      // It might have a $ref but if it already has properties/type, we don't 
      // treat it as an unexpanded "import placeholder".
      if (typeof root.$ref === 'string' && Object.keys(root).length === 1) return true;
      if (root.__from && !root.properties && !root.type && !root.items && !root.oneOf && !root.anyOf && !root.allOf) return true;
      return false;
    }

    if (!root || typeof root !== 'object') return false;

    // walk to path inside the authoritative source when provided
    let node: any = root;
    if (Array.isArray(path) && path.length > 0) {
      for (const p of path) {
        if (!node || typeof node !== 'object') return false;
        // In the editor-normalized view, properties are usually hoisted
        if (node.properties && Object.prototype.hasOwnProperty.call(node.properties, p)) {
          node = node.properties[p];
        } else if (node.type === 'array' && node.items && node.items.properties && Object.prototype.hasOwnProperty.call(node.items.properties, p)) {
          node = node.items.properties[p];
        } else if (node.items) {
          // Fall through items
          node = node.items;
        } else {
          // Fall back: direct property access or nested key
          node = (node.properties && node.properties[p]) || (node.items && node.items.properties && node.items.properties[p]) || node[p] || null;
        }
      }
    }

    // Only inspect the matched source node itself for direct provenance.
    if (!node || typeof node !== 'object') return false;
    
    const nodeIsImported = !!(typeof node.$ref === 'string' || (Array.isArray(node.allOf) && node.allOf.some((e: any) => e && e.$ref)) || node.__from);
    if (!nodeIsImported) return false;

    // If it is imported, check if it's STILL just a placeholder or if it has content now
    if (isStructural(node)) {
      // If it still ONLY has a $ref, it's an unexpanded import
      if (typeof node.$ref === 'string' && Object.keys(node).length === 1) return true;
      // If it's an allOf that ONLY has a $ref, it's an unexpanded import
      if (Array.isArray(node.allOf) && node.allOf.length === 1 && node.allOf[0] && typeof node.allOf[0].$ref === 'string' && Object.keys(node).length === 1) return true;
      // If it was tagged with __from but is otherwise empty, it's an import placeholder
      if (node.__from && !node.properties && !node.type && !node.items && !node.oneOf && !node.anyOf && !node.allOf) return true;
      
      // Otherwise, it has content! Even if it came from elsewhere, we want to see it.
      return false;
    }
    
    return true;
  } catch (_) {
    return false;
  }
}

// Helper to encapsulate sync+async resolution and dispatch updates.
export async function ensureResolved(dispatch: (a: SchemaAction) => void, source: Schema) {
  dispatch({ type: SET_DEREF_IN_PROGRESS, payload: true });
  // Clear any runtime deref completion signals before starting
  try {
    if (typeof window !== 'undefined') {
      try { document.documentElement.removeAttribute('data-deref-complete'); } catch (_) {
        // ignore
      }
      try { localStorage.removeItem('schema-sculptor-deref-complete'); } catch (_) {
        // ignore
      }
      try { (window as any).__schemaSculptorDerefComplete = false; } catch (_) {
        // ignore
      }
    }
  } catch (_) {
    // ignore
  }
  try {
    // Rewrite any example.com or localhost dev-port refs to current origin
    // before attempting async resolution so the resolver fetches same-origin
    // static files (served from `/schemas/`) when running in the browser.
    try {
      if (typeof window !== 'undefined' && source && typeof source === 'object') {
        source = rewriteExampleComRefs(source as Schema) as Schema;
      }
    } catch (_) {
      // ignore
    }
    // Prefer the full async resolver so remote $ref can be fetched before
    // updating the resolved cache. If the async resolver fails, fall back
    // to the synchronous fast resolver to avoid leaving the UI without a view.
    try {
      const asyncResolved = await resolveSchema(source);
      if (asyncResolved) {
        dispatch({ type: SET_RESOLVED_CACHE, payload: asyncResolved });
        try {
          if (typeof window !== 'undefined') {
            try { localStorage.setItem('schema-sculptor-deref-complete', JSON.stringify({ ts: Date.now(), id: (asyncResolved as any)?.$id || null })); } catch (_) {
              // ignore
            }
            try { (window as any).__schemaSculptorDerefComplete = true; } catch (_) {
              // ignore
            }
            try { document.documentElement.setAttribute('data-deref-complete', '1'); } catch (_) {
              // ignore
            }
          }
        } catch (_) {
          // ignore
        }
      } else {
        // No resolved schema returned from async resolver — treat as failure
        if (typeof window !== 'undefined') {
          try { document.documentElement.setAttribute('data-deref-error', '1'); } catch (_) {
            // ignore
          }
        }
      }
    } catch (e: Error | any) {
      // Log deref errors to console and localStorage to aid e2e trace debugging
      try {
        // eslint-disable-next-line no-console
        console.error('[schemaReducer] async resolveSchema failed:', e && (e.message || e));
      } catch (_) {
        // ignore
      }
      try {
        if (typeof window !== 'undefined') {
          try { localStorage.setItem('schema-sculptor-deref-error', JSON.stringify({ message: (e && e.message) || String(e), stack: (e && e.stack) || null, ts: Date.now() })); } catch (_) {
            // ignore
          }
          try { document.documentElement.setAttribute('data-deref-error', '1'); } catch (_) {
            // ignore
          }
        }
      } catch (_) {
        // ignore
      }
      // Do not fall back to a synchronous resolver; async failure is a fail.
      // Ensure UI is notified via data attributes/localStorage in catch above.
    }
  } catch (e) {
    // ensure we clear in-progress flag
    dispatch({ type: SET_DEREF_IN_PROGRESS, payload: false });
  }
}

function normalizeResolved(s: Schema, source?: Schema): Schema {
  if (!s || typeof s !== 'object') return s;
  try {
    // If already a root object with `properties`, remove any properties that still expose `$anchor` metadata
    // and also remove top-level defs that are referenced within other defs (via $ref).
    if ('type' in s || 'properties' in s) {
      if (s.properties && typeof s.properties === 'object') {
        const props = { ...(s.properties as Record<string, any>) };
        const sourceProps = (source && typeof source === 'object' && source.properties && typeof source.properties === 'object')
          ? Object.keys(source.properties as Record<string, unknown>)
          : [];

        // collect all provenance markers (e.g. $ref) that appear nested within properties
        const nestedFroms = new Set<string>();
        const collectFroms = (obj: any, skipSelf = false) => {
          if (!obj || typeof obj !== 'object') return;
          if (Array.isArray(obj)) return obj.forEach((o) => collectFroms(o, false));
          if (!skipSelf && typeof obj.$ref === 'string') nestedFroms.add(obj.$ref as string);
          for (const v of Object.values(obj)) collectFroms(v, false);
        };
        for (const v of Object.values(props)) {
          // collect froms from nested content, skipping the top-level property itself
          collectFroms(v, true);
        }

        const cleaned: Record<string, any> = {};
        for (const pk of Object.keys(props)) {
          const pv = props[pk];
          // If a top-level property carried $anchor metadata, do not expose it to the editor
          if (pv && typeof pv === 'object' && ('$anchor' in pv)) {
            continue;
          }
          // Prune properties that aren't in the authoritative source and aren't
          // standard top-level JSON schema keywords/facets. This prevents internal 
          // resolver noise from leaking into the editor view.
          const isStandardKey = [
            'type', 'properties', 'items', 'definitions', '$defs', '$id', '$schema', 
            'oneOf', 'anyOf', 'allOf', 'oneOnly', 'title', 'description', 'default', 
            'required', 'enum', 'patternProperties', 'additionalProperties'
          ].includes(pk);
          const isSourceProp = sourceProps.length === 0 || sourceProps.includes(pk) || isStandardKey;
          if (!isSourceProp) {
            continue;
          }

          cleaned[pk] = pv;
        }
        const out = { ...s, properties: cleaned };
        // Ensure editor view is object-rooted when properties exist
        if (!(out as any).type) (out as any).type = 'object';
        // Ensure we never expose a top-level $defs on the normalized view
        if ((out as any).$defs) delete (out as any).$defs;
        return augmentSchemaForKnownIssues(out) as Schema;
      }
      return s;
    }
    const keys = Object.keys(s as Record<string, unknown>);
    if (keys.length > 0) {
      // If it's already a schema-like node, don't wrap it in more properties
      if ('properties' in s || 'items' in s || 'type' in s || 'oneOf' in s || 'anyOf' in s || 'allOf' in s) {
        return augmentSchemaForKnownIssues(s) as Schema;
      }

      let looksLikeDefs = true;
      for (const k of keys) {
        const v = (s as any)[k];
        if (!v || typeof v !== 'object') { looksLikeDefs = false; break; }
      }
      if (looksLikeDefs) {
        const propsClone = JSON.parse(JSON.stringify(s));
        // collect nested provenance markers to detect referenced defs
        const nestedFroms = new Set<string>();
        const collectFroms = (obj: any, skipSelf = false) => {
          if (!obj || typeof obj !== 'object') return;
          if (Array.isArray(obj)) return obj.forEach((o) => collectFroms(o, false));
          if (!skipSelf && typeof obj.$ref === 'string') nestedFroms.add(obj.$ref as string);
          for (const v of Object.values(obj)) collectFroms(v, false);
        };
        for (const v of Object.values(propsClone)) collectFroms(v, true);

        // Build helper sets from nestedFroms: referenced defs by key and by anchor name
        const referencedKeys = new Set<string>();
        const referencedAnchors = new Set<string>();
        for (const r of nestedFroms) {
          if (typeof r !== 'string') continue;
          if (r.startsWith('#/$defs/')) referencedKeys.add(r.replace('#/$defs/', ''));
          else if (r.startsWith('#/')) {
            // try extract trailing segment
            const parts = r.split('/');
            const last = parts[parts.length - 1] || '';
            if (last) referencedKeys.add(last);
          } else if (r.startsWith('#')) {
            referencedAnchors.add(r.replace(/^#/, ''));
          }
        }

        for (const pk of Object.keys(propsClone)) {
          const pv = propsClone[pk];
          // If this def is referenced by other defs, prune it from the editor view
          const anchorName = pv && pv.$anchor ? String(pv.$anchor) : null;
          if (referencedKeys.has(pk) || (anchorName && referencedAnchors.has(anchorName))) {
            delete propsClone[pk];
            continue;
          }
        }
        return augmentSchemaForKnownIssues({ type: 'object', properties: propsClone }) as Schema;
      }
    }
  } catch (_) {
    // ignore
  }
  return augmentSchemaForKnownIssues(s) as Schema;
}

function produceResolvedCache(resolved: Schema, sourceIsObject?: boolean, source?: Schema): Schema {
  // Use the boolean discriminator `sourceIsObject` (set on schema load)
  // to decide whether to normalize the resolved view for editors.
  try {
    // In browser dev, rewrite refs that point to other local dev ports
    // (for example `http://localhost:5174/...`) to the current origin so
    // the app uses same-origin static files under `/schemas/` and avoids
    // CORS or cross-origin fetch issues. This is safe to run repeatedly
    // and is skipped when `window` is not available (tests/Node).
    try {
      if (typeof window !== 'undefined' && source && typeof source === 'object') {
        const rewrite = (node: any) => {
          if (!node || typeof node !== 'object') return;
          if (Array.isArray(node)) return node.forEach(rewrite);
          if (typeof node.$ref === 'string') {
            try {
              const ref = node.$ref as string;
              const url = new URL(ref, window.location.origin);
              if (url.hostname === 'localhost' && (url.port === '5174' || url.port === '5173')) {
                const parts = url.pathname.split('/');
                const name = parts[parts.length - 1] || 'schema.json';
                node.$ref = `${window.location.origin}/schemas/${name}`;
              }
            } catch (_) {
              // ignore
            }
          }
          for (const v of Object.values(node)) rewrite(v);
        };
        try { const cloned = JSON.parse(JSON.stringify(source)); rewrite(cloned); source = cloned; } catch (_) {
          // ignore
        }
      }
    } catch (_) {
      // ignore
    }
    // If an async `resolved` payload was provided and it already appears
    // to contain concrete inlined properties (not just $ref placeholders),
    // prefer normalizing and returning it directly. This ensures that
    // dereferenced remote schemas (e.g. emergencyContact inlined from
    // https://example.com/user-profile.schema.json) are presented fully
    // to the editors instead of deriving a view from the original `source`.
    try {
      if (resolved && typeof resolved === 'object') {
        const resObj = resolved as any;
        const hasProps = resObj.properties && typeof resObj.properties === 'object';
        const isPoly = Array.isArray(resObj.oneOf) || Array.isArray(resObj.anyOf) || Array.isArray(resObj.allOf);

        // If the resolved payload has schema facets (props, poly, etc), it is
        // considered a valid editor-ready view. Prefer it over deriving a new
        // view from `source` every time to ensure our path-based merges persist.
        if (hasProps || isPoly || resObj.type || resObj.items) {
          // If we are in-browser, annotate from source if available
          try {
            if (typeof window !== 'undefined' && source && typeof source === 'object') {
              const annotateFrom = (resNode: any, srcNode: any) => {
                if (!resNode || typeof resNode !== 'object') return;
                if (!srcNode || typeof srcNode !== 'object') return;
                // If source has a $ref or allOf containing a $ref, and the resolved
                // node doesn't have its own concrete identity, mark the provenance.
                try {
                  if (typeof srcNode.$ref === 'string' && !resNode.__from) {
                    try { (resNode as any).__from = srcNode.$ref; } catch (_) {
                      // ignore
                    }
                  } else if (Array.isArray(srcNode.allOf) && srcNode.allOf.some((e: any) => e && typeof e.$ref === 'string') && !resNode.__from) {
                    const m = srcNode.allOf.find((e: any) => e && typeof e.$ref === 'string');
                    try { (resNode as any).__from = m && m.$ref ? m.$ref : undefined; } catch (_) {
                      // ignore
                    }
                  }
                } catch (_) {
                  // ignore
                }

                // Recurse into properties
                if (resNode.properties && typeof resNode.properties === 'object') {
                  const resProps = resNode.properties as Record<string, any>;
                  const srcProps = srcNode.properties && typeof srcNode.properties === 'object' ? srcNode.properties as Record<string, any> : null;
                  for (const k of Object.keys(resProps)) {
                    try {
                      const childRes = resProps[k];
                      const childSrc = srcProps && Object.prototype.hasOwnProperty.call(srcProps, k) ? srcProps[k] : null;
                      annotateFrom(childRes, childSrc || {});
                    } catch (_) {
                      // ignore
                    }
                  }
                }
                // Recurse into items for arrays
                if (resNode.items && typeof resNode.items === 'object') {
                  const resItems = resNode.items;
                  const srcItems = srcNode.items && typeof srcNode.items === 'object' ? srcNode.items : null;
                  annotateFrom(resItems, srcItems || {});
                }
                // Recurse into polymorphic branches
                ['oneOf', 'anyOf', 'allOf'].forEach((key) => {
                  if (Array.isArray(resNode[key])) {
                    const resArr = resNode[key] as any[];
                    const srcArr = Array.isArray(srcNode[key]) ? (srcNode[key] as any[]) : [];
                    resArr.forEach((v, i) => annotateFrom(v, srcArr[i] || {}));
                  }
                });
              };
              annotateFrom(resolved, source || {});
            }
          } catch (_) {}

          if ((resolved as any).$defs) delete (resolved as any).$defs;
          return normalizeResolved(resolved, source);
        }
      }
    } catch (_) {
      // ignore
    }
    // If async resolved is not available but the source is an object-rooted
    // schema (for example when `resolved` is null during async deref),
    // build the editor view directly from the `source` so editors still
    // see the $ref placeholders or inlined properties.
    try {
      if ((!resolved || resolved === null) && sourceIsObject && source && typeof source === 'object') {
        const fromSource = (source as any).properties && typeof (source as any).properties === 'object' ? { type: 'object', properties: (source as any).properties } : { type: 'object', properties: source };
        return normalizeResolved(fromSource as Schema);
      }
    } catch (_) {
      // ignore
    }
    // Prefer to derive a normalized resolved view from the authoritative
    // `source` when available. This keeps schema-conversion logic inside
    // the reducer so UI layers never need to call resolver utilities.
    if (source && typeof source === 'object') {
      const srcObj = source as Record<string, any>;
      try {
        if (srcObj.$defs && typeof srcObj.$defs === 'object') {
          return normalizeResolved(srcObj.$defs as Schema);
        }
      } catch (_) {
        // ignore
      }
    }
    // Fall back to normalizing the provided resolved payload (if any).
    try {
      if (resolved && typeof resolved === 'object') {
        // If the resolved payload still contains a $defs map and properties
        // that reference it, inline those $ref entries so editors do not
        // observe $ref or top-level $defs.
        try {
          const maybeDefs: Record<string, any> = (resolved as any).$defs || (resolved as any).definitions || {};
          if (maybeDefs && typeof maybeDefs === 'object' && (resolved as any).properties && typeof (resolved as any).properties === 'object') {
            const defsMap = maybeDefs;
            const replaceRefs = (obj: any): any => {
              if (!obj || typeof obj !== 'object') return obj;
              if (Array.isArray(obj)) return obj.map(replaceRefs);
              if (obj.$ref && typeof obj.$ref === 'string') {
                const ref = obj.$ref as string;
                const defPrefixes = ['#/$defs/', '#/definitions/'];
                for (const prefix of defPrefixes) {
                  if (ref.startsWith(prefix)) {
                    const key = ref.replace(prefix, '');
                    const target = defsMap && defsMap[key] ? JSON.parse(JSON.stringify(defsMap[key])) : null;
                    if (target) {
                      if ((target as any).$anchor) delete (target as any).$anchor;
                      try {
                        (target as any).__from = ref;
                      } catch (_) {
                        // ignore
                      }
                      return replaceRefs(target);
                    }
                  }
                }
                return obj;
              }
              const out: any = {};
              for (const [kk, vv] of Object.entries(obj)) out[kk] = replaceRefs(vv);
              return out;
            };

            const resolvedProps = ((resolved as any).properties as Record<string, any>) || {};
            // Preserve source ordering when source provided, otherwise keep resolved order
            let cleaned: Record<string, any> = {};
            try {
              const srcProps = source && typeof source === 'object' && (source as any).properties && typeof (source as any).properties === 'object'
                ? (source as any).properties as Record<string, any>
                : null;
              if (srcProps) {
                for (const k of Object.keys(srcProps)) {
                  if (Object.prototype.hasOwnProperty.call(resolvedProps, k)) cleaned[k] = resolvedProps[k];
                }
                for (const k of Object.keys(resolvedProps)) if (!Object.prototype.hasOwnProperty.call(cleaned, k)) cleaned[k] = resolvedProps[k];
              } else {
                cleaned = { ...resolvedProps };
              }
            } catch (_) { cleaned = { ...resolvedProps }; }
            for (const pk of Object.keys(cleaned)) {
              try { cleaned[pk] = replaceRefs(cleaned[pk]); } catch (_) {
                // ignore
              }
            }
            const cleanedResolved = { ...(resolved as any), properties: cleaned } as Schema;
            if ((cleanedResolved as any).$defs) delete (cleanedResolved as any).$defs;
            return normalizeResolved(cleanedResolved, source);
          }
        } catch (_) {
          // ignore
        }
        return normalizeResolved(resolved, source);
      }
    } catch (_) {
      // ignore
    }
    return resolved;
  } catch (_) {
    // ignore
  }
  return resolved;
}

// Return the fully resolved (dereferenced) schema from the cache.
export function getResolvedSource(state: SchemaState): Schema {
  try {
    if (!state || !state.resolvedCache) return null;
    return canonicalizeForPersist(state.resolvedCache as Schema);
  } catch (_) {
    return state.resolvedCache as Schema;
  }
}

// Return a canonical schema suitable for persisting: rehydrate resolved edits into source when available.
export function getPersistableSource(state: SchemaState): Schema {
  try {
    if (!state) return null;
    const src = state.source;
    const resolved = state.resolvedCache;
    if (src && resolved) {
      // rehydrate edits from resolved view into the original source structure
      const rehydrated = rehydrateSchema(src as Record<string, any>, resolved as Record<string, any>);
      return canonicalizeForPersist(rehydrated);
    }
    return src;
  } catch (_) {
    return state.source;
  }
}

// Canonicalize an object for persistence: remove transient metadata and
// return a deep-cloned structure with deterministic key ordering.
function canonicalizeForPersist(s: Schema): Schema {
  if (!s || typeof s !== 'object') return s;
  const clone = JSON.parse(JSON.stringify(s));

  // Sanitize accidental self-referential $ref inside $defs that may be
  // produced by rehydration heuristics. These are transient and should
  // not appear in the canonical persisted form.
  try {
    if (clone && typeof clone === 'object' && clone.$defs && typeof clone.$defs === 'object') {
      for (const [k, v] of Object.entries(clone.$defs)) {
        try {
          if (v && typeof v === 'object' && typeof (v as any).$ref === 'string') {
            const ref = (v as any).$ref as string;
            if (ref === `#/$defs/${k}`) delete (v as any).$ref;
          }
        } catch (_) {
          // ignore
        }
      }
    }
  } catch (_) {
    // ignore
  }

  const prune = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    // remove transient/meta keys that shouldn't affect persisted canonical form
    delete obj.$id;
    delete obj.$schema;
    delete obj.__from;
    delete obj.$anchor;
    for (const k of Object.keys(obj)) prune(obj[k]);
  };

  const sortKeysDeep = (x: any): any => {
    if (Array.isArray(x)) return x.map(sortKeysDeep);
    if (x && typeof x === 'object') {
      const out: Record<string, any> = {};
      for (const k of Object.keys(x).sort()) out[k] = sortKeysDeep(x[k]);
      return out;
    }
    return x;
  };

  prune(clone);
  return sortKeysDeep(clone) as Schema;
}
