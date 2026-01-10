import { useState, useRef, useEffect } from "react";
import { Sparkles, Copy, Check, X, Upload, Link as LinkIcon, Download, FileUp } from "lucide-react";
import styles from "./workbench.module.css";
import { generateSchema, isValidJSON } from "~/utils/schema-generator";

// Utility to rename a property in an object (shallow)
function renamePropertyInObject(obj: any, oldName: string, newName: string) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  if (!(oldName in obj)) return obj;
  const newObj = { ...obj };
  newObj[newName] = newObj[oldName];
  delete newObj[oldName];
  return newObj;
}
import { SchemaEditorForm } from "~/components/schema-editor-form";
import { JsonInstanceForm } from "~/components/json-instance-form";

import { GraphicalSchemaEditor } from "~/components/graphical-schema-editor";

export function meta() {
  return [
    { title: "Schema Sculptor - JSON Schema Workbench" },
    {
      name: "description",
      content: "Generate and modify JSON schemas with an intuitive form-based editor",
    },
  ];
}

const SAMPLE_JSON = `{
  "user": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "isActive": true,
    "roles": ["admin", "user"],
    "profile": {
      "age": 30,
      "location": "New York"
    }
  }
}`;

const STORAGE_KEY = 'schema-sculptor-schema';
const INSTANCE_STORAGE_KEY = 'schema-sculptor-instance';

