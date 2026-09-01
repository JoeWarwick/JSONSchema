import type { Node as FlowNode } from 'reactflow';
import { GraphicalSchemaRhsJsonEditor } from './graphical-schema-rhs-json-editor';
import { GraphicalSchemaRhsXmlEditor } from './graphical-schema-rhs-xml-editor';
import type { NodeData } from './types';

interface GraphicalSchemaRhsEditorProps {
  selectedNode: FlowNode<NodeData> | null;
  onChange: (patch: Partial<NodeData>) => void;
  schemaLanguage?: 'json' | 'yaml' | 'xml';
  onToggleShowAnnotations?: (show: boolean) => void;
  xmlShowAnnotations?: boolean;
  onToggleShowImports?: (show: boolean) => void;
  xmlShowImports?: boolean;
  getNodeByName?: (name: string) => FlowNode<NodeData> | null;
}

export function GraphicalSchemaRhsEditor({
  selectedNode,
  onChange,
  schemaLanguage,
  onToggleShowAnnotations,
  xmlShowAnnotations,
  onToggleShowImports,
  xmlShowImports,
  getNodeByName,
}: GraphicalSchemaRhsEditorProps) {
  return schemaLanguage === 'xml' ? (
    <GraphicalSchemaRhsXmlEditor
      selectedNode={selectedNode}
      onChange={onChange}
      onToggleShowAnnotations={onToggleShowAnnotations}
      xmlShowAnnotations={xmlShowAnnotations}
      onToggleShowImports={onToggleShowImports}
      xmlShowImports={xmlShowImports}
      getNodeByName={getNodeByName}
    />
  ) : (
    <GraphicalSchemaRhsJsonEditor selectedNode={selectedNode} onChange={onChange} />
  );
}