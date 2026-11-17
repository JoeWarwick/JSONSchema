/**
 * SharedToolbar Component
 * Single toolbar that controls multiple editor instances via ToolbarContext
 * Uses ToolbarContent for shared UI rendering
 * 
 * Usage:
 * ```jsx
 * import { ToolbarProvider } from '../contexts/ToolbarContext';
 * import { SharedToolbar } from './SharedToolbar';
 * import { WysiwygEditor } from './WysiwygEditor';
 * 
 * function App() {
 *   return (
 *     <ToolbarProvider>
 *       <SharedToolbar />
 *       <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
 *         <WysiwygEditor sharedToolbar={true} editorId="editor1" />
 *         <WysiwygEditor sharedToolbar={true} editorId="editor2" />
 *       </div>
 *     </ToolbarProvider>
 *   );
 * }
 * ```
 */

import React, { useState, useContext, useCallback, useEffect } from 'react';
import { ToolbarContext } from '../contexts/ToolbarContext';
import { ToolbarContent } from './ToolbarContent';
import { SnippetSelector } from './SnippetSelector';
import { getPrimaryDetectedFramework } from '../utils/snippetConfig';
import {
  applyBlockElement,
  applyList,
  insertLink,
  insertImage,
  insertHorizontalRule,
  insertCodeBlock,
  insertTable,
  applyClassToSelection,
  getActiveStylesFromSelection,
} from '../utils/editorHelpers';
import {
  applyColorStyle,
  applyFontStyle,
  applyFontSizeStyle,
  applyTextAlignStyle,
  applyBoldStyle,
  applyItalicStyle,
  applyUnderlineStyle,
  getIndexedClassMap,
} from '../utils/cssGenerator';
import { AVAILABLE_FONTS, loadGoogleFont } from '../utils/fontManager';
import './Toolbar.css';

