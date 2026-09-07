import React from 'react';
import sidebarStyles from './graphical-schema-editor/styles/sidebar.module.css';
import type { NodeData } from './types';
import type { Node as FlowNode } from 'reactflow';
import { GraphicalSchemaRhsDetails, type XmlSchemaDetails } from './graphical-schema-rhs-details';
import { GraphicalSchemaRhsEditor } from './graphical-schema-rhs-editor';

const styles = {
  ...sidebarStyles,
};

interface GraphicalSchemaRhsControlProps {
  selectedNode: FlowNode<NodeData> | null;
  onChange: (patch: Partial<NodeData>) => void;
  schemaLanguage?: 'json' | 'yaml' | 'xml';
  schemaDialectLabel: string;
  showXmlDetails: boolean;
  showSchemaDetails: boolean;
  xmlSchemaDetails: XmlSchemaDetails;
  onToggleSchemaDetails: () => void;
  onToggleShowAnnotations?: (show: boolean) => void;
  xmlShowAnnotations?: boolean;
  onToggleShowImports?: (show: boolean) => void;
  xmlShowImports?: boolean;
  onPrintGraph: () => void;
  getNodeByName?: (name: string) => FlowNode<NodeData> | null;
}

export function GraphicalSchemaRhsControl({
  selectedNode,
  onChange,
  schemaLanguage,
  schemaDialectLabel,
  showXmlDetails,
  showSchemaDetails,
  xmlSchemaDetails,
  onToggleSchemaDetails,
  onToggleShowAnnotations,
  xmlShowAnnotations,
  onToggleShowImports,
  xmlShowImports,
  onPrintGraph,
  getNodeByName,
}: GraphicalSchemaRhsControlProps) {
  return (
    <div className={styles.editorSidebar} aria-label="Graphical schema RHS control">
      <GraphicalSchemaRhsDetails
        schemaDialectLabel={schemaDialectLabel}
        showXmlDetails={showXmlDetails}
        showSchemaDetails={showSchemaDetails}
        xmlSchemaDetails={xmlSchemaDetails}
        onToggleSchemaDetails={onToggleSchemaDetails}
        onPrintGraph={onPrintGraph}
      />
      <GraphicalSchemaRhsEditor
        selectedNode={selectedNode}
        onChange={onChange}
        schemaLanguage={schemaLanguage}
        onToggleShowAnnotations={onToggleShowAnnotations}
        xmlShowAnnotations={xmlShowAnnotations}
        onToggleShowImports={onToggleShowImports}
        xmlShowImports={xmlShowImports}
        getNodeByName={getNodeByName}
      />
    </div>
  );
}