import type { Node } from 'reactflow';
import type { ErdModel } from './erd';
import type { ErdTableNodeData } from '../utils/erd-graph';

export type ErdDisplayNodeCacheEntry = {
  node: Node<ErdTableNodeData>;
  highlight: string | undefined;
};

export interface ErdFocusRequest {
  tableId: string;
  token: number;
}

export interface ErdEditorProps {
  model: ErdModel;
  onChange?: (model: ErdModel) => void;
}