import fs from 'node:fs';
import path from 'node:path';
import { parseDbContextFiles } from './csharp-dbcontext-parser';
import type { ErdSourceFile } from '../types/erd';

function fixtureFiles(): ErdSourceFile[] {
  const directory = path.join(process.cwd(), 'app', 'test-fixtures', 'erd');
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith('.cs'))
    .sort()
    .map((name) => ({ name, content: fs.readFileSync(path.join(directory, name), 'utf8') }));
}

describe('parseDbContextFiles', () => {
  it('resolves Fluent relationships when only the DbContext file is supplied', () => {
    const files = fixtureFiles().filter((file) => file.name === 'SchoolContext.cs');
    const model = parseDbContextFiles(files);

    expect(model.tables.map((table) => table.name)).toEqual([
      'Course', 'CourseAssignment', 'Department', 'Enrollment', 'Instructor', 'OfficeAssignment', 'Student',
    ]);
    expect(model.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ dependentTable: 'OfficeAssignment', principalTable: 'Instructor', explicit: true }),
      expect.objectContaining({ dependentTable: 'Department', principalTable: 'Instructor', explicit: true }),
    ]));
    expect(model.diagnostics).toEqual([]);
  });

  it('parses the school DbContext fixture into tables and columns', () => {
    const model = parseDbContextFiles(fixtureFiles());
    expect(model.tables.map((table) => table.name)).toEqual([
      'Course', 'CourseAssignment', 'Department', 'Enrollment', 'Instructor', 'OfficeAssignment', 'Student',
    ]);

    const enrollment = model.tables.find((table) => table.name === 'Enrollment');
    expect(enrollment?.columns).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'EnrollmentID', isPrimaryKey: true }),
      expect.objectContaining({ name: 'CourseID', isForeignKey: true, foreignKeyTarget: 'Course' }),
      expect.objectContaining({ name: 'StudentID', isForeignKey: true, foreignKeyTarget: 'Student' }),
    ]));
  });

  it('resolves Fluent relationships before convention inference', () => {
    const model = parseDbContextFiles(fixtureFiles());
    const office = model.relationships.find((relationship) => relationship.dependentTable === 'OfficeAssignment');
    expect(office).toEqual(expect.objectContaining({
      principalTable: 'Instructor',
      foreignKeyColumns: ['InstructorID'],
      principalCardinality: 'one',
      dependentCardinality: 'one',
      explicit: true,
    }));

    const department = model.relationships.find((relationship) => relationship.dependentTable === 'Department');
    expect(department).toEqual(expect.objectContaining({ principalTable: 'Instructor', explicit: true }));
  });

  it('discovers inferred one-to-many relationships and the join entity', () => {
    const model = parseDbContextFiles(fixtureFiles());
    expect(model.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ dependentTable: 'Enrollment', principalTable: 'Course', dependentCardinality: 'many' }),
      expect.objectContaining({ dependentTable: 'Enrollment', principalTable: 'Student', dependentCardinality: 'many' }),
      expect.objectContaining({ dependentTable: 'CourseAssignment', principalTable: 'Course' }),
      expect.objectContaining({ dependentTable: 'CourseAssignment', principalTable: 'Instructor' }),
      expect.objectContaining({ dependentTable: 'Course', principalTable: 'Department' }),
    ]));
  });

  it('inherits base class members and infers collection-navigation relationships', () => {
    const model = parseDbContextFiles([
      {
        name: 'FeedModel.cs',
        content: `
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;

public class Subscribable
{
    [Key]
    public int Id { get; set; }
}

public class FeedSet : Subscribable
{
    public List<Subscribable> Feeds { get; set; }
}
`,
      },
    ]);

    const feedSet = model.tables.find((table) => table.name === 'FeedSet');
    expect(feedSet?.columns).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Id', isPrimaryKey: true }),
    ]));
    expect(model.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dependentTable: 'Subscribable',
        principalTable: 'FeedSet',
        foreignKeyColumns: ['FeedSetID'],
        dependentCardinality: 'many',
        explicit: false,
      }),
    ]));
    expect(model.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'warning',
        message: expect.stringContaining('Inferred relationship Subscribable -> FeedSet from navigation Feeds.'),
      }),
    ]));
  });

  it('defaults self-referential navigation names to parent and children when inferring relationships', () => {
    const model = parseDbContextFiles([
      {
        name: 'TreeNode.cs',
        content: `
using System.ComponentModel.DataAnnotations;

public class TreeNode
{
    [Key]
    public int Id { get; set; }

    public int? ParentId { get; set; }

    public TreeNode Parent { get; set; }
}
`,
      },
    ]);

    expect(model.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dependentTable: 'TreeNode',
        principalTable: 'TreeNode',
        foreignKeyColumns: ['ParentId'],
        dependentNavigation: 'Parent',
        principalNavigation: 'Children',
        explicit: false,
      }),
    ]));
  });
});
