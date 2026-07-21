import React from 'react';
import ReactFlow, { Background, Controls, ReactFlowProvider, useEdgesState, useNodesState } from 'reactflow';
import type { Node } from 'reactflow';
import type { ErdModel } from '../types/erd';
import { erdModelToGraph, type ErdTableNodeData } from '../utils/erd-graph';
import { normalizeErdModel, renameErdTable, relatedRelationships, updateErdRelationship, updateErdTableColumn } from '../utils/erd-model-editing';
import { erdNodeTypes } from './erd-node-types';
import { HorizontalSplitPane } from './ui/split-pane';
import styles from './erd-editor.module.css';
import 'reactflow/dist/style.css';

const commonPropertyTypes = ['string', 'int', 'long', 'short', 'decimal', 'double', 'float', 'bool', 'DateTime', 'Guid'];

export interface ErdEditorProps {
  model: ErdModel;
  onChange?: (model: ErdModel) => void;
}

export function ErdEditor({ model, onChange }: ErdEditorProps) {
  const normalizedModel = React.useMemo(() => normalizeErdModel(model), [model]);
  const graph = React.useMemo(() => erdModelToGraph(normalizedModel), [normalizedModel]);
  const [nodes, setNodes, onNodesChange] = useNodesState<ErdTableNodeData>(graph.nodes);
  const [edges, , onEdgesChange] = useEdgesState(graph.edges);
  const [selectedTableId, setSelectedTableId] = React.useState<string | null>(null);
  const selectedTable = normalizedModel.tables.find((table) => table.id === selectedTableId);
  const tableRelationships = React.useMemo(() => selectedTable ? relatedRelationships(normalizedModel, selectedTable.id) : [], [normalizedModel, selectedTable]);

  React.useEffect(() => {
    setNodes(graph.nodes);
  }, [graph.nodes, setNodes]);

  const commitModel = (nextModel: ErdModel) => {
    onChange?.(nextModel);
  };

  const renameSelectedTable = (name: string) => {
    if (!selectedTable || !name.trim() || name === selectedTable.name) return;
    const nextName = name.trim();
    const nextModel = renameErdTable(normalizedModel, selectedTable.id, nextName);
    setSelectedTableId(nextName);
    commitModel(nextModel);
  };

  const updateSelectedColumn = (columnName: string, nextColumn: Record<string, unknown>) => {
    if (!selectedTable) return;
    const currentColumn = selectedTable.columns.find((column) => column.name === columnName);
    if (!currentColumn) return;
    commitModel(updateErdTableColumn(normalizedModel, selectedTable.id, columnName, {
      ...currentColumn,
      ...nextColumn,
    } as typeof currentColumn));
  };

  const updateSelectedRelationship = (relationshipId: string, nextRelationship: Partial<ErdModel['relationships'][number]>) => {
    commitModel(updateErdRelationship(normalizedModel, relationshipId, (relationship) => ({
      ...relationship,
      ...nextRelationship,
      foreignKeyColumns: nextRelationship.foreignKeyColumns ?? relationship.foreignKeyColumns,
    })));
  };

  return (
    <HorizontalSplitPane className={styles.erdEditor} defaultRightWidth={320} minRightWidth={280} minLeftWidth={360}>
      <div className={styles.flowPanel}>
        <div className={styles.flow}>
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={erdNodeTypes}
              fitView
              onNodesChange={onNodesChange}
              onNodeDragStop={(_, node) => {
                if (!onChange) return;
                commitModel({
                  ...normalizedModel,
                  nodePositions: {
                    ...normalizedModel.nodePositions,
                    [node.id]: node.position,
                  },
                });
              }}
              onEdgesChange={onEdgesChange}
              onNodeClick={(_, node: Node<ErdTableNodeData>) => setSelectedTableId(node.id)}
            >
              <Controls />
              <Background />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
      </div>
      <div className={styles.sidebarPanel}>
        <aside className={styles.sidebar} aria-label="ERD details">
          <h2>{selectedTable ? selectedTable.name : 'Entity Relationship Diagram'}</h2>
          {selectedTable ? (
          <div className={styles.sidebarSection}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Table name</span>
              <input aria-label="Table name" className={styles.fieldInput} value={selectedTable.name} onChange={(event) => renameSelectedTable(event.target.value)} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>CLR name</span>
              <input aria-label="CLR name" className={styles.fieldInput} value={selectedTable.clrName} onChange={(event) => commitModel(normalizeErdModel({
                ...normalizedModel,
                tables: normalizedModel.tables.map((table) => table.id === selectedTable.id ? { ...table, clrName: event.target.value } : table),
              }))} />
            </label>

            <div className={styles.sidebarSection}>
              <h3 className={styles.sectionTitle}>Properties</h3>
              {selectedTable.columns.length === 0 ? <p className={styles.muted}>No properties available for this table.</p> : selectedTable.columns.map((column) => (
                <div key={column.name} className={styles.propertyCard}>
                  <div className={styles.fieldRow}>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Name</span>
                      <input className={styles.fieldInput} value={column.name} onChange={(event) => updateSelectedColumn(column.name, { name: event.target.value })} />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Type</span>
                      <select className={styles.fieldInput} value={column.type} onChange={(event) => updateSelectedColumn(column.name, { type: event.target.value })}>
                        {column.type && !commonPropertyTypes.includes(column.type) && <option value={column.type}>{column.type}</option>}
                        {commonPropertyTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className={styles.checkboxRow}>
                    <label className={styles.checkboxLabel}><input type="checkbox" checked={column.isNullable} onChange={(event) => updateSelectedColumn(column.name, { isNullable: event.target.checked })} /> Nullable</label>
                    <label className={styles.checkboxLabel}><input type="checkbox" checked={column.isPrimaryKey} onChange={(event) => updateSelectedColumn(column.name, { isPrimaryKey: event.target.checked })} /> Primary key</label>
                    <span className={styles.columnBadge}>{column.isForeignKey ? `FK${column.foreignKeyTarget ? ` → ${column.foreignKeyTarget}` : ''}` : 'Regular'}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.sidebarSection}>
              <h3 className={styles.sectionTitle}>Relationships</h3>
              {tableRelationships.length === 0 ? <p className={styles.muted}>No relationships involve this table.</p> : tableRelationships.map((relationship, index) => (
                <div key={index} className={styles.relationshipCard}>
                  <div className={styles.relationshipHeader}>
                    <strong>{relationship.dependentTable} → {relationship.principalTable}</strong>
                  </div>
                  <div className={styles.fieldRow}>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Dependent table</span>
                      <select className={styles.fieldInput} value={relationship.dependentTable} onChange={(event) => updateSelectedRelationship(relationship.id, { dependentTable: event.target.value })}>
                        {normalizedModel.tables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Principal table</span>
                      <select className={styles.fieldInput} value={relationship.principalTable} onChange={(event) => updateSelectedRelationship(relationship.id, { principalTable: event.target.value })}>
                        {normalizedModel.tables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}
                      </select>
                    </label>
                  </div>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Foreign key columns</span>
                    <input
                      className={styles.fieldInput}
                      value={relationship.foreignKeyColumns.join(', ')}
                      onChange={(event) => updateSelectedRelationship(relationship.id, {
                        foreignKeyColumns: event.target.value.split(',').map((column) => column.trim()).filter(Boolean),
                      })}
                    />
                  </label>
                  <div className={styles.fieldRow}>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Dependent cardinality</span>
                      <select className={styles.fieldInput} value={relationship.dependentCardinality} onChange={(event) => updateSelectedRelationship(relationship.id, { dependentCardinality: event.target.value as ErdModel['relationships'][number]['dependentCardinality'] })}>
                        <option value="one">one</option>
                        <option value="zero-or-one">zero-or-one</option>
                        <option value="many">many</option>
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Principal cardinality</span>
                      <select className={styles.fieldInput} value={relationship.principalCardinality} onChange={(event) => updateSelectedRelationship(relationship.id, { principalCardinality: event.target.value as ErdModel['relationships'][number]['principalCardinality'] })}>
                        <option value="one">one</option>
                        <option value="zero-or-one">zero-or-one</option>
                        <option value="many">many</option>
                      </select>
                    </label>
                  </div>
                  <div className={styles.fieldRow}>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Dependent navigation</span>
                      <input className={styles.fieldInput} value={relationship.dependentNavigation || ''} onChange={(event) => updateSelectedRelationship(relationship.id, { dependentNavigation: event.target.value || undefined })} />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Principal navigation</span>
                      <input className={styles.fieldInput} value={relationship.principalNavigation || ''} onChange={(event) => updateSelectedRelationship(relationship.id, { principalNavigation: event.target.value || undefined })} />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
          ) : <p>Select a table to inspect it.</p>}
          {normalizedModel.diagnostics.length > 0 && (
            <div className={styles.diagnostics} role="status">
              {normalizedModel.diagnostics.map((diagnostic, index) => <div key={`${diagnostic.message}-${index}`}>{diagnostic.message}</div>)}
            </div>
          )}
        </aside>
      </div>
    </HorizontalSplitPane>
  );
}
