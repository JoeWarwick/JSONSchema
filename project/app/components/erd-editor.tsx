import React from 'react';
import ReactFlow, { Background, Controls, ReactFlowProvider, useEdgesState, useNodesState } from 'reactflow';
import type { Node } from 'reactflow';
import type { ErdModel } from '../types/erd';
import { erdModelToGraph, type ErdTableNodeData } from '../utils/erd-graph';
import { erdNodeTypes } from './erd-node-types';
import styles from './erd-editor.module.css';
import 'reactflow/dist/style.css';

export interface ErdEditorProps {
  model: ErdModel;
  onChange?: (model: ErdModel) => void;
}

export function ErdEditor({ model, onChange }: ErdEditorProps) {
  const graph = React.useMemo(() => erdModelToGraph(model), [model]);
  const [nodes, setNodes, onNodesChange] = useNodesState<ErdTableNodeData>(graph.nodes);
  const [edges, , onEdgesChange] = useEdgesState(graph.edges);
  const [selectedTableId, setSelectedTableId] = React.useState<string | null>(null);
  const selectedTable = model.tables.find((table) => table.id === selectedTableId);

  React.useEffect(() => {
    setNodes(graph.nodes);
  }, [graph.nodes, setNodes]);

  const renameSelectedTable = (name: string) => {
    if (!selectedTable || !name.trim() || name === selectedTable.name) return;
    const nextName = name.trim();
    const previousName = selectedTable.name;
    const nextModel: ErdModel = {
      ...model,
      tables: model.tables.map((table) => table.id === selectedTable.id ? { ...table, id: nextName, name: nextName, clrName: nextName } : table),
      relationships: model.relationships.map((relationship) => ({
        ...relationship,
        id: relationship.id.replaceAll(previousName, nextName),
        principalTable: relationship.principalTable === previousName ? nextName : relationship.principalTable,
        dependentTable: relationship.dependentTable === previousName ? nextName : relationship.dependentTable,
      })),
      nodePositions: model.nodePositions ? Object.fromEntries(
        Object.entries(model.nodePositions).map(([id, position]) => [id === previousName ? nextName : id, position]),
      ) : undefined,
    };
    setSelectedTableId(nextName);
    onChange?.(nextModel);
  };

  return (
    <div className={styles.erdEditor}>
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
              onChange({
                ...model,
                nodePositions: {
                  ...model.nodePositions,
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
      <aside className={styles.sidebar} aria-label="ERD details">
        <h2>{selectedTable ? selectedTable.name : 'Entity Relationship Diagram'}</h2>
        {selectedTable ? (
          <label>
            Table name
            <input aria-label="Table name" defaultValue={selectedTable.name} onBlur={(event) => renameSelectedTable(event.target.value)} />
          </label>
        ) : <p>Select a table to inspect it.</p>}
        {model.diagnostics.length > 0 && (
          <div className={styles.diagnostics} role="status">
            {model.diagnostics.map((diagnostic, index) => <div key={`${diagnostic.message}-${index}`}>{diagnostic.message}</div>)}
          </div>
        )}
      </aside>
    </div>
  );
}
