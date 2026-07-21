import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ReactFlowProvider } from 'reactflow';
import { ErdTableNode } from './erd-node-types';
import type { ErdTableNodeData } from '../utils/erd-graph';

describe('ErdTableNode', () => {
  it('renders table columns, key markers, and navigation properties', () => {
    const data: ErdTableNodeData = {
      table: {
        id: 'Enrollment',
        name: 'Enrollment',
        clrName: 'Enrollment',
        columns: [
          { name: 'EnrollmentID', type: 'int', isNullable: false, isPrimaryKey: true, isForeignKey: false },
          { name: 'CourseID', type: 'int', isNullable: false, isPrimaryKey: false, isForeignKey: true, foreignKeyTarget: 'Course' },
        ],
        navigations: [{ name: 'Course', targetTable: 'Course', cardinality: 'one' }],
      },
    };
    render(<ReactFlowProvider><ErdTableNode data={data} /></ReactFlowProvider>);
    expect(screen.getByRole('region', { name: 'Table Enrollment' })).toBeInTheDocument();
    expect(screen.getByText('EnrollmentID')).toBeInTheDocument();
    expect(screen.getByText('CourseID')).toBeInTheDocument();
    expect(screen.getByText('Course', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByLabelText('key')).toBeInTheDocument();
    expect(screen.getByLabelText('fk')).toBeInTheDocument();
  });
});
