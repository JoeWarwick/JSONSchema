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

function pluralizeNavigationName(name: string): string {
  if (name.endsWith('y') && !/[aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  if (name.endsWith('s')) return `${name}es`;
  return `${name}s`;
}

function addNavigation(tables: ErdTable[], tableId: string, navigation: ErdNavigation): ErdTable[] {
  return tables.map((table) => {
    if (table.id !== tableId) return table;
    const navigations = table.navigations.filter((item) => !(item.name === navigation.name && item.targetTable === navigation.targetTable));
    return {
      ...table,
      navigations: [...navigations, navigation],
    };
  });
}

function removeNavigation(tables: ErdTable[], tableId: string, navigation: ErdNavigation): ErdTable[] {
  return tables.map((table) => {
    if (table.id !== tableId) return table;
    return {
      ...table,
      navigations: table.navigations.filter((item) => !(item.name === navigation.name && item.targetTable === navigation.targetTable)),
    };
  });
}

function buildRelationshipNavigations(relationship: Pick<ErdRelationship, 'dependentTable' | 'principalTable' | 'principalCardinality' | 'dependentCardinality' | 'principalNavigation' | 'dependentNavigation'>): { dependent: ErdNavigation; principal: ErdNavigation } {
  return {
    dependent: {
      name: relationship.dependentNavigation ?? relationship.principalTable,
      targetTable: relationship.principalTable,
      cardinality: relationship.principalCardinality,
    },
    principal: {
      name: relationship.principalNavigation ?? pluralizeNavigationName(relationship.dependentTable),
      targetTable: relationship.dependentTable,
      cardinality: relationship.dependentCardinality,
    },
  };
}

function applyRelationshipNavigations(tables: ErdTable[], previousRelationship: Pick<ErdRelationship, 'dependentTable' | 'principalTable' | 'principalCardinality' | 'dependentCardinality' | 'principalNavigation' | 'dependentNavigation'> | null, nextRelationship: Pick<ErdRelationship, 'dependentTable' | 'principalTable' | 'principalCardinality' | 'dependentCardinality' | 'principalNavigation' | 'dependentNavigation'> | null): ErdTable[] {
  let nextTables = tables;
  if (previousRelationship) {
    const previousNavigations = buildRelationshipNavigations(previousRelationship);
    nextTables = removeNavigation(nextTables, previousRelationship.dependentTable, previousNavigations.dependent);
    nextTables = removeNavigation(nextTables, previousRelationship.principalTable, previousNavigations.principal);
  }
  if (nextRelationship) {
    const nextNavigations = buildRelationshipNavigations(nextRelationship);
    nextTables = addNavigation(nextTables, nextRelationship.dependentTable, nextNavigations.dependent);
    nextTables = addNavigation(nextTables, nextRelationship.principalTable, nextNavigations.principal);
  }
  return nextTables;
}

function uniqueTableId(existingIds: Set<string>, baseName: string): string {
  let candidate = baseName;
  let index = 2;
  while (existingIds.has(candidate)) {
    candidate = `${baseName}${index}`;
    index += 1;
  }
  existingIds.add(candidate);
  return candidate;
}

function uniqueName(existingNames: Set<string>, baseName: string): string {
  let candidate = baseName;
  let index = 2;
  while (existingNames.has(candidate)) {
    candidate = `${baseName}${index}`;
    index += 1;
  }
  existingNames.add(candidate);
  return candidate;
}

function getPrincipalKeyColumns(table: ErdTable): ErdColumn[] {
  const primaryKeyColumns = table.columns.filter((column) => column.isPrimaryKey);
  if (primaryKeyColumns.length > 0) return primaryKeyColumns;
  if (table.columns.length > 0) return table.columns.slice(0, 1);
  return [{ name: `${table.id}ID`, type: 'int', isNullable: false, isPrimaryKey: true, isForeignKey: false }];
}

function resolveForeignKeyColumnName(principalTable: ErdTable, principalColumn: ErdColumn, dependentTable: ErdTable, allowReuse: boolean): string {
  if (!allowReuse) {
    return uniqueName(new Set(dependentTable.columns.map((column) => column.name)), `${principalTable.id}ID`);
  }

  const candidates = new Set<string>([principalColumn.name]);
  if (principalColumn.name.toLowerCase() === 'id' || principalColumn.name === `${principalTable.id}ID`) {
    candidates.add(`${principalTable.id}ID`);
  }
  if (principalColumn.name === `${principalTable.id}Id`) {
    candidates.add(`${principalTable.id}ID`);
  }

  for (const candidate of candidates) {
    if (dependentTable.columns.some((column) => column.name === candidate)) return candidate;
  }

  return uniqueName(new Set(dependentTable.columns.map((column) => column.name)), `${principalTable.id}ID`);
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

export function addErdTable(model: ErdModel, baseName = 'NewEntity'): { model: ErdModel; tableId: string } {
  const existingIds = new Set(model.tables.map((table) => table.id));
  const tableId = uniqueTableId(existingIds, baseName);
  const nextTable: ErdTable = {
    id: tableId,
    name: tableId,
    clrName: tableId,
    columns: [
      {
        name: 'ID',
        type: 'int',
        isNullable: false,
        isPrimaryKey: true,
        isForeignKey: false,
      },
    ],
    navigations: [],
  };

  return {
    model: normalizeErdModel({
      ...model,
      tables: [...model.tables, nextTable],
    }),
    tableId,
  };
}

export function deleteErdTable(model: ErdModel, tableId: string): ErdModel {
  const tables = model.tables.filter((table) => table.id !== tableId);
  const relationships = model.relationships.filter((relationship) => relationship.dependentTable !== tableId && relationship.principalTable !== tableId);
  const navigations = tables.map((table) => ({
    ...table,
    navigations: table.navigations.filter((navigation) => navigation.targetTable !== tableId),
  }));

  return normalizeErdModel({
    ...model,
    tables: navigations,
    relationships,
    nodePositions: model.nodePositions
      ? Object.fromEntries(Object.entries(model.nodePositions).filter(([id]) => id !== tableId))
      : undefined,
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

export function reorderErdTableColumns(model: ErdModel, tableId: string, columnName: string, targetColumnName: string): ErdModel {
  if (columnName === targetColumnName) return model;

  const tables = model.tables.map((table) => {
    if (table.id !== tableId) return table;

    const fromIndex = table.columns.findIndex((column) => column.name === columnName);
    const toIndex = table.columns.findIndex((column) => column.name === targetColumnName);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return table;

    const nextColumns = [...table.columns];
    const [movedColumn] = nextColumns.splice(fromIndex, 1);
    nextColumns.splice(toIndex, 0, movedColumn);

    return {
      ...table,
      columns: nextColumns,
    };
  });

  return normalizeErdModel({
    ...model,
    tables,
  });
}

export function addErdTableColumn(model: ErdModel, tableId: string, nextColumn: Partial<ErdColumn> = {}): ErdModel {
  const tables = model.tables.map((table) => {
    if (table.id !== tableId) return table;
    const existingNames = new Set(table.columns.map((column) => column.name));
    const nextName = uniqueName(existingNames, nextColumn.name?.trim() || 'NewProperty');
    const baseColumn: ErdColumn = {
      type: 'string',
      isNullable: true,
      isPrimaryKey: false,
      isForeignKey: false,
      ...nextColumn,
      name: nextName,
    };

    return {
      ...table,
      columns: [...table.columns, baseColumn],
    };
  });

  return normalizeErdModel({
    ...model,
    tables,
  });
}

export function deleteErdTableColumn(model: ErdModel, tableId: string, columnName: string): ErdModel {
  const tables = model.tables.map((table) => table.id === tableId ? {
    ...table,
    columns: table.columns.filter((column) => column.name !== columnName),
  } : table);

  const relationships = model.relationships.flatMap((relationship) => {
    if (relationship.dependentTable !== tableId || !relationship.foreignKeyColumns.includes(columnName)) return [relationship];
    const nextForeignKeyColumns = relationship.foreignKeyColumns.filter((fkColumn) => fkColumn !== columnName);
    return nextForeignKeyColumns.length > 0 ? [{
      ...relationship,
      foreignKeyColumns: nextForeignKeyColumns,
    }] : [];
  });

  return normalizeErdModel({
    ...model,
    tables,
    relationships,
  });
}

export function addErdRelationship(model: ErdModel, dependentTableId: string, principalTableId?: string): ErdModel {
  const dependentTable = model.tables.find((table) => table.id === dependentTableId);
  if (!dependentTable) return model;

  const targetTable = model.tables.find((table) => table.id === principalTableId)
    ?? model.tables.find((table) => table.id !== dependentTableId)
    ?? dependentTable;
  const hasExistingRelationship = model.relationships.some((relationship) => relationship.dependentTable === dependentTable.id && relationship.principalTable === targetTable.id);

  const keyColumns = getPrincipalKeyColumns(targetTable);
  const foreignKeyColumns = keyColumns.map((column) => resolveForeignKeyColumnName(targetTable, column, dependentTable, !hasExistingRelationship));
  const dependentColumns = [...dependentTable.columns];

  for (let index = 0; index < keyColumns.length; index += 1) {
    const principalColumn = keyColumns[index];
    const nextColumnName = foreignKeyColumns[index];
    if (dependentColumns.some((column) => column.name === nextColumnName)) continue;
    dependentColumns.push({
      name: nextColumnName,
      type: principalColumn.type || 'int',
      isNullable: true,
      isPrimaryKey: false,
      isForeignKey: true,
      foreignKeyTarget: targetTable.id,
    });
  }

  const nextRelationship = {
    principalTable: targetTable.id,
    dependentTable: dependentTable.id,
    foreignKeyColumns,
    principalCardinality: 'one' as const,
    dependentCardinality: 'many' as const,
    explicit: true,
    dependentNavigation: targetTable.id,
    principalNavigation: pluralizeNavigationName(dependentTable.id),
  };

  return normalizeErdModel({
    ...model,
    tables: applyRelationshipNavigations(model.tables.map((table) => table.id === dependentTableId ? {
      ...table,
      columns: dependentColumns,
    } : table), null, nextRelationship),
    relationships: [...model.relationships, {
      ...nextRelationship,
      id: buildRelationshipId(nextRelationship),
    }],
  });
}

export function deleteErdRelationship(model: ErdModel, relationshipId: string): ErdModel {
  const relationship = model.relationships.find((item) => item.id === relationshipId) ?? null;

  return normalizeErdModel({
    ...model,
    tables: relationship ? applyRelationshipNavigations(model.tables, relationship, null) : model.tables,
    relationships: model.relationships.filter((item) => item.id !== relationshipId),
  });
}

export function updateErdRelationship(model: ErdModel, relationshipId: string, updater: (relationship: ErdRelationship) => ErdRelationship): ErdModel {
  const previousRelationship = model.relationships.find((relationship) => relationship.id === relationshipId) ?? null;
  const relationships = model.relationships.map((relationship) => {
    if (relationship.id !== relationshipId) return relationship;
    const updated = updater(relationship);
    return {
      ...updated,
      foreignKeyColumns: [...updated.foreignKeyColumns],
      id: buildRelationshipId(updated),
    };
  });

  const nextRelationship = relationships.find((relationship) => relationship.id === relationshipId) ?? null;

  return normalizeErdModel({
    ...model,
    tables: applyRelationshipNavigations(model.tables, previousRelationship, nextRelationship),
    relationships,
  });
}

export function relatedRelationships(model: ErdModel, tableId: string): ErdRelationship[] {
  return model.relationships.filter((relationship) => relationship.principalTable === tableId || relationship.dependentTable === tableId);
}