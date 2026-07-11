import { useRef, useEffect, memo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Textarea } from './ui/textarea/textarea';
import styles from './html-editor.module.css';
import { Code, Plus, Eye } from 'lucide-react';

interface HtmlEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

const SNIPPETS = [
  {
    category: 'Basic Tags',
    items: [
      { label: 'Div', value: '<div>\n  \n</div>' },
      { label: 'Span', value: '<span></span>' },
      { label: 'P', value: '<p>\n  \n</p>' },
      { label: 'Link', value: '<a href="#">Link</a>' },
    ]
  },
  {
    category: 'Heading / List',
    items: [
      { label: 'H1', value: '<h1>Heading</h1>' },
      { label: 'H2', value: '<h2>Subheading</h2>' },
      { label: 'UL', value: '<ul>\n  <li>Item</li>\n</ul>' },
      { label: 'OL', value: '<ol>\n  <li>Item</li>\n</ol>' },
    ]
  },
  {
    category: 'Forms',
    items: [
      { label: 'Button', value: '<button type="button">Click</button>' },
      { label: 'Input', value: '<input type="text" placeholder="Entry" />' },
    ]
  },
  {
    category: 'Advanced',
    items: [
      { label: 'Style', value: '<style>\n  \n</style>' },
      { label: 'Script', value: '<script>\n  \n</script>' },
      { label: 'Image', value: '<img src="" alt="" />' },
    ]
  }
];

export const HtmlEditor = memo(function HtmlEditor({ value, onChange, placeholder }: HtmlEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const updateTimerRef = useRef<number | null>(null);

  const insertSnippet = (snippet: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newValue = value.substring(0, start) + snippet + value.substring(end);
    
    onChange(newValue);
    
    setTimeout(() => {
      textarea.focus();
      const newPos = start + snippet.length;
      textarea.setSelectionRange(newPos, newPos);
    }, 0);
  };

  useEffect(() => {
    if (updateTimerRef.current) {
      window.clearTimeout(updateTimerRef.current);
    }

    updateTimerRef.current = window.setTimeout(() => {
      if (iframeRef.current) {
        const doc = iframeRef.current.contentDocument;
        if (doc) {
          try {
            doc.open();
            doc.write(typeof value === 'string' ? value : '');
            doc.close();
          } catch (e) {
            console.warn('Failed to update HTML preview:', e);
          }
        }
      }
    }, 300); // 300ms debounce for iframe updates

    return () => {
      if (updateTimerRef.current) window.clearTimeout(updateTimerRef.current);
    };
  }, [value]);

  return (
    <div className={styles.container}>
      <div className={styles.main}>
        <div className={styles.editorSection}>
          <div className={styles.toolbar}>
            <Popover.Root>
              <Popover.Trigger asChild>
                <button className={styles.trigger} title="Insert HTML Snippet">
                  <Plus size={14} style={{ marginRight: 4 }} />
                  Tags
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
                          onClick={() => insertSnippet(item.value)}
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
              text/html
            </div>
          </div>

          <Textarea
            ref={textareaRef}
            value={value || ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder || "<!-- Enter HTML here -->"}
            className={styles.textarea}
          />
        </div>

        <div className={styles.previewSection}>
          <div className={styles.previewLabel}>
            <Eye size={12} />
            Live Preview
          </div>
          <iframe 
            ref={iframeRef} 
            className={styles.previewFrame} 
            title="HTML Preview"
            sandbox="allow-scripts"
          />
        </div>
      </div>
    </div>
  );
});
