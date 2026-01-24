// Enum node component for displaying enum type (no inline editor)
const EnumNode = ({ data }: { data: SchemaNodeData & { enum: string[] } }) => {
  const { label, type, ofType, enum: enumVals } = data;
  // Determine the base type for enum (string, number, etc.)
  const baseType = ofType || type || 'string';
  return (
    <div style={{
      background: '#fffbe6',
      border: '2px solid #ffe082',
      borderRadius: 8,
      padding: '10px 18px',
      marginBottom: 12,
      minWidth: 120,
      boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
      textAlign: 'left',
      position: 'relative',
    }}>
      <Handle type="target" position={Position.Left} style={{ background: '#00e676', width: 10, height: 10, borderRadius: 5 }} />
      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4, color: '#222' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{
          display: 'inline-block',
          background: '#f5f5f5',
          borderRadius: 8,
          padding: '2px 8px',
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: '0.03em',
          border: '1px solid #e0e0e0',
          marginRight: 4,
          marginBottom: 2,
        }}>
          <span style={{ color: '#2b6cb0', fontWeight: 700 }}>enum</span>
          <span style={{ color: '#888' }}>&lt;</span>
          <span style={{ color: '#43a047', fontWeight: 700 }}>{baseType}</span>
          <span style={{ color: '#888' }}>&gt;</span>
        </span>
      </div>
      {/* Enum values list removed for cleaner node UI */}
      <Handle type="source" position={Position.Right} style={{ background: '#00e676', width: 10, height: 10, borderRadius: 5 }} />
    </div>
  );
};
import React, { useState } from "react";
import { validateValueAgainstSchema } from "../utils/validation";
import { ContextMenu } from "./ContextMenu";
import {
  addPropertyToSchema,
  addPatternPropertyToSchema,
  removePropertyFromSchema,
  updateNestedPropertyInSchema,
  schemaNodeDataToSchema
} from "./schema-behaviors";
import { Handle, Position } from "reactflow";
import ReactFlow, {
  ReactFlowProvider,
  addEdge,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
} from "reactflow";
import type { Connection, Edge, Node, OnConnect } from "reactflow"
import type { SchemaNodeData } from "./schema-behaviors";
// Editable property form for selected node
import type { Node as FlowNode } from 'reactflow';
type NodeData = Record<string, any>;
interface NodePropertyEditorProps {
  node: FlowNode<NodeData> | null;
  onChange: (patch: Partial<NodeData>) => void;
}
export const NodePropertyEditor: React.FC<NodePropertyEditorProps> = ({ node, onChange }) => {
  if (!node) return <div style={{ color: '#888', fontStyle: 'italic' }}>Select a node to edit its properties.</div>;
  const { data } = node;
  const [label, setLabel] = React.useState<string>(data.label || '');
  const formRef = React.useRef<HTMLFormElement | null>(null);
  const nameInputRef = React.useRef<HTMLInputElement>(null);
  const [type, setType] = React.useState<string>(data.type || '');
  const [ofType, setOfType] = React.useState<string>(data.ofType || '');
  // patternKey is used for `patternProperties` nodes to store the actual regex key
  const [patternKeyState, setPatternKeyState] = React.useState<string | undefined>((data as any).patternKey);
  const [patternKeyError, setPatternKeyError] = React.useState<string | null>(null);
  const typeSelectRef = React.useRef<HTMLSelectElement | null>(null);
  const jsonTypes = [
    { value: 'object', label: 'object' },
    { value: 'array', label: 'array' },
    { value: 'string', label: 'string' },
    { value: 'number', label: 'number' },
    { value: 'boolean', label: 'boolean' },
    { value: 'null', label: 'null' },
    { value: 'image', label: 'image' },
  ];
  // Root node is always required
  const isRoot = node.id === '1';
  const [required, setRequired] = React.useState<boolean>(isRoot ? true : !!data.required);
  const enumValues: string[] = Array.isArray(data.enum) ? data.enum : [];
  const isEnum: boolean = Array.isArray(data.enum);
  const [defaultValue, setDefaultValue] = React.useState<string>(data.default ?? '');
  const [defaultError, setDefaultError] = React.useState<string | null>(null);
  const [pattern, setPattern] = React.useState<string | undefined>(data.pattern);
  const [format, setFormat] = React.useState<string | undefined>(data.format);
  const [contentMediaType, setContentMediaType] = React.useState<string | undefined>(data.contentMediaType);
  const [description, setDescription] = React.useState<string | undefined>(data.description);
  const [minimum, setMinimum] = React.useState<number | undefined>(data.minimum);
  const [maximum, setMaximum] = React.useState<number | undefined>(data.maximum);
  const [examples, setExamples] = React.useState<string | undefined>(Array.isArray(data.examples) ? (data.examples as any[]).join(', ') : undefined);
  const [minLength, setMinLength] = React.useState<number | undefined>(data.minLength);
  const [maxLength, setMaxLength] = React.useState<number | undefined>(data.maxLength);
  const [multipleOf, setMultipleOf] = React.useState<number | undefined>(data.multipleOf);
  const [uniqueItems, setUniqueItems] = React.useState<boolean | undefined>(data.uniqueItems);
  const [minItems, setMinItems] = React.useState<number | undefined>(data.minItems);
  const [maxItems, setMaxItems] = React.useState<number | undefined>(data.maxItems);
  const [readOnlyFlag, setReadOnlyFlag] = React.useState<boolean | undefined>(data.readOnly);
  const [deprecatedFlag, setDeprecatedFlag] = React.useState<boolean | undefined>(data.deprecated);
  // validation errors
  const [minMaxLengthError, setMinMaxLengthError] = React.useState<string | null>(null);
  const [minMaxItemsError, setMinMaxItemsError] = React.useState<string | null>(null);
  const [multipleOfError, setMultipleOfError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setLabel(data.label || '');
    setType(data.type || '');
    setOfType(data.ofType || '');
    setRequired(!!data.required);
    setDefaultValue(data.default ?? '');
    setPattern(data.pattern);
    setFormat(data.format);
    setDescription(data.description);
    setMinimum(data.minimum);
    setMaximum(data.maximum);
    setExamples(Array.isArray(data.examples) ? (data.examples as any[]).join(', ') : undefined);
    setMinLength(data.minLength);
    setMaxLength(data.maxLength);
    setMultipleOf(data.multipleOf);
    setUniqueItems(data.uniqueItems);
    setMinItems(data.minItems);
    setMaxItems(data.maxItems);
    setReadOnlyFlag(data.readOnly);
    setDeprecatedFlag(data.deprecated);
    setContentMediaType(data.contentMediaType);
    setMinMaxLengthError(null);
    setMinMaxItemsError(null);
    setMultipleOfError(null);
    // Focus name input if this is a new property node
    if (data.label && /^newProperty\d+$/.test(data.label)) {
      setTimeout(() => {
        if (nameInputRef.current) {
          nameInputRef.current.focus();
          nameInputRef.current.select();
        }
      }, 0);
    }
  }, [node?.id]);

  // Helper to build patch for onChange
  const buildPatch = (override?: Partial<NodeData>) => {
    let patch: Partial<NodeData> = { id: node.id, label, type, required, ...override };
    const prevType = data.type;
    const newType = override?.type || type;
    // If type is being changed from object to array, hoist the object into items
    if (newType === 'array' && prevType === 'object') {
      patch = { type: 'array', ofType: 'object', items: { type: 'object', ...data }, ...override };
    }
    // If type is being changed from array to object, unhoist the items into the object
    else if (newType === 'object' && prevType === 'array' && data.items) {
      const items = data.items as Record<string, unknown>;
      patch = { ...items, type: 'object', ...override };
    }
    // If type is being changed from string with enum to array, move enum to items
    else if (newType === 'array' && (prevType === 'string' || !prevType)) {
      let items: Record<string, unknown> = { type: 'string' };
      if (data.enum) {
        items.enum = data.enum;
      }
      const { enum: _removed, ...rest } = data;
      patch = { ...rest, type: 'array', ofType: 'string', items, ...override };
    } else if (newType === 'array' && !data.items) {
      patch = { ...data, type: 'array', ofType: override?.ofType || ofType || 'string', items: { type: override?.ofType || ofType || 'string' }, ...override };
    } else {
      if (newType === 'array') {
        patch.ofType = override?.ofType || ofType;
        // --- ENUM PATCH LOGIC FOR ARRAYS ---
        if (override && Object.prototype.hasOwnProperty.call(override, 'enum')) {
          if (Array.isArray(override.enum)) {
            patch.items = { ...(patch.items || { type: ofType || 'string' }), enum: [...override.enum] };
          } else if (patch.items) {
            delete patch.items.enum;
          }
        } else if ((override?.isEnum ?? isEnum) && Array.isArray(override?.enumValues ?? enumValues)) {
          patch.items = { ...(patch.items || { type: ofType || 'string' }), enum: override?.enumValues ?? enumValues };
        } else if (patch.items) {
          delete patch.items.enum;
        }
        // --- END ENUM PATCH LOGIC FOR ARRAYS ---
      } else {
        patch.ofType = undefined;
        // --- ENUM PATCH LOGIC FOR NON-ARRAYS ---
        if (override && Object.prototype.hasOwnProperty.call(override, 'enum')) {
          if (Array.isArray(override.enum)) {
            patch.enum = [...override.enum]; // allow empty array
          } else {
            delete patch.enum;
          }
        } else if ((override?.isEnum ?? isEnum) && Array.isArray(override?.enumValues ?? enumValues)) {
          patch.enum = override?.enumValues ?? enumValues;
        } else {
          delete patch.enum;
        }
        // --- END ENUM PATCH LOGIC FOR NON-ARRAYS ---
      }
      if ((override?.defaultValue ?? defaultValue) !== undefined && (override?.defaultValue ?? defaultValue) !== '') patch.default = override?.defaultValue ?? defaultValue;
      else patch.default = undefined;
    }
    return patch;
  };

  // Extend buildPatch: include optional annotation fields
  const buildPatchWithAnnotations = (override?: Partial<NodeData>) => {
    const base = buildPatch(override);
    // pattern/format/description
    if (override && Object.prototype.hasOwnProperty.call(override, 'pattern')) base.pattern = override.pattern;
    else base.pattern = override?.pattern ?? pattern;
    if (override && Object.prototype.hasOwnProperty.call(override, 'format')) base.format = override.format;
    else base.format = override?.format ?? format;
    if (override && Object.prototype.hasOwnProperty.call(override, 'description')) base.description = override.description;
    else base.description = override?.description ?? description;
    if (override && Object.prototype.hasOwnProperty.call(override, 'minimum')) base.minimum = override.minimum;
    else base.minimum = override?.minimum ?? minimum;
    if (override && Object.prototype.hasOwnProperty.call(override, 'maximum')) base.maximum = override.maximum;
    else base.maximum = override?.maximum ?? maximum;
    // examples: accept comma-separated string
    if (override && Object.prototype.hasOwnProperty.call(override, 'examples')) base.examples = override.examples;
    else if (examples !== undefined) base.examples = examples ? examples.split(',').map(s => s.trim()).filter(Boolean) : undefined;
    // contentMediaType (for images/media)
    if (override && Object.prototype.hasOwnProperty.call(override, 'contentMediaType')) base.contentMediaType = override.contentMediaType;
    else base.contentMediaType = override?.contentMediaType ?? contentMediaType;
    // length constraints
    if (override && Object.prototype.hasOwnProperty.call(override, 'minLength')) base.minLength = override.minLength;
    else base.minLength = override?.minLength ?? minLength;
    if (override && Object.prototype.hasOwnProperty.call(override, 'maxLength')) base.maxLength = override.maxLength;
    else base.maxLength = override?.maxLength ?? maxLength;
    // numeric constraints
    if (override && Object.prototype.hasOwnProperty.call(override, 'multipleOf')) base.multipleOf = override.multipleOf;
    else base.multipleOf = override?.multipleOf ?? multipleOf;
    // array constraints
    if (override && Object.prototype.hasOwnProperty.call(override, 'uniqueItems')) base.uniqueItems = override.uniqueItems;
    else base.uniqueItems = override?.uniqueItems ?? uniqueItems;
    if (override && Object.prototype.hasOwnProperty.call(override, 'minItems')) base.minItems = override.minItems;
    else base.minItems = override?.minItems ?? minItems;
    if (override && Object.prototype.hasOwnProperty.call(override, 'maxItems')) base.maxItems = override.maxItems;
    else base.maxItems = override?.maxItems ?? maxItems;
    // metadata flags
    if (override && Object.prototype.hasOwnProperty.call(override, 'readOnly')) base.readOnly = override.readOnly;
    else base.readOnly = override?.readOnly ?? readOnlyFlag;
    if (override && Object.prototype.hasOwnProperty.call(override, 'deprecated')) base.deprecated = override.deprecated;
    else base.deprecated = override?.deprecated ?? deprecatedFlag;
    // If this node is the internal image type, ensure we include sensible defaults
    if (base.type === 'image') {
      if (!base.format) base.format = base.format ?? 'data-url';
      if (!base.contentMediaType) base.contentMediaType = base.contentMediaType ?? 'image/*';
    }
    return base;
  };

  // Enum editor UI
  const [enumInput, setEnumInput] = React.useState<string>('');
  const enumInputRef = React.useRef<HTMLInputElement>(null);
  const handleAddEnum = () => {
    if (enumInput.trim() && !enumValues.includes(enumInput.trim())) {
      const newEnum = [...enumValues, enumInput.trim()];
      setEnumInput('');
      // Always include isEnum: true to keep the editor visible
      onChange(buildPatchWithAnnotations({ enum: newEnum, isEnum: true }));
      // Refocus input after add
      setTimeout(() => {
        enumInputRef.current?.focus();
      }, 0);
    }
  };
  const handleRemoveEnum = (v: string) => {
    // Always create a new array reference
    const newEnum = enumValues.filter((val: string) => val !== v);
    // Always include isEnum: true to keep the editor visible
    onChange(buildPatchWithAnnotations({ enum: [...newEnum], isEnum: true }));
  };

  // Handlers for user-driven changes
  const handleLabelBlur = () => {
    if (label !== data.label) {
      // Delay the emit one tick to allow focus to move to the next field
      // (prevents the editor form from unmounting mid-tab).
      setTimeout(() => {
        onChange(buildPatchWithAnnotations());
        // After emitting the rename, move focus to the Type select to avoid
        // the UI flashing a temporarily-empty selection when tabbing.
        setTimeout(() => {
          typeSelectRef.current?.focus();
        }, 0);
      }, 0);
    }
  };
  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setType(e.target.value);
    onChange(buildPatchWithAnnotations({ type: e.target.value }));
  };
  const handleOfTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setOfType(e.target.value);
    onChange(buildPatchWithAnnotations({ ofType: e.target.value }));
  };
  const handleRequiredChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRequired(e.target.checked);
    onChange(buildPatchWithAnnotations({ required: e.target.checked }));
  };
  const handleIsEnumChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      // Always set enum to a new empty array to guarantee re-render and enum node creation
      onChange(buildPatchWithAnnotations({ isEnum: true, enum: [] }));
    } else {
      onChange(buildPatchWithAnnotations({ isEnum: false, enum: undefined }));
    }
  };
  const handleDefaultValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDefaultValue(e.target.value);
    // don't emit immediately; validate on blur
  };
  const handleDefaultValueBlur = () => {
    const raw = defaultValue;
    let parsed: any = raw;
    if (type === 'number') parsed = raw === '' ? '' : Number(raw);
    if (type === 'boolean') parsed = raw === 'true' ? true : raw === 'false' ? false : raw;
    const schemaForValidation: Record<string, unknown> = {};
    if (type) schemaForValidation.type = type;
    if (format) schemaForValidation.format = format;
    if (isEnum && Array.isArray(enumValues)) schemaForValidation.enum = enumValues;
    const err = validateValueAgainstSchema(parsed, schemaForValidation);
    if (err) {
      setDefaultError(err);
    } else {
      setDefaultError(null);
      onChange(buildPatchWithAnnotations({ defaultValue: parsed }));
    }
  };

  return (
    <form ref={formRef} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }} onSubmit={e => e.preventDefault()}>
      <div>
        <input
          ref={nameInputRef}
          value={label}
          onChange={e => setLabel(e.target.value)}
          onBlur={handleLabelBlur}
          style={{ width: '100%', marginTop: 2, padding: 4, borderRadius: 4, border: '1px solid #ccc' }}
          readOnly={isRoot}
          placeholder="Name"
          aria-label="Name"
        />
      </div>
      { (data as any).patternKey && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 8 }}>Pattern Key</div>
          <input
            value={patternKeyState ?? ''}
            onChange={e => {
              const v = e.target.value;
              setPatternKeyState(v);
              // Validate as a JS RegExp. If valid, emit patternKey and label; if invalid, only update label so UI reflects editing
              try {
                // eslint-disable-next-line no-new
                new RegExp(v);
                setPatternKeyError(null);
                onChange(buildPatchWithAnnotations({ patternKey: v, label: `pattern: ${v}` }));
              } catch (err) {
                setPatternKeyError('Invalid regular expression');
                // still update the label so users see what they are typing, but do not set patternKey until valid
                onChange(buildPatchWithAnnotations({ label: `pattern: ${v}` }));
              }
            }}
            onBlur={() => {
              // Nothing else to do - onChange handles emission when valid
            }}
            style={{ width: '100%', marginTop: 6, padding: 4, borderRadius: 4, border: patternKeyError ? '1px solid #b71c1c' : '1px solid #ccc' }}
            placeholder="Regex for matching property names"
            aria-label="Pattern Key"
          />
          {patternKeyError && <div className={styles.patternKeyError}>{patternKeyError}</div>}
        </div>
      )}
      <div>
        <select ref={typeSelectRef} value={type} onChange={handleTypeChange} style={{ width: '100%', marginTop: 2, padding: 4, borderRadius: 4, border: '1px solid #ccc' }} aria-label="Type">
          <option value="">Select type</option>
          {jsonTypes.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>
      {type === 'array' && (
        <div>
          <select value={ofType} onChange={handleOfTypeChange} style={{ width: '100%', marginTop: 2, padding: 4, borderRadius: 4, border: '1px solid #ccc' }} aria-label="Of Type">
            <option value="">Select type</option>
            {jsonTypes.filter(t => t.value !== 'array').map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      )}
      {node.data.hasOwnProperty('required') && !isRoot && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={required} onChange={handleRequiredChange} aria-label="Required" /> Required
        </label>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={isEnum} onChange={handleIsEnumChange} data-testid="enum-checkbox" aria-label="Enum" /> Enum
      </label>
      {isEnum && (
        <div>
          <div data-testid="enum-values-label" style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Enum Values</div>
          <ul style={{ padding: 0, margin: '4px 0 8px 0', listStyle: 'none' }}>
            {enumValues.length === 0 ? (
              <li style={{ color: '#888', fontStyle: 'italic', fontSize: 13 }}>No enum values yet.</li>
            ) : (
              enumValues.map((v: string, i: number) => (
                <li key={i} style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                  <span style={{ background: '#fffde7', border: '1px solid #ffe082', borderRadius: 6, padding: '2px 8px', fontSize: 13, marginRight: 6 }}>{v}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveEnum(v)}
                    data-testid={`remove-enum-${v}`}
                    className={styles.removeControl}
                  >
                    ×
                  </button>
                </li>
              ))
            )}
          </ul>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              id="enum-input"
              ref={enumInputRef}
              value={enumInput}
              onChange={e => setEnumInput(e.target.value)}
              style={{ flex: 1, borderRadius: 6, border: '1px solid #ffe082', padding: '2px 8px', fontSize: 13 }}
              placeholder="Add value and press Enter"
              data-testid="enum-input"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  handleAddEnum();
                  e.preventDefault();
                }
              }}
            />
            <button type="button" onClick={handleAddEnum}
              style={{ background: '#ffe082', border: 'none', borderRadius: 6, padding: '2px 10px', fontWeight: 600, cursor: 'pointer' }} data-testid="add-enum-button">+</button>
          </div>
        </div>
      )}
      <div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={defaultValue} onChange={handleDefaultValueChange} onBlur={handleDefaultValueBlur} style={{ flex: 1, marginTop: 2, padding: 4, borderRadius: 4, border: '1px solid #ccc' }} placeholder="Default value" aria-label="Default value" />
          {defaultValue !== '' && (
            <button type="button" onClick={() => { setDefaultValue(''); onChange(buildPatchWithAnnotations({ defaultValue: '' })); }} className={styles.removeControl} title="Remove default">×</button>
          )}
        </div>
        {defaultError && <div style={{ color: '#e53935', fontSize: 12, marginTop: 6 }}>{defaultError}</div>}
      </div>
      {/* Image preview only (no upload) for schema editor; instance form handles uploads */}
      {((format === 'data-url') || (contentMediaType && String(contentMediaType).startsWith('image')) || type === 'image') && defaultValue && typeof defaultValue === 'string' && /^data:image\//i.test(defaultValue) && (
        <div style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <img src={defaultValue} alt="preview" style={{ maxWidth: 240, maxHeight: 160, border: '1px solid #ddd', borderRadius: 6 }} />
          </div>
        </div>
      )}
      {!(type === 'boolean' || type === 'object' || type === 'null') && (
        <div style={{ borderTop: '1px dashed #eee', paddingTop: 10 }}>
        {type !== 'array' && !isEnum && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            {pattern === undefined ? (
              <button type="button" onClick={() => { setPattern(''); onChange(buildPatchWithAnnotations({ pattern: '' })); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6 }}>+ Pattern</button>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input className={styles.smallInput} value={pattern ?? ''} onChange={e => setPattern(e.target.value)} onBlur={() => onChange(buildPatchWithAnnotations({ pattern }))} placeholder="RegExp pattern" aria-label="Pattern" />
                <button type="button" onClick={() => { setPattern(undefined); onChange(buildPatchWithAnnotations({ pattern: undefined })); }} className={styles.removeControl} title="Remove pattern">×</button>
              </div>
            )}
            {format === undefined ? (
              <button type="button" onClick={() => { setFormat(''); onChange(buildPatchWithAnnotations({ format: '' })); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6 }}>+ Format</button>
            ) : (
              <div style={{ width: 150, display: 'flex', alignItems: 'center', gap: 8 }}>
                <select value={format ?? ''} onChange={e => { setFormat(e.target.value || undefined); onChange(buildPatchWithAnnotations({ format: e.target.value || undefined })); }} style={{ flex: 1, marginTop: 2, padding: 6, borderRadius: 4, border: '1px solid #ccc' }}>
                  <option value="" disabled>-format-</option>
                  <option value="date-time">date-time</option>
                  <option value="date">date</option>
                  <option value="time">time</option>
                  <option value="email">email</option>
                  <option value="uri">uri</option>
                  <option value="ipv4">ipv4</option>
                  <option value="ipv6">ipv6</option>
                  <option value="uuid">uuid</option>
                  <option value="hostname">hostname</option>
                  <option value="regex">regex</option>
                  <option value="password">password</option>
                  <option value="byte">byte</option>
                  <option value="binary">binary</option>
                </select>
                <button type="button" onClick={() => { setFormat(undefined); onChange(buildPatchWithAnnotations({ format: undefined })); }} className={styles.removeControl} title="Remove format">×</button>
              </div>
            )}
          </div>
        )}
        {type === 'number' && !isEnum && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {minimum === undefined ? (
              <button type="button" onClick={() => { setMinimum(0); onChange(buildPatchWithAnnotations({ minimum: 0 })); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6 }}>+ Minimum</button>
            ) : (
              <label style={{ width: 120, display: 'flex', alignItems: 'center', gap: 8 }}>Min
                <input className={styles.numberInput} type="number" value={minimum as any} onWheel={(e) => { e.preventDefault(); const dir = e.deltaY > 0 ? -1 : 1; const mult = e.shiftKey ? 10 : 1; const cur = typeof minimum === 'number' ? (minimum as number) : 0; const newVal = cur + dir * 1 * mult; setMinimum(newVal); onChange(buildPatchWithAnnotations({ minimum: newVal })); }} onChange={e => setMinimum(e.target.value === '' ? undefined : Number(e.target.value))} onBlur={() => onChange(buildPatchWithAnnotations({ minimum }))} />
                <button type="button" onClick={() => { setMinimum(undefined); onChange(buildPatchWithAnnotations({ minimum: undefined })); }} className={styles.removeControl} title="Remove minimum">×</button>
              </label>
            )}
            {maximum === undefined ? (
              <button type="button" onClick={() => { setMaximum(0); onChange(buildPatchWithAnnotations({ maximum: 0 })); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6 }}>+ Maximum</button>
            ) : (
              <label style={{ width: 120, display: 'flex', alignItems: 'center', gap: 8 }}>Max
                <input className={styles.numberInput} type="number" value={maximum as any} onWheel={(e) => { e.preventDefault(); const dir = e.deltaY > 0 ? -1 : 1; const mult = e.shiftKey ? 10 : 1; const cur = typeof maximum === 'number' ? (maximum as number) : 0; const newVal = cur + dir * 1 * mult; setMaximum(newVal); onChange(buildPatchWithAnnotations({ maximum: newVal })); }} onChange={e => setMaximum(e.target.value === '' ? undefined : Number(e.target.value))} onBlur={() => onChange(buildPatchWithAnnotations({ maximum }))} />
                <button type="button" onClick={() => { setMaximum(undefined); onChange(buildPatchWithAnnotations({ maximum: undefined })); }} className={styles.removeControl} title="Remove maximum">×</button>
              </label>
            )}
          </div>
        )}
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {type !== 'array' && !isEnum && (
            <>
              {/* min/max length (only for non-array types) */}
              {minLength === undefined ? (
                <button type="button" onClick={() => { setMinLength(0); onChange(buildPatchWithAnnotations({ minLength: 0 })); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6 }}>+ Min Length</button>
              ) : (
                <div style={{ width: 140, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input className={styles.numberInput} placeholder="Min Length" aria-label="Min Length" type="number" value={minLength as any} onWheel={(e) => { e.preventDefault(); const dir = e.deltaY > 0 ? -1 : 1; const mult = e.shiftKey ? 10 : 1; const cur = typeof minLength === 'number' ? (minLength as number) : 0; const newVal = Math.max(0, cur + dir * 1 * mult); setMinLength(newVal); onChange(buildPatchWithAnnotations({ minLength: newVal })); }} onChange={e => setMinLength(e.target.value === '' ? undefined : Number(e.target.value))} onBlur={() => {
                    // validate
                    if (minLength !== undefined && minLength < 0) {
                      setMinMaxLengthError('minLength must be >= 0');
                    } else if (maxLength !== undefined && minLength !== undefined && maxLength < minLength) {
                      setMinMaxLengthError('maxLength must be >= minLength');
                    } else {
                      setMinMaxLengthError(null);
                      onChange(buildPatchWithAnnotations({ minLength }));
                    }
                  }} />
                  <button type="button" onClick={() => { setMinLength(undefined); onChange(buildPatchWithAnnotations({ minLength: undefined })); }} className={styles.removeControl} title="Remove minLength">×</button>
                  {minMaxLengthError && <div style={{ color: '#e53935', fontSize: 12, marginTop: 6 }}>{minMaxLengthError}</div>}
                </div>
              )}
              {maxLength === undefined ? (
                <button type="button" onClick={() => { setMaxLength(0); onChange(buildPatchWithAnnotations({ maxLength: 0 })); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6 }}>+ Max Length</button>
              ) : (
                <div style={{ width: 140, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input className={styles.numberInput} placeholder="Max Length" aria-label="Max Length" type="number" value={maxLength as any} onWheel={(e) => { e.preventDefault(); const dir = e.deltaY > 0 ? -1 : 1; const mult = e.shiftKey ? 10 : 1; const cur = typeof maxLength === 'number' ? (maxLength as number) : 0; const newVal = Math.max(0, cur + dir * 1 * mult); setMaxLength(newVal); onChange(buildPatchWithAnnotations({ maxLength: newVal })); }} onChange={e => setMaxLength(e.target.value === '' ? undefined : Number(e.target.value))} onBlur={() => {
                    if (maxLength !== undefined && maxLength < 0) {
                      setMinMaxLengthError('maxLength must be >= 0');
                    } else if (minLength !== undefined && maxLength !== undefined && maxLength < minLength) {
                      setMinMaxLengthError('maxLength must be >= minLength');
                    } else {
                      setMinMaxLengthError(null);
                      onChange(buildPatchWithAnnotations({ maxLength }));
                    }
                  }} />
                  <button type="button" onClick={() => { setMaxLength(undefined); onChange(buildPatchWithAnnotations({ maxLength: undefined })); }} className={styles.removeControl} title="Remove maxLength">×</button>
                  {minMaxLengthError && <div style={{ color: '#e53935', fontSize: 12, marginTop: 6 }}>{minMaxLengthError}</div>}
                </div>
              )}
            </>
          )}

          {/* multipleOf */}
          {!isEnum && (multipleOf === undefined ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="button" onClick={() => { setMultipleOf(1); onChange(buildPatchWithAnnotations({ multipleOf: 1 })); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6 }}>+ multipleOf</button>
              {examples === undefined ? (
                <button type="button" onClick={() => { setExamples(''); onChange(buildPatchWithAnnotations({ examples: [] })); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6 }}>+ Examples</button>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    value={examples ?? ''}
                    onChange={e => setExamples(e.target.value)}
                    onBlur={() => {
                      const parsed = examples ? examples.split(',').map(s => s.trim()).filter(Boolean) : undefined;
                      onChange(buildPatchWithAnnotations({ examples: parsed }));
                    }}
                    style={{ minWidth: 180, padding: 4, borderRadius: 4, border: '1px solid #ccc' }}
                    placeholder="Examples (comma separated)"
                    aria-label="Examples"
                  />
                  <button type="button" onClick={() => { setExamples(undefined); onChange(buildPatchWithAnnotations({ examples: undefined })); }} className={styles.removeControl} title="Remove examples">×</button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ width: 160, display: 'flex', alignItems: 'center', gap: 8 }}>
              <input className={styles.numberInput} placeholder="multipleOf" aria-label="multipleOf" type="number" step="any" value={multipleOf as any} onWheel={(e) => { e.preventDefault(); const dir = e.deltaY > 0 ? -1 : 1; const mult = e.shiftKey ? 10 : 1; const cur = typeof multipleOf === 'number' ? (multipleOf as number) : 1; const newVal = parseFloat((cur + dir * 1 * mult).toString()); setMultipleOf(newVal); onChange(buildPatchWithAnnotations({ multipleOf: newVal })); }} onChange={e => setMultipleOf(e.target.value === '' ? undefined : Number(e.target.value))} onBlur={() => {
                if (multipleOf !== undefined && !(multipleOf > 0)) {
                  setMultipleOfError('multipleOf must be > 0');
                } else {
                  setMultipleOfError(null);
                  onChange(buildPatchWithAnnotations({ multipleOf }));
                }
                  }} />
              <button type="button" onClick={() => { setMultipleOf(undefined); onChange(buildPatchWithAnnotations({ multipleOf: undefined })); }} className={styles.removeControl} title="Remove multipleOf">×</button>
              {examples === undefined ? (
                <button type="button" onClick={() => { setExamples(''); onChange(buildPatchWithAnnotations({ examples: [] })); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6 }}>+ Examples</button>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    value={examples ?? ''}
                    onChange={e => setExamples(e.target.value)}
                    onBlur={() => {
                      const parsed = examples ? examples.split(',').map(s => s.trim()).filter(Boolean) : undefined;
                      onChange(buildPatchWithAnnotations({ examples: parsed }));
                    }}
                    style={{ minWidth: 180, padding: 4, borderRadius: 4, border: '1px solid #ccc' }}
                    placeholder="Examples (comma separated)"
                    aria-label="Examples"
                  />
                  <button type="button" onClick={() => { setExamples(undefined); onChange(buildPatchWithAnnotations({ examples: undefined })); }} className={styles.removeControl} title="Remove examples">×</button>
                </div>
              )}
              {multipleOfError && <div style={{ color: '#e53935', fontSize: 12, marginTop: 6 }}>{multipleOfError}</div>}
            </div>
          ))}

          {/* uniqueItems and min/max items for arrays */}
          {type === 'array' && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={!!uniqueItems} onChange={e => { setUniqueItems(e.target.checked); onChange(buildPatchWithAnnotations({ uniqueItems: e.target.checked })); }} aria-label="Unique Items" />
                <span style={{ fontSize: 13 }}>unique</span>
                {uniqueItems !== undefined && (
                  <button type="button" onClick={() => { setUniqueItems(undefined); onChange(buildPatchWithAnnotations({ uniqueItems: undefined })); }} className={styles.removeControl} title="Remove uniqueItems">×</button>
                )}
              </label>
              {!isEnum && (
                <>
                  {minItems === undefined ? (
                    <button type="button" onClick={() => { setMinItems(0); onChange(buildPatchWithAnnotations({ minItems: 0 })); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6 }}>+ Min Items</button>
                  ) : (
                    <label style={{ width: 140, display: 'flex', alignItems: 'center', gap: 8 }}> 
                      <input className={styles.numberInput} placeholder="Min Items" aria-label="Min Items" type="number" value={minItems as any} onWheel={(e) => { e.preventDefault(); const dir = e.deltaY > 0 ? -1 : 1; const mult = e.shiftKey ? 10 : 1; const cur = typeof minItems === 'number' ? (minItems as number) : 0; const newVal = Math.max(0, cur + dir * 1 * mult); setMinItems(newVal); onChange(buildPatchWithAnnotations({ minItems: newVal })); }} onChange={e => setMinItems(e.target.value === '' ? undefined : Number(e.target.value))} onBlur={() => {
                        if (minItems !== undefined && minItems < 0) setMinMaxItemsError('minItems must be >= 0');
                        else if (maxItems !== undefined && minItems !== undefined && maxItems < minItems) setMinMaxItemsError('maxItems must be >= minItems');
                        else { setMinMaxItemsError(null); onChange(buildPatchWithAnnotations({ minItems })); }
                      }} />
                      <button type="button" onClick={() => { setMinItems(undefined); onChange(buildPatchWithAnnotations({ minItems: undefined })); }} className={styles.removeControl} title="Remove minItems">×</button>
                      {minMaxItemsError && <div style={{ color: '#e53935', fontSize: 12, marginTop: 6 }}>{minMaxItemsError}</div>}
                    </label>
                  )}
                  {maxItems === undefined ? (
                    <button type="button" onClick={() => { setMaxItems(0); onChange(buildPatchWithAnnotations({ maxItems: 0 })); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6 }}>+ Max Items</button>
                  ) : (
                    <label style={{ width: 140, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input className={styles.numberInput} placeholder="Max Items" aria-label="Max Items" type="number" value={maxItems as any} onWheel={(e) => { e.preventDefault(); const dir = e.deltaY > 0 ? -1 : 1; const mult = e.shiftKey ? 10 : 1; const cur = typeof maxItems === 'number' ? (maxItems as number) : 0; const newVal = Math.max(0, cur + dir * 1 * mult); setMaxItems(newVal); onChange(buildPatchWithAnnotations({ maxItems: newVal })); }} onChange={e => setMaxItems(e.target.value === '' ? undefined : Number(e.target.value))} onBlur={() => {
                        if (maxItems !== undefined && maxItems < 0) setMinMaxItemsError('maxItems must be >= 0');
                        else if (minItems !== undefined && maxItems !== undefined && maxItems < minItems) setMinMaxItemsError('maxItems must be >= minItems');
                        else { setMinMaxItemsError(null); onChange(buildPatchWithAnnotations({ maxItems })); }
                      }} style={{ flex: 1, marginTop: 2, padding: 4, borderRadius: 4, border: '1px solid #ccc' }} />
                      <button type="button" onClick={() => { setMaxItems(undefined); onChange(buildPatchWithAnnotations({ maxItems: undefined })); }} className={styles.removeControl} title="Remove maxItems">×</button>
                      {minMaxItemsError && <div style={{ color: '#e53935', fontSize: 12, marginTop: 6 }}>{minMaxItemsError}</div>}
                    </label>
                  )}
                </>
              )}
            </>
          )}

          {/* readOnly / deprecated */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" aria-label="Read only" checked={!!readOnlyFlag} onChange={e => { setReadOnlyFlag(e.target.checked); onChange(buildPatchWithAnnotations({ readOnly: e.target.checked })); }} /> readOnly
            {readOnlyFlag !== undefined && (
              <button type="button" onClick={() => { setReadOnlyFlag(undefined); onChange(buildPatchWithAnnotations({ readOnly: undefined })); }} className={styles.removeControl} title="Remove readOnly">×</button>
            )}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" aria-label="Deprecated" checked={!!deprecatedFlag} onChange={e => { setDeprecatedFlag(e.target.checked); onChange(buildPatchWithAnnotations({ deprecated: e.target.checked })); }} /> deprecated
            {deprecatedFlag !== undefined && (
              <button type="button" onClick={() => { setDeprecatedFlag(undefined); onChange(buildPatchWithAnnotations({ deprecated: undefined })); }} className={styles.removeControl} title="Remove deprecated">×</button>
            )}
          </label>
        </div>
      </div>
      )}
    </form>
  );
};

const MemoizedNodePropertyEditor = React.memo(NodePropertyEditor);

;
import "reactflow/dist/style.css";
import styles from "./graphical-schema-editor.module.css";

// Node types: object, array, primitive
export type SchemaNodeType = "object" | "array" | "string" | "number" | "boolean" | "null" | "image";

export interface GraphicalSchemaEditorProps {
  schema: Record<string, unknown>;
  onChange: (schema: Record<string, unknown>) => void;
  useTestData?: boolean;
  isSchemaImported?: (schema: Record<string, unknown>, path?: string[]) => boolean;
}

// Group box for Properties/Items
const GroupBox = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div style={{
    background: '#e8fbe8',
    border: '2px dashed #7ed957',
    borderRadius: 12,
    padding: '18px 18px 12px 18px',
    margin: '0 0 24px 0',
    minWidth: 220,
    position: 'relative',
  }}>
    {children}
    <button style={{
      marginTop: 12,
      background: 'none',
      border: '1px dashed #7ed957',
      color: '#388e3c',
      borderRadius: 8,
      padding: '4px 12px',
      cursor: 'pointer',
      fontWeight: 500,
      fontSize: 14,
      display: 'block',
      width: '100%',
    }}>+ Add Property</button>
  </div>
);


