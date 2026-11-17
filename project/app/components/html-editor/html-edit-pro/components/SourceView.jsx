/**
 * SourceView Component
 * Modal/tab for viewing and editing raw HTML source
 */

import React, { useState, useEffect } from 'react';
import { extractBodyContent } from '../utils/editorHelpers';
import './SourceView.css';

export const SourceView = ({
  isOpen,
  content,
  onClose,
  onApplyHTML,
  onImportHTML,
}) => {
  const [sourceHTML, setSourceHTML] = useState(content);

  useEffect(() => {
    setSourceHTML(content);
  }, [content]);

  if (isOpen === false) return null;

  const handleApply = () => {
    onApplyHTML?.(sourceHTML);
  };

  const handleCopyToClipboard = () => {
    navigator.clipboard
      .writeText(sourceHTML)
      .then(() => {
        alert('HTML copied to clipboard!');
      })
      .catch((err) => {
        console.error('Failed to copy:', err);
      });
  };

  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const html = event.target?.result;
        if (html) {
          // Extract just the body content from imported HTML files
          const bodyContent = extractBodyContent(html);
          setSourceHTML(bodyContent);
          onImportHTML?.(bodyContent);
        }
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="source-view-overlay">
      <div className="source-view-modal">
        <div className="source-view-header">
          <h2>HTML Source</h2>
          <button className="source-view-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="source-view-content">
          <textarea
            className="source-textarea"
            value={sourceHTML}
            onChange={(e) => setSourceHTML(e.target.value)}
            spellCheck="false"
            placeholder="Paste or edit HTML here..."
          />
        </div>

        <div className="source-view-actions">
          <button className="action-btn primary" onClick={handleApply}>
            Apply Changes
          </button>
          <button className="action-btn" onClick={handleCopyToClipboard}>
            Copy to Clipboard
          </button>
          <label className="action-btn">
            Import HTML File
            <input
              type="file"
              accept=".html,.htm"
              onChange={handleImportFile}
              style={{ display: 'none' }}
            />
          </label>
          <button className="action-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
