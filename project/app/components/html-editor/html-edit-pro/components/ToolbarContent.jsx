/**
 * ToolbarContent Component
 * Shared toolbar UI and controls used by both Toolbar and SharedToolbar
 * Handles rendering of buttons, panels, and styling controls
 */

import React from 'react';
import { ToolbarHandle } from './ToolbarHandle';
import { CORE_COLORS, CORE_COLOR_NAMES } from '../utils/colorPalette';
import { AVAILABLE_FONTS } from '../utils/fontManager';

export const ToolbarContent = ({
  // Handlers
  onUndo,
  onRedo,
  onBlockElement,
  onList,
  listStyles,
  onListStyleChange,
  onInsertCode,
  onInsertHR,
  onInsertTable,
  onInsertImage,
  onInsertLink,
  onBold,
  onItalic,
  onUnderline,
  onColor,
  onFontChange,
  onFontSizeChange,
  onTextAlign,
  onLock,
  onToggleSourceView,
  onToggleSnippetSelector,
  onMouseDown,
  
  // State
  showCSSPanel,
  onCSSPanelToggle,
  showCSSRules,
  onCSSRulesToggle,
  showColorPicker,
  onColorPickerToggle,
  showSnippetSelector,
  detectedStylesheets,
  activeUIFramework,
  onSelectUIFramework,
  activeStyles,
  pendingSize,
  pendingFont,
  customColors,
  isLocked,
  
  // Utilities
  getValueForIndexedClass,
  restoreSelection,
  onAddColor,
}) => {
  const isUIFrameworkAware = !!activeUIFramework;

  const getFontLabel = (font) => {
    if (!isUIFrameworkAware) return font.name;

    const uiFrameworkFontClass = font.family === 'Georgia' || font.family === 'Playfair Display'
      ? 'font-serif'
      : font.family === 'Courier New'
        ? 'font-mono'
        : 'font-sans';

    return `${font.name} (${uiFrameworkFontClass})`;
  };

  const getSizeLabel = (size) => {
    if (!isUIFrameworkAware) return size;

    const sizeClassMap = {
      '12px': 'text-xs',
      '14px': 'text-sm',
      '16px': 'text-base',
      '18px': 'text-lg',
      '20px': 'text-xl',
      '24px': 'text-2xl',
      '28px': 'text-3xl',
      '32px': 'text-4xl',
    };

    return `${size} (${sizeClassMap[size] || `text-[${size}]`})`;
  };

  return (
    <>
      {/* Drag Handle */}
      <ToolbarHandle
        onMouseDown={onMouseDown}
        onLock={onLock}
        isLocked={isLocked}
      />

      {/* HTML Structure Section */}
      <div className="toolbar-section">
        <button
          className="toolbar-btn"
          title="Undo (Ctrl+Z)"
          onClick={onUndo}
        >
          <i className="fas fa-undo" />
        </button>
        <button
          className="toolbar-btn"
          title="Redo (Ctrl+Y)"
          onClick={onRedo}
        >
          <i className="fas fa-redo" />
        </button>
        <div className="toolbar-divider" />
        <button
          className="toolbar-btn"
          title="Heading 1"
          onClick={() => onBlockElement('h1')}
        >
          <i className="fas fa-heading" />
        </button>
        <button
          className="toolbar-btn"
          title="Heading 2"
          onClick={() => onBlockElement('h2')}
        >
          <i className="fas fa-heading" style={{ fontSize: '0.85em' }} />
        </button>
        <button
          className="toolbar-btn"
          title="Heading 3"
          onClick={() => onBlockElement('h3')}
        >
          <i className="fas fa-heading" style={{ fontSize: '0.7em' }} />
        </button>
        <button
          className="toolbar-btn"
          title="Paragraph"
          onClick={() => onBlockElement('p')}
        >
          <i className="fas fa-paragraph" />
        </button>
        <div className="toolbar-divider" />
        <label className="toolbar-list-control">
          <button
            className="toolbar-btn"
            title={`Unordered List: ${listStyles?.ul || 'disc'}`}
            onClick={() => onList('ul', listStyles?.ul || 'disc')}
          >
            <i className="fas fa-list-ul" />
          </button>
          <select
            className="toolbar-list-select"
            aria-label="Unordered list style"
            value={listStyles?.ul || 'disc'}
            onChange={(event) => {
              const style = event.target.value;
              onListStyleChange?.('ul', style);
              onList('ul', style);
            }}
          >
            <option value="disc">Disc</option>
            <option value="circle">Circle</option>
            <option value="square">Square</option>
          </select>
        </label>
        <label className="toolbar-list-control">
          <button
            className="toolbar-btn"
            title={`Ordered List: ${listStyles?.ol || 'decimal'}`}
            onClick={() => onList('ol', listStyles?.ol || 'decimal')}
          >
            <i className="fas fa-list-ol" />
          </button>
          <select
            className="toolbar-list-select"
            aria-label="Ordered list style"
            value={listStyles?.ol || 'decimal'}
            onChange={(event) => {
              const style = event.target.value;
              onListStyleChange?.('ol', style);
              onList('ol', style);
            }}
          >
            <option value="decimal">1, 2, 3</option>
            <option value="lower-alpha">a, b, c</option>
            <option value="upper-alpha">A, B, C</option>
            <option value="lower-roman">i, ii, iii</option>
            <option value="upper-roman">I, II, III</option>
          </select>
        </label>
        <button
          className="toolbar-btn"
          title="Blockquote"
          onClick={() => onBlockElement('blockquote')}
        >
          <i className="fas fa-quote-left" />
        </button>
        <button
          className="toolbar-btn"
          title="Code Block"
          onClick={onInsertCode}
        >
          <i className="fas fa-code" />
        </button>
        <button
          className="toolbar-btn"
          title="Horizontal Rule"
          onClick={onInsertHR}
        >
          <i className="fas fa-minus" />
        </button>
        <div className="toolbar-divider" />
        <button
          className="toolbar-btn"
          title="Insert Table"
          onClick={() => onInsertTable(2, 2)}
        >
          <i className="fas fa-table" />
        </button>
        <button
          className="toolbar-btn"
          title="Insert Image"
          onClick={onInsertImage}
        >
          <i className="fas fa-image" />
        </button>
        <button
          className="toolbar-btn"
          title="Insert Link"
          onClick={onInsertLink}
        >
          <i className="fas fa-link" />
        </button>
      </div>

      {/* CSS/Styling Controls and View Controls */}
      <div className="toolbar-section">
        {/* Framework toggles (show only when detected) */}
        <div className="framework-toggle-group" style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
          {detectedStylesheets?.tailwind && (
            <button
              className={`toolbar-btn ${activeUIFramework === 'tailwind' ? 'active' : ''}`}
              title="Use Tailwind utilities"
              aria-pressed={activeUIFramework === 'tailwind'}
              onClick={() => onSelectUIFramework?.('tailwind')}
            >
              TW
            </button>
          )}
          {detectedStylesheets?.bootstrap && (
            <button
              className={`toolbar-btn ${activeUIFramework === 'bootstrap' ? 'active' : ''}`}
              title="Use Bootstrap utilities"
              aria-pressed={activeUIFramework === 'bootstrap'}
              onClick={() => onSelectUIFramework?.('bootstrap')}
            >
              BS
            </button>
          )}
          {detectedStylesheets?.material && (
            <button
              className={`toolbar-btn ${activeUIFramework === 'material' ? 'active' : ''}`}
              title="Use Material Design utilities"
              aria-pressed={activeUIFramework === 'material'}
              onClick={() => onSelectUIFramework?.('material')}
            >
              MD
            </button>
          )}
        </div>

        <button
          className={`toolbar-btn ${showCSSPanel ? 'active' : ''}`}
          title="Toggle CSS Panel"
          onClick={() => onCSSPanelToggle(!showCSSPanel)}
        >
          <i className="fas fa-palette" />
        </button>
        <button
          className="toolbar-btn"
          title="View Generated CSS Rules"
          onClick={() => onCSSRulesToggle(!showCSSRules)}
        >
          <i className="fas fa-book" />
        </button>
        <button
          className="toolbar-btn"
          title="View Source HTML"
          onClick={onToggleSourceView}
        >
          <i className="fas fa-code" />
        </button>
        {detectedStylesheets &&
          (detectedStylesheets.tailwind ||
            detectedStylesheets.bootstrap ||
            detectedStylesheets.material ||
            detectedStylesheets.fontAwesome ||
            detectedStylesheets.bootstrapIcons ||
            detectedStylesheets.featherIcons ||
            detectedStylesheets.ionicons) && (
            <button
              className="toolbar-btn"
              title="Insert Snippet"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onToggleSnippetSelector}
            >
              <i className="fas fa-puzzle-piece" />
            </button>
          )}
      </div>

      {/* CSS Panel */}
      {showCSSPanel && (
        <div className="css-panel">
          {/* Colors */}
          <div className="css-control">
            <label>Colors:</label>
            <div className="color-swatches">
              {CORE_COLOR_NAMES.map((colorName) => (
                <button
                  key={colorName}
                  className="color-swatch"
                  style={{ backgroundColor: CORE_COLORS[colorName] }}
                  title={colorName}
                  onClick={() => onColor(CORE_COLORS[colorName])}
                />
              ))}
              {customColors.map((color, idx) => (
                <button
                  key={`custom-${idx}`}
                  className="color-swatch"
                  style={{ backgroundColor: color }}
                  title={`Custom ${idx}`}
                  onClick={() => onColor(color)}
                />
              ))}
              <button
                className="toolbar-btn"
                title="Add Custom Color"
                onClick={() => onColorPickerToggle(!showColorPicker)}
              >
                +
              </button>
            </div>

            {/* Color Picker */}
            {showColorPicker && (
              <div className="color-picker-inline">
                <input
                  type="color"
                  defaultValue="#000000"
                  onChange={(e) => {
                    const color = e.target.value;
                    onColor(color);
                    onAddColor?.(color);
                    onColorPickerToggle(false);
                  }}
                  autoFocus
                />
              </div>
            )}
          </div>

          {/* Text Formatting */}
          <div className="css-control">
            <label>Format:</label>
            <div className="format-buttons">
              <button
                className={`toolbar-btn ${activeStyles.bold ? 'active' : ''}`}
                title="Bold (Ctrl+B)"
                onClick={() => {
                  restoreSelection?.();
                  onBold();
                }}
              >
                <i className="fas fa-bold" />
              </button>
              <button
                className={`toolbar-btn ${activeStyles.italic ? 'active' : ''}`}
                title="Italic (Ctrl+I)"
                onClick={() => {
                  restoreSelection?.();
                  onItalic();
                }}
              >
                <i className="fas fa-italic" />
              </button>
              <button
                className={`toolbar-btn ${activeStyles.underline ? 'active' : ''}`}
                title="Underline (Ctrl+U)"
                onClick={() => {
                  restoreSelection?.();
                  onUnderline();
                }}
              >
                <i className="fas fa-underline" />
              </button>
            </div>
          </div>

          {/* Font Selection */}
          <div className="css-control">
            <label>Font:</label>
            <select
              className="toolbar-select"
              onChange={(e) => onFontChange(e.target.value)}
              value={
                pendingFont || (activeStyles.font ? getValueForIndexedClass(activeStyles.font, 'font') : '')
              }
            >
              <option value="">Select Font...</option>
              {AVAILABLE_FONTS.map((font) => (
                <option key={font.name} value={font.name} title={font.family}>
                  {getFontLabel(font)}
                </option>
              ))}
            </select>
          </div>

          {/* Font Size */}
          <div className="css-control">
            <label>Size:</label>
            <select
              className="toolbar-select"
              onChange={(e) => onFontSizeChange(e.target.value)}
              value={
                pendingSize || (activeStyles.size ? getValueForIndexedClass(activeStyles.size, 'size') : '')
              }
            >
              <option value="">Select Size...</option>
              {['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px'].map((size) => (
                <option key={size} value={size}>
                  {getSizeLabel(size)}
                </option>
              ))}
            </select>
          </div>

          {/* Text Alignment */}
          <div className="css-control">
            <label>Align:</label>
            <div className="align-buttons">
              <button
                className={`toolbar-btn ${activeStyles.align === 'left' ? 'active' : ''}`}
                title="Left"
                onClick={() => onTextAlign('left')}
              >
                <i className="fas fa-align-left" />
              </button>
              <button
                className={`toolbar-btn ${activeStyles.align === 'center' ? 'active' : ''}`}
                title="Center"
                onClick={() => onTextAlign('center')}
              >
                <i className="fas fa-align-center" />
              </button>
              <button
                className={`toolbar-btn ${activeStyles.align === 'right' ? 'active' : ''}`}
                title="Right"
                onClick={() => onTextAlign('right')}
              >
                <i className="fas fa-align-right" />
              </button>
              <button
                className={`toolbar-btn ${activeStyles.align === 'justify' ? 'active' : ''}`}
                title="Justify"
                onClick={() => onTextAlign('justify')}
              >
                <i className="fas fa-align-justify" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSS Rules Modal */}
      {showCSSRules && (
        <div className="css-rules-modal">
          <div className="css-rules-header">
            <h3>Generated CSS Rules</h3>
            <button
              className="modal-close-btn"
              onClick={() => onCSSRulesToggle(false)}
              title="Close"
            >
              ✕
            </button>
          </div>
          <div className="css-rules-content">
            {(() => {
              const styleEl = document.getElementById('editor-styles');
              const css = styleEl?.textContent || 'No CSS rules generated yet';
              return <pre>{css}</pre>;
            })()}
          </div>
          <div className="css-rules-footer">
            <button
              className="toolbar-btn"
              onClick={() => {
                const styleEl = document.getElementById('editor-styles');
                const css = styleEl?.textContent || '';
                navigator.clipboard.writeText(css);
                alert('CSS copied to clipboard!');
              }}
            >
              Copy CSS
            </button>
          </div>
        </div>
      )}
    </>
  );
};
