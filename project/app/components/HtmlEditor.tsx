import { memo, useId } from 'react';
import { WysiwygEditor as HtmlEditProWysiwygEditor } from './html-editor/html-edit-pro/components/WysiwygEditor.jsx';
import styles from './html-editor/html-editor.module.css';

interface HtmlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  testId?: string;
}

export const HtmlEditor = memo(function HtmlEditor({
  value,
  onChange,
  onBlur,
  placeholder = '<!-- Enter HTML here -->',
  testId,
}: HtmlEditorProps) {
  const generatedId = useId();
  return (
    <div
      className={styles.container}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) onBlur?.();
      }}
    >
      <HtmlEditProWysiwygEditor
        initialContent={value || ''}
        onChange={onChange}
        editorId={testId || generatedId}
        darkMode={false}
        showSourceView
        showToolbar
        height="360px"
        inheritPageColorScheme={false}
        placeholder={placeholder}
        ariaLabel="HTML content"
      />
    </div>
  );
});
