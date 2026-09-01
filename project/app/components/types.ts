import type React from "react";
import type { Node as FlowNode } from 'reactflow';

export type NodeData = Record<string, any>;

export type XmlNodeKind = 'schema' | 'simpleType' | 'complexType' | 'attributeGroup' | 'attribute' | 'element' | 'sequence' | 'choice' | 'all' | 'any';

/**
 * Props for XML node RHS editors and attribute manager.
 * - node: The selected ReactFlow node, or null if no node is selected
 * - onChange: Callback to emit partial node data updates (patches)
 * - getNodeByName: Optional function to look up a node by its name property
 */
export interface XmlNodeRhsEditorProps {
  node: FlowNode<NodeData> | null;
  onChange: (patch: Partial<NodeData>) => void;
  onToggleShowAnnotations?: (show: boolean) => void;
  xmlShowAnnotations?: boolean;
  onToggleShowImports?: (show: boolean) => void;
  xmlShowImports?: boolean;
  readOnlySource?: string;
  getNodeByName?: (name: string) => FlowNode<NodeData> | null;
}

/**
 * Defines an editable property for a schema node.
 * Supports text input, select dropdown, and checkbox field types.
 */
export interface PropertyFieldConfig {
  /** Label displayed to user */
  label: string;
  /** Data property key (e.g., 'xmlTargetNamespace') */
  dataKey: keyof NodeData;
  /** Field type: 'text', 'select', or 'checkbox' */
  type: 'text' | 'select' | 'checkbox';
  /** Placeholder text (for text inputs) */
  placeholder?: string;
  /** Options for select fields */
  options?: Array<{ value: string; label: string }>;
  /** Default value if not set */
  defaultValue?: string | boolean;
  /** Aria label for accessibility */
  ariaLabel: string;
}

// Recursive shape for an XSD attribute's inline (anonymous) `xs:simpleType`, e.g.
// `<xs:attribute><xs:simpleType><xs:union>...</xs:union></xs:simpleType></xs:attribute>`.
// `union`/`list` can each nest further anonymous `xs:simpleType` members, mirroring real XSD.
export interface SimpleTypeFacets {
  pattern?: string;
  minInclusive?: string;
  maxInclusive?: string;
  minLength?: string;
  maxLength?: string;
  totalDigits?: string;
  fractionDigits?: string;
  whiteSpace?: string;
}

export interface InlineSimpleTypeData {
  mode: 'restriction' | 'union' | 'list';
  base?: string;
  enumerations?: string[];
  facets?: SimpleTypeFacets;
  memberTypes?: string;
  memberSimpleTypes?: InlineSimpleTypeData[];
  // Enumeration values pulled from named simpleTypes listed in `memberTypes` (space-separated),
  // resolved read-only for display alongside this union's own anonymous members — see
  // `resolveUnionReferencedEnumerations` in graphical-schema-editor.tsx.
  unionReferencedEnumerations?: string[];
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
  onChange?: (schema: Record<string, unknown>) => void;
  useTestData?: boolean;
  schemaLanguage?: 'json' | 'yaml' | 'xml';
}
