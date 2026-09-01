import React from 'react';
import type { Node as FlowNode } from 'reactflow';
import type { NodeData, XmlNodeRhsEditorProps } from './types';
import { XmlAnnotationFieldAuto, XmlReadOnlyHint } from './xml-editor-controls';

type RenderOptions = {
  addBadgeLabel?: string;
  extraBadges?: React.ReactNode;
};

type XmlInstanceComplexTypeEditorProps = XmlNodeRhsEditorProps & {
  renderAttributesManager?: (
    node: FlowNode<NodeData>,
    onChange: (patch: Partial<NodeData>) => void,
    options?: RenderOptions,
  ) => React.ReactNode;
};

export function XmlInstanceComplexTypeEditor({ node, onChange, readOnlySource, renderAttributesManager }: XmlInstanceComplexTypeEditorProps) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  const [name, setName] = React.useState<string>(String(data.xmlName || ''));
  const [isRef, setIsRef] = React.useState<boolean>(Boolean(data.xmlIsRef));
  const [mixed, setMixed] = React.useState<boolean>(Boolean(data.xmlMixed));
  const [anyAttributeNamespace, setAnyAttributeNamespace] = React.useState<string>(String(data.xmlAnyAttribute?.namespace || ''));
  const hasAnyAttributeNamespace = anyAttributeNamespace.trim().length > 0;
  const hasAnnotation = (Array.isArray(data.xmlAnnotations) && data.xmlAnnotations.length > 0) || Boolean(data.xmlAnnotation);
  const [showAnnotationEditor, setShowAnnotationEditor] = React.useState<boolean>(hasAnnotation);
  const readOnly = Boolean(readOnlySource);

  React.useEffect(() => {
    setName(String(data.xmlName || ''));
    setIsRef(Boolean(data.xmlIsRef));
    setMixed(Boolean(data.xmlMixed));
    setAnyAttributeNamespace(String(data.xmlAnyAttribute?.namespace || ''));
  }, [node?.id, data.xmlName, data.xmlIsRef, data.xmlMixed, data.xmlAnyAttribute]);

  React.useEffect(() => {
    if (hasAnnotation) setShowAnnotationEditor(true);
  }, [hasAnnotation]);

  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: 10 }} onSubmit={(e) => e.preventDefault()}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>ComplexType Editor</div>
      {readOnly && <XmlReadOnlyHint source={readOnlySource!} />}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>Name</span>
        <input
          aria-label="ComplexType Name"
          value={name}
          disabled={readOnly}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => onChange({ id: node.id, xmlName: name })}
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={isRef}
          disabled={readOnly}
          onChange={(e) => {
            setIsRef(e.target.checked);
            onChange({ id: node.id, xmlIsRef: e.target.checked });
          }}
          aria-label="Global Reference"
          style={{ cursor: readOnly ? 'not-allowed' : 'pointer' }}
        />
        <span style={{ fontSize: 12 }}>Global Reference (ref)</span>
      </label>
      <label style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={mixed}
          disabled={readOnly}
          onChange={(e) => {
            setMixed(e.target.checked);
            onChange({ id: node.id, xmlMixed: e.target.checked });
          }}
          aria-label="Mixed Content"
          style={{ cursor: readOnly ? 'not-allowed' : 'pointer' }}
        />
        <span style={{ fontSize: 12 }}>Mixed Content</span>
      </label>
      <div style={{ fontSize: 12, color: '#666' }}>
        Sequence, choice, and all are represented by child compositor nodes. Edit min/max on the compositor node.
      </div>
      {!readOnly && renderAttributesManager ? (
        renderAttributesManager(node, onChange, {
          addBadgeLabel: 'xs:attribute',
          extraBadges: (
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
          ),
        })
      ) : null}

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
