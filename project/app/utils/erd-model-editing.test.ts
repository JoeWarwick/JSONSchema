import { addErdRelationship, addErdTable, addErdTableColumn, deleteErdRelationship, deleteErdTable, deleteErdTableColumn, normalizeErdModel, relatedRelationships, renameErdTable, reorderErdTableColumns, updateErdRelationship, updateErdTableColumn } from './erd-model-editing';
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

function relationshipFreeModel(): ErdModel {
  return {
    tables: [
      {
        id: 'Department',
        name: 'Department',
        clrName: 'Department',
        columns: [
          { name: 'DepartmentID', type: 'int', isNullable: false, isPrimaryKey: true, isForeignKey: false },
          { name: 'InstructorID', type: 'int', isNullable: true, isPrimaryKey: false, isForeignKey: false },
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
    relationships: [],
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

  it('adds a new entity with a default primary key', () => {
    const { model, tableId } = addErdTable(sampleModel());

    expect(tableId).toBe('NewEntity');
    expect(model.tables.some((table) => table.id === 'NewEntity')).toBe(true);
    expect(model.tables.find((table) => table.id === 'NewEntity')?.columns).toEqual([
      expect.objectContaining({ name: 'ID', isPrimaryKey: true, isForeignKey: false }),
    ]);
  });

  it('deletes an entity and removes relationships and node positions', () => {
    const model = deleteErdTable({
      ...sampleModel(),
      nodePositions: { Department: { x: 1, y: 2 }, Instructor: { x: 3, y: 4 } },
    }, 'Department');

    expect(model.tables.some((table) => table.id === 'Department')).toBe(false);
    expect(model.relationships).toHaveLength(0);
    expect(model.nodePositions).toEqual({ Instructor: { x: 3, y: 4 } });
  });

  it('adds a new property with a unique default name', () => {
    const model = addErdTableColumn(sampleModel(), 'Department');

    expect(model.tables.find((table) => table.id === 'Department')?.columns.map((column) => column.name)).toEqual([
      'DepartmentID',
      'InstructorID',
      'NewProperty',
    ]);
  });

  it('deletes a property and removes relationships that depended on it', () => {
    const model = deleteErdTableColumn(sampleModel(), 'Department', 'InstructorID');

    expect(model.tables.find((table) => table.id === 'Department')?.columns.some((column) => column.name === 'InstructorID')).toBe(false);
    expect(model.relationships).toHaveLength(0);
  });

  it('reorders properties within a table', () => {
    const model = reorderErdTableColumns(sampleModel(), 'Department', 'InstructorID', 'DepartmentID');

    expect(model.tables.find((table) => table.id === 'Department')?.columns.map((column) => column.name)).toEqual([
      'InstructorID',
      'DepartmentID',
    ]);
  });

  it('adds a relationship and reuses an existing foreign key column when available', () => {
    const model = addErdRelationship(relationshipFreeModel(), 'Department', 'Instructor');

    expect(model.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ dependentTable: 'Department', principalTable: 'Instructor', foreignKeyColumns: ['InstructorID'], id: 'Department->Instructor:InstructorID' }),
    ]));
    expect(model.tables.find((table) => table.id === 'Department')?.columns.map((column) => column.name)).toEqual([
      'DepartmentID',
      'InstructorID',
    ]);
    expect(model.tables.find((table) => table.id === 'Department')?.navigations).toEqual([
      expect.objectContaining({ name: 'Instructor', targetTable: 'Instructor', cardinality: 'one' }),
    ]);
    expect(model.tables.find((table) => table.id === 'Instructor')?.navigations).toEqual([
      expect.objectContaining({ name: 'Departments', targetTable: 'Department', cardinality: 'many' }),
    ]);
  });

  it('names self-referential relationships parent and children by default', () => {
    const model = addErdRelationship({
      tables: [
        {
          id: 'Node',
          name: 'Node',
          clrName: 'Node',
          columns: [{ name: 'ID', type: 'int', isNullable: false, isPrimaryKey: true, isForeignKey: false }],
          navigations: [],
        },
      ],
      relationships: [],
      sourceFiles: [],
      diagnostics: [],
    }, 'Node', 'Node');

    expect(model.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dependentTable: 'Node',
        principalTable: 'Node',
        dependentNavigation: 'Parent',
        principalNavigation: 'Children',
      }),
    ]));
    expect(model.tables.find((table) => table.id === 'Node')?.navigations).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Parent', targetTable: 'Node', cardinality: 'one' }),
      expect.objectContaining({ name: 'Children', targetTable: 'Node', cardinality: 'many' }),
    ]));
  });

  it('deletes a relationship by id', () => {
    const model = deleteErdRelationship(sampleModel(), 'Department->Instructor:InstructorID');

    expect(model.relationships).toHaveLength(0);
    expect(model.tables.find((table) => table.id === 'Department')?.navigations).toHaveLength(0);
    expect(model.tables.find((table) => table.id === 'Instructor')?.navigations).toHaveLength(0);
  });

  it('deletes an entity and removes navigations pointing at it', () => {
    const model = deleteErdTable({
      ...sampleModel(),
      tables: sampleModel().tables.map((table) => table.id === 'Instructor' ? {
        ...table,
        navigations: [{ name: 'Departments', targetTable: 'Department', cardinality: 'many' }],
      } : table),
    }, 'Instructor');

    expect(model.tables.some((table) => table.id === 'Instructor')).toBe(false);
    expect(model.tables.find((table) => table.id === 'Department')?.navigations).toHaveLength(0);
  });

  it('finds relationships related to a table', () => {
    const model = normalizeErdModel(sampleModel());
    expect(relatedRelationships(model, 'Department')).toHaveLength(1);
  });

  it('infers missing relationships from foreign keys and navigations', () => {
    const model = normalizeErdModel({
      tables: [
        {
          id: 'Department',
          name: 'Department',
          clrName: 'Department',
          columns: [
            { name: 'DepartmentID', type: 'int', isNullable: false, isPrimaryKey: true, isForeignKey: false },
            { name: 'InstructorID', type: 'int', isNullable: true, isPrimaryKey: false, isForeignKey: true, foreignKeyTarget: 'Instructor' },
          ],
          navigations: [{ name: 'Instructor', targetTable: 'Instructor', cardinality: 'one' }],
        },
        {
          id: 'Instructor',
          name: 'Instructor',
          clrName: 'Instructor',
          columns: [{ name: 'ID', type: 'int', isNullable: false, isPrimaryKey: true, isForeignKey: false }],
          navigations: [{ name: 'Departments', targetTable: 'Department', cardinality: 'many' }],
        },
      ],
      relationships: [],
      sourceFiles: [],
      diagnostics: [],
    });

    expect(model.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dependentTable: 'Department',
        principalTable: 'Instructor',
        foreignKeyColumns: ['InstructorID'],
        dependentNavigation: 'Instructor',
        principalNavigation: 'Departments',
        explicit: false,
      }),
    ]));
  });
});