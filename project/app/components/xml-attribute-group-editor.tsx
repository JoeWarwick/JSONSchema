import React from 'react';
import type { Node as FlowNode } from 'reactflow';
import type { NodeData, XmlNodeRhsEditorProps } from './types';
import { XmlAnnotationFieldAuto, XmlReadOnlyHint } from './xml-editor-controls';

type XmlAttributeGroupEditorProps = XmlNodeRhsEditorProps & {
  renderAttributesManager?: (node: FlowNode<NodeData>, onChange: (patch: Partial<NodeData>) => void) => React.ReactNode;
};

export function XmlAttributeGroupEditor({ node, onChange, readOnlySource, renderAttributesManager }: XmlAttributeGroupEditorProps) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  const [name, setName] = React.useState<string>(String(data.xmlName || ''));
  const readOnly = Boolean(readOnlySource);

  React.useEffect(() => {
    setName(String(data.xmlName || ''));
  }, [node?.id, data.xmlName]);

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
      {!readOnly && renderAttributesManager ? renderAttributesManager(node, onChange) : null}
      <XmlAnnotationFieldAuto nodeId={node.id} data={data} onChange={onChange} />
    </form>
  );
}
