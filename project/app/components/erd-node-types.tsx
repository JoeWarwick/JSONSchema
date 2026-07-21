import React from 'react';
import { Handle, Position } from 'reactflow';
import type { ErdColumn } from '../types/erd';
import type { ErdTableNodeData } from '../utils/erd-graph';
import styles from './erd-editor.module.css';

function columnIcon(column: ErdColumn): string {
  if (column.isPrimaryKey) return 'key';
  if (column.isForeignKey) return 'fk';
  return '';
}

export function ErdTableNode({ data }: { data: ErdTableNodeData }) {
  const { table } = data;
  return (
    <section className={styles.tableNode} aria-label={`Table ${table.name}`}>
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <header className={styles.tableHeader}>{table.name}</header>
      <div className={styles.sectionLabel}>Properties</div>
      <div className={styles.columnList}>
        {table.columns.map((column) => (
          <div className={styles.columnRow} key={column.name}>
            <span className={`${styles.columnMarker} ${styles[`marker${columnIcon(column)}`] || ''}`} aria-label={columnIcon(column) || undefined}>
              {columnIcon(column) === 'key' ? '◆' : columnIcon(column) === 'fk' ? '↳' : ''}
            </span>
            <span className={styles.columnName}>{column.name}</span>
            <span className={styles.columnType}>{column.type}{column.isNullable ? '?' : ''}</span>
          </div>
        ))}
      </div>
      {table.navigations.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Navigation Properties</div>
          <div className={styles.navigationList}>
            {table.navigations.map((navigation) => <div key={navigation.name}>{navigation.name}</div>)}
          </div>
        </>
      )}
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </section>
  );
}

export const erdNodeTypes = { erdTable: ErdTableNode };
