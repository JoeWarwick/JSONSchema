import { useState, useEffect } from "react";
import { validateValueAgainstSchema } from "../utils/validation";
import {
  addPropertyToSchema,
  updateNestedPropertyInSchema,
  addPatternPropertyToSchema,
  removePatternPropertyFromSchema,
  updatePatternPropertyInSchema,
  renamePatternPropertyInSchema
} from "./schema-behaviors";
import { validateSchema } from "../utils/schema-generator";
import styles from "./schema-editor-form.module.css";

interface SchemaEditorFormProps {
  schema: Record<string, unknown>;
  onChange: (schema: Record<string, unknown>) => void;
  isSchemaImported?: (schema: Record<string, unknown>, path?: string[]) => boolean;
  instanceData?: unknown;
  path?: string[];
  onViewSource?: () => void;
  onPropertyRename?: (oldName: string, newName: string, path?: string[]) => void;
}

import { generateSchema } from "../utils/schema-generator";

export function SchemaEditorForm({ schema, onChange, path = [], onPropertyRename, isSchemaImported, instanceData }: SchemaEditorFormProps) {
  const [validationError, setValidationError] = useState<string | null>(null);
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const [editingDefault, setEditingDefault] = useState<string>(String(schema.default ?? ""));

  useEffect(() => {
    setEditingDefault(String(schema.default ?? ""));
  }, [schema.default]);

  const updateSchema = (updates: Partial<Record<string, unknown>>) => {
    let nextSchema: Record<string, unknown>;
    // If type is being changed from object to array, hoist the object into items
    if (updates.type === "array" && schema.type === "object") {
      const rest = { ...schema };
      delete (rest as any).type;
      nextSchema = { type: "array", items: { type: "object", ...rest } };
    }
    // If type is being changed from array to object, unhoist the items into the object
    else if (updates.type === "object" && schema.type === "array" && schema.items) {
      const items = schema.items as Record<string, unknown>;
      if (Array.isArray(items)) {
        const properties: Record<string, unknown> = {};
        items.forEach((item, index) => {
          const propertyName = `property${index}`;
          properties[propertyName] = item;
        });
        nextSchema = { type: "object", properties };
      } else {
        nextSchema = { ...items, type: "object" };
      }
    }
    // If type is being changed from string with enum to array, move enum to items
    else if (updates.type === "array" && (schema.type === "string" || !schema.type)) {
      const items: Record<string, unknown> = { type: "string" };
      if (schema.enum) {
        items.enum = schema.enum;
      }
      // Remove enum from root
      const rest = { ...schema };
      delete (rest as any).enum;
      nextSchema = { ...rest, ...updates, items };
    } else if (updates.type === "array" && !schema.items) {
      nextSchema = { ...schema, ...updates, items: { type: "string" } };
    } else {
      nextSchema = { ...schema, ...updates };
    }
    const error = validateSchema(nextSchema);
    setValidationError(error);
    // Only call onChange if the schema actually changed and is valid
    if (!error && JSON.stringify(nextSchema) !== JSON.stringify(schema)) {
      onChange(nextSchema);
    }
  };

  const toggleEnum = (enabled: boolean) => {
    if (enabled) {
      // Enable enum with default values based on type
      const type = schema.type as string || "string";
      const defaultValues = type === "number" ? [1, 2, 3] : ["option1", "option2", "option3"];
      updateSchema({ enum: defaultValues });
    } else {
      // Disable enum
      const newSchema = { ...schema };
      delete newSchema.enum;
      onChange(newSchema);
    }
  };

  const updateNestedProperty = (propertyName: string, newValue: Record<string, unknown>) => {
    const nextSchema = updateNestedPropertyInSchema(schema, propertyName, newValue);
    updateSchema(nextSchema as any);
  };

  // Infer root type for display when loading schemas that use $ref/$defs
  const inferredRootType = (() => {
    if (schema.type) return schema.type as string;
    if (schema.properties) return 'object';
    if (schema.$ref && schema.$defs && typeof schema.$ref === 'string' && schema.$ref.startsWith('#/$defs/')) {
      const key = (schema.$ref as string).replace('#/$defs/', '');
      const def = (schema.$defs as any)[key];
      if (def && def.type) return def.type as string;
      if (def && def.properties) return 'object';
    }
    // If schema only contains $defs (no top-level $ref/type/properties), hoist the first def for display
    if (!schema.type && !schema.properties && schema.$defs && typeof schema.$defs === 'object') {
      const keys = Object.keys(schema.$defs as Record<string, unknown>);
      if (keys.length > 0) {
        const def = (schema.$defs as any)[keys[0]];
        if (def && def.type) return def.type as string;
        if (def && def.properties) return 'object';
      }
    }
    return 'string';
  })();
  const renderType = (schema.type as string) ?? inferredRootType;
  const defaultIsImported = (node: Record<string, unknown> | null | undefined) => {
    try {
      if (!node || typeof node !== 'object') return false;
      return !!(node as any).__from;
    } catch (_) { return false; }
  };

  const isImported = (isSchemaImported || defaultIsImported)(schema as Record<string, unknown>);

  const addProperty = () => {
    const nextSchema = addPropertyToSchema(schema);
    updateSchema(nextSchema as any);
  };

  const toggleRequired = (propertyName: string) => {
    const required = (schema.required as string[]) || [];
    const isRequired = required.includes(propertyName);

    const newRequired = isRequired ? required.filter((r) => r !== propertyName) : [...required, propertyName];

    updateSchema({
      required: newRequired.length > 0 ? newRequired : undefined,
    });
  };

  const updatePropertyName = (oldName: string, newName: string) => {
    if (oldName === newName) return;

    const properties = { ...(schema.properties as Record<string, unknown>) };
    const propertyValue = properties[oldName];
    delete properties[oldName];
    properties[newName] = propertyValue;

    const required = (schema.required as string[]) || [];
    const newRequired = required.map((r) => (r === oldName ? newName : r));

    updateSchema({
      properties,
      required: newRequired.length > 0 ? newRequired : undefined,
    });
    if (onPropertyRename) {
      onPropertyRename(oldName, newName, path);
    }
  };

  const patternProperties = schema.patternProperties as Record<string, unknown> | undefined;

  function PatternPropertyRow({ patternKey, subschema }: { patternKey: string; subschema: Record<string, unknown> }) {
    const [keyState, setKeyState] = useState<string>(patternKey);
    const [keyError, setKeyError] = useState<string | null>(null);

    const handleKeyBlur = () => {
      const newKey = keyState;
      // Validate regex
      try {
        // eslint-disable-next-line no-new
        new RegExp(newKey);
        setKeyError(null);
      } catch (err) {
        setKeyError('Invalid regular expression');
        return;
      }
      if (newKey !== patternKey) {
        const next = renamePatternPropertyInSchema(schema, patternKey, newKey);
        updateSchema(next);
      }
    };

    return (
      <div key={patternKey} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 16, borderLeft: '2px solid #ddd', paddingLeft: 12 }}>
        <div style={{ minWidth: 200, paddingTop: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Regex Pattern</div>
          <input aria-label={`pattern-key-${patternKey}`} value={keyState} onChange={(e) => setKeyState(e.target.value)} onBlur={handleKeyBlur} className={styles.input} />
          {keyError && <div style={{ color: '#b71c1c', fontSize: 12, marginTop: 6 }}>{keyError}</div>}
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className={styles.removeSmall}
              onClick={() => {
                const next = removePatternPropertyFromSchema(schema, patternKey);
                updateSchema(next);
              }}
            >
              Remove Pattern
            </button>
          </div>
        </div>
        <div style={{ flex: 1, background: '#f9f9f9', padding: 8, borderRadius: 8 }}>
          <SchemaEditorForm
            schema={subschema}
            onChange={(newSub) => {
              const updated = updatePatternPropertyInSchema(schema, patternKey, newSub);
              updateSchema(updated);
            }}
            path={[...path, "patternProperties", patternKey]}
          />
        </div>
      </div>
    );
  }

  return (
    <>
      {validationError && (
        <div style={{ color: 'red', marginBottom: 8 }}>{validationError}</div>
      )}
      <div className={styles.container}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{(schema.title as string) || 'Schema'}</div>
          {isImported && (
              <button
                type="button"
                onClick={() => {
                  // build a local allOf override referencing the original $ref when available
                  let refStr: string | null = null;
                  try {
                    if (typeof (schema as any).$ref === 'string') refStr = (schema as any).$ref;
                    else if (Array.isArray((schema as any).allOf)) {
                      const m = ((schema as any).allOf as any[]).find((e: any) => e && typeof e.$ref === 'string');
                      if (m) refStr = m.$ref;
                    } else if ((schema as any).__from) refStr = (schema as any).__from;
                  } catch (e) {
                    // ignore
                  }
                  if (!refStr) return;

                  // If instance data is available, attempt to use instance keys at the current path
                  // to pre-populate property schemas so we don't add arbitrary fields like "username".
                  const localProperties: Record<string, unknown> = {};
                  try {
                    if (instanceData && typeof instanceData === 'object') {
                      // Traverse instanceData according to the editor path to find the relevant object
                      let node: any = instanceData as any;
                      for (const p of path) {
                        if (!node || typeof node !== 'object') { node = null; break; }
                        node = node[p];
                      }
                      if (node && typeof node === 'object' && !Array.isArray(node)) {
                        for (const [k, v] of Object.entries(node)) {
                          try {
                            // generate a schema for the instance value to make the override valid
                            const gen = generateSchema(v as any);
                            localProperties[k] = gen;
                          } catch (_) {
                            // fallback: mark as string
                            localProperties[k] = { type: 'string' };
                          }
                        }
                      }
                    }
                  } catch (_) { /* ignore */ }

                  const overrideObj: Record<string, unknown> = { type: 'object', properties: localProperties };
                  const next: Record<string, unknown> = { allOf: [{ $ref: refStr }, overrideObj] };
                  if (schema.title) next.title = schema.title as string;
                  onChange(next);
                }}
                className={styles.addSmall}
                title="Create a local override that preserves the upstream $ref and allows local edits"
              >
                Override
              </button>
          )}
        </div>

        <div className={styles.fieldGroup}>
          <div className={styles.fieldRow}>
            <label className={styles.label}>Type{isImported && (
              <span title={typeof (schema as any).$ref === 'string' ? `Imported from ${(schema as any).$ref}` : 'Imported definition (create local override to change)'} style={{ color: '#d9822b', marginLeft: 8 }}>*</span>
            )}</label>
            <select
              className={styles.select}
              value={renderType}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'image') {
                  // Map 'image' to a string schema with image-specific metadata
                  updateSchema({ type: 'string', format: 'data-url', contentMediaType: 'image/*' });
                } else {
                  updateSchema({ type: v });
                }
              }}
            >
              <option value="string">String</option>
              <option value="number">Number</option>
              <option value="boolean">Boolean</option>
              <option value="object">Object</option>
              <option value="array">Array</option>
              <option value="null">Null</option>
              <option value="image">Image</option>
            </select>
          </div>

          {/* Facet controls: hide for boolean/object/null and when enum is present */}
          {!(renderType === "boolean" || renderType === "object" || renderType === "null" || !!schema.enum) && (
            <>
            {/* Addable string-specific properties: format / pattern / default */}
            {(renderType === "string") && (
            <div className={styles.inlineAdd}>
              {!('format' in schema) ? (
                <button
                  type="button"
                  className={styles.addSmall}
                  onClick={() => updateSchema({ format: 'date-time' })}
                >
                  + format
                </button>
              ) : (
                <div className={styles.fieldRow}>
                  <label className={styles.label}>Format</label>
                  <select
                    className={styles.select}
                    value={(schema.format as string) || ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "") {
                        const next = { ...schema } as Record<string, unknown>;
                        delete next.format;
                        onChange(next);
                      } else {
                        updateSchema({ format: v });
                      }
                    }}
                  >
                    <option value="">— Select format —</option>
                    <option value="date-time">date-time</option>
                    <option value="date">date</option>
                    <option value="time">time</option>
                    <option value="email">email</option>
                    <option value="uri">uri</option>
                    <option value="hostname">hostname</option>
                    <option value="ipv4">ipv4</option>
                    <option value="ipv6">ipv6</option>
                    <option value="uuid">uuid</option>
                    <option value="data-url">data-url (binary/data URI)</option>
                  </select>
                  <button
                    type="button"
                    className={styles.infoSmall}
                    title={
                      'Common formats: date-time (ISO 8601), date (YYYY-MM-DD), time (HH:MM:SS), email, uri, hostname, ipv4, ipv6, uuid'
                    }
                  >
                    ⓘ
                  </button>
                </div>
              )}

              {!('pattern' in schema) ? (
                <button
                  type="button"
                  className={styles.addSmall}
                  onClick={() => updateSchema({ pattern: '^.*$' })}
                >
                  + pattern
                </button>
              ) : (
                <div className={styles.fieldRow}>
                  <label className={styles.label}>Pattern</label>
                  <input
                    className={styles.input}
                    value={String((schema.pattern as string) || '')}
                    onChange={(e) => updateSchema({ pattern: e.target.value })}
                    placeholder="Regex pattern"
                  />
                  <button
                    type="button"
                    className={styles.removeSmall}
                    onClick={() => {
                      const next = { ...schema } as Record<string, unknown>;
                      delete next.pattern;
                      onChange(next);
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}

              {!('default' in schema) ? (
                <button
                  type="button"
                  className={styles.addSmall}
                  onClick={() => { setDefaultError(null); setEditingDefault(''); updateSchema({ default: '' }); }}
                >
                  + default
                </button>
              ) : (
                <div className={styles.fieldRow}>
                  <label className={styles.label}>Default</label>
                        <input
                          className={styles.input}
                          value={editingDefault}
                          onChange={(e) => setEditingDefault(e.target.value)}
                          onBlur={() => {
                            const raw = editingDefault;
                            const parsed = (String(renderType) === 'number') ? (raw === '' ? '' : parseFloat(raw)) : raw;
                            const error = validateValueAgainstSchema(parsed, schema);
                            if (error) {
                              setDefaultError(error);
                            } else {
                              setDefaultError(null);
                              updateSchema({ default: parsed as any });
                            }
                          }}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          placeholder="Default value"
                        />
                </div>
              )}
              //* Image preview + upload for data-url / image media types *//
              {(schema.format === 'data-url' || (typeof schema.contentMediaType === 'string' && String(schema.contentMediaType).startsWith('image'))) && (
                <div className={styles.fieldRow} style={{ alignItems: 'center', gap: 12 }}>
                  <label className={styles.label}>Image</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {typeof schema.default === 'string' && /^data:image\//i.test(schema.default as string) && (
                      <img src={schema.default as string} alt="preview" style={{ maxWidth: 240, maxHeight: 160, border: '1px solid #ddd', borderRadius: 6 }} />
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const f = e.target.files && e.target.files[0];
                        if (!f) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                          const result = reader.result as string | ArrayBuffer | null;
                          if (typeof result === 'string') {
                            updateSchema({ default: result });
                          }
                        };
                        reader.readAsDataURL(f);
                      }}
                    />
                    <button type="button" className={styles.removeSmall} onClick={() => { const next = { ...schema } as Record<string, unknown>; delete next.default; onChange(next); }}>Remove image</button>
                  </div>
                </div>
              )}
              {defaultError && <div style={{ color: 'red', marginTop: 6 }}>{defaultError}</div>}
            </div>
            )}

            {/* Show enum checkbox for string and number types */}
            {(renderType === "string" || renderType === "number" || !schema.type) && (
              <div className={styles.checkboxContainer}>
              <input
                type="checkbox"
                className={styles.checkbox}
                id={`enum-${path.join("-") || "root"}`}
                checked={!!schema.enum}
                onChange={(e) => toggleEnum(e.target.checked)}
              />
              <label className={styles.checkboxLabel} htmlFor={`enum-${path.join("-") || "root"}`}>
                Enum (constrained values)
              </label>
            </div>
            )}

          {/* Number-specific facets: minimum / maximum / multipleOf / examples */}
          {renderType === "number" && (
            <div className={styles.inlineAdd}>
              {!('minimum' in schema) ? (
                <button type="button" className={styles.addSmall} onClick={() => updateSchema({ minimum: 0 })}>+ minimum</button>
              ) : (
                <div className={styles.fieldRow}>
                  <label className={styles.label}>Minimum</label>
                  <input
                    className={styles.input}
                    type="number"
                    value={schema.minimum === undefined ? '' : String(schema.minimum)}
                    onWheel={(e) => {
                      e.preventDefault();
                      const dir = (e.deltaY > 0) ? -1 : 1;
                      const mult = e.shiftKey ? 10 : 1;
                      const cur = typeof schema.minimum === 'number' ? (schema.minimum as number) : 0;
                      const newVal = cur + dir * 1 * mult;
                      updateSchema({ minimum: newVal });
                    }}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') {
                        const next = { ...schema } as Record<string, unknown>;
                        delete next.minimum;
                        onChange(next);
                      } else {
                        updateSchema({ minimum: parseFloat(raw) });
                      }
                    }}
                    placeholder="Minimum"
                  />
                  <button type="button" className={styles.removeSmall} onClick={() => { const next = { ...schema } as Record<string, unknown>; delete next.minimum; onChange(next); }}>Remove</button>
                </div>
              )}

              {!('maximum' in schema) ? (
                <button type="button" className={styles.addSmall} onClick={() => updateSchema({ maximum: 0 })}>+ maximum</button>
              ) : (
                <div className={styles.fieldRow}>
                  <label className={styles.label}>Maximum</label>
                  <input
                    className={styles.input}
                    type="number"
                    value={schema.maximum === undefined ? '' : String(schema.maximum)}
                    onWheel={(e) => {
                      e.preventDefault();
                      const dir = (e.deltaY > 0) ? -1 : 1;
                      const mult = e.shiftKey ? 10 : 1;
                      const cur = typeof schema.maximum === 'number' ? (schema.maximum as number) : 0;
                      const newVal = cur + dir * 1 * mult;
                      updateSchema({ maximum: newVal });
                    }}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') {
                        const next = { ...schema } as Record<string, unknown>;
                        delete next.maximum;
                        onChange(next);
                      } else {
                        updateSchema({ maximum: parseFloat(raw) });
                      }
                    }}
                    placeholder="Maximum"
                  />
                  <button type="button" className={styles.removeSmall} onClick={() => { const next = { ...schema } as Record<string, unknown>; delete next.maximum; onChange(next); }}>Remove</button>
                </div>
              )}

              {!('multipleOf' in schema) ? (
                <button type="button" className={styles.addSmall} onClick={() => updateSchema({ multipleOf: 1 })}>+ multipleOf</button>
              ) : (
                <div className={styles.fieldRow}>
                  <label className={styles.label}>multipleOf</label>
                  <input
                    className={styles.input}
                    type="number"
                    step="any"
                    value={schema.multipleOf === undefined ? '' : String(schema.multipleOf)}
                    onWheel={(e) => {
                      e.preventDefault();
                      const dir = (e.deltaY > 0) ? -1 : 1;
                      const mult = e.shiftKey ? 10 : 1;
                      const cur = typeof schema.multipleOf === 'number' ? (schema.multipleOf as number) : 1;
                      const newVal = parseFloat((cur + dir * 1 * mult).toString());
                      updateSchema({ multipleOf: newVal });
                    }}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') {
                        const next = { ...schema } as Record<string, unknown>;
                        delete next.multipleOf;
                        onChange(next);
                      } else {
                        updateSchema({ multipleOf: parseFloat(raw) });
                      }
                    }}
                    placeholder="multipleOf"
                  />
                  <button type="button" className={styles.removeSmall} onClick={() => { const next = { ...schema } as Record<string, unknown>; delete next.multipleOf; onChange(next); }}>Remove</button>
                </div>
              )}

              {!('examples' in schema) ? (
                <button type="button" className={styles.addSmall} onClick={() => { const example = renderType === 'number' ? [0] : ['example']; updateSchema({ examples: example }); }}>+ examples</button>
              ) : (
                <div className={styles.fieldRow}>
                  <label className={styles.label}>Examples</label>
                  <input
                    className={styles.input}
                    value={Array.isArray(schema.examples) ? (schema.examples as any[]).join(', ') : ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const arr = raw.split(',').map(s => s.trim()).filter(Boolean).map(v => renderType === 'number' ? parseFloat(v) : v);
                      updateSchema({ examples: arr });
                    }}
                    placeholder="Comma-separated examples"
                  />
                  <button type="button" className={styles.removeSmall} onClick={() => { const next = { ...schema } as Record<string, unknown>; delete next.examples; onChange(next); }}>Remove</button>
                </div>
              )}
            </div>
          )}

          {/* Array-specific facets: uniqueItems / minItems / maxItems */}
          {renderType === "array" && (
            <div className={styles.inlineAdd}>
              {!('uniqueItems' in schema) ? (
                <button type="button" className={styles.addSmall} onClick={() => updateSchema({ uniqueItems: true })}>+ uniqueItems</button>
              ) : (
                <div className={styles.fieldRow}>
                  <label className={styles.label}>uniqueItems</label>
                  <input
                    type="checkbox"
                    checked={!!schema.uniqueItems}
                    onChange={(e) => updateSchema({ uniqueItems: e.target.checked })}
                  />
                  <button type="button" className={styles.removeSmall} onClick={() => { const next = { ...schema } as Record<string, unknown>; delete next.uniqueItems; onChange(next); }}>Remove</button>
                </div>
              )}

              {!('minItems' in schema) ? (
                <button type="button" className={styles.addSmall} onClick={() => updateSchema({ minItems: 0 })}>+ minItems</button>
              ) : (
                <div className={styles.fieldRow}>
                  <label className={styles.label}>minItems</label>
                  <input
                    className={styles.input}
                    type="number"
                    value={schema.minItems === undefined ? '' : String(schema.minItems)}
                    onWheel={(e) => {
                      e.preventDefault();
                      const dir = (e.deltaY > 0) ? -1 : 1;
                      const mult = e.shiftKey ? 10 : 1;
                      const cur = typeof schema.minItems === 'number' ? (schema.minItems as number) : 0;
                      const newVal = Math.max(0, cur + dir * 1 * mult);
                      updateSchema({ minItems: newVal });
                    }}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') {
                        const next = { ...schema } as Record<string, unknown>;
                        delete next.minItems;
                        onChange(next);
                      } else {
                        updateSchema({ minItems: parseInt(raw, 10) });
                      }
                    }}
                    placeholder="minItems"
                  />
                  <button type="button" className={styles.removeSmall} onClick={() => { const next = { ...schema } as Record<string, unknown>; delete next.minItems; onChange(next); }}>Remove</button>
                </div>
              )}

              {!('maxItems' in schema) ? (
                <button type="button" className={styles.addSmall} onClick={() => updateSchema({ maxItems: 0 })}>+ maxItems</button>
              ) : (
                <div className={styles.fieldRow}>
                  <label className={styles.label}>maxItems</label>
                  <input
                    className={styles.input}
                    type="number"
                    value={schema.maxItems === undefined ? '' : String(schema.maxItems)}
                    onWheel={(e) => {
                      e.preventDefault();
                      const dir = (e.deltaY > 0) ? -1 : 1;
                      const mult = e.shiftKey ? 10 : 1;
                      const cur = typeof schema.maxItems === 'number' ? (schema.maxItems as number) : 0;
                      const newVal = Math.max(0, cur + dir * 1 * mult);
                      updateSchema({ maxItems: newVal });
                    }}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') {
                        const next = { ...schema } as Record<string, unknown>;
                        delete next.maxItems;
                        onChange(next);
                      } else {
                        updateSchema({ maxItems: parseInt(raw, 10) });
                      }
                    }}
                    placeholder="maxItems"
                  />
                  <button type="button" className={styles.removeSmall} onClick={() => { const next = { ...schema } as Record<string, unknown>; delete next.maxItems; onChange(next); }}>Remove</button>
                </div>
              )}
            </div>
          )}
            </>
          )}
        </div>

        {renderType === "object" && (
          <div className={styles.nestedContainer}>
            <div className={styles.propertiesHeader}>
              <h3 className={styles.propertyTitle}>Properties</h3>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#666', marginBottom: 16 }}>
                <input
                  type="checkbox"
                  checked={schema.additionalProperties === false}
                  onChange={(e) => {
                    const next = { ...schema };
                    if (e.target.checked) next.additionalProperties = false;
                    else delete next.additionalProperties;
                    onChange(next);
                  }}
                />
                Strict mode (<code>additionalProperties: false</code>)
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className={styles.addButton} onClick={addProperty} disabled={(schema.additionalProperties === false) && (!patternProperties || Object.keys(patternProperties).length === 0)}>
                  Add Property
                </button>
                <button
                  className={styles.addButton}
                  onClick={() => {
                    const next = addPatternPropertyToSchema(schema);
                    updateSchema(next);
                  }}
                >
                  + pattern property
                </button>
              </div>
              {(schema.additionalProperties === false) && (!patternProperties || Object.keys(patternProperties).length === 0) && (
                <div style={{ color: '#b71c1c', marginTop: 8, fontSize: 13 }} data-testid="additional-properties-blocked">Cannot add properties here because <code>additionalProperties: false</code> and no <code>patternProperties</code> are defined.</div>
              )}
              {/* Pattern Properties list */}
              {patternProperties && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Pattern properties</div>
                  {Object.entries(patternProperties).map(([pat, subschema]) => (
                    <PatternPropertyRow key={pat} patternKey={pat} subschema={subschema as Record<string, unknown>} />
                  ))}
                </div>
              )}
            </div>

            {Object.entries((schema.properties as Record<string, unknown>) || {})
              .filter(([propertyName]) => !propertyName.startsWith('__'))
              .map(([propertyName, propertySchema]) => (
                <PropertyEditor
                  key={propertyName}
                  propertyName={propertyName}
                  propertySchema={propertySchema as Record<string, unknown>}
                  isRequired={((schema.required as string[]) || []).includes(propertyName)}
                  onUpdate={(newValue) => updateNestedProperty(propertyName, newValue)}
                  onToggleRequired={() => toggleRequired(propertyName)}
                  onRename={(newName) => updatePropertyName(propertyName, newName)}
                />
              ))}
          </div>
        )}        {renderType === "array" && (() => {
          const itemsSchema = (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items))
            ? (schema.items as Record<string, unknown>)
            : { type: "string" };
          return (
            <div className={styles.nestedContainer}>
              <h3 className={styles.propertyTitle}>Array Items Schema</h3>
              <SchemaEditorForm
                schema={itemsSchema}
                onChange={(newItems) => updateSchema({ items: newItems })}
                path={[...path, "items"]}
              />
            </div>
          );
        })()}

        {/* Only show EnumEditor for root if not array type */}
        {!!schema.enum && Array.isArray(schema.enum) && renderType !== "array" && (
          <div className={styles.nestedContainer}>
            <h3 className={styles.propertyTitle}>Allowed Values</h3>
            <EnumEditor
              values={(schema.enum as Array<string | number>) || []}
              onChange={(newEnum) => updateSchema({ enum: newEnum })}
              type={(renderType as string) || "string"}
            />
          </div>
        )}
      </div>
    </>
  );
}

