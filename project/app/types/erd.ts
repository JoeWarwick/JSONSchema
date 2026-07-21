export type ErdCardinality = 'one' | 'zero-or-one' | 'many';

export interface ErdSourceFile {
  name: string;
  content: string;
}

export interface ErdDiagnostic {
  severity: 'warning' | 'error';
  message: string;
  fileName?: string;
  line?: number;
}

export interface ErdColumn {
  name: string;
  type: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  defaultGeneration?: 'current-timestamp';
  foreignKeyTarget?: string;
  sourceFile?: string;
}

export interface ErdNavigation {
  name: string;
  targetTable: string;
  cardinality: ErdCardinality;
  sourceFile?: string;
}

export interface ErdTable {
  id: string;
  name: string;
  clrName: string;
  columns: ErdColumn[];
  navigations: ErdNavigation[];
  sourceFile?: string;
}

export interface ErdRelationship {
  id: string;
  principalTable: string;
  dependentTable: string;
  foreignKeyColumns: string[];
  principalCardinality: ErdCardinality;
  dependentCardinality: ErdCardinality;
  principalNavigation?: string;
  dependentNavigation?: string;
  explicit: boolean;
}

export interface ErdModel {
  tables: ErdTable[];
  relationships: ErdRelationship[];
  sourceFiles: ErdSourceFile[];
  diagnostics: ErdDiagnostic[];
  nodePositions?: Record<string, { x: number; y: number }>;
}
