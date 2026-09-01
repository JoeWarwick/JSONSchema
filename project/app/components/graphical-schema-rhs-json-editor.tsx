import { MemoizedNodePropertyEditor } from './NodePropertyEditor';
import type { NodeData, NodePropertyEditorProps } from './types';

interface GraphicalSchemaRhsJsonEditorProps {
  selectedNode: NodePropertyEditorProps['node'];
  onChange: (patch: Partial<NodeData>) => void;
}

export function GraphicalSchemaRhsJsonEditor({ selectedNode, onChange }: GraphicalSchemaRhsJsonEditorProps) {
  return <MemoizedNodePropertyEditor node={selectedNode} onChange={onChange} />;
}