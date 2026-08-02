import React from 'react';
import type { Node as FlowNode } from 'reactflow';
import type { NodeData, InlineSimpleTypeData, SimpleTypeFacets } from './types';

type XmlNodeKind = 'schema' | 'simpleType' | 'complexType' | 'attributeGroup' | 'attribute' | 'element' | 'sequence' | 'choice' | 'all' | 'any';

/**
 * Props for XML node RHS editors and attribute manager.
 * - node: The selected ReactFlow node, or null if no node is selected
 * - onChange: Callback to emit partial node data updates (patches)
 */
export interface XmlNodeRhsEditorProps {
  node: FlowNode<NodeData> | null;
  onChange: (patch: Partial<NodeData>) => void;
}

/**
 * Defines an editable property for a schema node.
 * Supports text input, select dropdown, and checkbox field types.
 */
interface PropertyFieldConfig {
  /** Label displayed to user */
  label: string;
  /** Data property key (e.g., 'xmlTargetNamespace') */
  dataKey: keyof NodeData;
  /** Field type: 'text', 'select', or 'checkbox' */
  type: 'text' | 'select' | 'checkbox';
  /** Placeholder text (for text inputs) */
  placeholder?: string;
  /** Options for select fields */
  options?: Array<{ value: string; label: string }>;
  /** Default value if not set */
  defaultValue?: string | boolean;
  /** Aria label for accessibility */
  ariaLabel: string;
}

/**
 * Generic property field component that renders based on type.
 */
function PropertyField({
  config,
  value,
  onChange,
  onBlur,
}: {
  config: PropertyFieldConfig;
  value: string | boolean;
  onChange: (val: string | boolean) => void;
  onBlur?: () => void;
}) {
  if (config.type === 'select' && config.options) {
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>{config.label}</span>
        <select
          aria-label={config.ariaLabel}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
        >
          {config.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (config.type === 'checkbox') {
    return (
      <label style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          aria-label={config.ariaLabel}
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          onBlur={onBlur}
          style={{ width: 18, height: 18, cursor: 'pointer' }}
        />
        <span style={{ fontSize: 12 }}>{config.label}</span>
      </label>
    );
  }

  // Default: text input
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12 }}>{config.label}</span>
      <input
        type="text"
        aria-label={config.ariaLabel}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
        placeholder={config.placeholder}
      />
    </label>
  );
}

/**
 * Generic property form component that renders fields from a config array.
 */
function PropertyForm({
  title,
  configs,
  nodeData,
  nodeId,
  onChange,
}: {
  title: string;
  configs: PropertyFieldConfig[];
  nodeData: Record<string, any>;
  nodeId: string;
  onChange: (patch: Partial<NodeData>) => void;
}) {
  const [values, setValues] = React.useState<Record<string, string | boolean>>({});

  // Initialize values from node data
  React.useEffect(() => {
    const initial: Record<string, string | boolean> = {};
    configs.forEach((config) => {
      const val = nodeData[config.dataKey];
      if (config.type === 'checkbox') {
        initial[config.dataKey] = Boolean(val);
      } else {
        initial[config.dataKey] = String(val ?? config.defaultValue ?? '');
      }
    });
    setValues(initial);
  }, [nodeId, nodeData, configs]);

  const handleChange = (key: keyof NodeData, value: string | boolean) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleBlur = (key: keyof NodeData, value?: string | boolean) => {
    // Use provided value if available (for immediate blur after onChange), otherwise read from state
    const finalValue = value !== undefined ? value : values[key];
    onChange({ id: nodeId, [key]: finalValue } as Partial<NodeData>);
  };

  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: 10 }} onSubmit={(e) => e.preventDefault()}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>{title}</div>
      {configs.map((config) => (
        <PropertyField
          key={String(config.dataKey)}
          config={config}
          value={values[config.dataKey] ?? config.defaultValue ?? ''}
          onChange={(val) => {
            handleChange(config.dataKey, val);
            // For select fields, immediately call handleBlur with the new value
            if (config.type === 'select') {
              handleBlur(config.dataKey, val);
            }
          }}
          onBlur={() => handleBlur(config.dataKey)}
        />
      ))}
    </form>
  );
}

/**
 * Shared "Annotation" (`xs:annotation/xs:documentation`) text field, two-way bound to
 * `xmlAnnotation` on the node's data — offered by every XML node editor kind (schema,
 * simpleType, complexType, attributeGroup, attribute, element, compositor).
 */
function XmlAnnotationField({
  nodeId,
  value,
  onChange,
}: {
  nodeId: string;
  value: string;
  onChange: (patch: Partial<NodeData>) => void;
}) {
  const [text, setText] = React.useState<string>(value);

  React.useEffect(() => {
    setText(value);
  }, [nodeId, value]);

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12 }}>Annotation</span>
      <textarea
        aria-label="Annotation"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onChange({ id: nodeId, xmlAnnotation: text } as Partial<NodeData>)}
        rows={3}
        style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc', fontFamily: 'inherit', resize: 'vertical' }}
        placeholder="Documentation for this schema item"
      />
    </label>
  );
}

