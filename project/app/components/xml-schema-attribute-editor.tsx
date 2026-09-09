import { Trash2 } from "lucide-react";
import {
  ATTRIBUTE_USE_VALUES,
  XSD_BUILTIN_SIMPLE_TYPES,
} from "../utils/xml-schema-constants";
import type { XmlSchemaAttributeEditorProps } from './xml-schema-form.types';
import { displayValue } from './xml-schema-form.utils';

export function XmlSchemaAttributeEditor({
  attributes,
  onChange,
}: XmlSchemaAttributeEditorProps) {
  const addAttribute = () => {
    onChange([
      ...attributes,
      {
        "@name": `attr${attributes.length + 1}`,
        "@type": "xs:string",
      },
    ]);
  };

  const removeAttribute = (index: number) => {
    onChange(attributes.filter((_, attributeIndex) => attributeIndex !== index));
  };

  const updateAttribute = (index: number, field: string, value: string) => {
    const updated = [...attributes];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  return (
    <div style={{ marginBottom: 12, padding: '12px', backgroundColor: '#f9f9f9', borderRadius: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>
        Attributes (xs:attribute definitions)
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {attributes.map((attribute, index) => (
          <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 8, backgroundColor: 'white', borderRadius: 3, border: '1px solid #eee' }}>
            <input
              type="text"
              value={displayValue(attribute['@name'], '')}
              onChange={(event) => updateAttribute(index, '@name', event.target.value)}
              placeholder="Name"
              style={{ flex: 1, padding: '4px 8px', border: '1px solid #ddd', borderRadius: 3 }}
            />
            <select
              value={displayValue(attribute['@type'], 'xs:string')}
              onChange={(event) => updateAttribute(index, '@type', event.target.value)}
              style={{ flex: 1, padding: '4px 8px', border: '1px solid #ddd', borderRadius: 3 }}
            >
              {XSD_BUILTIN_SIMPLE_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
            <select
              value={displayValue(attribute['@use'], 'optional')}
              onChange={(event) => updateAttribute(index, '@use', event.target.value)}
              style={{ flex: 0.7, padding: '4px 8px', border: '1px solid #ddd', borderRadius: 3 }}
            >
              {ATTRIBUTE_USE_VALUES.map((use) => (
                <option key={use} value={use}>{use}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => removeAttribute(index)}
              style={{ padding: 4, backgroundColor: '#ffebee', color: '#c62828', border: 'none', borderRadius: 3, cursor: 'pointer' }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addAttribute}
        style={{ marginTop: 8, padding: '6px 12px', backgroundColor: '#e3f2fd', color: '#1565c0', border: 'none', borderRadius: 3, cursor: 'pointer' }}
      >
        + Add Attribute
      </button>
    </div>
  );
}