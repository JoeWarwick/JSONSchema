// Type guard for schema.items with enum
function isSchemaWithEnum(obj: unknown): obj is { enum: Array<string | number>; type?: string } {
  return !!obj && typeof obj === 'object' && Array.isArray((obj as any).enum);
}
import { useState, useEffect } from "react";
import {
  addPropertyToSchema,
  removePropertyFromSchema,
  updateNestedPropertyInSchema
} from "./schema-behaviors";
import { validateSchema } from "../utils/schema-generator";
import { ChevronDown, ChevronRight } from "lucide-react";
import styles from "./schema-editor-form.module.css";

interface SchemaEditorFormProps {
  schema: Record<string, unknown>;
  onChange: (schema: Record<string, unknown>) => void;
  path?: string[];
  onViewSource?: () => void;
  onPropertyRename?: (oldName: string, newName: string, path?: string[]) => void;
}

export function SchemaEditorForm({ schema, onChange, path = [], onViewSource, onPropertyRename }: SchemaEditorFormProps) {
  const [validationError, setValidationError] = useState<string | null>(null);

  const updateSchema = (updates: Partial<Record<string, unknown>>) => {
    let nextSchema: Record<string, unknown>;
    // If type is being changed from object to array, hoist the object into items
    if (updates.type === "array" && schema.type === "object") {
      const { type, ...rest } = schema;
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
      let items: Record<string, unknown> = { type: "string" };
      if (schema.enum) {
        items.enum = schema.enum;
      }
      // Remove enum from root
      const { enum: _removed, ...rest } = schema;
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

  const removeProperty = (propertyName: string) => {
    const nextSchema = removePropertyFromSchema(schema, propertyName);
    updateSchema(nextSchema as any);
  };

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

  return (
    <>
      {validationError && (
        <div style={{ color: 'red', marginBottom: 8 }}>{validationError}</div>
      )}
      <div className={styles.container}>

        <div className={styles.fieldGroup}>
          <div className={styles.fieldRow}>
            <label className={styles.label}>Type</label>
            <select
              className={styles.select}
              value={(schema.type as string) || "string"}
              onChange={(e) => updateSchema({ type: e.target.value })}
            >
              <option value="string">String</option>
              <option value="number">Number</option>
              <option value="boolean">Boolean</option>
              <option value="object">Object</option>
              <option value="array">Array</option>
              <option value="null">Null</option>
            </select>
          </div>

          {/* Show enum checkbox for string and number types */}
          {(schema.type === "string" || schema.type === "number" || !schema.type) && (
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
        </div>

        {schema.type === "object" && (
          <div className={styles.nestedContainer}>
            <div className={styles.propertiesHeader}>
              <h3 className={styles.propertyTitle}>Properties</h3>
              <button className={styles.addButton} onClick={addProperty}>
                Add Property
              </button>
            </div>
            {Object.entries((schema.properties as Record<string, unknown>) || {}).map(
              ([propertyName, propertySchema]) => (
                <PropertyEditor
                  key={propertyName}
                  propertyName={propertyName}
                  propertySchema={propertySchema as Record<string, unknown>}
                  isRequired={((schema.required as string[]) || []).includes(propertyName)}
                  onUpdate={(newValue) => updateNestedProperty(propertyName, newValue)}
                  onRemove={() => removeProperty(propertyName)}
                  onToggleRequired={() => toggleRequired(propertyName)}
                  onRename={(newName) => updatePropertyName(propertyName, newName)}
                />
              ),
            )}
          </div>
        )}

        {schema.type === "array" && (() => {
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
        {!!schema.enum && Array.isArray(schema.enum) && schema.type !== "array" && (
          <div className={styles.nestedContainer}>
            <h3 className={styles.propertyTitle}>Allowed Values</h3>
            <EnumEditor
              values={(schema.enum as Array<string | number>) || []}
              onChange={(newEnum) => updateSchema({ enum: newEnum })}
              type={(schema.type as string) || "string"}
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
  onRemove: () => void;
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

  const addValue = () => {
    const newValue = type === "number" ? editingValues.length + 1 : `option${editingValues.length + 1}`;
    const newValues = [...editingValues, newValue];
    setEditingValues(newValues);
    onChange(newValues);
  };

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
  onRemove,
  onToggleRequired,
  onRename,
}: PropertyEditorProps) {
  const [editingName, setEditingName] = useState(propertyName);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);

  return (
    <div className={styles.fieldGroup}>
      <div className={styles.propertyHeader}>
        <input
          className={styles.input}
          value={editingName}
          onChange={(e) => setEditingName(e.target.value)}
          onBlur={() => onRename(editingName)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onRename(editingName);
            }
          }}
        />
        <button className={styles.removeButton} onClick={onRemove}>
          Remove
        </button>
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