// Custom node component that renders all data properties, with C# generic style for type if ofType is present, and required badge
const CustomNode = ({ data }: { data: SchemaNodeData & { required?: boolean } }) => {
  const { label, type, ofType, required } = data;
  const isPattern = Boolean((data as any).patternKey);
  return (
    <div className={isPattern ? styles.patternNode : undefined} style={{
      background: isPattern ? undefined : '#fff',
      border: '2px solid #b3e6b3',
      borderRadius: 8,
      padding: '10px 18px',
      marginBottom: 12,
      minWidth: 120,
      boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
      textAlign: 'left',
      position: 'relative',
    }}>
      {/* Target handle for incoming edges */}
      <Handle type="target" position={Position.Left} style={{ background: '#00e676', width: 10, height: 10, borderRadius: 5 }} />
      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4, color: '#222' }}>
        { (data as any).patternKey ? <span className={styles.patternBadge}>pattern</span> : null }
        {label}
        {data.imported && (
          <span title={typeof data.$ref === 'string' ? `Imported from ${data.$ref}` : 'Imported definition (create local override to change)'} style={{ color: '#d9822b', marginLeft: 8, fontSize: 14, verticalAlign: 'middle' }}>*</span>
        )}
        {required && (
          <span style={{
            background: '#e53935',
            color: '#fff',
            borderRadius: 6,
            padding: '2px 8px',
            fontSize: 12,
            fontWeight: 600,
            marginLeft: 8,
            verticalAlign: 'middle',
          }}>required</span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {/* Render type as C# generic if ofType is present */}
        <span style={{
          display: 'inline-block',
          background: '#f5f5f5',
          borderRadius: 8,
          padding: '2px 8px',
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: '0.03em',
          border: '1px solid #e0e0e0',
          marginRight: 4,
          marginBottom: 2,
        }}>
          {ofType ? (
            <>
              <span style={{ color: '#2b6cb0', fontWeight: 700 }}>{type}</span>
              <span style={{ color: '#888' }}>&lt;</span>
              <span style={{ color: '#43a047', fontWeight: 700 }}>{ofType}</span>
              <span style={{ color: '#888' }}>&gt;</span>
            </>
          ) : (
            <span style={{ color: '#2b6cb0', fontWeight: 700 }}>{type}</span>
          )}
        </span>
        {/* Render all other properties except label, id, parent, type, ofType, required, default, title */}
        {Object.entries(data).map(([key, value]) => {
          if (value === undefined) return null;
          // hide some keys from the compact node UI
          const hidden = ['label', 'id', 'parent', 'type', 'ofType', 'required', 'enum', 'items', 'default', 'title'];
          if (hidden.includes(key)) return null;
          // special-case format to render a compact orange badge (just the value)
          if (key === 'format') {
            return (
              <span key={key} style={{
                display: 'inline-block',
                color: '#fb8c00',
                fontWeight: 700,
                marginRight: 8,
                marginBottom: 2,
                fontSize: 12,
              }}>{String(value)}</span>
            );
          }
          // show minimum/maximum as compact min/max badges
          if (key === 'minimum') {
            return (
              <span key={key} style={{
                display: 'inline-block',
                background: '#eaf6ff',
                color: '#2176c7',
                borderRadius: 8,
                padding: '2px 8px',
                fontSize: 12,
                fontWeight: 700,
                border: '1px solid #b3d4fc',
                marginRight: 4,
                marginBottom: 2,
              }}>min: {String(value)}</span>
            );
          }
          if (key === 'maximum') {
            return (
              <span key={key} style={{
                display: 'inline-block',
                background: '#eaf6ff',
                color: '#2176c7',
                borderRadius: 8,
                padding: '2px 8px',
                fontSize: 12,
                fontWeight: 700,
                border: '1px solid #b3d4fc',
                marginRight: 4,
                marginBottom: 2,
              }}>max: {String(value)}</span>
            );
          }
          return (
            <span key={key} style={{
              display: 'inline-block',
              background: '#eaf6ff',
              color: '#2176c7',
              borderRadius: 8,
              padding: '2px 8px',
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: '0.03em',
              border: '1px solid #b3d4fc',
              marginRight: 4,
              marginBottom: 2,
            }}>{key}: {String(value)}</span>
          );
        })}
      </div>
      {/* Source handle for outgoing edges */}
      <Handle type="source" position={Position.Right} style={{ background: '#00e676', width: 10, height: 10, borderRadius: 5 }} />
    </div>
  );
};