export const SharedToolbar = ({ customColors = [], onAddColor }) => {
  // Safely read ToolbarContext (SharedToolbar is normally inside a provider)
  const _ctx = useContext(ToolbarContext) || {};
  const activeEditorRef = _ctx.activeEditorRef || null;
  const restoreActiveEditorSelection = _ctx.restoreActiveEditorSelection;
  const sharedEditorRefs = _ctx.sharedEditorRefs || null;
  const detectedStylesheets = _ctx.detectedStylesheets || {};
  const contextActiveUIFramework = _ctx.activeUIFramework;
  const updateActiveUIFramework = typeof _ctx.updateActiveUIFramework === 'function' ? _ctx.updateActiveUIFramework : null;

  // Primary detected framework from document (used as default when no explicit override)
  const detectedPrimaryUIFramework = getPrimaryDetectedFramework(detectedStylesheets);
  // If contextActiveUIFramework is undefined, fall back to detectedPrimaryUIFramework. If it's null, treat as explicit 'none' for framework styling.
  const activeUIFramework = contextActiveUIFramework !== undefined ? contextActiveUIFramework : detectedPrimaryUIFramework;
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showCSSPanel, setShowCSSPanel] = useState(false);
  const [showCSSRules, setShowCSSRules] = useState(false);
  const [showSnippetSelector, setShowSnippetSelector] = useState(false);
  const [snippetSelection, setSnippetSelection] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [position, setPosition] = useState({ top: 0, right: 0 });
  const [activeStyles, setActiveStyles] = useState({});
  const [pendingSize, setPendingSize] = useState('');
  const [pendingFont, setPendingFont] = useState('');
  const [listStyles, setListStyles] = useState({ ul: 'disc', ol: 'decimal' });
  const [showSourceView, setShowSourceView] = useState(false);
  const [isLocked, setIsLocked] = useState(true);
  const [showToolbar, setShowToolbar] = useState(false);

  const toolbarRef = React.useRef(null);

  /**
   * Handle drag start on the toolbar header
   */
  const handleMouseDown = (e) => {
    e.preventDefault();
    const rect = toolbarRef.current?.getBoundingClientRect();

    if (rect) {
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;

      setDragOffset({ x: offsetX, y: offsetY });
      setIsDragging(true);
    }
  };

  /**
   * Handle dragging
   */
  React.useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      const newTop = e.clientY - dragOffset.y;
      const newRight = window.innerWidth - (e.clientX + dragOffset.x);

      setPosition({
        top: Math.max(0, newTop),
        right: Math.max(0, newRight),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = 'auto';
    };
  }, [isDragging, dragOffset]);

  // Mark globally that a shared toolbar is active to prevent single toolbars
  React.useEffect(() => {
    try {
      window.__sharedToolbarActive = true;
    } catch (e) {
      // ignore
    }
    return () => {
      try {
        delete window.__sharedToolbarActive;
      } catch (e) {
        // ignore
      }
    };
  }, []);

  useEffect(() => {
    const handleUnlock = (event) => {
      const editor = event.target;
      if (editor && editor.contentEditable === 'true') {
        const editorRect = editor.getBoundingClientRect();
        setIsLocked(false);
        setPosition({
          top: Math.max(0, editorRect.top),
          right: Math.max(0, window.innerWidth - editorRect.right),
        });
        setShowToolbar(true);
      }
    };

    document.addEventListener('unlock', handleUnlock);
    return () => {
      document.removeEventListener('unlock', handleUnlock);
    };
  }, []);

  /**
   * Update active styles from the current selection
   */
  const updateActiveStyles = useCallback(() => {
    if (!activeEditorRef?.current) return;

    const styles = getActiveStylesFromSelection();
    setActiveStyles(styles);
  }, [activeEditorRef]);

  /**
   * Apply an action to the active editor
   */
  const applyToActiveEditor = useCallback(
    (action) => {
      if (!activeEditorRef?.current) {
        console.warn('No active editor');
        return;
      }

      const editor = activeEditorRef.current;

      try {
        action();
        // Trigger input event so Editor component registers the change
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        // Restore focus and update styles
        if (editor && typeof editor.focus === 'function') {
          editor.focus();
        }
        updateActiveStyles();
      } catch (error) {
        console.error('Error applying action to editor:', error);
      }
    },
    [activeEditorRef, updateActiveStyles]
  );

  const handleUndo = useCallback(() => {
    applyToActiveEditor(() => document.execCommand('undo'));
  }, [applyToActiveEditor]);

  const handleRedo = useCallback(() => {
    applyToActiveEditor(() => document.execCommand('redo'));
  }, [applyToActiveEditor]);

  /**
   * Get the value for an indexed class (e.g., "size1" -> "16px")
   */
  const getValueForIndexedClass = useCallback((className, category) => {
    if (!className) return '';

    try {
      const map = getIndexedClassMap(category);
      for (const [value, index] of Object.entries(map)) {
        if (`${category}${index}` === className) {
          return value;
        }
      }
    } catch (e) {
      // Silently fail
    }

    return '';
  }, []);

  // Handler wrappers
  const handleBlockElement = useCallback(
    (element) => {
      applyToActiveEditor(() => {
        applyBlockElement(element, activeUIFramework);
        updateActiveStyles();
      });
    },
    [applyToActiveEditor, updateActiveStyles, activeUIFramework]
  );

  const handleList = useCallback(
    (listType, listStyle) => {
      restoreActiveEditorSelection?.();
      applyToActiveEditor(() => {
        applyList(listType, listStyle);
        updateActiveStyles();
      });
    },
    [applyToActiveEditor, restoreActiveEditorSelection, updateActiveStyles]
  );

  const handleInsertCode = useCallback(() => {
    applyToActiveEditor(() => {
      insertCodeBlock();
      updateActiveStyles();
    });
  }, [applyToActiveEditor, updateActiveStyles]);

  const handleInsertHR = useCallback(() => {
    applyToActiveEditor(() => {
      insertHorizontalRule();
      updateActiveStyles();
    });
  }, [applyToActiveEditor, updateActiveStyles]);

  const handleInsertTable = useCallback(() => {
    applyToActiveEditor(() => {
      insertTable(2, 2);
      updateActiveStyles();
    });
  }, [applyToActiveEditor, updateActiveStyles]);

  const handleInsertImage = useCallback(() => {
    const url = prompt('Enter image URL:');
    if (url) {
      applyToActiveEditor(() => {
        insertImage(url);
        updateActiveStyles();
      });
    }
  }, [applyToActiveEditor, updateActiveStyles]);

  const handleInsertLink = useCallback(() => {
    const url = prompt('Enter URL:');
    if (url) {
      applyToActiveEditor(() => {
        insertLink(url);
        updateActiveStyles();
      });
    }
  }, [applyToActiveEditor, updateActiveStyles]);

  const handleBold = useCallback(() => {
    applyToActiveEditor(() => {
      const className = applyBoldStyle();
      if (className) {
        applyClassToSelection(className);
      }
      updateActiveStyles();
    });
  }, [applyToActiveEditor, updateActiveStyles]);

  const handleItalic = useCallback(() => {
    applyToActiveEditor(() => {
      const className = applyItalicStyle();
      if (className) {
        applyClassToSelection(className);
      }
      updateActiveStyles();
    });
  }, [applyToActiveEditor, updateActiveStyles]);

  const handleUnderline = useCallback(() => {
    applyToActiveEditor(() => {
      const className = applyUnderlineStyle();
      if (className) {
        applyClassToSelection(className);
      }
      updateActiveStyles();
    });
  }, [applyToActiveEditor, updateActiveStyles]);

  const handleColor = useCallback(
    (colorValue) => {
      applyToActiveEditor(() => {
        applyClassToSelection({ category: 'color', value: colorValue });
        setShowColorPicker(false);
        updateActiveStyles();
      });
    },
    [applyToActiveEditor, updateActiveStyles]
  );

  const handleFontChange = useCallback(
    (fontName) => {
      setPendingFont(fontName);

      loadGoogleFont(fontName).then(() => {
        applyToActiveEditor(() => {
          applyClassToSelection({ category: 'font', value: fontName });
          updateActiveStyles();
        });

        setPendingFont('');
      });
    },
    [applyToActiveEditor, updateActiveStyles]
  );

  const handleFontSizeChange = useCallback(
    (size) => {
      const normalizedSize = String(size).endsWith('px') ? size : `${size}px`;
      setPendingSize(normalizedSize);

      applyToActiveEditor(() => {
        applyClassToSelection({ category: 'size', value: normalizedSize });
        updateActiveStyles();
      });

      setTimeout(() => {
        setPendingSize('');
      }, 100);
    },
    [applyToActiveEditor, updateActiveStyles]
  );

  const handleTextAlign = useCallback(
    (alignment) => {
      applyToActiveEditor(() => {
        applyClassToSelection(alignment);
        updateActiveStyles();
      });
    },
    [applyToActiveEditor, updateActiveStyles]
  );

  const handleLock = useCallback(() => {
    const editorRefs = Array.from(sharedEditorRefs?.current || []);

    if (activeEditorRef?.current && editorRefs.length === 0) {
      editorRefs.push(activeEditorRef);
    }

    if (editorRefs.length === 0) {
      console.warn('No active editor');
      return;
    }

    for (const editorRef of editorRefs) {
      const editor = editorRef?.current;

      if (editor) {
        editor.contentEditable = 'false';
      }
    }

    setIsLocked(true);
    setShowToolbar(false);
  }, [activeEditorRef, sharedEditorRefs]);

  const handleToggleSourceView = useCallback(() => {
    setShowSourceView(!showSourceView);
  }, [showSourceView]);

  const handleToggleSnippetSelector = useCallback(() => {
    const selection = window.getSelection();
    const activeEditor = activeEditorRef?.current;
    const savedRange = activeEditor && selection?.rangeCount > 0 && activeEditor.contains(selection.anchorNode)
      ? selection.getRangeAt(0).cloneRange()
      : null;
    setSnippetSelection(savedRange);
    setShowSnippetSelector((isOpen) => !isOpen);
  }, [activeEditorRef]);

  const handleSelectUIFramework = useCallback((uiFrameworkId) => {
    if (!updateActiveUIFramework) return;
    // Toggle: if already active, clear override, otherwise set an explicit framework styling mode.
    const newUIFramework = activeUIFramework === uiFrameworkId ? null : uiFrameworkId;
    updateActiveUIFramework(newUIFramework);
  }, [activeUIFramework, updateActiveUIFramework]);

  if (!showToolbar) {
    return null;
  }

  return (
    <>
      <div
        ref={toolbarRef}
        className={`toolbar ${activeUIFramework ? `ui-framework-${activeUIFramework}` : ''} ${isDragging ? 'dragging' : ''}`}
        data-ui-framework={activeUIFramework || 'default'}
        style={{
          top: `${position.top}px`,
          left: position.left !== undefined ? `${position.left}px` : 'auto',
          right: position.left === undefined ? `${position.right}px` : 'auto',
        }}
      >
        <ToolbarContent
        onUndo={handleUndo}
        onRedo={handleRedo}
        onBlockElement={handleBlockElement}
        onList={handleList}
        listStyles={listStyles}
        onListStyleChange={(listType, listStyle) => setListStyles((current) => ({ ...current, [listType]: listStyle }))}
        onInsertCode={handleInsertCode}
        onInsertHR={handleInsertHR}
        onInsertTable={handleInsertTable}
        onInsertImage={handleInsertImage}
        onInsertLink={handleInsertLink}
        onBold={handleBold}
        onItalic={handleItalic}
        onUnderline={handleUnderline}
        onColor={handleColor}
        onFontChange={handleFontChange}
        onFontSizeChange={handleFontSizeChange}
        onTextAlign={handleTextAlign}
        onLock={handleLock}
        onToggleSourceView={handleToggleSourceView}
        onToggleSnippetSelector={handleToggleSnippetSelector}
        onMouseDown={handleMouseDown}
        showCSSPanel={showCSSPanel}
        onCSSPanelToggle={setShowCSSPanel}
        showCSSRules={showCSSRules}
        onCSSRulesToggle={setShowCSSRules}
        showColorPicker={showColorPicker}
        onColorPickerToggle={setShowColorPicker}
        showSnippetSelector={showSnippetSelector}
        detectedStylesheets={detectedStylesheets}
        activeUIFramework={activeUIFramework}
        onSelectUIFramework={handleSelectUIFramework}
        activeStyles={activeStyles}
        pendingSize={pendingSize}
        pendingFont={pendingFont}
        customColors={customColors}
        isLocked={isLocked}
        getValueForIndexedClass={getValueForIndexedClass}
        onAddColor={onAddColor}
        />
      </div>
      <SnippetSelector
        isOpen={showSnippetSelector}
        detectedStylesheets={detectedStylesheets}
        editorRef={activeEditorRef}
        restoreSelection={restoreActiveEditorSelection}
        savedRange={snippetSelection}
        onClose={() => setShowSnippetSelector(false)}
      />
    </>
  );
};
