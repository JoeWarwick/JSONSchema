import React from 'react';
import type { XmlNodeRhsEditorProps } from './types';
import { XSD_BUILTIN_SIMPLE_TYPES } from '~/utils/xsd-types';

/**
 * Reusable control for managing attributes on XML schema elements.
 * Supports add, edit, and remove operations on attributes for simpleType, complexType, or any schema node.
 * Inherited attributes (from base types) are shown as read-only.
 * 
 * Usage:
 *   <XmlAttributesManager node={selectedNode} onChange={handleChange} />
 * 
 * The onChange callback emits patches with:
 *   - xmlAddAttribute: { name, type, use }
 *   - xmlRemoveAttributeIndex: number (array index)
 *   - xmlUpdateAttributeIndex: { index, name, type, use }
 */
export function XmlAttributesManager({ node, onChange }: XmlNodeRhsEditorProps) {
  const data = (node?.data || {}) as any;

  // Get attributes from node data (passed from graphical-schema-editor)
  const attributes = data.xmlAttributes || [];
  const availableTypes = (data.xmlAvailableTypes || []) as string[];
  const typeOptions = React.useMemo(() => {
    const merged = [...XSD_BUILTIN_SIMPLE_TYPES, ...availableTypes];
    return Array.from(new Set(merged.filter(Boolean)));
  }, [availableTypes]);
  const [showAddForm, setShowAddForm] = React.useState(false);
  const [newAttrName, setNewAttrName] = React.useState('');
  const [newAttrType, setNewAttrType] = React.useState('xs:string');
  const [newAttrUse, setNewAttrUse] = React.useState('optional');

  const resetAddForm = () => {
    setNewAttrName('');
    setNewAttrType('xs:string');
    setNewAttrUse('optional');
  };

  const handleAddAttribute = () => {
    if (!newAttrName.trim()) return;
    if (!node) return;
    onChange({ 
      id: node.id, 
      xmlAddAttribute: { name: newAttrName, type: newAttrType, use: newAttrUse } 
    });
    resetAddForm();
  };

  const handleCancelAdd = () => {
    resetAddForm();
    setShowAddForm(false);
  };

  const handleRemoveAttribute = (index: number) => {
    if (!node) return;
    // Calculate the actual index in the non-inherited array (for XML operations)
    const nonInheritedIndex = attributes.slice(0, index).filter((a: any) => !a.inherited).length;
    onChange({ id: node.id, xmlRemoveAttributeIndex: nonInheritedIndex });
  };

  const handleUpdateAttribute = (index: number, field: string, value: string) => {
    if (!node) return;
    // Calculate the actual index in the non-inherited array (for XML operations)
    const nonInheritedIndex = attributes.slice(0, index).filter((a: any) => !a.inherited).length;
    const updated = { ...attributes[index], [field]: value };
    onChange({ id: node.id, xmlUpdateAttributeIndex: { index: nonInheritedIndex, ...updated } });
  };

  const fieldStyle = { padding: 3, borderRadius: 3, border: '1px solid var(--graph-node-border)', background: 'var(--graph-node-bg)', color: 'var(--graph-node-text)', fontSize: 11 };
  const inheritedFieldStyle = { ...fieldStyle, background: 'var(--graph-node-bg-subtle)', opacity: 0.7, cursor: 'not-allowed' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0', borderTop: '1px solid var(--graph-sidebar-border)', marginTop: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--graph-text)' }}>Attributes</div>
      
      {/* List existing attributes */}
      {attributes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {attributes.map((attr: any, index: number) => {
            const isInherited = attr.inherited === true;
            return (
              <div key={index} style={{ display: 'flex', gap: 4, fontSize: 11, padding: 4, backgroundColor: isInherited ? 'var(--graph-node-bg-subtle)' : 'var(--graph-node-bg-subtle)', borderRadius: 4, opacity: isInherited ? 0.75 : 1, position: 'relative' }}>
                {isInherited && (
                  <div style={{ position: 'absolute', top: 2, right: 2, fontSize: 9, color: 'var(--graph-muted)', fontWeight: 500, padding: '2px 4px', backgroundColor: 'var(--graph-node-border)', borderRadius: 2 }}>
                    inherited
                  </div>
                )}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, paddingRight: isInherited ? 50 : 0 }}>
                  <input
                    type="text"
                    value={attr.name || ''}
                    onChange={(e) => !isInherited && handleUpdateAttribute(index, 'name', e.target.value)}
                    placeholder="name"
                    disabled={isInherited}
                    style={isInherited ? inheritedFieldStyle : fieldStyle}
                  />
                  <select
                    value={attr.type || ''}
                    onChange={(e) => !isInherited && handleUpdateAttribute(index, 'type', e.target.value)}
                    disabled={isInherited}
                    style={isInherited ? inheritedFieldStyle : fieldStyle}
                  >
                    <option value={attr.type || ''}>{attr.type || 'Select type...'}</option>
                    {typeOptions.filter((t) => t !== attr.type).map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <select
                    value={attr.use || 'optional'}
                    onChange={(e) => !isInherited && handleUpdateAttribute(index, 'use', e.target.value)}
                    disabled={isInherited}
                    style={isInherited ? inheritedFieldStyle : fieldStyle}
                  >
                    <option value="optional">optional</option>
                    <option value="required">required</option>
                    <option value="prohibited">prohibited</option>
                  </select>
                </div>
                {!isInherited && (
                  <button
                    type="button"
                    onClick={() => handleRemoveAttribute(index)}
                    style={{ padding: '4px 8px', fontSize: 11, backgroundColor: 'var(--color-error-4)', color: 'var(--color-error-11)', border: '1px solid var(--color-error-7)', borderRadius: 3, cursor: 'pointer' }}
                  >
                    Remove
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add new attribute, hidden behind a toggle button until requested */}
      {!showAddForm && (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          style={{ alignSelf: 'flex-start', padding: '4px 10px', fontSize: 11, fontWeight: 500, backgroundColor: 'var(--graph-node-bg-subtle)', color: 'var(--graph-text)', border: '1px solid var(--graph-node-border)', borderRadius: 3, cursor: 'pointer' }}
        >
          + Add Attribute
        </button>
      )}
      {showAddForm && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 6, backgroundColor: 'var(--graph-node-bg-subtle)', border: '1px solid var(--graph-node-border)', borderRadius: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--graph-text)' }}>Add Attribute</span>
          <input
            type="text"
            value={newAttrName}
            onChange={(e) => setNewAttrName(e.target.value)}
            placeholder="Attribute name"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleAddAttribute()}
            style={fieldStyle}
          />
          <select
            value={newAttrType}
            onChange={(e) => setNewAttrType(e.target.value)}
            style={fieldStyle}
          >
            <option value="">Select type...</option>
            {typeOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select
            value={newAttrUse}
            onChange={(e) => setNewAttrUse(e.target.value)}
            style={fieldStyle}
          >
            <option value="optional">optional</option>
            <option value="required">required</option>
            <option value="prohibited">prohibited</option>
          </select>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              onClick={handleAddAttribute}
              disabled={!newAttrName.trim()}
              style={{ flex: 1, padding: 4, fontSize: 11, backgroundColor: newAttrName.trim() ? 'var(--color-success-4)' : 'var(--graph-node-bg)', color: newAttrName.trim() ? 'var(--color-success-11)' : 'var(--graph-muted)', border: newAttrName.trim() ? '1px solid var(--color-success-7)' : '1px solid var(--graph-node-border)', borderRadius: 3, cursor: newAttrName.trim() ? 'pointer' : 'not-allowed' }}
            >
              Add
            </button>
            <button
              type="button"
              onClick={handleCancelAdd}
              style={{ padding: 4, fontSize: 11, backgroundColor: 'var(--graph-node-bg)', color: 'var(--graph-muted)', border: '1px solid var(--graph-node-border)', borderRadius: 3, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
