import { useState, useRef, useEffect } from "react";
import styles from "./json-instance-form.module.css";
import { validateValueAgainstSchema } from "../utils/validation";
import { getAdditionalPropertiesSchema } from "./schema-behaviors";
// `useState` already imported above

interface JsonInstanceFormProps {
  schema: Record<string, unknown>;
  value: unknown;
  onChange: (value: unknown) => void;
}

export function JsonInstanceForm({ schema, value, onChange }: JsonInstanceFormProps) {
  const explicitType = schema.type as string | undefined;
  const type = explicitType ?? (Array.isArray(value) ? 'array' : (value && typeof value === 'object' ? 'object' : 'string'));
  const storageKey = 'json-instance:' + (schema && typeof (schema.title as any) === 'string' ? schema.title : JSON.stringify(schema));
  const [inputError, setInputError] = useState<string | null>(null);
  
  const min = (schema.minimum as number | undefined) ?? undefined;
  const max = (schema.maximum as number | undefined) ?? undefined;
  const step = (schema.multipleOf as number | undefined) ?? undefined;
  const minLength = (schema.minLength as number | undefined) ?? undefined;
  const maxLength = (schema.maxLength as number | undefined) ?? undefined;
  const patternAttr = (schema.pattern as string | undefined) ?? undefined;
  const readOnlyAttr = !!schema.readOnly;
  const deprecatedFlag = !!schema.deprecated;
  const format = (schema.format as string | undefined) ?? undefined;
  const contentMediaType = (schema.contentMediaType as string | undefined) ?? undefined;
  const writeOnlyAttr = !!schema.writeOnly;
  const constValue = schema.const as unknown | undefined;

  const numberInputRef = useRef<HTMLInputElement | null>(null);

  // Support choice-like schemas: custom `oneOnly` and standard `oneOf`
  const variants = Array.isArray(schema.oneOnly)
    ? (schema.oneOnly as Record<string, unknown>[])
    : Array.isArray(schema.oneOf)
    ? (schema.oneOf as Record<string, unknown>[])
    : null;
  const hasVariants = !!variants && variants.length > 0;
  const [selectedVariantIndex, setSelectedVariantIndex] = useState<number>(() => {
    if (!hasVariants) return 0;
    const idx = variants!.findIndex((vs) => validateValueAgainstSchema(value, vs) === null);
    return idx >= 0 ? idx : 0;
  });

  useEffect(() => {
    if (!hasVariants) return;
    const idx = variants!.findIndex((vs) => validateValueAgainstSchema(value, vs) === null);
    if (idx >= 0 && idx !== selectedVariantIndex) setSelectedVariantIndex(idx);
  }, [value, schema]);

  // Refs for variant chips so keyboard navigation can focus them
  const chipRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectVariant = (idx: number) => {
    if (!hasVariants) return;
    const vs = variants![idx];
    // Keep current value if it already validates; otherwise set default for selected variant
    if (validateValueAgainstSchema(value, vs) === null) {
      onChange(value);
    } else {
      onChange(getDefaultValue(vs));
    }
    // rely on the value-driven effect to update `selectedVariantIndex` after parent value changes
  };

  const handleChipKeyDown = (e: any, idx: number) => {
    const key = e.key;
    if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'ArrowDown' && key !== 'ArrowUp') return;
    e.preventDefault();
    const len = variants ? variants.length : 0;
    if (len === 0) return;
    let next = idx;
    if (key === 'ArrowRight' || key === 'ArrowDown') next = (idx + 1) % len;
    if (key === 'ArrowLeft' || key === 'ArrowUp') next = (idx - 1 + len) % len;
    selectVariant(next);
    // move focus to the newly-selected chip (after selectVariant schedules the selection)
    setTimeout(() => {
      const el = chipRefs.current[next];
      if (el && 'focus' in el) (el as HTMLButtonElement).focus();
    }, 0);
  };

  if (hasVariants) {
    const label = (schema.description as string) || "Choose an option";
    const matchesAny = variants!.some((vs) => validateValueAgainstSchema(value, vs) === null);
    return (
      <div className={styles.field}>
        <label className={styles.label}>{label}</label>
        <div className={styles.variantChips}>
          {variants!.map((vs, i) => {
            const lbl = (vs.title as string) || (vs.description as string) || (vs.type as string) || `Option ${i + 1}`;
            const selected = i === selectedVariantIndex;
            return (
              <button
                key={i}
                type="button"
                ref={(el) => { chipRefs.current[i] = el; }}
                tabIndex={0}
                onKeyDown={(e) => handleChipKeyDown(e, i)}
                className={`${styles.variantChip} ${selected ? styles.variantChipSelected : styles.variantChipUnselected}`}
                onClick={() => selectVariant(i)}
                aria-pressed={selected}
              >
                {lbl}
              </button>
            );
          })}
        </div>
        {!matchesAny && value !== undefined && <div style={{ color: 'red', marginTop: 6 }}>Value does not match any option</div>}
        <div style={{ marginTop: 8 }}>
          <JsonInstanceForm schema={variants![selectedVariantIndex]} value={value} onChange={onChange} />
        </div>
      </div>
    );
  }

  // Handle primitive types
  if (type === "string") {
    if (schema.enum && Array.isArray(schema.enum)) {
      return (
        <div className={styles.field}>
          <label className={styles.label}>{(schema.description as string) || "Select value"}</label>
          <select
            className={styles.select}
            value={(value as string) || ""}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">-- Select --</option>
            {schema.enum.map((option) => (
              <option key={String(option)} value={String(option)}>
                {String(option)}
              </option>
            ))}
          </select>
        </div>
      );
    }
      // If `const` is present, render a readonly display with the const value
      if (constValue !== undefined) {
        // Ensure parent has the const value
        if (value !== constValue) {
          // propagate once
          setTimeout(() => onChange(constValue), 0);
        }
        return (
          <div className={styles.field}>
            <label className={styles.label}>{(schema.description as string) || "Const value"}</label>
            <div style={{ padding: 8, background: '#fafafa', border: '1px solid #eee', borderRadius: 6 }}>{String(constValue)}</div>
          </div>
        );
      }

      // If schema indicates image/data-url, show an image upload + preview for instance form
      if (format === 'data-url' || (contentMediaType && String(contentMediaType).startsWith('image'))) {
        return (
          <div className={styles.field}>
            <label className={styles.label}>{(schema.description as string) || "Image"}</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {typeof value === 'string' && /^data:image\//i.test(value) && (
                <img src={value as string} alt="preview" style={{ maxWidth: 240, maxHeight: 160, border: '1px solid #ddd', borderRadius: 6 }} />
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
                      onChange(result);
                    }
                  };
                  reader.readAsDataURL(f);
                }}
              />
              {typeof value === 'string' && /^data:image\//i.test(value) && (
                <button className={styles.removeButton} type="button" onClick={() => onChange('')}>Remove image</button>
              )}
            </div>
          </div>
        );
      }

      return (
        <div className={styles.field}>
          <label className={styles.label}>{(schema.description as string) || "Enter text"}</label>
          <>
            <input
              className={styles.input}
              // Use format hints to pick an input type when appropriate
              type={writeOnlyAttr ? 'password' : (format === 'email' ? 'email' : format === 'uri' ? 'url' : format === 'date' ? 'date' : format === 'date-time' ? 'datetime-local' : 'text')}
              value={(value as string) || ""}
              onChange={(e) => {
                const v = e.target.value;
                const err = validateValueAgainstSchema(v, schema);
                setInputError(err);
                if (!err) onChange(v);
              }}
              placeholder="Enter value..."
              minLength={minLength}
              maxLength={maxLength}
              pattern={patternAttr}
              readOnly={readOnlyAttr}
            />
            {deprecatedFlag && <div style={{ color: '#b07', marginTop: 6, fontSize: 12 }}>Deprecated</div>}
            {inputError && <div style={{ color: 'red', marginTop: 6 }}>{inputError}</div>}
          </>
        </div>
      );
  }
  
  // Persist instance value to localStorage whenever it changes
  useEffect(() => {
    try {
      if (value === undefined) {
        localStorage.removeItem(storageKey);
      } else {
        localStorage.setItem(storageKey, JSON.stringify(value));
      }
    } catch (e) {
      // ignore storage errors
    }
  }, [value, storageKey]);

  // Load instance when storageKey (schema) changes: prefer stored value, else default when no value provided
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (JSON.stringify(parsed) !== JSON.stringify(value)) {
          onChange(parsed);
        }
      } else if (value === undefined) {
        onChange(getDefaultValue(schema as Record<string, unknown>));
      }
    } catch (e) {
      // ignore
    }
  }, [storageKey]);

  // Attach a non-passive native wheel listener to the number input so we can call
  // preventDefault without the browser passive-listener warning.
  useEffect(() => {
    const el = numberInputRef.current;
    if (!el) return;
    const handler = (ee: WheelEvent) => {
      ee.preventDefault();
      const e = ee as WheelEvent & { shiftKey?: boolean };
      const dir = e.deltaY > 0 ? -1 : 1;
      const multiplier = e.shiftKey ? 10 : 1;
      const inc = (schema.multipleOf as number | undefined) ?? (step as number) ?? 1;
      const countDecimals = (n: number) => {
        const s = String(n);
        if (s.indexOf('e-') >= 0) {
          const m = /e-(\d+)$/.exec(s);
          if (m) return parseInt(m[1], 10);
        }
        if (s.indexOf('.') >= 0) return s.split('.')[1].length;
        return 0;
      };
      const cur = typeof value === 'number' ? (value as number) : (el.value === '' ? 0 : parseFloat(el.value));
      const precision = Math.max(countDecimals(inc), countDecimals(cur));
      const factor = Math.pow(10, precision);
      const stepInt = Math.round(inc * factor) * multiplier;
      const curInt = Math.round(cur * factor);
      const newVal = (curInt + dir * stepInt) / factor;
      const err = validateValueAgainstSchema(newVal, schema);
      setInputError(err);
      if (!err) onChange(newVal);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler as EventListener);
  }, [numberInputRef, schema, step, value, onChange]);

  if (type === "number") {
    if (schema.enum && Array.isArray(schema.enum)) {
      return (
        <div className={styles.field}>
          <label className={styles.label}>{(schema.description as string) || "Select value"}</label>
          <select
            className={styles.select}
            value={String(value) || ""}
            onChange={(e) => onChange(parseFloat(e.target.value))}
          >
            <option value="">-- Select --</option>
            {schema.enum.map((option) => (
              <option key={String(option)} value={String(option)}>
                {String(option)}
              </option>
            ))}
          </select>
        </div>
      );
    }
  
    return (
      <div className={styles.field}>
        <label className={styles.label}>{(schema.description as string) || "Enter number"}</label>
        <>
          <input
            ref={numberInputRef}
            className={styles.input}
            type="number"
            value={(value as number) || ""}
            onChange={(e) => {
              const raw = e.target.value;
              const parsed = raw === '' ? '' : parseFloat(raw);
              const err = validateValueAgainstSchema(parsed, schema);
              setInputError(err);
              if (!err) onChange(parsed === '' ? 0 : parsed);
            }}
            placeholder="Enter number..."
            min={min}
            max={max}
            step={step}
            readOnly={readOnlyAttr}
          />
          {inputError && <div style={{ color: 'red', marginTop: 6 }}>{inputError}</div>}
        </>
      </div>
    );
  }

  if (type === "boolean") {
    const description = schema.description as string | undefined;
    return (
      <div className={styles.field}>
        <div className={styles.checkboxContainer}>
          <input
            className={styles.checkbox}
            type="checkbox"
            id={`bool-${Math.random()}`}
            checked={(value as boolean) || false}
            onChange={(e) => onChange(e.target.checked)}
          />
          {description && (
            <label className={styles.checkboxLabel} htmlFor={`bool-${Math.random()}`}>
              {description}
            </label>
          )}
        </div>
      </div>
    );
  }

  if (type === "object") {
    const properties = (schema.properties as Record<string, Record<string, unknown>>) || {};
    const patternProperties = (schema.patternProperties as Record<string, Record<string, unknown>>) || {};
    const additionalProperties = schema.additionalProperties;

    // Only required properties should be present initially
    const required = (schema.required as string[]) || [];
    let objectValue = (value as Record<string, unknown>) || {};
    // If value is empty, initialize with only required properties
    if (Object.keys(objectValue).length === 0 && Object.keys(properties).length > 0) {
      objectValue = {};
      required.forEach((key) => {
        if (properties[key]) {
          objectValue[key] = getDefaultValue(properties[key]);
        }
      });
    }

    const updateProperty = (key: string, newValue: unknown) => {
      onChange({
        ...objectValue,
        [key]: newValue,
      });
    };

    const getSchemaForProperty = (key: string): Record<string, unknown> | null => {
      if (properties[key]) return properties[key];
      for (const [pattern, subschema] of Object.entries(patternProperties)) {
        try {
          if (new RegExp(pattern).test(key)) return subschema;
        } catch (_) {
          // invalid regex - skip
        }
      }
      return getAdditionalPropertiesSchema(additionalProperties);
    };

    // Properties matched by fixed `properties` or existing required keys
    const fixedKeys = Object.keys(properties).filter(k => !k.startsWith('__'));
    
    // keys in instance that are NOT in fixed properties
    const extraInstanceKeys = Object.keys(objectValue).filter(k => !k.startsWith('__') && !properties[k]);

    const handleAddProperty = (key: string) => {
      const propSchema = getSchemaForProperty(key) || {};
      onChange({
        ...objectValue,
        [key]: getDefaultValue(propSchema),
      });
    };

    const [newPropKey, setNewPropKey] = useState("");

    return (
      <div className={styles.objectContainer}>
        {/* Render fixed properties */}
        {fixedKeys.map((key) => {
          const propSchema = properties[key];
          const isRequired = required.includes(key);
          if (!isRequired && !(key in objectValue)) return null;
          const handleRemoveProperty = () => {
            const rest = { ...objectValue };
            delete rest[key];
            onChange(rest);
          };
          return (
            <div key={key} className={styles.propertyGroup}>
              <div className={styles.propertyHeader}>
                <span className={styles.propertyName}>
                  {key}
                  {isRequired && <span className={styles.requiredMark}>*</span>}
                  {!!propSchema.writeOnly && <span className={styles.badge} style={{ backgroundColor: '#e8f0ff', color: '#2b6cb0' }}>writeOnly</span>}
                  {!!propSchema.readOnly && <span className={styles.badge} style={{ backgroundColor: '#f5f5f5', color: '#666' }}>readOnly</span>}
                </span>
                {!isRequired && (
                  <button className={styles.removeButton} type="button" onClick={handleRemoveProperty}>×</button>
                )}
              </div>
              <JsonInstanceForm
                schema={propSchema}
                value={objectValue[key]}
                onChange={(newValue) => updateProperty(key, newValue)}
              />
            </div>
          );
        })}

        {/* Render pattern/additional properties already in instance */}
        {extraInstanceKeys.map((key) => {
          const propSchema = getSchemaForProperty(key);
          if (!propSchema) {
            return (
              <div key={key} className={styles.propertyGroup} style={{ border: '1px solid #ffcdd2' }}>
                <div className={styles.propertyHeader}>
                  <span className={styles.propertyName} style={{ color: '#d32f2f' }}>{key} (unexpected)</span>
                  <button className={styles.removeButton} type="button" onClick={() => {
                    const rest = { ...objectValue };
                    delete rest[key];
                    onChange(rest);
                  }}>×</button>
                </div>
                <div style={{ fontSize: 12, color: '#d32f2f', padding: '4px 8px' }}>
                  Property not allowed by schema (additionalProperties: false)
                </div>
              </div>
            );
          }
          return (
            <div key={key} className={styles.propertyGroup}>
              <div className={styles.propertyHeader}>
                <span className={styles.propertyName}>
                  {key} <span style={{ fontSize: 11, color: '#666', fontWeight: 400 }}>(matched)</span>
                  {!!propSchema.writeOnly && <span className={styles.badge} style={{ backgroundColor: '#e8f0ff', color: '#2b6cb0' }}>writeOnly</span>}
                  {!!propSchema.readOnly && <span className={styles.badge} style={{ backgroundColor: '#f5f5f5', color: '#666' }}>readOnly</span>}
                </span>
                <button className={styles.removeButton} type="button" onClick={() => {
                  const rest = { ...objectValue };
                  delete rest[key];
                  onChange(rest);
                }}>×</button>
              </div>
              <JsonInstanceForm
                schema={propSchema}
                value={objectValue[key]}
                onChange={(newValue) => updateProperty(key, newValue)}
              />
            </div>
          );
        })}

        {/* Add defined properties */}
        {fixedKeys.filter(k => !required.includes(k) && !(k in objectValue)).length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {fixedKeys.filter(k => !required.includes(k) && !(k in objectValue)).map((key) => (
              <button
                key={key}
                className={styles.addButton}
                type="button"
                onClick={() => handleAddProperty(key)}
              >
                +{key}
              </button>
            ))}
          </div>
        )}

        {/* Add arbitrary property (if matches pattern or additionalProperties allowed) */}
        {(Object.keys(patternProperties).length > 0 || additionalProperties !== false) && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <input
              className={styles.input}
              style={{ width: 160, height: 32, fontSize: 13 }}
              placeholder="New property name..."
              value={newPropKey}
              onChange={e => setNewPropKey(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newPropKey.trim()) {
                  const key = newPropKey.trim();
                  if (!(key in objectValue)) {
                    const sch = getSchemaForProperty(key);
                    if (sch) {
                      handleAddProperty(key);
                      setNewPropKey("");
                    }
                  }
                }
              }}
            />
            <button
              className={styles.addButton}
              type="button"
              disabled={!newPropKey.trim() || !!getSchemaForProperty(newPropKey.trim()) === false || (newPropKey.trim() in objectValue)}
              onClick={() => {
                const key = newPropKey.trim();
                handleAddProperty(key);
                setNewPropKey("");
              }}
            >
              + Add
            </button>
          </div>
        )}
      </div>
    );
  }

  if (type === "array") {
    const items = (schema.items as Record<string, unknown>) || { type: "string" };
    let arrayValue: unknown[];
    if (Array.isArray(value)) {
      arrayValue = value;
    } else if (value && typeof value === "object") {
      // If value is an object (from previous object type), wrap it in an array
      arrayValue = [value];
    } else {
      arrayValue = [];
    }

    // refs
    const lastPrimitiveRef = useRef<HTMLDivElement | null>(null);
    const lastObjectRef = useRef<HTMLDivElement | null>(null);

    const itemsSchema = items as Record<string, unknown>;
    const isObjectItem = itemsSchema.type === 'object';
    const uniqueRequired = !!schema.uniqueItems;
    const defaultValueForAdd = getDefaultValue(itemsSchema);
    const keyFor = (v: unknown) => (typeof v === 'object' ? JSON.stringify(v) : String(v));

    

    // compute duplicates
    const counts = new Map<string, number>();
    arrayValue.forEach(v => {
      const k = keyFor(v);
      counts.set(k, (counts.get(k) || 0) + 1);
    });
    const hasDuplicates = uniqueRequired && Array.from(counts.values()).some(c => c > 1);

    const addItemHandler = (toAdd: unknown) => {
      if (uniqueRequired && arrayValue.some(v => keyFor(v) === keyFor(toAdd))) return;
      onChange([...arrayValue, toAdd]);
    };

    const removeItem = (index: number) => {
      const newArray = arrayValue.filter((_, i) => i !== index);
      onChange(newArray);
    };

    const updateItem = (index: number, newValue: unknown) => {
      const newArray = [...arrayValue];
      newArray[index] = newValue;
      onChange(newArray);
    };

    // Navigation state for array editing (object items)
    const parentKey = typeof value === 'object' && value !== null ? (value as any).id ?? value : value;
    const [currentIndexMap, setCurrentIndexMap] = useState<Record<string, number>>({});
    const key = String(parentKey ?? 'default');
    const currentIndex = currentIndexMap[key] ?? 0;
    const maxIndex = arrayValue.length - 1;
    useEffect(() => {
      setCurrentIndexMap((map) => ({ ...map, [key]: 0 }));
    }, [key, arrayValue.length]);
    const setCurrentIndex = (idx: number) => {
      setCurrentIndexMap((map) => ({ ...map, [key]: idx }));
    };

    const focusObjectForm = () => {
      if (isObjectItem && lastObjectRef.current) {
        const el = lastObjectRef.current.querySelector('input,select,textarea,button');
        if (el && 'focus' in el) (el as HTMLElement).focus();
      } else if (!isObjectItem && lastPrimitiveRef.current) {
        const el = lastPrimitiveRef.current.querySelector('input,select,textarea,button');
        if (el && 'focus' in el) (el as HTMLElement).focus();
      }
    };
    const goPrev = () => { setCurrentIndex(Math.max(0, currentIndex - 1)); setTimeout(focusObjectForm, 0); };
    const goNext = () => { setCurrentIndex(Math.min(maxIndex, currentIndex + 1)); setTimeout(focusObjectForm, 0); };
    if (currentIndex > maxIndex && maxIndex >= 0) setCurrentIndex(maxIndex);

    

    if (isObjectItem) {
      const navButtons = (
        <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
          {currentIndex > 0 && (<button className={styles.addButton} onClick={goPrev}>&lt;&lt;</button>)}
          {currentIndex < maxIndex && (<button className={styles.addButton} onClick={goNext}>&gt;&gt;</button>)}
        </div>
      );
      return (
        <div className={styles.arrayContainer}>
          {arrayValue.length > 0 && (
            <div className={styles.arrayItem}>
              <div className={styles.arrayItemHeader}>
                <span className={styles.arrayItemLabel}>Item {currentIndex + 1} of {arrayValue.length}</span>
                <button className={styles.removeButton} onClick={() => { removeItem(currentIndex); setCurrentIndex(Math.max(0, currentIndex - 1)); }}>Remove</button>
              </div>
              {navButtons}
              <div ref={lastObjectRef} tabIndex={-1} style={{ outline: 'none' }}>
                <JsonInstanceForm schema={itemsSchema} value={arrayValue[currentIndex]} onChange={(newValue) => updateItem(currentIndex, newValue)} />
              </div>
              {navButtons}
            </div>
          )}
          <button className={styles.addButton} onClick={() => addItemHandler(defaultValueForAdd)} style={{ marginTop: 12 }} disabled={uniqueRequired && arrayValue.some(v => keyFor(v) === keyFor(defaultValueForAdd))} title={uniqueRequired && arrayValue.some(v => keyFor(v) === keyFor(defaultValueForAdd)) ? 'Would create duplicate item' : undefined}>
            + Add Item
          </button>
        </div>
      );
    }

    // Primitive items
    return (
      <div className={styles.arrayContainer}>
        {hasDuplicates && <div style={{ color: '#e53935', marginBottom: 8 }}>Array requires unique items — duplicates detected.</div>}
        {/* draft input moved below to avoid appearing above the existing list */}
        {arrayValue.map((item, idx) => {
          const k = keyFor(item);
          const isDup = uniqueRequired && (counts.get(k) || 0) > 1;
          return (
            <div key={idx} className={styles.arrayItem} style={isDup ? { border: '1px solid #e53935' } : undefined}>
              <div className={styles.arrayItemHeader}>
                <span className={styles.arrayItemLabel}>Item {idx + 1} of {arrayValue.length}</span>
                {isDup && <span style={{ color: '#e53935', marginLeft: 8, fontSize: 13 }}>Duplicate</span>}
                <button className={styles.removeButton} onClick={() => removeItem(idx)}>Remove</button>
              </div>
              <div ref={idx === arrayValue.length - 1 ? lastPrimitiveRef : undefined} tabIndex={-1} style={{ outline: 'none' }} onBlur={() => {
                if (!uniqueRequired) return;
                const seen = new Set<string>();
                const deduped: unknown[] = [];
                arrayValue.forEach(v => {
                  const kk = keyFor(v);
                  if (!seen.has(kk)) { seen.add(kk); deduped.push(v); }
                });
                if (deduped.length !== arrayValue.length) onChange(deduped);
              }}>
                <JsonInstanceForm schema={itemsSchema} value={item} onChange={(newValue) => updateItem(idx, newValue)} />
              </div>
            </div>
          );
        })}
        {/* Add button: always append a default item (no draft input) */}
        <div style={{ marginTop: 12 }}>
          <button
            className={styles.addButton}
            onClick={() => addItemHandler(defaultValueForAdd)}
            disabled={uniqueRequired && arrayValue.some(v => keyFor(v) === keyFor(defaultValueForAdd))}
            title={uniqueRequired && arrayValue.some(v => keyFor(v) === keyFor(defaultValueForAdd)) ? 'Would create duplicate item' : undefined}
          >
            + Add Item
          </button>
        </div>
      </div>
    );
  }

  if (type === "null") {
    return (
      <div className={styles.field}>
        <span className={styles.nullValue}>null</span>
      </div>
    );
  }

  return <div className={styles.field}>Unsupported type: {type}</div>;
}

function getDefaultValue(schema: Record<string, unknown>): unknown {
  if (schema.const !== undefined) return schema.const;

  // Support defaulting for oneOnly / oneOf by delegating to first variant
  if (schema.oneOnly && Array.isArray(schema.oneOnly) && schema.oneOnly.length > 0) {
    return getDefaultValue(schema.oneOnly[0] as Record<string, unknown>);
  }
  if (schema.oneOf && Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return getDefaultValue(schema.oneOf[0] as Record<string, unknown>);
  }

  const type = schema.type as string;

  if (schema.enum && Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }

  switch (type) {
    case "string":
      return "";
    case "number":
      return 0;
    case "boolean":
      return false;
    case "object": {
      const properties = (schema.properties as Record<string, Record<string, unknown>>) || {};
      const obj: Record<string, unknown> = {};
      Object.entries(properties).forEach(([key, propSchema]) => {
        obj[key] = getDefaultValue(propSchema);
      });
      return obj;
    }
    case "array":
      return [];
    case "null":
      return null;
    default:
      return null;
  }
}