interface PropertyEditorProps {
  propertyName: string;
  propertySchema: Record<string, unknown>;
  isRequired: boolean;
  onUpdate: (schema: Record<string, unknown>) => void;
  onToggleRequired: () => void;
  onRename: (newName: string) => void;
}

interface EnumEditorProps {
  values: Array<string | number>;
  onChange: (values: Array<string | number>) => void;
  type: string;
}

function EnumEditor({ values, onChange, type }: EnumEditorProps) {
  const [editingValues, setEditingValues] = useState<Array<string | number>>(values);

  // Sync local state from props when values change
  useEffect(() => {
    setEditingValues(values);
  }, [values]);

  const removeValue = (index: number) => {
    const newValues = editingValues.filter((_, i) => i !== index);
    setEditingValues(newValues);
    onChange(newValues);
  };

  const updateValue = (index: number, newValue: string) => {
    const newValues = [...editingValues];
    if (type === "number") {
      const numValue = parseFloat(newValue);
      newValues[index] = isNaN(numValue) ? 0 : numValue;
    } else {
      newValues[index] = newValue;
    }
    setEditingValues(newValues);
    onChange(newValues);
  };

  const [newEnumValue, setNewEnumValue] = useState("");
  const handleNewEnumKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && newEnumValue.trim() !== "") {
      const valueToAdd = type === "number" ? parseFloat(newEnumValue) : newEnumValue.trim();
      if (!editingValues.includes(valueToAdd)) {
        const newValues = [...editingValues, valueToAdd];
        setEditingValues(newValues);
        onChange(newValues);
      }
      setNewEnumValue("");
      e.preventDefault();
    }
  };
  return (
    <div className={styles.enumContainer}>
      {editingValues.map((value, index) => (
        <div key={index} className={styles.enumItem}>
          <input
            className={styles.input}
            type={type === "number" ? "number" : "text"}
            value={value}
            onChange={(e) => updateValue(index, e.target.value)}
            placeholder={type === "number" ? "Enter number..." : "Enter value..."}
          />
          <button
            className={styles.removeButton}
            onClick={() => removeValue(index)}
            disabled={editingValues.length === 1}
          >
            Remove
          </button>
        </div>
      ))}
      <div className={styles.enumItem}>
        <input
          className={styles.input}
          type={type === "number" ? "number" : "text"}
          value={newEnumValue}
          onChange={e => setNewEnumValue(e.target.value)}
          onKeyDown={handleNewEnumKeyDown}
          placeholder={type === "number" ? "Add number and press Enter" : "Add value and press Enter"}
        />
        <button className={styles.addButton} onClick={() => {
          if (newEnumValue.trim() !== "") {
            const valueToAdd = type === "number" ? parseFloat(newEnumValue) : newEnumValue.trim();
            if (!editingValues.includes(valueToAdd)) {
              const newValues = [...editingValues, valueToAdd];
              setEditingValues(newValues);
              onChange(newValues);
            }
            setNewEnumValue("");
          }
        }}>
          + Add Value
        </button>
      </div>
    </div>
  );
}

