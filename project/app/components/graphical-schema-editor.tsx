// Enum node component for displaying enum type (no inline editor)
const EnumNode = ({ data }: { data: SchemaNodeData & { enum: string[] } }) => {
  const { label, type, ofType, enum: enumVals } = data;
  // Determine the base type for enum (string, number, etc.)
  const baseType = ofType || type || 'string';
  return (
    <div style={{
      background: '#fffbe6',
      border: '2px solid #ffe082',
      borderRadius: 8,
      padding: '10px 18px',
      marginBottom: 12,
      minWidth: 120,
      boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
      textAlign: 'left',
      position: 'relative',
    }}>
      <Handle type="target" position={Position.Left} style={{ background: '#00e676', width: 10, height: 10, borderRadius: 5 }} />
      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4, color: '#222' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{
          display: 'inline-block',
          background: '#f5f5f5',
          borderRadius: 8,
          padding: '2px 8px',
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: '0.03em',
          border: '1px solid #e0e0e0',
          marginRight: 4,
          marginBottom: 2,
        }}>
          <span style={{ color: '#2b6cb0', fontWeight: 700 }}>enum</span>
          <span style={{ color: '#888' }}>&lt;</span>
          <span style={{ color: '#43a047', fontWeight: 700 }}>{baseType}</span>
          <span style={{ color: '#888' }}>&gt;</span>
        </span>
      </div>
      {/* Enum values list removed for cleaner node UI */}
      <Handle type="source" position={Position.Right} style={{ background: '#00e676', width: 10, height: 10, borderRadius: 5 }} />
    </div>
  );
};
import React, { useState } from "react";
import { ContextMenu } from "./ContextMenu";
import {
  addPropertyToSchema,
  removePropertyFromSchema,
  schemaNodeDataToSchema
} from "./schema-behaviors";
import { Handle, Position } from "reactflow";
import ReactFlow, {
  ReactFlowProvider,
  addEdge,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
} from "reactflow";
import type { Connection, Edge, Node, OnConnect } from "reactflow"
import type { SchemaNodeData } from "./schema-behaviors";
// Editable property form for selected node
import type { Node as FlowNode } from 'reactflow';
type NodeData = Record<string, any>;
interface NodePropertyEditorProps {
  node: FlowNode<NodeData> | null;
  onChange: (patch: Partial<NodeData>) => void;
}
export const NodePropertyEditor: React.FC<NodePropertyEditorProps> = ({ node, onChange }) => {
  if (!node) return <div style={{ color: '#888', fontStyle: 'italic' }}>Select a node to edit its properties.</div>;
  const { data } = node;
  const [label, setLabel] = React.useState<string>(data.label || '');
  const [type, setType] = React.useState<string>(data.type || '');
  const [ofType, setOfType] = React.useState<string>(data.ofType || '');
  const jsonTypes = [
    { value: 'object', label: 'object' },
    { value: 'array', label: 'array' },
    { value: 'string', label: 'string' },
    { value: 'number', label: 'number' },
    { value: 'boolean', label: 'boolean' },
    { value: 'null', label: 'null' },
  ];
  // Root node is always required
  const isRoot = node.id === '1';
  const [required, setRequired] = React.useState<boolean>(isRoot ? true : !!data.required);
  const enumValues: string[] = Array.isArray(data.enum) ? data.enum : [];
  const isEnum: boolean = Array.isArray(data.enum) && data.enum.length > 0;
  const [defaultValue, setDefaultValue] = React.useState<string>(data.default ?? '');

  React.useEffect(() => {
    setLabel(data.label || '');
    setType(data.type || '');
    setOfType(data.ofType || '');
    setRequired(!!data.required);
    setDefaultValue(data.default ?? '');
  }, [node?.id]);

  // Helper to build patch for onChange
  const buildPatch = (override?: Partial<NodeData>) => {
    let patch: Partial<NodeData> = { label, type, required, ...override };
    const prevType = data.type;
    const newType = override?.type || type;
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
      let items: Record<string, unknown> = { type: 'string' };
      if (data.enum) {
        items.enum = data.enum;
      }
      const { enum: _removed, ...rest } = data;
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

  // Enum editor UI
  const [enumInput, setEnumInput] = React.useState<string>('');
  const handleAddEnum = () => {
    if (enumInput.trim() && !enumValues.includes(enumInput.trim())) {
      const newEnum = [...enumValues, enumInput.trim()];
      setEnumInput('');
      // Always include isEnum: true to keep the editor visible
      onChange(buildPatch({ enum: newEnum, isEnum: true }));
    }
  };
  const handleRemoveEnum = (v: string) => {
    // Always create a new array reference
    const newEnum = enumValues.filter((val: string) => val !== v);
    // Always include isEnum: true to keep the editor visible
    onChange(buildPatch({ enum: [...newEnum], isEnum: true }));
  };

  // Handlers for user-driven changes
  const handleLabelBlur = () => {
    if (label !== data.label) onChange(buildPatch());
  };
  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setType(e.target.value);
    onChange(buildPatch({ type: e.target.value }));
  };
  const handleOfTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setOfType(e.target.value);
    onChange(buildPatch({ ofType: e.target.value }));
  };
  const handleRequiredChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRequired(e.target.checked);
    onChange(buildPatch({ required: e.target.checked }));
  };
  const handleIsEnumChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(buildPatch({ isEnum: e.target.checked, enum: e.target.checked ? enumValues : undefined }));
  };
  const handleDefaultValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDefaultValue(e.target.value);
    onChange(buildPatch({ defaultValue: e.target.value }));
  };

  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }} onSubmit={e => e.preventDefault()}>
      <label style={{ fontWeight: 500 }}>Name
        <input value={label} onChange={e => setLabel(e.target.value)} onBlur={handleLabelBlur} style={{ width: '100%', marginTop: 2, padding: 4, borderRadius: 4, border: '1px solid #ccc' }} readOnly={isRoot} />
      </label>
      <label style={{ fontWeight: 500 }}>Type
        <select value={type} onChange={handleTypeChange} style={{ width: '100%', marginTop: 2, padding: 4, borderRadius: 4, border: '1px solid #ccc' }}>
          <option value="">Select type</option>
          {jsonTypes.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </label>
      {type === 'array' && (
        <label style={{ fontWeight: 500 }}>Of Type
          <select value={ofType} onChange={handleOfTypeChange} style={{ width: '100%', marginTop: 2, padding: 4, borderRadius: 4, border: '1px solid #ccc' }}>
            <option value="">Select type</option>
            {jsonTypes.filter(t => t.value !== 'array').map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
      )}
      {node.data.hasOwnProperty('required') && !isRoot && (
        <label style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={required} onChange={handleRequiredChange} /> Required
        </label>
      )}
      <label style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={isEnum} onChange={handleIsEnumChange} /> Enum
      </label>
      {isEnum && (
        <div>
          <label style={{ fontWeight: 500 }}>Enum Values</label>
          <ul style={{ padding: 0, margin: '4px 0 8px 0', listStyle: 'none' }}>
            {enumValues.map((v: string, i: number) => (
              <li key={i} style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                <span style={{ background: '#fffde7', border: '1px solid #ffe082', borderRadius: 6, padding: '2px 8px', fontSize: 13, marginRight: 6 }}>{v}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveEnum(v)}
                  data-testid={`remove-enum-${v}`}
                  style={{ background: 'none', border: 'none', color: '#e53935', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
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
      <label style={{ fontWeight: 500 }}>Default Value
        <input value={defaultValue} onChange={handleDefaultValueChange} style={{ width: '100%', marginTop: 2, padding: 4, borderRadius: 4, border: '1px solid #ccc' }} placeholder="Default value" />
      </label>
    </form>
  );
};

const MemoizedNodePropertyEditor = React.memo(NodePropertyEditor);

;
import "reactflow/dist/style.css";
import styles from "./graphical-schema-editor.module.css";

// Node types: object, array, primitive
export type SchemaNodeType = "object" | "array" | "string" | "number" | "boolean" | "null";

export interface GraphicalSchemaEditorProps {
  schema: Record<string, unknown>;
  onChange: (schema: Record<string, unknown>) => void;
  useTestData?: boolean;
}

// Group box for Properties/Items
const GroupBox = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div style={{
    background: '#e8fbe8',
    border: '2px dashed #7ed957',
    borderRadius: 12,
    padding: '18px 18px 12px 18px',
    margin: '0 0 24px 0',
    minWidth: 220,
    position: 'relative',
  }}>
    <div style={{
      position: 'absolute',
      top: -18,
      left: 12,
      background: '#e8fbe8',
      color: '#388e3c',
      fontWeight: 600,
      fontSize: 15,
      padding: '0 8px',
      borderRadius: 8,
      border: '1px solid #7ed957',
      zIndex: 1,
    }}>{title}</div>
    {children}
    <button style={{
      marginTop: 12,
      background: 'none',
      border: '1px dashed #7ed957',
      color: '#388e3c',
      borderRadius: 8,
      padding: '4px 12px',
      cursor: 'pointer',
      fontWeight: 500,
      fontSize: 14,
      display: 'block',
      width: '100%',
    }}>+ Add Property</button>
  </div>
);


// Custom node component that renders all data properties, with C# generic style for type if ofType is present, and required badge
const CustomNode = ({ data }: { data: SchemaNodeData & { required?: boolean } }) => {
  const { label, type, ofType, required } = data;
  return (
    <div style={{
      background: '#fff',
      border: '2px solid #b3e6b3',
      borderRadius: 8,
      padding: '10px 18px',
      marginBottom: 12,
      minWidth: 120,
      boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
      textAlign: 'left',
      position: 'relative',
    }}>
      {/* Target handle for incoming edges */}
      <Handle type="target" position={Position.Left} style={{ background: '#00e676', width: 10, height: 10, borderRadius: 5 }} />
      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4, color: '#222' }}>
        {label}
        {required && (
          <span style={{
            background: '#e53935',
            color: '#fff',
            borderRadius: 6,
            padding: '2px 8px',
            fontSize: 12,
            fontWeight: 600,
            marginLeft: 8,
            verticalAlign: 'middle',
          }}>required</span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {/* Render type as C# generic if ofType is present */}
        <span style={{
          display: 'inline-block',
          background: '#f5f5f5',
          borderRadius: 8,
          padding: '2px 8px',
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: '0.03em',
          border: '1px solid #e0e0e0',
          marginRight: 4,
          marginBottom: 2,
        }}>
          {ofType ? (
            <>
              <span style={{ color: '#2b6cb0', fontWeight: 700 }}>{type}</span>
              <span style={{ color: '#888' }}>&lt;</span>
              <span style={{ color: '#43a047', fontWeight: 700 }}>{ofType}</span>
              <span style={{ color: '#888' }}>&gt;</span>
            </>
          ) : (
            <span style={{ color: '#2b6cb0', fontWeight: 700 }}>{type}</span>
          )}
        </span>
        {/* Render all other properties except label, id, parent, type, ofType, required */}
        {Object.entries(data).map(([key, value]) => (
          key !== 'label' && key !== 'id' && key !== 'parent' && key !== 'type' && key !== 'ofType' && key !== 'required' && key !== 'enum' && key !== 'items' && value !== undefined && (
            <span key={key} style={{
              display: 'inline-block',
              background: '#eaf6ff',
              color: '#2176c7',
              borderRadius: 8,
              padding: '2px 8px',
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: '0.03em',
              border: '1px solid #b3d4fc',
              marginRight: 4,
              marginBottom: 2,
            }}>{key}: {String(value)}</span>
          )
        ))}
      </div>
      {/* Source handle for outgoing edges */}
      <Handle type="source" position={Position.Right} style={{ background: '#00e676', width: 10, height: 10, borderRadius: 5 }} />
    </div>
  );
};

// Simple SchemaCard component for displaying label and type
const SchemaCard = ({ label, type }: { label: string; type: SchemaNodeType }) => (
  <div style={{
    background: '#f5f5f5',
    border: '1px solid #b3e6b3',
    borderRadius: 8,
    padding: '8px 14px',
    marginBottom: 8,
    minWidth: 100,
    fontSize: 15,
    fontWeight: 500,
    color: '#2176c7',
    display: 'inline-block',
  }}>
    {label} <span style={{ color: '#888', fontWeight: 400 }}>({type})</span>
  </div>
);

// Root node as a group box with a property card
export const RootNode: React.FC<{ data: SchemaNodeData }> = ({ data }) => (
  <GroupBox title="Root Object">
    <div
      className="root-node"
      style={{ pointerEvents: 'none', cursor: 'default' }}
    >
      <SchemaCard label={data.label} type={data.type} />
    </div>
  </GroupBox>
);

// Properties group node type
const PropertiesGroupNode = ({ children }: { children?: React.ReactNode }) => (
  <GroupBox title="Properties">{children}</GroupBox>
);

// Items group node type
const ItemsGroupNode = ({ data }: { data: SchemaNodeData }) => (
  <GroupBox title="Items">
    <SchemaCard label={data.label} type={data.type} />
  </GroupBox>
);

const nodeTypes: { [key: string]: React.FC<any> } = {
  root: RootNode,
  property: CustomNode,
  enum: EnumNode,
  propertiesGroup: PropertiesGroupNode,
  itemsGroup: ItemsGroupNode,
};

// Only define a root node as needed (empty schema)
const initialNodes: Node<SchemaNodeData>[] = [
  {
    id: '1',
    type: 'root',
    data: { id: '1', label: 'Root', type: 'object' },
    position: { x: 0, y: 10 },
    draggable: false,
    selectable: false,
  },
];
const initialEdges: Edge[] = [];

// No longer needed: all property nodes use CustomNode

export function GraphicalSchemaEditor({ schema, onChange, useTestData }: GraphicalSchemaEditorProps) {
  // Load schema from localStorage if not provided
  const STORAGE_KEY = 'schema-sculptor-schema';
  const [loadedSchema, setLoadedSchema] = React.useState<Record<string, unknown> | null>(null);
  const initialLoadRef = React.useRef(true);
  React.useEffect(() => {
    if (!schema && !useTestData) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          setLoadedSchema(JSON.parse(raw));
        }
      } catch {}
    }
  }, [schema, useTestData]);
  // Helper to generate unique IDs
  let nodeId = 1;
  function getId() { return (nodeId++).toString(); }

  // Full schemaToGraph implementation
  const schemaToGraph = React.useCallback((schema: Record<string, unknown>): { nodes: Node<SchemaNodeData>[]; edges: Edge[] } => {
    const nodes: Node<SchemaNodeData>[] = [];
    const edges: Edge[] = [];

    function walkSchema(obj: any, parentId?: string, label?: string, x = 0, y = 0, parentRequired?: string[]): string {
      const id = getId();
      let type = obj.type || 'object';
      let ofType = undefined;
      let nodeType = 'property';
      let isRequired = false;
      // If not root, check if required
      if (parentId && parentRequired && label) {
        isRequired = parentRequired.includes(label);
      }
      let nodeData: any = { id, label: label || obj.title || (parentId ? type : 'Root'), type, parent: parentId };
      // If array, check if items is enum
      if (type === 'array' && obj.items) {
        ofType = obj.items.type || 'object';
        nodeData.ofType = ofType;
        if (Array.isArray(obj.items.enum)) {
          nodeType = 'enum';
          nodeData.enum = obj.items.enum;
        }
      }
      // If enum, use enum node type
      if (Array.isArray(obj.enum)) {
        nodeType = 'enum';
        nodeData.enum = obj.enum;
      }
      if (parentId) {
        nodeData.required = isRequired;
      }
      nodes.push({
        id,
        type: nodeType,
        data: nodeData,
        position: { x, y },
      });
      if (parentId) {
        edges.push({ id: `e${parentId}-${id}`, source: parentId, target: id, type: 'default' });
      }
      // Properties
      if (type === 'object' && obj.properties) {
        let propY = y - 80;
        for (const [key, propSchema] of Object.entries(obj.properties)) {
          walkSchema(propSchema, id, key, x + 250, propY, obj.required || []);
          propY += 140;
        }
      }
      // If array of objects, walk into properties of items, but do not create a subnode for 'items'
      if (type === 'array' && obj.items && obj.items.type === 'object' && obj.items.properties) {
        let propY = y - 80;
        for (const [key, propSchema] of Object.entries(obj.items.properties)) {
          walkSchema(propSchema, id, key, x + 250, propY, obj.items.required || []);
          propY += 140;
        }
      }
      return id;
    }
    walkSchema(schema, undefined, 'Root', 0, 200);
    return { nodes, edges };
  }, []);

  const [nodes, setNodes, onNodesChange] = useNodesState(useTestData ? initialNodes : []);
  const [edges, setEdges, onEdgesChange] = useEdgesState(useTestData ? initialEdges : []);
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  // Memoize selectedNode to avoid unnecessary re-renders
  const selectedNode = React.useMemo(() => {
    if (!selectedNodeId) return null;
    // Find by id only, not by object reference
    const found = nodes.find(n => n.id === selectedNodeId);
    // Return a stable object reference if possible
    return found ? { ...found } : null;
  }, [selectedNodeId, nodes]);

  // Node property update handler
  const handleNodePropertyChange = (patch: Partial<NodeData>) => {
    // Only patch the targeted node
    setNodes((prevNodes: Node<SchemaNodeData>[]) =>
      prevNodes.map((node: Node<SchemaNodeData>) =>
      node.id === patch.id ? { ...node, data: { ...node.data, ...patch } } : node
      )
    );

    // Helper to recursively find and update the property in the schema
    interface SchemaObject {
        id?: string;
        properties?: Record<string, SchemaObject>;
        items?: SchemaObject;
        [key: string]: any;
    }

    interface PropertyPatch {
        id?: string;
        [key: string]: any;
    }

    function updatePropertyInSchema(obj: SchemaObject, patch: PropertyPatch): boolean {
        if (!obj || typeof obj !== 'object') return false;
        // Always ensure properties exists for objects
        if (obj.type === 'object' && !obj.properties) {
          obj.properties = {};
        }
        if (obj.properties) {
          // Try to patch existing property
          for (const key of Object.keys(obj.properties)) {
            if (obj.properties[key].id === patch.id) {
              // ENUM PATCH LOGIC: If array, nest enum under items
              if (obj.properties[key].type === 'array') {
                if ('enum' in obj.properties[key]) {
                  delete obj.properties[key].enum;
                }
                if (Array.isArray(patch.enum)) {
                  if (!obj.properties[key].items) obj.properties[key].items = { type: obj.properties[key].ofType || 'string' };
                  // Always replace the enum array
                  obj.properties[key].items.enum = patch.enum.slice();
                } else if (obj.properties[key].items && 'enum' in obj.properties[key].items && (!patch.enum || !Array.isArray(patch.enum))) {
                  delete obj.properties[key].items.enum;
                }
              } else {
                if (Array.isArray(patch.enum)) {
                  obj.properties[key].enum = [...patch.enum];
                } else {
                  delete obj.properties[key].enum;
                }
              }
              return true;
            }
            if (updatePropertyInSchema(obj.properties[key], patch)) return true;
          }
          // If not found, add as a new property (using patch.label as key if available)
          if (patch.label && !Object.values(obj.properties).some(p => p.id === patch.id)) {
            return true;
          }
        }
        if (obj.items) {
          if (obj.id === patch.id) {
            if (obj.type === 'array') {
              if ('enum' in obj) {
                delete obj.enum;
              }
              if (Array.isArray(patch.enum)) {
                if (!obj.items) obj.items = { type: obj.ofType || 'string' };
                // Always replace the enum array
                obj.items.enum = patch.enum.slice();
              } else if (obj.items && 'enum' in obj.items && (!patch.enum || !Array.isArray(patch.enum))) {
                delete obj.items.enum;
              }
            } else {
              if (Array.isArray(patch.enum)) {
                obj.items.enum = [...patch.enum];
              } else {
                delete obj.items.enum;
              }
            }
            return true;
          }
          if (updatePropertyInSchema(obj.items, patch)) return true;
        }
        return false;
    }
    let updatedSchema = JSON.parse(JSON.stringify(schema));
    updatePropertyInSchema(updatedSchema, patch);
    if (updatedSchema.properties) {
      const allProps = Object.keys(updatedSchema.properties);
      updatedSchema.required = allProps.filter(
        key => updatedSchema.properties[key].required === true
      );
      if (updatedSchema.required.length === 0) delete updatedSchema.required;
    }
    onChange(updatedSchema);
  };

  // Context menu state
  const [contextMenu, setContextMenu] = React.useState<{ visible: boolean; position: { x: number; y: number }; nodeId: string | null } | null>(null);

  // Sync nodes/edges with schema prop unless using test data
  // Only reset selected node if the graph structure changes (add/remove), not for every property edit
  const prevNodeCount = React.useRef(0);
  const prevEdgeCount = React.useRef(0);
  React.useMemo(() => {
    if (useTestData) return;
    const activeSchema = schema || loadedSchema;
    if (!activeSchema) return;
    const { nodes, edges } = schemaToGraph(activeSchema);
    // Only rebuild nodes/edges if the count changes (structural change)
    if ((nodes.length !== prevNodeCount.current) || (edges.length !== prevEdgeCount.current)) {
      setNodes(nodes);
      setEdges(edges);
      setSelectedNodeId(null);
      prevNodeCount.current = nodes.length;
      prevEdgeCount.current = edges.length;
    }
    // Otherwise, do not rebuild nodes/edges (preserve selection and form)
  }, [schema, loadedSchema, setNodes, setEdges, useTestData, schemaToGraph]);

  // Two-way sync: only trigger graphToSchema when nodes/edges are changed by user actions
  const [isUserEdit, setIsUserEdit] = React.useState(false);

  // Mark as user edit when nodes/edges change via React Flow events
  const handleNodesChange = (...args: Parameters<typeof onNodesChange>) => {
    setIsUserEdit(true);
    onNodesChange(...args);
  };
  const handleEdgesChange = (...args: Parameters<typeof onEdgesChange>) => {
    setIsUserEdit(true);
    onEdgesChange(...args);
  };

  // No longer rebuild schema from graph; only patch schema directly
  // (graphToSchema removed)
  React.useEffect(() => {
    if (initialLoadRef.current || !isUserEdit) return;
    setIsUserEdit(false);
  }, [nodes, edges, schema, onChange, isUserEdit]);

  const onConnect: OnConnect = (params: Connection) => setEdges((eds: Edge[]) => addEdge(params, eds));

  // Node click handler
  const handleNodeClick = (_: any, node: Node) => {
    if (node.id === '1') return; // Prevent root node from being selected
    setSelectedNodeId(node.id);
  };

  // Node right-click handler
  const handleNodeContextMenu = (event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    if (node.id === '1') return; // Prevent root node from being right-clicked
    setContextMenu({
      visible: true,
      position: { x: event.clientX, y: event.clientY },
      nodeId: node.id,
    });
  };

  // Add Property action
  const handleAddProperty = () => {
      setNodes((prevNodes: Node<SchemaNodeData>[]) => {
        let newNodes = [...prevNodes];
        let parentNode = newNodes.find(n => n.id === contextMenu?.nodeId);
        if (!parentNode) return prevNodes;

        interface CreatePropertyNodeParams {
        parentId: string;
        parentPos: { x: number; y: number };
        }

        interface GetNextId {
        (): string;
        }

        const getNextId: GetNextId = () =>
        (Math.max(0, ...newNodes.map(n => parseInt(n.id, 10) || 0)) + 1).toString();

        const createPropertyNode = (
        parentId: string,
        parentPos: { x: number; y: number }
        ): Node<SchemaNodeData> => {
        const newId = getNextId();
        const newLabel = `newProperty${newNodes.length + 1}`;
        const propertyNode: Node<SchemaNodeData> = {
          id: newId,
          type: 'property',
          data: {
          id: newId,
          label: newLabel,
          type: 'string',
          parent: parentId,
          },
          position: {
          x: parentPos.x + 250,
          y: parentPos.y + 60 * (newNodes.length + 1),
          },
        };
        // Use functional update for setEdges to avoid stale closure
        setEdges((edges: Edge[]) => [
          ...edges,
          { id: `e${parentId}-${newId}`, source: parentId, target: newId, type: 'default' },
        ]);
        return propertyNode;
        };

        if (parentNode.data.type === 'object') {
        newNodes = [...newNodes, createPropertyNode(parentNode.id, parentNode.position)];
        } else if (parentNode.data.type === 'array' && parentNode.data.ofType === 'object') {
        // Find the items node (child of this array node with type object)
        const itemsNode = newNodes.find(
          n => n.data.parent === parentNode.id && n.data.type === 'object'
        );
        if (itemsNode) {
          newNodes = [...newNodes, createPropertyNode(itemsNode.id, itemsNode.position)];
        } else {
          // If no items node exists, create one and then add property
          const itemsId = getNextId();
          const itemsNodeObj: Node<SchemaNodeData> = {
          id: itemsId,
          type: 'property',
          data: {
            id: itemsId,
            label: 'items',
            type: 'object',
            parent: parentNode.id,
          },
          position: {
            x: parentNode.position.x + 250,
            y: parentNode.position.y,
          },
          };
          setEdges((edges: Edge[]) => [
          ...edges,
          { id: `e${parentNode.id}-${itemsId}`, source: parentNode.id, target: itemsId, type: 'default' },
          ]);
          newNodes = [
          ...newNodes,
          itemsNodeObj,
          createPropertyNode(itemsId, itemsNodeObj.position),
          ];
        }
        }
        return newNodes;
      });
      setContextMenu(null);
      };

  // Delete Property action (with confirmation)
  const handleDeleteProperty = () => {
    if (!contextMenu?.nodeId) return;
    const node = nodes.find(n => n.id === contextMenu.nodeId);
    if (!node) return;
    if (window.confirm('Are you sure you want to delete this property?')) {
      // Remove node from graph and update parent if needed
      setNodes((nds: Node<SchemaNodeData>[]) =>
        nds
          .filter((n: Node<SchemaNodeData>) => n.id !== contextMenu.nodeId)
          .map((n: Node<SchemaNodeData>) => {
        // If this node is a parent, remove property from its properties
        interface NodeWithProperties extends Node<SchemaNodeData> {
          data: SchemaNodeData & { properties?: Record<string, unknown> };
        }
        if (
          n.data.type === 'object' &&
          (n as NodeWithProperties).data.properties &&
          contextMenu.nodeId !== null &&
          (n as NodeWithProperties).data.properties?.[contextMenu.nodeId]
        ) {
          const updatedData: Record<string, unknown> = removePropertyFromSchema(
            n.data as unknown as Record<string, unknown>,
            contextMenu.nodeId
          );
          // Merge updatedData into n.data, preserving SchemaNodeData shape
          return {
            ...n,
            data: {
          ...n.data,
          ...updatedData,
          id: n.data.id,
          label: n.data.label,
          type: n.data.type,
            } as SchemaNodeData,
          };
        }
        return n;
          })
      );
      setEdges((eds: Edge[]) => eds.filter((e: Edge) => e.target !== contextMenu.nodeId && e.source !== contextMenu.nodeId));
    }
    setContextMenu(null);
  };

  // Context menu items
  const contextMenuItems = [
    {
      label: 'Add Property',
      onClick: handleAddProperty,
      disabled: (() => {
        const node = nodes.find(n => n.id === contextMenu?.nodeId);
        return !node || !(node.data.type === 'object' || (node.data.type === 'array' && node.data.ofType === 'object'));
      })(),
    },
    {
      label: 'Delete Property',
      onClick: handleDeleteProperty,
      disabled: false,
    },
  ];

  return (
    <div className={styles.graphicalEditorContainer}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges.map(e => ({ ...e, style: { stroke: '#00e676', strokeWidth: 3 } }))}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView={true}
          onNodeClick={handleNodeClick}
          onNodeContextMenu={handleNodeContextMenu}
        >
          {/* <MiniMap /> */}
          <Controls />
          <Background />
        </ReactFlow>
      </ReactFlowProvider>
      <div className={styles.editorSidebar}>
        {/* Memoize NodePropertyEditor to avoid remounts and preserve state */}
        {selectedNode && (
          <MemoizedNodePropertyEditor node={selectedNode} onChange={handleNodePropertyChange} />
        )}
        {!selectedNode && <MemoizedNodePropertyEditor node={null} onChange={handleNodePropertyChange} />}
      </div>
      {contextMenu?.visible && (
        <ContextMenu
          items={contextMenuItems}
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}


