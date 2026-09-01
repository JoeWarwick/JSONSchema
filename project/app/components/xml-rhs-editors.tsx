import React from 'react';
import type { Node as FlowNode } from 'reactflow';
import type { NodeData, InlineSimpleTypeData, SimpleTypeFacets } from './types';
import { XSD_BUILTIN_SIMPLE_TYPES } from '~/utils/xsd-types';

type XmlNodeKind = 'schema' | 'simpleType' | 'complexType' | 'attributeGroup' | 'attribute' | 'element' | 'sequence' | 'choice' | 'all' | 'any';

/**
 * Props for XML node RHS editors and attribute manager.
 * - node: The selected ReactFlow node, or null if no node is selected
 * - onChange: Callback to emit partial node data updates (patches)
 * - getNodeByName: Optional function to look up a node by its name property
 */
export interface XmlNodeRhsEditorProps {
  node: FlowNode<NodeData> | null;
  onChange: (patch: Partial<NodeData>) => void;
  onToggleShowAnnotations?: (show: boolean) => void;
  xmlShowAnnotations?: boolean;
  onToggleShowImports?: (show: boolean) => void;
  xmlShowImports?: boolean;
  readOnlySource?: string;
  getNodeByName?: (name: string) => FlowNode<NodeData> | null;
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
function XmlReadOnlyHint({ source }: { source: string }) {
  return (
    <div style={{ background: '#fff7ed', border: '1px solid #f5c2b7', borderRadius: 6, padding: 10, color: '#92400e' }}>
      This node is a read-only expansion from <code>{source}</code>. Edit the original referenced definition instead.
    </div>
  );
}

function XmlAnnotationField({
  nodeId,
  value,
  onChange,
  disabled = false,
}: {
  nodeId: string;
  value: string;
  onChange: (patch: Partial<NodeData>) => void;
  disabled?: boolean;
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
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { if (text !== value) onChange({ id: nodeId, xmlAnnotation: text } as Partial<NodeData>); }}
        rows={3}
        style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc', fontFamily: 'inherit', resize: 'vertical', background: disabled ? '#f5f5f5' : undefined }}
        placeholder="Documentation for this schema item"
      />
    </label>
  );
}

/**
 * Multiple annotations field with non-invasive paging arrows.
 * Supports multiple xs:documentation elements within xs:annotation.
 */
function XmlAnnotationFieldWithPaging({
  nodeId,
  values,
  onChange,
  disabled = false,
}: {
  nodeId: string;
  values: string[];
  onChange: (patch: Partial<NodeData>) => void;
  disabled?: boolean;
}) {
  const [currentIndex, setCurrentIndex] = React.useState<number>(0);
  const [texts, setTexts] = React.useState<string[]>(values);

  React.useEffect(() => {
    setTexts(values);
    // Reset to first annotation if current index is out of bounds
    if (currentIndex >= values.length && values.length > 0) {
      setCurrentIndex(0);
    }
  }, [nodeId, values]);

  const currentText = texts[currentIndex] || '';
  const hasMultiple = texts.length > 1;

  const handleChange = (text: string) => {
    const newTexts = [...texts];
    newTexts[currentIndex] = text;
    setTexts(newTexts);
  };

  const handleBlur = () => {
    if (JSON.stringify(texts) !== JSON.stringify(values)) {
      onChange({ id: nodeId, xmlAnnotations: texts } as Partial<NodeData>);
    }
  };

  const goToPrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const goToNext = () => {
    if (currentIndex < texts.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12 }}>Annotation</span>
        {hasMultiple && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#666' }}>
            <button
              type="button"
              onClick={goToPrevious}
              disabled={currentIndex === 0 || disabled}
              style={{
                background: 'none',
                border: 'none',
                padding: '2px 4px',
                cursor: currentIndex === 0 || disabled ? 'default' : 'pointer',
                color: currentIndex === 0 || disabled ? '#ccc' : '#666',
                fontSize: 16,
                lineHeight: 1,
              }}
              aria-label="Previous annotation"
              title="Previous annotation"
            >
              ←
            </button>
            <span style={{ minWidth: '24px', textAlign: 'center' }}>
              {currentIndex + 1}/{texts.length}
            </span>
            <button
              type="button"
              onClick={goToNext}
              disabled={currentIndex === texts.length - 1 || disabled}
              style={{
                background: 'none',
                border: 'none',
                padding: '2px 4px',
                cursor: currentIndex === texts.length - 1 || disabled ? 'default' : 'pointer',
                color: currentIndex === texts.length - 1 || disabled ? '#ccc' : '#666',
                fontSize: 16,
                lineHeight: 1,
              }}
              aria-label="Next annotation"
              title="Next annotation"
            >
              →
            </button>
          </div>
        )}
      </div>
      <textarea
        aria-label="Annotation"
        value={currentText}
        disabled={disabled}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        rows={3}
        style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc', fontFamily: 'inherit', resize: 'vertical', background: disabled ? '#f5f5f5' : undefined }}
        placeholder="Documentation for this schema item"
      />
    </label>
  );
}

/**
 * Helper to render the appropriate annotation field - paging if multiple, single if one or none.
 */
