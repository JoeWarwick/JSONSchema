import React from 'react';

// Instance-form-specific RHS editors.
// This file is intentionally forked from xml-rhs-editors.tsx so
// XML Instance Form behavior can evolve independently from graph tooling.
import type { Node as FlowNode } from 'reactflow';
import type { NodeData, InlineSimpleTypeData, SimpleTypeFacets, XmlNodeKind, XmlNodeRhsEditorProps } from './types';
import { PropertyForm, XmlAnnotationFieldAuto, XmlReadOnlyHint } from './xml-editor-controls';
import { XML_SCHEMA_PROPERTY_CONFIGS, SpecialAttributesEditor } from './xml-schema-root-settings-controls';
import { EnumerationListEditor, FacetsEditor, InlineSimpleTypeEditor, ListValuesEditor, MemberTypesListEditor, ReferencedEnumerationList, XmlTypeSelector } from './xml-simple-type-controls';
import { XmlInstanceSimpleTypeEditor } from './xml-instance-simple-type-editor';
import { XmlInstanceComplexTypeEditor } from './xml-instance-complex-type-editor';
import { XmlInstanceAttributeGroupEditor } from './xml-instance-attribute-group-editor';
import { XmlInstanceAttributeEditor, XmlInstanceAttributeSimpleTypeEditor } from './xml-instance-attribute-editors';
import { XSD_BUILTIN_SIMPLE_TYPES } from '~/utils/xsd-types';

/**
 * XmlAttributesManager - A reusable control for managing attributes on XML schema elements.
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
export function XmlAttributesManager({
  node,
  onChange,
  addBadgeLabel = 'xs:attribute',
  extraBadges,
}: XmlNodeRhsEditorProps & { addBadgeLabel?: string; extraBadges?: React.ReactNode }) {
  const data = (node?.data || {}) as any;
  const stripNamespacePrefix = (label: string) => String(label || '').replace(/^.*:/, '');

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

  const fieldStyle = { padding: 3, borderRadius: 3, border: '1px solid var(--graph-node-border)', background: 'var(--graph-node-bg)', color: 'var(--graph-node-text)', fontSize: 11 };
  const neutralBadgeStyle: React.CSSProperties = {
    padding: '4px 10px',
    borderRadius: 999,
    border: '1px solid var(--graph-node-border, #4b5563)',
    backgroundColor: 'var(--graph-node-bg-subtle, #1f2937)',
    color: 'var(--graph-text, #e5e7eb)',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    lineHeight: 1,
    textDecoration: 'none',
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.04)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0', borderTop: '1px solid var(--graph-sidebar-border)', marginTop: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--graph-text)' }}>Attributes</div>
      
      {/* Existing attributes */}
      {(attributes.length > 0 || extraBadges || !showAddForm) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'flex-start' }}>
          {attributes.map((attr: any, index: number) => {
            const isInherited = attr.inherited === true;
            const badgeLabel = stripNamespacePrefix(attr.name || 'xs:attribute');
            return (
              <button
                key={index}
                type="button"
                onClick={() => {
                  if (!isInherited) handleRemoveAttribute(index);
                }}
                title={isInherited ? `${badgeLabel} (inherited)` : `Remove ${badgeLabel} attribute`}
                style={{
                  ...neutralBadgeStyle,
                  opacity: isInherited ? 0.8 : 1,
                  cursor: isInherited ? 'default' : 'pointer',
                }}
              >
                <span>+</span>
                <span>{badgeLabel}</span>
                {isInherited ? <span style={{ fontSize: 10 }}>(inherited)</span> : null}
              </button>
            );
          })}
          {extraBadges}
          {!showAddForm ? (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              title="Add attribute declaration"
              style={neutralBadgeStyle}
            >
              <span>+</span>
              <span>{addBadgeLabel}</span>
            </button>
          ) : null}
        </div>
      )}

      {/* Add new attribute form */}
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

/**
 * Read-only display of enumeration values inherited from a named simpleType referenced via
 * `type="X"` (as opposed to an inline/anonymous simpleType owned by this node) — editing must


/**
 * Add/edit control for a restriction's single-value facets (`xs:pattern`,
 * `xs:minInclusive`/`xs:maxInclusive`, `xs:minLength`/`xs:maxLength`,
 * `xs:totalDigits`/`xs:fractionDigits`, `xs:whiteSpace`) — unlike `xs:enumeration` these
 * are each at most one occurrence, so a plain labeled text input per facet suffices.
 */
