import React from 'react';
import type { Node as FlowNode } from 'reactflow';
import type { NodeData, XmlNodeRhsEditorProps } from './types';
import { XmlAnnotationFieldAuto, XmlReadOnlyHint } from './xml-editor-controls';
import { XmlTypeSelector } from './xml-simple-type-controls';

type XmlComplexTypeEditorProps = XmlNodeRhsEditorProps & {
  renderAttributesManager?: (node: FlowNode<NodeData>, onChange: (patch: Partial<NodeData>) => void) => React.ReactNode;
};

export function XmlComplexTypeEditor({ node, onChange, readOnlySource, renderAttributesManager }: XmlComplexTypeEditorProps) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  const [name, setName] = React.useState<string>(String(data.xmlName || ''));
  const [isRef, setIsRef] = React.useState<boolean>(Boolean(data.xmlIsRef));
  const [mixed, setMixed] = React.useState<boolean>(Boolean(data.xmlMixed));
  const [anyAttributeNamespace, setAnyAttributeNamespace] = React.useState<string>(String(data.xmlAnyAttribute?.namespace || ''));
  const [hasAnyAttributeNamespace, setHasAnyAttributeNamespace] = React.useState<boolean>(String(data.xmlAnyAttribute?.namespace || '').trim().length > 0);
  const [hasComplexContentExtension, setHasComplexContentExtension] = React.useState<boolean>(Boolean(data.xmlExtendsType));
  const [extendsType, setExtendsType] = React.useState<string>(String(data.xmlExtendsType || ''));
  const complexTypeNames = Array.isArray(data.xmlMyComplexTypeNames) ? (data.xmlMyComplexTypeNames as string[]) : [];
  const readOnly = Boolean(readOnlySource);

  React.useEffect(() => {
    setName(String(data.xmlName || ''));
    setIsRef(Boolean(data.xmlIsRef));
    setMixed(Boolean(data.xmlMixed));
    setAnyAttributeNamespace(String(data.xmlAnyAttribute?.namespace || ''));
    setHasAnyAttributeNamespace(String(data.xmlAnyAttribute?.namespace || '').trim().length > 0);
    setHasComplexContentExtension(Boolean(data.xmlExtendsType));
    setExtendsType(String(data.xmlExtendsType || ''));
  }, [node?.id, data.xmlName, data.xmlIsRef, data.xmlMixed, data.xmlAnyAttribute, data.xmlExtendsType]);

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
      <div style={{ fontSize: 12, color: '#666' }}>
        Sequence, choice, and all are represented by child compositor nodes. Edit min/max on the compositor node.
        {' '}Add element writes into the first existing compositor, or creates an xs:sequence when none exists.
        {hasComplexContentExtension ? ' In extension mode, these add actions write into complexContent/extension.' : ''}
      </div>
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
      <XmlAnnotationFieldAuto nodeId={node.id} data={data} onChange={onChange} />
    </form>
  );
}
