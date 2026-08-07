import { useState, useRef, useEffect, useMemo } from "react";
import styles from "./json-instance-form.module.css";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip/tooltip";
import { Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { 
  generateRefExpansionKey, 
  generateCompositorVariantKey, 
  generateEditorLayoutKey,
  XML_COMPOSITOR_TYPES,
  ATTRIBUTE_USE_VALUES,
  XSD_BUILTIN_SIMPLE_TYPES
} from "../utils/xml-schema-constants";
import { renderTooltipContentChildren } from './tooltip-utils';

/**
 * Props for XMLSchema Form Component
 * Used for editing XSD (XML Schema Definition) structures
 */
interface XmlSchemaFormProps {
  // The XSD schema node to edit (e.g., xs:element, xs:complexType, xs:attribute definition)
  schema: Record<string, unknown>;
  
  // Called when schema structure is modified
  onChange: (newSchema: Record<string, unknown>) => void;
  
  // Full schema document for resolving named types and refs
  rootSchema?: Record<string, unknown>;
  
  // Path to this node within the schema (for storage keys)
  xmlPath?: string[];
  
  // If true, auto-focus the first input when mounted
  autoFocus?: boolean;
}

/**
 * Represents an expanded ref - tracks which named types/refs are currently expanded inline
 */
interface ExpandedRef {
  name: string;
  refPath: string[]; // XML path to the actual definition
  isEditing: boolean; // Whether we're currently editing this expanded ref
}

/**
 * Helper to extract XML attributes from a node (e.g., @name, @type, @minOccurs)
 */
const getXmlAttrs = (node: Record<string, unknown> | null | undefined) => {
  if (!node || typeof node !== 'object') return {};
  return Object.fromEntries(
    Object.entries(node).filter(([key]) => key.startsWith('@'))
  );
};

/**
 * Navigate to a node at the given XML path within schema
 * @param schema Root schema document
 * @param path Array of XML path segments (e.g., ['xs:schema', 'xs:complexType[0]', 'xs:attribute'])
 * @returns The node at that path, or null if not found
 */
const getAtXmlPath = (schema: Record<string, unknown>, path: string[]): unknown => {
  let current: any = schema;
  for (const segment of path) {
    if (!current || typeof current !== 'object') return null;
    
    // Handle array indices: "xs:attribute[0]" → "xs:attribute" + [0]
    const match = segment.match(/^([^\[]+)\[(\d+)\]$/);
    if (match) {
      const [, key, indexStr] = match;
      const index = parseInt(indexStr, 10);
      const arr = current[key];
      if (!Array.isArray(arr) || index < 0 || index >= arr.length) return null;
      current = arr[index];
    } else {
      current = current[segment];
    }
  }
  return current;
};

/**
 * Check if a schema node represents a reference to a named type
 * @param schema The node to check
 * @returns { refName: string, refPath: string[] } or null
 */
const detectNamedTypeRef = (schema: Record<string, unknown>): { refName: string; refPath: string[] } | null => {
  const type = schema['@type'];
  if (type && typeof type === 'string') {
    // For xs:element type="SomeType" or xs:attribute type="SomeType"
    // We need to resolve this to the actual definition
    // Named types are typically at xs:schema/xs:complexType[@name] or xs:schema/xs:simpleType[@name]
    const typeName = type.replace(/^xs:/, ''); // Remove xs: prefix
    return {
      refName: typeName,
      refPath: ['xs:schema', `xs:complexType[@name='${typeName}']`] // Simplified path
    };
  }
  
  const ref = schema['@ref'];
  if (ref && typeof ref === 'string') {
    // For xs:element ref="SomeElement"
    const refName = ref.replace(/^xs:/, '');
    return {
      refName,
      refPath: ['xs:schema', `xs:element[@name='${refName}']`]
    };
  }

  return null;
};

/**
 * Get schema identity for storage keys (prefer explicit IDs, fall back to hash)
 */
const getSchemaIdentity = (schema: Record<string, unknown> | undefined): string => {
  if (!schema) return 'unknown';
  if (schema.$ref && typeof schema.$ref === 'string') return `$ref:${schema.$ref}`;
  if (schema.$id && typeof schema.$id === 'string') return `$id:${schema.$id}`;
  if (schema.name && typeof schema.name === 'string') return `named:${schema.name}`;
  try {
    const hash = JSON.stringify(schema).substring(0, 32);
    return `hash:${hash}`;
  } catch {
    return 'unknown';
  }
};

/**
 * Main XML Schema Form Component
 * Enables editing of XSD schema structures with support for:
 * - Inline ref expansion with warning banner
 * - Compositor (sequence/choice/all) variant selection
 * - Attribute definitions (xs:attribute)
 * - Element recursion and cardinality (minOccurs/maxOccurs)
 */
export function XmlSchemaForm({ 
  schema: rawSchema, 
  onChange, 
  rootSchema,
  xmlPath = [],
  autoFocus = false
}: XmlSchemaFormProps) {
  const rootSchemaRef = rootSchema ?? rawSchema;
  const schemaIdentity = useMemo(() => getSchemaIdentity(rawSchema), [rawSchema]);
  const pathKey = xmlPath.join('.');

  // DEBUG: Log immediately
  if (typeof window !== 'undefined' && (window as any).__xmlSchemaDebug === undefined) {
    (window as any).__xmlSchemaDebug = true;
    console.log('[XmlSchemaForm Mount]', {
      schemaKeys: Object.keys(rawSchema || {}),
      schemaIdentity,
      hasXsAttribute: !!(rawSchema && (rawSchema as any)['xs:attribute']),
      hasXsSequence: !!(rawSchema && (rawSchema as any)['xs:sequence']),
      hasXsChoice: !!(rawSchema && (rawSchema as any)['xs:choice']),
      hasXsAll: !!(rawSchema && (rawSchema as any)['xs:all']),
      rawSchemaKeys: rawSchema ? Object.keys(rawSchema).slice(0, 20) : 'null'
    });
  }

  // ============================================================================
  // State Management
  // ============================================================================

  // Track which refs are currently expanded inline
  const [expandedRefs, setExpandedRefs] = useState<ExpandedRef[]>([]);
  
  // Track which ref is currently being edited (triggers warning banner)
  const [editingRefName, setEditingRefName] = useState<string | null>(null);

  // Compositor variant selection: track which compositor type is selected
  // key = xmlPath, value = compositor type index ('xs:sequence', 'xs:choice', 'xs:all')
  const [selectedCompositorIndex, setSelectedCompositorIndex] = useState<Record<string, number>>(() => {
    if (typeof localStorage === 'undefined') return {};
    try {
      const key = generateCompositorVariantKey(schemaIdentity, pathKey);
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  // Track expanded/collapsed state of inline elements and types
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => {
      if (typeof localStorage === 'undefined') return new Set();
      try {
        const key = generateEditorLayoutKey(schemaIdentity, pathKey);
        const stored = localStorage.getItem(key);
        return stored ? new Set(JSON.parse(stored)) : new Set();
      } catch {
        return new Set();
      }
    }
  );

  // ============================================================================
  // Storage & Persistence Helpers
  // ============================================================================

  const saveCompositorSelection = (compositorIndex: number) => {
    if (typeof localStorage === 'undefined') return;
    try {
      const key = generateCompositorVariantKey(schemaIdentity, pathKey);
      localStorage.setItem(key, JSON.stringify({ ...selectedCompositorIndex, [pathKey]: compositorIndex }));
    } catch (err) {
      console.warn('Failed to save compositor selection:', err);
    }
  };

  const saveExpandedPaths = (paths: Set<string>) => {
    if (typeof localStorage === 'undefined') return;
    try {
      const key = generateEditorLayoutKey(schemaIdentity, pathKey);
      localStorage.setItem(key, JSON.stringify(Array.from(paths)));
    } catch (err) {
      console.warn('Failed to save expanded paths:', err);
    }
  };

  const togglePathExpansion = (path: string) => {
    const updated = new Set(expandedPaths);
    if (updated.has(path)) {
      updated.delete(path);
    } else {
      updated.add(path);
    }
    setExpandedPaths(updated);
    saveExpandedPaths(updated);
  };

  // ============================================================================
  // Ref Expansion Handlers
  // ============================================================================

  const expandRef = (refName: string, refPath: string[]) => {
    setExpandedRefs([
      ...expandedRefs,
      { name: refName, refPath, isEditing: false }
    ]);
  };

  const collapseRef = (refName: string) => {
    setExpandedRefs(expandedRefs.filter(ref => ref.name !== refName));
    setEditingRefName(null);
  };

  const toggleRefEditing = (refName: string) => {
    setEditingRefName(editingRefName === refName ? null : refName);
  };

  // ============================================================================
  // Compositor Helpers
  // ============================================================================

  const detectCompositor = (): { type: string; children: any[] } | null => {
    // Check if this schema node has compositor children (sequence/choice/all)
    for (const compositorType of XML_COMPOSITOR_TYPES) {
      const children = rawSchema[compositorType];
      if (Array.isArray(children) && children.length > 0) {
        return { type: compositorType, children };
      }
    }
    return null;
  };

  const getAvailableCompositors = (): string[] => {
    const available: string[] = [];
    for (const compositorType of XML_COMPOSITOR_TYPES) {
      if (Array.isArray(rawSchema[compositorType])) {
        available.push(compositorType);
      }
    }
    return available;
  };

  const selectCompositor = (index: number) => {
    const available = getAvailableCompositors();
    if (index < 0 || index >= available.length) return;
    
    const selectedType = available[index];
    const currentType = detectCompositor()?.type;
    
    if (selectedType === currentType) return; // Already selected
    
    // Update state
    setSelectedCompositorIndex(idx => ({ ...idx, [pathKey]: index }));
    saveCompositorSelection(index);
    
    // Mutation: In a real implementation, we would transform the schema
    // to switch between compositor types (e.g., xs:sequence -> xs:choice)
    // For now, we just track the selection. The actual mutation would need
    // to be more sophisticated to handle converting between compositor types.
  };

  const updateCompositorCardinality = (minOccurs?: number, maxOccurs?: string) => {
    const compositor = detectCompositor();
    if (!compositor) return;
    
    const updated = { ...rawSchema };
    if (minOccurs !== undefined) {
      updated['@minOccurs'] = minOccurs;
    }
    if (maxOccurs !== undefined) {
      updated['@maxOccurs'] = maxOccurs;
    }
    onChange(updated);
  };

  // ============================================================================
  // Event Handlers - Attributes
  // ============================================================================

  const addAttribute = (name: string, type: string = 'xs:string', use: string = 'optional') => {
    const attributes = (rawSchema['xs:attribute'] as any[]) || [];
    const newAttribute = {
      '@name': name,
      '@type': type,
      ...(use !== 'optional' && { '@use': use })
    };
    onChange({
      ...rawSchema,
      'xs:attribute': [...attributes, newAttribute]
    });
  };

  const removeAttribute = (index: number) => {
    const attributes = (rawSchema['xs:attribute'] as any[]) || [];
    onChange({
      ...rawSchema,
      'xs:attribute': attributes.filter((_, i) => i !== index)
    });
  };

  const updateAttribute = (index: number, field: string, value: string) => {
    const attributes = (rawSchema['xs:attribute'] as any[]) || [];
    const updated = [...attributes];
    updated[index] = { ...updated[index], [field]: value };
    onChange({
      ...rawSchema,
      'xs:attribute': updated
    });
  };

  // ============================================================================
  // Ref Resolution & Recursive Rendering
  // ============================================================================

  const resolveRefDefinition = (refName: string, refPath: string[]): any => {
    if (!rootSchema) return null;
    
    // Navigate rootSchema using refPath to find the actual definition
    let current = rootSchema;
    for (const segment of refPath) {
      if (!current || typeof current !== 'object') break;
      
      // Handle array indices like "xs:complexType[0]"
      const arrayMatch = segment.match(/^(.+)\[(\d+)\]$/);
      if (arrayMatch) {
        const [, key, index] = arrayMatch;
        current = current[key]?.[parseInt(index)];
      } else {
        current = current[segment];
      }
    }
    
    return current || null;
  };

  const renderElementChildren = () => {
    const elements = (rawSchema['xs:element'] as any[]) || [];
    if (elements.length === 0) return null;

    return (
      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #eee' }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: 13 }}>Element Children</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {elements.map((element, idx) => {
            const elemName = element['@name'] || `Element ${idx}`;
            const elemType = element['@type'];
            const minOccurs = element['@minOccurs'] || '1';
            const maxOccurs = element['@maxOccurs'] || '1';
            const isExpanded = expandedPaths.has(`element-${idx}`);

            return (
              <div
                key={idx}
                style={{
                  border: '1px solid #e0e0e0',
                  borderRadius: 4,
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    backgroundColor: '#f9f9f9',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                  onClick={() => togglePathExpansion(`element-${idx}`)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                    <span style={{ fontSize: 14 }}>
                      {isExpanded ? '▼' : '▶'}
                    </span>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 12 }}>{elemName}</span>
                      {elemType && (
                        <span style={{ fontSize: 11, color: '#666', marginLeft: 8 }}>
                          {elemType}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#999', whiteSpace: 'nowrap' }}>
                    {minOccurs}..{maxOccurs}
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ padding: '12px', backgroundColor: 'white', borderTop: '1px solid #eee' }}>
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 11, display: 'block', marginBottom: 4, fontWeight: 600 }}>
                        Element Type
                      </label>
                      <input
                        type="text"
                        value={elemType || ''}
                        onChange={(e) => {
                          const updated = [...elements];
                          updated[idx] = { ...updated[idx], '@type': e.target.value };
                          onChange({ ...rawSchema, 'xs:element': updated });
                        }}
                        placeholder="e.g., xs:string"
                        style={{
                          width: '100%',
                          padding: '4px 8px',
                          border: '1px solid #ddd',
                          borderRadius: 3,
                          fontSize: 12
                        }}
                      />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                      <div>
                        <label style={{ fontSize: 11, display: 'block', marginBottom: 4, fontWeight: 600 }}>
                          minOccurs
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={minOccurs}
                          onChange={(e) => {
                            const updated = [...elements];
                            updated[idx] = { ...updated[idx], '@minOccurs': e.target.value };
                            onChange({ ...rawSchema, 'xs:element': updated });
                          }}
                          placeholder="1"
                          style={{
                            width: '100%',
                            padding: '4px 8px',
                            border: '1px solid #ddd',
                            borderRadius: 3,
                            fontSize: 12
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, display: 'block', marginBottom: 4, fontWeight: 600 }}>
                          maxOccurs
                        </label>
                        <input
                          type="text"
                          value={maxOccurs}
                          onChange={(e) => {
                            const updated = [...elements];
                            updated[idx] = { ...updated[idx], '@maxOccurs': e.target.value };
                            onChange({ ...rawSchema, 'xs:element': updated });
                          }}
                          placeholder="1 or unbounded"
                          style={{
                            width: '100%',
                            padding: '4px 8px',
                            border: '1px solid #ddd',
                            borderRadius: 3,
                            fontSize: 12
                          }}
                        />
                      </div>
                    </div>

                    {elemType && elemType.startsWith('xs:') === false && rootSchema && (
                      <div style={{ fontSize: 11, color: '#666', padding: '8px', backgroundColor: '#f0f0f0', borderRadius: 3 }}>
                        Custom type "{elemType}" can be edited in its definition
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ============================================================================
  // Render
  // ============================================================================

  const attrs = getXmlAttrs(rawSchema);
  const nodeName = attrs['@name'] || attrs['@ref'] || 'Schema Node';
  const compositor = detectCompositor();
  const hasAttributes = Array.isArray(rawSchema['xs:attribute']) && rawSchema['xs:attribute'].length > 0;
  const expandedRef = expandedRefs.find(r => r.isEditing);

  return (
    <div className={styles.field}>
      {/* ====== Warning Banner for Ref Editing ====== */}
      {expandedRef && editingRefName === expandedRef.name && (
        <div style={{
          backgroundColor: '#fff3cd',
          border: '1px solid #ffc107',
          borderRadius: 4,
          padding: '12px 16px',
          marginBottom: 12,
          color: '#664d03',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <div>
            <strong>WARNING:</strong> Editing this definition affects all usages of <code>{editingRefName}</code>
            <div style={{ fontSize: 12, marginTop: 4, opacity: 0.8 }}>
              {xmlPath.length > 0 && `Location: ${xmlPath.join(' → ')}`}
            </div>
          </div>
        </div>
      )}

      {/* ====== Node Header ====== */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <h3 style={{ margin: 0, flex: 1 }}>{nodeName}</h3>
        {compositor && (
          <span style={{ fontSize: 11, backgroundColor: '#e3f2fd', color: '#1565c0', padding: '2px 8px', borderRadius: 3 }}>
            Compositor: {compositor.type}
          </span>
        )}
      </div>

      {/* DEBUG: Show schema structure for troubleshooting */}
      <details style={{ marginBottom: 12, padding: 8, backgroundColor: '#f0f0f0', borderRadius: 4, fontSize: 12 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Debug Info</summary>
        <pre style={{ margin: '8px 0 0 0', padding: 8, backgroundColor: 'white', borderRadius: 3, overflow: 'auto', maxHeight: 200, fontSize: 10 }}>
          {JSON.stringify({
            nodeName,
            schemaKeys: Object.keys(rawSchema),
            hasXsAttribute: !!rawSchema['xs:attribute'],
            hasXsSequence: !!rawSchema['xs:sequence'],
            hasXsChoice: !!rawSchema['xs:choice'],
            hasXsAll: !!rawSchema['xs:all'],
            compositor: compositor ? 'FOUND' : 'null',
            hasAttributes: hasAttributes ? 'FOUND' : 'null'
          }, null, 2)}
        </pre>
      </details>

      {/* ====== Compositor Variant Selection ====== */}
      {compositor && (
        <div style={{ marginBottom: 12, padding: '12px', backgroundColor: '#f5f5f5', borderRadius: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>
            Compositor Type
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {getAvailableCompositors().map((compositorType, idx) => {
              const isSelected = selectedCompositorIndex[pathKey] === idx;
              return (
                <button
                  key={compositorType}
                  type="button"
                  onClick={() => selectCompositor(idx)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: `2px solid ${isSelected ? '#1976d2' : '#ccc'}`,
                    backgroundColor: isSelected ? '#e3f2fd' : 'white',
                    color: isSelected ? '#1565c0' : '#333',
                    fontWeight: isSelected ? 600 : 400,
                    cursor: 'pointer'
                  }}
                >
                  {compositorType}
                </button>
              );
            })}
          </div>

          {/* Cardinality controls for compositor */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={{ fontSize: 11, display: 'block', marginBottom: 4, color: '#666' }}>
                minOccurs
              </label>
              <input
                type="number"
                min="0"
                value={rawSchema['@minOccurs'] || ''}
                onChange={(e) => updateCompositorCardinality(e.target.value ? parseInt(e.target.value) : undefined)}
                placeholder="0"
                style={{ width: '100%', padding: '4px 8px', border: '1px solid #ddd', borderRadius: 3, fontSize: 12 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, display: 'block', marginBottom: 4, color: '#666' }}>
                maxOccurs
              </label>
              <input
                type="text"
                value={rawSchema['@maxOccurs'] || ''}
                onChange={(e) => updateCompositorCardinality(undefined, e.target.value)}
                placeholder="1 or 'unbounded'"
                style={{ width: '100%', padding: '4px 8px', border: '1px solid #ddd', borderRadius: 3, fontSize: 12 }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ====== Attributes Section ====== */}
      {hasAttributes && (
        <div style={{ marginBottom: 12, padding: '12px', backgroundColor: '#f9f9f9', borderRadius: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>
            Attributes (xs:attribute definitions)
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(rawSchema['xs:attribute'] as any[]).map((attr, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 8, backgroundColor: 'white', borderRadius: 3, border: '1px solid #eee' }}>
                <input
                  type="text"
                  value={attr['@name'] || ''}
                  onChange={(e) => updateAttribute(idx, '@name', e.target.value)}
                  placeholder="Name"
                  style={{ flex: 1, padding: '4px 8px', border: '1px solid #ddd', borderRadius: 3 }}
                />
                <select
                  value={attr['@type'] || 'xs:string'}
                  onChange={(e) => updateAttribute(idx, '@type', e.target.value)}
                  style={{ flex: 1, padding: '4px 8px', border: '1px solid #ddd', borderRadius: 3 }}
                >
                  {XSD_BUILTIN_SIMPLE_TYPES.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
                <select
                  value={attr['@use'] || 'optional'}
                  onChange={(e) => updateAttribute(idx, '@use', e.target.value)}
                  style={{ flex: 0.7, padding: '4px 8px', border: '1px solid #ddd', borderRadius: 3 }}
                >
                  {ATTRIBUTE_USE_VALUES.map(use => (
                    <option key={use} value={use}>{use}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeAttribute(idx)}
                  style={{ padding: 4, backgroundColor: '#ffebee', color: '#c62828', border: 'none', borderRadius: 3, cursor: 'pointer' }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => addAttribute(`attr${(rawSchema['xs:attribute'] as any[]).length + 1}`)}
            style={{ marginTop: 8, padding: '6px 12px', backgroundColor: '#e3f2fd', color: '#1565c0', border: 'none', borderRadius: 3, cursor: 'pointer' }}
          >
            + Add Attribute
          </button>
        </div>
      )}

      {/* ====== Ref Expansion Controls ====== */}
      {(() => {
        const namedTypeRef = detectNamedTypeRef(rawSchema as any);
        if (!namedTypeRef) return null;

        const isExpanded = expandedRefs.some(r => r.name === namedTypeRef.refName);
        const isEditing = editingRefName === namedTypeRef.refName;

        return (
          <div style={{ marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => {
                if (isExpanded) {
                  collapseRef(namedTypeRef.refName);
                } else {
                  expandRef(namedTypeRef.refName, namedTypeRef.refPath);
                }
              }}
              style={{
                padding: '6px 12px',
                backgroundColor: isExpanded ? '#e3f2fd' : '#f5f5f5',
                color: isExpanded ? '#1565c0' : '#333',
                border: `1px solid ${isExpanded ? '#1976d2' : '#ccc'}`,
                borderRadius: 4,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 14
              }}
            >
              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              {isExpanded ? 'Collapse' : 'Expand'} Named Type: <code>{namedTypeRef.refName}</code>
            </button>

            {isExpanded && (
              <div style={{ marginTop: 12, paddingLeft: 16, borderLeft: '3px solid #1976d2' }}>
                <button
                  type="button"
                  onClick={() => toggleRefEditing(namedTypeRef.refName)}
                  style={{
                    marginBottom: 12,
                    padding: '4px 8px',
                    backgroundColor: isEditing ? '#fff3cd' : '#f0f0f0',
                    border: `1px solid ${isEditing ? '#ffc107' : '#ccc'}`,
                    borderRadius: 3,
                    cursor: 'pointer',
                    fontSize: 12
                  }}
                >
                  {isEditing ? '✓ Editing Definition' : '✎ Edit Definition'}
                </button>
                
                <div style={{
                  padding: 12,
                  backgroundColor: '#f9f9f9',
                  borderRadius: 4,
                  border: '1px solid #e0e0e0'
                }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: 11, color: '#666' }}>
                    Expanded definition for: <code>{namedTypeRef.refName}</code>
                  </p>
                  {(() => {
                    const resolvedDef = resolveRefDefinition(namedTypeRef.refName, namedTypeRef.refPath);
                    return resolvedDef ? (
                      <div style={{ 
                        padding: '12px', 
                        backgroundColor: 'white', 
                        borderRadius: 3,
                        border: '1px solid #ddd'
                      }}>
                        <XmlSchemaForm
                          schema={resolvedDef}
                          onChange={(updatedDef) => {
                            // When editing an expanded ref, update the actual definition in rootSchema
                            if (isEditing && rootSchema) {
                              let updated = { ...rootSchema };
                              let current: any = updated;
                              const pathToUpdate = namedTypeRef.refPath.slice(0, -1);
                              const lastKey = namedTypeRef.refPath[namedTypeRef.refPath.length - 1];
                              
                              for (const segment of pathToUpdate) {
                                const arrayMatch = segment.match(/^(.+)\[(\d+)\]$/);
                                if (arrayMatch) {
                                  const [, key, index] = arrayMatch;
                                  current[key] = current[key] || [];
                                  current[key][parseInt(index)] = current[key][parseInt(index)] || {};
                                  current = current[key][parseInt(index)];
                                } else {
                                  current[segment] = current[segment] || {};
                                  current = current[segment];
                                }
                              }
                              
                              const lastArrayMatch = lastKey.match(/^(.+)\[(\d+)\]$/);
                              if (lastArrayMatch) {
                                const [, key, index] = lastArrayMatch;
                                current[key] = current[key] || [];
                                current[key][parseInt(index)] = updatedDef;
                              } else {
                                current[lastKey] = updatedDef;
                              }
                              
                              onChange(updated);
                            }
                          }}
                          rootSchema={rootSchema}
                          xmlPath={[...xmlPath, namedTypeRef.refName]}
                        />
                      </div>
                    ) : (
                      <div style={{
                        padding: '12px',
                        backgroundColor: '#fff3cd',
                        borderRadius: 3,
                        border: '1px solid #ffc107',
                        color: '#664d03',
                        fontSize: 12
                      }}>
                        Could not resolve reference: {namedTypeRef.refName}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ====== Element Children and Cardinality ====== */}
      {renderElementChildren()}
    </div>
  );
}
