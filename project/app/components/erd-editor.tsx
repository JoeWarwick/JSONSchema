import React from 'react';
import ReactFlow, { Background, Controls, ReactFlowProvider, useEdgesState, useNodesState } from 'reactflow';
import type { Node } from 'reactflow';
import type { ErdModel, ErdNavigation } from '../types/erd';
import { countErdGraphCrossings, erdModelToGraph, type ErdTableNodeData } from '../utils/erd-graph';
import { addErdRelationship, addErdTable, addErdTableColumn, deleteErdRelationship, deleteErdTable, deleteErdTableColumn, normalizeErdModel, reorderErdTableColumns, renameErdTable, relatedRelationships, resolveNavigationFocusTarget, updateErdRelationship, updateErdTableColumn } from '../utils/erd-model-editing';
import { commonPropertyTypes, isIdentityEligibleColumnType, isTimestampColumnType } from '../utils/erd-editor-utils';
import { buildErdDisplayNodes } from '../utils/erd-editor-display';
import { printErdModel } from '../utils/print-erd';
import { erdNodeTypes } from './erd-node-types';
import { ErdEditorSidebar } from './erd-editor-sidebar';
import { ErdFocusController } from './erd-focus-controller';
import { HorizontalSplitPane } from './ui/split-pane';
import type { ErdEditorProps, ErdFocusRequest } from '../types/erd-editor';
import styles from './erd/erd-editor.module.css';
import 'reactflow/dist/style.css';

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
  const edgeCrossings = React.useMemo(() => countErdGraphCrossings(graph), [graph]);
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

  const displayNodes = React.useMemo(
    () => buildErdDisplayNodes(nodes, focusedNavigation, handleNavigationClick, displayNodesRef.current),
    [nodes, focusedNavigation, handleNavigationClick],
  );

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

  const handleAutoLayout = React.useCallback(() => {
    const freshGraph = erdModelToGraph(normalizedModel, {
      useStoredPositions: false,
      preferDifferentLayout: true,
      useIlpUntangle: true,
      spacingScale: 1.3,
      minVerticalGap: 84,
    });
    const nodePositions = Object.fromEntries(
      freshGraph.nodes.map((node) => [node.id, node.position]),
    );
    commitModel({
      ...normalizedModel,
      nodePositions,
    });
  }, [normalizedModel, commitModel]);

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
        <ErdEditorSidebar
          selectedTable={selectedTable}
          edgeCrossings={edgeCrossings}
          diagnosticsOpen={diagnosticsOpen}
          normalizedModel={normalizedModel}
          tableRelationships={tableRelationships}
          commonPropertyTypes={commonPropertyTypes}
          onAutoLayout={handleAutoLayout}
          onPrintGraph={handlePrintGraph}
          onDeleteTable={removeSelectedTable}
          onToggleDiagnostics={() => setDiagnosticsOpen((open) => !open)}
          onAddEntity={addSelectedTable}
          onAddColumn={addSelectedColumn}
          onAddRelationship={addSelectedRelationship}
          onRenameTable={renameSelectedTable}
          onChangeClrName={handleCLRNameChange}
          onDeleteColumn={removeSelectedColumn}
          onColumnNameChange={handleColumnNameChange}
          onColumnTypeChange={handleColumnTypeChange}
          onColumnNullableChange={handleColumnNullableChange}
          onColumnPrimaryKeyChange={handleColumnPrimaryKeyChange}
          onSetColumnCurrentTimestamp={setColumnCurrentTimestamp}
          onDeleteRelationship={removeSelectedRelationship}
          onUpdateRelationship={updateSelectedRelationship}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          draggedColumnName={draggedColumnName}
          isIdentityEligibleColumnType={isIdentityEligibleColumnType}
          isTimestampColumnType={isTimestampColumnType}
        />
      </div>
    </HorizontalSplitPane>
  );
}
