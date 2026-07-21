import type { ErdModel, ErdRelationship, ErdTable } from '../types/erd';

function propertyType(type: string, nullable: boolean): string {
  const value = type || 'string';
  return nullable && value !== 'string' && !value.endsWith('?') ? `${value}?` : value;
}

function relationshipConfig(relationship: ErdRelationship): string {
  const dependent = relationship.dependentTable;
  const principal = relationship.principalTable;
  const foreignKey = relationship.foreignKeyColumns.join(', ');
  const dependentNav = relationship.dependentNavigation;
  const principalNav = relationship.principalNavigation;
  const hasOne = dependentNav ? `.HasOne(item => item.${dependentNav})` : `.HasOne<${principal}>()`;
  const withPart = relationship.dependentCardinality === 'many'
    ? (principalNav ? `.WithMany(item => item.${principalNav})` : '.WithMany()')
    : (principalNav ? `.WithOne(item => item.${principalNav})` : '.WithOne()');
  return `        modelBuilder.Entity<${dependent}>()${hasOne}${withPart}.HasForeignKey(item => new { ${foreignKey} });`;
}

function entitySource(table: ErdTable): string {
  const lines = [`public class ${table.clrName}`, '{'];
  for (const column of table.columns) {
    lines.push(`    public ${propertyType(column.type, column.isNullable)} ${column.name} { get; set; }`);
  }
  for (const navigation of table.navigations) {
    const type = navigation.cardinality === 'many' ? `ICollection<${navigation.targetTable}>` : `${navigation.targetTable}${navigation.cardinality === 'zero-or-one' ? '?' : ''}`;
    const initializer = navigation.cardinality === 'many' ? ` = new List<${navigation.targetTable}>();` : '';
    lines.push(`    public ${type} ${navigation.name} { get; set; }${initializer}`);
  }
  lines.push('}', '');
  return lines.join('\n');
}

export function generateDbContextCSharp(model: ErdModel, contextName = 'SchoolContext'): string {
  const lines = [
    'using Microsoft.EntityFrameworkCore;',
    'using System;',
    'using System.Collections.Generic;',
    '',
    'namespace GeneratedErD;',
    '',
  ];
  for (const table of model.tables) lines.push(entitySource(table));
  lines.push(`public class ${contextName} : DbContext`, '{');
  for (const table of model.tables) lines.push(`    public DbSet<${table.clrName}> ${table.name}s { get; set; } = null!;`);
  lines.push('', '    protected override void OnModelCreating(ModelBuilder modelBuilder)', '    {');
  for (const relationship of model.relationships) lines.push(relationshipConfig(relationship));
  lines.push('    }', '}', '');
  return lines.join('\n');
}
