import React, { useRef, useMemo, useEffect } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-markup';
import 'prismjs/themes/prism-tomorrow.css';
import { serializeMarkup, parseMarkup, type MarkupLanguage } from '~/utils/markup';
import styles from './schema-source-editor.module.css';

interface SchemaSourceEditorProps {
  schema: Record<string, unknown> | null | undefined;
  onChange: (newSchema: Record<string, unknown>) => void;
  schemaLanguage: 'json' | 'xml' | 'yaml';
  readOnly?: boolean;
}

export function SchemaSourceEditor({
  schema,
  onChange,
  schemaLanguage,
  readOnly = false,
}: SchemaSourceEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const codeRef = useRef<HTMLCodeElement>(null);

  // Serialize schema to string using the appropriate format
  const schemaText = useMemo(() => {
    if (!schema || typeof schema !== 'object') return '';
    
    try {
      return serializeMarkup(schema, schemaLanguage as MarkupLanguage);
    } catch (e) {
      console.error('Failed to serialize schema:', e);
      return '';
    }
  }, [schema, schemaLanguage]);

  // Determine the language for syntax highlighting
  const language = schemaLanguage === 'xml' ? 'markup' : 'json';

  // Update syntax highlighting when text changes
  useEffect(() => {
    if (!codeRef.current || !textareaRef.current) return;

    const code = textareaRef.current.value;
    codeRef.current.textContent = code;
    Prism.highlightElement(codeRef.current);
  }, [schemaText]);

  // Sync scroll position between textarea and highlight
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (highlightRef.current) {
      highlightRef.current.scrollLeft = e.currentTarget.scrollLeft;
      highlightRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    
    // Update highlighting
    if (codeRef.current) {
      codeRef.current.textContent = newText;
      Prism.highlightElement(codeRef.current);
    }

    // Parse and emit change
    try {
      const parsed = parseMarkup(newText, schemaLanguage as MarkupLanguage);
      if (typeof parsed === 'object' && parsed !== null) {
        onChange(parsed);
      }
    } catch (e) {
      // Ignore parse errors during typing - allow invalid markup while editing
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.editorWrapper}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={schemaText}
          onChange={handleChange}
          onScroll={handleScroll}
          readOnly={readOnly}
          placeholder="Schema will appear here..."
          spellCheck="false"
        />
        <pre ref={highlightRef} className={styles.highlight}>
          <code
            ref={codeRef}
            className={`language-${language} ${styles.code}`}
          />
        </pre>
      </div>
    </div>
  );
}
