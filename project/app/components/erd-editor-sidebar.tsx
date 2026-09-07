import React from 'react';
import { ChevronDown, Printer, Sparkles, Trash2 } from 'lucide-react';
import type { ErdColumn, ErdModel, ErdRelationship, ErdTable } from '../types/erd';
import styles from './erd/erd-editor.module.css';

interface ErdEditorSidebarProps {
  selectedTable: ErdTable | undefined;
  edgeCrossings: number;
  diagnosticsOpen: boolean;
  normalizedModel: ErdModel;
  tableRelationships: ErdRelationship[];
  commonPropertyTypes: string[];
  onAutoLayout: () => void;
  onPrintGraph: () => void;
  onDeleteTable: () => void;
  onToggleDiagnostics: () => void;
  onAddEntity: () => void;
  onAddColumn: () => void;
  onAddRelationship: () => void;
  onRenameTable: (name: string) => void;
  onChangeClrName: (value: string) => void;
  onDeleteColumn: (columnName: string) => void;
  onColumnNameChange: (columnName: string, value: string) => void;
  onColumnTypeChange: (columnName: string, value: string) => void;
  onColumnNullableChange: (columnName: string, value: boolean) => void;
  onColumnPrimaryKeyChange: (columnName: string, value: boolean) => void;
  onSetColumnCurrentTimestamp: (columnName: string, enabled: boolean) => void;
  onDeleteRelationship: (relationshipId: string) => void;
  onUpdateRelationship: (relationshipId: string, nextRelationship: Partial<ErdRelationship>) => void;
  onDragStart: (columnName: string) => void;
  onDragEnd: () => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (draggedName: string, targetName: string) => void;
  draggedColumnName: string | null;
  isIdentityEligibleColumnType: (type: string) => boolean;
  isTimestampColumnType: (type: string) => boolean;
}

function ErdSidebarHeader({
  selectedTable,
  edgeCrossings,
  onAutoLayout,
  onPrintGraph,
  onDeleteTable,
}: Pick<ErdEditorSidebarProps, 'selectedTable' | 'edgeCrossings' | 'onAutoLayout' | 'onPrintGraph' | 'onDeleteTable'>) {
  return selectedTable ? (
    <div className={styles.sidebarTitleRow}>
      <div>
        <h2>{selectedTable.name}</h2>
        <p className={styles.muted}>Crossings: {edgeCrossings}</p>
      </div>
      <div className={styles.sidebarTitleActions}>
        <button type="button" className={styles.buttonSecondary} onClick={onAutoLayout} title="Auto layout" aria-label="Auto layout ERD">
          <Sparkles size={16} />
        </button>
        <button type="button" className={styles.buttonSecondary} onClick={onPrintGraph} title="Print graph" aria-label="Print graph">
          <Printer size={16} />
        </button>
        <button type="button" className={styles.buttonDanger} aria-label={`Delete entity ${selectedTable.name}`} onClick={onDeleteTable} title="Delete entity">
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  ) : (
    <div className={styles.sidebarTitleRow}>
      <div>
        <h2>Entity Relationship Diagram</h2>
        <p className={styles.muted}>Crossings: {edgeCrossings}</p>
      </div>
      <div className={styles.sidebarTitleActions}>
        <button type="button" className={styles.buttonSecondary} onClick={onAutoLayout} title="Auto layout" aria-label="Auto layout ERD">
          <Sparkles size={16} />
        </button>
        <button type="button" className={styles.buttonSecondary} onClick={onPrintGraph} title="Print graph" aria-label="Print graph">
          <Printer size={16} />
        </button>
      </div>
    </div>
  );
}

