import React from 'react';
import type { Node as FlowNode } from 'reactflow';
import type { NodeData, XmlNodeRhsEditorProps } from './types';
import { XmlAnnotationFieldAuto, XmlReadOnlyHint } from './xml-editor-controls';
import { XmlTypeSelector } from './xml-simple-type-controls';
import {
  XmlElementComplexContentFields,
  XmlElementComplexContentNotice,
  XmlElementDefaultFields,
  XmlElementOccursFields,
  XmlElementToggleField,
  XmlElementTypeField,
  XmlElementWidgetField,
} from './xml-element-editor-sections';

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
      <XmlElementTypeField
        isRef={isRef}
        readOnly={readOnly}
        name={name}
        type={type}
        xmlHasInlineComplexType={Boolean(data.xmlHasInlineComplexType)}
        xmlInlineComplexTypeName={data.xmlInlineComplexTypeName}
        xmlMyElementNames={Array.isArray(data.xmlMyElementNames) ? data.xmlMyElementNames : []}
        xmlMyTypeNames={Array.isArray(data.xmlMyTypeNames) ? data.xmlMyTypeNames : []}
        onNameChange={(next) => {
          setName(next);
          onChange({ id: node.id, xmlName: next });
        }}
        onTypeChange={(next) => {
          setType(next);
          onChange({ id: node.id, xmlElementType: next });
        }}
      />
      <XmlElementWidgetField
        widget={widget}
        readOnly={readOnly}
        onChange={(next) => {
          setWidget(next);
          onChange({ id: node.id, xmlWidget: next || undefined });
        }}
      />
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
      <XmlElementOccursFields
        minOccurs={minOccurs}
        maxOccurs={maxOccurs}
        readOnly={readOnly}
        isRef={isRef}
        onMinOccursChange={setMinOccurs}
        onMaxOccursChange={setMaxOccurs}
        onMinOccursBlur={() => onChange({ id: node.id, xmlMinOccurs: minOccurs })}
        onMaxOccursBlur={() => onChange({ id: node.id, xmlMaxOccurs: maxOccurs })}
      />
      <XmlElementDefaultFields
        defaultValue={defaultValue}
        fixedValue={fixedValue}
        readOnly={readOnly}
        isRef={isRef}
        onDefaultChange={setDefaultValue}
        onFixedChange={setFixedValue}
        onDefaultBlur={() => onChange({ id: node.id, xmlDefault: defaultValue })}
        onFixedBlur={() => onChange({ id: node.id, xmlFixed: fixedValue })}
      />
      <XmlElementToggleField
        checked={isRef}
        disabled={readOnly || isRef}
        label="Global Reference (ref)"
        ariaLabel="Global Reference"
        onChange={(next) => {
          setIsRef(next);
          onChange({ id: node.id, xmlIsRef: next });
        }}
      />
      <XmlElementToggleField
        checked={mixed}
        disabled={readOnly || isRef}
        label="Mixed Content"
        ariaLabel="Mixed Content"
        onChange={(next) => {
          setMixed(next);
          onChange({ id: node.id, xmlMixed: next });
        }}
      />
      <XmlElementComplexContentFields
        hasInlineComplexType={Boolean(data.xmlHasInlineComplexType)}
        readOnly={readOnly}
        isRef={isRef}
        hasComplexContentExtension={hasComplexContentExtension}
        extendsType={extendsType}
        complexTypeNames={complexTypeNames}
        hasAnyAttributeNamespace={hasAnyAttributeNamespace}
        anyAttributeNamespace={anyAttributeNamespace}
        onComplexContentExtensionChange={(enabled) => {
          setHasComplexContentExtension(enabled);
          onChange({ id: node.id, xmlComplexContentEnabled: enabled });
        }}
        onExtendsTypeChange={(next) => {
          setExtendsType(next);
          onChange({ id: node.id, xmlExtendsType: next });
        }}
        onAnyAttributeNamespaceChange={(next) => {
          setAnyAttributeNamespace(next);
          onChange({ id: node.id, xmlAnyAttributeNamespace: next });
        }}
        onHasAnyAttributeNamespaceChange={(enabled) => {
          setHasAnyAttributeNamespace(enabled);
          if (enabled) {
            // When enabling, ensure we have a valid value
            const next = anyAttributeNamespace.trim().length > 0 ? anyAttributeNamespace : '##other';
            setAnyAttributeNamespace(next);
            onChange({ id: node.id, xmlAnyAttributeNamespace: next });
          } else {
            // When disabling, clear it
            setAnyAttributeNamespace('');
            onChange({ id: node.id, xmlAnyAttributeNamespace: '' });
          }
        }}
        renderAttributesManager={renderAttributesManager}
        node={node}
        onChange={onChange}
      />
      <XmlElementComplexContentNotice
        hasInlineComplexType={Boolean(data.xmlHasInlineComplexType)}
        hasComplexContentExtension={hasComplexContentExtension}
      />
      {!data.xmlHasInlineComplexType ? (
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
      ) : null}
      <XmlAnnotationFieldAuto nodeId={node.id} data={data} onChange={onChange} />
    </form>
  );
}
