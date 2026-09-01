import React from 'react';
import type { Node as FlowNode } from 'reactflow';
import type { NodeData, PropertyFieldConfig } from './types';

/**
 * Configuration for editable xs:schema properties.
 * Easily extensible to add more properties like blockDefault, finalDefault, version, id, etc.
 */
export const XML_SCHEMA_PROPERTY_CONFIGS: PropertyFieldConfig[] = [];

/**
 * Editor for schema root node attributes:
 * - core fields: targetNamespace, elementFormDefault, attributeFormDefault
 * - optional fields shown via add badges: blockDefault, finalDefault, version, xml:lang, xmlns:xsi, xsi:schemaLocation
 */
export function SpecialAttributesEditor({
  node,
  onChange,
  namespacesEditor,
  coreAttributesLayout = 'stack',
}: {
  node: FlowNode<NodeData>;
  onChange: (patch: Partial<NodeData>) => void;
  namespacesEditor?: React.ReactNode;
  coreAttributesLayout?: 'stack' | 'wrap';
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

  const coreLayoutStyle =
    coreAttributesLayout === 'wrap'
      ? { display: 'flex', flexWrap: 'wrap' as const, gap: 8, alignItems: 'flex-start' as const }
      : { display: 'flex', flexDirection: 'column' as const, gap: 4 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 500 }}>Attributes</span>

      <div style={coreLayoutStyle}>
        {coreAttrs.map((attr) => {
          const isDefined = !!data[attr.key];
          const isExpanded = expandedAttrs.has(attr.display);
          if (!isDefined && !isExpanded) return null;

          return (
            <div
              key={attr.key}
              style={
                coreAttributesLayout === 'wrap'
                  ? { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 'fit-content' }
                  : { display: 'flex', flexDirection: 'column', gap: 2 }
              }
            >
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
                  x
                </button>
              </div>
            </div>
          );
        })}
      </div>

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
                  x
                </button>
              </div>
            </div>
          );
        })}
      </div>

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

      {namespacesEditor}
    </div>
  );
}