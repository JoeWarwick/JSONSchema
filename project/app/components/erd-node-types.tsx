import React from 'react';
import { Handle, Position } from 'reactflow';
import type { ErdColumn, ErdNavigation } from '../types/erd';
import type { ErdTableNodeData } from '../utils/erd-graph';
import styles from './erd-editor.module.css';

function columnIcon(column: ErdColumn): string {
  if (column.isPrimaryKey) return 'key';
  if (column.isForeignKey) return 'fk';
  return '';
}

export function ErdTableNode({ data }: { data: ErdTableNodeData }) {
  const { table } = data;
  
  const handleNavigationClick = React.useCallback((event: React.MouseEvent, navigation: ErdNavigation) => {
    event.stopPropagation();
    data.onNavigationClick?.(table.id, navigation);
  }, [data, table.id]);
  
  const handleNavigationKeyDown = React.useCallback((event: React.KeyboardEvent, navigation: ErdNavigation) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      data.onNavigationClick?.(table.id, navigation);
    }
  }, [data, table.id]);
  
  return (
    <section className={styles.tableNode} aria-label={`Table ${table.name}`}>
      <Handle id="target-top" type="target" position={Position.Top} className={styles.handle} />
      <Handle id="target-right" type="target" position={Position.Right} className={styles.handle} />
      <Handle id="target-bottom" type="target" position={Position.Bottom} className={styles.handle} />
      <Handle id="target-left" type="target" position={Position.Left} className={styles.handle} />
      <header className={styles.tableHeader}>{table.name}</header>
      <div className={styles.sectionLabel}>Properties</div>
      <div className={styles.columnList}>
        {table.columns.map((column, idx) => (
          <div className={styles.columnRow} key={`${table.id}-col-${idx}`}>
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
            {table.navigations.map((navigation, navIdx) => (
              <div
                key={`${table.id}-nav-${navIdx}`}
                role="button"
                tabIndex={0}
                className={`${styles.navigationItem} ${data.highlightedNavigationName === navigation.name ? styles.navigationItemHighlighted : ''}`}
                onClick={(event) => handleNavigationClick(event, navigation)}
                onKeyDown={(event) => handleNavigationKeyDown(event, navigation)}
              >
                {navigation.name}
              </div>
            ))}
          </div>
        </>
      )}
      <Handle id="source-top" type="source" position={Position.Top} className={styles.handle} />
      <Handle id="source-right" type="source" position={Position.Right} className={styles.handle} />
      <Handle id="source-bottom" type="source" position={Position.Bottom} className={styles.handle} />
      <Handle id="source-left" type="source" position={Position.Left} className={styles.handle} />
    </section>
  );
}

export const erdNodeTypes = { erdTable: ErdTableNode };
