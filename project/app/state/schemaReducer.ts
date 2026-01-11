import { resolveSchemaSync, rehydrateToRefs, resolveSchema } from "~/utils/schema-resolver";

export const LOAD_SOURCE_SCHEMA = "LOAD_SOURCE_SCHEMA";
export const APPLY_SOURCE_UPDATE = "APPLY_SOURCE_UPDATE";
export const APPLY_RESOLVED_EDIT = "APPLY_RESOLVED_EDIT";
export const SET_DEREF_IN_PROGRESS = "SET_DEREF_IN_PROGRESS";
export const SET_RESOLVED_CACHE = "SET_RESOLVED_CACHE";

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
  | { type: typeof SET_RESOLVED_CACHE; payload: Schema };

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
  } catch (_) {}
  return false;
}

export function initialSchemaState(initialSource: Schema): SchemaState {
  const isObj = isObjectSchema(initialSource);
  return {
    source: initialSource ?? null,
    resolvedCache: produceResolvedCache(initialSource ?? null, isObj, initialSource),
    derefInProgress: false,
    sourceIsObject: isObj,
  };
}

export default function schemaReducer(state: SchemaState, action: SchemaAction): SchemaState {
  switch (action.type) {
    case LOAD_SOURCE_SCHEMA:
    case APPLY_SOURCE_UPDATE: {
      const src = action.payload;
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
        const srcObj = state.source as Record<string, any>;
        if (srcObj.$defs || typeof srcObj.$ref === 'string') {
          newSource = rehydrateToRefs(state.source as Record<string, unknown>, resolved as Record<string, unknown>);
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

// Helper to encapsulate sync+async resolution and dispatch updates.
export async function ensureResolved(dispatch: (a: SchemaAction) => void, source: Schema) {
  dispatch({ type: SET_DEREF_IN_PROGRESS, payload: true });
  try {
    // Prefer the full async resolver so remote $ref can be fetched before
    // updating the resolved cache. If the async resolver fails, fall back
    // to the synchronous fast resolver to avoid leaving the UI without a view.
    try {
      const asyncResolved = await resolveSchema(source);
      if (asyncResolved) dispatch({ type: SET_RESOLVED_CACHE, payload: asyncResolved });
      else {
        const fast = resolveSchemaSync(source);
        if (fast) dispatch({ type: SET_RESOLVED_CACHE, payload: fast });
      }
    } catch (e) {
      try {
        const fast = resolveSchemaSync(source);
        if (fast) dispatch({ type: SET_RESOLVED_CACHE, payload: fast });
      } catch (_) {}
    }
  } catch (e) {
    // ensure we clear in-progress flag
    dispatch({ type: SET_DEREF_IN_PROGRESS, payload: false });
  }
}

function normalizeResolved(s: Schema): Schema {
  if (!s || typeof s !== 'object') return s;
  try {
    // If already a root object with `properties`, remove any properties that still expose `$anchor` metadata
    // and also remove top-level defs that are referenced within other defs (via $ref).
        if ('type' in s || 'properties' in s) {
      if (s.properties && typeof s.properties === 'object') {
        const props = { ...(s.properties as Record<string, any>) };
        // collect all provenance markers (e.g. $ref) that appear nested within properties
        const nestedFroms = new Set<string>();
        const collectFroms = (obj: any, skipSelf = false) => {
          if (!obj || typeof obj !== 'object') return;
          if (Array.isArray(obj)) return obj.forEach((o) => collectFroms(o, false));
          if (!skipSelf && typeof obj.$ref === 'string') nestedFroms.add(obj.$ref as string);
          for (const v of Object.values(obj)) collectFroms(v, false);
        };
        for (const [k, v] of Object.entries(props)) {
          // collect froms from nested content, skipping the top-level property itself
          collectFroms(v, true);
        }

        const cleaned: Record<string, any> = {};
        for (const pk of Object.keys(props)) {
          const pv = props[pk];
          // remove if still exposing $anchor
          if (pv && typeof pv === 'object' && ('$anchor' in pv)) {
            continue;
          }
          cleaned[pk] = pv;
        }
        const out = { ...s, properties: cleaned };
        // Ensure editor view is object-rooted when properties exist
        if (!(out as any).type) (out as any).type = 'object';
        // Ensure we never expose a top-level $defs on the normalized view
        if ((out as any).$defs) delete (out as any).$defs;
        return out;
      }
      return s;
    }
    const keys = Object.keys(s as Record<string, unknown>);
    if (keys.length > 0) {
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
        for (const [k, v] of Object.entries(propsClone)) collectFroms(v, true);
        for (const pk of Object.keys(propsClone)) {
          const pv = propsClone[pk];
          if (pv && typeof pv === 'object' && ('$anchor' in pv)) {
            delete propsClone[pk];
            continue;
          }
          if (pv && typeof pv === 'object') {
            // If this prop still has $anchor metadata, remove it from the view
            // (anchors are transient and shouldn't be surfaced to editors).
            if ('$anchor' in pv) { delete propsClone[pk]; continue; }
            // If there are nested $ref usages that include this key by
            // path (e.g. '#/$defs/<key>') then prefer not to expose the
            // duplicated inline copy to editors.
            for (const r of nestedFroms) {
              if (typeof r === 'string' && r.includes(pk)) { delete propsClone[pk]; break; }
            }
          }
        }
        return { type: 'object', properties: propsClone };
      }
    }
  } catch (_) {}
  return s;
}

function produceResolvedCache(resolved: Schema, sourceIsObject?: boolean, source?: Schema): Schema {
  // Use the boolean discriminator `sourceIsObject` (set on schema load)
  // to decide whether to normalize the resolved view for editors.
  try {
    // Prefer to derive a normalized resolved view from the authoritative
    // `source` when available. This keeps schema-conversion logic inside
    // the reducer so UI layers never need to call resolver utilities.
    if (source && typeof source === 'object') {
      const srcObj = source as Record<string, any>;
      try {
        const fast = resolveSchemaSync(source);
        // (debug logs removed)
        if (fast) {
          // If the original source provided $defs, detect defs that are
          // only referenced within other defs and remove them from the
          // top-level properties presented to editors. This mirrors the
          // prior behavior that avoided exposing referenced top-level defs.
          try {
            const defs = srcObj.$defs as Record<string, any> | undefined;
            if (defs && fast && typeof fast === 'object' && (fast as any).properties && typeof (fast as any).properties === 'object') {
              const referenced = new Set<string>();
              const collectRefs = (obj: any) => {
                if (!obj || typeof obj !== 'object') return;
                if (Array.isArray(obj)) return obj.forEach(collectRefs);
                if (typeof obj.$ref === 'string') {
                  const r = obj.$ref as string;
                  if (r.startsWith('#/$defs/')) referenced.add(r.replace('#/$defs/', ''));
                  else if (r.startsWith('#')) {
                    const anchor = r.slice(1);
                    for (const k of Object.keys(defs)) {
                      if ((defs[k] as any).$anchor === anchor) referenced.add(k);
                    }
                  }
                }
                for (const v of Object.values(obj)) collectRefs(v);
              };
              for (const v of Object.values(defs)) collectRefs(v);

              // Start with the properties from the fast resolver
              const fastProps = ((fast as any).properties as Record<string, any>) || {};
              // Preserve original source property ordering when possible
              let cleaned: Record<string, any> = {};
              try {
                const srcProps = srcObj && srcObj.properties && typeof srcObj.properties === 'object' ? srcObj.properties as Record<string, any> : null;
                if (srcProps) {
                  for (const k of Object.keys(srcProps)) {
                    if (Object.prototype.hasOwnProperty.call(fastProps, k)) cleaned[k] = fastProps[k];
                  }
                  for (const k of Object.keys(fastProps)) if (!Object.prototype.hasOwnProperty.call(cleaned, k)) cleaned[k] = fastProps[k];
                } else {
                  cleaned = { ...fastProps };
                }
              } catch (_) { cleaned = { ...fastProps }; }
              // If some defs are only referenced by other defs, remove those top-level properties
              for (const k of Object.keys(cleaned)) {
                if (referenced.has(k)) delete cleaned[k];
              }

              // Inline any remaining $ref entries in properties using the canonical defs
              const defsMap: Record<string, any> = (fast as any).$defs || srcObj.$defs || {};
              const replaceRefs = (obj: any): any => {
                if (!obj || typeof obj !== 'object') return obj;
                if (Array.isArray(obj)) return obj.map(replaceRefs);
                if (obj.$ref && typeof obj.$ref === 'string') {
                  const ref = obj.$ref as string;
                  if (ref.startsWith('#/$defs/')) {
                    const key = ref.replace('#/$defs/', '');
                    const target = defsMap && defsMap[key] ? JSON.parse(JSON.stringify(defsMap[key])) : null;
                    if (target) {
                      if ((target as any).$anchor) delete (target as any).$anchor;
                      return replaceRefs(target);
                    }
                  }
                  return obj;
                }
                const out: any = {};
                for (const [kk, vv] of Object.entries(obj)) out[kk] = replaceRefs(vv);
                return out;
              };
              for (const pk of Object.keys(cleaned)) {
                try { cleaned[pk] = replaceRefs(cleaned[pk]); } catch (_) {}
              }

              const cleanedResolved = { ...(fast as any), properties: cleaned } as Schema;
              // Ensure we never expose top-level $defs on the normalized view
              if ((cleanedResolved as any).$defs) delete (cleanedResolved as any).$defs;
              // (debug logs removed)
              return normalizeResolved(cleanedResolved);
            }
          } catch (_) {}
          // (debug logs removed)
          return normalizeResolved(fast);
        }
        // If the fast resolver did not produce a resolved view, but the
        // authoritative source exposes a top-level `$defs`, convert that
        // defs map into a normalized root-object view for editors. This
        // avoids returning the raw `source` object (which may contain
        // `$defs`) when resolution utilities are unavailable in the
        // test/runtime environment.
        if (srcObj.$defs && typeof srcObj.$defs === 'object') {
          // eslint-disable-next-line no-console
          console.warn('[schemaReducer] fast resolver did not produce a resolved view; normalizing source.$defs as fallback');
          // (debug logs removed)
          return normalizeResolved(srcObj.$defs as Schema);
        }
      } catch (_) {}
    }
    // Fall back to normalizing the provided resolved payload (if any).
    try {
      if (resolved && typeof resolved === 'object') {
        // If the resolved payload still contains a $defs map and properties
        // that reference it, inline those $ref entries so editors do not
        // observe $ref or top-level $defs.
        try {
          const maybeDefs: Record<string, any> = (resolved as any).$defs || {};
          if (maybeDefs && typeof maybeDefs === 'object' && (resolved as any).properties && typeof (resolved as any).properties === 'object') {
            const defsMap = maybeDefs;
            const replaceRefs = (obj: any): any => {
              if (!obj || typeof obj !== 'object') return obj;
              if (Array.isArray(obj)) return obj.map(replaceRefs);
              if (obj.$ref && typeof obj.$ref === 'string') {
                const ref = obj.$ref as string;
                if (ref.startsWith('#/$defs/')) {
                  const key = ref.replace('#/$defs/', '');
                  const target = defsMap && defsMap[key] ? JSON.parse(JSON.stringify(defsMap[key])) : null;
                  if (target) {
                    if ((target as any).$anchor) delete (target as any).$anchor;
                    return replaceRefs(target);
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
              try { cleaned[pk] = replaceRefs(cleaned[pk]); } catch (_) {}
            }
            const cleanedResolved = { ...(resolved as any), properties: cleaned } as Schema;
            if ((cleanedResolved as any).$defs) delete (cleanedResolved as any).$defs;
            return normalizeResolved(cleanedResolved);
          }
        } catch (_) {}
        return normalizeResolved(resolved);
      }
    } catch (_) {}
    return resolved;
  } catch (_) {}
  return resolved;
}

// Return a canonical schema suitable for persisting: rehydrate resolved edits into source when available.
export function getPersistableSource(state: SchemaState): Schema {
  try {
    if (!state) return null;
    const src = state.source;
    const resolved = state.resolvedCache;
    if (src && resolved) {
      // rehydrate edits from resolved view into the original source structure
      const rehydrated = rehydrateToRefs(src, resolved);
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
        } catch (_) {}
      }
    }
  } catch (_) {}

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