const SIMPLE_TYPE_FACET_FIELDS: Array<[keyof SimpleTypeFacets, string]> = [
  ['pattern', 'Pattern'],
  ['minInclusive', 'Min Inclusive'],
  ['maxInclusive', 'Max Inclusive'],
  ['minLength', 'Min Length'],
  ['maxLength', 'Max Length'],
  ['totalDigits', 'Total Digits'],
  ['fractionDigits', 'Fraction Digits'],
  ['whiteSpace', 'White Space'],
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function XmlCompositorEditor({ node, onChange, readOnlySource, getNodeByName }: XmlNodeRhsEditorProps) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  const [minOccurs, setMinOccurs] = React.useState<string>(String(data.xmlMinOccurs ?? '1'));
  const [maxOccurs, setMaxOccurs] = React.useState<string>(String(data.xmlMaxOccurs ?? '1'));
  const hasAnnotation = (Array.isArray(data.xmlAnnotations) && data.xmlAnnotations.length > 0) || Boolean(data.xmlAnnotation);
  const [showAnnotationEditor, setShowAnnotationEditor] = React.useState<boolean>(hasAnnotation);
  const readOnly = Boolean(readOnlySource);

  React.useEffect(() => {
    setMinOccurs(String(data.xmlMinOccurs ?? '1'));
    setMaxOccurs(String(data.xmlMaxOccurs ?? '1'));
  }, [node?.id, data.xmlMinOccurs, data.xmlMaxOccurs]);

  React.useEffect(() => {
    if (hasAnnotation) setShowAnnotationEditor(true);
  }, [hasAnnotation]);

  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: 10 }} onSubmit={(e) => e.preventDefault()}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>{String(data.xmlNodeKind || 'Compositor')} Editor</div>
      {readOnly && <XmlReadOnlyHint source={readOnlySource!} />}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>minOccurs</span>
        <input
          aria-label="minOccurs"
          value={minOccurs}
          disabled={readOnly}
          onChange={(e) => setMinOccurs(e.target.value)}
          onBlur={() => onChange({ id: node.id, xmlMinOccurs: minOccurs })}
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
          placeholder="1"
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>maxOccurs</span>
        <input
          aria-label="maxOccurs"
          value={maxOccurs}
          disabled={readOnly}
          onChange={(e) => setMaxOccurs(e.target.value)}
          onBlur={() => onChange({ id: node.id, xmlMaxOccurs: maxOccurs })}
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
          placeholder="1 or unbounded"
        />
      </label>

      <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--graph-text)' }}>Elements</div>

      {showAnnotationEditor ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Annotation element</span>
            {!readOnly ? (
              <button
                type="button"
                title="Delete annotation element"
                onClick={() => {
                  onChange({ id: node.id, xmlAnnotation: undefined, xmlAnnotations: [] });
                  setShowAnnotationEditor(false);
                }}
                style={{
                  padding: '2px 6px',
                  borderRadius: 3,
                  border: '1px solid var(--graph-node-border, #4b5563)',
                  backgroundColor: 'var(--graph-node-bg-subtle, #1f2937)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'var(--graph-text, #e5e7eb)',
                }}
              >
                ✕
              </button>
            ) : null}
          </div>
          <XmlAnnotationFieldAuto nodeId={node.id} data={data} onChange={onChange} disabled={readOnly} />
        </div>
      ) : (
        !readOnly ? (
          <button
            type="button"
            onClick={() => setShowAnnotationEditor(true)}
            title="Add annotation element"
            style={{
              alignSelf: 'flex-start',
              padding: '4px 10px',
              borderRadius: 999,
              border: '1px solid var(--graph-node-border, #4b5563)',
              backgroundColor: 'var(--graph-node-bg-subtle, #1f2937)',
              color: 'var(--graph-text, #e5e7eb)',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              lineHeight: 1,
              textDecoration: 'none',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.04)',
            }}
          >
            <span>+</span>
            <span>xs:annotation</span>
          </button>
        ) : null
      )}
    </form>
  );
}

