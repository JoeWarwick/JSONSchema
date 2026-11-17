/**
 * useEditorState Hook
 * Manages editor state including HTML content, CSS classes, custom colors, and localStorage persistence
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { loadCustomColors, saveCustomColors } from '../utils/colorPalette';
import { detectStylesheets } from '../utils/stylesheetDetector';
import { extractBodyContent } from '../utils/editorHelpers';
import { sanitizeEditorHTML } from '../utils/htmlSanitizer';

const DEFAULT_STORAGE_KEYS = {
  CONTENT: 'editor_content',
  CUSTOM_COLORS: 'editor_custom_colors',
};

/**
 * Create scoped storage keys for multiple editor instances
 */
const createStorageKeys = (editorId) => {
  if (!editorId) return DEFAULT_STORAGE_KEYS;
  
  return {
    CONTENT: `editor_content_${editorId}`,
    CUSTOM_COLORS: `editor_custom_colors_${editorId}`,
  };
};

export const useEditorState = (editorId = null) => {
  // Main editor HTML content
  const [content, setContent] = useState('');
  
  // Custom colors list
  const [customColors, setCustomColors] = useState([]);
  
  // Detected stylesheets (Tailwind, Bootstrap, Material) and icon libraries
  const [detectedStylesheets, setDetectedStylesheets] = useState({
    tailwind: false,
    bootstrap: false,
    material: false,
    fontAwesome: false,
    bootstrapIcons: false,
    featherIcons: false,
    ionicons: false,
  });
  
  // Track if we've loaded from localStorage
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Store selection state for restoring after toolbar interaction
  const savedSelectionRef = useRef(null);

  /**
   * Load editor state from localStorage on mount
   */
  useEffect(() => {
    try {
      const STORAGE_KEYS = createStorageKeys(editorId);
      const savedContent = localStorage.getItem(STORAGE_KEYS.CONTENT);
      // Note: Don't load from localStorage if content is empty
      // initialContent will be handled by WysiwygEditor's importHTML logic
      if (savedContent) {
        const sanitizedContent = sanitizeEditorHTML(savedContent);
        setContent(sanitizedContent);
        if (sanitizedContent !== savedContent) {
          localStorage.setItem(STORAGE_KEYS.CONTENT, sanitizedContent);
        }
      }
      
      const savedColors = loadCustomColors();
      setCustomColors(savedColors);
      
      setIsInitialized(true);
    } catch (error) {
      console.error('Failed to load editor state:', error);
      setIsInitialized(true);
    }
  }, [editorId]);

  /**
   * Save content to localStorage (debounced externally if needed)
   */
  const saveContent = useCallback((html) => {
    try {
      const STORAGE_KEYS = createStorageKeys(editorId);
      const sanitizedContent = sanitizeEditorHTML(html);
      localStorage.setItem(STORAGE_KEYS.CONTENT, sanitizedContent);
      setContent(sanitizedContent);
      return sanitizedContent;
    } catch (error) {
      console.error('Failed to save content:', error);
      return '';
    }
  }, [editorId]);

  /**
   * Add custom color
   */
  const addColor = useCallback((hexColor) => {
    const updated = [...customColors];
    if (!updated.includes(hexColor)) {
      updated.push(hexColor);
      saveCustomColors(updated);
      setCustomColors(updated);
    }
  }, [customColors]);

  /**
   * Remove custom color
   */
  const removeColor = useCallback((hexColor) => {
    const updated = customColors.filter(color => color !== hexColor);
    saveCustomColors(updated);
    setCustomColors(updated);
  }, [customColors]);

  /**
   * Clear all editor content
   */
  const clearEditorContent = useCallback(() => {
    try {
      const STORAGE_KEYS = createStorageKeys(editorId);
      localStorage.removeItem(STORAGE_KEYS.CONTENT);
      setContent('');
    } catch (error) {
      console.error('Failed to clear content:', error);
    }
  }, [editorId]);

  /**
   * Import HTML content
   */
  const importHTML = useCallback((html) => {
    try {
      // Merge page-level links with any stylesheets supplied in imported HTML.
      const contentDetected = detectStylesheets(html);
      const pageDetected = typeof document === 'undefined'
        ? {}
        : detectStylesheets(document.documentElement.outerHTML);
      const detected = Object.keys(contentDetected).reduce((merged, key) => {
        merged[key] = contentDetected[key] || pageDetected[key] === true;
        return merged;
      }, {});
      setDetectedStylesheets(detected);
      
      // Extract just the body content from full HTML documents
      const bodyContent = extractBodyContent(html);
      
      const sanitized = sanitizeEditorHTML(bodyContent);
      
      // Store detection results in sessionStorage for other components
      if (editorId) {
        sessionStorage.setItem(`editor-detected-stylesheets-${editorId}`, JSON.stringify(detected));
      }
      
      saveContent(sanitized);
      return sanitized;
    } catch (error) {
      console.error('Failed to import HTML:', error);
      return '';
    }
  }, [saveContent, editorId]);

  /**
   * Save the current text selection for later restoration
   */
  const saveSelection = useCallback((editorElement) => {
    const selection = window.getSelection();
    if (!editorElement || selection.rangeCount === 0 || !editorElement.contains(selection.anchorNode)) {
      return false;
    }

    const range = selection.getRangeAt(0);
    const startRange = document.createRange();
    startRange.selectNodeContents(editorElement);
    startRange.setEnd(range.startContainer, range.startOffset);

    const endRange = document.createRange();
    endRange.selectNodeContents(editorElement);
    endRange.setEnd(range.endContainer, range.endOffset);

    savedSelectionRef.current = {
      editorElement,
      startOffset: startRange.toString().length,
      endOffset: endRange.toString().length,
    };
    return true;
  }, []);

  /**
   * Restore a previously saved text selection
   */
  const restoreSelection = useCallback(() => {
    const savedSelection = savedSelectionRef.current;
    if (!savedSelection?.editorElement) return false;

    const walker = document.createTreeWalker(savedSelection.editorElement, NodeFilter.SHOW_TEXT);
    let currentOffset = 0;
    let startNode = null;
    let endNode = null;
    let startOffset = 0;
    let endOffset = 0;
    let textNode;

    while ((textNode = walker.nextNode())) {
      const nextOffset = currentOffset + textNode.nodeValue.length;
      if (!startNode && savedSelection.startOffset <= nextOffset) {
        startNode = textNode;
        startOffset = savedSelection.startOffset - currentOffset;
      }
      if (!endNode && savedSelection.endOffset <= nextOffset) {
        endNode = textNode;
        endOffset = savedSelection.endOffset - currentOffset;
        break;
      }
      currentOffset = nextOffset;
    }

    if (!startNode || !endNode) return false;

    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }, []);

  return {
    // State
    content,
    customColors,
    detectedStylesheets,
    isInitialized,
    
    // Actions
    saveContent,
    addColor,
    removeColor,
    clearEditorContent,
    importHTML,
    saveSelection,
    restoreSelection,
    setDetectedStylesheets,
  };
};