// Helper function to generate default instance data
const generateDefaultInstance = (schema: Record<string, unknown>): unknown => {
  if (!schema || typeof schema !== 'object') return null;
  
  const type = schema.type;
  
  if (type === 'object' && schema.properties && typeof schema.properties === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (typeof propSchema === 'object' && propSchema !== null) {
        result[key] = generateDefaultInstance(propSchema as Record<string, unknown>);
      }
    }
    return result;
  }
  
  if (type === 'array' && schema.items) {
    if (Array.isArray(schema.items)) {
      return schema.items.map(item => 
        typeof item === 'object' && item !== null 
          ? generateDefaultInstance(item as Record<string, unknown>) 
          : null
      );
    } else if (typeof schema.items === 'object') {
      return [generateDefaultInstance(schema.items as Record<string, unknown>)];
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
  const [schema, setSchema] = useState<Record<string, unknown> | null>(() => {
    // Load schema from localStorage on initial render
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (err) {
          console.error('Failed to parse saved schema:', err);
        }
      }
    }
    return null;
  });
  
  const [instanceData, setInstanceData] = useState<unknown>(() => {
    // Load instance data from localStorage on initial render
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(INSTANCE_STORAGE_KEY);
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (err) {
          console.error('Failed to parse saved instance:', err);
        }
      }
    }
    return null;
  });
  
  const [jsonInput, setJsonInput] = useState(() => {
    // Initialize jsonInput from saved instance data if available
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(INSTANCE_STORAGE_KEY);
      if (saved) {
        try {
          const instance = JSON.parse(saved);
          return JSON.stringify(instance, null, 2);
        } catch (err) {
          console.error('Failed to initialize jsonInput from saved instance:', err);
        }
      }
    }
    return SAMPLE_JSON;
  });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showSchemaSource, setShowSchemaSource] = useState(false);
  const [jsonUrl, setJsonUrl] = useState("");
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);
  const [schemaUrl, setSchemaUrl] = useState("");
  const [isLoadingSchemaUrl, setIsLoadingSchemaUrl] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const schemaFileInputRef = useRef<HTMLInputElement>(null);

  // Auto-save schema to localStorage whenever it changes
  useEffect(() => {
    console.log('Schema updated:', schema);
    if (schema) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(schema));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [schema]);

  // Auto-save instance data to localStorage whenever it changes
  useEffect(() => {
    if (instanceData !== null) {
      localStorage.setItem(INSTANCE_STORAGE_KEY, JSON.stringify(instanceData));
    } else {
      localStorage.removeItem(INSTANCE_STORAGE_KEY);
    }
  }, [instanceData]);

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
      setSchema(generatedSchema);
      setInstanceData(parsed);
    } catch (err) {
      setError("Failed to generate schema. Please check your JSON.");
    }
  };

  const handleCopy = async () => {
    if (!schema) return;

    try {
      await navigator.clipboard.writeText(JSON.stringify(schema, null, 2));
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
      setJsonInput(content);
      setError(null);
      // If valid JSON, set instanceData to the loaded document
      try {
        const parsed = JSON.parse(content);
        setInstanceData(parsed);
      } catch {}
    };
    reader.onerror = () => {
      setError("Failed to read file");
    };
    reader.readAsText(file);
  };

  const handleLoadFromUrl = async () => {
    if (!jsonUrl.trim()) {
      setError("Please enter a URL");
      return;
    }

    setIsLoadingUrl(true);
    setError(null);

    try {
      const response = await fetch(jsonUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setJsonInput(JSON.stringify(data, null, 2));
      setInstanceData(data);
      setJsonUrl("");
    } catch (err) {
      setError(`Failed to load JSON from URL: ${err instanceof Error ? err.message : 'Unknown error'}`);
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
        const parsedSchema = JSON.parse(content);
        setSchema(parsedSchema);
        // Always regenerate instance data for new schema
        setInstanceData(generateDefaultInstance(parsedSchema));
        setError(null);
      } catch (err) {
        setError("Invalid schema file. Please upload a valid JSON schema.");
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
      const data = await response.json();
      setSchema(data);
      // Always regenerate instance data for new schema
      setInstanceData(generateDefaultInstance(data));
      setSchemaUrl("");
    } catch (err) {
      setError(`Failed to load schema from URL: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsLoadingSchemaUrl(false);
    }
  };

  const handleSaveSchema = () => {
    if (!schema) return;

    const blob = new Blob([JSON.stringify(schema, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'schema.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSaveJson = () => {
    if (!jsonInput.trim()) return;

    const blob = new Blob([jsonInput], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'data.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Tabbed UI state
  const [activeTab, setActiveTab] = useState<'json' | 'schema' | 'instance' | 'output' | 'graph'>('json');

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h4 className={styles.title}>Schema Sculptor - JSON Schema Workbench</h4>
        <p className={styles.subtitle}>Generate and modify JSON schemas with an intuitive form-based editor</p>
      </header>

      <div className={styles.tabs}>
        <button className={activeTab === 'json' ? styles.activeTab : styles.tab} onClick={() => setActiveTab('json')}>JSON Input</button>
        <button className={activeTab === 'instance' ? styles.activeTab : styles.tab} onClick={() => setActiveTab('instance')}>Instance Editor</button>
        <button className={activeTab === 'schema' ? styles.activeTab : styles.tab} onClick={() => setActiveTab('schema')}>Schema Input</button>
        <button className={activeTab === 'graph' ? styles.activeTab : styles.tab} onClick={() => setActiveTab('graph')}>Schema Editor</button>
      </div>

      <div className={styles.tabPanel}>
        {activeTab === 'graph' && (
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>Graphical Schema Editor</h2>
            </div>
            <div className={styles.editorContainer}>
              <GraphicalSchemaEditor
                schema={schema ?? {}}
                onChange={(newSchema) => {
                  setSchema(newSchema);
                  setInstanceData((prev: unknown) => prev == null ? generateDefaultInstance(newSchema) : prev);
                }}
              />
            </div>
          </div>
        )}
        {activeTab === 'schema' && (
          <>
            <div className={styles.inputControls}>
              <input
                type="file"
                ref={schemaFileInputRef}
                onChange={handleSchemaFileUpload}
                accept=".json,application/json"
                style={{ display: 'none' }}
              />
              <button 
                className={styles.controlButton}
                onClick={() => schemaFileInputRef.current?.click()}
                title="Load schema from file"
              >
                <FileUp size={16} />
                Load File
              </button>
              {schema && (
                <button 
                  className={styles.controlButton}
                  onClick={handleSaveSchema}
                  title="Save schema to file"
                >
                  <Download size={16} />
                  Save Schema
                </button>
              )}
              <div className={styles.urlInputGroup}>
                <input
                  type="url"
                  className={styles.urlInput}
                  value={schemaUrl}
                  onChange={(e) => setSchemaUrl(e.target.value)}
                  placeholder="Enter schema URL..."
                  onKeyDown={(e) => e.key === 'Enter' && handleLoadSchemaFromUrl()}
                />
                <button 
                  className={styles.controlButton}
                  onClick={handleLoadSchemaFromUrl}
                  disabled={isLoadingSchemaUrl}
                  title="Load schema from URL"
                >
                  <LinkIcon size={16} />
                  {isLoadingSchemaUrl ? 'Loading...' : 'Load URL'}
                </button>
              </div>
            </div>
            <div className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2 className={styles.panelTitle}>Schema Editor</h2>
              </div>
              <div className={styles.editorContainer}>
                <SchemaEditorForm 
                  schema={schema ?? {}} 
                  onChange={setSchema} 
                  onViewSource={() => setShowSchemaSource(true)}
                  onPropertyRename={(oldName, newName, path = []) => {
                    // Only support root-level for now, can be extended for nested
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
              </div>
            </div>
          </>
        )}
        {/* End of schema and graph panels, now start JSON panel */}
        {activeTab === 'json' && (
          <>
            <div className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2 className={styles.panelTitle}>JSON Input</h2>
              </div>
              <div className={styles.inputControls}>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".json,application/json"
                  style={{ display: 'none' }}
                />
                <button 
                  className={styles.controlButton}
                  onClick={() => fileInputRef.current?.click()}
                  title="Load JSON file"
                >
                  <FileUp size={16} />
                  Load File
                </button>
                <button 
                  className={styles.controlButton}
                  onClick={handleSaveJson}
                  title="Save JSON to file"
                >
                  <Download size={16} />
                  Save JSON
                </button>
                <div className={styles.urlInputGroup}>
                  <input
                    type="url"
                    className={styles.urlInput}
                    value={jsonUrl}
                    onChange={(e) => setJsonUrl(e.target.value)}
                    placeholder="Enter JSON URL..."
                    onKeyDown={(e) => e.key === 'Enter' && handleLoadFromUrl()}
                  />
                  <button 
                    className={styles.controlButton}
                    onClick={handleLoadFromUrl}
                    disabled={isLoadingUrl}
                    title="Load JSON from URL"
                  >
                    <LinkIcon size={16} />
                    {isLoadingUrl ? 'Loading...' : 'Load URL'}
                  </button>
                </div>
              </div>
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
                  } catch {}
                }}
                placeholder="Paste your JSON here..."
                spellCheck={false}
              />
              {error && <div className={styles.errorMessage}>{error}</div>}
              <button className={styles.generateButton} onClick={handleGenerate}>
                <Sparkles size={18} />
                Generate Schema
              </button>
            </div>
          </>
        )}
        {activeTab === 'instance' && (
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>Instance Editor</h2>
            </div>
            {schema && instanceData !== null ? (
              <div className={styles.editorContainer}>
                <JsonInstanceForm 
                  schema={schema} 
                  value={instanceData} 
                  onChange={(newData) => {
                    setInstanceData(newData);
                    setJsonInput(JSON.stringify(newData, null, 2));
                  }} 
                />
              </div>
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
                {schema && (
                  <>
                    <button className={styles.actionButton} onClick={handleSaveSchema} title="Save schema">
                      <Download size={16} />
                      Save
                    </button>
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
            {schema ? (
              <pre className={styles.schemaOutput}>{JSON.stringify(schema, null, 2)}</pre>
            ) : (
              <div className={styles.emptyState}>Your generated schema will appear here</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