function ErdPropertyCard({
  column,
  draggedColumnName,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onDeleteColumn,
  onColumnNameChange,
  onColumnTypeChange,
  onColumnNullableChange,
  onColumnPrimaryKeyChange,
  onSetColumnCurrentTimestamp,
  commonPropertyTypes,
  isIdentityEligibleColumnType,
  isTimestampColumnType,
}: {
  column: ErdColumn;
  draggedColumnName: string | null;
  onDragStart: (columnName: string) => void;
  onDragEnd: () => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (draggedName: string, targetName: string) => void;
  onDeleteColumn: (columnName: string) => void;
  onColumnNameChange: (columnName: string, value: string) => void;
  onColumnTypeChange: (columnName: string, value: string) => void;
  onColumnNullableChange: (columnName: string, value: boolean) => void;
  onColumnPrimaryKeyChange: (columnName: string, value: boolean) => void;
  onSetColumnCurrentTimestamp: (columnName: string, enabled: boolean) => void;
  commonPropertyTypes: string[];
  isIdentityEligibleColumnType: (type: string) => boolean;
  isTimestampColumnType: (type: string) => boolean;
}) {
  return (
    <div
      className={styles.propertyCard}
      data-testid={`property-card-${column.name}`}
      draggable
      onDragStart={() => onDragStart(column.name)}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={() => onDrop(draggedColumnName ?? '', column.name)}
    >
      <div className={styles.cardHeader}>
        <span className={styles.dragHandle} aria-hidden="true">⋮⋮</span>
        <strong>{column.name}</strong>
        <button type="button" className={styles.buttonDanger} aria-label={`Delete property ${column.name}`} onClick={() => onDeleteColumn(column.name)}>Delete</button>
      </div>
      <div className={styles.fieldRow}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Name</span>
          <input
            className={styles.fieldInput}
            defaultValue={column.name}
            onBlur={(event) => onColumnNameChange(column.name, event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Type</span>
          <select
            className={styles.fieldInput}
            value={column.type}
            onChange={(event) => onColumnTypeChange(column.name, event.target.value)}
          >
            {column.type && !commonPropertyTypes.includes(column.type) && <option value={column.type}>{column.type}</option>}
            {commonPropertyTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
      </div>
      <div className={styles.checkboxRow}>
        <label className={styles.checkboxLabel}><input type="checkbox" checked={column.isNullable} onChange={(event) => onColumnNullableChange(column.name, event.target.checked)} /> Nullable</label>
        <label className={styles.checkboxLabel}><input type="checkbox" checked={column.isPrimaryKey} onChange={(event) => onColumnPrimaryKeyChange(column.name, event.target.checked)} /> Primary key</label>
        <span className={styles.columnBadge}>{column.isForeignKey ? `FK${column.foreignKeyTarget ? ` → ${column.foreignKeyTarget}` : ''}` : 'Regular'}</span>
        {column.isPrimaryKey && isIdentityEligibleColumnType(column.type) && (
          <span className={styles.columnBadge} title="Numeric primary keys are exported as IDENTITY columns">Auto</span>
        )}
        {isTimestampColumnType(column.type) && (
          <button
            type="button"
            className={`${styles.defaultChip} ${column.defaultGeneration === 'current-timestamp' ? styles.defaultChipActive : ''}`}
            onClick={() => onSetColumnCurrentTimestamp(column.name, column.defaultGeneration !== 'current-timestamp')}
            title="Use the current time as the default value"
            aria-label={`Default for ${column.name}`}
          >
            Now
          </button>
        )}
      </div>
    </div>
  );
}

function ErdPropertiesSection({
  selectedTable,
  draggedColumnName,
  onAddColumn,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onDeleteColumn,
  onColumnNameChange,
  onColumnTypeChange,
  onColumnNullableChange,
  onColumnPrimaryKeyChange,
  onSetColumnCurrentTimestamp,
  commonPropertyTypes,
  isIdentityEligibleColumnType,
  isTimestampColumnType,
}: Pick<ErdEditorSidebarProps, 'selectedTable' | 'draggedColumnName' | 'onAddColumn' | 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onDrop' | 'onDeleteColumn' | 'onColumnNameChange' | 'onColumnTypeChange' | 'onColumnNullableChange' | 'onColumnPrimaryKeyChange' | 'onSetColumnCurrentTimestamp' | 'commonPropertyTypes' | 'isIdentityEligibleColumnType' | 'isTimestampColumnType'>) {
  if (!selectedTable) return null;

  return (
    <div className={styles.sidebarSection}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>Properties</h3>
        <button type="button" className={styles.buttonSecondary} onClick={onAddColumn}>Add property</button>
      </div>
      {selectedTable.columns.length === 0 ? <p className={styles.muted}>No properties available for this table.</p> : selectedTable.columns.map((column) => (
        <ErdPropertyCard
          key={`${selectedTable.id}-${column.name}`}
          column={column}
          draggedColumnName={draggedColumnName}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onDeleteColumn={onDeleteColumn}
          onColumnNameChange={onColumnNameChange}
          onColumnTypeChange={onColumnTypeChange}
          onColumnNullableChange={onColumnNullableChange}
          onColumnPrimaryKeyChange={onColumnPrimaryKeyChange}
          onSetColumnCurrentTimestamp={onSetColumnCurrentTimestamp}
          commonPropertyTypes={commonPropertyTypes}
          isIdentityEligibleColumnType={isIdentityEligibleColumnType}
          isTimestampColumnType={isTimestampColumnType}
        />
      ))}
    </div>
  );
}

function ErdRelationshipsSection({
  selectedTable,
  normalizedModel,
  tableRelationships,
  onAddRelationship,
  onDeleteRelationship,
  onUpdateRelationship,
}: Pick<ErdEditorSidebarProps, 'selectedTable' | 'normalizedModel' | 'tableRelationships' | 'onAddRelationship' | 'onDeleteRelationship' | 'onUpdateRelationship'>) {
  if (!selectedTable) return null;

  return (
    <div className={styles.sidebarSection}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>Relationships</h3>
        <button type="button" className={styles.buttonSecondary} onClick={onAddRelationship}>Add relationship</button>
      </div>
      {tableRelationships.length === 0 ? <p className={styles.muted}>No relationships involve this table.</p> : tableRelationships.map((relationship) => (
        <div key={relationship.id} className={styles.relationshipCard}>
          <div className={styles.cardHeader}>
            <strong>{relationship.dependentTable} → {relationship.principalTable}</strong>
            <button type="button" className={styles.buttonDanger} aria-label={`Delete relationship ${relationship.dependentTable} to ${relationship.principalTable}`} onClick={() => onDeleteRelationship(relationship.id)}>Delete</button>
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Dependent table</span>
              <select className={styles.fieldInput} value={relationship.dependentTable} onChange={(event) => onUpdateRelationship(relationship.id, { dependentTable: event.target.value })}>
                {normalizedModel.tables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Principal table</span>
              <select className={styles.fieldInput} value={relationship.principalTable} onChange={(event) => onUpdateRelationship(relationship.id, { principalTable: event.target.value })}>
                {normalizedModel.tables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}
              </select>
            </label>
          </div>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Foreign key columns</span>
            <input
              key={relationship.id}
              className={styles.fieldInput}
              defaultValue={relationship.foreignKeyColumns.join(', ')}
              onBlur={(event) => onUpdateRelationship(relationship.id, {
                foreignKeyColumns: event.target.value.split(',').map((column) => column.trim()).filter(Boolean),
              })}
            />
          </label>
          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Dependent cardinality</span>
              <select className={styles.fieldInput} value={relationship.dependentCardinality} onChange={(event) => onUpdateRelationship(relationship.id, { dependentCardinality: event.target.value as ErdModel['relationships'][number]['dependentCardinality'] })}>
                <option value="one">one</option>
                <option value="zero-or-one">zero-or-one</option>
                <option value="many">many</option>
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Principal cardinality</span>
              <select className={styles.fieldInput} value={relationship.principalCardinality} onChange={(event) => onUpdateRelationship(relationship.id, { principalCardinality: event.target.value as ErdModel['relationships'][number]['principalCardinality'] })}>
                <option value="one">one</option>
                <option value="zero-or-one">zero-or-one</option>
                <option value="many">many</option>
              </select>
            </label>
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Dependent navigation</span>
              <input className={styles.fieldInput} value={relationship.dependentNavigation || ''} onChange={(event) => onUpdateRelationship(relationship.id, { dependentNavigation: event.target.value || undefined })} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Principal navigation</span>
              <input className={styles.fieldInput} value={relationship.principalNavigation || ''} onChange={(event) => onUpdateRelationship(relationship.id, { principalNavigation: event.target.value || undefined })} />
            </label>
          </div>
        </div>
      ))}
    </div>
  );
}

function ErdDiagnosticsSection({ diagnosticsOpen, onToggleDiagnostics, diagnostics }: { diagnosticsOpen: boolean; onToggleDiagnostics: () => void; diagnostics: ErdModel['diagnostics']; }) {
  if (diagnostics.length === 0) return null;

  return (
    <section className={styles.diagnosticsSection} aria-label="Diagnostics" role="status">
      <button
        type="button"
        className={styles.diagnosticsToggle}
        aria-expanded={diagnosticsOpen}
        aria-label={diagnosticsOpen ? 'Collapse diagnostics' : 'Expand diagnostics'}
        title={diagnosticsOpen ? 'Collapse diagnostics' : 'Expand diagnostics'}
        onClick={onToggleDiagnostics}
      >
        <ChevronDown className={`${styles.diagnosticsIcon}${diagnosticsOpen ? ` ${styles.diagnosticsIconOpen}` : ''}`} aria-hidden="true" />
        <span>Diagnostics</span>
      </button>
      {diagnosticsOpen && (
        <div className={styles.diagnosticsList}>
          {diagnostics.map((diagnostic, index) => <div key={`${diagnostic.message}-${index}`}>{diagnostic.message}</div>)}
        </div>
      )}
    </section>
  );
}

export function ErdEditorSidebar({
  selectedTable,
  edgeCrossings,
  diagnosticsOpen,
  normalizedModel,
  tableRelationships,
  commonPropertyTypes,
  onAutoLayout,
  onPrintGraph,
  onDeleteTable,
  onToggleDiagnostics,
  onAddEntity,
  onAddColumn,
  onAddRelationship,
  onRenameTable,
  onChangeClrName,
  onDeleteColumn,
  onColumnNameChange,
  onColumnTypeChange,
  onColumnNullableChange,
  onColumnPrimaryKeyChange,
  onSetColumnCurrentTimestamp,
  onDeleteRelationship,
  onUpdateRelationship,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  draggedColumnName,
  isIdentityEligibleColumnType,
  isTimestampColumnType,
}: ErdEditorSidebarProps) {
  return (
    <aside className={styles.sidebar} aria-label="ERD details">
      <ErdSidebarHeader
        selectedTable={selectedTable}
        edgeCrossings={edgeCrossings}
        onAutoLayout={onAutoLayout}
        onPrintGraph={onPrintGraph}
        onDeleteTable={onDeleteTable}
      />
      {selectedTable ? (
        <div className={styles.sidebarSection}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Table name</span>
            <input aria-label="Table name" className={styles.fieldInput} value={selectedTable.name} onChange={(event) => onRenameTable(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>CLR name</span>
            <input aria-label="CLR name" className={styles.fieldInput} value={selectedTable.clrName} onChange={(event) => onChangeClrName(event.target.value)} />
          </label>

          <ErdPropertiesSection
            selectedTable={selectedTable}
            draggedColumnName={draggedColumnName}
            onAddColumn={onAddColumn}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDeleteColumn={onDeleteColumn}
            onColumnNameChange={onColumnNameChange}
            onColumnTypeChange={onColumnTypeChange}
            onColumnNullableChange={onColumnNullableChange}
            onColumnPrimaryKeyChange={onColumnPrimaryKeyChange}
            onSetColumnCurrentTimestamp={onSetColumnCurrentTimestamp}
            commonPropertyTypes={commonPropertyTypes}
            isIdentityEligibleColumnType={isIdentityEligibleColumnType}
            isTimestampColumnType={isTimestampColumnType}
          />

          <ErdRelationshipsSection
            selectedTable={selectedTable}
            normalizedModel={normalizedModel}
            tableRelationships={tableRelationships}
            onAddRelationship={onAddRelationship}
            onDeleteRelationship={onDeleteRelationship}
            onUpdateRelationship={onUpdateRelationship}
          />
        </div>
      ) : (
        <div className={styles.emptySidebarState}>
          <p>Select a table to inspect it.</p>
          <button type="button" className={styles.buttonSecondary} onClick={onAddEntity}>Add Entity</button>
        </div>
      )}
      <ErdDiagnosticsSection
        diagnosticsOpen={diagnosticsOpen}
        onToggleDiagnostics={onToggleDiagnostics}
        diagnostics={normalizedModel.diagnostics}
      />
    </aside>
  );
}