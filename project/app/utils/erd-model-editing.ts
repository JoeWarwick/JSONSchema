import type { ErdColumn, ErdModel, ErdNavigation, ErdRelationship, ErdTable } from '../types/erd';

export function buildRelationshipId(relationship: Pick<ErdRelationship, 'dependentTable' | 'principalTable' | 'foreignKeyColumns'>): string {
  return `${relationship.dependentTable}->${relationship.principalTable}:${relationship.foreignKeyColumns.join(',')}`;
}

function syncTableForeignKeys(tables: ErdTable[], relationships: ErdRelationship[]): ErdTable[] {
  const foreignKeyTargets = new Map<string, Map<string, string>>();

  for (const relationship of relationships) {
    const targets = foreignKeyTargets.get(relationship.dependentTable) ?? new Map<string, string>();
    for (const columnName of relationship.foreignKeyColumns) {
      targets.set(columnName, relationship.principalTable);
    }
    foreignKeyTargets.set(relationship.dependentTable, targets);
  }

  return tables.map((table) => {
    const targets = foreignKeyTargets.get(table.id) ?? new Map<string, string>();
    return {
      ...table,
      columns: table.columns.map((column) => {
        const target = targets.get(column.name);
        return {
          ...column,
          isForeignKey: Boolean(target),
          foreignKeyTarget: target,
        };
      }),
    };
  });
}

function syncNavigationReferences(navigations: ErdNavigation[], oldTableId: string, nextTableId: string): ErdNavigation[] {
  return navigations.map((navigation) => navigation.targetTable === oldTableId ? { ...navigation, targetTable: nextTableId } : navigation);
}

export function normalizeErdModel(model: ErdModel): ErdModel {
  const relationships = model.relationships.map((relationship) => ({
    ...relationship,
    foreignKeyColumns: [...relationship.foreignKeyColumns],
    id: buildRelationshipId(relationship),
  }));

  return {
    ...model,
    relationships,
    tables: syncTableForeignKeys(model.tables, relationships),
  };
}

export function renameErdTable(model: ErdModel, tableId: string, nextName: string): ErdModel {
  const tables = model.tables.map((table) => table.id === tableId ? {
    ...table,
    id: nextName,
    name: nextName,
    clrName: nextName,
    navigations: syncNavigationReferences(table.navigations, tableId, nextName),
  } : table);

  const relationships = model.relationships.map((relationship) => ({
    ...relationship,
    principalTable: relationship.principalTable === tableId ? nextName : relationship.principalTable,
    dependentTable: relationship.dependentTable === tableId ? nextName : relationship.dependentTable,
  }));

  return normalizeErdModel({
    ...model,
    tables,
    relationships,
    nodePositions: model.nodePositions ? Object.fromEntries(
      Object.entries(model.nodePositions).map(([id, position]) => [id === tableId ? nextName : id, position]),
    ) : undefined,
  });
}

export function updateErdTableColumn(model: ErdModel, tableId: string, columnName: string, nextColumn: ErdColumn): ErdModel {
  const tables = model.tables.map((table) => {
    if (table.id !== tableId) return table;
    return {
      ...table,
      columns: table.columns.map((column) => column.name === columnName ? nextColumn : column),
    };
  });

  const relationships = model.relationships.map((relationship) => {
    if (relationship.dependentTable !== tableId || !relationship.foreignKeyColumns.includes(columnName)) return relationship;
    return {
      ...relationship,
      foreignKeyColumns: relationship.foreignKeyColumns.map((fkColumn) => fkColumn === columnName ? nextColumn.name : fkColumn),
    };
  });

  return normalizeErdModel({
    ...model,
    tables,
    relationships,
  });
}

export function updateErdRelationship(model: ErdModel, relationshipId: string, updater: (relationship: ErdRelationship) => ErdRelationship): ErdModel {
  const relationships = model.relationships.map((relationship) => {
    if (relationship.id !== relationshipId) return relationship;
    const updated = updater(relationship);
    return {
      ...updated,
      foreignKeyColumns: [...updated.foreignKeyColumns],
      id: buildRelationshipId(updated),
    };
  });

  return normalizeErdModel({
    ...model,
    relationships,
  });
}

export function relatedRelationships(model: ErdModel, tableId: string): ErdRelationship[] {
  return model.relationships.filter((relationship) => relationship.principalTable === tableId || relationship.dependentTable === tableId);
}