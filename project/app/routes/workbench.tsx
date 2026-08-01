import { useState, useRef, useEffect, useReducer } from "react";
import useAsyncMemo from "~/hooks/useAsyncMemo";
import { Sparkles, Copy, Check, X, Link as LinkIcon, Download, FileUp, ShieldCheck } from "lucide-react";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { toast } from "sonner";
import { type MarkupLanguage, parseMarkup, serializeMarkup, fileExtension, mimeType, acceptAttr, markupLabel } from "~/utils/markup";
import {
  Menubar, MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem,
  MenubarSeparator, MenubarLabel,
} from "~/components/ui/menubar/menubar";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group/toggle-group";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "~/components/ui/dialog/dialog";
import styles from "./workbench.module.css";
import { generateSchema, isValidJSON } from "~/utils/schema-generator";
import schemaReducer, { initialSchemaState, APPLY_SOURCE_UPDATE, APPLY_RESOLVED_EDIT, MERGE_RESOLVED_PATH, MERGE_RESOLVED_ALL_PATHS, ensureResolved, getPersistableSource, getEditorSchema, getResolvedSource } from "~/state/schemaReducer";
import { resolveSchema } from "~/utils/schema-resolver";

// Utility to rename a property in an object (shallow)
function renamePropertyInObject(obj: any, oldName: string, newName: string) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  if (!(oldName in obj)) return obj;
  const newObj = { ...obj };
  newObj[newName] = newObj[oldName];
  delete newObj[oldName];
  return newObj;
}

import { JsonInstanceForm } from "~/components/json-instance-form";
import { SchemaEditorForm } from "~/components/schema-editor-form";
import { GraphicalSchemaEditor } from "~/components/graphical-schema-editor";
import { ErdEditor } from "~/components/erd-editor";
import type { ErdModel } from "~/types/erd";
import { parseDbContextFiles } from "~/utils/csharp-dbcontext-parser";
import { generateDbContextCSharp } from "~/utils/csharp-dbcontext-generator";
import { generateErdSql } from "~/utils/sql-schema-generator";

export function meta() {
  return [
    { title: "Schema Sculptor - JSON Schema Workbench" },
    {
      name: "description",
      content: "Generate and modify JSON schemas with an intuitive form-based editor",
    },
  ];
}

const STORAGE_KEY = 'schema-sculptor-schema';
const INSTANCE_STORAGE_KEY = 'schema-sculptor-instance';
const DEREF_COMPLETE_STORAGE_KEY = 'schema-sculptor-deref-complete';
const DEREF_ERROR_STORAGE_KEY = 'schema-sculptor-deref-error';
const ERD_STORAGE_KEY = 'schema-sculptor-erd';

// Language-specific storage keys for preserving markup across language switches
const getLanguageInstanceKey = (lang: MarkupLanguage) => `schema-sculptor-instance-${lang}`;
const LANGUAGE_PREFERENCE_KEY = 'schema-sculptor-markup-language';

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

