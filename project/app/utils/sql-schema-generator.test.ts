import fs from 'node:fs';
import path from 'node:path';
import { parseDbContextFiles } from './csharp-dbcontext-parser';
import { generateErdSql } from './sql-schema-generator';
import type { ErdSourceFile } from '../types/erd';

function fixtureModel() {
  const directory = path.join(process.cwd(), 'app', 'test-fixtures', 'erd');
  const files: ErdSourceFile[] = fs.readdirSync(directory)
    .filter((name) => name.endsWith('.cs'))
    .sort()
    .map((name) => ({ name, content: fs.readFileSync(path.join(directory, name), 'utf8') }));
  return parseDbContextFiles(files);
}

describe('generateErdSql', () => {
  it('generates create-table and cascade-delete foreign key statements', () => {
    const sql = generateErdSql(fixtureModel());

    expect(sql).toContain('CREATE TABLE [dbo].[Student]');
    expect(sql).toContain('[EnrollmentID] INT IDENTITY(1, 1) NOT NULL');
    expect(sql).toContain('CONSTRAINT [PK_Enrollment] PRIMARY KEY ([EnrollmentID])');
    expect(sql).toContain('ALTER TABLE [dbo].[Enrollment]');
    expect(sql).toContain('FOREIGN KEY ([CourseID])');
    expect(sql).toContain('REFERENCES [dbo].[Course] ([CourseID])');
    expect(sql).toContain('ON DELETE CASCADE;');
  });

  it('adds a current timestamp default for date/time columns when requested', () => {
    const sql = generateErdSql({
      tables: [
        {
          id: 'AuditEntry',
          name: 'AuditEntry',
          clrName: 'AuditEntry',
          columns: [
            { name: 'Id', type: 'int', isNullable: false, isPrimaryKey: true, isForeignKey: false },
            { name: 'CreatedAt', type: 'DateTime', isNullable: false, isPrimaryKey: false, isForeignKey: false, defaultGeneration: 'current-timestamp' },
          ],
          navigations: [],
        },
      ],
      relationships: [],
      sourceFiles: [],
      diagnostics: [],
    });

    expect(sql).toContain('[Id] INT IDENTITY(1, 1) NOT NULL');
    expect(sql).toContain('[CreatedAt] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP');
  });

  it('returns a placeholder script for an empty model', () => {
    expect(generateErdSql({ tables: [], relationships: [], sourceFiles: [], diagnostics: [] })).toContain('-- No tables to export.');
  });
});