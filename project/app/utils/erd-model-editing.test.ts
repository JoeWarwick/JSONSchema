import { normalizeErdModel, relatedRelationships, renameErdTable, updateErdRelationship, updateErdTableColumn } from './erd-model-editing';
import type { ErdModel } from '../types/erd';

function sampleModel(): ErdModel {
  return {
    tables: [
      {
        id: 'Department',
        name: 'Department',
        clrName: 'Department',
        columns: [
          { name: 'DepartmentID', type: 'int', isNullable: false, isPrimaryKey: true, isForeignKey: false },
          { name: 'InstructorID', type: 'int', isNullable: true, isPrimaryKey: false, isForeignKey: true, foreignKeyTarget: 'Instructor' },
        ],
        navigations: [],
      },
      {
        id: 'Instructor',
        name: 'Instructor',
        clrName: 'Instructor',
        columns: [{ name: 'ID', type: 'int', isNullable: false, isPrimaryKey: true, isForeignKey: false }],
        navigations: [],
      },
    ],
    relationships: [
      {
        id: 'Department->Instructor:InstructorID',
        dependentTable: 'Department',
        principalTable: 'Instructor',
        foreignKeyColumns: ['InstructorID'],
        principalCardinality: 'one',
        dependentCardinality: 'zero-or-one',
        explicit: true,
      },
    ],
    sourceFiles: [],
    diagnostics: [],
  };
}

describe('erd-model-editing', () => {
  it('renames a table and keeps relationships and foreign keys aligned', () => {
    const model = renameErdTable(sampleModel(), 'Department', 'Faculty');
    expect(model.tables.some((table) => table.id === 'Faculty')).toBe(true);
    expect(model.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ dependentTable: 'Faculty', principalTable: 'Instructor', id: 'Faculty->Instructor:InstructorID' }),
    ]));
    expect(model.tables.find((table) => table.id === 'Faculty')?.columns.find((column) => column.name === 'InstructorID')).toMatchObject({ isForeignKey: true, foreignKeyTarget: 'Instructor' });
  });

  it('updates relationship endpoints and re-syncs dependent foreign keys', () => {
    const model = updateErdRelationship(sampleModel(), 'Department->Instructor:InstructorID', (relationship) => ({
      ...relationship,
      principalTable: 'Department',
      foreignKeyColumns: ['DepartmentID'],
    }));
    expect(model.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ principalTable: 'Department', dependentTable: 'Department', foreignKeyColumns: ['DepartmentID'], id: 'Department->Department:DepartmentID' }),
    ]));
    expect(model.tables.find((table) => table.id === 'Department')?.columns.find((column) => column.name === 'DepartmentID')).toMatchObject({ isForeignKey: true, foreignKeyTarget: 'Department' });
  });

  it('renames a column and updates relationship foreign key columns', () => {
    const model = updateErdTableColumn(sampleModel(), 'Department', 'InstructorID', {
      name: 'AdvisorID',
      type: 'int',
      isNullable: true,
      isPrimaryKey: false,
      isForeignKey: true,
      foreignKeyTarget: 'Instructor',
    });

    expect(model.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ foreignKeyColumns: ['AdvisorID'], id: 'Department->Instructor:AdvisorID' }),
    ]));
  });

  it('finds relationships related to a table', () => {
    const model = normalizeErdModel(sampleModel());
    expect(relatedRelationships(model, 'Department')).toHaveLength(1);
  });
});