import React from 'react';
import type { Node as FlowNode } from 'reactflow';
import type { NodeData } from './types';
import { XmlTypeSelector } from './xml-simple-type-controls';

interface XmlElementTypeFieldProps {
  isRef: boolean;
  readOnly: boolean;
  name: string;
  type: string;
  xmlHasInlineComplexType: boolean;
  xmlInlineComplexTypeName?: string;
  xmlMyElementNames?: string[];
  xmlMyTypeNames?: string[];
  onNameChange: (next: string) => void;
  onTypeChange: (next: string) => void;
}

export function XmlElementTypeField({
  isRef,
  readOnly,
  name,
  type,
  xmlHasInlineComplexType,
  xmlInlineComplexTypeName,
  xmlMyElementNames,
  xmlMyTypeNames,
  onNameChange,
  onTypeChange,
}: XmlElementTypeFieldProps) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12 }}>{isRef ? 'ref' : 'Type'}</span>
      {isRef ? (
        <XmlTypeSelector
          value={name}
          disabled
          onChange={onNameChange}
          myTypeNames={Array.isArray(xmlMyElementNames) ? xmlMyElementNames : []}
          ariaLabel="Element Ref Target"
        />
      ) : xmlHasInlineComplexType ? (
        <span aria-label="Element Type" style={{ padding: 6, fontStyle: 'italic', color: '#666' }}>complexType - {xmlInlineComplexTypeName || 'Anon'}</span>
      ) : (
        <XmlTypeSelector
          value={type}
          disabled={readOnly}
          onChange={onTypeChange}
          myTypeNames={Array.isArray(xmlMyTypeNames) ? xmlMyTypeNames : []}
          ariaLabel="Element Type"
        />
      )}
    </label>
  );
}

interface XmlElementWidgetFieldProps {
  widget: string;
  readOnly: boolean;
  onChange: (next: string) => void;
}

export function XmlElementWidgetField({ widget, readOnly, onChange }: XmlElementWidgetFieldProps) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12 }}>Widget</span>
      <select
        aria-label="Element Widget"
        value={widget}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
        style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
      >
        <option value="">(none)</option>
        <option value="color">color</option>
        <option value="email">email</option>
        <option value="country">country</option>
        <option value="lang">lang</option>
      </select>
    </label>
  );
}

interface XmlElementOccursFieldsProps {
  minOccurs: string;
  maxOccurs: string;
  readOnly: boolean;
  isRef: boolean;
  onMinOccursChange: (next: string) => void;
  onMaxOccursChange: (next: string) => void;
  onMinOccursBlur: () => void;
  onMaxOccursBlur: () => void;
}

export function XmlElementOccursFields({
  minOccurs,
  maxOccurs,
  readOnly,
  isRef,
  onMinOccursChange,
  onMaxOccursChange,
  onMinOccursBlur,
  onMaxOccursBlur,
}: XmlElementOccursFieldsProps) {
  return (
    <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12 }}>minOccurs</span>
        <input
          aria-label="minOccurs"
          value={minOccurs}
          disabled={readOnly && !isRef}
          onChange={(e) => onMinOccursChange(e.target.value)}
          onBlur={onMinOccursBlur}
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
          onChange={(e) => onMaxOccursChange(e.target.value)}
          onBlur={onMaxOccursBlur}
          placeholder="1 or unbounded"
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc', width: '100%', boxSizing: 'border-box' }}
        />
      </label>
    </label>
  );
}

interface XmlElementDefaultFieldsProps {
  defaultValue: string;
  fixedValue: string;
  readOnly: boolean;
  isRef: boolean;
  onDefaultChange: (next: string) => void;
  onFixedChange: (next: string) => void;
  onDefaultBlur: () => void;
  onFixedBlur: () => void;
}

export function XmlElementDefaultFields({
  defaultValue,
  fixedValue,
  readOnly,
  isRef,
  onDefaultChange,
  onFixedChange,
  onDefaultBlur,
  onFixedBlur,
}: XmlElementDefaultFieldsProps) {
  return (
    <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12 }}>default</span>
        <input
          aria-label="default value"
          value={defaultValue}
          disabled={readOnly && !isRef}
          onChange={(e) => onDefaultChange(e.target.value)}
          onBlur={onDefaultBlur}
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
          onChange={(e) => onFixedChange(e.target.value)}
          onBlur={onFixedBlur}
          placeholder="(none)"
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
        />
      </label>
    </label>
  );
}

