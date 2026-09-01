import React from 'react';
import type { InlineSimpleTypeData, XmlNodeRhsEditorProps } from './types';
import { XmlAnnotationFieldAuto } from './xml-editor-controls';
import { InlineSimpleTypeEditor, ReferencedEnumerationList, XmlTypeSelector } from './xml-simple-type-controls';

export function XmlAttributeSimpleTypeEditor({ node, onChange }: XmlNodeRhsEditorProps) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  const [value, setValue] = React.useState<InlineSimpleTypeData>(
    (data.xmlAttributeInlineSimpleType as InlineSimpleTypeData | undefined) || { mode: 'restriction', base: 'xs:string', enumerations: [] },
  );

  React.useEffect(() => {
    setValue((data.xmlAttributeInlineSimpleType as InlineSimpleTypeData | undefined) || { mode: 'restriction', base: 'xs:string', enumerations: [] });
  }, [node?.id, data.xmlAttributeInlineSimpleType]);

  const handleChange = (next: InlineSimpleTypeData) => {
    setValue(next);
    onChange({ id: node.id, xmlAttributeInlineSimpleType: next });
  };

  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: 10 }} onSubmit={(e) => e.preventDefault()}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>SimpleType Editor</div>
      <InlineSimpleTypeEditor value={value} onChange={handleChange} pathLabel="SimpleType" />
      <XmlAnnotationFieldAuto nodeId={node.id} data={data} onChange={onChange} />
    </form>
  );
}

