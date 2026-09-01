import type { Node as FlowNode } from 'reactflow';
import { XmlNodeRhsEditor } from './xml-rhs-editors';
import type { NodeData } from './types';

interface GraphicalSchemaRhsXmlEditorProps {
  selectedNode: FlowNode<NodeData> | null;
  onChange: (patch: Partial<NodeData>) => void;
  onToggleShowAnnotations?: (show: boolean) => void;
  xmlShowAnnotations?: boolean;
  onToggleShowImports?: (show: boolean) => void;
  xmlShowImports?: boolean;
  getNodeByName?: (name: string) => FlowNode<NodeData> | null;
}

export function GraphicalSchemaRhsXmlEditor({
  selectedNode,
  onChange,
  onToggleShowAnnotations,
  xmlShowAnnotations,
  onToggleShowImports,
  xmlShowImports,
  getNodeByName,
}: GraphicalSchemaRhsXmlEditorProps) {
  return (
    <XmlNodeRhsEditor
      node={selectedNode}
      onChange={onChange}
      onToggleShowAnnotations={onToggleShowAnnotations}
      xmlShowAnnotations={xmlShowAnnotations}
      onToggleShowImports={onToggleShowImports}
      xmlShowImports={xmlShowImports}
      getNodeByName={getNodeByName}
    />
  );
}