import fs from 'node:fs';
import path from 'node:path';
import { generateDbContextCSharp } from './csharp-dbcontext-generator';
import { parseDbContextFiles } from './csharp-dbcontext-parser';
import type { ErdSourceFile } from '../types/erd';

function fixtureModel() {
  const directory = path.join(process.cwd(), 'app', 'test-fixtures', 'erd');
  const files: ErdSourceFile[] = fs.readdirSync(directory)
    .filter((name) => name.endsWith('.cs'))
    .sort()
    .map((name) => ({ name, content: fs.readFileSync(path.join(directory, name), 'utf8') }));
  return parseDbContextFiles(files);
}

describe('generateDbContextCSharp', () => {
  it('generates entities, DbSets, and relationship configuration', () => {
    const source = generateDbContextCSharp(fixtureModel());
    expect(source).toContain('public class Student');
    expect(source).toContain('public int ID { get; set; }');
    expect(source).toContain('public DbSet<Enrollment> Enrollments');
    expect(source).toContain('modelBuilder.Entity<Enrollment>()');
    expect(source).toContain('HasForeignKey(item => new { CourseID });');
  });

  it('preserves relational structure through a generated-source parse', () => {
    const model = fixtureModel();
    const generated = generateDbContextCSharp(model);
    const reparsed = parseDbContextFiles([{ name: 'generated.cs', content: generated }]);
    expect(reparsed.tables.map((table) => table.name)).toEqual(model.tables.map((table) => table.name));
    expect(reparsed.relationships.map((relationship) => relationship.id)).toEqual(model.relationships.map((relationship) => relationship.id));
  });
});