function XmlAnnotationFieldAuto({
  nodeId,
  data,
  onChange,
  disabled = false,
}: {
  nodeId: string;
  data: Record<string, any>;
  onChange: (patch: Partial<NodeData>) => void;
  disabled?: boolean;
}) {
  const annotations = Array.isArray(data.xmlAnnotations) ? data.xmlAnnotations : 
    (data.xmlAnnotation ? [data.xmlAnnotation] : []);
  
  if (annotations.length > 1) {
    return <XmlAnnotationFieldWithPaging nodeId={nodeId} values={annotations} onChange={onChange} disabled={disabled} />;
  } else {
    return <XmlAnnotationField nodeId={nodeId} value={String(annotations[0] || '')} onChange={onChange} disabled={disabled} />;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function XmlSimpleTypeEditor({ node, onChange, readOnlySource, getNodeByName }: XmlNodeRhsEditorProps & { readOnlySource?: string }) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  const [name, setName] = React.useState<string>(String(data.xmlName || ''));
  const [mode, setMode] = React.useState<string>(String(data.xmlSimpleTypeMode || 'restriction'));
  const [base, setBase] = React.useState<string>(String(data.xmlBase || ''));
  const [memberTypes, setMemberTypes] = React.useState<string>(String(data.xmlMemberTypes || ''));
  const [itemType, setItemType] = React.useState<string>(String(data.xmlItemType || ''));
  const [enumerations, setEnumerations] = React.useState<string[]>(Array.isArray(data.xmlEnumerations) ? data.xmlEnumerations : []);
  const [listValues, setListValues] = React.useState<string[]>(Array.isArray(data.xmlListValues) ? data.xmlListValues : []);
  const readOnly = Boolean(readOnlySource);
  const [facets, setFacets] = React.useState<SimpleTypeFacets>(data.xmlFacets && typeof data.xmlFacets === 'object' ? data.xmlFacets : {});
  const [isRef, setIsRef] = React.useState<boolean>(Boolean(data.xmlIsRef));

  // Get the resolved node for itemType reference (if it points to a named type)
  const resolvedItemTypeNode = React.useMemo(() => {
    if (!itemType || itemType.startsWith('xs:') || !getNodeByName) {
      return null;
    }
    // Strip namespace prefix if present (e.g., "xsl:prefix-or-default" -> "prefix-or-default")
    const localName = itemType.includes(':') ? itemType.split(':')[1] : itemType;
    return getNodeByName(localName);
  }, [itemType, getNodeByName]);

  React.useEffect(() => {
    setName(String(data.xmlName || ''));
    setMode(String(data.xmlSimpleTypeMode || 'restriction'));
    setBase(String(data.xmlBase || ''));
    setMemberTypes(String(data.xmlMemberTypes || ''));
    setItemType(String(data.xmlItemType || ''));
    setEnumerations(Array.isArray(data.xmlEnumerations) ? data.xmlEnumerations : []);
    setListValues(Array.isArray(data.xmlListValues) ? data.xmlListValues : []);
    setFacets(data.xmlFacets && typeof data.xmlFacets === 'object' ? data.xmlFacets : {});
    setIsRef(Boolean(data.xmlIsRef));
  }, [node?.id, data.xmlName, data.xmlSimpleTypeMode, data.xmlBase, data.xmlMemberTypes, data.xmlItemType, data.xmlEnumerations, data.xmlListValues, data.xmlFacets, data.xmlIsRef]);

  const handleEnumerationsChange = (next: string[]) => {
    setEnumerations(next);
    onChange({ id: node.id, xmlEnumerations: next });
  };

  const handleListValuesChange = (next: string[]) => {
    setListValues(next);
    onChange({ id: node.id, xmlListValues: next });
  };

  const handleFacetsChange = (next: SimpleTypeFacets) => {
    setFacets(next);
    onChange({ id: node.id, xmlFacets: next });
  };

  // Handle nested simpleTypes in union mode
  const handleUpdateMemberSimpleTypes = (next: InlineSimpleTypeData[]) => {
    onChange({ id: node.id, xmlMemberSimpleTypes: next });
  };

  // Handle nested simpleType in list mode
  const handleUpdateItemSimpleType = (next: InlineSimpleTypeData | undefined) => {
    onChange({ id: node.id, xmlItemSimpleType: next });
  };

  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: 10 }} onSubmit={(e) => e.preventDefault()}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>SimpleType Editor</div>
      {readOnly && <XmlReadOnlyHint source={readOnlySource!} />}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>Name</span>
        <input
          aria-label="SimpleType Name"
          value={name}
          disabled={readOnly}
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
          disabled={readOnly}
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
              disabled={readOnly}
              onChange={(e) => setBase(e.target.value)}
              onBlur={() => onChange({ id: node.id, xmlBase: base })}
              style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
              placeholder="xs:string"
            />
          </label>
          {!readOnly ? (
            <>
              <EnumerationListEditor values={enumerations} onChange={handleEnumerationsChange} ariaPrefix="SimpleType enumeration" />
              <FacetsEditor facets={facets} onChange={handleFacetsChange} ariaPrefix="SimpleType facet" />
            </>
          ) : null}
        </>
      )}

      {mode === 'union' && (
        <>
          {!readOnly ? (
            <MemberTypesListEditor
              value={memberTypes}
              onChange={(next) => {
                setMemberTypes(next);
                onChange({ id: node.id, xmlMemberTypes: next });
              }}
              myTypeNames={Array.isArray(data.xmlMyTypeNames) ? data.xmlMyTypeNames : []}
              ariaPrefix="Union Member Types"
            />
          ) : (
            <div style={{ fontSize: 11, color: '#666' }}>Union member types are read-only in this ref expansion.</div>
          )}
          {Array.isArray(data.xmlUnionReferencedEnumerations) && data.xmlUnionReferencedEnumerations.length > 0 && (
            <ReferencedEnumerationList values={data.xmlUnionReferencedEnumerations} />
          )}
          {/* Nested anonymous member simpleTypes */}
          {Array.isArray(data.xmlMemberSimpleTypes) && data.xmlMemberSimpleTypes.length > 0 && !readOnly && (
            <NamedSimpleTypeNestedMembersEditor
              memberSimpleTypes={data.xmlMemberSimpleTypes}
              onChange={handleUpdateMemberSimpleTypes}
            />
          )}
        </>
      )}

      {mode === 'list' && (
        <>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12 }}>itemType</span>
            <input
              aria-label="List Item Type"
              value={itemType}
              disabled={readOnly || Boolean(data.xmlItemSimpleType)}
              onChange={(e) => setItemType(e.target.value)}
              onBlur={() => onChange({ id: node.id, xmlItemType: itemType })}
              style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
              placeholder="xs:string"
            />
          </label>
          {/* Show list values editor only if no nested simpleType and itemType is xs: built-in or missing */}
          {!readOnly && !data.xmlItemSimpleType && (!itemType || itemType.startsWith('xs:')) && (
            <ListValuesEditor values={listValues} onChange={handleListValuesChange} ariaPrefix="SimpleType list" />
          )}
          {/* Display resolved nested types from named itemType reference as interactive editor */}
          {resolvedItemTypeNode && !readOnly && !data.xmlItemSimpleType && resolvedItemTypeNode.data?.xmlSimpleTypeMode && (
            <div style={{ background: 'var(--form-surface, #f9f5f0)', border: '1px solid var(--form-border, #e5d4c4)', borderRadius: 6, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--form-text, #5d4a3a)' }}>Referenced type: {itemType}</div>
              <InlineSimpleTypeEditor
                value={{
                  mode: resolvedItemTypeNode.data.xmlSimpleTypeMode,
                  base: resolvedItemTypeNode.data.xmlSimpleTypeBase,
                  enumerations: resolvedItemTypeNode.data.xmlEnumerationValues,
                  memberSimpleTypes: resolvedItemTypeNode.data.xmlMemberSimpleTypes,
                  itemSimpleType: resolvedItemTypeNode.data.xmlItemSimpleType,
                }}
                onChange={() => {}} // Read-only: no changes to referenced type
                depth={0}
                pathLabel="Referenced type structure"
              />
            </div>
          )}
          {/* Toggle for nested anonymous item simpleType */}
          {!readOnly && (
            <label style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                aria-label="SimpleType has nested itemType"
                checked={Boolean(data.xmlItemSimpleType)}
                onChange={(e) => {
                  if (e.target.checked) handleUpdateItemSimpleType({ mode: 'restriction', base: 'xs:string', enumerations: [] });
                  else handleUpdateItemSimpleType(undefined);
                }}
              />
              <span style={{ fontSize: 12 }}>Anonymous item simpleType (instead of itemType)</span>
            </label>
          )}
          {/* Nested recursive simpleType editor for union/restriction/list */}
          {data.xmlItemSimpleType && !readOnly && (
            <InlineSimpleTypeEditor
              value={data.xmlItemSimpleType}
              onChange={handleUpdateItemSimpleType}
              depth={0}
              pathLabel="SimpleType item"
            />
          )}
        </>
      )}
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
      <XmlAnnotationFieldAuto nodeId={node.id} data={data} onChange={onChange} />
    </form>
  );
}

