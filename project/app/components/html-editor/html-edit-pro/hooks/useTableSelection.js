/**
 * useTableSelection Hook
 * Manages cell selection state for table editing with visual feedback
 */

import { useState, useCallback, useEffect } from 'react';
import { TableMap, getCursorTableCell, getTableFromCell } from '../utils/tableUtils';

const SELECTION_CLASS = 'cell-selected';
const SELECTION_HIGHLIGHT_CLASS = 'cell-highlight';

export const useTableSelection = () => {
  const [selectedCells, setSelectedCells] = useState([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const [tableMap, setTableMap] = useState(null);
  const [table, setTable] = useState(null);
  const [selectionStart, setSelectionStart] = useState(null);
  const [lastShiftCell, setLastShiftCell] = useState(null);

  /**
   * Apply visual highlighting to cells
   */
  const highlightCells = useCallback((cells) => {
    // Remove previous highlights
    document.querySelectorAll(`.${SELECTION_CLASS}`).forEach((cell) => {
      cell.classList.remove(SELECTION_CLASS);
      cell.style.backgroundColor = '';
    });

    // Apply new highlights
    cells.forEach((cell) => {
      cell.classList.add(SELECTION_CLASS);
      cell.style.backgroundColor = 'rgba(59, 130, 246, 0.2)'; // Light blue
    });
  }, []);

  /**
   * Start cell selection (single cell or begin drag)
   */
  const startSelection = useCallback(
    (cell, shiftKey = false) => {
      if (!cell || !['TD', 'TH'].includes(cell.tagName)) return;

      const tableEl = getTableFromCell(cell);
      if (!tableEl) return;

      // If Shift key pressed and we have a start point, extend selection
      if (shiftKey && selectionStart) {
        extendSelection(cell);
        return;
      }

      // Otherwise start new selection
      const map = new TableMap(tableEl);
      map.setRangeStart(cell);

      setIsSelecting(true);
      setTable(tableEl);
      setTableMap(map);
      setSelectionStart(map.rangeStart);
      setLastShiftCell(cell);
      setSelectedCells([cell]);
      highlightCells([cell]);
    },
    [selectionStart, highlightCells]
  );

  /**
   * Extend selection with Shift+Click
   */
  const extendSelection = useCallback(
    (endCell) => {
      if (!tableMap || !selectionStart || !endCell) return;

      tableMap.setRangeEnd(endCell);

      if (!tableMap.rangeIsRectangle?.()) return;

      // Calculate range bounds
      const startRow =
        selectionStart.rowIndex <= tableMap.rangeEnd.rowIndex
          ? selectionStart.rowIndex
          : tableMap.rangeEnd.rowIndex;
      const endRow =
        selectionStart.rowIndex <= tableMap.rangeEnd.rowIndex
          ? tableMap.rangeEnd.rowIndex + tableMap.rangeEnd.rowSpan - 1
          : selectionStart.rowIndex + selectionStart.rowSpan - 1;

      const startCol =
        selectionStart.colIndex <= tableMap.rangeEnd.colIndex
          ? selectionStart.colIndex
          : tableMap.rangeEnd.colIndex;
      const endCol =
        selectionStart.colIndex <= tableMap.rangeEnd.colIndex
          ? tableMap.rangeEnd.colIndex + tableMap.rangeEnd.colSpan - 1
          : selectionStart.colIndex + selectionStart.colSpan - 1;

      const cells = [];
      const seen = new Set();

      for (let r = startRow; r <= endRow; r++) {
        for (let c = startCol; c <= endCol; c++) {
          const cell = tableMap.map[r][c];
          if (cell && !seen.has(cell)) {
            cells.push(cell);
            seen.add(cell);
          }
        }
      }

      setSelectedCells(cells);
      setLastShiftCell(endCell);
      highlightCells(cells);
    },
    [tableMap, selectionStart, highlightCells]
  );

  /**
   * Update selection during drag
   */
  const updateSelection = useCallback(
    (endCell) => {
      if (!isSelecting || !tableMap || !selectionStart || !endCell) return;
      if (!['TD', 'TH'].includes(endCell.tagName)) return;

      tableMap.setRangeEnd(endCell);

      if (!tableMap.rangeIsRectangle?.()) return;

      // Get all cells in the rectangular range
      const startRow =
        selectionStart.rowIndex <= tableMap.rangeEnd.rowIndex
          ? selectionStart.rowIndex
          : tableMap.rangeEnd.rowIndex;
      const endRow =
        selectionStart.rowIndex <= tableMap.rangeEnd.rowIndex
          ? tableMap.rangeEnd.rowIndex + tableMap.rangeEnd.rowSpan - 1
          : selectionStart.rowIndex + selectionStart.rowSpan - 1;

      const startCol =
        selectionStart.colIndex <= tableMap.rangeEnd.colIndex
          ? selectionStart.colIndex
          : tableMap.rangeEnd.colIndex;
      const endCol =
        selectionStart.colIndex <= tableMap.rangeEnd.colIndex
          ? tableMap.rangeEnd.colIndex + tableMap.rangeEnd.colSpan - 1
          : selectionStart.colIndex + selectionStart.colSpan - 1;

      const cells = [];
      const seen = new Set();

      for (let r = startRow; r <= endRow; r++) {
        for (let c = startCol; c <= endCol; c++) {
          const cell = tableMap.map[r][c];
          if (cell && !seen.has(cell)) {
            cells.push(cell);
            seen.add(cell);
          }
        }
      }

      setSelectedCells(cells);
      highlightCells(cells);
    },
    [isSelecting, tableMap, selectionStart, highlightCells]
  );

  /**
   * End selection
   */
  const endSelection = useCallback(() => {
    setIsSelecting(false);
    // Keep selection visible after drag ends
  }, []);

  /**
   * Clear selection and visual highlighting
   */
  const clearSelection = useCallback(() => {
    document.querySelectorAll(`.${SELECTION_CLASS}`).forEach((cell) => {
      cell.classList.remove(SELECTION_CLASS);
      cell.style.backgroundColor = '';
    });

    setSelectedCells([]);
    setTable(null);
    setTableMap(null);
    setSelectionStart(null);
    setLastShiftCell(null);
  }, []);

  /**
   * Get currently selected cells
   */
  const getSelectedCells = useCallback(() => selectedCells, [selectedCells]);

  /**
   * Check if a cell is selected
   */
  const isCellSelected = useCallback(
    (cell) => selectedCells.includes(cell),
    [selectedCells]
  );

  /**
   * Cleanup highlights on unmount
   */
  useEffect(() => {
    return () => {
      clearSelection();
    };
  }, [clearSelection]);

  return {
    selectedCells,
    isSelecting,
    table,
    startSelection,
    updateSelection,
    endSelection,
    extendSelection,
    clearSelection,
    getSelectedCells,
    isCellSelected,
  };
};
