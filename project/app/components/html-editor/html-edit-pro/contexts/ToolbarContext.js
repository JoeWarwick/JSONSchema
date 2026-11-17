/**
 * ToolbarContext - Manages shared toolbar state across multiple editors
 * 
 * Allows a single toolbar to control multiple editor instances by tracking
 * which editor is currently active/focused.
 */

import React, { createContext, useState, useCallback, useMemo, useRef } from 'react';

export const ToolbarContext = createContext();

export const ToolbarProvider = ({ children }) => {
  const [activeEditorRef, setActiveEditorRef] = useState(null);
  const [restoreActiveEditorSelection, setRestoreActiveEditorSelection] = useState(null);
  const hasInitializedEditorRef = useRef(false);
  const sharedEditorRefs = useRef(new Set());
  const [detectedStylesheets, setDetectedStylesheets] = useState({
    tailwind: false,
    bootstrap: false,
    material: false,
    fontAwesome: false,
    bootstrapIcons: false,
    featherIcons: false,
    ionicons: false,
  });
  // Allow an explicit UIframework styling override (undefined = use detected, null = explicit none, or 'tailwind'|'bootstrap'|'material')
  const [activeUIFramework, setActiveUIFramework] = useState(undefined);

  /**
   * Register an editor as active when focused
   */
  const setActiveEditor = useCallback((editorRef, restoreSelection) => {
    hasInitializedEditorRef.current = true;
    setActiveEditorRef(editorRef);
    setRestoreActiveEditorSelection(() => restoreSelection || null);
  }, []);

  const registerSharedEditor = useCallback((editorRef) => {
    if (!editorRef) return () => {};

    sharedEditorRefs.current.add(editorRef);

    return () => {
      sharedEditorRefs.current.delete(editorRef);
    };
  }, []);

  const initializeActiveEditor = useCallback((editorRef, detected, restoreSelection) => {
    if (hasInitializedEditorRef.current) return;

    hasInitializedEditorRef.current = true;
    setActiveEditorRef(editorRef);
    setRestoreActiveEditorSelection(() => restoreSelection || null);
    setDetectedStylesheets(detected);
  }, []);

  /**
   * Preserve page-level detections as editors become active.
   */
  const updateDetectedStylesheets = useCallback((detected) => {
    setDetectedStylesheets((current) => Object.keys(current).reduce((merged, key) => {
      merged[key] = current[key] || detected?.[key] === true;
      return merged;
    }, {}));
  }, []);

  const updateActiveUIFramework = useCallback((uiFrameworkId) => {
    setActiveUIFramework(uiFrameworkId);
  }, []);

  /**
   * Get the currently active editor reference
   */
  const getActiveEditor = useCallback(() => {
    return activeEditorRef;
  }, [activeEditorRef]);

  // Memoize the value object so it doesn't change on every render
  const value = useMemo(() => ({
    activeEditorRef,
    restoreActiveEditorSelection,
    setActiveEditor,
    registerSharedEditor,
    initializeActiveEditor,
    getActiveEditor,
    detectedStylesheets,
    updateDetectedStylesheets,
    activeUIFramework,
    updateActiveUIFramework,
    sharedEditorRefs,
  }), [activeEditorRef, restoreActiveEditorSelection, setActiveEditor, initializeActiveEditor, getActiveEditor, detectedStylesheets, updateDetectedStylesheets, activeUIFramework, updateActiveUIFramework]);

  return React.createElement(
    ToolbarContext.Provider,
    { value },
    children
  );
};

/**
 * Hook to access toolbar context
 */
export const useToolbar = () => {
  const context = React.useContext(ToolbarContext);
  if (!context) {
    throw new Error('useToolbar must be used within a ToolbarProvider');
  }
  return context;
};
