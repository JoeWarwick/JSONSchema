import { useState, useRef, useEffect } from "react";
import styles from "./json-instance-form.module.css";

interface JsonInstanceFormProps {
  schema: Record<string, unknown>;
  value: unknown;
  onChange: (value: unknown) => void;
}

export function JsonInstanceForm({ schema, value, onChange }: JsonInstanceFormProps) {
  const type = schema.type as string;

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

    return (
      <div className={styles.field}>
        <label className={styles.label}>{(schema.description as string) || "Enter text"}</label>
        <input
          className={styles.input}
          type="text"
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter value..."
        />
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
        <input
          className={styles.input}
          type="number"
          value={(value as number) || ""}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          placeholder="Enter number..."
        />
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

    // Ref for focusing the last added item (primitive or object)
    const lastPrimitiveRef = useRef<HTMLDivElement | null>(null);
    const lastObjectRef = useRef<HTMLDivElement | null>(null);
    const addItem = () => {
      const defaultValue = getDefaultValue(items);
      onChange([...arrayValue, defaultValue]);
      setTimeout(() => {
        if (isObjectItem && lastObjectRef.current) {
          // Focus the first input/select in the object form
          const el = lastObjectRef.current.querySelector('input,select,textarea,button');
          if (el && 'focus' in el) (el as HTMLElement).focus();
        } else if (!isObjectItem && lastPrimitiveRef.current) {
          const el = lastPrimitiveRef.current.querySelector('input,select,textarea,button');
          if (el && 'focus' in el) (el as HTMLElement).focus();
        }
      }, 0);
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

    // Navigation state for array editing, unique per array instance (e.g., per user roles)
    const parentKey = typeof value === 'object' && value !== null ? (value as any).id ?? value : value;
    const [currentIndexMap, setCurrentIndexMap] = useState<Record<string, number>>({});
    const key = String(parentKey ?? 'default');
    const currentIndex = currentIndexMap[key] ?? 0;
    const maxIndex = arrayValue.length - 1;
    // Reset navigation index if parent value changes (e.g., switching users)
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
      }
    };
    const goPrev = () => {
      setCurrentIndex(Math.max(0, currentIndex - 1));
      setTimeout(focusObjectForm, 0);
    };
    const goNext = () => {
      setCurrentIndex(Math.min(maxIndex, currentIndex + 1));
      setTimeout(focusObjectForm, 0);
    };
    // Clamp currentIndex if array shrinks
    if (currentIndex > maxIndex && maxIndex >= 0) setCurrentIndex(maxIndex);

    const isObjectItem = items.type === "object";
    if (isObjectItem) {
      return (
        <div className={styles.arrayContainer}>
          {arrayValue.length > 0 && (
            <div className={styles.arrayItem}>
              <div className={styles.arrayItemHeader}>
                <span className={styles.arrayItemLabel}>Item {currentIndex + 1} of {arrayValue.length}</span>
                <button className={styles.removeButton} onClick={() => { removeItem(currentIndex); setCurrentIndex(Math.max(0, currentIndex - 1)); }}>
                  Remove
                </button>
              </div>
              <div ref={lastObjectRef} tabIndex={-1} style={{ outline: 'none' }}>
                <JsonInstanceForm schema={items} value={arrayValue[currentIndex]} onChange={(newValue) => updateItem(currentIndex, newValue)} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                {currentIndex > 0 && (
                  <button className={styles.addButton} onClick={goPrev}>&lt; Prev</button>
                )}
                {currentIndex < maxIndex && (
                  <button className={styles.addButton} onClick={goNext}>Next &gt;</button>
                )}
              </div>
            </div>
          )}
          <button className={styles.addButton} onClick={addItem} style={{ marginTop: 12 }}>
            + Add Item
          </button>
        </div>
      );
    } else {
      // Render all items for arrays of primitives (string, number, etc.)
      return (
        <div className={styles.arrayContainer}>
          {arrayValue.map((item, idx) => (
            <div key={idx} className={styles.arrayItem}>
              <div className={styles.arrayItemHeader}>
                <span className={styles.arrayItemLabel}>Item {idx + 1} of {arrayValue.length}</span>
                <button className={styles.removeButton} onClick={() => removeItem(idx)}>
                  Remove
                </button>
              </div>
              <div ref={idx === arrayValue.length - 1 ? lastPrimitiveRef : undefined} tabIndex={-1} style={{ outline: 'none' }}>
                <JsonInstanceForm schema={items} value={item} onChange={(newValue) => updateItem(idx, newValue)} />
              </div>
            </div>
          ))}
          <button className={styles.addButton} onClick={addItem} style={{ marginTop: 12 }}>
            + Add Item
          </button>
        </div>
      );
    }
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