function XmlSimpleTypeEditor({ node, onChange }: XmlNodeRhsEditorProps) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  const [name, setName] = React.useState<string>(String(data.xmlName || ''));
  const [mode, setMode] = React.useState<string>(String(data.xmlSimpleTypeMode || 'restriction'));
  const [base, setBase] = React.useState<string>(String(data.xmlBase || ''));
  const [memberTypes, setMemberTypes] = React.useState<string>(String(data.xmlMemberTypes || ''));
  const [itemType, setItemType] = React.useState<string>(String(data.xmlItemType || ''));
  const [enumerations, setEnumerations] = React.useState<string[]>(Array.isArray(data.xmlEnumerations) ? data.xmlEnumerations : []);
  const [facets, setFacets] = React.useState<SimpleTypeFacets>(data.xmlFacets && typeof data.xmlFacets === 'object' ? data.xmlFacets : {});
  const [isRef, setIsRef] = React.useState<boolean>(Boolean(data.xmlIsRef));

  React.useEffect(() => {
    setName(String(data.xmlName || ''));
    setMode(String(data.xmlSimpleTypeMode || 'restriction'));
    setBase(String(data.xmlBase || ''));
    setMemberTypes(String(data.xmlMemberTypes || ''));
    setItemType(String(data.xmlItemType || ''));
    setEnumerations(Array.isArray(data.xmlEnumerations) ? data.xmlEnumerations : []);
    setFacets(data.xmlFacets && typeof data.xmlFacets === 'object' ? data.xmlFacets : {});
    setIsRef(Boolean(data.xmlIsRef));
  }, [node?.id, data.xmlName, data.xmlSimpleTypeMode, data.xmlBase, data.xmlMemberTypes, data.xmlItemType, data.xmlEnumerations, data.xmlFacets, data.xmlIsRef]);

  const handleEnumerationsChange = (next: string[]) => {
    setEnumerations(next);
    onChange({ id: node.id, xmlEnumerations: next });
  };

  const handleFacetsChange = (next: SimpleTypeFacets) => {
    setFacets(next);
    onChange({ id: node.id, xmlFacets: next });
  };

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
        <>
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
          <EnumerationListEditor values={enumerations} onChange={handleEnumerationsChange} ariaPrefix="SimpleType enumeration" />
          <FacetsEditor facets={facets} onChange={handleFacetsChange} ariaPrefix="SimpleType facet" />
        </>
      )}

      {mode === 'union' && (
        <>
          <MemberTypesListEditor
            value={memberTypes}
            onChange={(next) => {
              setMemberTypes(next);
              onChange({ id: node.id, xmlMemberTypes: next });
            }}
            myTypeNames={Array.isArray(data.xmlMyTypeNames) ? data.xmlMyTypeNames : []}
            ariaPrefix="Union Member Types"
          />
          {Array.isArray(data.xmlUnionReferencedEnumerations) && data.xmlUnionReferencedEnumerations.length > 0 && (
            <ReferencedEnumerationList values={data.xmlUnionReferencedEnumerations} />
          )}
        </>
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
      <XmlAnnotationField nodeId={node.id} value={String(data.xmlAnnotation || '')} onChange={onChange} />
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

  // Get attributes from node data (passed from graphical-schema-editor)
  const attributes = data.xmlAttributes || [];
  const [showAddForm, setShowAddForm] = React.useState(false);
  const [newAttrName, setNewAttrName] = React.useState('');
  const [newAttrType, setNewAttrType] = React.useState('xs:string');
  const [newAttrUse, setNewAttrUse] = React.useState('optional');

  const resetAddForm = () => {
    setNewAttrName('');
    setNewAttrType('xs:string');
    setNewAttrUse('optional');
  };

  const handleAddAttribute = () => {
    if (!newAttrName.trim()) return;
    if (!node) return;
    onChange({ 
      id: node.id, 
      xmlAddAttribute: { name: newAttrName, type: newAttrType, use: newAttrUse } 
    });
    resetAddForm();
  };

  const handleCancelAdd = () => {
    resetAddForm();
    setShowAddForm(false);
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

  const fieldStyle = { padding: 3, borderRadius: 3, border: '1px solid var(--graph-node-border)', background: 'var(--graph-node-bg)', color: 'var(--graph-node-text)', fontSize: 11 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0', borderTop: '1px solid var(--graph-sidebar-border)', marginTop: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--graph-text)' }}>Attributes</div>
      
      {/* List existing attributes */}
      {attributes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {attributes.map((attr: any, index: number) => (
            <div key={index} style={{ display: 'flex', gap: 4, fontSize: 11, padding: 4, backgroundColor: 'var(--graph-node-bg-subtle)', borderRadius: 4 }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <input
                  type="text"
                  value={attr.name || ''}
                  onChange={(e) => handleUpdateAttribute(index, 'name', e.target.value)}
                  placeholder="name"
                  style={fieldStyle}
                />
                <input
                  type="text"
                  value={attr.type || ''}
                  onChange={(e) => handleUpdateAttribute(index, 'type', e.target.value)}
                  placeholder="type"
                  style={fieldStyle}
                />
                <select
                  value={attr.use || 'optional'}
                  onChange={(e) => handleUpdateAttribute(index, 'use', e.target.value)}
                  style={fieldStyle}
                >
                  <option value="optional">optional</option>
                  <option value="required">required</option>
                  <option value="prohibited">prohibited</option>
                </select>
              </div>
              <button
                type="button"
                onClick={() => handleRemoveAttribute(index)}
                style={{ padding: '4px 8px', fontSize: 11, backgroundColor: 'var(--color-error-4)', color: 'var(--color-error-11)', border: '1px solid var(--color-error-7)', borderRadius: 3, cursor: 'pointer' }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add new attribute, hidden behind a toggle button until requested */}
      {!showAddForm && (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          style={{ alignSelf: 'flex-start', padding: '4px 10px', fontSize: 11, fontWeight: 500, backgroundColor: 'var(--graph-node-bg-subtle)', color: 'var(--graph-text)', border: '1px solid var(--graph-node-border)', borderRadius: 3, cursor: 'pointer' }}
        >
          + Add Attribute
        </button>
      )}
      {showAddForm && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 6, backgroundColor: 'var(--graph-node-bg-subtle)', border: '1px solid var(--graph-node-border)', borderRadius: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--graph-text)' }}>Add Attribute</span>
          <input
            type="text"
            value={newAttrName}
            onChange={(e) => setNewAttrName(e.target.value)}
            placeholder="Attribute name"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleAddAttribute()}
            style={fieldStyle}
          />
          <input
            type="text"
            value={newAttrType}
            onChange={(e) => setNewAttrType(e.target.value)}
            placeholder="Type (e.g., xs:string)"
            style={fieldStyle}
          />
          <select
            value={newAttrUse}
            onChange={(e) => setNewAttrUse(e.target.value)}
            style={fieldStyle}
          >
            <option value="optional">optional</option>
            <option value="required">required</option>
            <option value="prohibited">prohibited</option>
          </select>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              onClick={handleAddAttribute}
              disabled={!newAttrName.trim()}
              style={{ flex: 1, padding: 4, fontSize: 11, backgroundColor: newAttrName.trim() ? 'var(--color-success-4)' : 'var(--graph-node-bg)', color: newAttrName.trim() ? 'var(--color-success-11)' : 'var(--graph-muted)', border: newAttrName.trim() ? '1px solid var(--color-success-7)' : '1px solid var(--graph-node-border)', borderRadius: 3, cursor: newAttrName.trim() ? 'pointer' : 'not-allowed' }}
            >
              Add
            </button>
            <button
              type="button"
              onClick={handleCancelAdd}
              style={{ padding: 4, fontSize: 11, backgroundColor: 'var(--graph-node-bg)', color: 'var(--graph-muted)', border: '1px solid var(--graph-node-border)', borderRadius: 3, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function XmlComplexTypeEditor({ node, onChange }: XmlNodeRhsEditorProps) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  const [name, setName] = React.useState<string>(String(data.xmlName || ''));
  const [isRef, setIsRef] = React.useState<boolean>(Boolean(data.xmlIsRef));
  const [mixed, setMixed] = React.useState<boolean>(Boolean(data.xmlMixed));
  const [anyAttributeNamespace, setAnyAttributeNamespace] = React.useState<string>(String(data.xmlAnyAttribute?.namespace || ''));

  React.useEffect(() => {
    setName(String(data.xmlName || ''));
    setIsRef(Boolean(data.xmlIsRef));
    setMixed(Boolean(data.xmlMixed));
    setAnyAttributeNamespace(String(data.xmlAnyAttribute?.namespace || ''));
  }, [node?.id, data.xmlName, data.xmlIsRef, data.xmlMixed, data.xmlAnyAttribute]);

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
      <label style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={mixed}
          onChange={(e) => {
            setMixed(e.target.checked);
            onChange({ id: node.id, xmlMixed: e.target.checked });
          }}
          aria-label="Mixed Content"
          style={{ cursor: 'pointer' }}
        />
        <span style={{ fontSize: 12 }}>Mixed Content</span>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>AnyAttribute namespace</span>
        <input
          aria-label="AnyAttribute Namespace"
          value={anyAttributeNamespace}
          onChange={(e) => setAnyAttributeNamespace(e.target.value)}
          onBlur={() => onChange({ id: node.id, xmlAnyAttributeNamespace: anyAttributeNamespace })}
          placeholder="##other"
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
        />
      </label>
      <div style={{ fontSize: 12, color: '#666' }}>
        Author sequence/choice/all via graph right-click. Edit min/max on the selected compositor node in RHS.
      </div>
      <XmlAttributesManager node={node} onChange={onChange} />
      <XmlAnnotationField nodeId={node.id} value={String(data.xmlAnnotation || '')} onChange={onChange} />
    </form>
  );
}

function XmlAttributeGroupEditor({ node, onChange }: XmlNodeRhsEditorProps) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  const [name, setName] = React.useState<string>(String(data.xmlName || ''));

  React.useEffect(() => {
    setName(String(data.xmlName || ''));
  }, [node?.id, data.xmlName]);

  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: 10 }} onSubmit={(e) => e.preventDefault()}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>AttributeGroup Editor</div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>Name</span>
        <input
          aria-label="AttributeGroup Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => onChange({ id: node.id, xmlName: name })}
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
        />
      </label>
      <div style={{ fontSize: 12, color: '#666' }}>
        Attributes added here are shared by every <code>xs:attributeGroup ref="{name || '...'}"</code> that references this group.
      </div>
      <XmlAttributesManager node={node} onChange={onChange} />
      <XmlAnnotationField nodeId={node.id} value={String(data.xmlAnnotation || '')} onChange={onChange} />
    </form>
  );
}

/**
 * Read-only display of enumeration values inherited from a named simpleType referenced via
 * `type="X"` (as opposed to an inline/anonymous simpleType owned by this node) — editing must
 * happen on that named simpleType's own node since the values are shared across every
 * attribute/element referencing it.
 */
function ReferencedEnumerationList({ values, typeName }: { values: string[]; typeName?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12 }}>
        Enumeration values {typeName ? <>(from <code>{typeName}</code>, read-only)</> : '(read-only)'}
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {values.map((value, index) => (
          <span
            key={index}
            aria-label={`Referenced enumeration value ${index + 1}`}
            style={{
              padding: '2px 8px',
              fontSize: 11,
              borderRadius: 3,
              border: '1px solid var(--color-neutral-6)',
              background: 'var(--color-neutral-3)',
              color: 'var(--color-neutral-12)',
            }}
          >
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Add/edit control for a restriction's single-value facets (`xs:pattern`,
 * `xs:minInclusive`/`xs:maxInclusive`, `xs:minLength`/`xs:maxLength`,
 * `xs:totalDigits`/`xs:fractionDigits`, `xs:whiteSpace`) — unlike `xs:enumeration` these
 * are each at most one occurrence, so a plain labeled text input per facet suffices.
 */
const SIMPLE_TYPE_FACET_FIELDS: Array<[keyof SimpleTypeFacets, string]> = [
  ['pattern', 'Pattern'],
  ['minInclusive', 'Min Inclusive'],
  ['maxInclusive', 'Max Inclusive'],
  ['minLength', 'Min Length'],
  ['maxLength', 'Max Length'],
  ['totalDigits', 'Total Digits'],
  ['fractionDigits', 'Fraction Digits'],
  ['whiteSpace', 'White Space'],
];

function FacetsEditor({
  facets,
  onChange,
  ariaPrefix,
}: {
  facets: SimpleTypeFacets | undefined;
  onChange: (next: SimpleTypeFacets) => void;
  ariaPrefix: string;
}) {
  const handleFieldChange = (key: keyof SimpleTypeFacets, value: string) => {
    const next = { ...(facets || {}) };
    if (value) next[key] = value;
    else delete next[key];
    onChange(next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 500 }}>Facets</span>
      {SIMPLE_TYPE_FACET_FIELDS.map(([key, label]) => (
        <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 11 }}>{label}</span>
          <input
            type="text"
            aria-label={`${ariaPrefix} ${label}`}
            value={facets?.[key] ?? ''}
            onChange={(e) => handleFieldChange(key, e.target.value)}
            style={{ padding: 4, borderRadius: 3, border: '1px solid #ddd', fontSize: 11 }}
          />
        </label>
      ))}
    </div>
  );
}

/**
 * Add/edit/remove/reorder control for a flat list of `xs:enumeration` values
 * (used by restriction-mode simpleTypes, inline or top-level).
 */
function EnumerationListEditor({
  values,
  onChange,
  ariaPrefix,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  ariaPrefix: string;
}) {
  const [newValue, setNewValue] = React.useState('');

  const handleAdd = () => {
    if (!newValue.trim()) return;
    onChange([...values, newValue]);
    setNewValue('');
  };
  const handleUpdate = (index: number, value: string) => {
    const next = [...values];
    next[index] = value;
    onChange(next);
  };
  const handleRemove = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };
  const handleMove = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= values.length) return;
    const next = [...values];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 500 }}>Enumeration values</span>
      {values.length === 0 && <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>No values yet.</div>}
      {values.map((value, index) => (
        <div key={index} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="text"
            aria-label={`${ariaPrefix} value ${index + 1}`}
            value={value}
            onChange={(e) => handleUpdate(index, e.target.value)}
            style={{ flex: 1, padding: 4, borderRadius: 3, border: '1px solid #ddd', fontSize: 11 }}
          />
          <button
            type="button"
            aria-label={`${ariaPrefix} move up ${index + 1}`}
            disabled={index === 0}
            onClick={() => handleMove(index, -1)}
            style={{ padding: '2px 6px', fontSize: 11, cursor: index === 0 ? 'not-allowed' : 'pointer' }}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={`${ariaPrefix} move down ${index + 1}`}
            disabled={index === values.length - 1}
            onClick={() => handleMove(index, 1)}
            style={{ padding: '2px 6px', fontSize: 11, cursor: index === values.length - 1 ? 'not-allowed' : 'pointer' }}
          >
            ↓
          </button>
          <button
            type="button"
            aria-label={`${ariaPrefix} remove ${index + 1}`}
            onClick={() => handleRemove(index)}
            style={{ padding: '2px 8px', fontSize: 11, backgroundColor: '#fee', color: '#c33', border: '1px solid #fcc', borderRadius: 3, cursor: 'pointer' }}
          >
            Remove
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          type="text"
          aria-label={`${ariaPrefix} new value`}
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="New enumeration value"
          style={{ flex: 1, padding: 4, borderRadius: 3, border: '1px solid #ddd', fontSize: 11 }}
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!newValue.trim()}
          style={{ padding: '2px 8px', fontSize: 11, backgroundColor: newValue.trim() ? '#e8f5e9' : '#f0f0f0', color: newValue.trim() ? '#2e7d32' : '#999', border: '1px solid #c8e6c9', borderRadius: 3, cursor: newValue.trim() ? 'pointer' : 'not-allowed' }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

/**
 * Recursive editor for an `xs:attribute`'s inline (anonymous) `xs:simpleType`.
 * Supports restriction (base + enumeration add/edit/remove/reorder), union (memberTypes
 * text plus any number of anonymous nested member simpleTypes), and list (itemType text
 * plus a single optional anonymous nested item simpleType) — each nested simpleType
 * recurses back into this same component, mirroring real XSD's arbitrary nesting.
 */
function InlineSimpleTypeEditor({
  value,
  onChange,
  depth = 0,
  pathLabel = 'SimpleType',
}: {
  value: InlineSimpleTypeData;
  onChange: (next: InlineSimpleTypeData) => void;
  depth?: number;
  pathLabel?: string;
}) {
  const mode = value.mode;

  const handleModeChange = (nextMode: 'restriction' | 'union' | 'list') => {
    if (nextMode === mode) return;
    if (nextMode === 'restriction') onChange({ mode: 'restriction', base: value.base || 'xs:string', enumerations: value.enumerations || [] });
    else if (nextMode === 'union') onChange({ mode: 'union', memberTypes: value.memberTypes || '', memberSimpleTypes: value.memberSimpleTypes || [] });
    else onChange({ mode: 'list', itemType: value.itemType || 'xs:string', itemSimpleType: value.itemSimpleType });
  };

  const handleAddMember = () => {
    const members = value.memberSimpleTypes || [];
    onChange({ ...value, memberSimpleTypes: [...members, { mode: 'restriction', base: 'xs:string', enumerations: [] }] });
  };
  const handleRemoveMember = (index: number) => {
    const members = value.memberSimpleTypes || [];
    onChange({ ...value, memberSimpleTypes: members.filter((_, i) => i !== index) });
  };
  const handleUpdateMember = (index: number, next: InlineSimpleTypeData) => {
    const members = [...(value.memberSimpleTypes || [])];
    members[index] = next;
    onChange({ ...value, memberSimpleTypes: members });
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 8,
        marginLeft: depth * 10,
        border: '1px solid var(--color-neutral-6)',
        borderRadius: 6,
        background: depth % 2 === 1 ? 'var(--color-neutral-3)' : 'var(--color-neutral-2)',
        color: 'var(--color-neutral-12)',
      }}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>{pathLabel} Mode</span>
        <select
          aria-label={`${pathLabel} Mode`}
          value={mode}
          onChange={(e) => handleModeChange(e.target.value as 'restriction' | 'union' | 'list')}
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
        >
          <option value="restriction">restriction</option>
          <option value="union">union</option>
          <option value="list">list</option>
        </select>
      </label>

      {mode === 'restriction' && (
        <>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12 }}>Base</span>
            <input
              aria-label={`${pathLabel} Restriction Base`}
              value={value.base || ''}
              onChange={(e) => onChange({ ...value, base: e.target.value })}
              style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
              placeholder="xs:string"
            />
          </label>
          <EnumerationListEditor
            values={value.enumerations || []}
            onChange={(next) => onChange({ ...value, enumerations: next })}
            ariaPrefix={`${pathLabel} enumeration`}
          />
          <FacetsEditor
            facets={value.facets}
            onChange={(next) => onChange({ ...value, facets: next })}
            ariaPrefix={`${pathLabel} facet`}
          />
        </>
      )}

      {mode === 'union' && (
        <>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12 }}>memberTypes (named types)</span>
            <input
              aria-label={`${pathLabel} Union Member Types`}
              value={value.memberTypes || ''}
              onChange={(e) => onChange({ ...value, memberTypes: e.target.value })}
              style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
              placeholder="xs:string tns:OtherType"
            />
          </label>
          {Array.isArray(value.unionReferencedEnumerations) && value.unionReferencedEnumerations.length > 0 && (
            <ReferencedEnumerationList values={value.unionReferencedEnumerations} />
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 500 }}>Anonymous member simpleTypes</span>
            {(value.memberSimpleTypes || []).map((member, index) => (
              <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    aria-label={`${pathLabel} remove member ${index + 1}`}
                    onClick={() => handleRemoveMember(index)}
                    style={{ padding: '2px 8px', fontSize: 11, backgroundColor: '#fee', color: '#c33', border: '1px solid #fcc', borderRadius: 3, cursor: 'pointer' }}
                  >
                    Remove member
                  </button>
                </div>
                <InlineSimpleTypeEditor
                  value={member}
                  onChange={(next) => handleUpdateMember(index, next)}
                  depth={depth + 1}
                  pathLabel={`${pathLabel} member ${index + 1}`}
                />
              </div>
            ))}
            <button
              type="button"
              onClick={handleAddMember}
              style={{ padding: '4px 8px', fontSize: 11, backgroundColor: '#e8f5e9', color: '#2e7d32', border: '1px solid #c8e6c9', borderRadius: 3, cursor: 'pointer', alignSelf: 'flex-start' }}
            >
              Add member simpleType
            </button>
          </div>
        </>
      )}

      {mode === 'list' && (
        <>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12 }}>itemType (named type)</span>
            <input
              aria-label={`${pathLabel} List Item Type`}
              value={value.itemType || ''}
              onChange={(e) => onChange({ ...value, itemType: e.target.value })}
              style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
              placeholder="xs:string"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              aria-label={`${pathLabel} has nested simpleType`}
              checked={Boolean(value.itemSimpleType)}
              onChange={(e) => {
                if (e.target.checked) onChange({ ...value, itemSimpleType: { mode: 'restriction', base: 'xs:string', enumerations: [] } });
                else onChange({ ...value, itemSimpleType: undefined });
              }}
            />
            <span style={{ fontSize: 12 }}>Anonymous item simpleType (instead of itemType)</span>
          </label>
          {value.itemSimpleType && (
            <InlineSimpleTypeEditor
              value={value.itemSimpleType}
              onChange={(next) => onChange({ ...value, itemSimpleType: next })}
              depth={depth + 1}
              pathLabel={`${pathLabel} item`}
            />
          )}
        </>
      )}
    </div>
  );
}

