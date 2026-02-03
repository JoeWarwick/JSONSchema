import React from 'react';
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip/tooltip";
import { AlertCircle, FileText } from "lucide-react";
import { Handle, Position } from "reactflow";
import type { Edge, Node } from "reactflow"
import type { SchemaNodeData } from "./schema-behaviors";
import styles from "./graphical-schema-editor.module.css";
import { renderTooltipContentChildren } from './tooltip-utils';
import { buildBadges, BADGE_DEFS } from './graphical-schema-badges';
import type { SchemaNodeType } from './types';

import { renderBadges } from './graphical-schema-badges';

// Group box for Properties/Items
export const GroupBox = ({ children }: { title: string; children: React.ReactNode }) => (
  <div style={{
    background: '#e8fbe8',
    border: '2px dashed #7ed957',
    borderRadius: 12,
    padding: '18px 18px 12px 18px',
    margin: '0 0 24px 0',
    minWidth: 220,
    position: 'relative',
  }}>
    {children}
    <button style={{
      marginTop: 12,
      background: 'none',
      border: '1px dashed #7ed957',
      color: '#388e3c',
      borderRadius: 8,
      padding: '4px 12px',
      cursor: 'pointer',
      fontWeight: 500,
      fontSize: 14,
      display: 'block',
      width: '100%',
    }}>+ Add Property</button>
  </div>
);

// Enum node component for displaying enum type (no inline editor)
export const EnumNode = ({ data }: { data: SchemaNodeData & { enum: string[] } }) => {
  const { label, required } = data;
  const badges = buildBadges(data);
  return (
    <div style={{
      background: '#fffbe6',
      border: '2px solid #ffe082',
      borderRadius: 8,
      padding: '10px 18px',
      marginBottom: 12,
      minWidth: 120,
      boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
      textAlign: 'left',
      position: 'relative',
    }}>
      <Handle type="target" position={Position.Left} style={{ background: '#00e676', width: 10, height: 10, borderRadius: 5 }} />
      <div className={styles.nodeHeader}>
        <div className={styles.nodeHeaderLeft}>
          {data.patternKey ? <span className={styles.patternBadge}>pattern</span> : null}
          {required && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button aria-label="Required" title="Required" className={`${styles.nodeIcon} ${styles.requiredAsterisk}`}>*</button>
              </TooltipTrigger>
              <TooltipContent>Required property</TooltipContent>
            </Tooltip>
          )}
          <div className={styles.nodeLabel}>{label}</div>
        </div>
        <div className={styles.nodeIcons}>
          {data.description && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button aria-label="Node description" className={styles.nodeIcon}>
                  <AlertCircle size={16} color="#d9822b" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{renderTooltipContentChildren(data.description)}</TooltipContent>
            </Tooltip>
          )}
          {(data as any).$comment && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button aria-label="Node comment" className={styles.nodeIcon}>
                  <FileText size={16} color="#6e7191" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{renderTooltipContentChildren((data as any).$comment)}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        {renderBadges(badges)}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: '#00e676', width: 10, height: 10, borderRadius: 5 }} />
    </div>
  );
};

