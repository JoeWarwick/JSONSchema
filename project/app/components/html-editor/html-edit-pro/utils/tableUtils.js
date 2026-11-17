/**
 * Table Utilities
 * Modernized table manipulation functions based on classic TableMap algorithm
 * Handles insert/delete rows/columns, cell merging, and cell selection
 */

/**
 * TableMap - Builds a flat map of table cells accounting for rowspan/colspan
 * Allows accurate positioning of rows/columns even with spanning cells
 */
export class TableMap {
  constructor(table) {
    this.table = table;
    this.map = null;
    this.rangeStart = null;
    this.rangeEnd = null;
    this.build();
  }

  /**
   * Build the table map from the current table
   */
  build() {
    if (!this.table) {
      this.map = null;
      return;
    }

    const rows = this.table.rows;
    const aMap = [];

    for (let i = 0; i < rows.length; i++) {
      let r = i;
      if (!aMap[r]) aMap[r] = [];

      let c = -1;
      for (let j = 0; j < rows[i].cells.length; j++) {
        const cell = rows[i].cells[j];
        c++;

        // Find next available column
        while (aMap[r][c]) c++;

        const colSpan = cell.colSpan || 1;
        const rowSpan = cell.rowSpan || 1;

        // Fill map for this cell's span
        for (let rs = 0; rs < rowSpan; rs++) {
          if (!aMap[r + rs]) aMap[r + rs] = [];
          for (let cs = 0; cs < colSpan; cs++) {
            aMap[r + rs][c + cs] = cell;
          }
        }
        c += colSpan - 1;
      }
    }

    this.map = aMap;
  }

  /**
   * Set the starting position for range selection
   */
  setRangeStart(cell) {
    this.rangeStart = this.getMapping(cell);
  }

  /**
   * Set the ending position for range selection
   */
  setRangeEnd(cell) {
    this.rangeEnd = this.getMapping(cell);
  }

  /**
   * Get the mapping (position and span) of a cell in the table map
   */
  getMapping(cell) {
    if (!this.map) return null;

    const mapping = {
      colSpan: cell.colSpan || 1,
      rowSpan: cell.rowSpan || 1,
      found: false,
      cell: cell,
    };

    for (let r = 0; r < this.map.length && !mapping.found; r++) {
      for (let c = 0; c < this.map[r].length && !mapping.found; c++) {
        if (cell === this.map[r][c]) {
          mapping.rowIndex = r;
          mapping.colIndex = c;
          mapping.found = true;
        }
      }
    }

    return mapping;
  }

  /**
   * Get all unique cells in a row or column
   */
  getCells(direction) {
    if (!this.map || !this.rangeStart) return [];

    const cells = [];

    if (direction === 'col' || direction === 'column' || direction === 'vertical') {
      // Get column cells
      for (let i = 0; i < this.map.length; i++) {
        const cell = this.map[i][this.rangeStart.colIndex];
        if (i === 0 || cell !== cells[cells.length - 1]) {
          cells.push(cell);
        }
      }
    } else if (direction === 'row' || direction === 'horizontal') {
      // Get row cells
      for (let i = 0; i < this.map[this.rangeStart.rowIndex].length; i++) {
        const cell = this.map[this.rangeStart.rowIndex][i];
        if (i === 0 || cell !== cells[cells.length - 1]) {
          cells.push(cell);
        }
      }
    }

    return cells;
  }

  /**
   * Get row at specific index
   */
  getRowAtIndex(rowIndex) {
    if (rowIndex > this.map.length - 1) return null;
    if (rowIndex === 0) return this.map[rowIndex][0].parentNode;

    for (let i = 0; i < this.map[0].length; i++) {
      if (this.map[rowIndex][i] !== this.map[rowIndex - 1][i]) {
        return this.map[rowIndex][i].parentNode;
      }
    }
    return null;
  }

  /**
   * Get next cell at index in a row
   */
  getNextCellAtIndex(rowIndex) {
    if (this.rangeStart.colIndex > this.map[0].length - 2) return null;
    if (rowIndex === 0) {
      return this.map[rowIndex][this.rangeStart.colIndex].nextSibling;
    }

    for (let i = this.rangeStart.colIndex + 1; i < this.map[rowIndex - 1].length; i++) {
      if (this.map[rowIndex][i] && this.map[rowIndex][i] !== this.map[rowIndex - 1][i]) {
        return this.map[rowIndex][i];
      }
    }
    return null;
  }

