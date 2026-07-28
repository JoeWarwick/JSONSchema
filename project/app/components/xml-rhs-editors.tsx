import React from 'react';
import type { Node as FlowNode } from 'reactflow';
import type { NodeData } from './types';

type XmlNodeKind = 'schema' | 'simpleType' | 'complexType' | 'attribute' | 'element' | 'sequence' | 'choice' | 'all';

interface XmlNodeRhsEditorProps {
  node: FlowNode<NodeData> | null;
  onChange: (patch: Partial<NodeData>) => void;
}

function XmlSimpleTypeEditor({ node, onChange }: XmlNodeRhsEditorProps) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  const [name, setName] = React.useState<string>(String(data.xmlName || ''));
  const [mode, setMode] = React.useState<string>(String(data.xmlSimpleTypeMode || 'restriction'));
  const [base, setBase] = React.useState<string>(String(data.xmlBase || ''));
  const [memberTypes, setMemberTypes] = React.useState<string>(String(data.xmlMemberTypes || ''));
  const [itemType, setItemType] = React.useState<string>(String(data.xmlItemType || ''));

  React.useEffect(() => {
    setName(String(data.xmlName || ''));
    setMode(String(data.xmlSimpleTypeMode || 'restriction'));
    setBase(String(data.xmlBase || ''));
    setMemberTypes(String(data.xmlMemberTypes || ''));
    setItemType(String(data.xmlItemType || ''));
  }, [node?.id, data.xmlName, data.xmlSimpleTypeMode, data.xmlBase, data.xmlMemberTypes, data.xmlItemType]);

  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: 10 }} onSubmit={(e) => e.preventDefault()}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>SimpleType Editor</div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>Name</span>
        <input
          aria-label="SimpleType Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => onChange({ id: node.id, xmlName: name })}
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>Mode</span>
        <select
          aria-label="SimpleType Mode"
          value={mode}
          onChange={(e) => {
            const nextMode = e.target.value;
            setMode(nextMode);
            onChange({ id: node.id, xmlSimpleTypeMode: nextMode });
          }}
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
        >
          <option value="restriction">restriction</option>
          <option value="union">union</option>
          <option value="list">list</option>
        </select>
      </label>

      {mode === 'restriction' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12 }}>Base</span>
          <input
            aria-label="Restriction Base"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            onBlur={() => onChange({ id: node.id, xmlBase: base })}
            style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
            placeholder="xs:string"
          />
        </label>
      )}

      {mode === 'union' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12 }}>memberTypes</span>
          <input
            aria-label="Union Member Types"
            value={memberTypes}
            onChange={(e) => setMemberTypes(e.target.value)}
            onBlur={() => onChange({ id: node.id, xmlMemberTypes: memberTypes })}
            style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
            placeholder="tns:TypeA tns:TypeB"
          />
        </label>
      )}

      {mode === 'list' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12 }}>itemType</span>
          <input
            aria-label="List Item Type"
            value={itemType}
            onChange={(e) => setItemType(e.target.value)}
            onBlur={() => onChange({ id: node.id, xmlItemType: itemType })}
            style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
            placeholder="xs:string"
          />
        </label>
      )}
    </form>
  );
}

function XmlComplexTypeEditor({ node, onChange }: XmlNodeRhsEditorProps) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  const [name, setName] = React.useState<string>(String(data.xmlName || ''));

  React.useEffect(() => {
    setName(String(data.xmlName || ''));
  }, [node?.id, data.xmlName]);

  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: 10 }} onSubmit={(e) => e.preventDefault()}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>ComplexType Editor</div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>Name</span>
        <input
          aria-label="ComplexType Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => onChange({ id: node.id, xmlName: name })}
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
        />
      </label>
      <div style={{ fontSize: 12, color: '#666' }}>
        Author sequence/choice/all via graph right-click. Edit min/max on the selected compositor node in RHS.
      </div>
    </form>
  );
}

function XmlAttributeEditor({ node, onChange }: XmlNodeRhsEditorProps) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  const [name, setName] = React.useState<string>(String(data.xmlName || ''));
  const [type, setType] = React.useState<string>(String(data.xmlAttributeType || ''));
  const [useValue, setUseValue] = React.useState<string>(String(data.xmlAttributeUse || 'optional'));

  React.useEffect(() => {
    setName(String(data.xmlName || ''));
    setType(String(data.xmlAttributeType || ''));
    setUseValue(String(data.xmlAttributeUse || 'optional'));
  }, [node?.id, data.xmlName, data.xmlAttributeType, data.xmlAttributeUse]);

  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: 10 }} onSubmit={(e) => e.preventDefault()}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>Attribute Editor</div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>Name</span>
        <input aria-label="Attribute Name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => onChange({ id: node.id, xmlName: name })} style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>Type</span>
        <input aria-label="Attribute Type" value={type} onChange={(e) => setType(e.target.value)} onBlur={() => onChange({ id: node.id, xmlAttributeType: type })} style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }} placeholder="xs:string" />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>Use</span>
        <select
          aria-label="Attribute Use"
          value={useValue}
          onChange={(e) => {
            const next = e.target.value;
            setUseValue(next);
            onChange({ id: node.id, xmlAttributeUse: next });
          }}
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
        >
          <option value="optional">optional</option>
          <option value="required">required</option>
          <option value="prohibited">prohibited</option>
        </select>
      </label>
    </form>
  );
}

