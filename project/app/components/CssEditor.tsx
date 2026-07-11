import React, { useState, useEffect, useRef, memo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Textarea } from './ui/textarea/textarea';
import classNames from 'classnames';
import styles from './css-editor.module.css';
import { Code, Plus } from 'lucide-react';

interface CssEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

const SNIPPETS = [
  {
    category: 'Selectors',
    items: [
      { label: 'Class', value: '.className {\n  \n}' },
      { label: 'ID', value: '#idName {\n  \n}' },
      { label: 'Media Query', value: '@media (max-width: 600px) {\n  \n}' },
    ]
  },
  {
    category: 'Layout',
    items: [
      { label: 'Flexbox', value: 'display: flex;\njustify-content: center;\nalign-items: center;' },
      { label: 'Grid', value: 'display: grid;\ngrid-template-columns: 1fr 1fr;' },
      { label: 'Spacing', value: 'margin: 1rem;\npadding: 1rem;' },
    ]
  },
  {
    category: 'Appearance',
    items: [
      { label: 'Colors', value: 'color: var(--color-accent-9);\nbackground: var(--color-neutral-1);' },
      { label: 'Border', value: 'border: 1px solid var(--color-neutral-6);\nborder-radius: 8px;' },
      { label: 'Shadow', value: 'box-shadow: 0 4px 12px rgba(0,0,0,0.1);' },
    ]
  }
];

export const CssEditor = memo(function CssEditor({ value, onChange, placeholder }: CssEditorProps) {
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Simple syntax check: count braces
  useEffect(() => {
    if (typeof value !== 'string') return;
    const openBraces = (value.match(/{/g) || []).length;
    const closeBraces = (value.match(/}/g) || []).length;
    if (openBraces !== closeBraces) {
      setError(`Unmatched braces: ${openBraces} open vs ${closeBraces} closed`);
    } else {
      setError(null);
    }
  }, [value]);

  const insertSnippet = (snippet: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newValue = value.substring(0, start) + snippet + value.substring(end);
    
    onChange(newValue);
    
    // Resume focus and position cursor
    setTimeout(() => {
      textarea.focus();
      const newPos = start + snippet.length;
      textarea.setSelectionRange(newPos, newPos);
    }, 0);
  };

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <Popover.Root>
          <Popover.Trigger asChild>
            <button className={styles.trigger} title="Insert CSS Snippet">
              <Plus size={14} style={{ marginRight: 4 }} />
              Snippets
            </button>
          </Popover.Trigger>
          <Popover.Content className={styles.popoverContent} side="bottom" align="start">
            {SNIPPETS.map(section => (
              <div key={section.category} className={styles.section}>
                <div className={styles.sectionTitle}>{section.category}</div>
                <div className={styles.grid}>
                  {section.items.map(item => (
                    <button 
                      key={item.label} 
                      className={styles.snippetButton}
                      onClick={() => {
                        insertSnippet(item.value);
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </Popover.Content>
        </Popover.Root>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', color: 'var(--color-neutral-10)', fontSize: 11 }}>
          <Code size={12} style={{ marginRight: 4 }} />
          text/css
        </div>
      </div>

      <div className={styles.editorArea}>
        <Textarea
          ref={textareaRef}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || "/* Enter CSS here */"}
          className={classNames(styles.textarea, error && styles.textareaInvalid)}
        />
        {error && <div className={styles.error}>{error}</div>}
      </div>
    </div>
  );
});