// Built-in XSD simple types, offered under the "Simple" group of `XmlTypeSelector`.
const XSD_BUILTIN_SIMPLE_TYPES = [
  'xs:anySimpleType', 'xs:anyType', 'xs:anyURI', 'xs:base64Binary', 'xs:boolean', 'xs:byte',
  'xs:date', 'xs:dateTime', 'xs:decimal', 'xs:double', 'xs:duration', 'xs:ENTITIES', 'xs:ENTITY',
  'xs:float', 'xs:gDay', 'xs:gMonth', 'xs:gMonthDay', 'xs:gYear', 'xs:gYearMonth', 'xs:hexBinary',
  'xs:ID', 'xs:IDREF', 'xs:IDREFS', 'xs:int', 'xs:integer', 'xs:language', 'xs:long', 'xs:Name',
  'xs:NCName', 'xs:negativeInteger', 'xs:NMTOKEN', 'xs:NMTOKENS', 'xs:nonNegativeInteger',
  'xs:nonPositiveInteger', 'xs:normalizedString', 'xs:NOTATION', 'xs:positiveInteger', 'xs:QName',
  'xs:short', 'xs:string', 'xs:time', 'xs:token', 'xs:unsignedByte', 'xs:unsignedInt',
  'xs:unsignedLong', 'xs:unsignedShort',
];