// Simple SchemaCard component for displaying label and type
const SchemaCard = ({ label, type, imported }: { label: string; type: SchemaNodeType; imported?: boolean }) => (
  <div style={{
    background: '#f5f5f5',
    border: '1px solid #b3e6b3',
    borderRadius: 8,
    padding: '8px 14px',
    marginBottom: 8,
    minWidth: 100,
    fontSize: 15,
    fontWeight: 500,
    color: '#2176c7',
    display: 'inline-block',
  }}>
    {label}{imported && (
      <span title="Imported definition (create local override to change)" style={{ color: '#d9822b', marginLeft: 6 }}>*</span>
    )} <span style={{ color: '#888', fontWeight: 400 }}>({type})</span>
  </div>
);

// Root node as a group box with a property card
export const RootNode: React.FC<{ data: SchemaNodeData }> = ({ data }) => (
  <GroupBox title="Root Object">
    <div
      className="root-node"
      style={{ pointerEvents: 'none', cursor: 'default' }}
    >
      <SchemaCard label={data.label} type={data.type} imported={data.imported} />
    </div>
  </GroupBox>
);

// Properties group node type
const PropertiesGroupNode = ({ children }: { children?: React.ReactNode }) => (
  <GroupBox title="Properties">{children}</GroupBox>
);

