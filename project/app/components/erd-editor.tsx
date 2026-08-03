import React from 'react';
import ReactFlow, { Background, Controls, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow } from 'reactflow';
import type { Node } from 'reactflow';
import { ChevronDown, Printer, Trash2 } from 'lucide-react';
import type { ErdModel, ErdNavigation } from '../types/erd';
import { erdModelToGraph, tableHeight, tableWidth, type ErdTableNodeData } from '../utils/erd-graph';
import { addErdRelationship, addErdTable, addErdTableColumn, deleteErdRelationship, deleteErdTable, deleteErdTableColumn, normalizeErdModel, reorderErdTableColumns, renameErdTable, relatedRelationships, resolveNavigationFocusTarget, updateErdRelationship, updateErdTableColumn } from '../utils/erd-model-editing';
import { printErdModel } from '../utils/print-erd';
import { erdNodeTypes } from './erd-node-types';
import { HorizontalSplitPane } from './ui/split-pane';
import styles from './erd-editor.module.css';
import 'reactflow/dist/style.css';

const commonPropertyTypes = ['string', 'int', 'long', 'short', 'decimal', 'double', 'float', 'bool', 'DateTime', 'DateTimeOffset', 'Guid'];

const identityColumnTypes = new Set(['int', 'long', 'short']);

function isIdentityEligibleColumnType(type: string): boolean {
  return identityColumnTypes.has(type.replace(/\?$/, ''));
}

function isTimestampColumnType(type: string): boolean {
  return ['DateTime', 'DateTimeOffset'].includes(type.replace(/\?$/, ''));
}

interface ErdFocusRequest {
  tableId: string;
  token: number;
}

/** Lives inside ReactFlowProvider so it can pan/zoom the canvas to center on a focused entity. */
function ErdFocusController({ focusRequest }: { focusRequest: ErdFocusRequest | null }) {
  const { getNode, setCenter } = useReactFlow();

  React.useEffect(() => {
    if (!focusRequest) return;
    const node = getNode(focusRequest.tableId) as Node<ErdTableNodeData> | undefined;
    if (!node) return;
    const width = node.width ?? tableWidth(node.data.table);
    const height = node.height ?? tableHeight(node.data.table);
    setCenter(node.position.x + width / 2, node.position.y + height / 2, { zoom: 1, duration: 500 });
  }, [focusRequest, getNode, setCenter]);

  return null;
}

export interface ErdEditorProps {
  model: ErdModel;
  onChange?: (model: ErdModel) => void;
}

