import { useState } from "react";
import type { Route } from "./+types/workbench";
import { Sparkles, Copy, Check, X } from "lucide-react";
import styles from "./workbench.module.css";
import { generateSchema, isValidJSON } from "~/utils/schema-generator";
import { SchemaEditorForm } from "~/components/schema-editor-form";
import { JsonInstanceForm } from "~/components/json-instance-form";

export function meta({}: Route.MetaArgs) {
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

export default function Workbench() {
  const [jsonInput, setJsonInput] = useState(SAMPLE_JSON);
  const [schema, setSchema] = useState<Record<string, unknown> | null>(null);
  const [instanceData, setInstanceData] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showSchemaSource, setShowSchemaSource] = useState(false);

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

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Schema Sculptor</h1>
        <p className={styles.subtitle}>Transform JSON into editable schemas with precision and control</p>
      </header>

      <div className={styles.workspace}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>JSON Input</h2>
          </div>

          <textarea
            className={`${styles.jsonInput} ${error ? styles.error : ""}`}
            value={jsonInput}
            onChange={(e) => {
              setJsonInput(e.target.value);
              setError(null);
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

        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Schema Editor</h2>
          </div>

          {schema ? (
            <div className={styles.editorContainer}>
              <SchemaEditorForm 
                schema={schema} 
                onChange={setSchema} 
                onViewSource={() => setShowSchemaSource(true)}
              />
            </div>
          ) : (
            <div className={styles.emptyState}>Generate a schema to start editing</div>
          )}
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Instance Editor</h2>
          </div>

          {schema && instanceData !== null ? (
            <div className={styles.editorContainer}>
              <JsonInstanceForm schema={schema} value={instanceData} onChange={setInstanceData} />
            </div>
          ) : (
            <div className={styles.emptyState}>Generate a schema to edit instance data</div>
          )}
        </div>

        <div className={`${styles.panel} ${styles.schemaOutputPanel} ${showSchemaSource ? styles.visible : ""}`}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Schema Output</h2>
            <div className={styles.headerActions}>
              {schema && (
                <button className={`${styles.copyButton} ${copied ? styles.copied : ""}`} onClick={handleCopy}>
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
      </div>
    </div>
  );
}