  /**
   * Check if range is a rectangular selection
   */
  rangeIsRectangle() {
    if (!this.rangeStart || !this.rangeEnd) return true;

    const startRow =
      this.rangeStart.rowIndex <= this.rangeEnd.rowIndex
        ? this.rangeStart.rowIndex
        : this.rangeEnd.rowIndex;
    const endRow =
      this.rangeStart.rowIndex <= this.rangeEnd.rowIndex
        ? this.rangeEnd.rowIndex + this.rangeEnd.rowSpan - 1
        : this.rangeStart.rowIndex + this.rangeStart.rowSpan - 1;
    const startCol =
      this.rangeStart.colIndex <= this.rangeEnd.colIndex
        ? this.rangeStart.colIndex
        : this.rangeEnd.colIndex;
    const endCol =
      this.rangeStart.colIndex <= this.rangeEnd.colIndex
        ? this.rangeEnd.colIndex + this.rangeEnd.colSpan - 1
        : this.rangeStart.colIndex + this.rangeStart.colSpan - 1;

    for (let c = startCol; c <= endCol; c++) {
      if (
        (startRow > 0 && this.map[startRow][c] === this.map[startRow - 1][c]) ||
        (endRow < this.map.length - 1 && this.map[endRow][c] === this.map[endRow + 1][c])
      ) {
        return false;
      }
    }

    for (let r = startRow; r <= endRow; r++) {
      if (
        (startCol > 0 && this.map[r][startCol] === this.map[r][startCol - 1]) ||
        (endCol < this.map[r].length - 1 && this.map[r][endCol] === this.map[r][endCol + 1])
      ) {
        return false;
      }
    }

    return true;
  }
}

/**
 * Insert a row into the table
 * @param {HTMLTableCellElement} cell - Cell in the table
 * @param {boolean} insertAfter - Insert after (true) or before (false) the current row
 */
export const insertRow = (cell, insertAfter = true) => {
  if (!cell || !['TD', 'TH'].includes(cell.tagName)) return;

  const table = cell.closest('table');
  if (!table) return;

  const row = cell.parentNode;
  const newRow = row.cloneNode(true);
  const map = new TableMap(table);
  map.setRangeStart(cell);

  // Clear new row and adjust rowspans
  for (let i = 0; i < row.cells.length; i++) {
    const rowSpan = row.cells[i].rowSpan || 1;
    if (rowSpan > 1 && insertAfter) {
      row.cells[i].rowSpan = rowSpan + 1;
      newRow.cells[i].remove();
    } else {
      newRow.cells[i].rowSpan = 1;
      newRow.cells[i].innerHTML = '';
    }
  }

  // Handle spanning cells from previous rows
  if (row.rowIndex === 0 && !insertAfter) {
    row.insertAdjacentElement('beforebegin', newRow);
  } else {
    const cells = map.getCells('row');
    for (let i = 0; i < cells.length; i++) {
      const rowSpan = cells[i].rowSpan || 1;
      if (rowSpan > 1) {
        cells[i].rowSpan = rowSpan + 1;
      }
    }

    if (insertAfter) {
      row.insertAdjacentElement('afterend', newRow);
    } else {
      row.insertAdjacentElement('beforebegin', newRow);
    }
  }
};

/**
 * Delete a row from the table
 * @param {HTMLTableCellElement} cell - Cell in the row to delete
 */
export const deleteRow = (cell) => {
  if (!cell || !['TD', 'TH'].includes(cell.tagName)) return;

  const table = cell.closest('table');
  if (!table) return;

  const row = cell.parentNode;
  const map = new TableMap(table);

  // Handle cells that span across the deleted row
  for (let i = 0; i < row.cells.length; i++) {
    const rowSpan = row.cells[i].rowSpan || 1;
    if (rowSpan > 1) {
      map.setRangeStart(row.cells[i]);
      const spanCell = row.cells[i];
      spanCell.remove();

      const newSpanCell = spanCell.cloneNode(true);
      newSpanCell.rowSpan = rowSpan - 1;

      if (map.rangeStart.colIndex + 1 === map.map[0].length) {
        // Add to end of next row
        row.nextSibling?.appendChild(newSpanCell);
      } else {
        // Add before next cell
        const nextCell = map.getNextCellAtIndex(map.rangeStart.rowIndex + 1);
        nextCell?.insertAdjacentElement('beforebegin', newSpanCell);
      }
    }
  }

  // Reduce rowspan for cells spanning the deleted row
  map.setRangeStart(cell);
  const cells = map.getCells('row');
  for (let i = 0; i < cells.length; i++) {
    const rowSpan = cells[i].rowSpan || 1;
    if (rowSpan > 1) {
      cells[i].rowSpan = rowSpan - 1;
    }
  }

  row.remove();
};

