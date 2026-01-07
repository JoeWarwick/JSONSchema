import { useState } from "react";
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
    const objectValue = (value as Record<string, unknown>) || {};
    const required = (schema.required as string[]) || [];

    const updateProperty = (key: string, newValue: unknown) => {
      onChange({
        ...objectValue,
        [key]: newValue,
      });
    };

    return (
      <div className={styles.objectContainer}>
        {Object.entries(properties).map(([key, propSchema]) => {
          const isRequired = required.includes(key);
          return (
            <div key={key} className={styles.propertyGroup}>
              <div className={styles.propertyHeader}>
                <span className={styles.propertyName}>
                  {key.charAt(0).toUpperCase() + key.slice(1)}
                  {isRequired && <span className={styles.requiredMark}>*</span>}
                </span>
              </div>
              <JsonInstanceForm
                schema={propSchema}
                value={objectValue[key]}
                onChange={(newValue) => updateProperty(key, newValue)}
              />
            </div>
          );
        })}
      </div>
    );
  }

  if (type === "array") {
    const items = (schema.items as Record<string, unknown>) || { type: "string" };
    const arrayValue = (value as unknown[]) || [];

    const addItem = () => {
      const defaultValue = getDefaultValue(items);
      onChange([...arrayValue, defaultValue]);
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

    return (
      <div className={styles.arrayContainer}>
        {arrayValue.map((item, index) => (
          <div key={index} className={styles.arrayItem}>
            <div className={styles.arrayItemHeader}>
              <span className={styles.arrayItemLabel}>Item {index + 1}</span>
              <button className={styles.removeButton} onClick={() => removeItem(index)}>
                Remove
              </button>
            </div>
            <JsonInstanceForm schema={items} value={item} onChange={(newValue) => updateItem(index, newValue)} />
          </div>
        ))}
        <button className={styles.addButton} onClick={addItem}>
          + Add Item
        </button>
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