function XmlCompositorEditor({ node, onChange }: XmlNodeRhsEditorProps) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  const [minOccurs, setMinOccurs] = React.useState<string>(String(data.xmlMinOccurs ?? '1'));
  const [maxOccurs, setMaxOccurs] = React.useState<string>(String(data.xmlMaxOccurs ?? '1'));

  React.useEffect(() => {
    setMinOccurs(String(data.xmlMinOccurs ?? '1'));
    setMaxOccurs(String(data.xmlMaxOccurs ?? '1'));
  }, [node?.id, data.xmlMinOccurs, data.xmlMaxOccurs]);

  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: 10 }} onSubmit={(e) => e.preventDefault()}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>{String(data.xmlNodeKind || 'Compositor')} Editor</div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>minOccurs</span>
        <input
          aria-label="minOccurs"
          value={minOccurs}
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
          onChange={(e) => setMaxOccurs(e.target.value)}
          onBlur={() => onChange({ id: node.id, xmlMaxOccurs: maxOccurs })}
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
          placeholder="1 or unbounded"
        />
      </label>
    </form>
  );
}

function XmlElementEditor({ node, onChange }: XmlNodeRhsEditorProps) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  const [name, setName] = React.useState<string>(String(data.xmlName || ''));
  const [type, setType] = React.useState<string>(String(data.xmlElementType || ''));
  const [minOccurs, setMinOccurs] = React.useState<string>(String(data.xmlMinOccurs ?? '1'));
  const [maxOccurs, setMaxOccurs] = React.useState<string>(String(data.xmlMaxOccurs ?? '1'));

  React.useEffect(() => {
    setName(String(data.xmlName || ''));
    setType(String(data.xmlElementType || ''));
    setMinOccurs(String(data.xmlMinOccurs ?? '1'));
    setMaxOccurs(String(data.xmlMaxOccurs ?? '1'));
  }, [node?.id, data.xmlName, data.xmlElementType, data.xmlMinOccurs, data.xmlMaxOccurs]);

  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: 10 }} onSubmit={(e) => e.preventDefault()}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>Element Editor</div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>Name</span>
        <input
          aria-label="Element Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => onChange({ id: node.id, xmlName: name })}
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>Type</span>
        <input
          aria-label="Element Type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          onBlur={() => onChange({ id: node.id, xmlElementType: type })}
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
          placeholder="xs:string"
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>minOccurs</span>
        <input
          aria-label="Element minOccurs"
          value={minOccurs}
          onChange={(e) => setMinOccurs(e.target.value)}
          onBlur={() => onChange({ id: node.id, xmlMinOccurs: minOccurs })}
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
          placeholder="1"
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>maxOccurs</span>
        <input
          aria-label="Element maxOccurs"
          value={maxOccurs}
          onChange={(e) => setMaxOccurs(e.target.value)}
          onBlur={() => onChange({ id: node.id, xmlMaxOccurs: maxOccurs })}
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
          placeholder="1 or unbounded"
        />
      </label>
    </form>
  );
}

export function XmlNodeRhsEditor({ node, onChange }: XmlNodeRhsEditorProps) {
  if (!node) return <div style={{ color: '#888', fontStyle: 'italic' }}>Select a node to edit XML properties.</div>;
  const data = (node.data || {}) as any;
  const kind = (data.xmlNodeKind || '') as XmlNodeKind;

  if (kind === 'simpleType') return <XmlSimpleTypeEditor node={node} onChange={onChange} />;
  if (kind === 'complexType') return <XmlComplexTypeEditor node={node} onChange={onChange} />;
  if (kind === 'attribute') return <XmlAttributeEditor node={node} onChange={onChange} />;
  if (kind === 'element') return <XmlElementEditor node={node} onChange={onChange} />;
  if (kind === 'sequence' || kind === 'choice' || kind === 'all') return <XmlCompositorEditor node={node} onChange={onChange} />;

  return <div style={{ color: '#888', fontStyle: 'italic' }}>Select a SimpleType, ComplexType, attribute, element, or compositor node to edit.</div>;
}