/**
 * "Type" dropdown for `xs:attribute`/`xs:element`, grouped into built-in "Simple" XSD types and
 * "My Types" (named simpleType/complexType definitions from this schema, via `xmlMyTypeNames`).
 * Falls back to a free-text input (via the "Custom…" option) for any value not in either group,
 * e.g. a namespace-prefixed type from an imported/included schema not represented locally.
 */
function XmlTypeSelector({
  value,
  onChange,
  myTypeNames,
  ariaLabel,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  myTypeNames: string[];
  ariaLabel: string;
  disabled?: boolean;
}) {
  const isKnownValue = (v: string) => v === '' || XSD_BUILTIN_SIMPLE_TYPES.includes(v) || myTypeNames.includes(v);
  const [isCustom, setIsCustom] = React.useState(!isKnownValue(value));
  const [customText, setCustomText] = React.useState(value);

  React.useEffect(() => {
    setIsCustom(!isKnownValue(value));
    setCustomText(value);
  }, [value, myTypeNames.join('\u0000')]);

  if (isCustom) {
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          aria-label={ariaLabel}
          value={customText}
          disabled={disabled}
          onChange={(e) => setCustomText(e.target.value)}
          onBlur={() => onChange(customText)}
          style={{ flex: 1, padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
          placeholder="xs:string"
        />
        <button
          type="button"
          aria-label={`${ariaLabel} use list`}
          disabled={disabled}
          onClick={() => setIsCustom(false)}
          style={{ padding: '4px 8px', fontSize: 11, cursor: disabled ? 'not-allowed' : 'pointer' }}
        >
          List
        </button>
      </div>
    );
  }

  return (
    <select
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(e) => {
        if (e.target.value === '__custom__') {
          setIsCustom(true);
          setCustomText('');
          return;
        }
        onChange(e.target.value);
      }}
      style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
    >
      <option value="">(none)</option>
      <optgroup label="Simple">
        {XSD_BUILTIN_SIMPLE_TYPES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </optgroup>
      {myTypeNames.length > 0 && (
        <optgroup label="My Types">
          {myTypeNames.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </optgroup>
      )}
      <option value="__custom__">Custom…</option>
    </select>
  );
}

/**
 * Editor for an `xs:union`'s space-separated `memberTypes` attribute, as a list of constrained
 * `XmlTypeSelector` dropdowns (one per member type) with per-row remove buttons and an "+ Add"
 * button, rather than a single freeform text input.
 */
function MemberTypesListEditor({
  value,
  onChange,
  myTypeNames,
  ariaPrefix,
}: {
  value: string;
  onChange: (next: string) => void;
  myTypeNames: string[];
  ariaPrefix: string;
}) {
  const members = value.trim() ? value.trim().split(/\s+/) : [];

  const emit = (next: string[]) => onChange(next.join(' '));

  const handleUpdate = (index: number, next: string) => {
    const updated = [...members];
    updated[index] = next;
    emit(updated);
  };
  const handleRemove = (index: number) => {
    emit(members.filter((_, i) => i !== index));
  };
  const handleAdd = () => {
    emit([...members, myTypeNames[0] || 'xs:string']);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 500 }}>memberTypes</span>
      {members.length === 0 && <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>No member types yet.</div>}
      {members.map((member, index) => (
        <div key={index} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <XmlTypeSelector
              value={member}
              onChange={(next) => handleUpdate(index, next)}
              myTypeNames={myTypeNames}
              ariaLabel={`${ariaPrefix} member ${index + 1}`}
            />
          </div>
          <button
            type="button"
            aria-label={`${ariaPrefix} remove member ${index + 1}`}
            onClick={() => handleRemove(index)}
            style={{ padding: '4px 8px', fontSize: 11, backgroundColor: '#fee', color: '#c33', border: '1px solid #fcc', borderRadius: 3, cursor: 'pointer' }}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        aria-label={`${ariaPrefix} add member`}
        onClick={handleAdd}
        style={{ padding: '4px 8px', fontSize: 11, backgroundColor: '#e8f5e9', color: '#2e7d32', border: '1px solid #c8e6c9', borderRadius: 3, cursor: 'pointer', alignSelf: 'flex-start' }}
      >
        + Add
      </button>
    </div>
  );
}

/**
 * RHS editor for an `xs:attribute`'s inline (anonymous) `xs:simpleType` child node. Thin wrapper
 * around the fully-recursive `InlineSimpleTypeEditor` (preserving nested union-member/list-item
 * editing), presented with the same "SimpleType Editor" title/framing as a named simpleType.
 * Has no Name/Ref fields since an anonymous simpleType has neither.
 */
function XmlAttributeSimpleTypeEditor({ node, onChange }: XmlNodeRhsEditorProps) {
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
      <XmlAnnotationField nodeId={node.id} value={String(data.xmlAnnotation || '')} onChange={onChange} />
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
  const [defaultValue, setDefaultValue] = React.useState<string>(String(data.xmlAttributeDefault ?? ''));
  // The default-value input is only shown once toggled on via the "+ default" badge (or if a
  // default already exists on load), keeping the common case (no default) visually compact.
  const [showDefault, setShowDefault] = React.useState<boolean>(data.xmlAttributeDefault !== undefined && data.xmlAttributeDefault !== '');
  // An inline (anonymous) `xs:simpleType` on this attribute is now its own child graph node —
  // select it there to edit; this flag just disables the Type field and shows a pointer to it.
  const hasInlineSimpleType = Boolean(data.xmlHasInlineSimpleType);
  // Attributes pulled in via `xs:attributeGroup ref="..."` belong to the shared group
  // definition, not this local type — edit them at the group's own node instead.
  const attributeGroupRef = data.xmlAttributeGroupRef as string | undefined;
  const readOnly = Boolean(attributeGroupRef);
  // When `type=` references a named simpleType that itself declares enumerations (e.g.
  // `type="typesType"`), show those values read-only here — they belong to the shared type
  // definition, not this attribute; edit them on the `typesType` simpleType node instead.
  const referencedEnumerations = Array.isArray(data.xmlAttributeReferencedEnumerations) ? data.xmlAttributeReferencedEnumerations as string[] : [];
  const referencedTypeName = data.xmlAttributeReferencedTypeName as string | undefined;

  React.useEffect(() => {
    setName(String(data.xmlName || ''));
    setType(String(data.xmlAttributeType || ''));
    setUseValue(String(data.xmlAttributeUse || 'optional'));
    setIsRef(Boolean(data.xmlIsRef));
    setDefaultValue(String(data.xmlAttributeDefault ?? ''));
    setShowDefault(data.xmlAttributeDefault !== undefined && data.xmlAttributeDefault !== '');
  }, [node?.id, data.xmlName, data.xmlAttributeType, data.xmlAttributeUse, data.xmlIsRef, data.xmlAttributeDefault]);

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
          Inherited from <code>xs:attributeGroup ref="{attributeGroupRef}"</code> — read-only here. Edit it on the <strong>{attributeGroupRef}</strong> attributeGroup node instead.
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
        {showDefault && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12 }}>Default</span>
            <input aria-label="Attribute Default Value" value={defaultValue} readOnly disabled style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc', background: '#f5f5f5' }} />
          </label>
        )}
        <XmlAnnotationField nodeId={node.id} value={String(data.xmlAnnotation || '')} onChange={onChange} />
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
          This attribute has an inline SimpleType — select its child node in the graph to edit it.
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
              ×
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
      <XmlAnnotationField nodeId={node.id} value={String(data.xmlAnnotation || '')} onChange={onChange} />
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
      <XmlAnnotationField nodeId={node.id} value={String(data.xmlAnnotation || '')} onChange={onChange} />
    </form>
  );
}