/**
 * Read-only display for an `xs:any` wildcard content particle (e.g. embedded (X)HTML
 * markup) — there's no name/type to edit, just the wildcard's own declared attributes.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function XmlAnyEditor({ node, getNodeByName }: XmlNodeRhsEditorProps) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>xs:any (wildcard content)</div>
      <div style={{ fontSize: 12, color: '#888', fontStyle: 'italic' }}>
        Matches any element from the given namespace; not individually editable.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>namespace</span>
        <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{String(data.xmlAnyNamespace ?? '##any')}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>processContents</span>
        <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{String(data.xmlAnyProcessContents ?? 'strict')}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>minOccurs / maxOccurs</span>
        <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{String(data.xmlMinOccurs ?? '1')} / {String(data.xmlMaxOccurs ?? '1')}</span>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function XmlElementEditor({ node, onChange, readOnlySource, getNodeByName }: XmlNodeRhsEditorProps & { readOnlySource?: string }) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  const [name, setName] = React.useState<string>(String(data.xmlName || ''));
  const [type, setType] = React.useState<string>(String(data.xmlElementType || ''));
  const [widget, setWidget] = React.useState<string>(String(data.xmlWidget || ''));
  const [substitutionGroupParent, setSubstitutionGroupParent] = React.useState<string>(String(data.xmlSubstitutionGroupParent || ''));
  const [minOccurs, setMinOccurs] = React.useState<string>(String(data.xmlMinOccurs ?? '1'));
  const [maxOccurs, setMaxOccurs] = React.useState<string>(String(data.xmlMaxOccurs ?? '1'));
  const [isRef, setIsRef] = React.useState<boolean>(Boolean(data.xmlIsRef));
  const [mixed, setMixed] = React.useState<boolean>(Boolean(data.xmlMixed));
  const [anyAttributeNamespace, setAnyAttributeNamespace] = React.useState<string>(String(data.xmlAnyAttribute?.namespace || ''));
  const hasAnyAttributeNamespace = anyAttributeNamespace.trim().length > 0;
  const [defaultValue, setDefaultValue] = React.useState<string>(String(data.xmlDefault || ''));
  const [fixedValue, setFixedValue] = React.useState<string>(String(data.xmlFixed || ''));
  const hasAnnotation = (Array.isArray(data.xmlAnnotations) && data.xmlAnnotations.length > 0) || Boolean(data.xmlAnnotation);
  const [showAnnotationEditor, setShowAnnotationEditor] = React.useState<boolean>(hasAnnotation);
  const readOnly = Boolean(readOnlySource);

  React.useEffect(() => {
    setName(String(data.xmlName || ''));
    setType(String(data.xmlElementType || ''));
    setWidget(String(data.xmlWidget || ''));
    setSubstitutionGroupParent(String(data.xmlSubstitutionGroupParent || ''));
    setMinOccurs(String(data.xmlMinOccurs ?? '1'));
    setMaxOccurs(String(data.xmlMaxOccurs ?? '1'));
    setIsRef(Boolean(data.xmlIsRef));
    setMixed(Boolean(data.xmlMixed));
    setAnyAttributeNamespace(String(data.xmlAnyAttribute?.namespace || ''));
    setDefaultValue(String(data.xmlDefault || ''));
    setFixedValue(String(data.xmlFixed || ''));
  }, [node?.id, data.xmlName, data.xmlElementType, data.xmlWidget, data.xmlSubstitutionGroupParent, data.xmlMinOccurs, data.xmlMaxOccurs, data.xmlIsRef, data.xmlMixed, data.xmlAnyAttribute, data.xmlDefault, data.xmlFixed]);

  React.useEffect(() => {
    if (hasAnnotation) setShowAnnotationEditor(true);
  }, [hasAnnotation]);

  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: 10 }} onSubmit={(e) => e.preventDefault()}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>Element Editor</div>
      {readOnly && <XmlReadOnlyHint source={readOnlySource!} />}
      {!isRef && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12 }}>Name</span>
          <input
            aria-label="Element Name"
            value={name}
            disabled={readOnly}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              onChange({ id: node.id, xmlName: name });
            }}
            style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
          />
        </label>
      )}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>{isRef ? 'ref' : 'Type'}</span>
        {isRef ? (
          // A ref's target is fixed once set — editable only via the "Global Reference" toggle flow, not here.
          <XmlTypeSelector
            value={name}
            disabled
            onChange={(next) => {
              setName(next);
              // A `ref`-only element's display name lives on `@ref`, not `@type` — writing
              // `xmlName` here round-trips to the `ref` attribute (see `updateXmlNodeAtPath`).
              onChange({ id: node.id, xmlName: next });
            }}
            myTypeNames={Array.isArray(data.xmlMyElementNames) ? data.xmlMyElementNames : []}
            ariaLabel="Element Ref Target"
          />
        ) : data.xmlHasInlineComplexType ? (
          // No `type` attribute to show — the element's type is an inline `xs:complexType` defined
          // directly under it, so label it (using its `name` if it has one, else "Anon") instead of
          // showing blank/(none).
          <span aria-label="Element Type" style={{ padding: 6, fontStyle: 'italic', color: '#666' }}>complexType - {data.xmlInlineComplexTypeName || 'Anon'}</span>
        ) : (
          <XmlTypeSelector
            value={type}
            disabled={readOnly}
            onChange={(next) => {
              setType(next);
              onChange({ id: node.id, xmlElementType: next });
            }}
            myTypeNames={Array.isArray(data.xmlMyTypeNames) ? data.xmlMyTypeNames : []}
            ariaLabel="Element Type"
          />
        )}
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>Widget</span>
        <select
          aria-label="Element Widget"
          value={widget}
          disabled={readOnly}
          onChange={(e) => {
            const next = e.target.value;
            setWidget(next);
            onChange({ id: node.id, xmlWidget: next || undefined });
          }}
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
        >
          <option value="">(none)</option>
          <option value="color">color</option>
          <option value="email">email</option>
          <option value="country">country</option>
          <option value="lang">lang</option>
        </select>
      </label>
      {data.xmlHasSubstitutionExpansion ? (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12 }}>Substitution Group Parent</span>
          <XmlTypeSelector
            value={substitutionGroupParent}
            disabled={readOnly}
            onChange={(next) => {
              setSubstitutionGroupParent(next);
              onChange({ id: node.id, xmlSubstitutionGroupParent: next });
            }}
            myTypeNames={Array.isArray(data.xmlMyElementNames) ? data.xmlMyElementNames : []}
            ariaLabel="Substitution Group Parent Element"
          />
        </label>
      ) : null}
      <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12 }}>minOccurs</span>
          <input
            aria-label="minOccurs"
            value={minOccurs}
            disabled={readOnly && !isRef}
            onChange={(e) => setMinOccurs(e.target.value)}
            onBlur={() => onChange({ id: node.id, xmlMinOccurs: minOccurs })}
            placeholder="1"
            style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc', width: '100%', boxSizing: 'border-box' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12 }}>maxOccurs</span>
          <input
            aria-label="maxOccurs"
            value={maxOccurs}
            disabled={readOnly && !isRef}
            onChange={(e) => setMaxOccurs(e.target.value)}
            onBlur={() => onChange({ id: node.id, xmlMaxOccurs: maxOccurs })}
            placeholder="1 or unbounded"
            style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc', width: '100%', boxSizing: 'border-box' }}
          />
        </label>
      </label>
      <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12 }}>default</span>
          <input
            aria-label="default value"
            value={defaultValue}
            disabled={readOnly && !isRef}
            onChange={(e) => setDefaultValue(e.target.value)}
            onBlur={() => onChange({ id: node.id, xmlDefault: defaultValue })}
            placeholder="(none)"
            style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc', width: '100%', boxSizing: 'border-box' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12 }}>fixed</span>
          <input
            aria-label="fixed value"
            value={fixedValue}
            disabled={readOnly && !isRef}
            onChange={(e) => setFixedValue(e.target.value)}
            onBlur={() => onChange({ id: node.id, xmlFixed: fixedValue })}
            placeholder="(none)"
            style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
          />
        </label>
      </label>
      <label style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={isRef}
          disabled={readOnly || isRef}
          onChange={(e) => {
            setIsRef(e.target.checked);
            onChange({ id: node.id, xmlIsRef: e.target.checked });
          }}
          aria-label="Global Reference"
          style={{ cursor: (readOnly || isRef) ? 'not-allowed' : 'pointer' }}
        />
        <span style={{ fontSize: 12 }}>Global Reference (ref)</span>
      </label>
      <label style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={mixed}
          disabled={readOnly || isRef}
          onChange={(e) => {
            setMixed(e.target.checked);
            onChange({ id: node.id, xmlMixed: e.target.checked });
          }}
          aria-label="Mixed Content"
          style={{ cursor: (readOnly || isRef) ? 'not-allowed' : 'pointer' }}
        />
        <span style={{ fontSize: 12 }}>Mixed Content</span>
      </label>
      {data.xmlHasInlineComplexType ? (
        !readOnly ? (
          <XmlAttributesManager
            node={node}
            onChange={onChange}
            addBadgeLabel="xs:attribute"
            extraBadges={!isRef ? (
              <button
                type="button"
                onClick={() => {
                  const next = hasAnyAttributeNamespace ? '' : '##other';
                  setAnyAttributeNamespace(next);
                  onChange({ id: node.id, xmlAnyAttributeNamespace: next || undefined });
                }}
                title={hasAnyAttributeNamespace ? 'Remove AnyAttribute namespace' : 'Add AnyAttribute namespace'}
                style={{
                  padding: '4px 10px',
                  borderRadius: 999,
                  border: '1px solid var(--graph-node-border, #4b5563)',
                  backgroundColor: hasAnyAttributeNamespace ? 'var(--graph-node-bg, #111827)' : 'var(--graph-node-bg-subtle, #1f2937)',
                  color: 'var(--graph-text, #e5e7eb)',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  lineHeight: 1,
                  textDecoration: 'none',
                  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.04)',
                }}
              >
                <span>+</span>
                <span>Any #ns</span>
              </button>
            ) : null}
          />
        ) : null
      ) : (
        !readOnly && !isRef ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: '#666', background: '#fff7ed', border: '1px solid #f5c2b7', borderRadius: 6, padding: 8 }}>
            <div>
              This element is currently simpleType-backed. Convert it to ComplexType before adding xs:attribute or xs:anyAttribute.
            </div>
            <button
              type="button"
              aria-label="Convert to ComplexType"
              onClick={() => {
                onChange({ id: node.id, xmlConvertToComplexType: true });
              }}
              style={{ alignSelf: 'flex-start', padding: '4px 10px', borderRadius: 999, border: '1px solid var(--graph-node-border, #4b5563)', backgroundColor: 'var(--graph-node-bg-subtle, #1f2937)', color: 'var(--graph-text, #e5e7eb)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
            >
              Convert to ComplexType
            </button>
          </div>
        ) : null
      )}

      <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--graph-text)' }}>Elements</div>

      {showAnnotationEditor ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Annotation element</span>
            {!readOnly ? (
              <button
                type="button"
                title="Delete annotation element"
                onClick={() => {
                  onChange({ id: node.id, xmlAnnotation: undefined, xmlAnnotations: [] });
                  setShowAnnotationEditor(false);
                }}
                style={{
                  padding: '2px 6px',
                  borderRadius: 3,
                  border: '1px solid #ccc',
                  backgroundColor: '#f5f5f5',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#666',
                }}
              >
                ✕
              </button>
            ) : null}
          </div>
          <XmlAnnotationFieldAuto nodeId={node.id} data={data} onChange={onChange} disabled={readOnly} />
        </div>
      ) : (
        !readOnly ? (
          <button
            type="button"
            onClick={() => setShowAnnotationEditor(true)}
            title="Add annotation element"
            style={{
              alignSelf: 'flex-start',
              padding: '3px 8px',
              borderRadius: 12,
              border: '1px solid #8a6116',
              backgroundColor: '#3a2a0e',
              color: '#fbbf24',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>+</span>
            <span>xs:annotation</span>
          </button>
        ) : null
      )}
    </form>
  );
}

/**
 * Editor for custom xmlns:* namespace declarations.
 */
