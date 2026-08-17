export type CanonicalSchemaLanguage = 'json' | 'yaml' | 'xml';

export type CanonicalNodeKind =
  | 'root'
  | 'element'
  | 'attribute'
  | 'property'
  | 'array-item'
  | 'compositor'
  | 'text';

export type CanonicalValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'null'
  | 'xml-mixed'
  | 'unknown';

export type CanonicalCompositorKind = 'sequence' | 'choice' | 'all' | 'group' | 'none';

export type CanonicalStructuralGroupKind = 'repeat' | 'choice' | 'sequence' | 'all' | 'synthetic-row';

export type CanonicalConstraintLayer = 'structural' | 'semantic' | 'procedural';

export type CanonicalDiagnosticSeverity = 'error' | 'warning' | 'info';

export type CanonicalValidationSource = 'json-schema' | 'xsd' | 'schematron' | 'custom';

export type CanonicalPathSegment = string | number;

export interface CanonicalXmlMetadata {
  namespaceUri?: string;
  namespacePrefix?: string;
  attributes?: Record<string, string>;
  sourcePath?: CanonicalPathSegment[];
}

export interface CanonicalNodeMetadata {
  sourcePath?: CanonicalPathSegment[];
  projectionPath?: CanonicalPathSegment[];
  schemaPath?: CanonicalPathSegment[];
  xml?: CanonicalXmlMetadata;
  tags?: string[];
}

export interface CanonicalConstraintRef {
  id: string;
  layer: CanonicalConstraintLayer;
  source: CanonicalValidationSource;
}

export interface CanonicalTriggerRef {
  id: string;
  event: 'onLoad' | 'onChange' | 'onBlur' | 'onAdd' | 'onRemove' | 'onVariantSelect' | 'onValidate';
}

export interface CanonicalDiagnosticRef {
  id: string;
}

export interface CanonicalNode {
  id: string;
  parentId: string | null;
  kind: CanonicalNodeKind;
  name: string;
  path: string;
  valueType: CanonicalValueType;
  value: unknown;
  defaultValue?: unknown;
  readonly?: boolean;
  writeonly?: boolean;
  required?: boolean;
  minOccurs?: number;
  maxOccurs?: number | 'unbounded';
  ordinal: number;
  schemaRef?: string;
  compositorKind?: CanonicalCompositorKind;
  occurrenceId?: string;
  structuralGroupId?: string;
  choiceGroupId?: string;
  branchKey?: string;
  constraints: CanonicalConstraintRef[];
  triggers: CanonicalTriggerRef[];
  diagnostics: CanonicalDiagnosticRef[];
  metadata?: CanonicalNodeMetadata;
}

export interface CanonicalOccurrence {
  id: string;
  groupId: string;
  parentOccurrenceId?: string;
  indexToken: string;
  ordinal: number;
  nodeIds: string[];
}

export interface CanonicalStructuralGroup {
  id: string;
  kind: CanonicalStructuralGroupKind;
  parentGroupId?: string;
  ownerNodeId: string;
  occurrenceIds: string[];
  childGroupIds: string[];
}

export interface CanonicalChoiceSelection {
  id: string;
  choiceGroupId: string;
  occurrenceId?: string;
  selectedBranchKey: string | null;
  availableBranchKeys: string[];
}

export interface CanonicalConstraint {
  id: string;
  layer: CanonicalConstraintLayer;
  source: CanonicalValidationSource;
  expression: string;
  targetPaths: string[];
  severity: CanonicalDiagnosticSeverity;
  messageTemplate: string;
  activeWhen?: string;
  tags?: string[];
}

export interface CanonicalTrigger {
  id: string;
  event: CanonicalTriggerRef['event'];
  sourcePath?: string;
  affectsPaths: string[];
  action: 'recompute' | 'validate' | 'activateBranch' | 'deactivateBranch' | 'recomputeCompositor' | 'markDirty';
  debounceMs?: number;
  priority?: number;
}

export interface CanonicalDiagnostic {
  id: string;
  nodeId: string;
  occurrenceId?: string;
  source: CanonicalValidationSource;
  severity: CanonicalDiagnosticSeverity;
  message: string;
  path?: string;
  ruleId?: string;
}

export interface CanonicalDependencyNode {
  path: string;
  nodeId?: string;
}

export interface CanonicalDependencyEdge {
  from: string;
  to: string;
  reason: 'constraint' | 'trigger' | 'compositor' | 'derived-value';
}

export interface CanonicalDependencyGraph {
  nodes: CanonicalDependencyNode[];
  edges: CanonicalDependencyEdge[];
  topologicalOrder: string[];
  cycles: string[][];
}

export interface CanonicalValidationState {
  constraints: Record<string, CanonicalConstraint>;
  triggers: Record<string, CanonicalTrigger>;
  diagnostics: Record<string, CanonicalDiagnostic>;
}

export interface CanonicalProjectionState {
  rowOrder: string[];
  expandedRowIds: string[];
  pinnedColumns?: string[];
  filters?: Record<string, unknown>;
}

export interface CanonicalDocument {
  id: string;
  schemaLanguage: CanonicalSchemaLanguage;
  schemaSource: unknown;
  instanceSource?: unknown;
  nodes: Record<string, CanonicalNode>;
  order: string[];
  occurrences: Record<string, CanonicalOccurrence>;
  groups: Record<string, CanonicalStructuralGroup>;
  selections: Record<string, CanonicalChoiceSelection>;
  validation: CanonicalValidationState;
  dependencyGraph: CanonicalDependencyGraph;
  projection: CanonicalProjectionState;
  revision: number;
  updatedAt: string;
}

export interface CanonicalBuilderResult {
  document: CanonicalDocument;
  warnings: string[];
}