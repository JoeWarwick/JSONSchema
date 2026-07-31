import type React from "react";
import type { Node as FlowNode } from 'reactflow';

export type NodeData = Record<string, any>;

// Recursive shape for an XSD attribute's inline (anonymous) `xs:simpleType`, e.g.
// `<xs:attribute><xs:simpleType><xs:union>...</xs:union></xs:simpleType></xs:attribute>`.
// `union`/`list` can each nest further anonymous `xs:simpleType` members, mirroring real XSD.
export interface InlineSimpleTypeData {
  mode: 'restriction' | 'union' | 'list';
  base?: string;
  enumerations?: string[];
  memberTypes?: string;
  memberSimpleTypes?: InlineSimpleTypeData[];
  itemType?: string;
  itemSimpleType?: InlineSimpleTypeData;
}

export interface NodePropertyEditorProps {
  node: FlowNode<NodeData> | null;
  onChange: (patch: Partial<NodeData>) => void;
}

export interface BadgeDef {
  key: string;
  condition: (d: any) => boolean;
  label: (d: any) => string;
  tooltip?: (d: any) => string;
  variant?: string;
  bg?: string;
  color?: string;
  badgeVisible?: boolean;
}

export interface Badge {
  key: string;
  label: string;
  tooltip?: string;
  variant?: string;
  content?: React.ReactNode;
  bg?: string;
  color?: string;
}

// Export shared schema-related types requested by refactor
export type SchemaNodeType = "object" | "array" | "string" | "number" | "boolean" | "null" | "image";

export interface GraphicalSchemaEditorProps {
  schema: Record<string, unknown>;
  onChange: (schema: Record<string, unknown>) => void;
  useTestData?: boolean;
  schemaLanguage?: 'json' | 'yaml' | 'xml';
}