function NamespacesListEditor({
  node,
  onChange,
}: {
  node: FlowNode<NodeData>;
  onChange: (patch: Partial<NodeData>) => void;
}) {
  const data = (node.data || {}) as any;
  const namespaces = (data.xmlnsNamespaces as Array<{ prefix: string; uri: string }>) || [];
  const [newPrefix, setNewPrefix] = React.useState('');
  const [newUri, setNewUri] = React.useState('');
  const [showAddForm, setShowAddForm] = React.useState(false);

  const handleAdd = () => {
    if (!newPrefix.trim() || !newUri.trim()) return;
    const updated = [...namespaces, { prefix: newPrefix, uri: newUri }];
    onChange({ id: node.id, xmlnsNamespaces: updated });
    setNewPrefix('');
    setNewUri('');
    setShowAddForm(false);
  };

  const handleUpdate = (index: number, field: 'prefix' | 'uri', value: string) => {
    const updated = namespaces.map((ns, i) =>
      i === index ? { ...ns, [field]: value } : ns
    );
    onChange({ id: node.id, xmlnsNamespaces: updated });
  };

  const handleRemove = (index: number) => {
    onChange({ id: node.id, xmlnsNamespaces: namespaces.filter((_, i) => i !== index) });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 500 }}>Custom Namespaces (xmlns:*)</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {namespaces.map((ns, index) => (
          <div key={index} style={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
            <input
              type="text"
              placeholder="prefix"
              value={ns.prefix}
              onChange={(e) => handleUpdate(index, 'prefix', e.target.value)}
              style={{
                padding: 4,
                borderRadius: 3,
                border: '1px solid #ddd',
                fontSize: 11,
                minWidth: 80,
              }}
            />
            <input
              type="text"
              placeholder="URI"
              value={ns.uri}
              onChange={(e) => handleUpdate(index, 'uri', e.target.value)}
              style={{
                padding: 4,
                borderRadius: 3,
                border: '1px solid #ddd',
                fontSize: 11,
                flex: 1,
              }}
            />
            <button
              type="button"
              onClick={() => handleRemove(index)}
              title="Remove namespace"
              style={{
                padding: '2px 6px',
                borderRadius: 3,
                border: '1px solid #ccc',
                backgroundColor: '#f5f5f5',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
                color: '#666',
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      {!showAddForm ? (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          style={{
            alignSelf: 'flex-start',
            padding: '3px 8px',
            borderRadius: 12,
            border: '1px solid #ddd',
            backgroundColor: '#f9f9f9',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 500,
            color: '#666',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span>+</span>
          <span>xmlns:*</span>
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          <input
            type="text"
            placeholder="prefix"
            value={newPrefix}
            onChange={(e) => setNewPrefix(e.target.value)}
            style={{
              padding: 4,
              borderRadius: 3,
              border: '1px solid #ddd',
              fontSize: 11,
              minWidth: 80,
            }}
          />
          <input
            type="text"
            placeholder="URI"
            value={newUri}
            onChange={(e) => setNewUri(e.target.value)}
            style={{
              padding: 4,
              borderRadius: 3,
              border: '1px solid #ddd',
              fontSize: 11,
              flex: 1,
            }}
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!newPrefix.trim() || !newUri.trim()}
            title="Add namespace"
            style={{
              padding: '2px 6px',
              borderRadius: 3,
              border: '1px solid #ccc',
              backgroundColor: !newPrefix.trim() || !newUri.trim() ? '#f0f0f0' : '#f9f9f9',
              cursor: !newPrefix.trim() || !newUri.trim() ? 'not-allowed' : 'pointer',
              fontSize: 12,
              fontWeight: 500,
              color: !newPrefix.trim() || !newUri.trim() ? '#aaa' : '#666',
            }}
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setShowAddForm(false);
              setNewPrefix('');
              setNewUri('');
            }}
            style={{
              padding: '2px 6px',
              borderRadius: 3,
              border: '1px solid #ccc',
              backgroundColor: '#f5f5f5',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
              color: '#666',
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Editor for xs:import elements (namespace and schemaLocation pairs).
 */
function ImportsListEditor({
  node,
  onChange,
  additionalBadges,
}: {
  node: FlowNode<NodeData>;
  onChange: (patch: Partial<NodeData>) => void;
  additionalBadges?: React.ReactNode;
}) {
  const data = (node.data || {}) as any;
  const imports = (data.xmlImports as Array<{ namespace: string; schemaLocation: string }>) || [];
  const [newNamespace, setNewNamespace] = React.useState('');
  const [newSchemaLocation, setNewSchemaLocation] = React.useState('');
  const [showAddForm, setShowAddForm] = React.useState(false);

  const handleAdd = () => {
    if (!newNamespace.trim() || !newSchemaLocation.trim()) return;
    const updated = [...imports, { namespace: newNamespace, schemaLocation: newSchemaLocation }];
    onChange({ id: node.id, xmlImports: updated });
    setNewNamespace('');
    setNewSchemaLocation('');
    setShowAddForm(false);
  };

  const handleUpdate = (index: number, field: 'namespace' | 'schemaLocation', value: string) => {
    const updated = imports.map((imp, i) =>
      i === index ? { ...imp, [field]: value } : imp
    );
    onChange({ id: node.id, xmlImports: updated });
  };

  const handleRemove = (index: number) => {
    onChange({ id: node.id, xmlImports: imports.filter((_, i) => i !== index) });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 500 }}>xs:import Declarations</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {imports.map((imp, index) => (
          <div key={index} style={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
            <input
              type="text"
              placeholder="namespace"
              value={imp.namespace}
              onChange={(e) => handleUpdate(index, 'namespace', e.target.value)}
              style={{
                padding: 4,
                borderRadius: 3,
                border: '1px solid #ddd',
                fontSize: 11,
                minWidth: 100,
              }}
            />
            <input
              type="text"
              placeholder="schemaLocation"
              value={imp.schemaLocation}
              onChange={(e) => handleUpdate(index, 'schemaLocation', e.target.value)}
              style={{
                padding: 4,
                borderRadius: 3,
                border: '1px solid #ddd',
                fontSize: 11,
                flex: 1,
              }}
            />
            <button
              type="button"
              onClick={() => handleRemove(index)}
              title="Remove import"
              style={{
                padding: '2px 6px',
                borderRadius: 3,
                border: '1px solid #ccc',
                backgroundColor: '#f5f5f5',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
                color: '#666',
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      {!showAddForm ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            style={{
              alignSelf: 'flex-start',
              padding: '3px 8px',
              borderRadius: 12,
              border: '1px solid #ddd',
              backgroundColor: '#f9f9f9',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 500,
              color: '#666',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>+</span>
            <span>xs:import</span>
          </button>
          {additionalBadges}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          <input
            type="text"
            placeholder="namespace"
            value={newNamespace}
            onChange={(e) => setNewNamespace(e.target.value)}
            style={{
              padding: 4,
              borderRadius: 3,
              border: '1px solid #ddd',
              fontSize: 11,
              minWidth: 100,
            }}
          />
          <input
            type="text"
            placeholder="schemaLocation"
            value={newSchemaLocation}
            onChange={(e) => setNewSchemaLocation(e.target.value)}
            style={{
              padding: 4,
              borderRadius: 3,
              border: '1px solid #ddd',
              fontSize: 11,
              flex: 1,
            }}
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!newNamespace.trim() || !newSchemaLocation.trim()}
            title="Add import"
            style={{
              padding: '2px 6px',
              borderRadius: 3,
              border: '1px solid #ccc',
              backgroundColor: !newNamespace.trim() || !newSchemaLocation.trim() ? '#f0f0f0' : '#f9f9f9',
              cursor: !newNamespace.trim() || !newSchemaLocation.trim() ? 'not-allowed' : 'pointer',
              fontSize: 12,
              fontWeight: 500,
              color: !newNamespace.trim() || !newSchemaLocation.trim() ? '#aaa' : '#666',
            }}
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setShowAddForm(false);
              setNewNamespace('');
              setNewSchemaLocation('');
            }}
            style={{
              padding: '2px 6px',
              borderRadius: 3,
              border: '1px solid #ccc',
              backgroundColor: '#f5f5f5',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
              color: '#666',
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function XmlSchemaEditor({ node, onChange, onToggleShowAnnotations, xmlShowAnnotations, onToggleShowImports, xmlShowImports, getNodeByName }: XmlNodeRhsEditorProps) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  const hasAnnotation = (Array.isArray(data.xmlAnnotations) && data.xmlAnnotations.length > 0) || Boolean(data.xmlAnnotation);
  const [showAnnotationEditor, setShowAnnotationEditor] = React.useState<boolean>(hasAnnotation);

  React.useEffect(() => {
    if (hasAnnotation) setShowAnnotationEditor(true);
  }, [hasAnnotation]);

  const handleToggleShowAnnotations = (show: boolean) => {
    if (onToggleShowAnnotations) {
      onToggleShowAnnotations(show);
    }
  };

  const handleToggleShowImports = (show: boolean) => {
    if (onToggleShowImports) {
      onToggleShowImports(show);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PropertyForm
        title="Schema Editor"
        configs={XML_SCHEMA_PROPERTY_CONFIGS}
        nodeData={data}
        nodeId={node.id}
        onChange={onChange}
      />
      <SpecialAttributesEditor
        node={node}
        onChange={onChange}
        coreAttributesLayout="wrap"
        namespacesEditor={<NamespacesListEditor node={node} onChange={onChange} />}
      />
      
      {onToggleShowAnnotations ? (
        <div style={{ padding: '8px 12px', border: '1px solid var(--graph-node-border)', borderRadius: 4, backgroundColor: 'var(--graph-node-bg-subtle)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--graph-node-text)' }}>
            <input
              type="checkbox"
              checked={xmlShowAnnotations === true}
              onChange={(e) => handleToggleShowAnnotations(e.currentTarget.checked)}
              style={{ cursor: 'pointer' }}
            />
            <span>Show Annotations</span>
          </label>
          {xmlShowAnnotations === true && (
            <div style={{ fontSize: 11, color: 'var(--graph-muted)', marginTop: 6 }}>
              Annotation entries follow document order.
            </div>
          )}
        </div>
      ) : null}

      {/* xs:import Editor */}
      <ImportsListEditor
        node={node}
        onChange={onChange}
        additionalBadges={!showAnnotationEditor ? (
          <button
            type="button"
            onClick={() => setShowAnnotationEditor(true)}
            title="Add annotation"
            style={{
              padding: '3px 8px',
              borderRadius: 12,
              border: '1px solid #8a6116',
              backgroundColor: '#3a2a0e',
              color: '#fbbf24',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>+</span>
            <span>xs:annotation</span>
          </button>
        ) : undefined}
      />

      {onToggleShowImports ? (
        <div style={{ padding: '8px 12px', border: '1px solid var(--graph-node-border)', borderRadius: 4, backgroundColor: 'var(--graph-node-bg-subtle)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--graph-node-text)' }}>
            <input
              type="checkbox"
              checked={xmlShowImports === true}
              onChange={(e) => handleToggleShowImports(e.currentTarget.checked)}
              style={{ cursor: 'pointer' }}
            />
            <span>Show Imports</span>
          </label>
          {xmlShowImports === true && (
            <div style={{ fontSize: 11, color: 'var(--graph-muted)', marginTop: 6 }}>
              Import entries follow document order.
            </div>
          )}
        </div>
      ) : null}

      {showAnnotationEditor ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Annotation</span>
            <button
              type="button"
              title="Delete annotation"
              onClick={() => {
                onChange({ id: node.id, xmlAnnotation: undefined, xmlAnnotations: [] });
                setShowAnnotationEditor(false);
              }}
              style={{
                padding: '2px 6px',
                borderRadius: 3,
                border: '1px solid #ccc',
                backgroundColor: '#f5f5f5',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
                color: '#666',
              }}
            >
              ✕
            </button>
          </div>
          <XmlAnnotationFieldAuto nodeId={node.id} data={data} onChange={onChange} />
        </div>
      ) : null}
    </div>
  );
}

export function XmlNodeRhsEditor({ node, onChange, onToggleShowAnnotations, xmlShowAnnotations, onToggleShowImports, xmlShowImports, getNodeByName }: XmlNodeRhsEditorProps) {
  if (!node) return <div style={{ color: '#888', fontStyle: 'italic' }}>Select a node to edit XML properties.</div>;
  const data = (node.data || {}) as any;
  const kind = (data.xmlNodeKind || '') as XmlNodeKind;
  const readOnlySource = typeof data.xmlReadOnlySource === 'string' && data.xmlReadOnlySource ? data.xmlReadOnlySource : undefined;

  if (kind === 'schema') return <XmlSchemaEditor node={node} onChange={onChange} onToggleShowAnnotations={onToggleShowAnnotations} xmlShowAnnotations={xmlShowAnnotations} onToggleShowImports={onToggleShowImports} xmlShowImports={xmlShowImports} readOnlySource={readOnlySource} getNodeByName={getNodeByName} />;
  if (kind === 'simpleType' && data.xmlIsAnonymous) return <XmlInstanceAttributeSimpleTypeEditor node={node} onChange={onChange} readOnlySource={readOnlySource} getNodeByName={getNodeByName} />;
  if (kind === 'simpleType') return <XmlInstanceSimpleTypeEditor node={node} onChange={onChange} readOnlySource={readOnlySource} getNodeByName={getNodeByName} />;
  if (kind === 'complexType') return (
    <XmlInstanceComplexTypeEditor
      node={node}
      onChange={onChange}
      readOnlySource={readOnlySource}
      getNodeByName={getNodeByName}
      renderAttributesManager={(editorNode, editorOnChange, options) => (
        <XmlAttributesManager
          node={editorNode}
          onChange={editorOnChange}
          addBadgeLabel={options?.addBadgeLabel}
          extraBadges={options?.extraBadges}
        />
      )}
    />
  );
  if (kind === 'attributeGroup') return (
    <XmlInstanceAttributeGroupEditor
      node={node}
      onChange={onChange}
      readOnlySource={readOnlySource}
      getNodeByName={getNodeByName}
      renderAttributesManager={(editorNode, editorOnChange, options) => (
        <XmlAttributesManager
          node={editorNode}
          onChange={editorOnChange}
          addBadgeLabel={options?.addBadgeLabel}
          extraBadges={options?.extraBadges}
        />
      )}
    />
  );
  if (kind === 'attribute') return <XmlInstanceAttributeEditor node={node} onChange={onChange} readOnlySource={readOnlySource} getNodeByName={getNodeByName} />;
  if (kind === 'element') return <XmlElementEditor node={node} onChange={onChange} readOnlySource={readOnlySource} getNodeByName={getNodeByName} />;
  if (kind === 'sequence' || kind === 'choice' || kind === 'all') return <XmlCompositorEditor node={node} onChange={onChange} readOnlySource={readOnlySource} getNodeByName={getNodeByName} />;
  if (kind === 'any') return <XmlAnyEditor node={node} onChange={onChange} getNodeByName={getNodeByName} />;

  return <div style={{ color: '#888', fontStyle: 'italic' }}>Select a schema, SimpleType, ComplexType, attribute, element, or compositor node to edit.</div>;
}
