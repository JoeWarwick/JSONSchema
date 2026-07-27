import React from 'react';
import { validateValueAgainstSchema } from "../utils/validation";
import styles from "./graphical-schema-editor.module.css";
import type { NodeData, NodePropertyEditorProps } from './types';

export const NodePropertyEditor: React.FC<NodePropertyEditorProps> = (props) => {
  if (!props.node) return <div style={{ color: '#888', fontStyle: 'italic' }}>Select a node to edit its properties.</div>;
  return <NodePropertyEditorBody node={props.node} onChange={props.onChange} />;
};

const NodePropertyEditorBody: React.FC<NodePropertyEditorProps> = ({ node, onChange }) => {
  const data = node?.data ?? {};
  const getEffectiveAdditionalProperties = (): unknown => {
    if ((data as any).additionalProperties !== undefined) return (data as any).additionalProperties;
    const variantSchema = (data as any).variantSchema;
    if (variantSchema && typeof variantSchema === 'object' && !Array.isArray(variantSchema)) {
      return (variantSchema as any).additionalProperties;
    }
    return undefined;
  };
  const deriveAdditionalPropertiesMode = (value: unknown, isAdditionalPropertiesNode: boolean): 'false' | 'true' | 'schema' => {
    if (value === false) return 'false';
    if (value === true) return 'true';
    if (value && typeof value === 'object' && !Array.isArray(value)) return 'schema';
    return isAdditionalPropertiesNode ? 'false' : 'true';
  };
  const isNonDefaultSchemaObject = (value: unknown): value is Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.keys(value as Record<string, unknown>).length > 0;
  };
  const [label, setLabel] = React.useState<string>(data.label || '');
  const formRef = React.useRef<HTMLFormElement | null>(null);
  const nameInputRef = React.useRef<HTMLInputElement>(null);
  const [type, setType] = React.useState<string>(data.type && !Array.isArray(data.type) ? data.type : (Array.isArray((data as any).type) ? (data as any).type[0] : (Array.isArray((data as any).typeUnion) ? (data as any).typeUnion[0] : '')));
  const [typesArray, setTypesArray] = React.useState<string[] | undefined>(Array.isArray((data as any).type) ? [...(data as any).type] : (Array.isArray((data as any).typeUnion) ? [...(data as any).typeUnion] : undefined));
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
  ];
  // Root node is always required
  const isRoot = node?.id === '1';
  const [required, setRequired] = React.useState<boolean>(isRoot ? true : !!data.required);
  const enumValues: string[] = Array.isArray(data.enum) ? data.enum : [];
  const isEnum: boolean = Array.isArray(data.enum);
  const [defaultValue, setDefaultValue] = React.useState<string>(data.default ?? '');
  const [defaultError, setDefaultError] = React.useState<string | null>(null);
  const [pattern, setPattern] = React.useState<string | undefined>(data.pattern);
  const [format, setFormat] = React.useState<string | undefined>(data.format);
  const [contentMediaType, setContentMediaType] = React.useState<string | undefined>(data.contentMediaType);
  const [contentEncoding, setContentEncoding] = React.useState<string | undefined>(data.contentEncoding);
  const [description, setDescription] = React.useState<string | undefined>(data.description);
  const [comment, setComment] = React.useState<string | undefined>((data as any).$comment);
  const [minimum, setMinimum] = React.useState<number | undefined>(data.minimum);
  const [maximum, setMaximum] = React.useState<number | undefined>(data.maximum);
  const [examples, setExamples] = React.useState<string | undefined>(Array.isArray(data.examples) ? (data.examples as any[]).join(', ') : undefined);
  const [minLength, setMinLength] = React.useState<number | undefined>(data.minLength);
  const [maxLength, setMaxLength] = React.useState<number | undefined>(data.maxLength);
  const [multipleOf, setMultipleOf] = React.useState<number | undefined>(data.multipleOf);
  const [uniqueItems, setUniqueItems] = React.useState<boolean | undefined>(data.uniqueItems);
  const [minItems, setMinItems] = React.useState<number | undefined>(data.minItems);
  const [maxItems, setMaxItems] = React.useState<number | undefined>(data.maxItems);
  const [minProperties, setMinProperties] = React.useState<number | undefined>(data.minProperties);
  const [maxProperties, setMaxProperties] = React.useState<number | undefined>(data.maxProperties);
  const [readOnlyFlag, setReadOnlyFlag] = React.useState<boolean | undefined>(data.readOnly);
  const [deprecatedFlag, setDeprecatedFlag] = React.useState<boolean | undefined>(data.deprecated);
  const [additionalPropertiesMode, setAdditionalPropertiesMode] = React.useState<'false' | 'true' | 'schema'>(
    deriveAdditionalPropertiesMode(getEffectiveAdditionalProperties(), Boolean((data as any).isAdditionalProperties))
  );
  const rememberedAdditionalPropertiesSchemaRef = React.useRef<Record<string, unknown> | null>(null);
  // validation errors
  const [minMaxLengthError, setMinMaxLengthError] = React.useState<string | null>(null);
  const [minMaxItemsError, setMinMaxItemsError] = React.useState<string | null>(null);
  const [minMaxPropertiesError, setMinMaxPropertiesError] = React.useState<string | null>(null);
  const [multipleOfError, setMultipleOfError] = React.useState<string | null>(null);
  const hasNumberType = type === 'number' || Boolean(Array.isArray(typesArray) && typesArray.includes('number'));

  React.useEffect(() => {
    const effectiveAdditionalProperties = getEffectiveAdditionalProperties();
    if (isNonDefaultSchemaObject(effectiveAdditionalProperties)) {
      rememberedAdditionalPropertiesSchemaRef.current = { ...effectiveAdditionalProperties };
    }
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
    setMinProperties(data.minProperties);
    setMaxProperties(data.maxProperties);
    setReadOnlyFlag(data.readOnly);
    setDeprecatedFlag(data.deprecated);
    setAdditionalPropertiesMode(
      deriveAdditionalPropertiesMode(effectiveAdditionalProperties, Boolean((data as any).isAdditionalProperties))
    );
    setContentMediaType(data.contentMediaType);
    setContentEncoding(data.contentEncoding);
    setMinMaxLengthError(null);
    setMinMaxItemsError(null);
    setMinMaxPropertiesError(null);
    setMultipleOfError(null);
    // Keep patternKey in sync with selected node so RHS always shows authoritative regex
    setPatternKeyState(data.patternKey);
    setPatternKeyError(null);
    setComment(data.$comment);
    setDescription(data.description);
    // Preserve raw types array if present so we can support multi-type editing (also respect typeUnion)
    setTypesArray(Array.isArray(data.type) ? [...data.type] : (Array.isArray(data.typeUnion) ? [...data.typeUnion] : undefined));
    // Ensure primary type state aligns with the first declared type (or single type)
    setType(Array.isArray(data.type) ? data.type[0] : (Array.isArray(data.typeUnion) ? data.typeUnion[0] : (data.type || '')));

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

  React.useEffect(() => {
    setMinProperties(data.minProperties);
    setMaxProperties(data.maxProperties);
    setMinMaxPropertiesError(null);
  }, [node?.id, data.minProperties, data.maxProperties]);

  // Helper to build patch for onChange
  const buildPatch = (override?: Partial<NodeData>) => {
    let patch: Partial<NodeData> = { id: node!.id, label, type, required, ...override };
    const prevTypeRaw = data.type;
    const newTypeRaw = override?.type ?? type;
    const prevType = Array.isArray(prevTypeRaw) ? prevTypeRaw[0] : prevTypeRaw;
    const newType = Array.isArray(newTypeRaw) ? newTypeRaw[0] : newTypeRaw;
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
      const items: Record<string, unknown> = { type: 'string' };
      if (data.enum) {
        items.enum = data.enum;
      }
      const rest = { ...data };
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
    // Support $comment annotation
    if (override && Object.prototype.hasOwnProperty.call(override, '$comment')) base.$comment = (override as any)['$comment'];
    else base.$comment = (override as any)?.['$comment'] ?? comment;
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
    // contentEncoding
    if (override && Object.prototype.hasOwnProperty.call(override, 'contentEncoding')) base.contentEncoding = override.contentEncoding;
    else base.contentEncoding = override?.contentEncoding ?? contentEncoding;
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
    if (override && Object.prototype.hasOwnProperty.call(override, 'minProperties')) base.minProperties = override.minProperties;
    else base.minProperties = override?.minProperties ?? minProperties;
    if (override && Object.prototype.hasOwnProperty.call(override, 'maxProperties')) base.maxProperties = override.maxProperties;
    else base.maxProperties = override?.maxProperties ?? maxProperties;
    // metadata flags
    if (override && Object.prototype.hasOwnProperty.call(override, 'readOnly')) base.readOnly = override.readOnly;
    else base.readOnly = override?.readOnly ?? readOnlyFlag;
    if (override && Object.prototype.hasOwnProperty.call(override, 'deprecated')) base.deprecated = override.deprecated;
    else base.deprecated = override?.deprecated ?? deprecatedFlag;
    // support additionalProperties
    if (override && Object.prototype.hasOwnProperty.call(override, 'additionalProperties')) (base as any).additionalProperties = override.additionalProperties;
    else (base as any).additionalProperties = (data as any).additionalProperties;
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

  const availableTypes = isRoot ? jsonTypes.filter(t => t.value === 'object' || t.value === 'array') : jsonTypes;

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
                // Invalid regex: set local validation error and do NOT emit schema changes (avoid rebuilding nodes/clearing local error)
                setPatternKeyError('Invalid regular expression');
                // do not call onChange here — preserve the authoritative schema until the user enters a valid regex
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
          {patternKeyError && <div className={styles.patternKeyHelper}>Pattern not saved until valid</div>}
        </div>
      )}

      <>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 8 }}>Description</div>
          <textarea
            value={description ?? ''}
            onChange={e => setDescription(e.target.value)}
            onBlur={() => onChange(buildPatchWithAnnotations({ description }))}
            placeholder="Add a description"
            aria-label="Description"
            style={{ width: '100%', marginTop: 6, padding: 6, borderRadius: 6, border: '1px solid #ccc', minHeight: 64 }}
          />
        </div>

      </>

      <div>
        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 8 }}>Types</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }} aria-label="Types">
          {availableTypes.map(t => {
            const checked = typesArray ? typesArray.includes(t.value) : (type === t.value);
            const disabled = isRoot && (t.value !== 'object' && t.value !== 'array');
            return (
              <label key={t.value} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  aria-label={`Type: ${t.value}`}
                  checked={checked}
                  disabled={disabled}
                  onChange={e => {
                    // Toggle type selection
                    const cur = typesArray ? [...typesArray] : (type ? [type] : []);
                    let next: string[];
                    if (e.target.checked) {
                      if (!cur.includes(t.value)) next = [...cur, t.value];
                      else next = cur;
                    } else {
                      next = cur.filter(x => x !== t.value);
                    }
                    setTypesArray(next.length ? next : undefined);
                    setType(next[0] || '');
                    const emittedType = next.length === 1 ? next[0] : (next.length === 0 ? '' : next);
                    onChange(buildPatchWithAnnotations({ type: emittedType }));
                  }}
                />
                <span style={{ fontSize: 13 }}>{t.label}</span>
              </label>
            );
          })}
        </div>
      </div>
      {( (type === 'array') || (Array.isArray(typesArray) && typesArray.includes('array')) ) && (
        <div>
          <select value={ofType} onChange={handleOfTypeChange} style={{ width: '100%', marginTop: 2, padding: 4, borderRadius: 4, border: '1px solid #ccc' }} aria-label="Of Type">
            <option value="">Select type</option>
            {jsonTypes.filter(t => t.value !== 'array').map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      )}
      {type === 'object' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, minWidth: 130 }}>additionalProperties</span>
            <select
              aria-label="additionalProperties"
              value={additionalPropertiesMode}
              onChange={e => {
                const nextMode = e.target.value as 'false' | 'true' | 'schema';
                setAdditionalPropertiesMode(nextMode);
                const currentVariantSchema = ((data as any).variantSchema && typeof (data as any).variantSchema === 'object' && !Array.isArray((data as any).variantSchema))
                  ? ({ ...(data as any).variantSchema } as Record<string, unknown>)
                  : null;
                const currentAdditionalProperties = getEffectiveAdditionalProperties();
                if (isNonDefaultSchemaObject(currentAdditionalProperties)) {
                  rememberedAdditionalPropertiesSchemaRef.current = { ...currentAdditionalProperties };
                }
                const emitAdditionalProperties = (nextAdditionalProperties: unknown) => {
                  const patch: Partial<NodeData> = { additionalProperties: nextAdditionalProperties };
                  if (currentVariantSchema) {
                    patch.variantSchema = { ...currentVariantSchema, additionalProperties: nextAdditionalProperties };
                  }
                  onChange(buildPatchWithAnnotations(patch));
                };
                if (nextMode === 'false') {
                  emitAdditionalProperties(false);
                  return;
                }
                if (nextMode === 'true') {
                  emitAdditionalProperties(true);
                  return;
                }
                const remembered = rememberedAdditionalPropertiesSchemaRef.current;
                emitAdditionalProperties(remembered ? { ...remembered } : {});
              }}
              style={{ width: '100%', marginTop: 2, padding: 4, borderRadius: 4, border: '1px solid #ccc' }}
            >
              <option value="false">false</option>
              <option value="true">true</option>
              <option value="schema">Schema</option>
            </select>
          </label>
          {comment === undefined ? (
            <button type="button" onClick={() => { setComment(''); onChange(buildPatchWithAnnotations({ $comment: '' })); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6, width: 'fit-content' }}>+ Comment</button>
          ) : (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginTop: 8 }}>Comment</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                <input
                  value={comment ?? ''}
                  onChange={e => setComment(e.target.value)}
                  onBlur={() => onChange(buildPatchWithAnnotations({ $comment: comment }))}
                  placeholder="Internal comment for editors"
                  aria-label="Comment ($comment)"
                  style={{ flex: 1, padding: 4, borderRadius: 4, border: '1px solid #ccc' }}
                />
                <button type="button" onClick={() => { setComment(undefined); onChange(buildPatchWithAnnotations({ $comment: undefined })); }} className={styles.removeControl} title="Remove comment">×</button>
              </div>
            </div>
          )}

          <div style={{ borderTop: '1px dashed #eee', paddingTop: 10, marginTop: 4 }}>
            <div style={{ marginTop: 0, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {minProperties === undefined ? (
                <button type="button" onClick={() => { setMinProperties(0); onChange(buildPatchWithAnnotations({ minProperties: 0 } as any)); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6 }}>+ Min Properties</button>
              ) : (
                <label className={styles.facetCompactField}>
                  <span className={styles.facetCompactTitle}>Min Properties</span>
                  <input
                    className={`${styles.numberInput} ${styles.facetCompactInput}`}
                    aria-label="Min Properties"
                    type="number"
                    min={0}
                    value={(minProperties ?? '') as any}
                    onWheel={(e) => {
                      e.preventDefault();
                      const dir = e.deltaY > 0 ? -1 : 1;
                      const mult = e.shiftKey ? 10 : 1;
                      const cur = typeof minProperties === 'number' ? minProperties : 0;
                      const newVal = Math.max(0, cur + dir * mult);
                      setMinProperties(newVal);
                      onChange(buildPatchWithAnnotations({ minProperties: newVal } as any));
                    }}
                    onChange={e => setMinProperties(e.target.value === '' ? undefined : Number(e.target.value))}
                    onBlur={() => {
                      if (minProperties !== undefined && minProperties < 0) {
                        setMinMaxPropertiesError('minProperties must be >= 0');
                      } else if (maxProperties !== undefined && minProperties !== undefined && maxProperties < minProperties) {
                        setMinMaxPropertiesError('maxProperties must be >= minProperties');
                      } else {
                        setMinMaxPropertiesError(null);
                        onChange(buildPatchWithAnnotations({ minProperties } as any));
                      }
                    }}
                  />
                  <button type="button" onClick={() => { setMinProperties(undefined); onChange(buildPatchWithAnnotations({ minProperties: undefined } as any)); }} className={styles.removeControl} title="Remove minProperties">×</button>
                </label>
              )}

              {maxProperties === undefined ? (
                <button type="button" onClick={() => { setMaxProperties(0); onChange(buildPatchWithAnnotations({ maxProperties: 0 } as any)); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6 }}>+ Max Properties</button>
              ) : (
                <label className={styles.facetCompactField}>
                  <span className={styles.facetCompactTitle}>Max Properties</span>
                  <input
                    className={`${styles.numberInput} ${styles.facetCompactInput}`}
                    aria-label="Max Properties"
                    type="number"
                    min={0}
                    value={(maxProperties ?? '') as any}
                    onWheel={(e) => {
                      e.preventDefault();
                      const dir = e.deltaY > 0 ? -1 : 1;
                      const mult = e.shiftKey ? 10 : 1;
                      const cur = typeof maxProperties === 'number' ? maxProperties : 0;
                      const newVal = Math.max(0, cur + dir * mult);
                      setMaxProperties(newVal);
                      onChange(buildPatchWithAnnotations({ maxProperties: newVal } as any));
                    }}
                    onChange={e => setMaxProperties(e.target.value === '' ? undefined : Number(e.target.value))}
                    onBlur={() => {
                      if (maxProperties !== undefined && maxProperties < 0) {
                        setMinMaxPropertiesError('maxProperties must be >= 0');
                      } else if (minProperties !== undefined && maxProperties !== undefined && maxProperties < minProperties) {
                        setMinMaxPropertiesError('maxProperties must be >= minProperties');
                      } else {
                        setMinMaxPropertiesError(null);
                        onChange(buildPatchWithAnnotations({ maxProperties } as any));
                      }
                    }}
                  />
                  <button type="button" onClick={() => { setMaxProperties(undefined); onChange(buildPatchWithAnnotations({ maxProperties: undefined } as any)); }} className={styles.removeControl} title="Remove maxProperties">×</button>
                </label>
              )}
            </div>
            {minMaxPropertiesError && <div style={{ color: '#e53935', fontSize: 12, marginTop: 6 }}>{minMaxPropertiesError}</div>}
          </div>
        </div>
      )}
      {Object.prototype.hasOwnProperty.call(data, 'required') && !isRoot && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={required} onChange={handleRequiredChange} aria-label="Required" /> Required
        </label>
      )}
      {!isRoot && type !== 'object' && (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={isEnum} onChange={handleIsEnumChange} data-testid="enum-checkbox" aria-label="Enum" /> Enum
          </label>
          {isEnum && (
            <div>
              <div data-testid="enum-values-label" style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Enum Values</div>
              <ul style={{ padding: 0, margin: '4px 0 8px 0', listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                {enumValues.length === 0 ? (
                  <li style={{ color: '#888', fontStyle: 'italic', fontSize: 13 }}>No enum values yet.</li>
                ) : (
                  enumValues.map((v: string, i: number) => (
                    <li key={i} style={{ display: 'inline-flex', alignItems: 'center' }}>
                      <span style={{ background: '#fffde7', border: '1px solid #ffe082', borderRadius: 6, padding: '2px 8px', fontSize: 13, marginRight: 4 }}>{v}</span>
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
        </>
      )}
      {/* Image preview only (no upload) for schema editor; instance form handles uploads */}
      {((format === 'data-url') || (contentMediaType && String(contentMediaType).startsWith('image'))) && defaultValue && typeof defaultValue === 'string' && /^data:image\//i.test(defaultValue) && (
        <div style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <img src={defaultValue} alt="preview" style={{ maxWidth: 240, maxHeight: 160, border: '1px solid #ddd', borderRadius: 6 }} />
          </div>
        </div>
      )}
      {!(type === 'boolean' || type === 'object' || type === 'null') && (
        <div style={{ borderTop: '1px dashed #eee', paddingTop: 10 }}>
        {type !== 'array' && !isEnum && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            {pattern === undefined ? (
              <button type="button" onClick={() => { setPattern(''); onChange(buildPatchWithAnnotations({ pattern: '' })); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6 }}>+ Pattern</button>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                <label className={styles.facetCompactField}>
                  <span className={styles.facetCompactTitle}>Pattern</span>
                  <input className={`${styles.smallInput} ${styles.facetCompactControl}`} value={pattern ?? ''} onChange={e => setPattern(e.target.value)} onBlur={() => onChange(buildPatchWithAnnotations({ pattern }))} placeholder="RegExp pattern" aria-label="Pattern" />
                </label>
                <button type="button" onClick={() => { setPattern(undefined); onChange(buildPatchWithAnnotations({ pattern: undefined })); }} className={styles.removeControl} title="Remove pattern">×</button>
              </div>
            )}
            {format === undefined ? (
              <button type="button" onClick={() => { setFormat(''); onChange(buildPatchWithAnnotations({ format: '' })); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6 }}>+ Format</button>
            ) : (
              <div style={{ width: 150, display: 'flex', alignItems: 'center', gap: 8 }}>
                <label className={styles.facetCompactField}>
                  <span className={styles.facetCompactTitle}>Format</span>
                  <select className={styles.facetCompactControl} value={format ?? ''} onChange={e => { setFormat(e.target.value || undefined); onChange(buildPatchWithAnnotations({ format: e.target.value || undefined })); }} style={{ flex: 1, marginTop: 2, padding: 6, borderRadius: 4, border: '1px solid #ccc' }}>
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
                </label>
                <button type="button" onClick={() => { setFormat(undefined); onChange(buildPatchWithAnnotations({ format: undefined })); }} className={styles.removeControl} title="Remove format">×</button>
              </div>
            )}
            {contentMediaType === undefined ? (
               <button type="button" onClick={() => { setContentMediaType(''); onChange(buildPatchWithAnnotations({ contentMediaType: '' })); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6 }}>+ MediaType</button>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 200 }}>
                <label className={styles.facetCompactField} style={{ flex: 1 }}>
                  <span className={styles.facetCompactTitle}>MediaType</span>
                  <select 
                    className={`${styles.facetCompactControl}`} 
                    value={contentMediaType ?? ''} 
                    onChange={e => {
                      const val = e.target.value;
                      setContentMediaType(val);
                      onChange(buildPatchWithAnnotations({ contentMediaType: val }));
                    }}
                    style={{ width: '100%', marginTop: 2, padding: 6, borderRadius: 4, border: '1px solid #ccc', background: 'white', color: '#222' }}
                    aria-label="Media Type"
                  >
                    <option value="">-Select-</option>
                    <option value="text/html">text/html</option>
                    <option value="text/css">text/css</option>
                    <option value="text/javascript">text/javascript</option>
                    <option value="text/markdown">text/markdown</option>
                    <option value="application/json">application/json</option>
                    <option value="application/xml">application/xml</option>
                    <option value="image/svg+xml">image/svg+xml</option>
                    <option value="image/png">image/png</option>
                    <option value="image/jpeg">image/jpeg</option>
                  </select>
                </label>
                <button type="button" onClick={() => { setContentMediaType(undefined); onChange(buildPatchWithAnnotations({ contentMediaType: undefined })); }} className={styles.removeControl} title="Remove media type">×</button>
              </div>
            )}
            <div style={{ width: '100%', display: 'flex', alignItems: 'center', marginTop: 4 }}>
              {contentEncoding === undefined ? (
                 <button type="button" onClick={() => { setContentEncoding(''); onChange(buildPatchWithAnnotations({ contentEncoding: '' })); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6 }}>+ Encoding</button>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 150 }}>
                  <label className={styles.facetCompactField} style={{ flex: 1 }}>
                    <span className={styles.facetCompactTitle}>Encoding</span>
                    <input 
                      className={`${styles.smallInput} ${styles.facetCompactControl}`} 
                      value={contentEncoding ?? ''} 
                      onChange={e => setContentEncoding(e.target.value)} 
                      onBlur={() => onChange(buildPatchWithAnnotations({ contentEncoding }))} 
                      onFocus={(e) => e.target.select()} 
                      placeholder="e.g. base64" 
                      aria-label="Encoding" 
                      style={{ width: '100%', flex: 1, background: 'white', color: '#222' }}
                    />
                  </label>
                  <button type="button" onClick={() => { setContentEncoding(undefined); onChange(buildPatchWithAnnotations({ contentEncoding: undefined })); }} className={styles.removeControl} title="Remove encoding">×</button>
                </div>
              )}
            </div>
          </div>
        )}
        {type === 'number' && !isEnum && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {minimum === undefined ? (
              <button type="button" onClick={() => { setMinimum(0); onChange(buildPatchWithAnnotations({ minimum: 0 })); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6 }}>+ Minimum</button>
            ) : (
                  <label className={styles.facetCompactField}>
                    <span className={styles.facetCompactTitle}>Minimum</span>
                    <input className={`${styles.numberInput} ${styles.facetCompactInput}`} type="number" value={minimum as any} onWheel={(e) => { e.preventDefault(); const dir = e.deltaY > 0 ? -1 : 1; const mult = e.shiftKey ? 10 : 1; const cur = typeof minimum === 'number' ? (minimum as number) : 0; const newVal = cur + dir * 1 * mult; setMinimum(newVal); onChange(buildPatchWithAnnotations({ minimum: newVal })); }} onChange={e => setMinimum(e.target.value === '' ? undefined : Number(e.target.value))} onBlur={() => onChange(buildPatchWithAnnotations({ minimum }))} />
                <button type="button" onClick={() => { setMinimum(undefined); onChange(buildPatchWithAnnotations({ minimum: undefined })); }} className={styles.removeControl} title="Remove minimum">×</button>
              </label>
            )}
            {maximum === undefined ? (
              <button type="button" onClick={() => { setMaximum(0); onChange(buildPatchWithAnnotations({ maximum: 0 })); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6 }}>+ Maximum</button>
            ) : (
                  <label className={styles.facetCompactField}>
                    <span className={styles.facetCompactTitle}>Maximum</span>
                    <input className={`${styles.numberInput} ${styles.facetCompactInput}`} type="number" value={maximum as any} onWheel={(e) => { e.preventDefault(); const dir = e.deltaY > 0 ? -1 : 1; const mult = e.shiftKey ? 10 : 1; const cur = typeof maximum === 'number' ? (maximum as number) : 0; const newVal = cur + dir * 1 * mult; setMaximum(newVal); onChange(buildPatchWithAnnotations({ maximum: newVal })); }} onChange={e => setMaximum(e.target.value === '' ? undefined : Number(e.target.value))} onBlur={() => onChange(buildPatchWithAnnotations({ maximum }))} />
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
                  <label className={styles.facetCompactField}>
                    <span className={styles.facetCompactTitle}>Min Length</span>
                    <input className={`${styles.numberInput} ${styles.facetCompactInput}`} placeholder="Min Length" aria-label="Min Length" type="number" value={minLength as any} onWheel={(e) => { e.preventDefault(); const dir = e.deltaY > 0 ? -1 : 1; const mult = e.shiftKey ? 10 : 1; const cur = typeof minLength === 'number' ? (minLength as number) : 0; const newVal = Math.max(0, cur + dir * 1 * mult); setMinLength(newVal); onChange(buildPatchWithAnnotations({ minLength: newVal })); }} onChange={e => setMinLength(e.target.value === '' ? undefined : Number(e.target.value))} onBlur={() => {
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
                  </label>
                  <button type="button" onClick={() => { setMinLength(undefined); onChange(buildPatchWithAnnotations({ minLength: undefined })); }} className={styles.removeControl} title="Remove minLength">×</button>
                  {minMaxLengthError && <div style={{ color: '#e53935', fontSize: 12, marginTop: 6 }}>{minMaxLengthError}</div>}
                </div>
              )}
              {maxLength === undefined ? (
                <button type="button" onClick={() => { setMaxLength(0); onChange(buildPatchWithAnnotations({ maxLength: 0 })); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6 }}>+ Max Length</button>
              ) : (
                <div style={{ width: 140, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label className={styles.facetCompactField}>
                    <span className={styles.facetCompactTitle}>Max Length</span>
                    <input className={`${styles.numberInput} ${styles.facetCompactInput}`} placeholder="Max Length" aria-label="Max Length" type="number" value={maxLength as any} onWheel={(e) => { e.preventDefault(); const dir = e.deltaY > 0 ? -1 : 1; const mult = e.shiftKey ? 10 : 1; const cur = typeof maxLength === 'number' ? (maxLength as number) : 0; const newVal = Math.max(0, cur + dir * 1 * mult); setMaxLength(newVal); onChange(buildPatchWithAnnotations({ maxLength: newVal })); }} onChange={e => setMaxLength(e.target.value === '' ? undefined : Number(e.target.value))} onBlur={() => {
                    if (maxLength !== undefined && maxLength < 0) {
                      setMinMaxLengthError('maxLength must be >= 0');
                    } else if (minLength !== undefined && maxLength !== undefined && maxLength < minLength) {
                      setMinMaxLengthError('maxLength must be >= minLength');
                    } else {
                      setMinMaxLengthError(null);
                      onChange(buildPatchWithAnnotations({ maxLength }));
                    }
                  }} />
                  </label>
                  <button type="button" onClick={() => { setMaxLength(undefined); onChange(buildPatchWithAnnotations({ maxLength: undefined })); }} className={styles.removeControl} title="Remove maxLength">×</button>
                  {minMaxLengthError && <div style={{ color: '#e53935', fontSize: 12, marginTop: 6 }}>{minMaxLengthError}</div>}
                </div>
              )}
            </>
          )}

          {/* multipleOf */}
          {!isEnum && hasNumberType && (multipleOf === undefined ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="button" onClick={() => { setMultipleOf(1); onChange(buildPatchWithAnnotations({ multipleOf: 1 })); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6 }}>+ multipleOf</button>
              {examples === undefined ? (
                <button type="button" onClick={() => { setExamples(''); onChange(buildPatchWithAnnotations({ examples: [] })); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6 }}>+ Examples</button>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label className={styles.facetCompactField}>
                    <span className={styles.facetCompactTitle}>Examples</span>
                    <input
                      className={styles.facetCompactControl}
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
                  </label>
                  <button type="button" onClick={() => { setExamples(undefined); onChange(buildPatchWithAnnotations({ examples: undefined })); }} className={styles.removeControl} title="Remove examples">×</button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ width: 160, display: 'flex', alignItems: 'center', gap: 8 }}>
              <label className={styles.facetCompactField}>
                <span className={styles.facetCompactTitle}>multipleOf</span>
                <input className={`${styles.numberInput} ${styles.facetCompactInput}`} placeholder="multipleOf" aria-label="multipleOf" type="number" step="any" value={multipleOf as any} onWheel={(e) => { e.preventDefault(); const dir = e.deltaY > 0 ? -1 : 1; const mult = e.shiftKey ? 10 : 1; const cur = typeof multipleOf === 'number' ? (multipleOf as number) : 1; const newVal = parseFloat((cur + dir * 1 * mult).toString()); setMultipleOf(newVal); onChange(buildPatchWithAnnotations({ multipleOf: newVal })); }} onChange={e => setMultipleOf(e.target.value === '' ? undefined : Number(e.target.value))} onBlur={() => {
                if (multipleOf !== undefined && !(multipleOf > 0)) {
                  setMultipleOfError('multipleOf must be > 0');
                } else {
                  setMultipleOfError(null);
                  onChange(buildPatchWithAnnotations({ multipleOf }));
                }
                    }} />
              </label>
              <button type="button" onClick={() => { setMultipleOf(undefined); onChange(buildPatchWithAnnotations({ multipleOf: undefined })); }} className={styles.removeControl} title="Remove multipleOf">×</button>
              {examples === undefined ? (
                <button type="button" onClick={() => { setExamples(''); onChange(buildPatchWithAnnotations({ examples: [] })); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6 }}>+ Examples</button>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label className={styles.facetCompactField}>
                    <span className={styles.facetCompactTitle}>Examples</span>
                    <input
                      className={styles.facetCompactControl}
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
                  </label>
                  <button type="button" onClick={() => { setExamples(undefined); onChange(buildPatchWithAnnotations({ examples: undefined })); }} className={styles.removeControl} title="Remove examples">×</button>
                </div>
              )}
              {multipleOfError && <div style={{ color: '#e53935', fontSize: 12, marginTop: 6 }}>{multipleOfError}</div>}
            </div>
          ))}

          {/* Comment (appears in the dashed options flow) */}
          {comment === undefined ? (
            <button type="button" onClick={() => { setComment(''); onChange(buildPatchWithAnnotations({ $comment: '' })); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6 }}>+ Comment</button>
          ) : (
            <div style={{ width: '100%', display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                value={comment ?? ''}
                onChange={e => setComment(e.target.value)}
                onBlur={() => onChange(buildPatchWithAnnotations({ $comment: comment }))}
                placeholder="Internal comment for editors"
                aria-label="Comment ($comment)"
                style={{ flex: 1, padding: 4, borderRadius: 4, border: '1px solid #ccc' }}
              />
              <button type="button" onClick={() => { setComment(undefined); onChange(buildPatchWithAnnotations({ $comment: undefined })); }} className={styles.removeControl} title="Remove comment">×</button>
            </div>
          )}

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
                    <div style={{ width: 140, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label className={styles.facetCompactField}>
                        <span className={styles.facetCompactTitle}>Min Items</span>
                        <input className={`${styles.numberInput} ${styles.facetCompactInput}`} placeholder="Min Items" aria-label="Min Items" type="number" value={minItems as any} onWheel={(e) => { e.preventDefault(); const dir = e.deltaY > 0 ? -1 : 1; const mult = e.shiftKey ? 10 : 1; const cur = typeof minItems === 'number' ? (minItems as number) : 0; const newVal = Math.max(0, cur + dir * 1 * mult); setMinItems(newVal); onChange(buildPatchWithAnnotations({ minItems: newVal })); }} onChange={e => setMinItems(e.target.value === '' ? undefined : Number(e.target.value))} onBlur={() => {
                        if (minItems !== undefined && minItems < 0) setMinMaxItemsError('minItems must be >= 0');
                        else if (maxItems !== undefined && minItems !== undefined && maxItems < minItems) setMinMaxItemsError('maxItems must be >= minItems');
                        else { setMinMaxItemsError(null); onChange(buildPatchWithAnnotations({ minItems })); }
                      }} />
                      </label>
                      <button type="button" onClick={() => { setMinItems(undefined); onChange(buildPatchWithAnnotations({ minItems: undefined })); }} className={styles.removeControl} title="Remove minItems">×</button>
                      {minMaxItemsError && <div style={{ color: '#e53935', fontSize: 12, marginTop: 6 }}>{minMaxItemsError}</div>}
                    </div>
                  )}
                  {maxItems === undefined ? (
                    <button type="button" onClick={() => { setMaxItems(0); onChange(buildPatchWithAnnotations({ maxItems: 0 })); }} style={{ background: 'none', border: '1px dashed #ccc', padding: '4px 8px', borderRadius: 6 }}>+ Max Items</button>
                  ) : (
                    <div style={{ width: 140, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label className={styles.facetCompactField}>
                        <span className={styles.facetCompactTitle}>Max Items</span>
                        <input className={`${styles.numberInput} ${styles.facetCompactInput}`} placeholder="Max Items" aria-label="Max Items" type="number" value={maxItems as any} onWheel={(e) => { e.preventDefault(); const dir = e.deltaY > 0 ? -1 : 1; const mult = e.shiftKey ? 10 : 1; const cur = typeof maxItems === 'number' ? (maxItems as number) : 0; const newVal = Math.max(0, cur + dir * 1 * mult); setMaxItems(newVal); onChange(buildPatchWithAnnotations({ maxItems: newVal })); }} onChange={e => setMaxItems(e.target.value === '' ? undefined : Number(e.target.value))} onBlur={() => {
                        if (maxItems !== undefined && maxItems < 0) setMinMaxItemsError('maxItems must be >= 0');
                        else if (minItems !== undefined && maxItems !== undefined && maxItems < minItems) setMinMaxItemsError('maxItems must be >= minItems');
                        else { setMinMaxItemsError(null); onChange(buildPatchWithAnnotations({ maxItems })); }
                      }} style={{ flex: 1, marginTop: 2, padding: 4, borderRadius: 4, border: '1px solid #ccc' }} />
                      </label>
                      <button type="button" onClick={() => { setMaxItems(undefined); onChange(buildPatchWithAnnotations({ maxItems: undefined })); }} className={styles.removeControl} title="Remove maxItems">×</button>
                      {minMaxItemsError && <div style={{ color: '#e53935', fontSize: 12, marginTop: 6 }}>{minMaxItemsError}</div>}
                    </div>
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

export const MemoizedNodePropertyEditor = React.memo(NodePropertyEditor);