function PropertyEditor({
  propertyName,
  propertySchema,
  isRequired,
  onUpdate,
  onToggleRequired,
  onRename,
}: PropertyEditorProps) {
  const [editingName, setEditingName] = useState(propertyName);
  const [descriptionExpanded] = useState(false);

  return (
    <div className={styles.fieldGroup} data-testid={`prop-${propertyName}`}>
      <div className={styles.propertyHeader}>
        <input
          className={styles.input}
          value={editingName}
          data-testid={`prop-${propertyName}-name`}
          onChange={(e) => setEditingName(e.target.value)}
          onBlur={() => onRename(editingName)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onRename(editingName);
            }
          }}
        />
      </div>

      <div className={styles.checkboxContainer}>
        <input
          type="checkbox"
          className={styles.checkbox}
          id={`required-${propertyName}`}
          checked={isRequired}
          onChange={onToggleRequired}
        />
        {!descriptionExpanded && typeof propertySchema.description === 'string' && propertySchema.description && (
          <span className={styles.descriptionPreview}>{propertySchema.description}</span>
        )}
        {descriptionExpanded && (
          <textarea
            className={styles.textarea}
            value={(propertySchema.description as string) || ""}
            onChange={(e) => onUpdate({ ...propertySchema, description: e.target.value })}
            placeholder="Add a description for this property..."
          />
        )}
      </div>

      <SchemaEditorForm schema={propertySchema} onChange={onUpdate} />
    </div>
  );
}
