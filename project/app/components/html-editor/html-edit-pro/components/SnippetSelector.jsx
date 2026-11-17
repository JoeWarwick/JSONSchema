/**
 * SnippetSelector Component
 * Modal for selecting and inserting framework-specific snippets
 */

import React, { useState } from 'react';
import { SNIPPET_FRAMEWORKS, getDetectedFrameworks } from '../utils/snippetConfig';
import { insertSnippetAtCursor } from '../utils/editorHelpers';
import './SnippetSelector.css';

export const SnippetSelector = ({
  isOpen,
  detectedStylesheets,
  editorRef,
  restoreSelection,
  savedRange,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState(null);
  const [snippetCode, setSnippetCode] = useState('');
  const [insertStatus, setInsertStatus] = useState('');

  if (isOpen === false) return null;

  const handleOverlayClick = (e) => {
    if (e.target.className === 'snippet-selector-overlay') {
      onClose();
    }
  };

  const detectedFrameworks = getDetectedFrameworks(detectedStylesheets);
  const displayTab = activeTab || (detectedFrameworks.length > 0 ? detectedFrameworks[0] : null);

  if (!displayTab || detectedFrameworks.length === 0) {
    return (
      <div className="snippet-selector-overlay" onClick={handleOverlayClick}>
        <div className="snippet-selector-modal" onClick={(e) => e.stopPropagation()}>
          <div className="snippet-selector-header">
            <h2>Insert Snippet</h2>
            <button className="close-btn" onClick={onClose}>
              ✕
            </button>
          </div>
          <div className="snippet-selector-content">
            <p className="no-frameworks">No CSS frameworks detected in this document.</p>
            <p className="help-text">
              Load HTML with Tailwind, Bootstrap, or Material Design stylesheets to use snippet
              insertion.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const framework = SNIPPET_FRAMEWORKS[displayTab];

  const handleOpenDemo = () => {
    const url = framework.primary || framework.url;
    if (url) {
      window.open(url, '_blank');
    }
  };

  const handleInsert = () => {
    if (!snippetCode.trim()) {
      setInsertStatus('error');
      setTimeout(() => setInsertStatus(''), 3000);
      return;
    }

    try {
      const success = insertSnippetAtCursor(editorRef.current, snippetCode, restoreSelection, savedRange);
      if (success) {
        setInsertStatus('success');
        setSnippetCode('');
        setTimeout(() => {
          setInsertStatus('');
          onClose();
        }, 1500);
      } else {
        setInsertStatus('error');
        setTimeout(() => setInsertStatus(''), 3000);
      }
    } catch (error) {
      console.error('Insert snippet error:', error);
      setInsertStatus('error');
      setTimeout(() => setInsertStatus(''), 3000);
    }
  };

  const handleClear = () => {
    setSnippetCode('');
  };

  return (
    <div className="snippet-selector-overlay" onClick={handleOverlayClick}>
      <div className="snippet-selector-modal" onClick={(e) => e.stopPropagation()}>
        <div className="snippet-selector-header">
          <h2>Insert Snippet</h2>
          <button className="close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="detected-info">
          <p className="detected-label">
            Detected frameworks: <strong>{detectedFrameworks.map((id) => SNIPPET_FRAMEWORKS[id].name).join(', ')}</strong>
          </p>
        </div>

        <div className="framework-tabs">
          {detectedFrameworks.map((frameworkId) => {
            const fw = SNIPPET_FRAMEWORKS[frameworkId];
            return (
              <button
                key={frameworkId}
                className={`tab-btn ${displayTab === frameworkId ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab(frameworkId);
                  setSnippetCode('');
                  setInsertStatus('');
                }}
              >
                {fw.name}
              </button>
            );
          })}
        </div>

        <div className="snippet-selector-content">
          <div className="framework-help-section">
            <p className="help-text">{framework.helpText}</p>
            <button className="demo-btn" onClick={handleOpenDemo}>
              📂 {framework.buttonLabel}
            </button>
          </div>

          <div className="snippet-code-section">
            <label htmlFor="snippet-code-input" className="code-label">
              Paste Snippet Code:
            </label>
            <textarea
              id="snippet-code-input"
              className="snippet-code-input"
              value={snippetCode}
              onChange={(e) => {
                setSnippetCode(e.target.value);
                setInsertStatus('');
              }}
              placeholder={`Paste ${framework.name} component HTML here...`}
              spellCheck="false"
            />
          </div>

          {insertStatus && (
            <div className={`status-message ${insertStatus}`}>
              {insertStatus === 'success'
                ? '✓ Snippet inserted successfully!'
                : '⚠ Please paste snippet code before inserting.'}
            </div>
          )}
        </div>

        <div className="snippet-selector-actions">
          <button
            className="action-btn primary"
            onClick={handleInsert}
            disabled={!snippetCode.trim()}
          >
            Insert at Cursor
          </button>
          <button className="action-btn" onClick={handleClear} disabled={!snippetCode.trim()}>
            Clear
          </button>
          <button className="action-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};