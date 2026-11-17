import type { ErdModel, ErdRelationship, ErdTable } from '../types/erd';

const XSD_NAMESPACE = 'http://www.w3.org/2001/XMLSchema';

function xmlName(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]/g, '_');
  if (!normalized) throw new Error('ERD names must not be empty.');
  return /^[A-Za-z_]/.test(normalized) ? normalized : `_${normalized}`;
}

function pluralize(name: string): string {
  if (name.endsWith('y') && !/[aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  if (name.endsWith('s')) return `${name}es`;
  return `${name}s`;
}

function columnType(type: string): string {
  switch (type.trim().replace(/\?$/, '').replace(/^System\./, '').toLowerCase()) {
    case 'int':
    case 'int16':
    case 'int32':
    case 'int64':
    case 'short':
    case 'long':
    case 'byte':
    case 'sbyte':
    case 'uint':
    case 'ushort':
    case 'ulong':
      return 'xs:integer';
    case 'decimal':
      return 'xs:decimal';
    case 'double':
      return 'xs:double';
    case 'float':
    case 'single':
      return 'xs:float';
    case 'bool':
    case 'boolean':
      return 'xs:boolean';
    case 'datetime':
    case 'datetimeoffset':
      return 'xs:dateTime';
    case 'dateonly':
      return 'xs:date';
    case 'timeonly':
      return 'xs:time';
    case 'guid':
      return 'xs:string';
    case 'byte[]':
      return 'xs:base64Binary';
    default:
      return 'xs:string';
  }
}

function isIntegerIdentity(table: ErdTable, columnName: string): boolean {
  const column = table.columns.find((candidate) => candidate.name === columnName);
  return Boolean(column?.isPrimaryKey && /^(int|long|short|int16|int32|int64)\??$/i.test(column.type.trim()));
}

function isGeneratedSlugKey(table: ErdTable, columnName: string): boolean {
  const column = table.columns.find((candidate) => candidate.name === columnName);
  if (!column?.isPrimaryKey || columnType(column.type) !== 'xs:string') return false;
  const hasSalientField = table.columns.some((candidate) =>
    !candidate.isPrimaryKey && /^(title|name|label)$/i.test(candidate.name));
  return hasSalientField && /^(id|slug)$/i.test(column.name);
}

function isSlugSource(table: ErdTable, columnName: string): boolean {
  const column = table.columns.find((candidate) => candidate.name === columnName);
  return Boolean(column && !column.isPrimaryKey && /^(title|name|label)$/i.test(column.name) &&
    table.columns.some((candidate) => isGeneratedSlugKey(table, candidate.name)));
}

function widgetForColumn(name: string, type: string): string | null {
  if (type.trim().replace(/\?$/, '').toLowerCase() === 'byte[]') return 'image';
  if (/(^|[_-])(url|uri|website|link)$/i.test(name) || /(Url|URI|Website|Link)$/i.test(name)) return 'url';
  if (/(html|markup|richtext)/i.test(name)) return 'html';
  return null;
}

function occurrence(cardinality: ErdRelationship['principalCardinality']) {
  if (cardinality === 'many') return { minOccurs: '0', maxOccurs: 'unbounded' };
  if (cardinality === 'zero-or-one') return { minOccurs: '0', maxOccurs: '1' };
  return { minOccurs: '1', maxOccurs: '1' };
}

function elementForColumn(table: ErdTable, column: ErdTable['columns'][number]) {
  const generated = isIntegerIdentity(table, column.name) || isGeneratedSlugKey(table, column.name);
  const widget = widgetForColumn(column.name, column.type);
  const slugSource = isSlugSource(table, column.name);
  return {
    '@attributes': {
      name: xmlName(column.name),
      type: widget === 'image' ? 'xs:string' : columnType(column.type),
      minOccurs: column.isNullable || generated ? '0' : '1',
    },
    ...(widget || isGeneratedSlugKey(table, column.name) || slugSource
      ? {
        'xs:annotation': {
          'xs:appinfo': {
            ...(widget ? { 'ui:widget': widget } : {}),
            ...(isGeneratedSlugKey(table, column.name) ? { 'cms:generated': 'slug' } : {}),
            ...(slugSource ? { 'cms:slug-source': 'true' } : {}),
          },
        },
      }
      : {}),
  };
}

function identityFields(table: ErdTable): ErdTable['columns'] {
  const primaryKeys = table.columns.filter((column) => column.isPrimaryKey);
  return primaryKeys.length > 0
    ? primaryKeys
    : [{ name: 'RowId', type: 'long', isNullable: false, isPrimaryKey: true, isForeignKey: false }];
}

function foreignKeyNames(model: ErdModel, tableId: string): Set<string> {
  return new Set(model.relationships
    .filter((relationship) => relationship.dependentTable === tableId)
    .flatMap((relationship) => relationship.foreignKeyColumns.map((column) => column.toLowerCase())));
}

interface EntityRelationshipView {
  relationship: ErdRelationship;
  target: ErdTable;
  navigationName: string;
  cardinality: ErdRelationship['principalCardinality'];
}

function relationshipViews(
  model: ErdModel,
  table: ErdTable,
  tablesById: ReadonlyMap<string, ErdTable>,
): EntityRelationshipView[] {
  const views: EntityRelationshipView[] = [];
  for (const relationship of model.relationships) {
    if (relationship.principalTable === table.id) {
      const target = tablesById.get(relationship.dependentTable);
      if (target) {
        views.push({
          relationship,
          target,
          navigationName: relationship.principalNavigation?.trim() || pluralize(target.name),
          cardinality: relationship.dependentCardinality,
        });
      }
    }
    if (relationship.dependentTable === table.id) {
      const target = tablesById.get(relationship.principalTable);
      if (target) {
        views.push({
          relationship,
          target,
          navigationName: relationship.dependentNavigation?.trim() || target.name,
          cardinality: relationship.principalCardinality,
        });
      }
    }
  }
  return views;
}

function uniqueNavigationNames(table: ErdTable, views: EntityRelationshipView[]): string[] {
  const names = new Set(table.columns.map((column) => xmlName(column.name).toLowerCase()));
  return views.map((view) => {
    let name = xmlName(view.navigationName);
    if (names.has(name.toLowerCase())) name = xmlName(`${name}_${view.target.id}`);
    if (names.has(name.toLowerCase())) {
      throw new Error(`Entity "${table.name}" has multiple relationships that produce the same XML element name "${name}".`);
    }
    names.add(name.toLowerCase());
    return name;
  });
}

function appendReferenceType(
  table: ErdTable,
  rootId: string,
  referenceTypes: Map<string, string>,
  complexTypes: Record<string, unknown>[],
): string {
  const existing = referenceTypes.get(table.id);
  if (existing) return existing;

  const name = `Reference_${xmlName(rootId)}_${referenceTypes.size + 1}`;
  referenceTypes.set(table.id, name);
  const keyElements = identityFields(table).map((column) => ({
    '@attributes': {
      name: xmlName(column.name),
      type: column.name === 'RowId' ? 'xs:long' : columnType(column.type),
      minOccurs: '1',
    },
  }));
  complexTypes.push({
    '@attributes': { name },
    'xs:annotation': {
      'xs:appinfo': {
        'cms:table-id': table.id,
        'cms:reference-only': 'true',
      },
    },
    'xs:sequence': { 'xs:element': keyElements },
  });
  return name;
}

function createEntityTemplate(
  model: ErdModel,
  table: ErdTable,
  tablesById: ReadonlyMap<string, ErdTable>,
  ancestors: ReadonlySet<string>,
): Record<string, unknown> {
  const foreignKeys = foreignKeyNames(model, table.id);
  const entity: Record<string, unknown> = {};
  for (const column of table.columns) {
    if (foreignKeys.has(column.name.toLowerCase()) ||
      isIntegerIdentity(table, column.name) ||
      isGeneratedSlugKey(table, column.name)) continue;
    entity[xmlName(column.name)] = { _text: '' };
  }

  const views = relationshipViews(model, table, tablesById);
  const names = uniqueNavigationNames(table, views);
  views.forEach((view, index) => {
    const name = names[index];
    if (view.cardinality === 'many') {
      entity[name] = [];
    } else if (view.cardinality === 'one') {
      if (ancestors.has(view.target.id)) {
        entity[name] = Object.fromEntries(identityFields(view.target)
          .map((column) => [xmlName(column.name), { _text: '' }]));
      } else {
        entity[name] = createEntityTemplate(
          model,
          view.target,
          tablesById,
          new Set([...ancestors, view.target.id]),
        );
      }
    }
  });
  return entity;
}

export function createErdXmlTemplate(model: ErdModel, rootTableId: string): Record<string, unknown> {
  const tablesById = new Map(model.tables.map((table) => [table.id, table]));
  const root = tablesById.get(rootTableId);
  if (!root) throw new Error('Select an entity that exists in the ERD before creating its XML instance.');

  return {
    [xmlName(root.name)]: createEntityTemplate(model, root, tablesById, new Set([root.id])),
  };
}

export function generateErdXsd(model: ErdModel, rootTableId: string): Record<string, unknown> {
  const tablesById = new Map(model.tables.map((table) => [table.id, table]));
  const root = tablesById.get(rootTableId);
  if (!root) throw new Error('Select an entity that exists in the ERD before generating its XML Schema.');

  const complexTypes: Record<string, unknown>[] = [];
  const referenceTypes = new Map<string, string>();
  const rootTypeName = `Entity_${xmlName(root.id)}`;
  let pathTypeIndex = 0;

  const createEntityType = (table: ErdTable, ancestors: ReadonlySet<string>, isRoot = false): string => {
    const name = isRoot ? rootTypeName : `${rootTypeName}_Path${++pathTypeIndex}`;
    const foreignKeys = foreignKeyNames(model, table.id);
    const columns = table.columns
      .filter((column) => !foreignKeys.has(column.name.toLowerCase()))
      .map((column) => elementForColumn(table, column));
    const views = relationshipViews(model, table, tablesById);
    const navigationNames = uniqueNavigationNames(table, views);
    const navigations = views.map((view, index) => {
      const isReference = ancestors.has(view.target.id);
      const targetType = isReference
        ? appendReferenceType(view.target, root.id, referenceTypes, complexTypes)
        : createEntityType(view.target, new Set([...ancestors, view.target.id]));
      return {
        '@attributes': {
          name: navigationNames[index],
          type: targetType,
          ...occurrence(view.cardinality),
        },
        'xs:annotation': {
          'xs:appinfo': {
            'cms:relationship-id': view.relationship.id,
            'cms:target-table-id': view.target.id,
            ...(isReference ? { 'cms:reference-only': 'true' } : {}),
          },
        },
      };
    });

    complexTypes.push({
      '@attributes': { name },
      'xs:annotation': {
        'xs:appinfo': { 'cms:table-id': table.id },
      },
      'xs:sequence': { 'xs:element': [...columns, ...navigations] },
    });
    return name;
  };
  createEntityType(root, new Set([root.id]), true);

  return {
    'xs:schema': {
      '@attributes': {
        'xmlns:xs': XSD_NAMESPACE,
        'xmlns:ui': 'https://schemas.schema-sculptor.local/ui',
        'xmlns:cms': 'https://schemas.schema-sculptor.local/cms',
      },
      'xs:element': {
        '@attributes': { name: xmlName(root.name), type: rootTypeName },
        'xs:annotation': {
          'xs:appinfo': { 'cms:root-table-id': root.id },
        },
      },
      'xs:complexType': complexTypes,
    },
  };
}
