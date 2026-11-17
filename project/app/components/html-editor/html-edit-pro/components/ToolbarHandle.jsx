/**
 * ToolbarHandle Component
 * Draggable header with lock button for toolbar
 * Provides drag-to-move functionality and lock/unlock controls
 */

import React from 'react';

export const ToolbarHandle = ({ onMouseDown, onLock, isLocked }) => {
  const lockTitle = isLocked ? 'Editor locked (double-click to unlock)' : 'Lock editor (double-click to unlock)';

  return (
    <div className="toolbar-handle" title="Drag to move" onMouseDown={onMouseDown}>
      <button
        className={`toolbar-btn close-btn ${isLocked ? 'active' : ''}`}
        type="button"
        aria-label={lockTitle}
        title={lockTitle}
        onClick={onLock}
      >
        {isLocked ? '🔒' : '🔓'}
      </button>
      <div className="drag-indicator" />
    </div>
  );
};
