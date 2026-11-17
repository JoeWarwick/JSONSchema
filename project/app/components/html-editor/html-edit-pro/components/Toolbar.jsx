/**
 * Toolbar Component
 * Floating toolbar with HTML structure and CSS styling controls
 * Uses ToolbarContent for shared UI rendering
 */

import React, { useState, useEffect, useCallback, useContext } from 'react';
import { ToolbarContext } from '../contexts/ToolbarContext';
import { ToolbarContent } from './ToolbarContent';
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
  applyBoldStyle,
  applyItalicStyle,
  applyUnderlineStyle,
  getIndexedClassMap,
} from '../utils/cssGenerator';
import { AVAILABLE_FONTS, loadGoogleFont } from '../utils/fontManager';
import './Toolbar.css';

export const Toolbar = ({
  editorRef,
  customColors,
  onAddColor,
  onToggleSourceView,
  onImportHTML,
  onToggleSnippetSelector,
  detectedStylesheets,
  restoreSelection,
  editorId,
  startLocked = false,
  toolbarVisible,
}) => {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showCSSPanel, setShowCSSPanel] = useState(false);
  const [showCSSRules, setShowCSSRules] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [position, setPosition] = useState({ top: 0, right: 0 });
  const [isLocked, setIsLocked] = useState(startLocked);
  const [activeStyles, setActiveStyles] = useState({});
  const [pendingSize, setPendingSize] = useState('');
  const [pendingFont, setPendingFont] = useState('');
  const [listStyles, setListStyles] = useState({ ul: 'disc', ol: 'decimal' });
  const [localActiveUIFramework, setLocalActiveUIFramework] = useState(undefined);
  // Safely read ToolbarContext; allow Toolbar to be used without a provider
  const _ctx = useContext(ToolbarContext) || {};
  const contextActiveUIFramework = _ctx.activeUIFramework;
  const updateActiveUIFramework = typeof _ctx.updateActiveUIFramework === 'function' ? _ctx.updateActiveUIFramework : null;
  const detectedPrimaryUIFramework = getPrimaryDetectedFramework(detectedStylesheets);
  // If contextActiveUIFramework is undefined, fall back to detectedPrimaryUIFramework. If it's null, treat as explicit 'none' for framework styling.
  const activeUIFramework = contextActiveUIFramework !== undefined
    ? contextActiveUIFramework
    : localActiveUIFramework !== undefined
      ? localActiveUIFramework
      : detectedPrimaryUIFramework;

  const handleSelectUIFramework = useCallback((uiFrameworkId) => {
    const newUIFramework = activeUIFramework === uiFrameworkId ? null : uiFrameworkId;
    if (updateActiveUIFramework) {
      updateActiveUIFramework(newUIFramework);
    } else {
      setLocalActiveUIFramework(newUIFramework);
    }
  }, [activeUIFramework, updateActiveUIFramework]);

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
   * Position the toolbar at the editor's top-right edge when unlocked.
   */
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
      }
    };

    document.addEventListener('unlock', handleUnlock);
    return () => {
      document.removeEventListener('unlock', handleUnlock);
    };
  }, []);

  /**
   * Handle dragging
   */
  useEffect(() => {
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

  /**
   * Track active styles when selection changes
   */
  useEffect(() => {
    const editor = document.querySelector('[contenteditable="true"]');
    if (!editor) return;

    const updateActiveStyles = () => {
      const styles = getActiveStylesFromSelection();
      setActiveStyles(styles);
    };

    document.addEventListener('mouseup', updateActiveStyles);
    document.addEventListener('keyup', updateActiveStyles);
    editor.addEventListener('click', updateActiveStyles);

    return () => {
      document.removeEventListener('mouseup', updateActiveStyles);
      document.removeEventListener('keyup', updateActiveStyles);
      editor.removeEventListener('click', updateActiveStyles);
    };
  }, []);

  /**
   * Helper to apply formatting and notify editor
   */
  const applyFormattingToEditor = useCallback((action) => {
    action();
    const editor = document.querySelector('[contenteditable="true"]');
    if (editor) {
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, []);

  const handleUndo = useCallback(() => {
    applyFormattingToEditor(() => document.execCommand('undo'));
  }, [applyFormattingToEditor]);

  const handleRedo = useCallback(() => {
    applyFormattingToEditor(() => document.execCommand('redo'));
  }, [applyFormattingToEditor]);

  /**
   * Get value for indexed class
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
      applyFormattingToEditor(() => {
        applyBlockElement(element, activeUIFramework);
      });
    },
    [applyFormattingToEditor, activeUIFramework]
  );

  const handleList = useCallback(
    (listType, listStyle) => {
      restoreSelection?.();
      applyFormattingToEditor(() => {
        applyList(listType, listStyle);
      });
    },
    [applyFormattingToEditor, restoreSelection]
  );

  const handleInsertCode = useCallback(() => {
    insertCodeBlock();
  }, []);

  const handleInsertHR = useCallback(() => {
    insertHorizontalRule();
  }, []);

  const handleInsertTable = useCallback(() => {
    insertTable(2, 2);
  }, []);

  const handleInsertImage = useCallback(() => {
    const url = prompt('Enter image URL:');
    if (url) {
      insertImage(url);
    }
  }, []);

  const handleInsertLink = useCallback(() => {
    const url = prompt('Enter URL:');
    if (url) {
      insertLink(url);
    }
  }, []);

  const handleBold = useCallback(() => {
    applyFormattingToEditor(() => {
      const className = applyBoldStyle();
      if (className) {
        applyClassToSelection(className);
      }
    });
  }, [applyFormattingToEditor]);

  const handleItalic = useCallback(() => {
    applyFormattingToEditor(() => {
      const className = applyItalicStyle();
      if (className) {
        applyClassToSelection(className);
      }
    });
  }, [applyFormattingToEditor]);

  const handleUnderline = useCallback(() => {
    applyFormattingToEditor(() => {
      const className = applyUnderlineStyle();
      if (className) {
        applyClassToSelection(className);
      }
    });
  }, [applyFormattingToEditor]);

  const handleColor = useCallback(
    (colorValue) => {
      restoreSelection?.();
      applyFormattingToEditor(() => {
        applyClassToSelection({ category: 'color', value: colorValue });
      });
    },
    [applyFormattingToEditor, restoreSelection]
  );

  const handleFontChange = useCallback(
    (fontName) => {
      setPendingFont(fontName);

      loadGoogleFont(fontName).then(() => {
        const fontObj = AVAILABLE_FONTS.find((f) => f.name === fontName);
        if (fontObj && fontObj.family !== 'system-ui') {
          restoreSelection?.();
          applyFormattingToEditor(() => {
            applyClassToSelection({ category: 'font', value: fontName });
          });
        }

        setPendingFont('');
      });
    },
    [applyFormattingToEditor, restoreSelection]
  );

  const handleFontSizeChange = useCallback(
    (size) => {
      const normalizedSize = String(size).endsWith('px') ? size : `${size}px`;
      setPendingSize(normalizedSize);

      restoreSelection?.();
      applyFormattingToEditor(() => {
        applyClassToSelection({ category: 'size', value: normalizedSize });
      });

      setTimeout(() => {
        setPendingSize('');
      }, 100);
    },
    [applyFormattingToEditor, restoreSelection]
  );

  const handleTextAlign = useCallback(
    (alignment) => {
      restoreSelection?.();
      applyFormattingToEditor(() => {
        applyClassToSelection(alignment);
      });
    },
    [applyFormattingToEditor, restoreSelection]
  );

  const handleLock = useCallback(() => {
    let editor = editorRef?.current;

    if (editor) {
      editor.contentEditable = 'false';
      setIsLocked(true);
    }
  }, [editorRef]);

  const isToolbarVisible = (typeof toolbarVisible === 'boolean' ? toolbarVisible : !startLocked) && !isLocked;

  if (!isToolbarVisible) {
    return null;
  }

  // If a shared toolbar is active elsewhere, hide single editor toolbar
  if (typeof window !== 'undefined' && window.__sharedToolbarActive) {
    return null;
  }

  return (
    <div
      className={`toolbar ${activeUIFramework ? `ui-framework-${activeUIFramework}` : ''} ${isDragging ? 'dragging' : ''}`}
      data-ui-framework={activeUIFramework || 'default'}
      ref={toolbarRef}
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
        onToggleSourceView={onToggleSourceView}
        onToggleSnippetSelector={onToggleSnippetSelector}
        onMouseDown={handleMouseDown}
        showCSSPanel={showCSSPanel}
        onCSSPanelToggle={setShowCSSPanel}
        showCSSRules={showCSSRules}
        onCSSRulesToggle={setShowCSSRules}
        showColorPicker={showColorPicker}
        onColorPickerToggle={setShowColorPicker}
        showSnippetSelector={false}
        detectedStylesheets={detectedStylesheets}
        activeUIFramework={activeUIFramework}
        onSelectUIFramework={handleSelectUIFramework}
        activeStyles={activeStyles}
        pendingSize={pendingSize}
        pendingFont={pendingFont}
        customColors={customColors || []}
        isLocked={isLocked}
        getValueForIndexedClass={getValueForIndexedClass}
        restoreSelection={restoreSelection}
        onAddColor={onAddColor}
      />
    </div>
  );
};