/**
 * Insert a column into the table
 * @param {HTMLTableCellElement} cell - Cell in the table
 * @param {boolean} insertAfter - Insert after (true) or before (false) the current column
 */
export const insertColumn = (cell, insertAfter = true) => {
  if (!cell || !['TD', 'TH'].includes(cell.tagName)) return;

  const table = cell.closest('table');
  if (!table) return;

  const map = new TableMap(table);
  map.setRangeStart(cell);
  const cells = map.getCells('col');

  for (let i = 0; i < cells.length; i++) {
    if (!cells[i]) continue;

    const colSpan = cells[i].colSpan || 1;
    if (colSpan > 1) {
      cells[i].colSpan = colSpan + 1;
    } else {
      const newCell = cells[i].cloneNode(false);
      newCell.innerHTML = '';
      if (insertAfter) {
        cells[i].insertAdjacentElement('afterend', newCell);
      } else {
        cells[i].insertAdjacentElement('beforebegin', newCell);
      }
    }
  }
};

/**
 * Delete a column from the table
 * @param {HTMLTableCellElement} cell - Cell in the column to delete
 */
export const deleteColumn = (cell) => {
  if (!cell || !['TD', 'TH'].includes(cell.tagName)) return;

  const table = cell.closest('table');
  if (!table) return;

  const map = new TableMap(table);
  map.setRangeStart(cell);
  const cells = map.getCells('col');

  for (let i = 0; i < cells.length; i++) {
    const colSpan = cells[i].colSpan || 1;
    if (colSpan > 1) {
      cells[i].colSpan = colSpan - 1;
    } else {
      cells[i].remove();
    }
  }
};

/**
 * Merge selected cells
 * @param {Array<HTMLTableCellElement>} cellsToMerge - Array of cells to merge
 */
export const mergeCells = (cellsToMerge) => {
  if (!cellsToMerge || cellsToMerge.length < 2) return;

  const firstCell = cellsToMerge[0];
  const table = firstCell.closest('table');
  if (!table) return;

  const map = new TableMap(table);
  map.setRangeStart(firstCell);

  let totalRowSpan = 0;
  let totalColSpan = 0;
  let innerHTML = '';

  // Calculate total span
  for (let i = 0; i < cellsToMerge.length; i++) {
    const mapping = map.getMapping(cellsToMerge[i]);
    if (i === 0 || cellsToMerge[i].parentNode !== cellsToMerge[i - 1].parentNode) {
      totalRowSpan += mapping.rowSpan;
    }
  }

  // Get unique cells in first row for colspan
  const firstRowCells = new Set();
  for (let i = 0; i < cellsToMerge.length; i++) {
    const mapping = map.getMapping(cellsToMerge[i]);
    if (mapping) {
      firstRowCells.add(cellsToMerge[i]);
    }
  }
  totalColSpan = firstRowCells.size > 0 ? firstRowCells.size : 1;

  // Merge content and remove cells
  for (let i = 0; i < cellsToMerge.length; i++) {
    if (cellsToMerge[i] !== firstCell) {
      innerHTML += cellsToMerge[i].innerHTML;
      cellsToMerge[i].remove();
    }
  }

  // Apply spans and merged content
  firstCell.colSpan = totalColSpan;
  firstCell.rowSpan = totalRowSpan;
  firstCell.innerHTML += innerHTML;
};

/**
 * Check if cursor is inside a table cell
 * @returns {HTMLTableCellElement|null}
 */
export const getCursorTableCell = () => {
  const selection = window.getSelection();
  if (selection.rangeCount === 0) return null;

  let node = selection.focusNode;
  while (node && node !== document.body) {
    if (node.tagName === 'TD' || node.tagName === 'TH') {
      return node;
    }
    node = node.parentNode;
  }
  return null;
};

/**
 * Get the table containing a cell
 * @param {HTMLTableCellElement} cell - Table cell
 * @returns {HTMLTableElement|null}
 */
export const getTableFromCell = (cell) => {
  if (!cell) return null;
  return cell.closest('table');
};

/**
 * Split a cell vertically (left/right) into 2 cells
 * Divides colspan between the two cells, increases other cells' colspan in affected columns
 * @param {HTMLTableCellElement} cell - Cell to split
 */
