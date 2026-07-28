import React from 'react';
import type { Node as FlowNode } from 'reactflow';
import type { NodeData } from './types';

type XmlNodeKind = 'schema' | 'simpleType' | 'complexType' | 'attribute' | 'element' | 'sequence' | 'choice' | 'all';

/**
 * Props for XML node RHS editors and attribute manager.
 * - node: The selected ReactFlow node, or null if no node is selected
 * - onChange: Callback to emit partial node data updates (patches)
 */
export interface XmlNodeRhsEditorProps {
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
  const [isRef, setIsRef] = React.useState<boolean>(Boolean(data.xmlIsRef));

  React.useEffect(() => {
    setName(String(data.xmlName || ''));
    setMode(String(data.xmlSimpleTypeMode || 'restriction'));
    setBase(String(data.xmlBase || ''));
    setMemberTypes(String(data.xmlMemberTypes || ''));
    setItemType(String(data.xmlItemType || ''));
    setIsRef(Boolean(data.xmlIsRef));
  }, [node?.id, data.xmlName, data.xmlSimpleTypeMode, data.xmlBase, data.xmlMemberTypes, data.xmlItemType, data.xmlIsRef]);

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
      <label style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={isRef}
          onChange={(e) => {
            setIsRef(e.target.checked);
            onChange({ id: node.id, xmlIsRef: e.target.checked });
          }}
          aria-label="Global Reference"
          style={{ cursor: 'pointer' }}
        />
        <span style={{ fontSize: 12 }}>Global Reference (ref)</span>
      </label>
      <XmlAttributesManager node={node} onChange={onChange} />
    </form>
  );
}

