import { useState, useRef, useEffect } from "react";
import styles from "./json-instance-form.module.css";
import { validateValueAgainstSchema } from "../utils/validation";
// `useState` already imported above

interface JsonInstanceFormProps {
  schema: Record<string, unknown>;
  value: unknown;
  onChange: (value: unknown) => void;
}

export function JsonInstanceForm({ schema, value, onChange }: JsonInstanceFormProps) {
  const type = schema.type as string;
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
  const writeOnlyAttr = !!schema.writeOnly;
  const constValue = schema.const as unknown | undefined;

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

    // Find non-required properties not present in objectValue
    const addableProperties = Object.keys(properties).filter(
      (key) => !required.includes(key) && !(key in objectValue)
    );

    const handleAddProperty = (key: string) => {
      onChange({
        ...objectValue,
        [key]: getDefaultValue(properties[key]),
      });
    };

    return (
      <div className={styles.objectContainer}>
        {Object.entries(properties).map(([key, propSchema]) => {
          const isRequired = required.includes(key);
          // Show if required OR if instance data exists for it
          if (!isRequired && !(key in objectValue)) return null;
          const handleRemoveProperty = () => {
            const { [key]: _, ...rest } = objectValue;
            onChange(rest);
          };
          return (
            <div key={key} className={styles.propertyGroup}>
              <div className={styles.propertyHeader}>
                <span className={styles.propertyName}>
                  {key.charAt(0).toUpperCase() + key.slice(1)}
                  {isRequired && <span className={styles.requiredMark}>*</span>}
                  {(propSchema as any)?.writeOnly && <span style={{ marginLeft: 8, background: '#f0f0f0', padding: '2px 6px', borderRadius: 6, fontSize: 12, color: '#555' }}>writeOnly</span>}
                </span>
                {!isRequired && key in objectValue && (
                  <button
                    className={styles.removeButton}
                    type="button"
                    onClick={handleRemoveProperty}
                    title={`Remove ${key}`}
                    style={{ marginLeft: 8 }}
                  >
                    ×
                  </button>
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
        {addableProperties.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            {addableProperties.map((key) => (
              <button
                key={key}
                className={styles.addButton}
                type="button"
                onClick={() => handleAddProperty(key)}
                title={`Add ${key}`}
                style={{ padding: '0 12px', fontSize: '1em', borderRadius: '16px', display: 'flex', alignItems: 'center', height: 32 }}
              >
                +{key.charAt(0).toUpperCase() + key.slice(1)}
              </button>
            ))}
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
    case "object":
      const properties = (schema.properties as Record<string, Record<string, unknown>>) || {};
      const obj: Record<string, unknown> = {};
      Object.entries(properties).forEach(([key, propSchema]) => {
        obj[key] = getDefaultValue(propSchema);
      });
      return obj;
    case "array":
      return [];
    case "null":
      return null;
    default:
      return null;
  }
}