/**
 * Editor for nested anonymous member simpleTypes in a named union simpleType.
 * Allows adding, removing, and editing multiple nested simpleType members.
 */
function NamedSimpleTypeNestedMembersEditor({
  memberSimpleTypes,
  onChange,
}: {
  memberSimpleTypes: InlineSimpleTypeData[];
  onChange: (next: InlineSimpleTypeData[]) => void;
}) {
  const handleAddMember = () => {
    onChange([...memberSimpleTypes, { mode: 'restriction', base: 'xs:string', enumerations: [] }]);
  };

  const handleRemoveMember = (index: number) => {
    onChange(memberSimpleTypes.filter((_, i) => i !== index));
  };

  const handleUpdateMember = (index: number, next: InlineSimpleTypeData) => {
    const updated = [...memberSimpleTypes];
    updated[index] = next;
    onChange(updated);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 500 }}>Anonymous member simpleTypes</span>
      {memberSimpleTypes.map((member, index) => (
        <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              aria-label={`SimpleType remove member ${index + 1}`}
              onClick={() => handleRemoveMember(index)}
              style={{ padding: '2px 8px', fontSize: 11, backgroundColor: '#fee', color: '#c33', border: '1px solid #fcc', borderRadius: 3, cursor: 'pointer' }}
            >
              Remove member
            </button>
          </div>
          <InlineSimpleTypeEditor
            value={member}
            onChange={(next) => handleUpdateMember(index, next)}
            depth={0}
            pathLabel={`SimpleType member ${index + 1}`}
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
  );
}

/**
 * XmlAttributesManager - A reusable control for managing attributes on XML schema elements.
 * Supports add, edit, and remove operations on attributes for simpleType, complexType, or any schema node.
 * Inherited attributes (from base types) are shown as read-only.
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
  const availableTypes = (data.xmlAvailableTypes || []) as string[];
  const typeOptions = React.useMemo(() => {
    const merged = [...XSD_BUILTIN_SIMPLE_TYPES, ...availableTypes];
    return Array.from(new Set(merged.filter(Boolean)));
  }, [availableTypes]);
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
    // Calculate the actual index in the non-inherited array (for XML operations)
    const nonInheritedIndex = attributes.slice(0, index).filter((a: any) => !a.inherited).length;
    onChange({ id: node.id, xmlRemoveAttributeIndex: nonInheritedIndex });
  };

  const handleUpdateAttribute = (index: number, field: string, value: string) => {
    if (!node) return;
    // Calculate the actual index in the non-inherited array (for XML operations)
    const nonInheritedIndex = attributes.slice(0, index).filter((a: any) => !a.inherited).length;
    const updated = { ...attributes[index], [field]: value };
    onChange({ id: node.id, xmlUpdateAttributeIndex: { index: nonInheritedIndex, ...updated } });
  };

  const fieldStyle = { padding: 3, borderRadius: 3, border: '1px solid var(--graph-node-border)', background: 'var(--graph-node-bg)', color: 'var(--graph-node-text)', fontSize: 11 };
  const inheritedFieldStyle = { ...fieldStyle, background: 'var(--graph-node-bg-subtle)', opacity: 0.7, cursor: 'not-allowed' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0', borderTop: '1px solid var(--graph-sidebar-border)', marginTop: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--graph-text)' }}>Attributes</div>
      
      {/* List existing attributes */}
      {attributes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {attributes.map((attr: any, index: number) => {
            const isInherited = attr.inherited === true;
            return (
              <div key={index} style={{ display: 'flex', gap: 4, fontSize: 11, padding: 4, backgroundColor: isInherited ? 'var(--graph-node-bg-subtle)' : 'var(--graph-node-bg-subtle)', borderRadius: 4, opacity: isInherited ? 0.75 : 1, position: 'relative' }}>
                {isInherited && (
                  <div style={{ position: 'absolute', top: 2, right: 2, fontSize: 9, color: 'var(--graph-muted)', fontWeight: 500, padding: '2px 4px', backgroundColor: 'var(--graph-node-border)', borderRadius: 2 }}>
                    inherited
                  </div>
                )}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, paddingRight: isInherited ? 50 : 0 }}>
                  <input
                    type="text"
                    value={attr.name || ''}
                    onChange={(e) => !isInherited && handleUpdateAttribute(index, 'name', e.target.value)}
                    placeholder="name"
                    disabled={isInherited}
                    style={isInherited ? inheritedFieldStyle : fieldStyle}
                  />
                  <select
                    value={attr.type || ''}
                    onChange={(e) => !isInherited && handleUpdateAttribute(index, 'type', e.target.value)}
                    disabled={isInherited}
                    style={isInherited ? inheritedFieldStyle : fieldStyle}
                  >
                    <option value={attr.type || ''}>{attr.type || 'Select type...'}</option>
                    {typeOptions.filter((t) => t !== attr.type).map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <select
                    value={attr.use || 'optional'}
                    onChange={(e) => !isInherited && handleUpdateAttribute(index, 'use', e.target.value)}
                    disabled={isInherited}
                    style={isInherited ? inheritedFieldStyle : fieldStyle}
                  >
                    <option value="optional">optional</option>
                    <option value="required">required</option>
                    <option value="prohibited">prohibited</option>
                  </select>
                </div>
                {!isInherited && (
                  <button
                    type="button"
                    onClick={() => handleRemoveAttribute(index)}
                    style={{ padding: '4px 8px', fontSize: 11, backgroundColor: 'var(--color-error-4)', color: 'var(--color-error-11)', border: '1px solid var(--color-error-7)', borderRadius: 3, cursor: 'pointer' }}
                  >
                    Remove
                  </button>
                )}
              </div>
            );
          })}
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
          <select
            value={newAttrType}
            onChange={(e) => setNewAttrType(e.target.value)}
            style={fieldStyle}
          >
            <option value="">Select type...</option>
            {typeOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function XmlComplexTypeEditor({ node, onChange, readOnlySource, getNodeByName }: XmlNodeRhsEditorProps & { readOnlySource?: string }) {
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
      {!readOnly ? <XmlAttributesManager node={node} onChange={onChange} /> : null}
      <XmlAnnotationFieldAuto nodeId={node.id} data={data} onChange={onChange} />
    </form>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function XmlAttributeGroupEditor({ node, onChange, readOnlySource, getNodeByName }: XmlNodeRhsEditorProps & { readOnlySource?: string }) {
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
      {!readOnly ? <XmlAttributesManager node={node} onChange={onChange} /> : null}
      <XmlAnnotationFieldAuto nodeId={node.id} data={data} onChange={onChange} />
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
  const [expandedFacets, setExpandedFacets] = React.useState<Set<keyof SimpleTypeFacets>>(
    new Set(Object.keys(facets || {}) as Array<keyof SimpleTypeFacets>)
  );

  React.useEffect(() => {
    // Update expanded facets when facets prop changes
    setExpandedFacets(new Set(Object.keys(facets || {}) as Array<keyof SimpleTypeFacets>));
  }, [facets]);

  const handleFieldChange = (key: keyof SimpleTypeFacets, value: string) => {
    const next = { ...(facets || {}) };
    if (value) next[key] = value;
    else delete next[key];
    onChange(next);
  };

  const toggleFacet = (key: keyof SimpleTypeFacets) => {
    const newExpanded = new Set(expandedFacets);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedFacets(newExpanded);
  };

  const deleteFacet = (key: keyof SimpleTypeFacets) => {
    handleFieldChange(key, '');
    const newExpanded = new Set(expandedFacets);
    newExpanded.delete(key);
    setExpandedFacets(newExpanded);
  };

  const definedFacets = Object.keys(facets || {}) as Array<keyof SimpleTypeFacets>;
  const undefinedFacets = SIMPLE_TYPE_FACET_FIELDS.filter(([key]) => !definedFacets.includes(key) && !expandedFacets.has(key)).map(([key]) => key);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 500 }}>Facets</span>

      {/* Expanded/Defined Facets */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {SIMPLE_TYPE_FACET_FIELDS.map(([key, label]) => {
          const isDefined = key in (facets || {});
          const isExpanded = expandedFacets.has(key);

          if (!isDefined && !isExpanded) return null;

          return (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 11, minWidth: 80 }}>{label}</span>
              </div>
              <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                <input
                  type="text"
                  aria-label={`${ariaPrefix} ${label}`}
                  value={facets?.[key] ?? ''}
                  onChange={(e) => handleFieldChange(key, e.target.value)}
                  placeholder={isDefined ? undefined : 'Enter value...'}
                  style={{ 
                    padding: 4, 
                    borderRadius: 3, 
                    border: '1px solid #ddd', 
                    fontSize: 11,
                    flex: 1,
                  }}
                />
                {isDefined && (
                  <button
                    type="button"
                    onClick={() => deleteFacet(key)}
                    title="Delete facet"
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
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Undefined Facets as Badges */}
      {undefinedFacets.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {undefinedFacets.map((key) => {
            const label = SIMPLE_TYPE_FACET_FIELDS.find(([k]) => k === key)?.[1] || '';
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleFacet(key)}
                title={`Add ${label} facet`}
                style={{
                  padding: '3px 8px',
                  borderRadius: 12,
                  border: '1px solid #ddd',
                  backgroundColor: '#f9f9f9',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 500,
                  color: '#666',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  whiteSpace: 'nowrap',
                }}
              >
                <span>+</span>
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      )}
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
 * Add/edit/remove/reorder control for a list of space-separated list item values
 * (used by list-mode simpleTypes, inline or top-level).
 */
function ListValuesEditor({
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
      <span style={{ fontSize: 12, fontWeight: 500 }}>List values</span>
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
          placeholder="New list value"
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function XmlAttributeSimpleTypeEditor({ node, onChange, getNodeByName }: XmlNodeRhsEditorProps) {
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function XmlAttributeEditor({ node, onChange, readOnlySource, getNodeByName }: XmlNodeRhsEditorProps) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  const [name, setName] = React.useState<string>(String(data.xmlName || ''));
  const [type, setType] = React.useState<string>(String(data.xmlAttributeType || ''));
  const [widget, setWidget] = React.useState<string>(String(data.xmlWidget || ''));
  const [useValue, setUseValue] = React.useState<string>(String(data.xmlAttributeUse || 'optional'));
  const [isRef, setIsRef] = React.useState<boolean>(Boolean(data.xmlIsRef));
  const [defaultValue, setDefaultValue] = React.useState<string>(String(data.xmlAttributeDefault ?? ''));
  // Attributes pulled in via `xs:attributeGroup ref="..."` belong to the shared group
  // definition, not this local type — edit them at the group's own node instead.
  const attributeGroupRef = data.xmlAttributeGroupRef as string | undefined;
  const readOnly = Boolean(attributeGroupRef || readOnlySource);
  // The default-value input is only shown once toggled on via the "+ default" badge (or if a
  // default already exists on load), keeping the common case (no default) visually compact.
  const [showDefault, setShowDefault] = React.useState<boolean>(data.xmlAttributeDefault !== undefined && data.xmlAttributeDefault !== '');
  // An inline (anonymous) `xs:simpleType` on this attribute is now its own child graph node —
  // select it there to edit; this flag just disables the Type field and shows a pointer to it.
  const hasInlineSimpleType = Boolean(data.xmlHasInlineSimpleType);
  // When `type=` references a named simpleType that itself declares enumerations (e.g.
  // `type="typesType"`), show those values read-only here — they belong to the shared type
  // definition, not this attribute; edit them on the `typesType` simpleType node instead.
  const referencedEnumerations = Array.isArray(data.xmlAttributeReferencedEnumerations) ? data.xmlAttributeReferencedEnumerations as string[] : [];
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
    // Use JSON stringification to detect when node data is recreated/updated
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
      <XmlAnnotationFieldAuto nodeId={node.id} data={data} onChange={onChange} />
    </form>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function XmlCompositorEditor({ node, onChange, readOnlySource, getNodeByName }: XmlNodeRhsEditorProps) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  const [minOccurs, setMinOccurs] = React.useState<string>(String(data.xmlMinOccurs ?? '1'));
  const [maxOccurs, setMaxOccurs] = React.useState<string>(String(data.xmlMaxOccurs ?? '1'));
  const readOnly = Boolean(readOnlySource);

  React.useEffect(() => {
    setMinOccurs(String(data.xmlMinOccurs ?? '1'));
    setMaxOccurs(String(data.xmlMaxOccurs ?? '1'));
  }, [node?.id, data.xmlMinOccurs, data.xmlMaxOccurs]);

  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: 10 }} onSubmit={(e) => e.preventDefault()}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>{String(data.xmlNodeKind || 'Compositor')} Editor</div>
      {readOnly && <XmlReadOnlyHint source={readOnlySource!} />}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>minOccurs</span>
        <input
          aria-label="minOccurs"
          value={minOccurs}
          disabled={readOnly}
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
          disabled={readOnly}
          onChange={(e) => setMaxOccurs(e.target.value)}
          onBlur={() => onChange({ id: node.id, xmlMaxOccurs: maxOccurs })}
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
          placeholder="1 or unbounded"
        />
      </label>
      <XmlAnnotationFieldAuto nodeId={node.id} data={data} onChange={onChange} disabled={readOnly} />
    </form>
  );
}

/**
 * Read-only display for an `xs:any` wildcard content particle (e.g. embedded (X)HTML
 * markup) — there's no name/type to edit, just the wildcard's own declared attributes.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function XmlAnyEditor({ node, getNodeByName }: XmlNodeRhsEditorProps) {
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function XmlElementEditor({ node, onChange, readOnlySource, getNodeByName }: XmlNodeRhsEditorProps & { readOnlySource?: string }) {
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
          // A ref's target is fixed once set — editable only via the "Global Reference" toggle flow, not here.
          <XmlTypeSelector
            value={name}
            disabled
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
          {!readOnly ? <XmlAttributesManager node={node} onChange={onChange} /> : null}
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

/**
 * Configuration for editable xs:schema properties.
 * Easily extensible to add more properties like blockDefault, finalDefault, version, id, etc.
 */
const XML_SCHEMA_PROPERTY_CONFIGS: PropertyFieldConfig[] = [];


/**
 * Editor for all schema root node attributes:
 * - regular fields: targetNamespace, elementFormDefault, attributeFormDefault
 * - toggle badges: blockDefault, finalDefault, version, xml:lang, xmlns:xsi, xsi:schemaLocation
 * - list editor: custom xmlns:* namespace declarations
 */
function SpecialAttributesEditor({
  node,
  onChange,
}: {
  node: FlowNode<NodeData>;
  onChange: (patch: Partial<NodeData>) => void;
}) {
  const data = (node.data || {}) as any;
  const coreAttrs: Array<{ key: string; display: string; kind: 'text' | 'select'; placeholder?: string; options?: string[] }> = [
    { key: 'xmlTargetNamespace', display: 'targetNamespace', kind: 'text', placeholder: 'http://example.com/schema' },
    { key: 'xmlElementFormDefault', display: 'elementFormDefault', kind: 'select', options: ['qualified', 'unqualified'] },
    { key: 'xmlAttributeFormDefault', display: 'attributeFormDefault', kind: 'select', options: ['qualified', 'unqualified'] },
  ];
  const [expandedAttrs, setExpandedAttrs] = React.useState<Set<string>>(
    new Set(
      [
        ...(data.xmlTargetNamespace ? ['targetNamespace'] : []),
        ...(data.xmlElementFormDefault ? ['elementFormDefault'] : []),
        ...(data.xmlAttributeFormDefault ? ['attributeFormDefault'] : []),
        ...(data.xmlBlockDefault ? ['blockDefault'] : []),
        ...(data.xmlFinalDefault ? ['finalDefault'] : []),
        ...(data.xmlVersion ? ['version'] : []),
        ...(data.xmlLang ? ['xml:lang'] : []),
        ...(data.xmlnsXsi ? ['xmlns:xsi'] : []),
        ...(data.xsiSchemaLocation ? ['xsi:schemaLocation'] : []),
      ]
    )
  );

  // Toggle badge attributes (optional, shown as badges when undefined)
  const toggleAttrs: Array<[string, string, string]> = [
    ['xmlBlockDefault', 'blockDefault', 'extension restriction substitution'],
    ['xmlFinalDefault', 'finalDefault', 'extension restriction'],
    ['xmlVersion', 'version', '1.0'],
    ['xmlLang', 'xml:lang', 'en'],
    ['xmlnsXsi', 'xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance'],
    ['xsiSchemaLocation', 'xsi:schemaLocation', 'http://example.com/schema schema.xsd'],
  ];

  const handleAttrChange = (key: string, value: string) => {
    const patch: Record<string, any> = {};
    patch[key] = value || undefined;
    onChange({ id: node.id, ...patch });
  };

  const toggleAttr = (key: string) => {
    const newExpanded = new Set(expandedAttrs);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedAttrs(newExpanded);
  };

  const deleteAttr = (displayName: string) => {
    const coreKey = coreAttrs.find((a) => a.display === displayName)?.key;
    const toggleKey = toggleAttrs.find(([, display]) => display === displayName)?.[0];
    const dataKey = coreKey || toggleKey;
    if (dataKey) {
      handleAttrChange(dataKey, '');
      const newExpanded = new Set(expandedAttrs);
      newExpanded.delete(displayName);
      setExpandedAttrs(newExpanded);
    }
  };

  const undefinedCoreAttrs = coreAttrs
    .filter((a) => !data[a.key] && !expandedAttrs.has(a.display))
    .map((a) => ({ key: a.key, display: a.display }));
  const undefinedToggleAttrs = toggleAttrs
    .filter(([key, display]) => !data[key] && !expandedAttrs.has(display))
    .map(([key, display]) => ({ key, display }));
  const undefinedAttrs = [...undefinedCoreAttrs, ...undefinedToggleAttrs];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 500 }}>Attributes</span>

      {/* Core Schema Attributes */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {coreAttrs.map((attr) => {
          const isDefined = !!data[attr.key];
          const isExpanded = expandedAttrs.has(attr.display);
          if (!isDefined && !isExpanded) return null;

          return (
            <div key={attr.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <label style={{ fontSize: 11, fontWeight: 500 }}>{attr.display}</label>
              <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                {attr.kind === 'select' ? (
                  <select
                    aria-label={`Schema attribute ${attr.display}`}
                    value={data[attr.key] ?? ''}
                    onChange={(e) => handleAttrChange(attr.key, e.target.value)}
                    style={{
                      padding: 4,
                      borderRadius: 3,
                      border: '1px solid #ddd',
                      fontSize: 11,
                      flex: 1,
                    }}
                  >
                    <option value="">(none)</option>
                    {(attr.options || []).map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    aria-label={`Schema attribute ${attr.display}`}
                    value={data[attr.key] ?? ''}
                    onChange={(e) => handleAttrChange(attr.key, e.target.value)}
                    placeholder={attr.placeholder}
                    style={{
                      padding: 4,
                      borderRadius: 3,
                      border: '1px solid #ddd',
                      fontSize: 11,
                      flex: 1,
                    }}
                  />
                )}
                <button
                  type="button"
                  onClick={() => deleteAttr(attr.display)}
                  title="Delete attribute"
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
              </div>
            </div>
          );
        })}
      </div>

      {/* Toggle Badge Attributes */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {toggleAttrs.map(([key, display, placeholder]) => {
          const isDefined = !!data[key];
          const isExpanded = expandedAttrs.has(display);

          if (!isDefined && !isExpanded) return null;

          return (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 11, minWidth: 120 }}>{display}</span>
              </div>
              <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                <input
                  type="text"
                  aria-label={`Schema attribute ${display}`}
                  value={data[key] ?? ''}
                  onChange={(e) => handleAttrChange(key, e.target.value)}
                  placeholder={placeholder}
                  style={{
                    padding: 4,
                    borderRadius: 3,
                    border: '1px solid #ddd',
                    fontSize: 11,
                    flex: 1,
                  }}
                />
                <button
                  type="button"
                  onClick={() => deleteAttr(display)}
                  title="Delete attribute"
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
              </div>
            </div>
          );
        })}
      </div>

      {/* Undefined Toggle Attributes as Badges */}
      {undefinedAttrs.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {undefinedAttrs.map(({ display }) => (
            <button
              key={display}
              type="button"
              onClick={() => toggleAttr(display)}
              title={`Add ${display} attribute`}
              style={{
                padding: '3px 8px',
                borderRadius: 12,
                border: '1px solid #ddd',
                backgroundColor: '#f9f9f9',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 500,
                color: '#666',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                whiteSpace: 'nowrap',
              }}
            >
              <span>+</span>
              <span>{display}</span>
            </button>
          ))}
        </div>
      )}

      {/* Custom Namespaces List Editor */}
      <NamespacesListEditor node={node} onChange={onChange} />
    </div>
  );
}

/**
 * Editor for custom xmlns:* namespace declarations.
 */
function NamespacesListEditor({
  node,
  onChange,
}: {
  node: FlowNode<NodeData>;
  onChange: (patch: Partial<NodeData>) => void;
}) {
  const data = (node.data || {}) as any;
  const namespaces = (data.xmlnsNamespaces as Array<{ prefix: string; uri: string }>) || [];
  const [newPrefix, setNewPrefix] = React.useState('');
  const [newUri, setNewUri] = React.useState('');

  const handleAdd = () => {
    if (!newPrefix.trim() || !newUri.trim()) return;
    const updated = [...namespaces, { prefix: newPrefix, uri: newUri }];
    onChange({ id: node.id, xmlnsNamespaces: updated });
    setNewPrefix('');
    setNewUri('');
  };

  const handleUpdate = (index: number, field: 'prefix' | 'uri', value: string) => {
    const updated = namespaces.map((ns, i) =>
      i === index ? { ...ns, [field]: value } : ns
    );
    onChange({ id: node.id, xmlnsNamespaces: updated });
  };

  const handleRemove = (index: number) => {
    onChange({ id: node.id, xmlnsNamespaces: namespaces.filter((_, i) => i !== index) });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 500 }}>Custom Namespaces (xmlns:*)</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {namespaces.map((ns, index) => (
          <div key={index} style={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
            <input
              type="text"
              placeholder="prefix"
              value={ns.prefix}
              onChange={(e) => handleUpdate(index, 'prefix', e.target.value)}
              style={{
                padding: 4,
                borderRadius: 3,
                border: '1px solid #ddd',
                fontSize: 11,
                minWidth: 80,
              }}
            />
            <input
              type="text"
              placeholder="URI"
              value={ns.uri}
              onChange={(e) => handleUpdate(index, 'uri', e.target.value)}
              style={{
                padding: 4,
                borderRadius: 3,
                border: '1px solid #ddd',
                fontSize: 11,
                flex: 1,
              }}
            />
            <button
              type="button"
              onClick={() => handleRemove(index)}
              title="Remove namespace"
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
          </div>
        ))}
      </div>
      {/* Add New Namespace */}
      <div style={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        <input
          type="text"
          placeholder="prefix"
          value={newPrefix}
          onChange={(e) => setNewPrefix(e.target.value)}
          style={{
            padding: 4,
            borderRadius: 3,
            border: '1px solid #ddd',
            fontSize: 11,
            minWidth: 80,
          }}
        />
        <input
          type="text"
          placeholder="URI"
          value={newUri}
          onChange={(e) => setNewUri(e.target.value)}
          style={{
            padding: 4,
            borderRadius: 3,
            border: '1px solid #ddd',
            fontSize: 11,
            flex: 1,
          }}
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!newPrefix.trim() || !newUri.trim()}
          title="Add namespace"
          style={{
            padding: '2px 6px',
            borderRadius: 3,
            border: '1px solid #ccc',
            backgroundColor: !newPrefix.trim() || !newUri.trim() ? '#f0f0f0' : '#f9f9f9',
            cursor: !newPrefix.trim() || !newUri.trim() ? 'not-allowed' : 'pointer',
            fontSize: 12,
            fontWeight: 500,
            color: !newPrefix.trim() || !newUri.trim() ? '#aaa' : '#666',
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}

/**
 * Editor for xs:import elements (namespace and schemaLocation pairs).
 */
function ImportsListEditor({
  node,
  onChange,
}: {
  node: FlowNode<NodeData>;
  onChange: (patch: Partial<NodeData>) => void;
}) {
  const data = (node.data || {}) as any;
  const imports = (data.xmlImports as Array<{ namespace: string; schemaLocation: string }>) || [];
  const [newNamespace, setNewNamespace] = React.useState('');
  const [newSchemaLocation, setNewSchemaLocation] = React.useState('');

  const handleAdd = () => {
    if (!newNamespace.trim() || !newSchemaLocation.trim()) return;
    const updated = [...imports, { namespace: newNamespace, schemaLocation: newSchemaLocation }];
    onChange({ id: node.id, xmlImports: updated });
    setNewNamespace('');
    setNewSchemaLocation('');
  };

  const handleUpdate = (index: number, field: 'namespace' | 'schemaLocation', value: string) => {
    const updated = imports.map((imp, i) =>
      i === index ? { ...imp, [field]: value } : imp
    );
    onChange({ id: node.id, xmlImports: updated });
  };

  const handleRemove = (index: number) => {
    onChange({ id: node.id, xmlImports: imports.filter((_, i) => i !== index) });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 500 }}>xs:import Declarations</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {imports.map((imp, index) => (
          <div key={index} style={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
            <input
              type="text"
              placeholder="namespace"
              value={imp.namespace}
              onChange={(e) => handleUpdate(index, 'namespace', e.target.value)}
              style={{
                padding: 4,
                borderRadius: 3,
                border: '1px solid #ddd',
                fontSize: 11,
                minWidth: 100,
              }}
            />
            <input
              type="text"
              placeholder="schemaLocation"
              value={imp.schemaLocation}
              onChange={(e) => handleUpdate(index, 'schemaLocation', e.target.value)}
              style={{
                padding: 4,
                borderRadius: 3,
                border: '1px solid #ddd',
                fontSize: 11,
                flex: 1,
              }}
            />
            <button
              type="button"
              onClick={() => handleRemove(index)}
              title="Remove import"
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
          </div>
        ))}
      </div>
      {/* Add New Import */}
      <div style={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        <input
          type="text"
          placeholder="namespace"
          value={newNamespace}
          onChange={(e) => setNewNamespace(e.target.value)}
          style={{
            padding: 4,
            borderRadius: 3,
            border: '1px solid #ddd',
            fontSize: 11,
            minWidth: 100,
          }}
        />
        <input
          type="text"
          placeholder="schemaLocation"
          value={newSchemaLocation}
          onChange={(e) => setNewSchemaLocation(e.target.value)}
          style={{
            padding: 4,
            borderRadius: 3,
            border: '1px solid #ddd',
            fontSize: 11,
            flex: 1,
          }}
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!newNamespace.trim() || !newSchemaLocation.trim()}
          title="Add import"
          style={{
            padding: '2px 6px',
            borderRadius: 3,
            border: '1px solid #ccc',
            backgroundColor: !newNamespace.trim() || !newSchemaLocation.trim() ? '#f0f0f0' : '#f9f9f9',
            cursor: !newNamespace.trim() || !newSchemaLocation.trim() ? 'not-allowed' : 'pointer',
            fontSize: 12,
            fontWeight: 500,
            color: !newNamespace.trim() || !newSchemaLocation.trim() ? '#aaa' : '#666',
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function XmlSchemaEditor({ node, onChange, onToggleShowAnnotations, xmlShowAnnotations, onToggleShowImports, xmlShowImports, getNodeByName }: XmlNodeRhsEditorProps) {
  if (!node) return null;
  const data = (node.data || {}) as any;

  const handleToggleShowAnnotations = (show: boolean) => {
    if (onToggleShowAnnotations) {
      onToggleShowAnnotations(show);
    }
  };

  const handleToggleShowImports = (show: boolean) => {
    if (onToggleShowImports) {
      onToggleShowImports(show);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PropertyForm
        title="Schema Editor"
        configs={XML_SCHEMA_PROPERTY_CONFIGS}
        nodeData={data}
        nodeId={node.id}
        onChange={onChange}
      />
      <SpecialAttributesEditor node={node} onChange={onChange} />
      
      {onToggleShowAnnotations ? (
        <div style={{ padding: '8px 12px', border: '1px solid var(--graph-node-border)', borderRadius: 4, backgroundColor: 'var(--graph-node-bg-subtle)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--graph-node-text)' }}>
            <input
              type="checkbox"
              checked={xmlShowAnnotations === true}
              onChange={(e) => handleToggleShowAnnotations(e.currentTarget.checked)}
              style={{ cursor: 'pointer' }}
            />
            <span>Show Annotations</span>
          </label>
          {xmlShowAnnotations === true && (
            <div style={{ fontSize: 11, color: 'var(--graph-muted)', marginTop: 6 }}>
              Annotation entries follow document order.
            </div>
          )}
        </div>
      ) : null}

      {/* xs:import Editor */}
      <ImportsListEditor node={node} onChange={onChange} />

      {onToggleShowImports ? (
        <div style={{ padding: '8px 12px', border: '1px solid var(--graph-node-border)', borderRadius: 4, backgroundColor: 'var(--graph-node-bg-subtle)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--graph-node-text)' }}>
            <input
              type="checkbox"
              checked={xmlShowImports === true}
              onChange={(e) => handleToggleShowImports(e.currentTarget.checked)}
              style={{ cursor: 'pointer' }}
            />
            <span>Show Imports</span>
          </label>
          {xmlShowImports === true && (
            <div style={{ fontSize: 11, color: 'var(--graph-muted)', marginTop: 6 }}>
              Import entries follow document order.
            </div>
          )}
        </div>
      ) : null}

      <XmlAnnotationFieldAuto nodeId={node.id} data={data} onChange={onChange} />
    </div>
  );
}

export function XmlNodeRhsEditor({ node, onChange, onToggleShowAnnotations, xmlShowAnnotations, onToggleShowImports, xmlShowImports, getNodeByName }: XmlNodeRhsEditorProps) {
  if (!node) return <div style={{ color: '#888', fontStyle: 'italic' }}>Select a node to edit XML properties.</div>;
  const data = (node.data || {}) as any;
  const kind = (data.xmlNodeKind || '') as XmlNodeKind;
  const readOnlySource = typeof data.xmlReadOnlySource === 'string' && data.xmlReadOnlySource ? data.xmlReadOnlySource : undefined;

  if (kind === 'schema') return <XmlSchemaEditor node={node} onChange={onChange} onToggleShowAnnotations={onToggleShowAnnotations} xmlShowAnnotations={xmlShowAnnotations} onToggleShowImports={onToggleShowImports} xmlShowImports={xmlShowImports} readOnlySource={readOnlySource} getNodeByName={getNodeByName} />;
  if (kind === 'simpleType' && data.xmlIsAnonymous) return <XmlAttributeSimpleTypeEditor node={node} onChange={onChange} readOnlySource={readOnlySource} getNodeByName={getNodeByName} />;
  if (kind === 'simpleType') return <XmlSimpleTypeEditor node={node} onChange={onChange} readOnlySource={readOnlySource} getNodeByName={getNodeByName} />;
  if (kind === 'complexType') return <XmlComplexTypeEditor node={node} onChange={onChange} readOnlySource={readOnlySource} getNodeByName={getNodeByName} />;
  if (kind === 'attributeGroup') return <XmlAttributeGroupEditor node={node} onChange={onChange} readOnlySource={readOnlySource} getNodeByName={getNodeByName} />;
  if (kind === 'attribute') return <XmlAttributeEditor node={node} onChange={onChange} readOnlySource={readOnlySource} getNodeByName={getNodeByName} />;
  if (kind === 'element') return <XmlElementEditor node={node} onChange={onChange} readOnlySource={readOnlySource} getNodeByName={getNodeByName} />;
  if (kind === 'sequence' || kind === 'choice' || kind === 'all') return <XmlCompositorEditor node={node} onChange={onChange} readOnlySource={readOnlySource} getNodeByName={getNodeByName} />;
  if (kind === 'any') return <XmlAnyEditor node={node} onChange={onChange} getNodeByName={getNodeByName} />;

  return <div style={{ color: '#888', fontStyle: 'italic' }}>Select a schema, SimpleType, ComplexType, attribute, element, or compositor node to edit.</div>;
}