/**
 * XmlAttributesManager - A reusable control for managing attributes on XML schema elements.
 * Supports add, edit, and remove operations on attributes for simpleType, complexType, or any schema node.
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
  const xmlPath = data.xmlPath as Array<string | number> | undefined;
  
  // Get attributes from node data (passed from graphical-schema-editor)
  const attributes = data.xmlAttributes || [];
  const [newAttrName, setNewAttrName] = React.useState('');
  const [newAttrType, setNewAttrType] = React.useState('xs:string');
  const [newAttrUse, setNewAttrUse] = React.useState('optional');

  const handleAddAttribute = () => {
    if (!newAttrName.trim()) return;
    if (!node) return;
    onChange({ 
      id: node.id, 
      xmlAddAttribute: { name: newAttrName, type: newAttrType, use: newAttrUse } 
    });
    setNewAttrName('');
    setNewAttrType('xs:string');
    setNewAttrUse('optional');
  };

  const handleRemoveAttribute = (index: number) => {
    if (!node) return;
    onChange({ id: node.id, xmlRemoveAttributeIndex: index });
  };

  const handleUpdateAttribute = (index: number, field: string, value: string) => {
    if (!node) return;
    const updated = { ...attributes[index], [field]: value };
    onChange({ id: node.id, xmlUpdateAttributeIndex: { index, ...updated } });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0', borderTop: '1px solid #eee', marginTop: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 12 }}>Attributes</div>
      
      {/* List existing attributes */}
      {attributes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {attributes.map((attr: any, index: number) => (
            <div key={index} style={{ display: 'flex', gap: 4, fontSize: 11, padding: 4, backgroundColor: '#f5f5f5', borderRadius: 4 }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <input
                  type="text"
                  value={attr.name || ''}
                  onChange={(e) => handleUpdateAttribute(index, 'name', e.target.value)}
                  placeholder="name"
                  style={{ padding: 3, borderRadius: 3, border: '1px solid #ddd', fontSize: 11 }}
                />
                <input
                  type="text"
                  value={attr.type || ''}
                  onChange={(e) => handleUpdateAttribute(index, 'type', e.target.value)}
                  placeholder="type"
                  style={{ padding: 3, borderRadius: 3, border: '1px solid #ddd', fontSize: 11 }}
                />
                <select
                  value={attr.use || 'optional'}
                  onChange={(e) => handleUpdateAttribute(index, 'use', e.target.value)}
                  style={{ padding: 3, borderRadius: 3, border: '1px solid #ddd', fontSize: 11 }}
                >
                  <option value="optional">optional</option>
                  <option value="required">required</option>
                  <option value="prohibited">prohibited</option>
                </select>
              </div>
              <button
                type="button"
                onClick={() => handleRemoveAttribute(index)}
                style={{ padding: '4px 8px', fontSize: 11, backgroundColor: '#fee', color: '#c33', border: '1px solid #fcc', borderRadius: 3, cursor: 'pointer' }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add new attribute */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 6, backgroundColor: '#f9f9f9', borderRadius: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 500 }}>Add Attribute</span>
        <input
          type="text"
          value={newAttrName}
          onChange={(e) => setNewAttrName(e.target.value)}
          placeholder="Attribute name"
          onKeyDown={(e) => e.key === 'Enter' && handleAddAttribute()}
          style={{ padding: 4, borderRadius: 3, border: '1px solid #ddd', fontSize: 11 }}
        />
        <input
          type="text"
          value={newAttrType}
          onChange={(e) => setNewAttrType(e.target.value)}
          placeholder="Type (e.g., xs:string)"
          style={{ padding: 4, borderRadius: 3, border: '1px solid #ddd', fontSize: 11 }}
        />
        <select
          value={newAttrUse}
          onChange={(e) => setNewAttrUse(e.target.value)}
          style={{ padding: 4, borderRadius: 3, border: '1px solid #ddd', fontSize: 11 }}
        >
          <option value="optional">optional</option>
          <option value="required">required</option>
          <option value="prohibited">prohibited</option>
        </select>
        <button
          type="button"
          onClick={handleAddAttribute}
          disabled={!newAttrName.trim()}
          style={{ padding: 4, fontSize: 11, backgroundColor: newAttrName.trim() ? '#e8f5e9' : '#f0f0f0', color: newAttrName.trim() ? '#2e7d32' : '#999', border: newAttrName.trim() ? '1px solid #c8e6c9' : '1px solid #ddd', borderRadius: 3, cursor: newAttrName.trim() ? 'pointer' : 'not-allowed' }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function XmlComplexTypeEditor({ node, onChange }: XmlNodeRhsEditorProps) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  const [name, setName] = React.useState<string>(String(data.xmlName || ''));
  const [isRef, setIsRef] = React.useState<boolean>(Boolean(data.xmlIsRef));

  React.useEffect(() => {
    setName(String(data.xmlName || ''));
    setIsRef(Boolean(data.xmlIsRef));
  }, [node?.id, data.xmlName, data.xmlIsRef]);

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
      <label style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={isRef}
          onChange={(e) => {
            setIsRef(e.target.checked);
            onChange({ id: node.id, xmlIsRef: e.target.checked });
          }}
          aria-label="Global Reference"
          style={{ cursor: 'pointer' }}
        />
        <span style={{ fontSize: 12 }}>Global Reference (ref)</span>
      </label>
      <div style={{ fontSize: 12, color: '#666' }}>
        Author sequence/choice/all via graph right-click. Edit min/max on the selected compositor node in RHS.
      </div>
      <XmlAttributesManager node={node} onChange={onChange} />
    </form>
  );
}

function XmlAttributeEditor({ node, onChange }: XmlNodeRhsEditorProps) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  const [name, setName] = React.useState<string>(String(data.xmlName || ''));
  const [type, setType] = React.useState<string>(String(data.xmlAttributeType || ''));
  const [useValue, setUseValue] = React.useState<string>(String(data.xmlAttributeUse || 'optional'));
  const [isRef, setIsRef] = React.useState<boolean>(Boolean(data.xmlIsRef));

  React.useEffect(() => {
    setName(String(data.xmlName || ''));
    setType(String(data.xmlAttributeType || ''));
    setUseValue(String(data.xmlAttributeUse || 'optional'));
    setIsRef(Boolean(data.xmlIsRef));
  }, [node?.id, data.xmlName, data.xmlAttributeType, data.xmlAttributeUse, data.xmlIsRef]);

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
      <label style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={isRef}
          onChange={(e) => {
            setIsRef(e.target.checked);
            onChange({ id: node.id, xmlIsRef: e.target.checked });
          }}
          aria-label="Global Reference"
          style={{ cursor: 'pointer' }}
        />
        <span style={{ fontSize: 12 }}>Global Reference (ref)</span>
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
  const [isRef, setIsRef] = React.useState<boolean>(Boolean(data.xmlIsRef));

  React.useEffect(() => {
    setName(String(data.xmlName || ''));
    setType(String(data.xmlElementType || ''));
    setMinOccurs(String(data.xmlMinOccurs ?? '1'));
    setMaxOccurs(String(data.xmlMaxOccurs ?? '1'));
    setIsRef(Boolean(data.xmlIsRef));
  }, [node?.id, data.xmlName, data.xmlElementType, data.xmlMinOccurs, data.xmlMaxOccurs, data.xmlIsRef]);

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
      <label style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={isRef}
          onChange={(e) => {
            setIsRef(e.target.checked);
            onChange({ id: node.id, xmlIsRef: e.target.checked });
          }}
          aria-label="Global Reference"
          style={{ cursor: 'pointer' }}
        />
        <span style={{ fontSize: 12 }}>Global Reference (ref)</span>
      </label>
    </form>
  );
}

function XmlSchemaEditor({ node, onChange }: XmlNodeRhsEditorProps) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  const [targetNamespace, setTargetNamespace] = React.useState<string>(String(data.xmlTargetNamespace || ''));
  const [elementFormDefault, setElementFormDefault] = React.useState<string>(String(data.xmlElementFormDefault || 'qualified'));
  const [attributeFormDefault, setAttributeFormDefault] = React.useState<string>(String(data.xmlAttributeFormDefault || 'unqualified'));

  React.useEffect(() => {
    setTargetNamespace(String(data.xmlTargetNamespace || ''));
    setElementFormDefault(String(data.xmlElementFormDefault || 'qualified'));
    setAttributeFormDefault(String(data.xmlAttributeFormDefault || 'unqualified'));
  }, [node?.id, data.xmlTargetNamespace, data.xmlElementFormDefault, data.xmlAttributeFormDefault]);

  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: 10 }} onSubmit={(e) => e.preventDefault()}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>Schema Editor</div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>targetNamespace</span>
        <input
          aria-label="Target Namespace"
          value={targetNamespace}
          onChange={(e) => setTargetNamespace(e.target.value)}
          onBlur={() => onChange({ id: node.id, xmlTargetNamespace: targetNamespace })}
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
          placeholder="http://example.com/schema"
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>elementFormDefault</span>
        <select
          aria-label="Element Form Default"
          value={elementFormDefault}
          onChange={(e) => {
            const nextValue = e.target.value;
            setElementFormDefault(nextValue);
            onChange({ id: node.id, xmlElementFormDefault: nextValue });
          }}
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
        >
          <option value="qualified">qualified</option>
          <option value="unqualified">unqualified</option>
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>attributeFormDefault</span>
        <select
          aria-label="Attribute Form Default"
          value={attributeFormDefault}
          onChange={(e) => {
            const nextValue = e.target.value;
            setAttributeFormDefault(nextValue);
            onChange({ id: node.id, xmlAttributeFormDefault: nextValue });
          }}
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
        >
          <option value="qualified">qualified</option>
          <option value="unqualified">unqualified</option>
        </select>
      </label>
    </form>
  );
}

export function XmlNodeRhsEditor({ node, onChange }: XmlNodeRhsEditorProps) {
  if (!node) return <div style={{ color: '#888', fontStyle: 'italic' }}>Select a node to edit XML properties.</div>;
  const data = (node.data || {}) as any;
  const kind = (data.xmlNodeKind || '') as XmlNodeKind;

  if (kind === 'schema') return <XmlSchemaEditor node={node} onChange={onChange} />;
  if (kind === 'simpleType') return <XmlSimpleTypeEditor node={node} onChange={onChange} />;
  if (kind === 'complexType') return <XmlComplexTypeEditor node={node} onChange={onChange} />;
  if (kind === 'attribute') return <XmlAttributeEditor node={node} onChange={onChange} />;
  if (kind === 'element') return <XmlElementEditor node={node} onChange={onChange} />;
  if (kind === 'sequence' || kind === 'choice' || kind === 'all') return <XmlCompositorEditor node={node} onChange={onChange} />;

  return <div style={{ color: '#888', fontStyle: 'italic' }}>Select a schema, SimpleType, ComplexType, attribute, element, or compositor node to edit.</div>;
}
