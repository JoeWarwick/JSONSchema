import React from 'react';
import { Printer } from 'lucide-react';
import { MemoizedNodePropertyEditor } from './NodePropertyEditor';
import { XmlNodeRhsEditor } from './xml-rhs-editors';
import styles from './graphical-schema-editor.module.css';
import type { NodeData } from './types';
import type { Node as FlowNode } from 'reactflow';

type XmlSchemaDetails = {
  targetNamespace?: string | null;
  elementFormDefault?: string | null;
  attributeFormDefault?: string | null;
  xmlnsEntries: Array<[string, unknown]>;
};

interface GraphicalSchemaRhsControlProps {
  selectedNode: FlowNode<NodeData> | null;
  onChange: (patch: Partial<NodeData>) => void;
  schemaLanguage?: 'json' | 'yaml' | 'xml';
  schemaDialectLabel: string;
  showXmlDetails: boolean;
  showSchemaDetails: boolean;
  xmlSchemaDetails: XmlSchemaDetails;
  onToggleSchemaDetails: () => void;
  onPrintGraph: () => void;
}

export function GraphicalSchemaRhsControl({
  selectedNode,
  onChange,
  schemaLanguage,
  schemaDialectLabel,
  showXmlDetails,
  showSchemaDetails,
  xmlSchemaDetails,
  onToggleSchemaDetails,
  onPrintGraph,
}: GraphicalSchemaRhsControlProps) {
  const xmlNodeKind = ((selectedNode?.data as any)?.xmlNodeKind as string | undefined) || '';
  const useXmlEditor = schemaLanguage === 'xml' && Boolean(xmlNodeKind);

  return (
    <div className={styles.editorSidebar} aria-label="Graphical schema RHS control">
      <div className={styles.editorSidebarHeader}>
        <div className={styles.sidebarHeaderGroup}>
          <span className={styles.schemaDialectBadge} title="Current schema dialect">{schemaDialectLabel}</span>
          {showXmlDetails && (
            <button
              type="button"
              className={styles.printButton}
              onClick={onToggleSchemaDetails}
              title="Toggle XML schema details"
              aria-label="Toggle XML schema details"
            >
              <span>{showSchemaDetails ? 'Hide XML details' : 'XML details'}</span>
            </button>
          )}
          <button type="button" className={styles.printButton} onClick={onPrintGraph} title="Print graph" aria-label="Print graph">
            <Printer size={16} />
            <span>Print graph</span>
          </button>
        </div>
      </div>
      {showXmlDetails && showSchemaDetails && (
        <div className={styles.schemaDetailsPanel} aria-label="XML schema details">
          {xmlSchemaDetails.targetNamespace && (
            <div className={styles.schemaDetailRow}>
              <span className={styles.schemaDetailLabel}>targetNamespace</span>
              <span className={styles.schemaDetailValue}>{xmlSchemaDetails.targetNamespace}</span>
            </div>
          )}
          {xmlSchemaDetails.elementFormDefault && (
            <div className={styles.schemaDetailRow}>
              <span className={styles.schemaDetailLabel}>elementFormDefault</span>
              <span className={styles.schemaDetailValue}>{xmlSchemaDetails.elementFormDefault}</span>
            </div>
          )}
          {xmlSchemaDetails.attributeFormDefault && (
            <div className={styles.schemaDetailRow}>
              <span className={styles.schemaDetailLabel}>attributeFormDefault</span>
              <span className={styles.schemaDetailValue}>{xmlSchemaDetails.attributeFormDefault}</span>
            </div>
          )}
          {xmlSchemaDetails.xmlnsEntries.length > 0 && (
            <div className={styles.schemaDetailStack}>
              <span className={styles.schemaDetailLabel}>xmlns</span>
              {xmlSchemaDetails.xmlnsEntries.map(([key, value]) => (
                <div className={styles.schemaDetailRow} key={key}>
                  <span className={styles.schemaDetailValue}>{key}</span>
                  <span className={styles.schemaDetailValue}>{String(value)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {useXmlEditor ? (
        <XmlNodeRhsEditor node={selectedNode} onChange={onChange} />
      ) : (
        <MemoizedNodePropertyEditor node={selectedNode} onChange={onChange} />
      )}
    </div>
  );
}