export function ErdEditor({ model, onChange }: ErdEditorProps) {
  const normalizedModel = React.useMemo(() => normalizeErdModel(model), [model]);
  const graph = React.useMemo(() => erdModelToGraph(normalizedModel), [normalizedModel]);
  const [nodes, setNodes, onNodesChange] = useNodesState<ErdTableNodeData>(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);
  const [selectedTableId, setSelectedTableId] = React.useState<string | null>(null);
  const [draggedColumnName, setDraggedColumnName] = React.useState<string | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = React.useState(false);
  const [focusedNavigation, setFocusedNavigation] = React.useState<{ tableId: string; navigationName: string } | null>(null);
  const [focusRequest, setFocusRequest] = React.useState<ErdFocusRequest | null>(null);
  const focusTokenRef = React.useRef(0);
  const selectedTable = normalizedModel.tables.find((table) => table.id === selectedTableId);
  const tableRelationships = React.useMemo(() => selectedTable ? relatedRelationships(normalizedModel, selectedTable.id) : [], [normalizedModel, selectedTable]);

  React.useEffect(() => {
    setNodes(graph.nodes);
  }, [graph.nodes, setNodes]);

  React.useEffect(() => {
    setEdges(graph.edges);
  }, [graph.edges, setEdges]);

  // Briefly flash the target navigation property item, then clear the highlight.
  React.useEffect(() => {
    if (!focusedNavigation) return;
    const timer = window.setTimeout(() => setFocusedNavigation(null), 1600);
    return () => window.clearTimeout(timer);
  }, [focusedNavigation]);

  const handleNavigationClick = React.useCallback((sourceTableId: string, navigation: ErdNavigation) => {
    const target = resolveNavigationFocusTarget(normalizedModel, sourceTableId, navigation);
    setSelectedTableId(target.targetTableId);
    setFocusedNavigation(
      !target.isReference && target.counterpartNavigationName
        ? { tableId: target.targetTableId, navigationName: target.counterpartNavigationName }
        : null,
    );
    focusTokenRef.current += 1;
    setFocusRequest({ tableId: target.targetTableId, token: focusTokenRef.current });
  }, [normalizedModel]);

  const displayNodesRef = React.useRef<Map<string, any>>(new Map());

  // Inject the per-node click handler and highlight state without recomputing the layout.
  // Only update nodes whose highlight state changed; skip nodes that haven't changed.
  const displayNodes = React.useMemo(() => {
    const cache = displayNodesRef.current;
    return nodes.map((node) => {
      const highlightedNavName = focusedNavigation?.tableId === node.id ? focusedNavigation.navigationName : undefined;
      const cachedNode = cache.get(node.id);
      
      // Reuse cached node if both data identity and highlight are unchanged
      if (cachedNode && cachedNode.node.data === node.data && cachedNode.highlight === highlightedNavName) {
        return cachedNode.node;
      }
      
      const updatedNode = {
        ...node,
        data: {
          ...node.data,
          onNavigationClick: handleNavigationClick,
          highlightedNavigationName: highlightedNavName,
        },
      } as any;
      
      cache.set(node.id, { node: updatedNode, highlight: highlightedNavName });
      return updatedNode;
    });
  }, [nodes, focusedNavigation, handleNavigationClick]);

  const commitModel = React.useCallback((nextModel: ErdModel) => {
    onChange?.(nextModel);
  }, [onChange]);

  const addSelectedTable = React.useCallback(() => {
    const { model: nextModel, tableId } = addErdTable(normalizedModel);
    setSelectedTableId(tableId);
    commitModel(nextModel);
  }, [normalizedModel, commitModel]);

  const renameSelectedTable = React.useCallback((name: string) => {
    if (!selectedTable || !name.trim() || name === selectedTable.name) return;
    const nextName = name.trim();
    const nextModel = renameErdTable(normalizedModel, selectedTable.id, nextName);
    setSelectedTableId(nextName);
    commitModel(nextModel);
  }, [normalizedModel, selectedTable, commitModel]);

  const updateSelectedColumn = React.useCallback((columnName: string, nextColumn: Record<string, unknown>) => {
    if (!selectedTable) return;
    const currentColumn = selectedTable.columns.find((column) => column.name === columnName);
    if (!currentColumn) return;
    commitModel(updateErdTableColumn(normalizedModel, selectedTable.id, columnName, {
      ...currentColumn,
      ...nextColumn,
    } as typeof currentColumn));
  }, [normalizedModel, selectedTable, commitModel]);

  const setColumnCurrentTimestamp = React.useCallback((columnName: string, enabled: boolean) => {
    if (!selectedTable) return;
    updateSelectedColumn(columnName, {
      defaultGeneration: enabled ? 'current-timestamp' : undefined,
    });
  }, [selectedTable, updateSelectedColumn]);

  const updateSelectedRelationship = React.useCallback((relationshipId: string, nextRelationship: Partial<ErdModel['relationships'][number]>) => {
    commitModel(updateErdRelationship(normalizedModel, relationshipId, (relationship) => ({
      ...relationship,
      ...nextRelationship,
      foreignKeyColumns: nextRelationship.foreignKeyColumns ?? relationship.foreignKeyColumns,
    })));
  }, [normalizedModel, commitModel]);

  const addSelectedColumn = React.useCallback(() => {
    if (!selectedTable) return;
    commitModel(addErdTableColumn(normalizedModel, selectedTable.id));
  }, [normalizedModel, selectedTable, commitModel]);

  const removeSelectedColumn = React.useCallback((columnName: string) => {
    if (!selectedTable) return;
    commitModel(deleteErdTableColumn(normalizedModel, selectedTable.id, columnName));
  }, [normalizedModel, selectedTable, commitModel]);

  const reorderSelectedColumn = React.useCallback((columnName: string, targetColumnName: string) => {
    if (!selectedTable) return;
    commitModel(reorderErdTableColumns(normalizedModel, selectedTable.id, columnName, targetColumnName));
  }, [normalizedModel, selectedTable, commitModel]);

  const addSelectedRelationship = React.useCallback(() => {
    if (!selectedTable) return;
    commitModel(addErdRelationship(normalizedModel, selectedTable.id));
  }, [normalizedModel, selectedTable, commitModel]);

  const removeSelectedRelationship = React.useCallback((relationshipId: string) => {
    commitModel(deleteErdRelationship(normalizedModel, relationshipId));
  }, [normalizedModel, commitModel]);

  const removeSelectedTable = React.useCallback(() => {
    if (!selectedTable) return;
    if (!window.confirm('are you sure you wish to delete this entity?')) return;
    setSelectedTableId(null);
    commitModel(deleteErdTable(normalizedModel, selectedTable.id));
  }, [normalizedModel, selectedTable, commitModel]);

  const handlePrintGraph = React.useCallback(() => {
    printErdModel(normalizedModel);
  }, [normalizedModel]);

  const handlePaneClick = React.useCallback(() => {
    setSelectedTableId(null);
  }, []);

  const handleNodeDragStop = React.useCallback((event: any, node: Node<ErdTableNodeData>) => {
    if (!onChange) return;
    commitModel({
      ...normalizedModel,
      nodePositions: {
        ...normalizedModel.nodePositions,
        [node.id]: node.position,
      },
    });
  }, [normalizedModel, onChange, commitModel]);

  const handleNodeClick = React.useCallback((event: any, node: Node<ErdTableNodeData>) => {
    setSelectedTableId(node.id);
  }, []);

  const handleColumnNameChange = React.useCallback((columnName: string, value: string) => {
    updateSelectedColumn(columnName, { name: value });
  }, [updateSelectedColumn]);

  const handleColumnTypeChange = React.useCallback((columnName: string, value: string) => {
    updateSelectedColumn(columnName, {
      type: value,
      defaultGeneration: isTimestampColumnType(value) ? selectedTable?.columns.find(c => c.name === columnName)?.defaultGeneration : undefined,
    });
  }, [updateSelectedColumn, selectedTable]);

  const handleColumnNullableChange = React.useCallback((columnName: string, value: boolean) => {
    updateSelectedColumn(columnName, { isNullable: value });
  }, [updateSelectedColumn]);

  const handleColumnPrimaryKeyChange = React.useCallback((columnName: string, value: boolean) => {
    updateSelectedColumn(columnName, { isPrimaryKey: value });
  }, [updateSelectedColumn]);

  const handleCLRNameChange = React.useCallback((value: string) => {
    commitModel(normalizeErdModel({
      ...normalizedModel,
      tables: normalizedModel.tables.map((table) => table.id === selectedTable?.id ? { ...table, clrName: value } : table),
    }));
  }, [normalizedModel, selectedTable?.id, commitModel]);

  const handleDragStart = React.useCallback((columnName: string) => {
    setDraggedColumnName(columnName);
  }, []);

  const handleDragEnd = React.useCallback(() => {
    setDraggedColumnName(null);
  }, []);

  const handleDragOver = React.useCallback((event: React.DragEvent) => {
    event.preventDefault();
  }, []);

  const handleDrop = React.useCallback((draggedName: string, targetName: string) => {
    if (draggedName && draggedName !== targetName) {
      reorderSelectedColumn(draggedName, targetName);
    }
    setDraggedColumnName(null);
  }, [reorderSelectedColumn]);

  return (
    <HorizontalSplitPane className={styles.erdEditor} defaultRightWidth={385} minRightWidth={280} minLeftWidth={360}>
      <div className={styles.flowPanel}>
        <div className={styles.flow}>
          <ReactFlowProvider>
            <ReactFlow
              nodes={displayNodes}
              edges={edges}
              nodeTypes={erdNodeTypes}
              fitView
              onNodesChange={onNodesChange}
              onPaneClick={handlePaneClick}
              onNodeDragStop={handleNodeDragStop}
              onEdgesChange={onEdgesChange}
              onNodeClick={handleNodeClick}
            >
              <Controls />
              <Background />
              <ErdFocusController focusRequest={focusRequest} />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
      </div>
      <div className={styles.sidebarPanel}>
        <aside className={styles.sidebar} aria-label="ERD details">
          {selectedTable ? (
            <div className={styles.sidebarTitleRow}>
              <h2>{selectedTable.name}</h2>
              <div className={styles.sidebarTitleActions}>
                <button type="button" className={styles.buttonSecondary} onClick={handlePrintGraph} title="Print graph" aria-label="Print graph">
                  <Printer size={16} />
                </button>
                <button type="button" className={styles.buttonDanger} aria-label={`Delete entity ${selectedTable.name}`} onClick={removeSelectedTable} title="Delete entity">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.sidebarTitleRow}>
              <h2>Entity Relationship Diagram</h2>
              <button type="button" className={styles.buttonSecondary} onClick={handlePrintGraph} title="Print graph" aria-label="Print graph">
                <Printer size={16} />
              </button>
            </div>
          )}
          {selectedTable ? (
          <div className={styles.sidebarSection}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Table name</span>
              <input aria-label="Table name" className={styles.fieldInput} value={selectedTable.name} onChange={(event) => renameSelectedTable(event.target.value)} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>CLR name</span>
              <input aria-label="CLR name" className={styles.fieldInput} value={selectedTable.clrName} onChange={(event) => handleCLRNameChange(event.target.value)} />
            </label>

            <div className={styles.sidebarSection}>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>Properties</h3>
                <button type="button" className={styles.buttonSecondary} onClick={addSelectedColumn}>Add property</button>
              </div>
              {selectedTable.columns.length === 0 ? <p className={styles.muted}>No properties available for this table.</p> : selectedTable.columns.map((column) => (
                <div
                  key={`${selectedTable.id}-${column.name}`}
                  className={styles.propertyCard}
                  data-testid={`property-card-${column.name}`}
                  draggable
                  onDragStart={() => handleDragStart(column.name)}
                  onDragEnd={handleDragEnd}
                  onDragOver={handleDragOver}
                  onDrop={() => handleDrop(draggedColumnName ?? '', column.name)}
                >
                  <div className={styles.cardHeader}>
                    <span className={styles.dragHandle} aria-hidden="true">⋮⋮</span>
                    <strong>{column.name}</strong>
                    <button type="button" className={styles.buttonDanger} aria-label={`Delete property ${column.name}`} onClick={() => removeSelectedColumn(column.name)}>Delete</button>
                  </div>
                  <div className={styles.fieldRow}>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Name</span>
                      <input
                        className={styles.fieldInput}
                        defaultValue={column.name}
                        onBlur={(event) => handleColumnNameChange(column.name, event.target.value)}
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Type</span>
                      <select
                        className={styles.fieldInput}
                        value={column.type}
                        onChange={(event) => handleColumnTypeChange(column.name, event.target.value)}
                      >
                        {column.type && !commonPropertyTypes.includes(column.type) && <option value={column.type}>{column.type}</option>}
                        {commonPropertyTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className={styles.checkboxRow}>
                    <label className={styles.checkboxLabel}><input type="checkbox" checked={column.isNullable} onChange={(event) => handleColumnNullableChange(column.name, event.target.checked)} /> Nullable</label>
                    <label className={styles.checkboxLabel}><input type="checkbox" checked={column.isPrimaryKey} onChange={(event) => handleColumnPrimaryKeyChange(column.name, event.target.checked)} /> Primary key</label>
                    <span className={styles.columnBadge}>{column.isForeignKey ? `FK${column.foreignKeyTarget ? ` → ${column.foreignKeyTarget}` : ''}` : 'Regular'}</span>
                    {column.isPrimaryKey && isIdentityEligibleColumnType(column.type) && (
                      <span className={styles.columnBadge} title="Numeric primary keys are exported as IDENTITY columns">Auto</span>
                    )}
                    {isTimestampColumnType(column.type) && (
                      <button
                        type="button"
                        className={`${styles.defaultChip} ${column.defaultGeneration === 'current-timestamp' ? styles.defaultChipActive : ''}`}
                        onClick={() => setColumnCurrentTimestamp(column.name, column.defaultGeneration !== 'current-timestamp')}
                        title="Use the current time as the default value"
                        aria-label={`Default for ${column.name}`}
                      >
                        Now
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.sidebarSection}>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>Relationships</h3>
                <button type="button" className={styles.buttonSecondary} onClick={addSelectedRelationship}>Add relationship</button>
              </div>
              {tableRelationships.length === 0 ? <p className={styles.muted}>No relationships involve this table.</p> : tableRelationships.map((relationship) => (
                <div key={relationship.id} className={styles.relationshipCard}>
                  <div className={styles.cardHeader}>
                    <strong>{relationship.dependentTable} → {relationship.principalTable}</strong>
                    <button type="button" className={styles.buttonDanger} aria-label={`Delete relationship ${relationship.dependentTable} to ${relationship.principalTable}`} onClick={() => removeSelectedRelationship(relationship.id)}>Delete</button>
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
                      key={relationship.id}
                      className={styles.fieldInput}
                      defaultValue={relationship.foreignKeyColumns.join(', ')}
                      onBlur={(event) => updateSelectedRelationship(relationship.id, {
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
          ) : (
            <div className={styles.emptySidebarState}>
              <p>Select a table to inspect it.</p>
              <button type="button" className={styles.buttonSecondary} onClick={addSelectedTable}>Add Entity</button>
            </div>
          )}
          {normalizedModel.diagnostics.length > 0 && (
            <section className={styles.diagnosticsSection} aria-label="Diagnostics" role="status">
              <button
                type="button"
                className={styles.diagnosticsToggle}
                aria-expanded={diagnosticsOpen}
                aria-label={diagnosticsOpen ? 'Collapse diagnostics' : 'Expand diagnostics'}
                title={diagnosticsOpen ? 'Collapse diagnostics' : 'Expand diagnostics'}
                onClick={() => setDiagnosticsOpen((open) => !open)}
              >
                <ChevronDown className={`${styles.diagnosticsIcon}${diagnosticsOpen ? ` ${styles.diagnosticsIconOpen}` : ''}`} aria-hidden="true" />
                <span>Diagnostics</span>
              </button>
              {diagnosticsOpen && (
                <div className={styles.diagnosticsList}>
                  {normalizedModel.diagnostics.map((diagnostic, index) => <div key={`${diagnostic.message}-${index}`}>{diagnostic.message}</div>)}
                </div>
              )}
            </section>
          )}
        </aside>
      </div>
    </HorizontalSplitPane>
  );
}
