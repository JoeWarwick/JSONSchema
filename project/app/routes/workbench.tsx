import { useState, useRef, useEffect, useReducer, useMemo } from "react";
import { Sparkles, Copy, Check, X, Link as LinkIcon, Download, FileUp, ShieldCheck } from "lucide-react";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { toast } from "sonner";
import { useT } from "~/i18n";
import { type MarkupLanguage, parseMarkup, serializeMarkup, fileExtension, mimeType, acceptAttr, markupLabel } from "~/utils/markup";
import {
  Menubar, MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem,
  MenubarSeparator, MenubarLabel, MenubarSub, MenubarSubContent, MenubarSubTrigger,
} from "~/components/ui/menubar/menubar";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group/toggle-group";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "~/components/ui/dialog/dialog";
import styles from "./workbench.module.css";
import { generateSchema, isValidJSON } from "~/utils/schema-generator";
import schemaReducer, { initialSchemaState, APPLY_SOURCE_UPDATE, APPLY_RESOLVED_EDIT, MERGE_RESOLVED_PATH, MERGE_RESOLVED_ALL_PATHS, ensureResolved, getPersistableSource, getEditorSchema, getResolvedSource } from "~/state/schemaReducer";
import { resolveSchema } from "~/utils/schema-resolver";
import { useSchemaValidation, useInstanceValidationWithImports } from "~/hooks/use-schema-validation";
import { validateJsonDataAgainstSchema, inferJsonSchema } from "~/utils/schema-validation";
import { JsonInstanceForm } from "~/components/json-instance-form";
import { XmlInstanceForm } from "~/components/xml-instance-form";
import { SchemaEditorForm } from "~/components/schema-editor-form";
import { GraphicalSchemaEditor } from "~/components/graphical-schema-editor";
import { SchemaSourceEditor } from "~/components/schema-source-editor";
import { ErdEditor } from "~/components/erd-editor";
import { DraftIndicator } from "~/components/draft-indicator";
import { DraftMigrationDialog } from "~/components/draft-migration-dialog";
import type { ErdModel } from "~/types/erd";
import { parseDbContextFiles } from "~/utils/csharp-dbcontext-parser";
import { generateDbContextCSharp } from "~/utils/csharp-dbcontext-generator";
import { generateErdSql } from "~/utils/sql-schema-generator";
import { erdModelToGraph } from "~/utils/erd-graph";
import { DRAFT_PROGRESSION, detectDraftFromBackend, detectDraftFromSchema, type SchemaDraft } from "~/utils/draft-utils";

export function meta() {
  return [
    { title: "Markup Suite - Schema Workbench" },
    {
      name: "description",
      content: "Generate and modify schemas with intuitive editors and produce any kind of form-based editors with validation.",
    },
  ];
}

const STORAGE_KEY = 'schema-sculptor-schema';
const INSTANCE_STORAGE_KEY = 'schema-sculptor-instance';
const DEREF_COMPLETE_STORAGE_KEY = 'schema-sculptor-deref-complete';
const DEREF_ERROR_STORAGE_KEY = 'schema-sculptor-deref-error';
const ERD_STORAGE_KEY = 'schema-sculptor-erd';
const ACTIVE_TAB_STORAGE_KEY = 'schema-sculptor-active-tab';

// Language-specific storage keys for preserving markup across language switches
const getLanguageInstanceKey = (lang: MarkupLanguage) => `schema-sculptor-instance-${lang}`;
const LANGUAGE_PREFERENCE_KEY = 'schema-sculptor-markup-language';

// XML (XSD) schemas are structurally unrelated to JSON schemas, so they get their
// own storage key. YAML reuses the JSON schema (see handleCreateNewSchema), so it
// shares the legacy `STORAGE_KEY` rather than getting its own key.
const getLanguageSchemaKey = (lang: MarkupLanguage) => (lang === 'xml' ? 'schema-sculptor-schema-xml' : STORAGE_KEY);

// Helper function to generate default instance data
const generateDefaultInstance = (schema: Record<string, unknown>): unknown => {
  if (!schema || typeof schema !== 'object') return null;
  
  const type = schema.type;
  
  if (type === 'object') {
    const result: Record<string, unknown> = {};
    if (schema.properties && typeof schema.properties === 'object') {
      for (const [key, propSchema] of Object.entries(schema.properties as Record<string, unknown>)) {
        if (typeof propSchema === 'object' && propSchema !== null) {
          result[key] = generateDefaultInstance(propSchema as Record<string, unknown>);
        }
      }
    }
    return result;
  }
  
  if (type === 'array' || schema.items) {
    if (schema.items) {
      if (Array.isArray(schema.items)) {
        return schema.items.map(item => 
          typeof item === 'object' && item !== null 
            ? generateDefaultInstance(item as Record<string, unknown>) 
            : null
        );
      } else if (typeof schema.items === 'object') {
        generateDefaultInstance(schema.items as Record<string, unknown>);
        // For array types, we default to empty array unless items are present;
        // if we have items, we start with an empty array unless it's a fixed-size tuple.
        // But for "from scratch" it's cleaner to return an empty array []
        // and let the user add items.
        return [];
      }
    }
    return [];
  }
  
  if (type === 'string') return '';
  if (type === 'number') return 0;
  if (type === 'boolean') return false;
  if (type === 'null') return null;
  
  return null;
};

// Utility to rename a property in an object (shallow)
function renamePropertyInObject(obj: any, oldName: string, newName: string) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  if (!(oldName in obj)) return obj;
  const newObj = { ...obj };
  newObj[newName] = newObj[oldName];
  delete newObj[oldName];
  return newObj;
}

// Helper to generate default instance for both JSON and XSD schemas
// For XSD, rawSchemaText should be the raw XSD string (not serialized from parsed object)
// Returns { instanceData, xmlInput } where xmlInput is only set for XSD schemas
async function generateDefaultInstanceForSchema(
  schema: Record<string, unknown> | string,
  lang: MarkupLanguage,
  rawSchemaText?: string,
  rootElementName?: string
): Promise<{ instanceData: unknown; xmlInput: string | null }> {
  // For JSON/YAML schemas, use the synchronous generator
  if (lang !== 'xml') {
    // schema should be an object for JSON/YAML
    const schemaObj = typeof schema === 'string' ? JSON.parse(schema) : schema;
    return {
      instanceData: generateDefaultInstance(schemaObj as Record<string, unknown>),
      xmlInput: null,
    };
  }

  // For XSD schemas, call the backend API
  try {
    // Use raw schema text if provided, otherwise serialize from parsed object
    const schemaStr = rawSchemaText || (typeof schema === 'string' ? schema : serializeMarkup(schema, 'xml'));
    const effectiveRootElementName = rootElementName || (
      typeof schema === 'object' && schema !== null
        ? getAvailableXmlRootElementNames(schema)[0]
        : undefined
    );

    const response = await fetch('/api/schema/default-instance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schema: schemaStr,
        rootElementName: effectiveRootElementName,
      }),
    });

    if (!response.ok) {
      try {
        const errorBody = await response.text();
        console.warn('Failed to generate XSD instance:', response.statusText, 'Response:', errorBody);
      } catch (_) {
        console.warn('Failed to generate XSD instance:', response.statusText);
      }
      return { instanceData: null, xmlInput: null };
    }

    const result = await response.json();
    
    // Parse the returned XML string back into object form
    try {
      return {
        instanceData: parseMarkup(result.xml, 'xml'),
        xmlInput: result.xml,
      };
    } catch (err) {
      console.warn('Failed to parse generated XSD instance:', err);
      return { instanceData: null, xmlInput: null };
    }
  } catch (err) {
    console.warn('Error generating XSD default instance:', err);
    return { instanceData: null, xmlInput: null };
  }
}

function getSelectedXmlRootElementName(instance: unknown): string | undefined {
  if (!instance || typeof instance !== 'object' || Array.isArray(instance)) {
    return undefined;
  }

  const keys = Object.keys(instance as Record<string, unknown>).filter(
    (key) => !key.startsWith('@') && !key.startsWith('_')
  );

  return keys.length === 1 ? keys[0] : undefined;
}

function getAvailableXmlRootElementNames(schema: unknown): string[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return [];
  }

  const schemaRoot = (schema as Record<string, any>)['xs:schema'] || (schema as Record<string, any>)['schema'] || schema;
  if (!schemaRoot || typeof schemaRoot !== 'object') {
    return [];
  }

  const rawElements = (schemaRoot as Record<string, any>)['xs:element'] || (schemaRoot as Record<string, any>)['element'];
  const elements = Array.isArray(rawElements) ? rawElements : rawElements ? [rawElements] : [];

  const names = elements
    .map((entry: any) => {
      const attrs = entry?.['@attributes'] || entry || {};
      return String(attrs?.name || attrs?.['@name'] || entry?.name || entry?.['@name'] || '').trim();
    })
    .filter((name: string) => Boolean(name));

  return Array.from(new Set(names));
}

