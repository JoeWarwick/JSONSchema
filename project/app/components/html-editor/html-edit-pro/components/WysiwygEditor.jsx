/**
 * WysiwygEditor - A reusable React component for rich text editing with table support
 * 
 * Usage:
 * ```jsx
 * import { WysiwygEditor } from './components/WysiwygEditor';
 * 
 * function MyComponent() {
 *   const [html, setHtml] = useState('<p>Hello world</p>');
 *   
 *   return (
 *     <WysiwygEditor
 *       initialContent={html}
 *       onChange={setHtml}
 *       darkMode={true}
 *       height="500px"
 *     />
 *   );
 * }
 * ```
 * 
 * Multiple Editors with Shared Toolbar:
 * ```jsx
 * import { ToolbarProvider } from '../contexts/ToolbarContext';
 * import { SharedToolbar } from './SharedToolbar';
 * import { WysiwygEditor } from './WysiwygEditor';
 * 
 * function MultiEditor() {
 *   return (
 *     <ToolbarProvider>
 *       <SharedToolbar />
 *       <WysiwygEditor sharedToolbar={true} editorId="editor1" />
 *       <WysiwygEditor sharedToolbar={true} editorId="editor2" />
 *     </ToolbarProvider>
 *   );
 * }
 * ```
 */

import { useState, useRef, useCallback, useContext, useEffect } from 'react';
import { useEditorState } from '../hooks/useEditorState';
import { ToolbarContext } from '../contexts/ToolbarContext';
import { Editor } from './Editor';
import { Toolbar } from './Toolbar';
import { SourceView } from './SourceView';
import { SnippetSelector } from './SnippetSelector';
import './WysiwygEditor.css';

