declare module '*.jsx' {
  import type { ComponentType } from 'react';

  export const WysiwygEditor: ComponentType<{
    initialContent?: string;
    onChange?: (html: string) => void;
    editorId?: string;
    darkMode?: boolean;
    showSourceView?: boolean;
    showToolbar?: boolean;
    height?: string;
    inheritPageColorScheme?: boolean;
    placeholder?: string;
    ariaLabel?: string;
  }>;
}