/**
 * Read-only display for an `xs:any` wildcard content particle (e.g. embedded (X)HTML
 * markup) — there's no name/type to edit, just the wildcard's own declared attributes.
 */
function XmlAnyEditor({ node }: { node: XmlNodeRhsEditorProps['node'] }) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>xs:any (wildcard content)</div>
      <div style={{ fontSize: 12, color: '#888', fontStyle: 'italic' }}>
        Matches any element from the given namespace; not individually editable.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>namespace</span>
        <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{String(data.xmlAnyNamespace ?? '##any')}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>processContents</span>
        <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{String(data.xmlAnyProcessContents ?? 'strict')}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>minOccurs / maxOccurs</span>
        <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{String(data.xmlMinOccurs ?? '1')} / {String(data.xmlMaxOccurs ?? '1')}</span>
      </div>
    </div>
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
  const [mixed, setMixed] = React.useState<boolean>(Boolean(data.xmlMixed));
  const [anyAttributeNamespace, setAnyAttributeNamespace] = React.useState<string>(String(data.xmlAnyAttribute?.namespace || ''));

  React.useEffect(() => {
    setName(String(data.xmlName || ''));
    setType(String(data.xmlElementType || ''));
    setMinOccurs(String(data.xmlMinOccurs ?? '1'));
    setMaxOccurs(String(data.xmlMaxOccurs ?? '1'));
    setIsRef(Boolean(data.xmlIsRef));
    setMixed(Boolean(data.xmlMixed));
    setAnyAttributeNamespace(String(data.xmlAnyAttribute?.namespace || ''));
  }, [node?.id, data.xmlName, data.xmlElementType, data.xmlMinOccurs, data.xmlMaxOccurs, data.xmlIsRef, data.xmlMixed, data.xmlAnyAttribute]);

  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: 10 }} onSubmit={(e) => e.preventDefault()}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>Element Editor</div>
      {!isRef && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12 }}>Name</span>
          <input
            aria-label="Element Name"
            value={name}
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
            onChange={(next) => {
              setName(next);
              // A `ref`-only element's display name lives on `@ref`, not `@type` — writing
              // `xmlName` here round-trips to the `ref` attribute (see `updateXmlNodeAtPath`).
              onChange({ id: node.id, xmlName: next });
            }}
            myTypeNames={Array.isArray(data.xmlMyElementNames) ? data.xmlMyElementNames : []}
            ariaLabel="Element Ref Target"
          />
        ) : data.xmlHasInlineComplexType ? (
          // No `type` attribute to show — the element's type is an inline `xs:complexType` defined
          // directly under it, so label it (using its `name` if it has one, else "Anon") instead of
          // showing blank/(none).
          <span aria-label="Element Type" style={{ padding: 6, fontStyle: 'italic', color: '#666' }}>complexType - {data.xmlInlineComplexTypeName || 'Anon'}</span>
        ) : (
          <XmlTypeSelector
            value={type}
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
      <label style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={mixed}
          onChange={(e) => {
            setMixed(e.target.checked);
            onChange({ id: node.id, xmlMixed: e.target.checked });
          }}
          aria-label="Mixed Content"
          style={{ cursor: 'pointer' }}
        />
        <span style={{ fontSize: 12 }}>Mixed Content</span>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>AnyAttribute namespace</span>
        <input
          aria-label="AnyAttribute Namespace"
          value={anyAttributeNamespace}
          onChange={(e) => setAnyAttributeNamespace(e.target.value)}
          onBlur={() => onChange({ id: node.id, xmlAnyAttributeNamespace: anyAttributeNamespace })}
          placeholder="##other"
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
        />
      </label>
      <XmlAnnotationField nodeId={node.id} value={String(data.xmlAnnotation || '')} onChange={onChange} />
    </form>
  );
}

