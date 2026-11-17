/**
 * Editor Component
 * Main contentEditable editor with keyboard shortcuts
 */

import { useEffect, useRef, useState, forwardRef } from 'react';
import { setupKeyboardShortcuts, getEditorHTML, setEditorHTML } from '../utils/editorHelpers';
import { sanitizeEditorHTML } from '../utils/htmlSanitizer';
import { getCursorTableCell, insertRow, deleteRow, insertColumn, deleteColumn, mergeCells, splitCellVertically, splitCellHorizontally } from '../utils/tableUtils';
import { useTableSelection } from '../hooks/useTableSelection';
import { TableContextMenu } from './TableContextMenu';
import './Editor.css';

export const Editor = forwardRef(({
  content,
  onContentChange,
  onSelection,
  onEditorFocus,
  onUnlock,
  readOnly = false,
  placeholder = '',
  ariaLabel = 'HTML Editor',
}, ref) => {
  const editorRef = useRef(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedCell, setSelectedCell] = useState(null);
  const tableSelection = useTableSelection();
  const lastExternalContentRef = useRef(null); // Initialize to null to force first update

  /**
   * Forward ref to parent component
   */
  useEffect(() => {
    if (ref) {
      if (typeof ref === 'function') {
        ref(editorRef.current);
      } else {
        ref.current = editorRef.current;
      }
    }
  }, [ref]);

  /**
   * Set initial content when component mounts or content prop changes
   * Only update from parent if content actually changed from external source (not user typing)
   */
  useEffect(() => {
    if (!editorRef.current) return;
    
    // Only update if content actually changed from outside
    if (content !== lastExternalContentRef.current) {
      lastExternalContentRef.current = content;
      
      // Check if cursor is in a table cell
      const selection = window.getSelection();
      let node = selection.focusNode;
      let inTableCell = false;
      
      while (node && node !== document.body && node !== document.documentElement) {
        if (node.nodeName === 'TD' || node.nodeName === 'TH') {
          inTableCell = true;
          break;
        }
        node = node.parentNode;
      }
      
      // Only update content if NOT in a table cell
      if (!inTableCell) {
        setEditorHTML(editorRef.current, content);
      }
    }
  }, [content]);

  /**
   * Setup keyboard shortcuts
   */
  useEffect(() => {
    if (!editorRef.current) return;

    const cleanup = setupKeyboardShortcuts(editorRef.current, (action) => {
      console.log('Keyboard shortcut applied:', action);
    });

    return cleanup;
  }, []);

  /**
   * Handle input changes - skip for table cells
   */
  const handleInput = () => {
    // Check if cursor is in a table cell
    const selection = window.getSelection();
    let node = selection.focusNode;
    let inTableCell = false;
    
    while (node && node !== document.body && node !== document.documentElement) {
      if (node.nodeName === 'TD' || node.nodeName === 'TH') {
        inTableCell = true;
        break;
      }
      node = node.parentNode;
    }
    
    // Only call onContentChange if NOT in a table cell
    if (!inTableCell && editorRef.current) {
      const html = getEditorHTML(editorRef.current);
      lastExternalContentRef.current = html;
      onContentChange?.(html);
    }
    
  };

  /**
   * Handle paste events - preserve formatting
   */
  const handlePaste = (e) => {
    e.preventDefault();

    const clipboardData = e.clipboardData;
    const html = clipboardData?.getData('text/html');
    const text = clipboardData?.getData('text/plain') || '';
    const selection = window.getSelection();

    if (!selection || !editorRef.current) return;

    const range = selection.rangeCount > 0
      ? selection.getRangeAt(0)
      : document.createRange();

    if (!selection.rangeCount) {
      range.selectNodeContents(editorRef.current);
      range.collapse(false);
    }

    range.deleteContents();

    if (html) {
      const tempContainer = document.createElement('div');
      tempContainer.innerHTML = sanitizeEditorHTML(html);
      const fragment = document.createDocumentFragment();
      while (tempContainer.firstChild) {
        fragment.appendChild(tempContainer.firstChild);
      }
      range.insertNode(fragment);
    } else if (text) {
      range.insertNode(document.createTextNode(text));
    }

    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);

    setTimeout(() => {
      handleInput();
    }, 0);
  };

  /**
   * Handle text selection - save it for later use and capture content changes
   * Skip for table cells to prevent cursor jumping
   */
  const handleMouseUp = () => {
    // Check if cursor is in a table cell
    const selection = window.getSelection();
    let node = selection.focusNode;
    let inTableCell = false;
    
    while (node && node !== document.body && node !== document.documentElement) {
      if (node.nodeName === 'TD' || node.nodeName === 'TH') {
        inTableCell = true;
        break;
      }
      node = node.parentNode;
    }
    
    // Only update selection if NOT in a table cell
    if (!inTableCell) {
      onSelection?.(editorRef.current);
    }
    // If in table cell, do nothing - let contentEditable handle it
  };

  /**
   * Handle key release - save selection and capture content
   * Skip for table cells to prevent cursor jumping
   */
  const handleKeyUp = () => {
    // Check if cursor is inside a table cell - if so, skip ALL handlers
    const selection = window.getSelection();
    let node = selection.focusNode;
    let inTableCell = false;
    
    while (node && node !== document.body && node !== document.documentElement) {
      if (node.nodeName === 'TD' || node.nodeName === 'TH') {
        inTableCell = true;
        break;
      }
      node = node.parentNode;
    }
    
    // Only update selection and capture content if NOT in a table cell
    if (!inTableCell) {
      onSelection?.(editorRef.current);
      handleInput();
    }
    // If in table cell, do nothing - let contentEditable handle it
  };

  /**
   * Handle right-click context menu for table operations
   */
  const handleContextMenu = (e) => {
    const cell = getCursorTableCell();
    if (!cell) return;

    e.preventDefault();
    setSelectedCell(cell);
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
    });
  };

  /**
   * Handle table cell mouse down - start selection
   */
  const handleTableCellMouseDown = (e) => {
    // Ignore right-click (button 2) to preserve selection for context menu
    if (e.button === 2) return;
    
    const cell = e.target.closest('td, th');
    if (!cell) return;

    // Start new selection or extend with Shift
    tableSelection.startSelection(cell, e.shiftKey);
  };

  /**
   * Handle table cell mouse over - update drag selection
   */
  const handleTableCellMouseOver = (e) => {
    const cell = e.target.closest('td, th');
    if (!cell || !tableSelection.isSelecting) return;

    tableSelection.updateSelection(cell);
  };

  /**
   * Handle mouse up - end table selection and update editor selection
   */
  const handleMouseUpCombined = () => {
    tableSelection.endSelection();
    // Also handle editor selection for non-table operations
    onSelection?.(editorRef.current);
  };

  /**
   * Execute table operations from context menu
   */
  const handleTableOperation = (operation) => {
    if (!selectedCell) return;

    // Use selected cells for operations, or fall back to single cell
    const cellsToUse = tableSelection.selectedCells.length > 0 
      ? tableSelection.selectedCells 
      : [selectedCell];

    try {
      switch (operation) {
        case 'insertRowAbove':
          insertRow(selectedCell, false);
          break;
        case 'insertRowBelow':
          insertRow(selectedCell, true);
          break;
        case 'deleteRow':
          deleteRow(selectedCell);
          break;
        case 'insertColLeft':
          insertColumn(selectedCell, false);
          break;
        case 'insertColRight':
          insertColumn(selectedCell, true);
          break;
        case 'deleteCol':
          deleteColumn(selectedCell);
          break;
        case 'mergeCells':
          // Only allow merge if multiple cells are selected
          if (cellsToUse.length > 1) {
            mergeCells(cellsToUse);
          } else {
            console.warn('Select multiple cells to merge');
          }
          break;
        case 'splitCellVertically':
          splitCellVertically(selectedCell);
          break;
        case 'splitCellHorizontally':
          splitCellHorizontally(selectedCell);
          break;
      }

      // Update content after table operation
      if (editorRef.current) {
        const html = getEditorHTML(editorRef.current);
        onContentChange?.(html);
      }

      // Clear selection after operation
      tableSelection.clearSelection();
    } finally {
      setContextMenu(null);
      setSelectedCell(null);
    }
  };

  /**
   * Close context menu
   */
  const closeContextMenu = () => {
    setContextMenu(null);
    setSelectedCell(null);
  };

  /**
   * Handle double-click to unlock editor
   */
  const handleDoubleClick = () => {
    if (editorRef.current && editorRef.current.contentEditable === 'false') {
      editorRef.current.contentEditable = 'true';
      editorRef.current.focus();
      onUnlock?.();
      // Dispatch event to notify toolbar that editor is unlocked
      editorRef.current.dispatchEvent(new Event('unlock', { bubbles: true }));
    }
  };

  return (
    <>
      <div
        ref={editorRef}
        className="editor"
        contentEditable={!readOnly}
        suppressContentEditableWarning
        spellCheck="true"
        onInput={handleInput}
        onPaste={handlePaste}
        onMouseUp={handleMouseUpCombined}
        onKeyUp={handleKeyUp}
        onContextMenu={handleContextMenu}
        onMouseDown={handleTableCellMouseDown}
        onMouseOver={handleTableCellMouseOver}
        onDoubleClick={handleDoubleClick}
        onFocus={onEditorFocus}
        aria-label={ariaLabel}
        aria-placeholder={placeholder}
        role="textbox"
        aria-multiline="true"
      />
      {contextMenu && (
        <TableContextMenu
          position={contextMenu}
          onOperation={handleTableOperation}
          onClose={closeContextMenu}
          selectedCellCount={tableSelection.selectedCells.length}
        />
      )}
    </>
  );
});

Editor.displayName = 'Editor';
