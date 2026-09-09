export interface XmlSchemaFormProps {
  schema: Record<string, unknown>;
  onChange: (newSchema: Record<string, unknown>) => void;
  rootSchema?: Record<string, unknown>;
  xmlPath?: string[];
  autoFocus?: boolean;
}

export interface ExpandedRef {
  name: string;
  refPath: string[];
  isEditing: boolean;
}

export interface XmlSchemaAttributeEditorProps {
  attributes: Record<string, unknown>[];
  onChange: (attributes: Record<string, unknown>[]) => void;
}

export interface XmlSchemaElementEditorProps {
  elements: Record<string, unknown>[];
  rootSchema?: Record<string, unknown>;
  expandedPaths: Set<string>;
  togglePathExpansion: (path: string) => void;
  onChange: (elements: Record<string, unknown>[]) => void;
}

export interface NamedTypeRef {
  refName: string;
  refPath: string[];
}