/**
 * Configuration for editable xs:schema properties.
 * Easily extensible to add more properties like blockDefault, finalDefault, version, id, etc.
 */
const XML_SCHEMA_PROPERTY_CONFIGS: PropertyFieldConfig[] = [
  {
    label: 'targetNamespace',
    dataKey: 'xmlTargetNamespace',
    type: 'text',
    placeholder: 'http://example.com/schema',
    ariaLabel: 'Target Namespace',
  },
  {
    label: 'elementFormDefault',
    dataKey: 'xmlElementFormDefault',
    type: 'select',
    defaultValue: 'qualified',
    options: [
      { value: 'qualified', label: 'qualified' },
      { value: 'unqualified', label: 'unqualified' },
    ],
    ariaLabel: 'Element Form Default',
  },
  {
    label: 'attributeFormDefault',
    dataKey: 'xmlAttributeFormDefault',
    type: 'select',
    defaultValue: 'unqualified',
    options: [
      { value: 'qualified', label: 'qualified' },
      { value: 'unqualified', label: 'unqualified' },
    ],
    ariaLabel: 'Attribute Form Default',
  },
  {
    label: 'blockDefault',
    dataKey: 'xmlBlockDefault',
    type: 'text',
    placeholder: 'extension restriction substitution',
    ariaLabel: 'Block Default',
  },
  {
    label: 'finalDefault',
    dataKey: 'xmlFinalDefault',
    type: 'text',
    placeholder: 'extension restriction',
    ariaLabel: 'Final Default',
  },
  {
    label: 'version',
    dataKey: 'xmlVersion',
    type: 'text',
    placeholder: '1.0',
    ariaLabel: 'Schema Version',
  },
];

