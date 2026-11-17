/**
 * TableContextMenu Component
 * Context menu for table editing operations
 */

import React, { useEffect, useRef } from 'react';
import './TableContextMenu.css';

export const TableContextMenu = ({ position, onOperation, onClose, selectedCellCount = 1 }) => {
  const menuRef = useRef(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose?.();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Close menu on escape
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleOperation = (operation) => {
    onOperation?.(operation);
    onClose?.();
  };

  return (
    <div
      ref={menuRef}
      className="table-context-menu"
      style={{
        position: 'fixed',
        top: `${position.y}px`,
        left: `${position.x}px`,
      }}
    >
      <div className="menu-section">
        <button
          className="menu-item"
          onClick={() => handleOperation('insertRowAbove')}
          title="Insert row above current"
        >
          Insert Row Above
        </button>
        <button
          className="menu-item"
          onClick={() => handleOperation('insertRowBelow')}
          title="Insert row below current"
        >
          Insert Row Below
        </button>
        <button
          className="menu-item danger"
          onClick={() => handleOperation('deleteRow')}
          title="Delete current row"
        >
          Delete Row
        </button>
      </div>

      <div className="menu-divider"></div>

      <div className="menu-section">
        <button
          className="menu-item"
          onClick={() => handleOperation('insertColLeft')}
          title="Insert column to the left"
        >
          Insert Column Left
        </button>
        <button
          className="menu-item"
          onClick={() => handleOperation('insertColRight')}
          title="Insert column to the right"
        >
          Insert Column Right
        </button>
        <button
          className="menu-item danger"
          onClick={() => handleOperation('deleteCol')}
          title="Delete current column"
        >
          Delete Column
        </button>
      </div>

      <div className="menu-divider"></div>

      <div className="menu-divider"></div>

      <div className="menu-section">
        <button
          className="menu-item"
          onClick={() => handleOperation('splitCellVertically')}
          title="Split cell left/right"
        >
          Split Cell Vertically
        </button>
        <button
          className="menu-item"
          onClick={() => handleOperation('splitCellHorizontally')}
          title="Split cell top/bottom"
        >
          Split Cell Horizontally
        </button>
      </div>
    </div>
  );
};