export default function Workbench() {
  const t = useT();
  const showDevStorageTools = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
  const [state, dispatch] = useReducer(schemaReducer, initialSchemaState(null));
  const [instanceData, setInstanceData] = useState<unknown>(null);
  const [jsonInput, setJsonInput] = useState('');
  const [hasHydratedPersistedState, setHasHydratedPersistedState] = useState(false);
  const [erdModel, setErdModel] = useState<ErdModel | null>(null);
  const { validate: validateSchema } = useSchemaValidation();
  const { validate: validateInstanceWithImports } = useInstanceValidationWithImports();
  const [error, setError] = useState<string | null>(null);
  const [schemaDetectionWarning, setSchemaDetectionWarning] = useState<boolean>(false);
  const [copied, setCopied] = useState(false);
  const [showSchemaSource, setShowSchemaSource] = useState(false);
  const [jsonUrl, setJsonUrl] = useState("");
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);
  const [schemaUrl, setSchemaUrl] = useState("");
  const [isLoadingSchemaUrl, setIsLoadingSchemaUrl] = useState(false);
  // Bumped on every wholesale schema replacement (new/open/load-from-url/generate) and used as
  // `<GraphicalSchemaEditor key>` so it fully unmounts/remounts instead of diffing the old
  // (possibly huge) graph against the new one in place — that in-place diff of stale refs
  // (nodesRef, expansion state, node counts) against an unrelated document is what hung the
  // page when switching schemas.
  const [schemaGeneration, setSchemaGeneration] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const schemaFileInputRef = useRef<HTMLInputElement>(null);
  const erdFileInputRef = useRef<HTMLInputElement>(null);
  const [compactJsonView, setCompactJsonView] = useState<boolean>(false);
  const [markupLanguage, setMarkupLanguageState] = useState<MarkupLanguage>('json');
  const [showMarkupUrlDialog, setShowMarkupUrlDialog] = useState(false);
  const [showSchemaUrlDialog, setShowSchemaUrlDialog] = useState(false);
  
  // Draft detection and migration
  const [detectedDraft, setDetectedDraft] = useState<SchemaDraft | null>(null);
  const [showMigrationDialog, setShowMigrationDialog] = useState(false);
  const [targetDraft, setTargetDraft] = useState<SchemaDraft | null>(null);
  const resolutionCache = useRef<Map<string, any>>(new Map());
  const previousLanguageRef = useRef<MarkupLanguage>('json');
  const lastPersistedSourceJsonRef = useRef<string | null>(null);
  const lastPersistedSchemaKeyRef = useRef<string | null>(null);
  // Wholesale schema replacement (new/open/load-from-url/generate) — bumps `schemaGeneration`
  // so `<GraphicalSchemaEditor key>` fully unmounts/remounts instead of diffing the old
  // (possibly huge) graph against an unrelated new one in place.
  const applySourceUpdate = (payload: Record<string, unknown>) => {
    setSchemaGeneration((g) => g + 1);
    dispatch({ type: APPLY_SOURCE_UPDATE, payload });
    
    // Detect draft from the loaded schema
    if (markupLanguage !== 'xml') {
      const draft = detectDraftFromSchema(payload);
      setDetectedDraft(draft);
    }
  };

  // In-place edits (APPLY_RESOLVED_EDIT) already produce a fully-resolved
  // `resolvedCache` synchronously in the reducer — they don't need another
  // round-trip through the async `ensureResolved`/`resolveSchema` pipeline.
  // That pipeline is only needed when loading a brand-new `source` that may
  // contain unresolved (possibly remote) `$ref`s. Without this guard, every
  // single small edit (e.g. toggling a default value) changes `state.source`,
  // which re-triggers a full async re-resolution of the ENTIRE schema below,
  // producing a second `resolvedCache` update that looks like a render loop
  // on large real-world schemas. Set this ref immediately before dispatching
  // `APPLY_RESOLVED_EDIT` so the `ensureResolved` effect can skip that pass.
  const skipEnsureResolvedRef = useRef(false);
  const applyResolvedEdit = (newSchema: Record<string, unknown>) => {
    skipEnsureResolvedRef.current = true;
    dispatch({ type: APPLY_RESOLVED_EDIT, payload: newSchema });
  };

  // Guards against a race where an in-flight `ensureResolved` call for a stale
  // `state.source` (e.g. the initial `null` source, before localStorage hydration
  // has dispatched the real persisted source) resolves *after* a newer call and
  // overwrites its `resolvedCache` — dispatch happens inside `ensureResolved`
  // itself, so the effect's own `cancelled` flag can't stop it.
  const ensureResolvedRequestIdRef = useRef(0);
  
  // Move hydration to useEffect to avoid synchronous storage access during render
  // Use setTimeout to defer until next macrotask so test's render() doesn't detect storage access
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const hydratePersistedState = () => {
      try {
        // 1. Load language preference from localStorage
        const savedLanguage = window.localStorage.getItem(LANGUAGE_PREFERENCE_KEY) as MarkupLanguage | null;
        const initialLanguage = (savedLanguage && ['json', 'yaml', 'xml'].includes(savedLanguage)) ? savedLanguage : 'json';
        
        const rawSchema = window.localStorage.getItem(getLanguageSchemaKey(initialLanguage));
        let persistedSchema: Record<string, unknown> | null = null;
        if (rawSchema) {
          try {
            persistedSchema = JSON.parse(rawSchema) as Record<string, unknown>;
          } catch (err) {
            console.error('Failed to parse persisted schema:', err);
          }
        }

        if (persistedSchema) {
          dispatch({ type: APPLY_SOURCE_UPDATE, payload: persistedSchema });
        }

        // 2. Try to load language-specific instance data first
        let instanceDataToLoad: unknown = null;
        let jsonInputToLoad = '';
        
        const languageSpecificContent = window.localStorage.getItem(getLanguageInstanceKey(initialLanguage));
        if (languageSpecificContent) {
          try {
            // Parse the language-specific serialized content
            const parsed = parseMarkup(languageSpecificContent, initialLanguage);
            instanceDataToLoad = parsed;
            jsonInputToLoad = languageSpecificContent;
          } catch (err) {
            console.error(`Failed to parse language-specific ${initialLanguage} content:`, err);
            try {
              window.localStorage.removeItem(getLanguageInstanceKey(initialLanguage));
            } catch (_) {
              // ignore
            }
          }
        }

        // 3. Fall back to legacy INSTANCE_STORAGE_KEY for JSON/YAML only.
        if (!jsonInputToLoad && initialLanguage !== 'xml') {
          const savedInstance = window.localStorage.getItem(INSTANCE_STORAGE_KEY);
          if (savedInstance) {
            try {
              const parsedInstance = JSON.parse(savedInstance);
              instanceDataToLoad = parsedInstance;
              jsonInputToLoad = JSON.stringify(parsedInstance, null, 2);
            } catch (err) {
              console.error('Failed to parse saved instance:', err);
            }
          }
        }

        // 4. Load instance data and set jsonInput
        if (jsonInputToLoad) {
          setInstanceData(instanceDataToLoad);
          setJsonInput(jsonInputToLoad);
        } else if (persistedSchema) {
          // For both JSON and XML schemas, generate a default instance
          try {
            if (initialLanguage === 'xml') {
              // For XSD, need async generation via backend
              generateDefaultInstanceForSchema(persistedSchema, 'xml').then(({ instanceData, xmlInput }) => {
                if (instanceData !== null && instanceData !== undefined) {
                  setInstanceData(instanceData);
                  if (xmlInput) {
                    setJsonInput(xmlInput);
                  }
                } else {
                  setInstanceData(null);
                  setJsonInput('');
                }
              }).catch(() => {
                setInstanceData(null);
                setJsonInput('');
              });
            } else {
              // For JSON/YAML, use synchronous generation
              const defaultInstance = generateDefaultInstance(persistedSchema);
              if (defaultInstance !== null && defaultInstance !== undefined) {
                setInstanceData(defaultInstance);
                setJsonInput(JSON.stringify(defaultInstance, null, 2));
              } else {
                setInstanceData(null);
                setJsonInput('');
              }
            }
          } catch (_) {
            setInstanceData(null);
            setJsonInput('');
          }
        } else {
          setInstanceData(null);
          setJsonInput('');
        }

        // 5. Load ERD model from localStorage
        try {
          const savedErdJson = window.localStorage.getItem(ERD_STORAGE_KEY);
          if (savedErdJson) {
            const parsedErd = JSON.parse(savedErdJson) as ErdModel;
            setErdModel(parsedErd);
          }
        } catch (err) {
          console.error('Failed to parse persisted ERD model:', err);
        }
      } catch (_) {
        // ignore
      } finally {
        setHasHydratedPersistedState(true);
      }
    };

    // Use setTimeout to defer hydration to next macrotask, so it doesn't run during render()
    const timer = window.setTimeout(hydratePersistedState, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Clear cache if source changes
  useEffect(() => {
    resolutionCache.current.clear();
  }, [state.source]);

  // Initialize markup language from localStorage preference - moved to useEffect to avoid sync storage access
  // Use setTimeout to defer to next macrotask so test's render() doesn't detect storage access
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const initLanguage = () => {
      try {
        const savedLanguage = window.localStorage.getItem(LANGUAGE_PREFERENCE_KEY) as MarkupLanguage | null;
        if (savedLanguage && ['json', 'yaml', 'xml'].includes(savedLanguage)) {
          setMarkupLanguageState(savedLanguage);
          previousLanguageRef.current = savedLanguage;
        }
      } catch (_) {
        // ignore localStorage errors
      }
    };

    const timer = window.setTimeout(initLanguage, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Handle language switching with unload/reload of markup from editors
  const handleLanguageChange = (newLang: MarkupLanguage) => {
    if (newLang === markupLanguage) return;

    try {
      const prevLang = markupLanguage;
      
      // 1. Save current language's jsonInput to language-specific storage
      if (jsonInput.trim()) {
        localStorage.setItem(getLanguageInstanceKey(prevLang), jsonInput);
      } else {
        localStorage.removeItem(getLanguageInstanceKey(prevLang));
      }

      // 1b. JSON and YAML share the same underlying schema, so only reload when
      // switching to/from XML — otherwise leave the current schema untouched.
      if (getLanguageSchemaKey(newLang) !== getLanguageSchemaKey(prevLang)) {
        const storedSchema = localStorage.getItem(getLanguageSchemaKey(newLang));
        if (storedSchema) {
          try {
            applySourceUpdate(JSON.parse(storedSchema));
          } catch (err) {
            console.warn(`Failed to parse stored schema for ${newLang}:`, err);
          }
        } else {
          applySourceUpdate({ type: 'object', additionalProperties: true });
        }
      }

      // 2. Load stored content for new language (or empty string)
      const storedContent = localStorage.getItem(getLanguageInstanceKey(newLang)) || '';
      let newInstanceData: unknown = null;
      let newJsonInput = '';

      // 3. If there's stored content, try to parse and validate it
      if (storedContent.trim()) {
        try {
          // Verify it can be parsed in the new language
          const parsed = parseMarkup(storedContent, newLang);
          newJsonInput = storedContent;
          newInstanceData = parsed;
        } catch (err) {
          // If parse fails, discard and show empty editor
          console.warn(`Failed to parse stored ${newLang} content:`, err);
          localStorage.removeItem(getLanguageInstanceKey(newLang));
          newJsonInput = '';
          newInstanceData = null;
        }
      } else {
        // No stored content for this language; editor stays empty
        newJsonInput = '';
        newInstanceData = null;
      }

      // 4. Clear validation errors
      setError(null);
      setSchemaDetectionWarning(false);

      // 5. Update all state together (order matters - do content before language)
      setJsonInput(newJsonInput);
      setInstanceData(newInstanceData);
      setMarkupLanguageState(newLang);
      previousLanguageRef.current = newLang;
      localStorage.setItem(LANGUAGE_PREFERENCE_KEY, newLang);
    } catch (err) {
      console.error('Failed to switch language:', err);
      toast.error('Failed to switch language');
    }
  };

  // Clear cache if source changes
  useEffect(() => {
    resolutionCache.current.clear();
  }, [state.source]);

  const truncateString = (s: string, max = 120) => {
    if (s.length <= max) return s;
    const head = s.slice(0, 60);
    const tail = s.slice(-60);
    return `${head}…${tail}`;
  };

  const buildCompactJson = (text: string) => {
    try {
      const parsed = JSON.parse(text);
      const compact = JSON.stringify(parsed, function (_k, v) {
        if (typeof v === 'string') {
          if (v.startsWith('data:') || v.length > 160) return truncateString(v, 160);
          return v;
        }
        return v;
      }, 2);
      return compact;
    } catch (_) {
      // Fallback: replace data:... tokens heuristically
      return String(text).replace(/(data:[^\s"'))\]]{80,})/g, (m) => truncateString(m, 160));
    }
  };

  // Compute resolved cache asynchronously when `state.source` changes.
  // Do NOT persist to localStorage until dereferencing has completed —
  // this avoids saving a source that still contains unresolved $ref URLs.
  useEffect(() => {
    if (skipEnsureResolvedRef.current) {
      skipEnsureResolvedRef.current = false;
      return;
    }
    const requestId = ++ensureResolvedRequestIdRef.current;
    const guardedDispatch: typeof dispatch = (action) => {
      // Drop dispatches from a superseded call so a slow resolution of an old
      // `state.source` can't clobber the resolvedCache of a newer one.
      if (ensureResolvedRequestIdRef.current === requestId) {
        dispatch(action);
      }
    };
    (async () => {
      try {
        await ensureResolved(guardedDispatch, state.source);
      } catch (_) {
        /* ignore error */
      }
    })();
  }, [state.source]);

  // Persist canonical source only after dereferencing completes so saved
  // state does not contain unresolved $ref entries.
  useEffect(() => {
    if (typeof window === 'undefined' || !hasHydratedPersistedState) return;
    try {
      // Only persist when no deref is in progress; this ensures any async
      // fetches have finished and `resolvedCache` is authoritative.
      if (state.derefInProgress) return;
      const schemaKey = getLanguageSchemaKey(markupLanguage);
      const toSave = getPersistableSource(state);
      const nextJson = toSave ? JSON.stringify(toSave) : '';
      const lastJson = lastPersistedSourceJsonRef.current;
      const lastKey = lastPersistedSchemaKeyRef.current;

      if (lastJson === nextJson && lastKey === schemaKey) {
        return;
      }

      if (toSave) {
        localStorage.setItem(schemaKey, nextJson);
      } else {
        localStorage.removeItem(schemaKey);
      }
      lastPersistedSourceJsonRef.current = nextJson;
      lastPersistedSchemaKeyRef.current = schemaKey;
    } catch (err) {
      // ignore
    }
  }, [state.resolvedCache, state.derefInProgress, hasHydratedPersistedState, markupLanguage]);

  // Auto-save instance/markup data to localStorage whenever it changes
  // Saves to language-specific key for current language, and legacy key for backward compatibility
  // Skip auto-save until after hydration to avoid clearing stored data
  useEffect(() => {
    if (typeof window === 'undefined' || !hasHydratedPersistedState) return;
    
    if (jsonInput.trim()) {
      // Save to language-specific key
      localStorage.setItem(getLanguageInstanceKey(markupLanguage), jsonInput);
      
      // Also save to legacy key for backward compatibility (only for JSON)
      if (markupLanguage === 'json' && instanceData !== null) {
        localStorage.setItem(INSTANCE_STORAGE_KEY, JSON.stringify(instanceData));
      }
    } else {
      // Clear storage if input is empty
      localStorage.removeItem(getLanguageInstanceKey(markupLanguage));
      if (markupLanguage === 'json') {
        localStorage.removeItem(INSTANCE_STORAGE_KEY);
      }
    }
  }, [jsonInput, instanceData, markupLanguage, hasHydratedPersistedState]);

  // Sync instanceData to jsonInput for XML language
  // When the form updates instanceData, we need to update the XML Input tab to reflect changes
  useEffect(() => {
    if (markupLanguage !== 'xml' || !instanceData) return;
    
    try {
      // serializeMarkup expects { rootElementName: {...} } structure
      const serializedXml = serializeMarkup(instanceData, 'xml');
      setJsonInput(serializedXml);
    } catch (err) {
      // If serialization fails, it's likely a data structure issue
      console.debug(`XML serialization error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [instanceData, markupLanguage]);

  // Auto-save ERD model to localStorage whenever it changes
  useEffect(() => {
    if (typeof window === 'undefined' || !hasHydratedPersistedState) return;
    
    if (erdModel) {
      try {
        localStorage.setItem(ERD_STORAGE_KEY, JSON.stringify(erdModel));
      } catch (err) {
        console.error('Failed to save ERD model:', err);
      }
    } else {
      try {
        localStorage.removeItem(ERD_STORAGE_KEY);
      } catch (err) {
        console.error('Failed to clear ERD model from storage:', err);
      }
    }
  }, [erdModel, hasHydratedPersistedState]);

  /**
   * Clear all variant storage when loading a fresh JSON document
   * This implements the "version 1" approach: clean slate on new document load
   * Prevents stale variant selections from previous documents
   */
  const clearVariantStorage = () => {
    if (typeof localStorage === 'undefined') return;
    try {
      const keysToRemove: string[] = [];
      // Find all variant storage keys (format: json-instance-variants:v1:*)
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('json-instance-variants:')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
    } catch { /* ignore */ }
  };

  const handleClearLocalStorage = () => {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(getLanguageSchemaKey('xml'));
      localStorage.removeItem(INSTANCE_STORAGE_KEY);
      localStorage.removeItem(DEREF_COMPLETE_STORAGE_KEY);
      localStorage.removeItem(DEREF_ERROR_STORAGE_KEY);
      localStorage.removeItem(LANGUAGE_PREFERENCE_KEY);
      localStorage.removeItem(ACTIVE_TAB_STORAGE_KEY);
      // Also clear language-specific instance keys
      localStorage.removeItem(getLanguageInstanceKey('json'));
      localStorage.removeItem(getLanguageInstanceKey('yaml'));
      localStorage.removeItem(getLanguageInstanceKey('xml'));
      clearVariantStorage();
      applySourceUpdate({ type: 'object', properties: {} });
      setInstanceData(null);
      setJsonInput('{}');
      setMarkupLanguageState('json');
      setError(null);
      toast.success('Local storage cleared');
    } catch {
      toast.error('Failed to clear local storage');
    }
  };

  const handleGenerate = () => {
    setError(null);

    if (!jsonInput.trim()) {
      setError("Please enter JSON data");
      return;
    }

    if (!isValidJSON(jsonInput)) {
      setError("Invalid JSON format. Please check your input.");
      return;
    }

    try {
      const parsed = JSON.parse(jsonInput);
      const generatedSchema = generateSchema(parsed);
      applySourceUpdate(generatedSchema);
      setInstanceData(parsed);
      // Clear variant storage when loading fresh JSON (version 1 approach)
      clearVariantStorage();
    } catch (err) {
      setError("Failed to generate schema. Please check your JSON.");
    }
  };

  const handleCopy = async () => {
    const toSave = getPersistableSource(state);
    if (!toSave) return;

    try {
      await navigator.clipboard.writeText(JSON.stringify(toSave, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy schema:", err);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      try {
        // Detect language from file extension
        let lang: MarkupLanguage = markupLanguage;
        const fileName = file.name.toLowerCase();
        if (fileName.endsWith('.xml') || fileName.endsWith('.xsd')) {
          lang = 'xml';
          setMarkupLanguageState('xml');
          localStorage.setItem(LANGUAGE_PREFERENCE_KEY, 'xml');
        } else if (fileName.endsWith('.yaml') || fileName.endsWith('.yml')) {
          lang = 'yaml';
          setMarkupLanguageState('yaml');
          localStorage.setItem(LANGUAGE_PREFERENCE_KEY, 'yaml');
        } else if (fileName.endsWith('.json')) {
          lang = 'json';
          setMarkupLanguageState('json');
          localStorage.setItem(LANGUAGE_PREFERENCE_KEY, 'json');
        }
        
        const parsed = parseMarkup(content, lang);
        const asJson = JSON.stringify(parsed, null, 2);
        setJsonInput(asJson);
        setInstanceData(parsed);
        clearVariantStorage();
        setError(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to parse file';
        if (msg.toLowerCase().includes('coming soon')) {
          toast.error(msg);
        } else {
          setError(msg);
        }
      }
    };
    reader.onerror = () => {
      setError('Failed to read file');
    };
    reader.readAsText(file);
  };

  const handleLoadFromUrl = async () => {
    if (!jsonUrl.trim()) {
      setError('Please enter a URL');
      return;
    }

    setIsLoadingUrl(true);
    setError(null);

    try {
      const response = await fetch(jsonUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const text = await response.text();
      const parsed = parseMarkup(text, markupLanguage);
      const asJson = JSON.stringify(parsed, null, 2);
      setJsonInput(asJson);
      setInstanceData(parsed);
      clearVariantStorage();
      setJsonUrl('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (msg.toLowerCase().includes('coming soon')) {
        toast.error(msg);
      } else {
        setError(`Failed to load ${markupLabel[markupLanguage]} from URL: ${msg}`);
      }
    } finally {
      setIsLoadingUrl(false);
    }
  };

  const handleSchemaFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const content = e.target?.result as string;
      try {
        // Detect language from file extension
        let lang: MarkupLanguage = 'json';
        const fileName = file.name.toLowerCase();
        if (fileName.endsWith('.xml') || fileName.endsWith('.xsd')) {
          lang = 'xml';
          setMarkupLanguageState('xml');
          localStorage.setItem(LANGUAGE_PREFERENCE_KEY, 'xml');
        } else if (fileName.endsWith('.yaml') || fileName.endsWith('.yml')) {
          lang = 'yaml';
          setMarkupLanguageState('yaml');
          localStorage.setItem(LANGUAGE_PREFERENCE_KEY, 'yaml');
        }
        
        const parsedSchema = parseMarkup(content, lang) as Record<string, unknown>;
        applySourceUpdate(parsedSchema);
        
        // Clear any persisted instance data for this language so the generated instance is used
        try {
          localStorage.removeItem(getLanguageInstanceKey(lang));
          localStorage.removeItem(INSTANCE_STORAGE_KEY);
        } catch (_) {
          // ignore localStorage errors
        }
        
        // Generate and set a default instance for this schema
        const { instanceData, xmlInput } = await generateDefaultInstanceForSchema(parsedSchema, lang, lang === 'xml' ? content : undefined);
        setInstanceData(instanceData);
        if (xmlInput) {
          setJsonInput(xmlInput);
        }
         
        setError(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Invalid schema file';
        setError(`Failed to load schema file: ${msg}`);
      }
    };
    reader.onerror = () => {
      setError("Failed to read schema file");
    };
    reader.readAsText(file);
  };

  const handleLoadSchemaFromUrl = async () => {
    if (!schemaUrl.trim()) {
      setError("Please enter a schema URL");
      return;
    }

    setIsLoadingSchemaUrl(true);
    setError(null);

    try {
      const response = await fetch(schemaUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const text = await response.text();
      
      // Detect language from URL extension
      let lang: MarkupLanguage = 'json';
      if (schemaUrl.endsWith('.xml') || schemaUrl.endsWith('.xsd')) {
        lang = 'xml';
        setMarkupLanguageState('xml');
        localStorage.setItem(LANGUAGE_PREFERENCE_KEY, 'xml');
      } else if (schemaUrl.endsWith('.yaml') || schemaUrl.endsWith('.yml')) {
        lang = 'yaml';
        setMarkupLanguageState('yaml');
        localStorage.setItem(LANGUAGE_PREFERENCE_KEY, 'yaml');
      }
      
      const data = parseMarkup(text, lang) as Record<string, unknown>;
      applySourceUpdate(data);
      
      // Clear any persisted instance data for this language so the generated instance is used
      try {
        localStorage.removeItem(getLanguageInstanceKey(lang));
        localStorage.removeItem(INSTANCE_STORAGE_KEY);
      } catch (_) {
        // ignore localStorage errors
      }
      
      // Generate and set a default instance for this schema
      const { instanceData, xmlInput } = await generateDefaultInstanceForSchema(data, lang, lang === 'xml' ? text : undefined);
      setInstanceData(instanceData);
      if (xmlInput) {
        setJsonInput(xmlInput);
      }
      
      setSchemaUrl("");
    } catch (err) {
      setError(`Failed to load schema from URL: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsLoadingSchemaUrl(false);
    }
  };

  const handleSaveSchema = () => {
    const toSave = getPersistableSource(state);
    if (!toSave) return;

    const blob = new Blob([JSON.stringify(toSave, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'schema.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleFormatXmlInput = () => {
    if (markupLanguage !== 'xml') return;
    if (!jsonInput.trim()) return;

    try {
      const parsed = parseMarkup(jsonInput, 'xml');
      const formatted = serializeMarkup(parsed, 'xml');
      setJsonInput(formatted);
      setInstanceData(parsed);
      setError(null);
      setSchemaDetectionWarning(detectXsdSchema(formatted));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid XML';
      setError(`Cannot format XML: ${msg}`);
    }
  };

  const handleCreateNewSchema = async () => {
    let newSchema: any;

    // Clear the persisted schema for this language first so the old schema can't
    // reappear (e.g. from a stale persist-effect write racing the new source update).
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(getLanguageSchemaKey(markupLanguage));
      }
    } catch (_) {
      /* ignore */
    }

    if (markupLanguage === 'json') {
      // JSON Schema template
      newSchema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        title: 'New Schema',
        description: 'A new JSON schema',
        properties: {
          example: {
            type: 'string',
            description: 'An example property',
          },
        },
        required: [],
      };
    } else if (markupLanguage === 'xml') {
      // XML Schema template (XSD) with default complexType
      newSchema = {
        'xs:schema': {
          '@attributes': {
            xmlns: 'http://www.w3.org/2001/XMLSchema',
            'xmlns:xs': 'http://www.w3.org/2001/XMLSchema',
            targetNamespace: 'http://example.com/schema',
            elementFormDefault: 'qualified',
            attributeFormDefault: 'unqualified',
          },
          'xs:complexType': [
            {
              '@attributes': {
                name: 'PersonType',
              },
              'xs:sequence': {
                '@attributes': {
                  minOccurs: '1',
                  maxOccurs: '1',
                },
              },
            },
          ],
        },
      };
    } else {
      // Default to JSON schema for YAML (should not be reached due to menu hiding)
      newSchema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        title: 'New Schema',
        description: 'A new JSON schema',
        properties: {},
        required: [],
      };
    }
    
    applySourceUpdate(newSchema);
    
    // Clear any persisted instance data for this language so the generated instance is used
    try {
      localStorage.removeItem(getLanguageInstanceKey(markupLanguage));
      localStorage.removeItem(INSTANCE_STORAGE_KEY);
    } catch (_) {
      // ignore localStorage errors
    }
    
    // Generate and set a default instance for the new schema
    if (markupLanguage === 'xml') {
      // For XSD, generate asynchronously via the backend
      const { instanceData, xmlInput } = await generateDefaultInstanceForSchema(newSchema, markupLanguage);
      setInstanceData(instanceData);
      if (xmlInput) {
        setJsonInput(xmlInput);
      }
    } else {
      // For JSON/YAML, generate synchronously
      const defaultInstance = generateDefaultInstance(newSchema);
      setInstanceData(defaultInstance);
    }
    
    setError(null);
  };

  // Detect if content looks like an XSD schema (xml mode only)
  const detectXsdSchema = (content: string): boolean => {
    if (!content || markupLanguage !== 'xml') return false;
    try {
      const trimmed = content.trim();
      // Check for XSD indicators
      return (
        trimmed.includes('xs:schema') ||
        trimmed.includes('xsd:schema') ||
        trimmed.includes('schema xmlns') ||
        (trimmed.startsWith('<') && trimmed.includes('xmlns') && trimmed.includes('XMLSchema'))
      );
    } catch {
      return false;
    }
  };

  const handleSaveResolvedSchema = () => {
    const toSave = getResolvedSource(state);
    if (!toSave) return;

    const blob = new Blob([JSON.stringify(toSave, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'schema-resolved.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleValidateSchema = async () => {
    if (!jsonInput.trim()) {
      toast.error('No schema to validate');
      return;
    }

    // Only validate XSD schemas (XML mode)
    if (markupLanguage !== 'xml') {
      toast.info('Schema validation is available for XSD schemas only');
      return;
    }

    await validateSchema(jsonInput);
  };

  const handleValidateInstanceWithImports = async () => {
    // Check if we have a schema loaded
    if (!state.source) {
      toast.error('No schema loaded');
      return;
    }

    if (!instanceData) {
      toast.warning('No XML instance to validate');
      return;
    }

    // Only validate XML instances against XSD schemas
    if (markupLanguage !== 'xml') {
      toast.info('Instance validation with imports is available for XSD schemas only');
      return;
    }

    // Get the XML instance string from instanceData
    let xmlInstanceStr: string;
    
    if (typeof instanceData === 'string') {
      // instanceData is already a string (raw XML from XML Input tab)
      xmlInstanceStr = instanceData;
    } else {
      // Otherwise serialize the instanceData object to XML
      try {
        xmlInstanceStr = serializeMarkup(instanceData, 'xml');
      } catch (err) {
        toast.error(`Failed to serialize instance: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }

    // Serialize the schema (state.source) to a string for validation
    let schemaStr: string;
    try {
      schemaStr = serializeMarkup(state.source, markupLanguage);
    } catch (err) {
      toast.error(`Failed to serialize schema: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    // Validate the XML instance against the schema
    await validateInstanceWithImports(schemaStr, xmlInstanceStr);
  };

  const handleGenerateDefaultXmlInstance = async (requestedRootElementName?: string) => {
    // Check if we have a schema loaded
    if (!state.source) {
      toast.error('No schema loaded');
      return;
    }

    // Only generate instances for XSD schemas
    if (markupLanguage !== 'xml') {
      toast.error('Default instance generation is available for XSD schemas only');
      return;
    }

    try {
      // Serialize the schema to XML string
      let schemaStr: string;
      try {
        schemaStr = serializeMarkup(state.source, 'xml');
      } catch (err) {
        toast.error(`Failed to serialize schema: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }

      const selectedRootElementName = requestedRootElementName
        || getSelectedXmlRootElementName(instanceData)
        || getAvailableXmlRootElementNames(state.source)[0];
      const result = await generateDefaultInstanceForSchema(
        state.source as Record<string, unknown>,
        'xml',
        schemaStr,
        selectedRootElementName
      );

      if (!result.xmlInput || result.instanceData === null || result.instanceData === undefined) {
        toast.error('Failed to generate instance');
        return;
      }

      // Set both the form model and raw XML input.
      setInstanceData(result.instanceData);
      setJsonInput(result.xmlInput);
      
      toast.success('Default instance generated', { duration: 3000 });
    } catch (err) {
      toast.error(`Error generating instance: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleValidateJsonData = async () => {
    // Check if we have a schema loaded
    if (!state.source) {
      toast.error('No schema loaded');
      return;
    }

    if (!jsonInput.trim()) {
      toast.warning('No JSON data to validate');
      return;
    }

    // Only validate JSON data against JSON schemas
    if (markupLanguage === 'xml') {
      toast.info('JSON validation is available for JSON schemas only');
      return;
    }

    try {
      // Serialize the schema to JSON string
      let schemaStr: string;
      try {
        const resolvedSchema = state.resolvedCache || state.source;
        schemaStr = JSON.stringify(resolvedSchema);
      } catch (err) {
        toast.error(`Failed to serialize schema: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }

      // Validate the JSON data against the schema on the server
      const result = await validateJsonDataAgainstSchema(schemaStr, jsonInput);
      
      // Capture detected draft from validation response
      if (result.detectedDraft) {
        const draft = detectDraftFromBackend(result.detectedDraft);
        setDetectedDraft(draft);
      }
      
      if (result.isValid) {
        toast.success('✅ Valid — JSON data matches schema', { duration: 5000 });
      } else {
        // Show error summary
        const errorCount = result.errors.length;
        let message = `Invalid — ${errorCount} error(s)`;
        
        // Show first error
        if (result.errors.length > 0) {
          const firstError = result.errors[0];
          message += `\n\n${firstError.message}`;
        }

        toast.error(message, { duration: 8000 });

        // If there are multiple errors, show a secondary notification
        if (result.errors.length > 1) {
          const remaining = result.errors.length - 1;
          setTimeout(() => {
            toast.info(`+${remaining} more error(s)`, { duration: 6000 });
          }, 500);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Validation failed: ${message}`, { duration: 8000 });
    }
  };

  const handleMigrateToFromDraft = (draft: SchemaDraft) => {
    console.log('[handleMigrateToFromDraft] Called with draft:', draft, 'detectedDraft:', detectedDraft, 'state.source:', !!state.source);
    
    if (!state.source || !detectedDraft) {
      toast.warning('No schema loaded. Load a schema first to migrate it.');
      return;
    }

    if (detectedDraft === draft) {
      toast.info(`Schema is already in ${draft} format`);
      return;
    }

    console.log('[handleMigrateToFromDraft] Setting targetDraft:', draft, 'and showMigrationDialog: true');
    setTargetDraft(draft);
    setShowMigrationDialog(true);
  };

  const handleConfirmMigration = (migratedSchema: Record<string, unknown>) => {
    try {
      dispatch({
        type: APPLY_SOURCE_UPDATE,
        payload: migratedSchema,
      });
      setDetectedDraft(targetDraft);
      setShowMigrationDialog(false);
      setTargetDraft(null);
      toast.success(`✅ Schema migrated to ${targetDraft}`);
    } catch (err) {
      toast.error(`Migration failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleCancelMigration = () => {
    setShowMigrationDialog(false);
    setTargetDraft(null);
  };


  const handleInferJsonSchema = async () => {
    if (!jsonInput.trim()) {
      toast.error('No JSON data to infer from');
      return;
    }

    // Only infer JSON schemas
    if (markupLanguage === 'xml') {
      toast.info('Schema inference is available for JSON only');
      return;
    }

    try {
      // Infer schema from the JSON data on the server
      const result = await inferJsonSchema(jsonInput);
      
      if (result.warnings && result.warnings.length > 0) {
        result.warnings.forEach(warning => {
          console.warn('[Schema Inference]', warning);
        });
      }

      // Parse the inferred schema
      const inferredSchema = JSON.parse(result.inferredSchema);
      applySourceUpdate(inferredSchema);
      
      toast.success('✅ Schema inferred from JSON data', { duration: 5000 });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to infer schema: ${message}`, { duration: 8000 });
    }
  };

  // Dev helper: load the local copy of the W3C XMLSchema file bundled in public/schemas
  const handleLoadLocalXsd = async () => {
    try {
      setError(null);
      const resp = await fetch('/schemas/XMLSchema.xsd');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      const parsed = parseMarkup(text, 'xml') as Record<string, unknown>;
      applySourceUpdate(parsed);
      
      // Clear any persisted instance data so the generated instance is used
      try {
        localStorage.removeItem(getLanguageInstanceKey('xml'));
        localStorage.removeItem(INSTANCE_STORAGE_KEY);
      } catch (_) {
        // ignore localStorage errors
      }
      
      // Generate and set a default instance for this schema (pass raw XSD text)
      const { instanceData, xmlInput } = await generateDefaultInstanceForSchema(parsed, 'xml', text);
      setInstanceData(instanceData);
      if (xmlInput) {
        setJsonInput(xmlInput);
      }
      
      setMarkupLanguageState('xml');
      localStorage.setItem(LANGUAGE_PREFERENCE_KEY, 'xml');
      toast.success('Loaded local XMLSchema.xsd');
    } catch (err) {
      setError(`Failed to load local XSD: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Dev helper: load a compact demo XSD that exercises form controls
  const handleLoadDemoXsdControls = async () => {
    try {
      setError(null);
      const resp = await fetch('/schemas/xml-form-controls-demo.xsd');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      const parsed = parseMarkup(text, 'xml') as Record<string, unknown>;
      applySourceUpdate(parsed);
      
      // Clear any persisted instance data so the generated instance is used
      try {
        localStorage.removeItem(getLanguageInstanceKey('xml'));
        localStorage.removeItem(INSTANCE_STORAGE_KEY);
      } catch (_) {
        // ignore localStorage errors
      }
      
      // Generate and set a default instance for this schema (pass raw XSD text)
      const { instanceData, xmlInput } = await generateDefaultInstanceForSchema(parsed, 'xml', text);
      setInstanceData(instanceData);
      if (xmlInput) {
        setJsonInput(xmlInput);
      }
      
      setMarkupLanguageState('xml');
      localStorage.setItem(LANGUAGE_PREFERENCE_KEY, 'xml');
      toast.success('Loaded demo controls XSD');
    } catch (err) {
      setError(`Failed to load demo controls XSD: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleSaveMarkup = () => {
    if (!jsonInput.trim()) return;
    try {
      let content: string;
      if (markupLanguage === 'json') {
        content = jsonInput;
      } else {
        const data = JSON.parse(jsonInput);
        content = serializeMarkup(data, markupLanguage);
      }
      const blob = new Blob([content], { type: mimeType(markupLanguage) });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `data${fileExtension(markupLanguage)}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const handleValidate = () => {
    if (!instanceData) {
      toast.warning('No instance data to validate');
      return;
    }
    if (!editorSchema) {
      toast.warning('No schema loaded — generate or load a schema first');
      return;
    }
    try {
      // Dynamic import keeps Ajv out of the initial bundle
      import('ajv').then(({ default: Ajv }) => {
        import('ajv-formats').then(({ default: addFormats }) => {
          const ajv = new Ajv({ allErrors: true });
          addFormats(ajv);
          let valid: boolean;
          try {
            const validate = ajv.compile(editorSchema as object);
            valid = validate(instanceData) as boolean;
            if (valid) {
              toast.success('Valid ✓  — instance matches schema');
            } else {
              const errs = (validate.errors ?? []).slice(0, 3)
                .map(e => `${e.instancePath || '/'} ${e.message}`)
                .join(' · ');
              const more = (validate.errors?.length ?? 0) > 3 ? ' …' : '';
              toast.error(`Invalid — ${errs}${more}`, { duration: 8000 });
            }
          } catch (compileErr) {
            toast.error('Schema compile error: ' + String(compileErr));
          }
        });
      });
    } catch (e) {
      toast.error('Validation failed: ' + String(e));
    }
  };

  // ERD handlers
  const handleErdFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    try {
      const sourceFiles = await Promise.all(files.map(async (file) => ({
        name: file.name,
        content: await file.text(),
      })));
      const parsedModel = parseDbContextFiles(sourceFiles);
      const graph = erdModelToGraph(parsedModel, { useIlpUntangle: true, spacingScale: 1.3, minVerticalGap: 84 });
      setErdModel({
        ...parsedModel,
        nodePositions: Object.fromEntries(graph.nodes.map((node) => [node.id, node.position])),
      });
      setActiveTab('erd');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? `Failed to read C# files: ${err.message}` : 'Failed to read C# files');
    } finally {
      event.target.value = '';
    }
  };

  const handleExportErd = () => {
    if (!erdModel) return;
    const blob = new Blob([generateDbContextCSharp(erdModel)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'generated-erd.cs';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleExportSql = () => {
    if (!erdModel) return;
    const blob = new Blob([generateErdSql(erdModel)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'generated-schema.sql';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleNewErd = () => {
    setErdModel({
      tables: [],
      relationships: [],
      sourceFiles: [],
      diagnostics: [],
    });
    setActiveTab('erd');
  };

  // Tabbed UI state
  const [activeTab, setActiveTab] = useState<'json' | 'xmlschema' | 'schema' | 'instance' | 'output' | 'graph' | 'erd'>('json');
  const [hasHydratedActiveTab, setHasHydratedActiveTab] = useState(false);

  // Restore last active tab from localStorage - deferred to avoid sync storage access during render
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const timer = window.setTimeout(() => {
      try {
        const savedTab = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
        if (savedTab && ['json', 'xmlschema', 'schema', 'instance', 'output', 'graph', 'erd'].includes(savedTab)) {
          setActiveTab(savedTab as typeof activeTab);
        }
      } catch (_) {
        // ignore localStorage errors
      } finally {
        setHasHydratedActiveTab(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Persist active tab whenever it changes, once the saved tab has been restored
  useEffect(() => {
    if (typeof window === 'undefined' || !hasHydratedActiveTab) return;
    try {
      window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab);
    } catch (_) {
      // ignore localStorage errors
    }
  }, [activeTab, hasHydratedActiveTab]);

  // Debug: record tab changes and resolved/source swap events for E2E/manual debugging
  useEffect(() => {
    try {
      const w = window as any;
      if (!w.__tabDebug) w.__tabDebug = [];
      w.__tabDebug.push({ type: 'init', activeTab, timestamp: Date.now() });
    } catch (e) {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      const w = window as any;
      if (!w.__tabDebug) w.__tabDebug = [];
      w.__tabDebug.push({ type: 'tab-change', activeTab, timestamp: Date.now() });
    } catch (e) {
      /* ignore */
    }
  }, [activeTab]);

  useEffect(() => {
    try {
      const w = window as any;
      if (!w.__tabDebug) w.__tabDebug = [];
      const entry = { type: 'schema-load', used: state.resolvedCache ? 'resolved' : state.source ? 'source' : 'none', timestamp: Date.now(), hasSource: !!state.source, hasResolved: !!state.resolvedCache };
      w.__tabDebug.push(entry);
      try { w.__lastSchemaLoad = { ...entry, resolvedCache: state.resolvedCache || null, source: state.source || null }; } catch (_) {
        /* ignore */
      }
    } catch (e) {
      /* ignore */
    }
  }, [state.resolvedCache, state.source]);

  // Compute editor schema synchronously and memoize it so expensive
  // normalization does not block UI interactions on repeated renders.
  const editorSchema = useMemo(() => {
    if (!state.resolvedCache) return null;
    return getEditorSchema(state) as Record<string, unknown> | null;
  }, [state.resolvedCache]);

  // Helper: determine whether a schema node should be treated as imported.
  // Rely on the reducer-attached `__from` provenance marker or inspection of the rehydrated source.
  const isSchemaImported = (schemaNode: Record<string, unknown> | null | undefined, path?: string[]): boolean => {
    try {
      if (!schemaNode || typeof schemaNode !== 'object') return false;

      // 1. Direct inspection of the node provided (e.g. from local editor state)
      if ((schemaNode as any).__from) return true;
      if (typeof (schemaNode as any).$ref === 'string') return true;
      if (Array.isArray((schemaNode as any).allOf) && (schemaNode as any).allOf.some((e: any) => e && (e.$ref || e.__from))) return true;

      // 2. Fallback: Check the rehydrated editor schema using the provided path
      // This helps identify array items that might not have provenance on the leaf node itself
      if (path && editorSchema) {
        let node: any = editorSchema;
        for (const p of path) {
          if (!node || typeof node !== 'object') break;
          // Standard navigation: properties or direct access for logic branches/items
          if (node.properties && node.properties[p]) node = node.properties[p];
          else if (node.type === 'array' && p === 'items' && node.items) node = node.items;
          else if (node.items && node.items.properties && node.items.properties[p]) node = node.items.properties[p];
          else node = node[p];
        }
        if (node && typeof node === 'object') {
          if (node.__from || node.$ref) return true;
          if (Array.isArray(node.allOf) && node.allOf.some((e: any) => e && (e.$ref || e.__from))) return true;
        }
      }

      return false;
    } catch (_) {
      return false;
    }
  };

  // Log the actual schema being provided to editors for debugging/testing.
  // (editor debug snapshot removed)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!editorSchema) return;
    try {
      // eslint-disable-next-line no-console
      console.info('[Workbench] Schema passed to editors:', editorSchema);
    } catch (_) {
      /* ignore */
    }
  }, [editorSchema]);

  const availableXmlRootElementNames = useMemo(() => {
    if (markupLanguage !== 'xml') return [];
    return getAvailableXmlRootElementNames(state.source);
  }, [markupLanguage, state.source]);

  return (
    <TooltipProvider>
    <div className={styles.container}>
      {/* Hidden file inputs — top-level so menu items can trigger them from any active tab */}
      <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept={acceptAttr(markupLanguage)} style={{ display: 'none' }} />
      <input type="file" ref={schemaFileInputRef} onChange={handleSchemaFileUpload} accept=".json,.xml,.xsd,.yaml,.yml,application/json,application/xml" style={{ display: 'none' }} />
      <input type="file" ref={erdFileInputRef} onChange={handleErdFileUpload} accept=".cs,text/plain" multiple style={{ display: 'none' }} />

      {/* ── App menu bar ────────────────────────────────────────────── */}
      <div className={styles.menuBar}>
        <span className={styles.menuLogo}>Schema Sculptor</span>
        
        {/* Language selector as toggle group */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 24 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: '#666' }}>{t('workbench.language')}:</span>
          <ToggleGroup
            type="single"
            value={markupLanguage}
            onValueChange={(value) => {
              if (value) handleLanguageChange(value as MarkupLanguage);
            }}
            style={{ display: 'flex', gap: 2 }}
          >
            <ToggleGroupItem value="json" title="JSON format" style={{ padding: '4px 12px', fontSize: 12 }}>
              JSON
            </ToggleGroupItem>
            <ToggleGroupItem value="yaml" title="YAML format" style={{ padding: '4px 12px', fontSize: 12 }}>
              YAML
            </ToggleGroupItem>
            <ToggleGroupItem value="xml" title="XML format" style={{ padding: '4px 12px', fontSize: 12 }}>
              XML
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        
        <Menubar loop>
          {/* Markup document operations — label tracks selected language */}
          <MenubarMenu>
            <MenubarTrigger>{t('workbench.markupMenu', { language: markupLabel[markupLanguage] })}</MenubarTrigger>
            <MenubarContent>
              <MenubarItem onSelect={() => fileInputRef.current?.click()}>
                <FileUp size={14} style={{ marginRight: 6 }} />
                Open {markupLabel[markupLanguage]} file&hellip;
              </MenubarItem>
              <MenubarItem onSelect={handleSaveMarkup} disabled={!jsonInput.trim()}>
                <Download size={14} style={{ marginRight: 6 }} />
                Save {markupLabel[markupLanguage]}
              </MenubarItem>
              <MenubarItem onSelect={() => setShowMarkupUrlDialog(true)}>
                <LinkIcon size={14} style={{ marginRight: 6 }} />
                Load from URL&hellip;
              </MenubarItem>
              <MenubarSeparator />
              <MenubarItem onSelect={handleGenerate}>
                <Sparkles size={14} style={{ marginRight: 6 }} />
                Generate Schema from {markupLabel[markupLanguage]}
              </MenubarItem>
              <MenubarSeparator />
              <MenubarItem onSelect={handleValidate} disabled={!editorSchema}>
                <ShieldCheck size={14} style={{ marginRight: 6 }} />
                Validate against Schema
              </MenubarItem>
              
              {markupLanguage === 'xml' && (
                availableXmlRootElementNames.length > 0 ? (
                  <MenubarSub>
                    <MenubarSubTrigger>
                      <Sparkles size={14} style={{ marginRight: 6 }} />
                      Generate Default Instance
                    </MenubarSubTrigger>
                    <MenubarSubContent>
                      {availableXmlRootElementNames.map((rootName) => (
                        <MenubarItem key={`default-instance-root-${rootName}`} onSelect={() => handleGenerateDefaultXmlInstance(rootName)}>
                          {rootName}
                        </MenubarItem>
                      ))}
                    </MenubarSubContent>
                  </MenubarSub>
                ) : (
                  <MenubarItem onSelect={() => handleGenerateDefaultXmlInstance()} disabled={!state.source}>
                    <Sparkles size={14} style={{ marginRight: 6 }} />
                    Generate Default Instance
                  </MenubarItem>
                )
              )}
            </MenubarContent>
          </MenubarMenu>

          {/* Schema operations - hidden for YAML since it uses JSON schema */}
          {markupLanguage !== 'yaml' && (
            <MenubarMenu>
              <MenubarTrigger>{t('workbench.schemaMenu')}</MenubarTrigger>
              <MenubarContent>
                <MenubarItem onSelect={() => schemaFileInputRef.current?.click()}>
                  <FileUp size={14} style={{ marginRight: 6 }} />
                  Open Schema&hellip;
                </MenubarItem>
                <MenubarItem onSelect={handleCreateNewSchema}>
                  <Sparkles size={14} style={{ marginRight: 6 }} />
                  New {markupLabel[markupLanguage === 'xml' ? 'xml' : 'json']} Schema
                </MenubarItem>
              <MenubarSeparator />
              <MenubarItem onSelect={handleSaveSchema} disabled={!state.source}>
                <Download size={14} style={{ marginRight: 6 }} />
                Save Schema
              </MenubarItem>
              <MenubarItem onSelect={handleSaveResolvedSchema} disabled={!state.resolvedCache}>
                <Sparkles size={14} style={{ marginRight: 6 }} />
                Save Intermediate
              </MenubarItem>
              <MenubarItem onSelect={() => setShowSchemaUrlDialog(true)}>
                <LinkIcon size={14} style={{ marginRight: 6 }} />
                Load from URL&hellip;
              </MenubarItem>
              <MenubarSeparator />
              <MenubarItem onSelect={handleValidateSchema} disabled={!jsonInput.trim()}>
                <ShieldCheck size={14} style={{ marginRight: 6 }} />
                Validate Schema
              </MenubarItem>
              
              {markupLanguage === 'xml' && (
                <MenubarItem onSelect={handleValidateInstanceWithImports} disabled={!state.source || !instanceData}>
                  <ShieldCheck size={14} style={{ marginRight: 6 }} />
                  Validate Instance (with Imports)
                </MenubarItem>
              )}
              
              {markupLanguage !== 'xml' && (
                <>
                  <MenubarItem onSelect={handleValidateJsonData} disabled={!state.source || !jsonInput.trim()}>
                    <ShieldCheck size={14} style={{ marginRight: 6 }} />
                    Validate JSON Data
                  </MenubarItem>
                  <MenubarItem onSelect={handleInferJsonSchema} disabled={!jsonInput.trim()}>
                    <Sparkles size={14} style={{ marginRight: 6 }} />
                    Infer Schema from Data
                  </MenubarItem>
                  
                  {/* Change Draft submenu for JSON/YAML schemas */}
                  <MenubarSeparator />
                  <MenubarSub>
                    <MenubarSubTrigger>
                      Change Draft
                      {detectedDraft && <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">{detectedDraft}</span>}
                    </MenubarSubTrigger>
                    <MenubarSubContent>
                      {DRAFT_PROGRESSION.map((draft) => (
                        <MenubarItem
                          key={draft}
                          onSelect={() => handleMigrateToFromDraft(draft)}
                          disabled={!state.source || !detectedDraft}
                          className="flex items-center justify-between"
                        >
                          <span>{draft}</span>
                          {detectedDraft === draft && <Check size={14} style={{ marginLeft: 8 }} />}
                        </MenubarItem>
                      ))}
                    </MenubarSubContent>
                  </MenubarSub>
                </>
              )}
              
              <MenubarSeparator />
              <MenubarItem onSelect={handleCopy} disabled={!state.source}>
                {copied
                  ? <><Check size={14} style={{ marginRight: 6 }} /> Copied!</>
                  : <><Copy size={14} style={{ marginRight: 6 }} /> Copy to Clipboard</>}
              </MenubarItem>
              {showDevStorageTools && (
                <>
                  <MenubarSeparator />
                  <MenubarItem onSelect={handleClearLocalStorage}>
                    <X size={14} style={{ marginRight: 6 }} />
                    Clear local storage (dev)
                  </MenubarItem>
                </>
              )}
              </MenubarContent>
            </MenubarMenu>
          )}

          {/* Entity Relationship Diagram operations */}
          <MenubarMenu>
            <MenubarTrigger>ERD</MenubarTrigger>
            <MenubarContent>
              <MenubarItem onSelect={handleNewErd}>
                <FileUp size={14} style={{ marginRight: 6 }} />
                New Entity Diagram
              </MenubarItem>
              <MenubarItem onSelect={() => erdFileInputRef.current?.click()}>
                <FileUp size={14} style={{ marginRight: 6 }} />
                Open DbContext files&hellip;
              </MenubarItem>
              <MenubarSeparator />
              <MenubarItem onSelect={handleExportErd} disabled={!erdModel}>
                <Download size={14} style={{ marginRight: 6 }} />
                Export C#
              </MenubarItem>
              <MenubarItem onSelect={handleExportSql} disabled={!erdModel}>
                <Download size={14} style={{ marginRight: 6 }} />
                Export SQL
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>

          {/* About */}
          <MenubarMenu>
            <MenubarTrigger>About</MenubarTrigger>
            <MenubarContent>
              <MenubarLabel>{t('workbench.aboutTitle')}</MenubarLabel>
              <MenubarLabel style={{ fontWeight: 'normal', fontSize: 11, color: 'var(--color-neutral-10)' }}>
                {t('workbench.aboutSubtitle')}
              </MenubarLabel>
              <MenubarSeparator />
              <MenubarLabel style={{ fontWeight: 'normal', fontSize: 11, maxWidth: 220, whiteSpace: 'normal', lineHeight: 1.4, color: 'var(--color-neutral-9)', padding: '4px 8px' }}>
                {t('workbench.aboutDescription')}
              </MenubarLabel>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto', marginRight: 12 }}>
          <DraftIndicator detectedDraft={detectedDraft} />
          <small className={styles.menuStatusBadge} suppressHydrationWarning data-testid="schema-source-badge">
            Source: {state.resolvedCache ? 'resolved' : state.source ? 'source' : 'none'}
          </small>
        </div>
      </div>

      {/* ── URL load dialog — markup document ───────────────────────── */}
      <Dialog open={showMarkupUrlDialog} onOpenChange={setShowMarkupUrlDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Load {markupLabel[markupLanguage]} from URL</DialogTitle>
          </DialogHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0' }}>
            <input
              type="url"
              className={styles.urlInput}
              value={jsonUrl}
              onChange={(e) => setJsonUrl(e.target.value)}
              placeholder={`Enter ${markupLabel[markupLanguage]} URL\u2026`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && jsonUrl.trim()) {
                  handleLoadFromUrl();
                  setShowMarkupUrlDialog(false);
                }
              }}
              autoFocus
            />
            {error && <div className={styles.errorMessage}>{error}</div>}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <button className={styles.controlButton}>Cancel</button>
            </DialogClose>
            <button
              className={styles.generateButton}
              onClick={() => { handleLoadFromUrl(); setShowMarkupUrlDialog(false); }}
              disabled={isLoadingUrl || !jsonUrl.trim()}
              style={{ padding: '8px 16px', fontSize: 13 }}
            >
              {isLoadingUrl ? 'Loading\u2026' : 'Load'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── URL load dialog — schema ─────────────────────────────────── */}
      <Dialog open={showSchemaUrlDialog} onOpenChange={setShowSchemaUrlDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Load Schema from URL</DialogTitle>
          </DialogHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0' }}>
            <input
              type="url"
              className={styles.urlInput}
              value={schemaUrl}
              onChange={(e) => setSchemaUrl(e.target.value)}
              placeholder="Enter schema URL\u2026"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && schemaUrl.trim()) {
                  handleLoadSchemaFromUrl();
                  setShowSchemaUrlDialog(false);
                }
              }}
              autoFocus
            />
            {error && <div className={styles.errorMessage}>{error}</div>}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <button className={styles.controlButton}>Cancel</button>
            </DialogClose>
            <button
              className={styles.generateButton}
              onClick={() => { handleLoadSchemaFromUrl(); setShowSchemaUrlDialog(false); }}
              disabled={isLoadingSchemaUrl || !schemaUrl.trim()}
              style={{ padding: '8px 16px', fontSize: 13 }}
            >
              {isLoadingSchemaUrl ? 'Loading\u2026' : 'Load'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className={styles.tabs}>
        <button className={activeTab === 'json' ? styles.activeTab : styles.tab} onClick={() => setActiveTab('json')}>{markupLabel[markupLanguage]} Input</button>
        <button className={activeTab === 'instance' ? styles.activeTab : styles.tab} onClick={() => setActiveTab('instance')}>Instance Form</button>
        <button className={activeTab === 'xmlschema' ? styles.activeTab : styles.tab} onClick={() => setActiveTab('xmlschema')}>Schema Input</button>
        <button className={activeTab === 'schema' ? styles.activeTab : styles.tab} onClick={() => setActiveTab('schema')}>Schema Form</button>
        <button className={activeTab === 'graph' ? styles.activeTab : styles.tab} onClick={() => setActiveTab('graph')}>Schema Graph</button>
        <button className={activeTab === 'erd' ? styles.activeTab : styles.tab} onClick={() => setActiveTab('erd')}>Entity Graph</button>
      </div>

      <div className={`${styles.tabPanel}${activeTab === 'graph' ? ` ${styles.tabPanelFlush}` : ''}${activeTab === 'erd' ? ` ${styles.tabPanelFlush}` : ''}`}>
        {activeTab === 'graph' && (
          <>
            {editorSchema ? (
              <GraphicalSchemaEditor
                key={schemaGeneration}
                schema={editorSchema as any}
                schemaLanguage={markupLanguage}
                onChange={(newSchema) => {
                  // Editor emits edits to the resolved view; reducer will rehydrate into source
                  applyResolvedEdit(newSchema);
                  setInstanceData((prev: unknown) => prev == null ? generateDefaultInstance(newSchema) : prev);
                }}
              />
            ) : state.source ? (
              <div className={styles.emptyState}>Resolving schema&hellip;</div>
            ) : (
              <div className={styles.emptyState}>Load or generate a schema to begin editing</div>
            )}
          </>
        )}
        {activeTab === 'xmlschema' && (
          <>
            <div className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2 className={styles.panelTitle}>Schema Input</h2>
              </div>
              <div className={styles.editorContainer}>
                {state.source ? (
                  <SchemaSourceEditor
                    schema={state.source as any}
                    onChange={(newSchema) => {
                      applySourceUpdate(newSchema);
                    }}
                    schemaLanguage={markupLanguage === 'yaml' ? 'json' : markupLanguage}
                  />
                ) : (
                  <div className={styles.emptyState}>Load or generate a schema to begin editing</div>
                )}
              </div>
            </div>
          </>
        )}
        {activeTab === 'schema' && (
          <>
            <div className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2 className={styles.panelTitle}>Schema Form</h2>
                {markupLanguage === 'xml' ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className={styles.controlButton} onClick={handleLoadDemoXsdControls}>Load demo controls XSD</button>
                    <button className={styles.controlButton} onClick={handleLoadLocalXsd}>Load local XMLSchema.xsd</button>
                  </div>
                ) : null}
              </div>
              <div className={styles.editorContainer}>
                {markupLanguage === 'xml' ? (
                  // XML: Use XmlInstanceForm to render the XSD schema itself as an instance
                  state.source ? (
                    <XmlInstanceForm
                      schema={state.source as any}
                      value={state.source as any}
                      onChange={(newSchema) => {
                        applySourceUpdate(newSchema);
                      }}
                      rootSchema={state.source as any}
                      autoExpandAll={true}
                      showRootElementTriggers={false}
                      expansionStateKey="xml-schema-form-expanded"
                    />
                  ) : (
                    <div className={styles.emptyState}>
                      <div>Load or generate an XSD schema to begin editing</div>
                      <div style={{ fontSize: 12, marginTop: 16, maxWidth: 400 }}>
                        Tip: Use <strong>Schema menu → Load from URL</strong> or <strong>Open Schema File</strong> to load an XSD.
                      </div>
                      <div style={{ marginTop: 12 }}>
                        <button className={styles.controlButton} onClick={handleLoadDemoXsdControls} style={{ marginRight: 8 }}>Load demo controls XSD</button>
                        <button className={styles.controlButton} onClick={handleLoadLocalXsd}>Load local XMLSchema.xsd</button>
                      </div>
                    </div>
                  )
                ) : (
                  // JSON/YAML: Use SchemaEditorForm
                  editorSchema ? (
                    <SchemaEditorForm
                      schema={editorSchema as any}
                      onChange={(newSchema) => {
                        // Editor edits resolved view; reducer will rehydrate and update source
                        applyResolvedEdit(newSchema);
                      }}
                      isSchemaImported={isSchemaImported}
                      instanceData={instanceData}
                      onViewSource={() => setShowSchemaSource(true)}
                      rootSchema={state.resolvedCache as any}
                      onResolve={async (path) => {
                        // Dynamically resolve a sub-path of the schema
                        let node: any = state.resolvedCache;
                        if (!node) return;

                        // Navigate to the target node in the resolved schema to get the $ref
                        for (const p of path) {
                          // Smart navigation: skip 'properties' if current node is a flat map (defs root)
                          if (p === 'properties' && !node.properties && !node.type && !node.$ref && Object.keys(node).length > 0) {
                            continue;
                          }

                          if (node.properties && node.properties[p]) {
                            node = node.properties[p];
                          } else if (node.items) {
                            node = node.items;
                          } else {
                            node = node[p];
                          }
                          if (!node) break;
                        }

                        if (node && (node.$ref || (node.allOf && node.allOf.some((e: any) => e.$ref)))) {
                          const targetRef = node.$ref || (Array.isArray(node.allOf) && node.allOf.find((e: any) => e.$ref)?.$ref);
                          const nodeKey = JSON.stringify(node);

                          try {
                            let resolved: any = null;
                            if (resolutionCache.current.has(nodeKey)) {
                              resolved = resolutionCache.current.get(nodeKey);
                            } else {
                              // If node has local ref but no definitions, we might need to attach them
                              // from the root source so the resolver can perform standard dereference.
                              let toResolve = node;
                              const targetRef = node.$ref || (Array.isArray(node.allOf) && node.allOf.find((e: any) => e.$ref)?.$ref);
                              if (targetRef && targetRef.startsWith('#') && state.source && typeof state.source === 'object') {
                                const src = state.source as any;
                                const defs = src.$defs || src.definitions;
                                if (defs) {
                                  toResolve = { ...node, [src.$defs ? '$defs' : 'definitions']: defs };
                                }
                              }
                              resolved = await resolveSchema(toResolve);
                              if (resolved) resolutionCache.current.set(nodeKey, resolved);
                            }

                            if (resolved) {
                              // If this node represents a shared reference (targetRef), find ALL other 
                              // occurrences in the tree and update them in one batch. 
                              // This ensures "load once, resolve everywhere" behavior.
                              if (targetRef) {
                                const updates: { path: string[]; schema: any }[] = [];
                                const scanTree = (curr: any, currPath: string[]) => {
                                  if (!curr || typeof curr !== 'object') return;
                                  const r = curr.$ref || (Array.isArray(curr.allOf) && curr.allOf.find((e: any) => e.$ref)?.$ref);
                                  if (r === targetRef) {
                                    updates.push({ path: currPath, schema: resolved });
                                  }
                                  if (curr.properties) {
                                    for (const k of Object.keys(curr.properties)) {
                                      scanTree(curr.properties[k], [...currPath, 'properties', k]);
                                    }
                                  }
                                  if (curr.patternProperties) {
                                    for (const k of Object.keys(curr.patternProperties)) {
                                      scanTree(curr.patternProperties[k], [...currPath, 'patternProperties', k]);
                                    }
                                  }
                                  if (curr.items) scanTree(curr.items, [...currPath, 'items']);
                                  if (Array.isArray(curr.oneOf)) curr.oneOf.forEach((v: any, i: number) => scanTree(v, [...currPath, 'oneOf', String(i)]));
                                  if (Array.isArray(curr.anyOf)) curr.anyOf.forEach((v: any, i: number) => scanTree(v, [...currPath, 'anyOf', String(i)]));
                                  if (Array.isArray(curr.allOf)) curr.allOf.forEach((v: any, i: number) => scanTree(v, [...currPath, 'allOf', String(i)]));
                                };

                                scanTree(state.resolvedCache, []);
                                if (updates.length > 0) {
                                  dispatch({ type: MERGE_RESOLVED_ALL_PATHS, payload: updates });
                                  return;
                                }
                              }
                              dispatch({ type: MERGE_RESOLVED_PATH, payload: { path, schema: resolved } });
                            }
                          } catch (e) {
                            console.error("Failed to resolve path:", path, e);
                          }
                        }
                      }}
                      onPropertyRename={(oldName, newName, path = []) => {
                        if (!instanceData) return;
                        if (path.length > 0) {
                          // Nested: traverse path in instanceData
                          let obj: any = instanceData;
                          let parent: any = null;
                          let key: string | null = null;
                          for (let i = 0; i < path.length; i++) {
                            parent = obj;
                            key = path[i];
                            obj = obj?.[key];
                          }
                          if (parent && key && typeof obj !== 'undefined') {
                            parent[newName] = obj;
                            delete parent[oldName];
                            setInstanceData({ ...instanceData });
                          }
                        } else {
                          setInstanceData((prev: any) => {
                            if (!prev) return prev;
                            return renamePropertyInObject(prev, oldName, newName);
                          });
                        }
                      }}
                    />
                  ) : state.source ? (
                    <div className={styles.emptyState}>Resolving schema&hellip;</div>
                  ) : (
                    <div className={styles.emptyState}>Load or generate a schema to begin editing</div>
                  )
                )}
              </div>
            </div>
          </>
        )}
        {/* End of schema and graph panels, now start JSON panel */}
        {activeTab === 'json' && (
          <>
            <div className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2 className={styles.panelTitle}>{markupLabel[markupLanguage]} Input</h2>
              </div>
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8, height: '100%', minHeight: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <label style={{ fontSize: 13, color: '#666' }}>
                    View:
                  </label>
                  <button className={styles.controlButton} onClick={() => setCompactJsonView(false)} disabled={compactJsonView}>Full</button>
                  <button className={styles.controlButton} onClick={() => setCompactJsonView(true)} disabled={!compactJsonView}>Compact</button>
                  {markupLanguage === 'xml' && (
                    <button className={styles.controlButton} onClick={handleFormatXmlInput} title="Format XML">
                      Format XML
                    </button>
                  )}
                </div>
                {compactJsonView ? (
                  <div className={`${styles.jsonInput} ${error ? styles.error : ""}`} style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', padding: 12, borderRadius: 6, width: '100%', height: '100%', minHeight: 240, boxSizing: 'border-box', overflow: 'auto', color: 'inherit' }}>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'inherit' }}>{buildCompactJson(jsonInput)}</pre>
                    <div style={{ marginTop: 8 }}>
                      <button className={styles.controlButton} onClick={() => setCompactJsonView(false)}>Edit full JSON</button>
                    </div>
                  </div>
                ) : (
                  markupLanguage === 'xml' ? (
                    <div style={{ flex: 1, minHeight: 0, height: '100%' }}>
                      <SchemaSourceEditor
                        schema={null}
                        onChange={() => {
                          // no-op: XML Input edits are driven by raw text + parsed instance callbacks
                        }}
                        schemaLanguage="xml"
                        textValue={jsonInput}
                        onTextChange={(newText) => {
                          setJsonInput(newText);
                          setError(null);
                          setSchemaDetectionWarning(detectXsdSchema(newText));
                        }}
                        onParsedChange={(parsed) => {
                          setInstanceData(parsed);
                        }}
                        placeholder={`Paste your ${markupLabel[markupLanguage]} here...`}
                        theme="instance"
                      />
                    </div>
                  ) : (
                    <textarea
                      key={markupLanguage}
                      className={`${styles.jsonInput} ${error ? styles.error : ""}`}
                      value={jsonInput}
                      onChange={(e) => {
                        setJsonInput(e.target.value);
                        setError(null);
                        // Check if user is pasting an XSD schema into the instance input
                        if (detectXsdSchema(e.target.value)) {
                          setSchemaDetectionWarning(true);
                        } else {
                          setSchemaDetectionWarning(false);
                        }
                        // Try to parse and update instance form if valid
                        try {
                          const parsed = parseMarkup(e.target.value, markupLanguage);
                          setInstanceData(parsed);
                        } catch {
                          // ignore invalid
                        }
                      }}
                      placeholder={`Paste your ${markupLabel[markupLanguage]} here...`}
                      spellCheck={false}
                      style={{ width: '100%', height: '100%', minHeight: 240, boxSizing: 'border-box' }}
                    />
                  )
                )}
              </div>
              {error && <div className={styles.errorMessage}>{error}</div>}
              {schemaDetectionWarning && !error && (
                <div style={{
                  marginTop: 12,
                  padding: '12px',
                  backgroundColor: '#fff3cd',
                  border: '1px solid #ffc107',
                  borderRadius: 6,
                  color: '#856404',
                  fontSize: 13,
                  lineHeight: 1.5
                }}>
                  <strong>⚠️ Schema Detected:</strong> This field is for XML instance data only. To load a schema, use the <strong>Schema</strong> menu at the top and select <strong>"Load from URL..."</strong> or <strong>"Open Schema File..."</strong>.
                </div>
              )}
            </div>
          </>
        )}
        {activeTab === 'instance' && (
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>Instance Form</h2>
            </div>
            {markupLanguage === 'xml' ? (
              // XML Instance Form - render raw XML documents
              state.source && instanceData ? (
                <div className={styles.editorContainer}>
                  <XmlInstanceForm
                    schema={state.source as any}
                    value={instanceData}
                    onChange={(newData) => {
                      setInstanceData(newData);
                    }}
                    rootSchema={state.source as any}
                    expansionStateKey="xml-instance-form-expanded"
                  />
                </div>
              ) : !state.source ? (
                <div className={styles.emptyState}>Load an XML schema to edit instance data</div>
              ) : (
                <div className={styles.emptyState}>Paste XML instance data in the "XML Input" tab to view and edit it here</div>
              )
            ) : (
              // JSON/YAML Instance Form
              editorSchema ? (
                <div className={styles.editorContainer}>
                  <JsonInstanceForm
                    schema={editorSchema as any}
                    value={instanceData ?? generateDefaultInstance(editorSchema)}
                    onChange={(newData) => {
                      setInstanceData(newData);
                      setJsonInput(JSON.stringify(newData, null, 2));
                    }}
                  />
                </div>
              ) : state.source ? (
                <div className={styles.emptyState}>Resolving schema&hellip;</div>
              ) : (
                <div className={styles.emptyState}>Generate a schema to edit instance data</div>
              )
            )}
          </div>
        )}
        {activeTab === 'output' && (
          <div className={`${styles.panel} ${styles.schemaOutputPanel} ${showSchemaSource ? styles.visible : ""}`}> 
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>Schema Output</h2>
              <div className={styles.headerActions}>
                {state.source && (
                  <>
                    <div className={styles.saveButtonRow}>
                      <button className={styles.actionButton} onClick={handleSaveSchema} title="Save schema">
                        <Download size={16} />
                        Save
                      </button>
                      <button className={styles.actionButton} onClick={handleSaveResolvedSchema} title="Save intermediate hydrated schema (dereferenced)">
                        <Sparkles size={16} />
                        Save Intermediate
                      </button>
                    </div>
                    <button className={`${styles.actionButton} ${copied ? styles.copied : ""}`} onClick={handleCopy}>
                      {copied ? (
                        <>
                          <Check size={16} />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy size={16} />
                          Copy
                        </>
                      )}
                    </button>
                  </>
                )}
                <button 
                  className={styles.closeButton} 
                  onClick={() => setShowSchemaSource(false)}
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
                {state.source ? (
              <pre className={styles.schemaOutput}>{JSON.stringify(state.source, null, 2)}</pre>
            ) : (
              <div className={styles.emptyState}>Your generated schema will appear here</div>
            )}
          </div>
        )}
        {activeTab === 'erd' && (
          erdModel ? (
            <ErdEditor
              model={erdModel}
              onChange={setErdModel}
            />
          ) : (
            <div className={styles.emptyState}>Open one or more DbContext C# files to create an ERD.</div>
          )
        )}
      </div>
      
      {/* Draft Migration Dialog */}
      {detectedDraft && (
        <DraftMigrationDialog
          open={showMigrationDialog && !!targetDraft}
          sourceDraft={detectedDraft}
          targetDraft={targetDraft || detectedDraft}
          schema={state.source || {}}
          onConfirm={handleConfirmMigration}
          onCancel={handleCancelMigration}
        />
      )}
    </div>
    </TooltipProvider>
  );
}

