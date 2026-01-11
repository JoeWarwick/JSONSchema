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
};

export type SchemaAction =
  | { type: typeof LOAD_SOURCE_SCHEMA; payload: Schema }
  | { type: typeof APPLY_SOURCE_UPDATE; payload: Schema }
  | { type: typeof APPLY_RESOLVED_EDIT; payload: Schema }
  | { type: typeof SET_DEREF_IN_PROGRESS; payload: boolean }
  | { type: typeof SET_RESOLVED_CACHE; payload: Schema };

export function initialSchemaState(initialSource: Schema): SchemaState {
  return {
    source: initialSource ?? null,
    resolvedCache: resolveSchemaSync(initialSource),
    derefInProgress: false,
  };
}

export default function schemaReducer(state: SchemaState, action: SchemaAction): SchemaState {
  switch (action.type) {
    case LOAD_SOURCE_SCHEMA:
    case APPLY_SOURCE_UPDATE: {
      const src = action.payload;
      return {
        ...state,
        source: src,
        // invalidate cache; component will trigger async resolve
        resolvedCache: resolveSchemaSync(src),
        derefInProgress: true,
      };
    }
    case APPLY_RESOLVED_EDIT: {
      const resolved = action.payload;
      // Map the edited resolved schema back into the canonical source structure
      const newSource = state.source ? rehydrateToRefs(state.source, resolved) : resolved;
      return {
        ...state,
        source: newSource,
        resolvedCache: resolveSchemaSync(newSource),
        derefInProgress: true,
      };
    }
    case SET_DEREF_IN_PROGRESS:
      return { ...state, derefInProgress: action.payload };
    case SET_RESOLVED_CACHE:
      return { ...state, resolvedCache: action.payload, derefInProgress: false };
    default:
      return state;
  }
}

// Helper to encapsulate sync+async resolution and dispatch updates.
export async function ensureResolved(dispatch: (a: SchemaAction) => void, source: Schema) {
  dispatch({ type: SET_DEREF_IN_PROGRESS, payload: true });
  try {
    try {
      const fast = resolveSchemaSync(source);
      if (fast) dispatch({ type: SET_RESOLVED_CACHE, payload: fast });
    } catch (_) {}
    const asyncResolved = await resolveSchema(source);
    dispatch({ type: SET_RESOLVED_CACHE, payload: asyncResolved });
  } catch (e) {
    // ensure we clear in-progress flag
    dispatch({ type: SET_DEREF_IN_PROGRESS, payload: false });
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
      return rehydrateToRefs(src, resolved);
    }
    return src;
  } catch (_) {
    return state.source;
  }
}
