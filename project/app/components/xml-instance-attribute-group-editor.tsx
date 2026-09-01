import React from 'react';
import type { Node as FlowNode } from 'reactflow';
import type { NodeData, XmlNodeRhsEditorProps } from './types';
import { XmlAnnotationFieldAuto, XmlReadOnlyHint } from './xml-editor-controls';

type RenderOptions = {
  addBadgeLabel?: string;
  extraBadges?: React.ReactNode;
};

type XmlInstanceAttributeGroupEditorProps = XmlNodeRhsEditorProps & {
  renderAttributesManager?: (
    node: FlowNode<NodeData>,
    onChange: (patch: Partial<NodeData>) => void,
    options?: RenderOptions,
  ) => React.ReactNode;
};

export function XmlInstanceAttributeGroupEditor({ node, onChange, readOnlySource, renderAttributesManager }: XmlInstanceAttributeGroupEditorProps) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  const [name, setName] = React.useState<string>(String(data.xmlName || ''));
  const hasAnnotation = (Array.isArray(data.xmlAnnotations) && data.xmlAnnotations.length > 0) || Boolean(data.xmlAnnotation);
  const [showAnnotationEditor, setShowAnnotationEditor] = React.useState<boolean>(hasAnnotation);
  const readOnly = Boolean(readOnlySource);

  React.useEffect(() => {
    setName(String(data.xmlName || ''));
  }, [node?.id, data.xmlName]);

  React.useEffect(() => {
    if (hasAnnotation) setShowAnnotationEditor(true);
  }, [hasAnnotation]);

  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: 10 }} onSubmit={(e) => e.preventDefault()}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>AttributeGroup Editor</div>
      {readOnly && <XmlReadOnlyHint source={readOnlySource!} />}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>Name</span>
        <input
          aria-label="AttributeGroup Name"
          value={name}
          disabled={readOnly}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => onChange({ id: node.id, xmlName: name })}
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
        />
      </label>
      <div style={{ fontSize: 12, color: '#666' }}>
        Attributes added here are shared by every <code>xs:attributeGroup ref="{name || '...'}"</code> that references this group.
      </div>
      {!readOnly && renderAttributesManager ? renderAttributesManager(node, onChange, { addBadgeLabel: 'xs:attribute' }) : null}

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