export const splitCellVertically = (cell) => {
  if (!cell) return;

  const table = getTableFromCell(cell);
  if (!table) return;

  const map = new TableMap(table);
  const cellMapping = map.getMapping(cell);
  if (!cellMapping.found) return;

  const originalColSpan = cellMapping.colSpan;
  const rowSpan = cellMapping.rowSpan;
  const rowIndex = cellMapping.rowIndex;
  const colIndex = cellMapping.colIndex;

  // Create new cell with half the colspan (or 1 if original was 1)
  const newCell = cell.ownerDocument.createElement(cell.tagName);
  newCell.rowSpan = rowSpan;
  
  // If colspan is 1, both cells get 1 colspan and we need to increase surrounding cells
  // If colspan > 1, divide it
  if (originalColSpan === 1) {
    cell.colSpan = 1;
    newCell.colSpan = 1;
  } else {
    const newColSpan = Math.ceil(originalColSpan / 2);
    cell.colSpan = newColSpan;
    newCell.colSpan = originalColSpan - newColSpan;
  }
  
  // Insert new cell after current cell
  cell.parentNode.insertBefore(newCell, cell.nextSibling);

  // If original colspan was 1, increase all OTHER cells that span across this column
  if (originalColSpan === 1) {
    // Check ALL rows in the table
    for (let r = 0; r < table.rows.length; r++) {
      const row = table.rows[r];
      if (!row) continue;

      // Find cells that span across this column
      for (let c = 0; c < row.cells.length; c++) {
        const otherCell = row.cells[c];
        
        // Skip the original cell we're splitting
        if (otherCell === cell || otherCell === newCell) continue;
        
        // Find this cell's column position in the map
        let otherColStart = -1;
        for (let i = 0; i < map.map.length; i++) {
          for (let j = 0; j < map.map[i].length; j++) {
            if (map.map[i][j] === otherCell) {
              otherColStart = j;
              break;
            }
          }
          if (otherColStart !== -1) break;
        }

        if (otherColStart !== -1) {
          const otherColSpan = otherCell.colSpan || 1;
          const otherColEnd = otherColStart + otherColSpan - 1;
          
          // If this cell spans across the split column, increase its colspan
          if (otherColStart <= colIndex && otherColEnd >= colIndex) {
            otherCell.colSpan = otherColSpan + 1;
          }
        }
      }
    }
  }
};

/**
 * Split a cell horizontally (top/bottom) into 2 cells
 * Divides rowspan between the two cells, increases other cells' rowspan in affected rows
 * @param {HTMLTableCellElement} cell - Cell to split
 */
export const splitCellHorizontally = (cell) => {
  if (!cell) return;

  const table = getTableFromCell(cell);
  if (!table) return;

  const map = new TableMap(table);
  const cellMapping = map.getMapping(cell);
  if (!cellMapping.found) return;

  const originalRowSpan = cellMapping.rowSpan;
  const colSpan = cellMapping.colSpan;
  const rowIndex = cellMapping.rowIndex;
  const colIndex = cellMapping.colIndex;

  // If rowspan is 1, both cells get 1 rowspan and we insert a new row
  if (originalRowSpan === 1) {
    // Create new row after current row
    const newRow = table.insertRow(rowIndex + 1);
    
    // Set original cell's rowspan to 1
    cell.rowSpan = 1;
    
    // Create new cell in the new row
    const newCell = table.ownerDocument.createElement(cell.tagName);
    newCell.colSpan = colSpan;
    newCell.rowSpan = 1;
    newCell.innerHTML = '';
    newRow.appendChild(newCell);
    
    // Increase rowspan of all OTHER cells in the same row that should span the new row
    for (let cellIdx = 0; cellIdx < table.rows[rowIndex].cells.length; cellIdx++) {
      const otherCell = table.rows[rowIndex].cells[cellIdx];
      
      // Skip the original cell being split
      if (otherCell === cell) continue;
      
      // Increase rowspan for any other cell in the same row
      const otherRowSpan = otherCell.rowSpan || 1;
      otherCell.rowSpan = otherRowSpan + 1;
    }
  } else {
    // If rowspan > 1, divide it between original and new
    const newRowSpan = Math.ceil(originalRowSpan / 2);
    
    // Create new row at the midpoint
    const insertRowIndex = rowIndex + newRowSpan;
    const newRow = table.insertRow(insertRowIndex);
    
    // Update original cell's rowspan
    cell.rowSpan = newRowSpan;
    
    // Create new cell with remaining rowspan
    const newCell = table.ownerDocument.createElement(cell.tagName);
    newCell.colSpan = colSpan;
    newCell.rowSpan = originalRowSpan - newRowSpan;
    newCell.innerHTML = '';
    newRow.appendChild(newCell);
  }
};