export const WysiwygEditor = ({
  // Content management
  initialContent = '<p>Start editing...</p>',
  onChange = null,
  editorId = null, // Optional: use for multiple editors on same page
  placeholder = '',
  ariaLabel = 'HTML Editor',
  
  // UI customization
  darkMode = true,
  showSourceView = true,
  showToolbar = true,
  height = '500px',
  className = '',
  sharedToolbar = false, // NEW: hide toolbar and use shared toolbar instead
  inheritPageColorScheme = true,
  startLocked = false,
  
  // Features
  readOnly = false,
}) => {
  const editorState = useEditorState(editorId);
  const [showSource, setShowSource] = useState(false);
  const [showSnippetSelector, setShowSnippetSelector] = useState(false);
  const [snippetSelection, setSnippetSelection] = useState(null);
  const [isDark, setIsDark] = useState(darkMode);
  const [toolbarVisible, setToolbarVisible] = useState(!startLocked);
  const editorContentRef = useRef(null);
  const editorRef = useRef(null);
  const toolbarContext = useContext(ToolbarContext);

  /**
   * Handle editor focus - register with shared toolbar context
   */
  const handleEditorFocus = useCallback(() => {
    // Record last focused editor id so parent app can decide which toolbar to show
    try {
      window.__lastFocusedEditorId = editorId || 'single';
    } catch (e) {
      // ignore
    }

    if (sharedToolbar && toolbarContext && editorRef.current) {
      toolbarContext.setActiveEditor(editorRef, editorState.restoreSelection);
      toolbarContext.updateDetectedStylesheets(editorState.detectedStylesheets);
    }
  }, [sharedToolbar, toolbarContext, editorState.detectedStylesheets]);

  useEffect(() => {
    if (!sharedToolbar || !toolbarContext?.initializeActiveEditor || !editorRef.current) return;

    const hasDetectedStylesheet = Object.values(editorState.detectedStylesheets).some(Boolean);
    if (hasDetectedStylesheet) {
      toolbarContext.initializeActiveEditor(editorRef, editorState.detectedStylesheets, editorState.restoreSelection);
    }
  }, [sharedToolbar, toolbarContext, editorState.detectedStylesheets]);

  useEffect(() => {
    if (!sharedToolbar || !toolbarContext?.registerSharedEditor || !editorRef.current) return;

    editorRef.current.contentEditable = 'false';

    return toolbarContext.registerSharedEditor(editorRef);
  }, [sharedToolbar, toolbarContext]);

  /**
   * Handle content changes
   * Notifies parent component and saves to state
   */
  const handleContentChange = useCallback((html) => {
    const sanitizedHTML = editorState.saveContent(html);
    editorContentRef.current = sanitizedHTML;
    
    onChange?.(sanitizedHTML);
  }, [editorState, onChange]);

  const handleToggleSnippetSelector = useCallback(() => {
    const selection = window.getSelection();
    const savedRange = editorRef.current && selection?.rangeCount > 0 && editorRef.current.contains(selection.anchorNode)
      ? selection.getRangeAt(0).cloneRange()
      : null;
    setSnippetSelection(savedRange);
    setShowSnippetSelector((isOpen) => !isOpen);
  }, []);

  /**
   * Handle source HTML import
   */
  const handleApplySourceHTML = useCallback((html) => {
    const sanitizedHTML = editorState.importHTML(html);
    setShowSource(false);
    onChange?.(sanitizedHTML);
  }, [editorState, onChange]);

  /**
   * Get current HTML content
   */
  const getContent = useCallback(() => {
    return editorState.content;
  }, [editorState.content]);

  /**
   * Set HTML content programmatically
   */
  const setContent = useCallback((html) => {
    const sanitizedHTML = editorState.importHTML(html);
    onChange?.(sanitizedHTML);
  }, [editorState, onChange]);

  /**
   * Clear all content
   */
  const clearContent = useCallback(() => {
    editorState.clearEditorContent();
    onChange?.('');
  }, [editorState, onChange]);

  /**
   * Import initial content on mount and whenever it changes
   * This ensures framework detection runs on the correct content
   */
  useEffect(() => {
    // Skip default placeholder text
    if (initialContent !== '<p>Start editing...</p>') {
      // Parent-controlled updates caused by this editor already have detection state.
      if (initialContent === editorContentRef.current) return;

      // Always import the provided initialContent to ensure proper detection
      editorState.importHTML(initialContent);
    }
  }, [initialContent]);

  return (
    <div className={`wysiwyg-editor-instance ${inheritPageColorScheme ? '' : 'color-scheme-independent'}`}>
      {/* Toolbar - Separate Floating Component */}
      {(showToolbar || startLocked) && !sharedToolbar && (
        <Toolbar
          editorRef={editorRef}
          customColors={[]}
          onAddColor={() => {}}
          onToggleSourceView={() => showSourceView && setShowSource(!showSource)}
          onToggleSnippetSelector={handleToggleSnippetSelector}
          detectedStylesheets={editorState.detectedStylesheets}
          onImportHTML={() => {}}
          restoreSelection={editorState.restoreSelection}
          editorId={editorId}
          startLocked={startLocked}
          toolbarVisible={toolbarVisible}
        />
      )}

      {/* Editor Container */}
      <div 
        className={`wysiwyg-editor-container ${isDark ? 'dark' : 'light'} ${inheritPageColorScheme ? '' : 'color-scheme-independent'} ${className}`}
        style={{ height }}
      >
        {/* Source/Theme Toggle Buttons */}
        {(showSourceView || !readOnly) && (
          <div className="wysiwyg-toolbar-wrapper">
            {showSourceView && (
              <button
                className="source-toggle-btn"
                onClick={() => setShowSource(!showSource)}
                title={showSource ? 'Hide source' : 'Show source'}
              >
                {showSource ? 'Editor' : 'Source'}
              </button>
            )}
            {!readOnly && (
              <button
                className="theme-toggle-btn"
                onClick={() => setIsDark(!isDark)}
                title="Toggle dark mode"
              >
                {isDark ? '☀️' : '🌙'}
              </button>
            )}
          </div>
        )}

      {/* Editor or Source View */}
      <div className="wysiwyg-content-wrapper">
        {showSource ? (
          <SourceView 
            isOpen={showSource}
            content={editorState.content}
            onApplyHTML={handleApplySourceHTML}
            onImportHTML={() => {}}
            onClose={() => setShowSource(false)}
          />
        ) : (
          <Editor
            ref={editorRef}
            content={editorState.content}
            onContentChange={handleContentChange}
            onSelection={editorState.saveSelection}
            onEditorFocus={handleEditorFocus}
            onUnlock={() => setToolbarVisible(true)}
            readOnly={readOnly || (startLocked && !toolbarVisible)}
            placeholder={placeholder}
            ariaLabel={ariaLabel}
          />
        )}
      </div>

      {/* Snippet Selector Modal */}
      <SnippetSelector
        isOpen={showSnippetSelector}
        detectedStylesheets={editorState.detectedStylesheets}
        editorRef={editorRef}
        restoreSelection={editorState.restoreSelection}
        savedRange={snippetSelection}
        onClose={() => setShowSnippetSelector(false)}
      />
      </div>

      {/* Expose methods via ref (optional) */}
      {/* This allows parent components to call methods like editor.current?.getContent() */}
    </div>
  );
};

// Export the component with convenience methods as a namespace
WysiwygEditor.displayName = 'WysiwygEditor';