interface XmlElementToggleFieldProps {
  checked: boolean;
  disabled: boolean;
  label: string;
  ariaLabel: string;
  onChange: (next: boolean) => void;
}

export function XmlElementToggleField({ checked, disabled, label, ariaLabel, onChange }: XmlElementToggleFieldProps) {
  return (
    <label style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
        style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
      />
      <span style={{ fontSize: 12 }}>{label}</span>
    </label>
  );
}

interface XmlElementComplexContentNoticeProps {
  hasInlineComplexType: boolean;
  hasComplexContentExtension: boolean;
}

export function XmlElementComplexContentNotice({ hasInlineComplexType, hasComplexContentExtension }: XmlElementComplexContentNoticeProps) {
  if (!hasInlineComplexType) return null;

  return (
    <div style={{ fontSize: 12, color: '#666' }}>
      Add element writes into the first existing compositor under this inline complexType, or creates an xs:sequence when none exists.
      {hasComplexContentExtension ? ' In extension mode, these add actions write into complexContent/extension.' : ''}
    </div>
  );
}

interface XmlElementComplexContentFieldsProps {
  hasInlineComplexType: boolean;
  readOnly: boolean;
  isRef: boolean;
  hasComplexContentExtension: boolean;
  extendsType: string;
  complexTypeNames: string[];
  hasAnyAttributeNamespace: boolean;
  anyAttributeNamespace: string;
  onComplexContentExtensionChange: (enabled: boolean) => void;
  onExtendsTypeChange: (next: string) => void;
  onAnyAttributeNamespaceChange: (next: string) => void;
  onHasAnyAttributeNamespaceChange: (enabled: boolean) => void;
  renderAttributesManager?: (node: FlowNode<NodeData>, onChange: (patch: Partial<NodeData>) => void) => React.ReactNode;
  node: FlowNode<NodeData>;
  onChange: (patch: Partial<NodeData>) => void;
}

export function XmlElementComplexContentFields({
  hasInlineComplexType,
  readOnly,
  isRef,
  hasComplexContentExtension,
  extendsType,
  complexTypeNames,
  hasAnyAttributeNamespace,
  anyAttributeNamespace,
  onComplexContentExtensionChange,
  onExtendsTypeChange,
  onAnyAttributeNamespaceChange,
  onHasAnyAttributeNamespaceChange,
  renderAttributesManager,
  node,
  onChange,
}: XmlElementComplexContentFieldsProps) {
  if (!hasInlineComplexType) return null;

  return (
    <>
      <XmlElementToggleField
        checked={hasComplexContentExtension}
        disabled={readOnly || isRef}
        label="Use complexContent extension"
        ariaLabel="Use complexContent extension"
        onChange={(enabled) => {
          onComplexContentExtensionChange(enabled);
          if (enabled) {
            const fallbackBase = extendsType || complexTypeNames[0] || 'xs:anyType';
            onExtendsTypeChange(fallbackBase);
          }
        }}
      />
      {hasComplexContentExtension && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12 }}>ComplexContent base</span>
          <XmlTypeSelector
            value={extendsType}
            disabled={readOnly || isRef}
            onChange={onExtendsTypeChange}
            myTypeNames={complexTypeNames}
            ariaLabel="ComplexContent Base Type"
          />
        </label>
      )}
      <XmlElementToggleField
        checked={hasAnyAttributeNamespace}
        disabled={readOnly || isRef}
        label="Enable AnyAttribute"
        ariaLabel="Enable AnyAttribute"
        onChange={(enabled) => {
          onHasAnyAttributeNamespaceChange(enabled);
          if (enabled) {
            const next = anyAttributeNamespace.trim().length > 0 ? anyAttributeNamespace : '##other';
            onAnyAttributeNamespaceChange(next);
          } else {
            onAnyAttributeNamespaceChange('');
          }
        }}
      />
      {hasAnyAttributeNamespace && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12 }}>AnyAttribute namespace</span>
          <input
            aria-label="AnyAttribute Namespace"
            value={anyAttributeNamespace}
            disabled={readOnly || isRef}
            onChange={(e) => {
              const newValue = e.target.value;
              onAnyAttributeNamespaceChange(newValue);
            }}
            placeholder="##other"
            style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
          />
        </label>
      )}
      {!readOnly && renderAttributesManager ? renderAttributesManager(node, onChange) : null}
    </>
  );
}