export function XmlAttributeEditor({ node, onChange, readOnlySource }: XmlNodeRhsEditorProps) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  const [name, setName] = React.useState<string>(String(data.xmlName || ''));
  const [type, setType] = React.useState<string>(String(data.xmlAttributeType || ''));
  const [widget, setWidget] = React.useState<string>(String(data.xmlWidget || ''));
  const [useValue, setUseValue] = React.useState<string>(String(data.xmlAttributeUse || 'optional'));
  const [isRef, setIsRef] = React.useState<boolean>(Boolean(data.xmlIsRef));
  const [defaultValue, setDefaultValue] = React.useState<string>(String(data.xmlAttributeDefault ?? ''));
  const attributeGroupRef = data.xmlAttributeGroupRef as string | undefined;
  const readOnly = Boolean(attributeGroupRef || readOnlySource);
  const [showDefault, setShowDefault] = React.useState<boolean>(data.xmlAttributeDefault !== undefined && data.xmlAttributeDefault !== '');
  const hasInlineSimpleType = Boolean(data.xmlHasInlineSimpleType);
  const referencedEnumerations = Array.isArray(data.xmlAttributeReferencedEnumerations) ? (data.xmlAttributeReferencedEnumerations as string[]) : [];
  const referencedTypeName = data.xmlAttributeReferencedTypeName as string | undefined;

  React.useEffect(() => {
    setName(String(data.xmlName || ''));
    setType(String(data.xmlAttributeType || ''));
    setWidget(String(data.xmlWidget || ''));
    setUseValue(String(data.xmlAttributeUse || 'optional'));
    setIsRef(Boolean(data.xmlIsRef));
    setDefaultValue(String(data.xmlAttributeDefault ?? ''));
    setShowDefault(data.xmlAttributeDefault !== undefined && data.xmlAttributeDefault !== '');
  }, [
    node?.id,
    JSON.stringify({
      xmlName: data.xmlName,
      xmlAttributeType: data.xmlAttributeType,
      xmlWidget: data.xmlWidget,
      xmlAttributeUse: data.xmlAttributeUse,
      xmlIsRef: data.xmlIsRef,
      xmlAttributeDefault: data.xmlAttributeDefault,
    }),
  ]);

  const badgePillStyle = (active: boolean): React.CSSProperties => ({
    padding: '3px 10px',
    fontSize: 11,
    fontWeight: 600,
    borderRadius: 999,
    cursor: 'pointer',
    border: `1px solid ${active ? 'var(--color-accent-7)' : 'var(--graph-node-border)'}`,
    background: active ? 'var(--color-accent-4)' : 'var(--graph-node-bg-subtle)',
    color: active ? 'var(--color-accent-11)' : 'var(--graph-muted)',
  });

  if (readOnly) {
    return (
      <form style={{ display: 'flex', flexDirection: 'column', gap: 10 }} onSubmit={(e) => e.preventDefault()}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>Attribute Editor</div>
        <div style={{ fontSize: 12, color: '#666' }}>
          Inherited from <code>xs:attributeGroup ref="{attributeGroupRef}"</code> - read-only here. Edit it on the <strong>{attributeGroupRef}</strong> attributeGroup node instead.
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12 }}>Name</span>
          <input aria-label="Attribute Name" value={name} readOnly disabled style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc', background: '#f5f5f5' }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12 }}>Type</span>
          <input aria-label="Attribute Type" value={type} readOnly disabled style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc', background: '#f5f5f5' }} />
        </label>
        {referencedEnumerations.length > 0 && (
          <ReferencedEnumerationList values={referencedEnumerations} typeName={referencedTypeName} />
        )}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12 }}>Use</span>
          <input aria-label="Attribute Use" value={useValue} readOnly disabled style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc', background: '#f5f5f5' }} />
        </label>
        {referencedEnumerations.length === 0 && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12 }}>Widget</span>
            <input aria-label="Attribute Widget" value={widget || '(none)'} readOnly disabled style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc', background: '#f5f5f5' }} />
          </label>
        )}
        {showDefault && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12 }}>Default</span>
            <input aria-label="Attribute Default Value" value={defaultValue} readOnly disabled style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc', background: '#f5f5f5' }} />
          </label>
        )}
        <XmlAnnotationFieldAuto nodeId={node.id} data={data} onChange={onChange} />
      </form>
    );
  }

  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: 10 }} onSubmit={(e) => e.preventDefault()}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>Attribute Editor</div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>Name</span>
        <input aria-label="Attribute Name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => onChange({ id: node.id, xmlName: name })} style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>Type</span>
        <XmlTypeSelector
          value={type}
          onChange={(next) => {
            setType(next);
            onChange({ id: node.id, xmlAttributeType: next });
          }}
          myTypeNames={Array.isArray(data.xmlMyTypeNames) ? data.xmlMyTypeNames : []}
          ariaLabel="Attribute Type"
          disabled={hasInlineSimpleType}
        />
      </label>
      {hasInlineSimpleType && (
        <div style={{ fontSize: 12, color: 'var(--graph-muted)' }}>
          This attribute has an inline SimpleType. Select its child node to edit it.
        </div>
      )}
      {referencedEnumerations.length > 0 && (
        <ReferencedEnumerationList values={referencedEnumerations} typeName={referencedTypeName} />
      )}
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
      {referencedEnumerations.length === 0 && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12 }}>Widget</span>
          <select
            aria-label="Attribute Widget"
            value={widget}
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
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          aria-pressed={useValue === 'required'}
          aria-label="Toggle Required"
          onClick={() => {
            const next = useValue === 'required' ? 'optional' : 'required';
            setUseValue(next);
            onChange({ id: node.id, xmlAttributeUse: next });
          }}
          style={badgePillStyle(useValue === 'required')}
        >
          required
        </button>
        {!showDefault ? (
          <button
            type="button"
            aria-label="Add Default Value"
            onClick={() => setShowDefault(true)}
            style={badgePillStyle(false)}
          >
            + default
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              aria-label="Attribute Default Value"
              value={defaultValue}
              onChange={(e) => setDefaultValue(e.target.value)}
              onBlur={() => onChange({ id: node.id, xmlAttributeDefault: defaultValue || undefined })}
              placeholder="default value"
              style={{ padding: '3px 8px', fontSize: 11, borderRadius: 999, border: '1px solid var(--color-accent-7)', background: 'var(--graph-node-bg)', color: 'var(--graph-node-text)', width: 120 }}
            />
            <button
              type="button"
              aria-label="Remove Default Value"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setDefaultValue('');
                setShowDefault(false);
                onChange({ id: node.id, xmlAttributeDefault: undefined });
              }}
              style={{ ...badgePillStyle(false), padding: '3px 6px' }}
            >
              x
            </button>
          </div>
        )}
      </div>
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
      <XmlAnnotationFieldAuto nodeId={node.id} data={data} onChange={onChange} />
    </form>
  );
}
