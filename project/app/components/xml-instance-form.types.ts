import type { MutableRefObject } from 'react';
import type { CompiledSchema } from '../utils/schema-compiler';
import type { SchemaNode } from '../utils/schema-walker';

export interface XmlInstanceFormProps {
  schema: any;
  value: any;
  onChange: (value: any) => void;
  path?: string[];
  rootSchema?: any;
  autoFocus?: boolean;
  autoExpandAll?: boolean;
  showRootElementTriggers?: boolean;
  expansionStateKey?: string;
}

export interface XmlAttribute {
  name: string;
  value: any;
}

export interface XmlElement {
  tagName: string;
  attributes: XmlAttribute[];
  children: (XmlElement | string)[];
  text: string;
  isCompositor?: boolean;
}

export type TopLevelXsdKind = 'element' | 'attribute' | 'complexType' | 'simpleType' | 'group' | 'attributeGroup' | 'notation';

export interface XmlElementNodeProps {
  element: XmlElement;
  path: string[];
  expandedPaths: Set<string>;
  onToggleExpand: (path: string[]) => void;
  value: any;
  onChange: (value: any) => void;
  onUpdateValue: (pathArray: string[], updateFn: (value: any) => any) => void;
  rootSchema?: any;
  autoExpandAll?: boolean;
  schemaNode?: SchemaNode;
  compiledSchema?: CompiledSchema | null;
  initialAutoExpandPathsRef?: MutableRefObject<Set<string>>;
  autoExpandCaptureActiveRef?: MutableRefObject<boolean>;
  isSchemaForm?: boolean;
  rootXsdAddButtons?: Array<{ kind: TopLevelXsdKind; label: string }>;
  onAddTopLevelXsdDefinition?: (kind: TopLevelXsdKind) => void;
  suppressElementLabel?: boolean;
  suppressExpander?: boolean;
}
