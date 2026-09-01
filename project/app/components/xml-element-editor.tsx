import React from 'react';
import type { Node as FlowNode } from 'reactflow';
import type { NodeData, XmlNodeRhsEditorProps } from './types';
import { XmlAnnotationFieldAuto, XmlReadOnlyHint } from './xml-editor-controls';
import { XmlTypeSelector } from './xml-simple-type-controls';

type ElementEditorProps = XmlNodeRhsEditorProps & {
  renderAttributesManager?: (node: FlowNode<NodeData>, onChange: (patch: Partial<NodeData>) => void) => React.ReactNode;
};

export function XmlElementEditor({ node, onChange, readOnlySource, renderAttributesManager }: ElementEditorProps) {
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
  const [hasAnyAttributeNamespace, setHasAnyAttributeNamespace] = React.useState<boolean>(String(data.xmlAnyAttribute?.namespace || '').trim().length > 0);
  const [hasComplexContentExtension, setHasComplexContentExtension] = React.useState<boolean>(Boolean(data.xmlExtendsType));
  const [extendsType, setExtendsType] = React.useState<string>(String(data.xmlExtendsType || ''));
  const complexTypeNames = Array.isArray(data.xmlMyComplexTypeNames) ? (data.xmlMyComplexTypeNames as string[]) : [];
  const [defaultValue, setDefaultValue] = React.useState<string>(String(data.xmlDefault || ''));
  const [fixedValue, setFixedValue] = React.useState<string>(String(data.xmlFixed || ''));
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
    setHasAnyAttributeNamespace(String(data.xmlAnyAttribute?.namespace || '').trim().length > 0);
    setHasComplexContentExtension(Boolean(data.xmlExtendsType));
    setExtendsType(String(data.xmlExtendsType || ''));
    setDefaultValue(String(data.xmlDefault || ''));
    setFixedValue(String(data.xmlFixed || ''));
  }, [node?.id, data.xmlName, data.xmlElementType, data.xmlWidget, data.xmlSubstitutionGroupParent, data.xmlMinOccurs, data.xmlMaxOccurs, data.xmlIsRef, data.xmlMixed, data.xmlAnyAttribute, data.xmlExtendsType, data.xmlDefault, data.xmlFixed]);

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
          <XmlTypeSelector
            value={name}
            disabled
            onChange={(next) => {
              setName(next);
              onChange({ id: node.id, xmlName: next });
            }}
            myTypeNames={Array.isArray(data.xmlMyElementNames) ? data.xmlMyElementNames : []}
            ariaLabel="Element Ref Target"
          />
        ) : data.xmlHasInlineComplexType ? (
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
        <>
          <label style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={hasComplexContentExtension}
              disabled={readOnly || isRef}
              onChange={(e) => {
                const enabled = e.target.checked;
                setHasComplexContentExtension(enabled);
                onChange({ id: node.id, xmlComplexContentEnabled: enabled });
                if (enabled) {
                  const fallbackBase = extendsType || complexTypeNames[0] || 'xs:anyType';
                  setExtendsType(fallbackBase);
                  onChange({ id: node.id, xmlExtendsType: fallbackBase });
                }
              }}
              aria-label="Use complexContent extension"
              style={{ cursor: (readOnly || isRef) ? 'not-allowed' : 'pointer' }}
            />
            <span style={{ fontSize: 12 }}>Use complexContent extension</span>
          </label>
          {hasComplexContentExtension && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12 }}>ComplexContent base</span>
              <XmlTypeSelector
                value={extendsType}
                disabled={readOnly || isRef}
                onChange={(next) => {
                  setExtendsType(next);
                  onChange({ id: node.id, xmlExtendsType: next });
                }}
                myTypeNames={complexTypeNames}
                ariaLabel="ComplexContent Base Type"
              />
            </label>
          )}
        </>
      ) : null}
      {data.xmlHasInlineComplexType ? (
        <div style={{ fontSize: 12, color: '#666' }}>
          Add element writes into the first existing compositor under this inline complexType, or creates an xs:sequence when none exists.
          {hasComplexContentExtension ? ' In extension mode, these add actions write into complexContent/extension.' : ''}
        </div>
      ) : null}
      {data.xmlHasInlineComplexType ? (
        <>
          <label style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={hasAnyAttributeNamespace}
              disabled={readOnly || isRef}
              onChange={(e) => {
                const enabled = e.target.checked;
                setHasAnyAttributeNamespace(enabled);
                if (enabled) {
                  const next = anyAttributeNamespace.trim().length > 0 ? anyAttributeNamespace : '##other';
                  setAnyAttributeNamespace(next);
                  onChange({ id: node.id, xmlAnyAttributeNamespace: next });
                } else {
                  setAnyAttributeNamespace('');
                  onChange({ id: node.id, xmlAnyAttributeNamespace: '' });
                }
              }}
              aria-label="Enable AnyAttribute"
              style={{ cursor: (readOnly || isRef) ? 'not-allowed' : 'pointer' }}
            />
            <span style={{ fontSize: 12 }}>Enable AnyAttribute</span>
          </label>
          {hasAnyAttributeNamespace && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12 }}>AnyAttribute namespace</span>
              <input
                aria-label="AnyAttribute Namespace"
                value={anyAttributeNamespace}
                disabled={readOnly || isRef}
                onChange={(e) => setAnyAttributeNamespace(e.target.value)}
                onBlur={() => onChange({ id: node.id, xmlAnyAttributeNamespace: anyAttributeNamespace })}
                placeholder="##other"
                style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
              />
            </label>
          )}
          {!readOnly && renderAttributesManager ? renderAttributesManager(node, onChange) : null}
        </>
      ) : (
        !isRef ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: '#666', background: '#fff7ed', border: '1px solid #f5c2b7', borderRadius: 6, padding: 8 }}>
            <div>
              This element is currently simpleType-backed. Convert it to ComplexType before adding xs:attribute or xs:anyAttribute.
            </div>
            {!readOnly ? (
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
            ) : null}
          </div>
        ) : null
      )}
      <XmlAnnotationFieldAuto nodeId={node.id} data={data} onChange={onChange} />
    </form>
  );
}
