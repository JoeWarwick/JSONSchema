import fs from 'node:fs';
import path from 'node:path';
import { parseDbContextFiles } from './csharp-dbcontext-parser';
import { erdModelToGraph } from './erd-graph';
import type { ErdSourceFile } from '../types/erd';

function fixtureModel() {
  const directory = path.join(process.cwd(), 'app', 'test-fixtures', 'erd');
  const files: ErdSourceFile[] = fs.readdirSync(directory)
    .filter((name) => name.endsWith('.cs'))
    .sort()
    .map((name) => ({ name, content: fs.readFileSync(path.join(directory, name), 'utf8') }));
  return parseDbContextFiles(files);
}

describe('erdModelToGraph', () => {
  it('creates a laid-out table node for every entity', () => {
    const graph = erdModelToGraph(fixtureModel());
    expect(graph.nodes).toHaveLength(7);
    expect(graph.nodes.map((node) => node.id)).toContain('Enrollment');
    expect(graph.nodes.every((node) => Number.isFinite(node.position.x) && Number.isFinite(node.position.y))).toBe(true);
  });

  it('creates directed relationship edges with cardinality labels', () => {
    const graph = erdModelToGraph(fixtureModel());
    const enrollmentCourse = graph.edges.find((edge) => edge.id.startsWith('Enrollment->Course:'));
    expect(enrollmentCourse).toEqual(expect.objectContaining({ source: 'Enrollment', target: 'Course', label: '* : 1' }));
    expect(enrollmentCourse?.data?.relationship.foreignKeyColumns).toEqual(['CourseID']);
  });

  it('attaches relationship edges to the nearest sides of each table', () => {
    const graph = erdModelToGraph(fixtureModel());
    const enrollmentCourse = graph.edges.find((edge) => edge.id.startsWith('Enrollment->Course:'));
    expect(enrollmentCourse).toEqual(expect.objectContaining({ sourcePosition: 'right', targetPosition: 'left' }));
    expect(enrollmentCourse).toEqual(expect.objectContaining({ sourceHandle: 'source-right', targetHandle: 'target-left' }));
  });
});