// Items group node type
const ItemsGroupNode = ({ data }: { data: SchemaNodeData }) => (
  <GroupBox title="Items">
    <SchemaCard label={data.label} type={data.type} imported={data.imported} />
  </GroupBox>
);


// Define nodeTypes outside the component to avoid React Flow recreation warning
export const nodeTypes: { [key: string]: React.FC<any> } = {
  root: RootNode,
  property: CustomNode,
  enum: EnumNode,
  propertiesGroup: PropertiesGroupNode,
  itemsGroup: ItemsGroupNode,
};

// Only define a root node as needed (empty schema)
const initialNodes: Node<SchemaNodeData>[] = [
  {
    id: '1',
    type: 'root',
    data: { id: '1', label: 'Root', type: 'object' },
    position: { x: 0, y: 10 },
    draggable: false,
    selectable: false,
  },
];
const initialEdges: Edge[] = [];

// No longer needed: all property nodes use CustomNode

export function GraphicalSchemaEditor({ schema, onChange, useTestData, isSchemaImported }: GraphicalSchemaEditorProps) {

  // Ref to store label of selected node before graph rebuild
  const selectedNodeLabelRef = React.useRef<string | null>(null);
  const [resolvedSchema, setResolvedSchema] = React.useState<Record<string, unknown> | null>(null);
  const initialLoadRef = React.useRef(true);
  const flowWrapperRef = React.useRef<HTMLDivElement | null>(null);

  // Helper to generate deterministic IDs based on path
  const makeId = (parentId?: string, label?: string) => {
    if (!parentId) return '1';
    const safeLabel = (label || '').toString().replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${parentId}.${safeLabel}`;
  };

  // Full schemaToGraph implementation
  const schemaToGraph = React.useCallback((schema: Record<string, unknown>): { nodes: Node<SchemaNodeData>[]; edges: Edge[] } => {
    const nodes: Node<SchemaNodeData>[] = [];
    const edges: Edge[] = [];

    function walkSchema(obj: any, parentId?: string, label?: string, x = 0, y = 0, parentRequired?: string[]): string {
      const id = makeId(parentId, label);
      let type = obj.type || 'object';
      let ofType = undefined;
      let nodeType = 'property';
      let isRequired = false;
      // If not root, check if required
      if (parentId && parentRequired && label) {
        isRequired = parentRequired.includes(label);
      }
      // Include common annotations so editors stay in sync (default, format, pattern, description, enum)
      let nodeData: any = { id, label: label || obj.title || (parentId ? type : 'Root'), type, parent: parentId };
      // Mark nodes that originate from a $ref or external provenance so the UI can show an indicator
      try {
        if (obj && typeof obj === 'object') {
          if (typeof obj.$ref === 'string') nodeData.imported = true;
          else if (Array.isArray(obj.allOf) && obj.allOf.some((e: any) => e && typeof e.$ref === 'string')) nodeData.imported = true;
          else if ((obj as any).__from) nodeData.imported = true;
        }
      } catch (e) {
        // ignore
      }
      if (obj.default !== undefined) nodeData.default = obj.default;
      if (obj.format !== undefined) nodeData.format = obj.format;
      if (obj.pattern !== undefined) nodeData.pattern = obj.pattern;
      if (obj.description !== undefined) nodeData.description = obj.description;
      if (Array.isArray(obj.enum)) nodeData.enum = obj.enum;
      // Additional common annotations/constraints
      if (obj.examples !== undefined) nodeData.examples = obj.examples;
      if (obj.minimum !== undefined) nodeData.minimum = obj.minimum;
      if (obj.maximum !== undefined) nodeData.maximum = obj.maximum;
      if (obj.exclusiveMinimum !== undefined) nodeData.exclusiveMinimum = obj.exclusiveMinimum;
      if (obj.exclusiveMaximum !== undefined) nodeData.exclusiveMaximum = obj.exclusiveMaximum;
      if (obj.minLength !== undefined) nodeData.minLength = obj.minLength;
      if (obj.maxLength !== undefined) nodeData.maxLength = obj.maxLength;
      if (obj.multipleOf !== undefined) nodeData.multipleOf = obj.multipleOf;
      if (obj.minItems !== undefined) nodeData.minItems = obj.minItems;
      if (obj.maxItems !== undefined) nodeData.maxItems = obj.maxItems;
      if (obj.uniqueItems !== undefined) nodeData.uniqueItems = obj.uniqueItems;
      if (obj.readOnly !== undefined) nodeData.readOnly = obj.readOnly;
      if (obj.writeOnly !== undefined) nodeData.writeOnly = obj.writeOnly;
      if (obj.deprecated !== undefined) nodeData.deprecated = obj.deprecated;
      if (obj.const !== undefined) nodeData.const = obj.const;
      if (obj.title !== undefined) nodeData.title = obj.title;
      // If array, check if items is enum and propagate imported provenance from items
      if (type === 'array' && obj.items) {
        ofType = obj.items.type || 'object';
        nodeData.ofType = ofType;
        if (Array.isArray(obj.items.enum)) {
          nodeType = 'enum';
          nodeData.enum = obj.items.enum;
        }
        try {
          const items = obj.items as any;
          if (items && typeof items === 'object') {
            if (typeof items.$ref === 'string') nodeData.imported = true;
            else if (Array.isArray(items.allOf) && items.allOf.some((e: any) => e && typeof e.$ref === 'string')) nodeData.imported = true;
            else if (items.__from) nodeData.imported = true;
          }
        } catch (e) {
          /* ignore */
        }
      }
      // If enum, use enum node type
      if (Array.isArray(obj.enum)) {
        nodeType = 'enum';
        nodeData.enum = obj.enum;
      }
      if (parentId) {
        nodeData.required = isRequired;
      }
      nodes.push({
        id,
        type: nodeType,
        data: nodeData,
        position: { x, y },
      });
      if (parentId) {
        edges.push({ id: `e${parentId}-${id}`, source: parentId, target: id, type: 'default' });
      }
      // Properties and patternProperties for objects
      if (type === 'object') {
        let propY = y - 80;
        if (obj.properties) {
          for (const [key, propSchema] of Object.entries(obj.properties).filter(([k]) => !k.startsWith('__'))) {
            walkSchema(propSchema, id, key, x + 250, propY, obj.required || []);
            propY += 140;
          }
        }
        // Pattern properties (render as compact nodes labeled `pattern: <regex>`)
        if (obj.patternProperties && typeof obj.patternProperties === 'object') {
          for (const [pat, subschema] of Object.entries(obj.patternProperties)) {
            const patLabel = `pattern: ${pat}`;
            const createdId = walkSchema(subschema, id, patLabel, x + 250, propY, obj.required || []);
            // Attach the raw pattern key to the node data so we can round-trip back to schema.patternProperties
            const createdNode = nodes.find(n => n.id === createdId);
            if (createdNode) {
              createdNode.data.patternKey = pat;
              createdNode.data.label = patLabel;
            }
            propY += 140;
          }
        }
      }
      // If array of objects, walk into properties of items, but do not create a subnode for 'items'
      if (type === 'array' && obj.items && obj.items.type === 'object' && obj.items.properties) {
        let propY = y - 80;
        for (const [key, propSchema] of Object.entries(obj.items.properties).filter(([k]) => !k.startsWith('__'))) {
          walkSchema(propSchema, id, key, x + 250, propY, obj.items.required || []);
          propY += 140;
        }
      }
      return id;
    }
    walkSchema(schema, undefined, 'Root', 0, 200);
    return { nodes, edges };
  }, []);

  // Relayout nodes into a vertical tree. Use `dagre` when available to compute
  // positions using measured node widths from the DOM. If `dagre` is not
  // available, fall back to a heuristic layout that estimates widths.
  const relayoutNodes = React.useCallback((inputNodes: Node<SchemaNodeData>[], inputEdges: Edge[]) => {
    if (!Array.isArray(inputNodes) || inputNodes.length === 0) return inputNodes;

    const nodeMap = new Map<string, Node<SchemaNodeData>>();
    for (const n of inputNodes) if (n && n.id) nodeMap.set(n.id, n);

    // Build children map by parent id (prefer data.parent)
    const children = new Map<string, string[]>();
    for (const n of inputNodes) {
      const pid = n.data && (n.data.parent as string | undefined);
      if (pid) {
        const arr = children.get(pid) || [];
        arr.push(n.id);
        children.set(pid, arr);
      }
    }

    const NODE_HEIGHT = 84;
    const V_SPACING = 20;
    const START_Y = 60;

    // Estimate widths as fallback
    const CHAR_WIDTH = 8;
    const MIN_WIDTH = 120;
    const H_PADDING = 40;
    const H_SPACING = 40;
    const estimateWidth = (n: Node<SchemaNodeData>) => {
      const lbl = (n.data && (n.data.label as string)) || '';
      return Math.max(MIN_WIDTH, lbl.length * CHAR_WIDTH + H_PADDING);
    };

    // Try to load dagre dynamically (allow optional dependency)
    let dagreLib: any = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      // @ts-ignore
      dagreLib = require('dagre');
    } catch (e) {
      // try window global (if loaded externally)
      // @ts-ignore
      if (typeof window !== 'undefined' && (window as any).dagre) dagreLib = (window as any).dagre;
    }

    if (dagreLib) {
      try {
        const g = new dagreLib.graphlib.Graph();
        g.setGraph({ rankdir: 'LR', nodesep: 20, ranksep: 40 });
        g.setDefaultEdgeLabel(() => ({}));

        // Add nodes with measured or estimated sizes
        for (const n of inputNodes) {
          let w = estimateWidth(n);
          let h = NODE_HEIGHT;
          try {
            // Try to measure DOM node if present
            if (typeof document !== 'undefined') {
              const el = document.querySelector(`.react-flow__node[data-id="${n.id}"]`) as HTMLElement | null
                || document.querySelector(`[data-id="${n.id}"]`) as HTMLElement | null;
              if (el) {
                const r = el.getBoundingClientRect();
                if (r.width > 0) w = Math.max(w, r.width);
                if (r.height > 0) h = r.height;
              }
            }
          } catch (m) {
            // ignore measurement errors
          }
          g.setNode(n.id, { width: w, height: h });
        }

        // Add edges from inputEdges (use source->target)
        for (const e of inputEdges || []) {
          if (e && (e as any).source && (e as any).target) g.setEdge((e as any).source, (e as any).target);
        }

        dagreLib.layout(g);

        const positions = new Map<string, { x: number; y: number }>();
        g.nodes().forEach((id: string) => {
          const n = g.node(id);
          // dagre gives center x,y; convert to top-left for React Flow
          positions.set(id, { x: n.x - n.width / 2, y: n.y - n.height / 2 });
        });

        // Ensure root is far left and leaves are far right: compute min/max x and
        // scale so leaves reach container width from root.
        const containerWidth = flowWrapperRef.current?.getBoundingClientRect().width || 1400;
        const TARGET_WIDTH = containerWidth - 40; // leave some margin
        const LEFT_MARGIN = 20;
        const rootPos = positions.get('1');
        const xs: number[] = [];
        const leafIds: string[] = [];
        for (const n of inputNodes) {
          const pos = positions.get(n.id);
          if (pos) xs.push(pos.x);
          // leaf: has no children (or no outgoing edges)
          const ch = children.get(n.id) || [];
          if (!ch || ch.length === 0) leafIds.push(n.id);
        }
        if (!rootPos || xs.length === 0) {
          return inputNodes.map(n => {
            const pos = positions.get(n.id);
            if (!pos) return n;
            return { ...n, position: { x: pos.x, y: pos.y } };
          });
        }
        const minX = Math.min(...xs);
        const maxLeafX = Math.max(...leafIds.map(id => positions.get(id)?.x ?? minX));
        const rootX = rootPos.x;
        const span = maxLeafX - rootX || 1;
        const scale = TARGET_WIDTH / span;

        return inputNodes.map(n => {
          const pos = positions.get(n.id);
          if (!pos) return n;
          const newX = LEFT_MARGIN + (pos.x - rootX) * scale;
          return { ...n, position: { x: newX, y: pos.y } };
        });
      } catch (err) {
        // fall through to heuristic if dagre fails
      }
    }

    // Fallback heuristic layout (estimates widths and stacks children)
    const widthMap = new Map<string, number>();
    for (const n of inputNodes) widthMap.set(n.id, estimateWidth(n));

    const heightMemo = new Map<string, number>();
    const computeHeight = (id: string): number => {
      if (heightMemo.has(id)) return heightMemo.get(id)!;
      const ch = children.get(id) || [];
      if (ch.length === 0) {
        heightMemo.set(id, NODE_HEIGHT);
        return NODE_HEIGHT;
      }
      let total = 0;
      for (let i = 0; i < ch.length; i++) {
        total += computeHeight(ch[i]);
        if (i < ch.length - 1) total += V_SPACING;
      }
      heightMemo.set(id, total);
      return total;
    };

    const positions = new Map<string, { x: number; y: number }>();
    const assign = (id: string, centerX: number, yTop: number) => {
      const ch = children.get(id) || [];
      if (ch.length === 0) {
        positions.set(id, { x: centerX, y: yTop + NODE_HEIGHT / 2 });
        return computeHeight(id);
      }
      const heights = ch.map(cid => computeHeight(cid));
      let curY = yTop;
      const parentWidth = widthMap.get(id) || MIN_WIDTH;
      for (let i = 0; i < ch.length; i++) {
        const cid = ch[i];
        const childWidth = widthMap.get(cid) || MIN_WIDTH;
        const childCenterX = centerX + (parentWidth / 2) + H_SPACING + (childWidth / 2);
        assign(cid, childCenterX, curY);
        curY += heights[i] + V_SPACING;
      }
      const first = positions.get(ch[0])!;
      const last = positions.get(ch[ch.length - 1])!;
      const parentY = (first.y + last.y) / 2;
      positions.set(id, { x: centerX, y: parentY });
      return heights.reduce((s, h) => s + h, 0) + V_SPACING * (ch.length - 1);
    };

    const rootId = '1';
    if (!nodeMap.has(rootId)) return inputNodes;
    computeHeight(rootId);
    assign(rootId, 0, START_Y);

    // Normalize fallback layout similarly: scale so leaves are pushed right
    const containerWidth = flowWrapperRef.current?.getBoundingClientRect().width || 1400;
    const TARGET_WIDTH = containerWidth - 40;
    const LEFT_MARGIN = 20;
    const xs: number[] = [];
    const leafIds: string[] = [];
    for (const n of inputNodes) {
      const p = positions.get(n.id);
      if (p) xs.push(p.x);
      const ch = children.get(n.id) || [];
      if (!ch || ch.length === 0) leafIds.push(n.id);
    }
    const rootPos = positions.get('1');
    if (!rootPos || xs.length === 0) {
      return inputNodes.map(n => {
        const pos = positions.get(n.id);
        if (!pos) return n;
        return { ...n, position: { x: pos.x, y: pos.y - NODE_HEIGHT / 2 } };
      });
    }
    const rootX = rootPos.x;
    const maxLeafX = Math.max(...leafIds.map(id => positions.get(id)?.x ?? rootX));
    const span = maxLeafX - rootX || 1;
    const scale = TARGET_WIDTH / span;

    return inputNodes.map(n => {
      const pos = positions.get(n.id);
      if (!pos) return n;
      const newX = LEFT_MARGIN + (pos.x - rootX) * scale;
      return { ...n, position: { x: newX, y: pos.y - NODE_HEIGHT / 2 } };
    });
  }, []);

  // Build a JSON Schema from the current nodes collection (authoritative)
  const buildSchemaFromNodes = (allNodes: Node<SchemaNodeData>[]) => {
    const root = allNodes.find(n => n.type === 'root') || allNodes.find(n => n.data && n.data.label === 'Root') || allNodes.find(n => n.id === '1');
    if (!root) return {} as Record<string, unknown>;

    // Recursive builder: assemble schema for a node by finding its children
    const buildNodeSchema = (node: Node<SchemaNodeData>): Record<string, unknown> => {
      const base = schemaNodeDataToSchema(node.data as SchemaNodeData) as any;
      if (node.data.type === 'object') {
        const props: Record<string, unknown> = {};
        const patternProps: Record<string, unknown> = {};
        const requiredList: string[] = [];
        allNodes.forEach(child => {
          if (child.data && child.data.parent === node.id) {
            const key = child.data.label;
            const patternKey = (child.data as any).patternKey;
            if (patternKey) {
              patternProps[patternKey] = buildNodeSchema(child);
            } else {
              if (key) props[key] = buildNodeSchema(child);
              if (child.data && (child.data as any).required) {
                if (key) requiredList.push(key);
              }
            }
          }
        });
        if (Object.keys(props).length > 0) base.properties = props;
        if (Object.keys(patternProps).length > 0) base.patternProperties = patternProps;
        if (requiredList.length > 0) base.required = requiredList;
      }
      if (node.data.type === 'array') {
        // If array of objects, collect children as items.properties
        if (node.data.ofType === 'object') {
          const itemProps: Record<string, unknown> = {};
          const itemRequired: string[] = [];
          allNodes.forEach(child => {
            if (child.data && child.data.parent === node.id) {
              const key = child.data.label;
              if (key) itemProps[key] = buildNodeSchema(child);
              if (child.data && (child.data as any).required) {
                if (key) itemRequired.push(key);
              }
            }
          });
          if (Object.keys(itemProps).length > 0) {
            base.items = { type: 'object', properties: itemProps } as any;
            if (itemRequired.length > 0) (base.items as any).required = itemRequired;
          }
        } else {
          // For primitives, preserve items enum if present on node.data
          if (node.data.items && (node.data.items as any).enum) {
            base.items = { ...(base.items || {}), enum: (node.data.items as any).enum };
          }
        }
      }
      return base;
    };

    const schema: Record<string, unknown> = { type: root.data.type, title: root.data.label };
    const props: Record<string, unknown> = {};
    allNodes.forEach(n => {
      if (n.data && n.data.parent === root.id) {
        const key = n.data.label;
        if (key) props[key] = buildNodeSchema(n);
      }
    });
    if (Object.keys(props).length > 0) schema.properties = props;
    return schema;
  };

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  // When we emit a schema update originating from this component, skip
  // syncing back from the `schema` prop for that single change to avoid
  // tearing down and rebuilding nodes (which causes selection loss).
  const skipSchemaSyncRef = React.useRef(false);

  // Find the selected node from nodes and selectedNodeId
  const selectedNode = React.useMemo(() => {
    if (!selectedNodeId) return null;
    // Try to find by ID
    let node = nodes.find(n => n.id === selectedNodeId);
    if (node) return node;
    // If not found, try to find enum node with same label as previous selection
    if (selectedNodeLabelRef.current) {
      node = nodes.find(n => n.type === 'enum' && n.data && n.data.label === selectedNodeLabelRef.current);
      if (node) return node;
    }
    return null;
  }, [nodes, selectedNodeId]);

  // Node property update handler
  const handleNodePropertyChange = (patch: Partial<NodeData>) => {
    // Compute rename/new id ahead of mutating nodes so we can preserve selection
    const targetNode = nodes.find((n) => n.id === patch.id);
    const oldId = targetNode?.id ?? (patch.id as string);
    const oldLabel = targetNode?.data?.label;
    const parentId = targetNode?.data?.parent;
    const newLabel = (patch.label ?? oldLabel) as string;
    let idChanged = false;
    let newId = oldId;
    if (oldLabel !== newLabel && parentId) {
      newId = makeId(parentId, newLabel);
      idChanged = newId !== oldId;
    }

    // Only patch the targeted node
    setNodes((prevNodes: Node<SchemaNodeData>[]) => {
      // Apply the patch to the node list, and if id changed, update child parent refs
      const updatedNodes = prevNodes.map((node: Node<SchemaNodeData>) => {
        // Update the node being patched
        if (node.id === oldId) {
          const newData = { ...node.data, ...patch } as SchemaNodeData;
          const updatedNode: Node<SchemaNodeData> = {
            ...node,
            id: newId,
            data: { ...newData },
          };
          return updatedNode;
        }
        // If another node had this as parent, update its parent id
        if (idChanged && node.data && node.data.parent === oldId) {
          return { ...node, data: { ...node.data, parent: newId } };
        }
        return node;
      });
      // If id changed, also update edges referencing the old id
      if (idChanged) {
        setEdges(prevEdges => prevEdges.map(e => {
          let s = e.source;
          let t = e.target;
          if (s === oldId) s = newId;
          if (t === oldId) t = newId;
          return { ...e, id: `e${s}-${t}`, source: s, target: t } as Edge;
        }));
      }

      // After node patching (rename or other edits), derive the authoritative
      // schema from the updated graph state (using nodes collection) and emit it once.
      const newSchema = buildSchemaFromNodes(updatedNodes);
      if (newSchema) {
        skipSchemaSyncRef.current = true;
        onChange(newSchema);
      }
      return updatedNodes;
    });

    // Preserve selection when we changed the id of the currently selected node
    if (idChanged) {
      setSelectedNodeId(newId);
    }
  };

  // Context menu state
  const [contextMenu, setContextMenu] = React.useState<{ visible: boolean; position: { x: number; y: number }; nodeId: string | null } | null>(null);

  // Sync nodes/edges with schema prop unless using test data
  // Only reset selected node if the graph structure changes (add/remove), not for every property edit
  const prevNodeCount = React.useRef(0);
  const prevEdgeCount = React.useRef(0);
  React.useMemo(() => {
    // If we recently emitted a schema update from inside this component,
    // skip syncing back from the `schema` prop for this change to avoid
    // tearing down and rebuilding nodes (which causes selection loss).
    if (skipSchemaSyncRef.current) {
      skipSchemaSyncRef.current = false;
      return;
    }
    if (useTestData) return;
    // If deref is in progress for a schema that contains $ref/$defs, wait
    const containsRefs = (s: any): boolean => {
      if (!s || typeof s !== 'object') return false;
      if (s.$ref !== undefined) return true;
      if (s.$defs !== undefined) return true;
      for (const v of Object.values(s)) {
        if (containsRefs(v)) return true;
      }
      return false;
    };
    const activeSchema = resolvedSchema || schema;
    if (!activeSchema) return;
    // Normalize schema for graph: if top-level is a $ref into $defs, hoist that definition
    const normalizeForGraph = (root: any) => {
      if (!root || typeof root !== 'object') return root;
      try {
        if (root.$ref && typeof root.$ref === 'string' && root.$defs && root.$ref.startsWith('#/$defs/')) {
          const key = root.$ref.replace('#/$defs/', '');
          const def = (root.$defs || {})[key];
          if (def) {
            // shallow clone and replace internal anchor refs using $defs anchors
            const anchorMap: Record<string, any> = {};
            for (const [k, v] of Object.entries(root.$defs || {})) {
              if ((v as any).$anchor) anchorMap[`#${(v as any).$anchor}`] = v;
            }
            const replaceRefs = (obj: any): any => {
              if (!obj || typeof obj !== 'object') return obj;
              if (Array.isArray(obj)) return obj.map(replaceRefs);
              if (obj.$ref && typeof obj.$ref === 'string' && anchorMap[obj.$ref]) return anchorMap[obj.$ref];
              const out: any = {};
              for (const [kk, vv] of Object.entries(obj)) out[kk] = replaceRefs(vv);
              return out;
            };
            return replaceRefs(JSON.parse(JSON.stringify(def)));
          }
        }
      } catch (e) {
        // ignore and return root
      }
      return root;
    };
    const schemaForGraph = normalizeForGraph(activeSchema);
    const rawGraph = schemaToGraph(schemaForGraph);
    const nodes = relayoutNodes(rawGraph.nodes, rawGraph.edges);
    const edges = rawGraph.edges;
    // Only rebuild nodes/edges if the count changes (structural change)
    // Store label of selected node before graph rebuild
    setNodes(prevNodes => {
      if (selectedNodeId) {
        const prevNode = prevNodes.find(n => n.id === selectedNodeId);
        selectedNodeLabelRef.current = prevNode?.data?.label || null;
      }
      return prevNodes;
    });
    if ((nodes.length !== prevNodeCount.current) || (edges.length !== prevEdgeCount.current)) {
      setNodes(nodes);
      setEdges(edges);
      // Try to preserve selected node if possible
      setSelectedNodeId(prevSelected => {
        if (!prevSelected) return nodes.length > 0 ? nodes[0].id : null;
        // If the node still exists after rebuild, keep it selected
        if (nodes.some(n => n.id === prevSelected)) return prevSelected;
        // Try to restore selection by label if node is lost
        const label = selectedNodeLabelRef.current;
        if (label) {
          const nodeByLabel = nodes.find(n => n.data && n.data.label === label);
          if (nodeByLabel) return nodeByLabel.id;
        }
        // Fallback: select first node if available
        return nodes.length > 0 ? nodes[0].id : null;
      });
      prevNodeCount.current = nodes.length;
      prevEdgeCount.current = edges.length;
    } else {
      // Only update nodes/edges data if the structure is the same (property edit)
      setNodes(prevNodes => nodes.map(n => {
        const prev = prevNodes.find(pn => pn.id === n.id);
        return prev ? { ...n, position: prev.position } : n;
      }));
      setEdges(edges);
    }
    // Otherwise, do not reset selection (preserve selection and form)
  }, [schema, resolvedSchema, setNodes, setEdges, useTestData, schemaToGraph]);

  // Note: dereferencing is handled by the top-level reducer/workbench.

  // Parent supplies resolved schema when available; no local emission.

  // Two-way sync: only trigger graphToSchema when nodes/edges are changed by user actions
  const [isUserEdit, setIsUserEdit] = React.useState(false);

  // Mark as user edit when nodes/edges change via React Flow events
  const handleNodesChange = (...args: Parameters<typeof onNodesChange>) => {
    setIsUserEdit(true);
    onNodesChange(...args);
  };
  const handleEdgesChange = (...args: Parameters<typeof onEdgesChange>) => {
    setIsUserEdit(true);
    onEdgesChange(...args);
  };

  // No longer rebuild schema from graph; only patch schema directly
  // (graphToSchema removed)
  React.useEffect(() => {
    if (initialLoadRef.current || !isUserEdit) return;
    setIsUserEdit(false);
  }, [nodes, edges, schema, onChange, isUserEdit]);

  const onConnect: OnConnect = (params: Connection) => setEdges((eds: Edge[]) => addEdge(params, eds));

  // Node click handler
  const handleNodeClick = (_: any, node: Node) => {
    if (node.id === '1') return; // Prevent root node from being selected
    setSelectedNodeId(node.id);
  };

  // Node right-click handler
  const handleNodeContextMenu = (event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    // Allow root node to open context menu for property addition
    setContextMenu({
      visible: true,
      position: { x: event.clientX, y: event.clientY },
      nodeId: node.id,
    });
  };

  // Add Property action
  const handleAddProperty = () => {
    const parentNode = nodes.find(n => n.id === contextMenu?.nodeId);
    if (!parentNode) {
      setContextMenu(null);
      return;
    }

    // Build authoritative base schema from current graph and keep a snapshot
    const baseSchema = buildSchemaFromNodes(nodes);
    const prevSchema = JSON.parse(JSON.stringify(baseSchema));

    // Helper: collect labels from root -> target node
    const collectPath = (n: Node<SchemaNodeData> | undefined) => {
      const labels: string[] = [];
      let cur = n;
      while (cur && cur.id !== '1') {
        if (cur.data && cur.data.label) labels.unshift(cur.data.label);
        cur = nodes.find(x => x.id === cur?.data?.parent);
      }
      return labels;
    };

    const path = collectPath(parentNode);

    const getSchemaAtPath = (schema: any, pathArr: string[]) => {
      let cur: any = schema;
      for (const lbl of pathArr) {
        if (!cur) return null;
        if (cur.type === 'object') {
          cur = (cur.properties || {})[lbl];
        } else if (cur.type === 'array') {
          // dive into items
          cur = (cur.items && cur.items.type === 'object') ? ((cur.items.properties || {})[lbl]) : undefined;
        } else {
          cur = undefined;
        }
      }
      return cur;
    };

    // Find the target schema object where we'll add a property
    const targetSchema = getSchemaAtPath(baseSchema, path);

    let emittedSchema: Record<string, unknown> | null = null;

    if (!targetSchema) {
      // Fallback: add to root
      emittedSchema = addPropertyToSchema(baseSchema as Record<string, unknown>);
    } else {
      // Add property to the target schema object (object or items)
      const updatedTarget = addPropertyToSchema(targetSchema as Record<string, unknown>);
      // Integrate updatedTarget back into baseSchema at the correct location
      if (path.length === 1) {
        // Direct child of root
        if (!baseSchema.properties) baseSchema.properties = {};
        (baseSchema.properties as Record<string, unknown>)[path[0]] = updatedTarget;
      } else {
        const parentPath = path.slice(0, -1);
        const lastLabel = path[path.length - 1];
        const parentContainer = getSchemaAtPath(baseSchema, parentPath);
        if (parentContainer) {
          if (parentContainer.type === 'object') {
            if (!parentContainer.properties) parentContainer.properties = {};
            parentContainer.properties[lastLabel] = updatedTarget;
          } else if (parentContainer.type === 'array') {
            parentContainer.items = parentContainer.items || { type: 'object', properties: {} } as any;
            parentContainer.items.properties = parentContainer.items.properties || {};
            parentContainer.items.properties[lastLabel] = updatedTarget;
          }
        } else {
          // As a last resort, add to root
          emittedSchema = addPropertyToSchema(baseSchema as Record<string, unknown>);
        }
      }
      if (!emittedSchema) emittedSchema = baseSchema;
    }

    // Do not emit the schema immediately here. Wait for the user to finish
    // editing the new property's name so the final key in the schema matches
    // the user-provided label. The NodePropertyEditor will emit the
    // authoritative schema after the rename via handleNodePropertyChange.

    // Rebuild graph from emitted schema
    const rawRebuilt = schemaToGraph(emittedSchema as Record<string, unknown>);
    const rebuiltNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges);
    const rebuiltEdges = rawRebuilt.edges as Edge[];
    setNodes(rebuiltNodes);
    setEdges(rebuiltEdges);

    // Compute added key by diffing previous and new properties at the target location
    const prevProps = getSchemaAtPath(prevSchema, path)?.properties || ((prevSchema.properties as Record<string, unknown>) || {});
    const newProps = getSchemaAtPath(emittedSchema, path)?.properties || ((emittedSchema.properties as Record<string, unknown>) || {});
    const addedKey = Object.keys(newProps).find(k => !(k in prevProps)) || `newProperty${Object.keys(prevProps).length + 1}`;

    // Prefer selecting the deterministic id for the new node
    const newId = makeId(parentNode.id, addedKey);
    const newNode = rebuiltNodes.find(n => n.id === newId || (n.data && n.data.label === addedKey));
    if (newNode) setSelectedNodeId(newNode.id);
    setContextMenu(null);
  };

  // Add Pattern Property action
  const handleAddPatternProperty = () => {
    const parentNode = nodes.find(n => n.id === contextMenu?.nodeId);
    if (!parentNode) {
      setContextMenu(null);
      return;
    }

    // Build authoritative base schema from current graph and keep a snapshot
    const baseSchema = buildSchemaFromNodes(nodes);
    const prevSchema = JSON.parse(JSON.stringify(baseSchema));

    // Helper: collect labels from root -> target node
    const collectPath = (n: Node<SchemaNodeData> | undefined) => {
      const labels: string[] = [];
      let cur = n;
      while (cur && cur.id !== '1') {
        if (cur.data && cur.data.label) labels.unshift(cur.data.label);
        cur = nodes.find(x => x.id === cur?.data?.parent);
      }
      return labels;
    };

    const path = collectPath(parentNode);

    const getSchemaAtPath = (schema: any, pathArr: string[]) => {
      let cur: any = schema;
      for (const lbl of pathArr) {
        if (!cur) return null;
        if (cur.type === 'object') {
          cur = (cur.properties || {})[lbl];
        } else if (cur.type === 'array') {
          // dive into items
          cur = (cur.items && cur.items.type === 'object') ? ((cur.items.properties || {})[lbl]) : undefined;
        } else {
          cur = undefined;
        }
      }
      return cur;
    };

    // Find the target schema object where we'll add a patternProperty
    const targetSchema = getSchemaAtPath(baseSchema, path);

    let emittedSchema: Record<string, unknown> | null = null;

    if (!targetSchema) {
      // Fallback: add to root
      emittedSchema = addPatternPropertyToSchema(baseSchema as Record<string, unknown>);
    } else {
      // Add a pattern property to the target schema object (object or items)
      const updatedTarget = addPatternPropertyToSchema(targetSchema as Record<string, unknown>);
      // Integrate updatedTarget back into baseSchema at the correct location
      if (path.length === 1) {
        // Direct child of root
        if (!baseSchema.properties) baseSchema.properties = {};
        (baseSchema.properties as Record<string, unknown>)[path[0]] = updatedTarget;
      } else {
        const parentPath = path.slice(0, -1);
        const lastLabel = path[path.length - 1];
        const parentContainer = getSchemaAtPath(baseSchema, parentPath);
        if (parentContainer) {
          if (parentContainer.type === 'object') {
            if (!parentContainer.properties) parentContainer.properties = {};
            parentContainer.properties[lastLabel] = updatedTarget;
          } else if (parentContainer.type === 'array') {
            parentContainer.items = parentContainer.items || { type: 'object', properties: {} } as any;
            parentContainer.items.properties = parentContainer.items.properties || {};
            parentContainer.items.properties[lastLabel] = updatedTarget;
          }
        } else {
          // As a last resort, add to root
          emittedSchema = addPatternPropertyToSchema(baseSchema as Record<string, unknown>);
        }
      }
      if (!emittedSchema) emittedSchema = baseSchema;
    }

    // Rebuild graph from emitted schema
    const rawRebuilt = schemaToGraph(emittedSchema as Record<string, unknown>);
    const rebuiltNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges);
    const rebuiltEdges = rawRebuilt.edges as Edge[];
    setNodes(rebuiltNodes);
    setEdges(rebuiltEdges);

    // Compute added pattern key by diffing previous and new patternProperties at the target location
    const prevPattern = getSchemaAtPath(prevSchema, path)?.patternProperties || {};
    const newPattern = getSchemaAtPath(emittedSchema, path)?.patternProperties || {};
    const addedKey = Object.keys(newPattern).find(k => !(k in prevPattern));
    const addedLabel = addedKey ? `pattern: ${addedKey}` : undefined;

    // Prefer selecting the deterministic id for the new node
    const newId = addedLabel ? makeId(parentNode.id, addedLabel) : undefined;
    const newNode = (newId && rebuiltNodes.find(n => n.id === newId)) || (addedLabel && rebuiltNodes.find(n => n.data && n.data.label === addedLabel));
    if (newNode) setSelectedNodeId(newNode.id);
    setContextMenu(null);
  };

  // Create a local override for an imported/ref'd node by adding a `username` property
  const handleCreateLocalOverride = () => {
    const parentNode = nodes.find(n => n.id === contextMenu?.nodeId);
    if (!parentNode) {
      setContextMenu(null);
      return;
    }

    // Build authoritative base schema from current graph
    const baseSchema = buildSchemaFromNodes(nodes);

    // Helper: collect labels from root -> target node
    const collectPath = (n: Node<SchemaNodeData> | undefined) => {
      const labels: string[] = [];
      let cur = n;
      while (cur && cur.id !== '1') {
        if (cur.data && cur.data.label) labels.unshift(cur.data.label);
        cur = nodes.find(x => x.id === cur?.data?.parent);
      }
      return labels;
    };

    const path = collectPath(parentNode);

    const getSchemaAtPath = (schema: any, pathArr: string[]) => {
      let cur: any = schema;
      for (const lbl of pathArr) {
        if (!cur) return null;
        if (cur.type === 'object') {
          cur = (cur.properties || {})[lbl];
        } else if (cur.type === 'array') {
          // if items is object, descend into its properties
          if (cur.items && cur.items.type === 'object') cur = (cur.items.properties || {})[lbl];
          else cur = null;
        } else {
          cur = null;
        }
      }
      return cur;
    };

    const targetSchema = getSchemaAtPath(baseSchema, path);
    if (!targetSchema) {
      // nothing to override
      setContextMenu(null);
      return;
    }

    // If username already exists, just close
    const existing = (targetSchema.properties || {})['username'];
    if (existing) {
      setContextMenu(null);
      return;
    }

    // Determine original $ref from the source prop at this path so we can build an allOf override
    const getSourceAtPath = (src: any, pathArr: string[]) => {
      let cur = src;
      for (const lbl of pathArr) {
        if (!cur) return null;
        if (cur.type === 'object') {
          cur = (cur.properties || {})[lbl];
        } else if (cur.type === 'array') {
          if (cur.items && cur.items.type === 'object') cur = (cur.items.properties || {})[lbl];
          else cur = null;
        } else {
          cur = null;
        }
      }
      return cur;
    };

    const originalAtPath = getSourceAtPath(schema, path);
    const refStr = originalAtPath && typeof originalAtPath === 'object' && typeof originalAtPath.$ref === 'string' ? originalAtPath.$ref : null;

    // Build override: prefer allOf [$ref, { properties: { username: { type: 'string' } } }]
    const overrideNode = refStr
      ? { allOf: [{ $ref: refStr }, { type: 'object', properties: { username: { type: 'string' } } }] }
      : { ...(targetSchema as Record<string, unknown>), properties: { ...(targetSchema.properties || {}), username: { type: 'string' } } } as Record<string, unknown>;

    // Integrate overrideNode back into baseSchema at the correct location
    if (path.length === 1) {
      if (!baseSchema.properties) baseSchema.properties = {};
      (baseSchema.properties as Record<string, unknown>)[path[0]] = overrideNode;
    } else {
      const parentPath = path.slice(0, -1);
      const lastLabel = path[path.length - 1];
      const parentContainer = getSchemaAtPath(baseSchema, parentPath);
      if (parentContainer) {
        if (parentContainer.type === 'object') {
          if (!parentContainer.properties) parentContainer.properties = {};
          (parentContainer.properties as Record<string, unknown>)[lastLabel] = overrideNode;
        } else if (parentContainer.type === 'array') {
          if (!parentContainer.items) parentContainer.items = { type: 'object', properties: {} } as any;
          if ((parentContainer.items as any).type === 'object') {
            if (!(parentContainer.items as any).properties) (parentContainer.items as any).properties = {};
            (parentContainer.items as any).properties[lastLabel] = overrideNode;
          }
        }
      } else {
        // fallback: attach at root
        if (!baseSchema.properties) baseSchema.properties = {};
        (baseSchema.properties as Record<string, unknown>)[path[path.length - 1]] = overrideNode;
      }
    }

    // Emit the edited resolved schema so reducer will rehydrate into source
    skipSchemaSyncRef.current = true;
    onChange(baseSchema);

    // Rebuild graph from emitted schema and select the new node if present
    const rawRebuilt = schemaToGraph(baseSchema as Record<string, unknown>);
    const rebuiltNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges);
    const rebuiltEdges = rawRebuilt.edges as Edge[];
    setNodes(rebuiltNodes);
    setEdges(rebuiltEdges);

    const newId = makeId(parentNode.id, 'username');
    const newNode = rebuiltNodes.find(n => n.id === newId || (n.data && n.data.label === 'username'));
    if (newNode) setSelectedNodeId(newNode.id);

    setContextMenu(null);
  };

  // Delete Property action (with confirmation)
  const handleDeleteProperty = () => {
    if (!contextMenu?.nodeId) return;
    const node = nodes.find(n => n.id === contextMenu.nodeId);
    if (!node) return;
    if (window.confirm('Are you sure you want to delete this property?')) {
      // Remove node from graph and update parent if needed
      setNodes((nds: Node<SchemaNodeData>[]) =>
        nds
          .filter((n: Node<SchemaNodeData>) => n.id !== contextMenu.nodeId)
          .map((n: Node<SchemaNodeData>) => {
            // If this node is a parent, remove property from its properties
            interface NodeWithProperties extends Node<SchemaNodeData> {
              data: SchemaNodeData & { properties?: Record<string, unknown> };
            }
            if (
              n.data.type === 'object' &&
              (n as NodeWithProperties).data.properties &&
              contextMenu.nodeId !== null &&
              (n as NodeWithProperties).data.properties?.[contextMenu.nodeId]
            ) {
              const updatedData: Record<string, unknown> = removePropertyFromSchema(
                n.data as unknown as Record<string, unknown>,
                contextMenu.nodeId
              );
              // Merge updatedData into n.data, preserving SchemaNodeData shape
              return {
                ...n,
                data: {
                  ...n.data,
                  ...updatedData,
                  id: n.data.id,
                  label: n.data.label,
                  type: n.data.type,
                } as SchemaNodeData,
              };
            }
            return n;
          })
      );
      setEdges((eds: Edge[]) => eds.filter((e: Edge) => e.target !== contextMenu.nodeId && e.source !== contextMenu.nodeId));
    }
    setContextMenu(null);
  };

  // Context menu items; only include override when node is imported
  const contextMenuItems = (() => {
    const items: any[] = [];
    items.push({
      label: 'Add Property',
      onClick: handleAddProperty,
      disabled: (() => {
        const node = nodes.find(n => n.id === contextMenu?.nodeId);
        if (!node) return true;
        if (!(node.data.type === 'object' || (node.data.type === 'array' && node.data.ofType === 'object'))) return true;
        // Inspect the provided `schema` prop (authoritative source) to find the target schema
        try {
          if (schema) {
            const collectPath = (n: Node<SchemaNodeData> | undefined) => {
              const labels: string[] = [];
              let cur = n;
              while (cur && cur.id !== '1') {
                if (cur.data && cur.data.label) labels.unshift(cur.data.label);
                cur = nodes.find(x => x.id === cur?.data?.parent);
              }
              return labels;
            };
            const path = collectPath(node);
            const getSchemaAtPath = (rootSchema: any, pathArr: string[]) => {
              let cur: any = rootSchema;
              for (const lbl of pathArr) {
                if (!cur) return null;
                if (cur.type === 'object') {
                  cur = (cur.properties || {})[lbl];
                } else if (cur.type === 'array') {
                  cur = (cur.items && cur.items.type === 'object') ? ((cur.items.properties || {})[lbl]) : undefined;
                } else {
                  cur = undefined;
                }
              }
              return cur;
            };
            const target = getSchemaAtPath(schema, path);
            if (target && target.additionalProperties === false) {
              const pp = target.patternProperties || {};
              if (!pp || Object.keys(pp).length === 0) return true; // block adding ad-hoc properties when additionalProperties:false and no patternProperties
            }
          }
        } catch (e) {
          // conservative fallback: allow add
        }
        return false;
      })(),
    });

    // Only show Create Local Override for imported nodes
    const selNode = nodes.find(n => n.id === contextMenu?.nodeId);
    const canShowOverride = !!selNode && !!selNode.data.imported && (selNode.data.type === 'object' || (selNode.data.type === 'array' && selNode.data.ofType === 'object'));
    if (canShowOverride) {
      items.push({
        label: 'Create Local Override',
        onClick: handleCreateLocalOverride,
        disabled: false,
      });
    }

    items.push({
      label: 'Add Pattern Property',
      onClick: handleAddPatternProperty,
      disabled: (() => {
        const node = nodes.find(n => n.id === contextMenu?.nodeId);
        return !node || !(node.data.type === 'object' || (node.data.type === 'array' && node.data.ofType === 'object'));
      })(),
    });

    items.push({
      label: 'Delete Property',
      onClick: handleDeleteProperty,
      disabled: false,
    });
    return items;
  })();

  return (
    <div className={styles.graphicalEditorContainer}>
      <ReactFlowProvider>
        <div ref={flowWrapperRef} style={{ width: '100%' }}>
          <ReactFlow
          nodes={nodes}
          edges={edges.map(e => ({ ...e, style: { stroke: '#00e676', strokeWidth: 3 } }))}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView={true}
          onNodeClick={handleNodeClick}
          onNodeContextMenu={handleNodeContextMenu}
        >
          {/* <MiniMap /> */}
          <Controls />
          <Background />
          </ReactFlow>
        </div>
      </ReactFlowProvider>
      <div className={styles.editorSidebar}>
        {/* Always show NodePropertyEditor for selected node, including enum node */}
        <MemoizedNodePropertyEditor node={selectedNode} onChange={handleNodePropertyChange} />
      </div>
      {contextMenu?.visible && (
        <ContextMenu
          items={contextMenuItems}
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}


