import React from 'react';
import type { Node as FlowNode } from 'reactflow';
import type { NodeData, XmlNodeRhsEditorProps } from './types';
import { PropertyForm, XmlAnnotationFieldAuto } from './xml-editor-controls';
import { XML_SCHEMA_PROPERTY_CONFIGS, SpecialAttributesEditor } from './xml-schema-root-settings-controls';

function NamespacesListEditor({
  node,
  onChange,
}: {
  node: FlowNode<NodeData>;
  onChange: (patch: Partial<NodeData>) => void;
}) {
  const data = (node.data || {}) as any;
  const namespaces = (data.xmlnsNamespaces as Array<{ prefix: string; uri: string }>) || [];
  const [newPrefix, setNewPrefix] = React.useState('');
  const [newUri, setNewUri] = React.useState('');

  const handleAdd = () => {
    if (!newPrefix.trim() || !newUri.trim()) return;
    const updated = [...namespaces, { prefix: newPrefix, uri: newUri }];
    onChange({ id: node.id, xmlnsNamespaces: updated });
    setNewPrefix('');
    setNewUri('');
  };

  const handleUpdate = (index: number, field: 'prefix' | 'uri', value: string) => {
    const updated = namespaces.map((ns, i) =>
      i === index ? { ...ns, [field]: value } : ns
    );
    onChange({ id: node.id, xmlnsNamespaces: updated });
  };

  const handleRemove = (index: number) => {
    onChange({ id: node.id, xmlnsNamespaces: namespaces.filter((_, i) => i !== index) });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 500 }}>Custom Namespaces (xmlns:*)</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {namespaces.map((ns, index) => (
          <div key={index} style={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
            <input
              type="text"
              placeholder="prefix"
              value={ns.prefix}
              onChange={(e) => handleUpdate(index, 'prefix', e.target.value)}
              style={{
                padding: 4,
                borderRadius: 3,
                border: '1px solid #ddd',
                fontSize: 11,
                minWidth: 80,
              }}
            />
            <input
              type="text"
              placeholder="URI"
              value={ns.uri}
              onChange={(e) => handleUpdate(index, 'uri', e.target.value)}
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
              onClick={() => handleRemove(index)}
              title="Remove namespace"
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
              ✕
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        <input
          type="text"
          placeholder="prefix"
          value={newPrefix}
          onChange={(e) => setNewPrefix(e.target.value)}
          style={{
            padding: 4,
            borderRadius: 3,
            border: '1px solid #ddd',
            fontSize: 11,
            minWidth: 80,
          }}
        />
        <input
          type="text"
          placeholder="URI"
          value={newUri}
          onChange={(e) => setNewUri(e.target.value)}
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
          onClick={handleAdd}
          disabled={!newPrefix.trim() || !newUri.trim()}
          title="Add namespace"
          style={{
            padding: '2px 6px',
            borderRadius: 3,
            border: '1px solid #ccc',
            backgroundColor: !newPrefix.trim() || !newUri.trim() ? '#f0f0f0' : '#f9f9f9',
            cursor: !newPrefix.trim() || !newUri.trim() ? 'not-allowed' : 'pointer',
            fontSize: 12,
            fontWeight: 500,
            color: !newPrefix.trim() || !newUri.trim() ? '#aaa' : '#666',
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}

function ImportsListEditor({
  node,
  onChange,
}: {
  node: FlowNode<NodeData>;
  onChange: (patch: Partial<NodeData>) => void;
}) {
  const data = (node.data || {}) as any;
  const imports = (data.xmlImports as Array<{ namespace: string; schemaLocation: string }>) || [];
  const [newNamespace, setNewNamespace] = React.useState('');
  const [newSchemaLocation, setNewSchemaLocation] = React.useState('');

  const handleAdd = () => {
    if (!newNamespace.trim() || !newSchemaLocation.trim()) return;
    const updated = [...imports, { namespace: newNamespace, schemaLocation: newSchemaLocation }];
    onChange({ id: node.id, xmlImports: updated });
    setNewNamespace('');
    setNewSchemaLocation('');
  };

  const handleUpdate = (index: number, field: 'namespace' | 'schemaLocation', value: string) => {
    const updated = imports.map((imp, i) =>
      i === index ? { ...imp, [field]: value } : imp
    );
    onChange({ id: node.id, xmlImports: updated });
  };

  const handleRemove = (index: number) => {
    onChange({ id: node.id, xmlImports: imports.filter((_, i) => i !== index) });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 500 }}>xs:import Declarations</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {imports.map((imp, index) => (
          <div key={index} style={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
            <input
              type="text"
              placeholder="namespace"
              value={imp.namespace}
              onChange={(e) => handleUpdate(index, 'namespace', e.target.value)}
              style={{
                padding: 4,
                borderRadius: 3,
                border: '1px solid #ddd',
                fontSize: 11,
                minWidth: 100,
              }}
            />
            <input
              type="text"
              placeholder="schemaLocation"
              value={imp.schemaLocation}
              onChange={(e) => handleUpdate(index, 'schemaLocation', e.target.value)}
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
              onClick={() => handleRemove(index)}
              title="Remove import"
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
              ✕
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        <input
          type="text"
          placeholder="namespace"
          value={newNamespace}
          onChange={(e) => setNewNamespace(e.target.value)}
          style={{
            padding: 4,
            borderRadius: 3,
            border: '1px solid #ddd',
            fontSize: 11,
            minWidth: 100,
          }}
        />
        <input
          type="text"
          placeholder="schemaLocation"
          value={newSchemaLocation}
          onChange={(e) => setNewSchemaLocation(e.target.value)}
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
          onClick={handleAdd}
          disabled={!newNamespace.trim() || !newSchemaLocation.trim()}
          title="Add import"
          style={{
            padding: '2px 6px',
            borderRadius: 3,
            border: '1px solid #ccc',
            backgroundColor: !newNamespace.trim() || !newSchemaLocation.trim() ? '#f0f0f0' : '#f9f9f9',
            cursor: !newNamespace.trim() || !newSchemaLocation.trim() ? 'not-allowed' : 'pointer',
            fontSize: 12,
            fontWeight: 500,
            color: !newNamespace.trim() || !newSchemaLocation.trim() ? '#aaa' : '#666',
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function XmlSchemaEditor(props: XmlNodeRhsEditorProps) {
  const {
    node,
    onChange,
    onToggleShowAnnotations,
    xmlShowAnnotations,
    onToggleShowImports,
    xmlShowImports,
  } = props;

  if (!node) return null;
  const data = (node.data || {}) as any;

  const handleToggleShowAnnotations = (show: boolean) => {
    if (onToggleShowAnnotations) {
      onToggleShowAnnotations(show);
    }
  };

  const handleToggleShowImports = (show: boolean) => {
    if (onToggleShowImports) {
      onToggleShowImports(show);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PropertyForm
        title="Schema Editor"
        configs={XML_SCHEMA_PROPERTY_CONFIGS}
        nodeData={data}
        nodeId={node.id}
        onChange={onChange}
      />
      <SpecialAttributesEditor
        node={node}
        onChange={onChange}
        namespacesEditor={<NamespacesListEditor node={node} onChange={onChange} />}
      />

      {onToggleShowAnnotations ? (
        <div style={{ padding: '8px 12px', border: '1px solid var(--graph-node-border)', borderRadius: 4, backgroundColor: 'var(--graph-node-bg-subtle)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--graph-node-text)' }}>
            <input
              type="checkbox"
              checked={xmlShowAnnotations === true}
              onChange={(e) => handleToggleShowAnnotations(e.currentTarget.checked)}
              style={{ cursor: 'pointer' }}
            />
            <span>Show Annotations</span>
          </label>
          {xmlShowAnnotations === true && (
            <div style={{ fontSize: 11, color: 'var(--graph-muted)', marginTop: 6 }}>
              Annotation entries follow document order.
            </div>
          )}
        </div>
      ) : null}

      <ImportsListEditor node={node} onChange={onChange} />

      {onToggleShowImports ? (
        <div style={{ padding: '8px 12px', border: '1px solid var(--graph-node-border)', borderRadius: 4, backgroundColor: 'var(--graph-node-bg-subtle)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--graph-node-text)' }}>
            <input
              type="checkbox"
              checked={xmlShowImports === true}
              onChange={(e) => handleToggleShowImports(e.currentTarget.checked)}
              style={{ cursor: 'pointer' }}
            />
            <span>Show Imports</span>
          </label>
          {xmlShowImports === true && (
            <div style={{ fontSize: 11, color: 'var(--graph-muted)', marginTop: 6 }}>
              Import entries follow document order.
            </div>
          )}
        </div>
      ) : null}

      <XmlAnnotationFieldAuto nodeId={node.id} data={data} onChange={onChange} />
    </div>
  );
}
