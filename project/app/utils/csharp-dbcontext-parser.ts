import type {
  ErdCardinality,
  ErdColumn,
  ErdDiagnostic,
  ErdModel,
  ErdNavigation,
  ErdRelationship,
  ErdSourceFile,
  ErdTable,
} from '../types/erd';

const collectionTypePattern = /^(?:ICollection|IEnumerable|IList|List|HashSet)<(.+)>$/;
const scalarTypes = new Set([
  'bool', 'byte', 'short', 'int', 'long', 'float', 'double', 'decimal',
  'string', 'char', 'DateTime', 'DateTimeOffset', 'TimeSpan', 'Guid',
  'byte[]', 'object',
]);

interface ParsedClass {
  name: string;
  body: string;
  fileName: string;
}

interface ParsedProperty {
  name: string;
  type: string;
  isNullable: boolean;
  attributes: string;
  fileName: string;
}

interface ParsedFluentRelationship {
  dependentTable: string;
  principalTable?: string;
  foreignKeyColumns: string[];
  principalCardinality: ErdCardinality;
  dependentCardinality: ErdCardinality;
  principalNavigation?: string;
  dependentNavigation?: string;
}

function lineNumberAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function stripComments(text: string): string {
  return text
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function matchingBrace(text: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function parseClasses(file: ErdSourceFile, diagnostics: ErdDiagnostic[]): ParsedClass[] {
  const text = stripComments(file.content);
  const classes: ParsedClass[] = [];
  const classPattern = /\bclass\s+(\w+)[^{]*\{/g;
  let match: RegExpExecArray | null;

  while ((match = classPattern.exec(text))) {
    const openIndex = text.indexOf('{', match.index);
    const closeIndex = matchingBrace(text, openIndex);
    if (closeIndex < 0) {
      diagnostics.push({
        severity: 'error',
        message: `Could not find the closing brace for class ${match[1]}.`,
        fileName: file.name,
        line: lineNumberAt(file.content, match.index),
      });
      continue;
    }
    classes.push({ name: match[1], body: text.slice(openIndex + 1, closeIndex), fileName: file.name });
    classPattern.lastIndex = closeIndex + 1;
  }
  return classes;
}

function normalizeType(type: string): { type: string; isNullable: boolean } {
  const cleaned = type.replace(/\s/g, '');
  const nullable = cleaned.endsWith('?');
  return { type: nullable ? cleaned.slice(0, -1) : cleaned, isNullable: nullable || cleaned === 'string' };
}

function propertyIsCollection(type: string): string | undefined {
  return collectionTypePattern.exec(type)?.[1]?.replace(/\?$/, '');
}

function parseProperties(parsedClass: ParsedClass): ParsedProperty[] {
  const properties: ParsedProperty[] = [];
  const propertyPattern = /((?:\s*\[[^\]]+\]\s*)*)(?:public|protected|internal)\s+(?:virtual\s+)?([\w<>?,.\x5B\]]+)\s+(\w+)\s*\{[^{}]*\}/g;
  let match: RegExpExecArray | null;
  while ((match = propertyPattern.exec(parsedClass.body))) {
    const normalized = normalizeType(match[2]);
    properties.push({
      name: match[3],
      type: normalized.type,
      isNullable: normalized.isNullable,
      attributes: match[1] || '',
      fileName: parsedClass.fileName,
    });
  }
  return properties;
}

function isScalarProperty(property: ParsedProperty, classNames: Set<string>): boolean {
  const collectionTarget = propertyIsCollection(property.type);
  return !collectionTarget && (scalarTypes.has(property.type) || !classNames.has(property.type));
}

function hasAttribute(property: ParsedProperty, attribute: string): boolean {
  return new RegExp(`\\[${attribute}(?:\\([^\\]]*)?\\]`).test(property.attributes);
}

function foreignKeyAttributeTarget(property: ParsedProperty): string | undefined {
  const match = /\[ForeignKey\s*\(\s*(?:nameof\s*\(\s*)?(\w+)/.exec(property.attributes);
  return match?.[1];
}

function parseKeyProperties(properties: ParsedProperty[], className: string): Set<string> {
  const keys = new Set(properties.filter((property) => hasAttribute(property, 'Key')).map((property) => property.name));
  if (keys.size > 0) return keys;
  const id = properties.find((property) => property.name.toLowerCase() === 'id' || property.name.toLowerCase() === `${className.toLowerCase()}id`);
  if (id) keys.add(id.name);
  return keys;
}

function parseForeignKeyProperties(properties: ParsedProperty[], navigations: ErdNavigation[]): Map<string, string> {
  const foreignKeys = new Map<string, string>();
  for (const property of properties) {
    const targetNavigation = foreignKeyAttributeTarget(property);
    if (targetNavigation) foreignKeys.set(property.name, targetNavigation);
  }
  for (const navigation of navigations) {
    const candidateNames = [`${navigation.name}ID`, `${navigation.name}Id`, `${navigation.targetTable}ID`, `${navigation.targetTable}Id`];
    const candidate = properties.find((property) => candidateNames.includes(property.name));
    if (candidate && !foreignKeys.has(candidate.name)) foreignKeys.set(candidate.name, navigation.name);
  }
  return foreignKeys;
}

function parseNavigations(properties: ParsedProperty[], classNames: Set<string>, fileName: string): ErdNavigation[] {
  return properties.flatMap((property): ErdNavigation[] => {
    const collectionTarget = propertyIsCollection(property.type);
    if (collectionTarget && classNames.has(collectionTarget)) {
      return [{ name: property.name, targetTable: collectionTarget, cardinality: 'many', sourceFile: fileName }];
    }
    if (!collectionTarget && classNames.has(property.type)) {
      return [{ name: property.name, targetTable: property.type, cardinality: property.isNullable ? 'zero-or-one' : 'one', sourceFile: fileName }];
    }
    return [];
  });
}

function parseForeignKeyColumns(value: string): string[] {
  return value
    .replace(/^\s*[\w]+\s*=>\s*/, '')
    .replace(/^\s*new\s*\{/, '')
    .replace(/\}\s*$/, '')
    .split(',')
    .map((part) => part.trim().replace(/^[\w]+\s*=>\s*[\w.]+\./, '').replace(/^[\w]+\s*=>\s*/, '').replace(/^\w+\./, ''))
    .filter(Boolean);
}

function parseFluentRelationships(files: ErdSourceFile[]): ParsedFluentRelationship[] {
  const relationships: ParsedFluentRelationship[] = [];
  for (const file of files) {
    const text = stripComments(file.content).replace(/\s+/g, ' ');
    const pattern = /Entity<(?<dependent>\w+)>\s*\(\s*\)\s*\.Has(?<first>One|Many)(?:<(?<principalGeneric>\w+)>)?\s*\(\s*(?<dependentNav>[^)]*)\)\s*\.With(?<second>One|Many)(?:<(?<dependentGeneric>\w+)>)?\s*\(\s*(?<principalNav>[^)]*)\)\s*\.HasForeignKey(?:<(?<fkGeneric>\w+)>)?\s*\(\s*(?<fk>[^)]*)\)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const groups = match.groups as Record<string, string | undefined>;
      const builderTable = groups.dependent!;
      const builderIsPrincipal = Boolean(groups.fkGeneric && groups.fkGeneric !== builderTable);
      const dependentTable = groups.fkGeneric || builderTable;
      const principalTable = groups.principalGeneric || groups.dependentGeneric;
      relationships.push({
        dependentTable,
        principalTable,
        foreignKeyColumns: parseForeignKeyColumns(groups.fk || ''),
        principalCardinality: groups.first === 'One' ? 'one' : 'many',
        dependentCardinality: groups.second === 'One' ? 'one' : 'many',
        dependentNavigation: (builderIsPrincipal ? groups.principalNav : groups.dependentNav)?.match(/=>\s*\w+\.(\w+)/)?.[1],
        principalNavigation: (builderIsPrincipal ? groups.dependentNav : groups.principalNav)?.match(/=>\s*\w+\.(\w+)/)?.[1],
      });
    }
  }
  return relationships;
}

function relationshipId(dependentTable: string, principalTable: string, columns: string[]): string {
  return `${dependentTable}->${principalTable}:${columns.join(',')}`;
}

export function parseDbContextFiles(sourceFiles: ErdSourceFile[]): ErdModel {
  const diagnostics: ErdDiagnostic[] = [];
  const classes = sourceFiles.flatMap((file) => parseClasses(file, diagnostics));
  const classNames = new Set(classes.map((item) => item.name));
  const dbSetNames = new Set<string>();
  const dbSetFiles = new Map<string, string>();

  for (const file of sourceFiles) {
    const dbSetPattern = /\bDbSet\s*<\s*(\w+)\s*>\s+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = dbSetPattern.exec(stripComments(file.content)))) {
      dbSetNames.add(match[1]);
      dbSetFiles.set(match[1], file.name);
    }
  }

  const parsedTableClasses = classes.filter((item) =>
    dbSetNames.has(item.name) || (!item.body.includes('DbSet<') && !item.body.includes('OnModelCreating'))
  );
  const parsedTableNames = new Set(parsedTableClasses.map((item) => item.name));
  const tableClasses = [
    ...parsedTableClasses,
    ...[...dbSetNames]
      .filter((name) => !parsedTableNames.has(name))
      .map((name) => ({ name, body: '', fileName: dbSetFiles.get(name) || sourceFiles[0]?.name || '' })),
  ];
  const tables: ErdTable[] = [];
  const propertyMap = new Map<string, ParsedProperty[]>();
  const navigationMap = new Map<string, ErdNavigation[]>();

  for (const parsedClass of tableClasses) {
    const properties = parseProperties(parsedClass);
    const navigations = parseNavigations(properties, classNames, parsedClass.fileName);
    const keyProperties = parseKeyProperties(properties, parsedClass.name);
    const foreignKeys = parseForeignKeyProperties(properties, navigations);
    const columns: ErdColumn[] = properties
      .filter((property) => isScalarProperty(property, classNames))
      .map((property) => ({
        name: property.name,
        type: property.type,
        isNullable: property.isNullable,
        isPrimaryKey: keyProperties.has(property.name),
        isForeignKey: foreignKeys.has(property.name),
        sourceFile: property.fileName,
      }));
    for (const [columnName, navigationName] of foreignKeys) {
      const column = columns.find((item) => item.name === columnName);
      const navigation = navigations.find((item) => item.name === navigationName);
      if (column && navigation) column.foreignKeyTarget = navigation.targetTable;
    }
    const table: ErdTable = { id: parsedClass.name, name: parsedClass.name, clrName: parsedClass.name, columns, navigations, sourceFile: parsedClass.fileName };
    tables.push(table);
    propertyMap.set(parsedClass.name, properties);
    navigationMap.set(parsedClass.name, navigations);
  }

  const relationships = new Map<string, ErdRelationship>();
  const addRelationship = (relationship: ErdRelationship) => relationships.set(relationship.id, relationship);
  const fluentRelationships = parseFluentRelationships(sourceFiles);

  for (const fluent of fluentRelationships) {
    const dependent = tables.find((table) => table.id === fluent.dependentTable);
    const inferredFromNavigation = dependent?.navigations.find((navigation) => navigation.name === fluent.dependentNavigation)?.targetTable;
    const inferredFromForeignKey = fluent.foreignKeyColumns
      .map((column) => column.replace(/_?ID$/i, '').replace(/Id$/, ''))
      .find((name) => tables.some((table) => table.id.toLowerCase() === name.toLowerCase()));
    const inferredPrincipalName = fluent.principalTable || inferredFromNavigation || inferredFromForeignKey;
    const principal = tables.find((table) => table.id === inferredPrincipalName);
    if (!dependent || !principal) {
      diagnostics.push({ severity: 'warning', message: `Could not resolve Fluent relationship ${fluent.dependentTable} -> ${fluent.principalTable}.` });
      continue;
    }
    const columns = fluent.foreignKeyColumns.length > 0 ? fluent.foreignKeyColumns : dependent.columns.filter((column) => column.isForeignKey && column.foreignKeyTarget === principal.id).map((column) => column.name);
    addRelationship({
      id: relationshipId(dependent.id, principal.id, columns),
      principalTable: principal.id,
      dependentTable: dependent.id,
      foreignKeyColumns: columns,
      principalCardinality: fluent.principalCardinality,
      dependentCardinality: fluent.dependentCardinality,
      principalNavigation: fluent.principalNavigation,
      dependentNavigation: fluent.dependentNavigation,
      explicit: true,
    });
  }

  for (const dependent of tables) {
    for (const navigation of dependent.navigations) {
      const principal = tables.find((table) => table.id === navigation.targetTable);
      if (!principal) continue;
      const columns = dependent.columns.filter((column) => column.isForeignKey && column.foreignKeyTarget === principal.id).map((column) => column.name);
      if (columns.length === 0) continue;
      const inverse = principal.navigations.find((item) => item.targetTable === dependent.id);
      const key = relationshipId(dependent.id, principal.id, columns);
      if (relationships.has(key)) continue;
      addRelationship({
        id: key,
        principalTable: principal.id,
        dependentTable: dependent.id,
        foreignKeyColumns: columns,
        principalCardinality: navigation.cardinality,
        dependentCardinality: inverse?.cardinality || 'many',
        principalNavigation: inverse?.name,
        dependentNavigation: navigation.name,
        explicit: false,
      });
    }
  }

  for (const table of tables) {
    for (const column of table.columns.filter((item) => item.isForeignKey && !item.foreignKeyTarget)) {
      const target = column.name.replace(/_?ID$/i, '').replace(/Id$/, '');
      const principal = tables.find((candidate) => candidate.id.toLowerCase() === target.toLowerCase());
      if (principal) column.foreignKeyTarget = principal.id;
    }
  }

  return {
    tables: tables.sort((a, b) => a.name.localeCompare(b.name)),
    relationships: [...relationships.values()].sort((a, b) => a.id.localeCompare(b.id)),
    sourceFiles,
    diagnostics,
  };
}