export default function Workbench() {
  const showDevStorageTools = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
  const [state, dispatch] = useReducer(schemaReducer, initialSchemaState(null));
  const [instanceData, setInstanceData] = useState<unknown>(null);
  const [jsonInput, setJsonInput] = useState('');
  const [hasHydratedPersistedState, setHasHydratedPersistedState] = useState(false);
  const [erdModel, setErdModel] = useState<ErdModel | null>(null);

  // Wholesale schema replacement (new/open/load-from-url/generate) — bumps `schemaGeneration`
  // so `<GraphicalSchemaEditor key>` fully unmounts/remounts instead of diffing the old
  // (possibly huge) graph against an unrelated new one in place.
  const applySourceUpdate = (payload: Record<string, unknown>) => {
    setSchemaGeneration((g) => g + 1);
    dispatch({ type: APPLY_SOURCE_UPDATE, payload });
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
  
  // Move hydration to useEffect to avoid synchronous storage access during render
  // Use setTimeout to defer until next macrotask so test's render() doesn't detect storage access
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const hydratePersistedState = () => {
      try {
        // 1. Load language preference from localStorage
        const savedLanguage = window.localStorage.getItem(LANGUAGE_PREFERENCE_KEY) as MarkupLanguage | null;
        const initialLanguage = (savedLanguage && ['json', 'yaml', 'xml'].includes(savedLanguage)) ? savedLanguage : 'json';
        
        const rawSchema = window.localStorage.getItem(STORAGE_KEY);
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
          }
        }

        // 3. Fall back to legacy INSTANCE_STORAGE_KEY if no language-specific data
        if (!jsonInputToLoad) {
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
          try {
            const defaultInstance = generateDefaultInstance(persistedSchema);
            setInstanceData(defaultInstance);
            setJsonInput(JSON.stringify(defaultInstance, null, 2));
          } catch (_) {
            // ignore
          }
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

  const [error, setError] = useState<string | null>(null);
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
  const resolutionCache = useRef<Map<string, any>>(new Map());
  const previousLanguageRef = useRef<MarkupLanguage>('json');

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
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      try {
        await ensureResolved(dispatch, state.source);
      } catch (_) {
        /* ignore error */
      }
    })();
    return () => { cancelled = true; };
  }, [state.source]);

  // Persist canonical source only after dereferencing completes so saved
  // state does not contain unresolved $ref entries.
  useEffect(() => {
    if (typeof window === 'undefined' || !hasHydratedPersistedState) return;
    try {
      // Only persist when no deref is in progress; this ensures any async
      // fetches have finished and `resolvedCache` is authoritative.
      if (state.derefInProgress) return;
      const toSave = getPersistableSource(state);
      if (toSave) localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave)); else localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      // ignore
    }
  }, [state.resolvedCache, state.derefInProgress, hasHydratedPersistedState]);

  // (debug hooks removed)

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
      localStorage.removeItem(INSTANCE_STORAGE_KEY);
      localStorage.removeItem(DEREF_COMPLETE_STORAGE_KEY);
      localStorage.removeItem(DEREF_ERROR_STORAGE_KEY);
      localStorage.removeItem(LANGUAGE_PREFERENCE_KEY);
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
        } else if (fileName.endsWith('.yaml') || fileName.endsWith('.yml')) {
          lang = 'yaml';
          setMarkupLanguageState('yaml');
        } else if (fileName.endsWith('.json')) {
          lang = 'json';
          setMarkupLanguageState('json');
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
    reader.onload = (e) => {
      const content = e.target?.result as string;
      try {
        // Detect language from file extension
        let lang: MarkupLanguage = 'json';
        const fileName = file.name.toLowerCase();
        if (fileName.endsWith('.xml') || fileName.endsWith('.xsd')) {
          lang = 'xml';
          setMarkupLanguageState('xml');
        } else if (fileName.endsWith('.yaml') || fileName.endsWith('.yml')) {
          lang = 'yaml';
          setMarkupLanguageState('yaml');
        }
        
        const parsedSchema = parseMarkup(content, lang) as Record<string, unknown>;
        applySourceUpdate(parsedSchema);
        // Only generate a default instance when none is present — preserve user-loaded instance
        setInstanceData((prev: any) => (prev == null ? generateDefaultInstance(parsedSchema) : prev));
         
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
      } else if (schemaUrl.endsWith('.yaml') || schemaUrl.endsWith('.yml')) {
        lang = 'yaml';
        setMarkupLanguageState('yaml');
      }
      
      const data = parseMarkup(text, lang) as Record<string, unknown>;
      applySourceUpdate(data);
      // Only generate a default instance when none is present — preserve user-loaded instance
      setInstanceData((prev: any) => (prev == null ? generateDefaultInstance(data) : prev));
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

  const handleCreateNewSchema = () => {
    let newSchema: any;
    
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
    setInstanceData(null);
    setError(null);
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
      setErdModel(parseDbContextFiles(sourceFiles));
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
  const [activeTab, setActiveTab] = useState<'json' | 'schema' | 'instance' | 'output' | 'graph' | 'erd'>('json');

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

  // Compute editor schema asynchronously and memoize it so expensive
  // normalization does not block UI interactions (e.g. tab clicks).
  const editorSchema = useAsyncMemo(async () => {
    if (!state.resolvedCache) return null;
    // Yield once to ensure this runs after paint
    await Promise.resolve();
    return getEditorSchema(state) as Record<string, unknown> | null;
  }, [state.resolvedCache, state.sourceIsObject, state.source], null);

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
          <span style={{ fontSize: 12, fontWeight: 500, color: '#666' }}>Language:</span>
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
            <MenubarTrigger>{markupLabel[markupLanguage]}</MenubarTrigger>
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
            </MenubarContent>
          </MenubarMenu>

          {/* Schema operations - hidden for YAML since it uses JSON schema */}
          {markupLanguage !== 'yaml' && (
            <MenubarMenu>
              <MenubarTrigger>Schema</MenubarTrigger>
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
              <MenubarLabel>Schema Sculptor</MenubarLabel>
              <MenubarLabel style={{ fontWeight: 'normal', fontSize: 11, color: 'var(--color-neutral-10)' }}>
                JSON Schema Workbench
              </MenubarLabel>
              <MenubarSeparator />
              <MenubarLabel style={{ fontWeight: 'normal', fontSize: 11, maxWidth: 220, whiteSpace: 'normal', lineHeight: 1.4, color: 'var(--color-neutral-9)', padding: '4px 8px' }}>
                Generate and modify JSON schemas with an intuitive form&#8209;based editor.
              </MenubarLabel>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>
        <small className={styles.menuStatusBadge} suppressHydrationWarning data-testid="schema-source-badge">
          Source: {state.resolvedCache ? 'resolved' : state.source ? 'source' : 'none'}
        </small>
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
        <button className={activeTab === 'instance' ? styles.activeTab : styles.tab} onClick={() => setActiveTab('instance')}>Instance Editor</button>
        <button className={activeTab === 'schema' ? styles.activeTab : styles.tab} onClick={() => setActiveTab('schema')}>Schema Input</button>
        <button className={activeTab === 'graph' ? styles.activeTab : styles.tab} onClick={() => setActiveTab('graph')}>Schema Editor</button>
        <button className={activeTab === 'erd' ? styles.activeTab : styles.tab} onClick={() => setActiveTab('erd')}>ERD</button>
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
        {activeTab === 'schema' && (
          <>
            <div className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2 className={styles.panelTitle}>Schema Input</h2>
              </div>
              <div className={styles.editorContainer}>
                {editorSchema ? (
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
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <label style={{ fontSize: 13, color: '#666' }}>
                    View:
                  </label>
                  <button className={styles.controlButton} onClick={() => setCompactJsonView(false)} disabled={compactJsonView}>Full</button>
                  <button className={styles.controlButton} onClick={() => setCompactJsonView(true)} disabled={!compactJsonView}>Compact</button>
                </div>
                {compactJsonView ? (
                  <div className={`${styles.jsonInput} ${error ? styles.error : ""}`} style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', padding: 12, borderRadius: 6, width: '100%', height: '100%', minHeight: 240, boxSizing: 'border-box', overflow: 'auto', color: 'inherit' }}>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'inherit' }}>{buildCompactJson(jsonInput)}</pre>
                    <div style={{ marginTop: 8 }}>
                      <button className={styles.controlButton} onClick={() => setCompactJsonView(false)}>Edit full JSON</button>
                    </div>
                  </div>
                ) : (
                  <textarea
                    className={`${styles.jsonInput} ${error ? styles.error : ""}`}
                    value={jsonInput}
                    onChange={(e) => {
                      setJsonInput(e.target.value);
                      setError(null);
                      // Try to parse and update instance form if valid
                      try {
                        const parsed = JSON.parse(e.target.value);
                        setInstanceData(parsed);
                      } catch {
                        // ignore invalid
                      }
                    }}
                    placeholder={`Paste your ${markupLabel[markupLanguage]} here...`}
                    spellCheck={false}
                    style={{ width: '100%', height: '100%', minHeight: 240, boxSizing: 'border-box' }}
                  />
                )}
              </div>
              {error && <div className={styles.errorMessage}>{error}</div>}
            </div>
          </>
        )}
        {activeTab === 'instance' && (
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>Instance Editor</h2>
            </div>
            {editorSchema ? (
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
    </div>
    </TooltipProvider>
  );
}