// Custom node component that renders all data properties
export const CustomNode = ({ data }: { data: SchemaNodeData & { required?: boolean } }) => {
  const { label, required } = data;
  const isPattern = Boolean((data as any).patternKey);
  const badges = buildBadges(data);
  return (
    <div className={isPattern ? styles.patternNode : undefined} style={{
      background: isPattern ? undefined : '#fff',
      border: '2px solid #b3e6b3',
      borderRadius: 8,
      padding: '10px 18px',
      marginBottom: 12,
      minWidth: 120,
      boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
      textAlign: 'left',
      position: 'relative',
    }}>
      <Handle type="target" position={Position.Left} style={{ background: '#00e676', width: 10, height: 10, borderRadius: 5 }} />
      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4, color: '#222' }}>
        { (data as any).patternKey ? <span className={styles.patternBadge}>pattern</span> : null }
        {required && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button aria-label="Required" title="Required" className={`${styles.nodeIcon} ${styles.requiredAsterisk}`}>*</button>
            </TooltipTrigger>
            <TooltipContent>Required property</TooltipContent>
          </Tooltip>
        )}
        {label}
        {data.imported && (
          <span title={typeof data.$ref === 'string' ? `Imported from ${data.$ref}` : 'Imported definition (create local override to change)'} className={styles.importedStar}>*</span>
        )}
        <div style={{ position: 'absolute', top: 2, right: 2, display: 'flex', gap: 3, alignItems: 'center' }}>
          {data.description && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button aria-label="Node description" className={styles.nodeIcon} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>
                  <AlertCircle size={16} color="#d9822b" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{renderTooltipContentChildren(data.description)}</TooltipContent>
            </Tooltip>
          )}
          {(data as any).$comment && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button aria-label="Node comment" className={styles.nodeIcon} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>
                  <FileText size={16} color="#6e7191" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{renderTooltipContentChildren((data as any).$comment)}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {renderBadges(badges)}
        {Object.entries(data).map(([key, value]) => {
          if (value === undefined) return null;
          const hidden = ['label', 'id', 'parent', 'type', 'ofType', 'required', 'enum', 'items', 'default', 'title', 'description', '$comment', 'patternKey', 'typeUnion'];
          if (hidden.includes(key)) return null;
          if (key === 'format') {
            return (
              <span key={key} style={{
                display: 'inline-block',
                color: '#fb8c00',
                fontWeight: 700,
                marginRight: 8,
                marginBottom: 2,
                fontSize: 12,
              }}>{String(value)}</span>
            );
          }
          if (Object.prototype.hasOwnProperty.call(BADGE_DEFS, key)) return null;
          if (key === 'imported' && value === true) {
            return (
              <span key={key} style={{
                display: 'inline-block',
                background: '#fff4e5',
                color: '#d9822b',
                borderRadius: 8,
                padding: '2px 8px',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.03em',
                border: '1px solid #ffd9b3',
                marginRight: 4,
                marginBottom: 2,
              }}>imported</span>
            );
          }

          return (
            <span key={key} style={{
              display: 'inline-block',
              background: '#eaf6ff',
              color: '#2176c7',
              borderRadius: 8,
              padding: '2px 8px',
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: '0.03em',
              border: '1px solid #b3d4fc',
              marginRight: 4,
              marginBottom: 2,
            }}>{key}: {String(value)}</span>
          );
        })}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: '#00e676', width: 10, height: 10, borderRadius: 5 }} />
    </div>
  );
};

// Simple SchemaCard component for displaying label and type
export const SchemaCard = ({ label, type, imported }: { label: string; type: SchemaNodeType; imported?: boolean }) => (
  <div style={{
    background: '#f5f5f5',
    border: '1px solid #b3e6b3',
    borderRadius: 8,
    padding: '8px 14px',
    marginBottom: 8,
    minWidth: 100,
    fontSize: 15,
    fontWeight: 500,
    color: '#2176c7',
    display: 'inline-block',
  }}>
    {label}{imported && (
      <span title="Imported definition (create local override to change)" style={{ color: '#d9822b', marginLeft: 6 }}>*</span>
    )} <span style={{ color: '#888', fontWeight: 400 }}>({type})</span>
  </div>
);

// Root node as a group box with a property card
export const RootNode: React.FC<{ data: SchemaNodeData }> = ({ data }) => (
  <div style={{ background: '#e8fbe8', border: '2px dashed #7ed957', borderRadius: 12, padding: '18px' }}>
    <div className="root-node" style={{ pointerEvents: 'none', cursor: 'default' }}>
      <SchemaCard label={data.label} type={data.type} imported={data.imported} />
    </div>
  </div>
);

// Properties group node type
export const PropertiesGroupNode = ({ children }: { children?: React.ReactNode }) => (
  <div style={{ background: '#e8fbe8', border: '2px dashed #7ed957', borderRadius: 12, padding: '18px' }}>{children}</div>
);

// Items group node type
export const ItemsGroupNode = ({ data }: { data: SchemaNodeData }) => (
  <div style={{ background: '#e8fbe8', border: '2px dashed #7ed957', borderRadius: 12, padding: '18px' }}>
    <SchemaCard label={data.label} type={data.type} imported={data.imported} />
  </div>
);

// Define nodeTypes
export const nodeTypes: { [key: string]: React.FC<any> } = {
  root: RootNode,
  property: CustomNode,
  enum: EnumNode,
  propertiesGroup: PropertiesGroupNode,
  itemsGroup: ItemsGroupNode,
};

// Only define a root node as needed (empty schema)
export const initialNodes: Node<SchemaNodeData>[] = [
  {
    id: '1',
    type: 'root',
    data: { id: '1', label: 'Root', type: 'object' },
    position: { x: 0, y: 10 },
    draggable: false,
    selectable: false,
  },
];
export const initialEdges: Edge[] = [];

// Default convenience export for simpler imports
export default { nodeTypes, initialNodes, initialEdges };