function XmlSchemaEditor({ node, onChange }: XmlNodeRhsEditorProps) {
  if (!node) return null;
  const data = (node.data || {}) as any;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PropertyForm
        title="Schema Editor"
        configs={XML_SCHEMA_PROPERTY_CONFIGS}
        nodeData={data}
        nodeId={node.id}
        onChange={onChange}
      />
      <XmlAnnotationField nodeId={node.id} value={String(data.xmlAnnotation || '')} onChange={onChange} />
    </div>
  );
}

export function XmlNodeRhsEditor({ node, onChange }: XmlNodeRhsEditorProps) {
  if (!node) return <div style={{ color: '#888', fontStyle: 'italic' }}>Select a node to edit XML properties.</div>;
  const data = (node.data || {}) as any;
  const kind = (data.xmlNodeKind || '') as XmlNodeKind;

  if (kind === 'schema') return <XmlSchemaEditor node={node} onChange={onChange} />;
  if (kind === 'simpleType' && data.xmlIsAnonymous) return <XmlAttributeSimpleTypeEditor node={node} onChange={onChange} />;
  if (kind === 'simpleType') return <XmlSimpleTypeEditor node={node} onChange={onChange} />;
  if (kind === 'complexType') return <XmlComplexTypeEditor node={node} onChange={onChange} />;
  if (kind === 'attributeGroup') return <XmlAttributeGroupEditor node={node} onChange={onChange} />;
  if (kind === 'attribute') return <XmlAttributeEditor node={node} onChange={onChange} />;
  if (kind === 'element') return <XmlElementEditor node={node} onChange={onChange} />;
  if (kind === 'sequence' || kind === 'choice' || kind === 'all') return <XmlCompositorEditor node={node} onChange={onChange} />;
  if (kind === 'any') return <XmlAnyEditor node={node} />;

  return <div style={{ color: '#888', fontStyle: 'italic' }}>Select a schema, SimpleType, ComplexType, attribute, element, or compositor node to edit.</div>;
}
