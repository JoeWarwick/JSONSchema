import React from 'react';
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip/tooltip";
import { AlertCircle, FileText, Link2, Loader2, Regex, Trash2 } from "lucide-react";

// Inline fork SVGs — stem left, branches right
const ForkIconOneOf = () => (
  // oneOf: single stem → XOR circle → two branches right
  <svg viewBox="0 0 26 18" width="26" height="18" fill="none" aria-hidden="true">
    {/* Stem */}
    <line x1="1" y1="9" x2="9" y2="9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    {/* XOR circle */}
    <circle cx="11" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.8" fill="none"/>
    {/* Upper branch */}
    <line x1="13.5" y1="9" x2="25" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    {/* Lower branch */}
    <line x1="13.5" y1="9" x2="25" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    {/* Upper arrow */}
    <polyline points="22,2 25,3 24,6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    {/* Lower arrow */}
    <polyline points="22,16 25,15 24,12" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const ForkIconAnyOf = () => (
  // anyOf: single stem → three-way inclusive fan
  <svg viewBox="0 0 26 20" width="26" height="20" fill="none" aria-hidden="true">
    {/* Stem */}
    <line x1="1" y1="10" x2="9" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    {/* Upper branch */}
    <line x1="9" y1="10" x2="25" y2="2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    {/* Middle branch */}
    <line x1="9" y1="10" x2="25" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    {/* Lower branch */}
    <line x1="9" y1="10" x2="25" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    {/* Dots at each tip — all are valid */}
    <circle cx="25" cy="2"  r="1.8" fill="currentColor"/>
    <circle cx="25" cy="10" r="1.8" fill="currentColor"/>
    <circle cx="25" cy="18" r="1.8" fill="currentColor"/>
  </svg>
);

const ForkIconAllOf = () => (
  // allOf: two inputs left → merge dot → single output right
  <svg viewBox="0 0 26 18" width="26" height="18" fill="none" aria-hidden="true">
    {/* Upper input */}
    <line x1="1" y1="4" x2="13" y2="9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    {/* Lower input */}
    <line x1="1" y1="14" x2="13" y2="9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    {/* Merge dot */}
    <circle cx="13" cy="9" r="2.2" fill="currentColor"/>
    {/* Output */}
    <line x1="15" y1="9" x2="25" y2="9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    {/* Arrow */}
    <polyline points="22,6 25,9 22,12" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const COMBINER_ICONS: Record<string, React.FC> = {
  oneOf: ForkIconOneOf,
  anyOf: ForkIconAnyOf,
  allOf: ForkIconAllOf,
};

const COMBINER_LABELS: Record<string, string> = {
  oneOf: 'oneOf',
  anyOf: 'anyOf',
  allOf: 'allOf',
};

const COMBINER_TITLES: Record<string, string> = {
  oneOf: 'oneOf — exactly one must match',
  anyOf: 'anyOf — one or more must match',
  allOf: 'allOf — all must match',
};
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
      padding: '7px 14px',
      marginBottom: 12,
      minWidth: 180,
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
      padding: '7px 14px',
      marginBottom: 12,
      minWidth: 180,
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
          <Tooltip>
            <TooltipTrigger asChild>
              <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 5, verticalAlign: 'middle', flexShrink: 0, cursor: 'help' }}>
                <Link2 size={13} color="#7b4397" />
              </span>
            </TooltipTrigger>
            <TooltipContent>{typeof data.$ref === 'string' ? `Imported from ${data.$ref}` : 'Imported definition (create local override to change)'}</TooltipContent>
          </Tooltip>
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
          if (key === 'pattern') {
            return (
              <Tooltip key={key}>
                <TooltipTrigger asChild>
                  <span style={{ display: 'inline-flex', alignItems: 'center', cursor: 'default', color: '#7b4397' }}>
                    <Regex size={13} />
                  </span>
                </TooltipTrigger>
                <TooltipContent><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{String(value)}</span></TooltipContent>
              </Tooltip>
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

// Combiner node — compact visual node: fork icon dropdown + count badge
export const CombinerNode = ({ data }: { data: any }) => {
  const { combinerType, variantCount, variantsExpanded, onChangeCombinerType, onToggleVariants, id } = data;
  const activeType = combinerType || 'oneOf';
  const ForkIcon = COMBINER_ICONS[activeType] || ForkIconOneOf;
  const TYPES = ['oneOf', 'anyOf', 'allOf'] as const;
  const [open, setOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as unknown as HTMLElement)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className={styles.combinerNode}>
      <Handle type="target" position={Position.Left} style={{ background: 'var(--color-accent-7, #7c3aed)', width: 8, height: 8, borderRadius: 4 }} />
      <div className={styles.combinerBody}>
        {/* SVG type dropdown */}
        <div className={styles.combinerTypeDropdown} ref={dropdownRef}>
          <button
            className={styles.combinerTypeDropdownTrigger}
            title={COMBINER_TITLES[activeType]}
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); setOpen(o => !o); }}
          >
            <span className={styles.combinerDropdownIcon}><ForkIcon /></span>
            <span className={styles.combinerDropdownChevron}>{open ? '▴' : '▾'}</span>
          </button>
          {open && (
            <div className={styles.combinerTypeDropdownMenu} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              {TYPES.map(t => {
                const Icon = COMBINER_ICONS[t];
                return (
                  <button
                    key={t}
                    className={`${styles.combinerTypeDropdownItem} ${t === activeType ? styles.combinerTypeDropdownItemActive : ''}`}
                    title={COMBINER_TITLES[t]}
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      if (t !== activeType) onChangeCombinerType && onChangeCombinerType(id, t);
                      setOpen(false);
                    }}
                  >
                    <span className={styles.combinerDropdownItemIcon}><Icon /></span>
                    <span className={styles.combinerDropdownItemLabel}>{COMBINER_LABELS[t]}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {/* Variant count badge */}
        {(variantCount ?? 0) > 0 && (
          <span className={styles.combinerCountBadge} title={`${variantCount} variant${variantCount === 1 ? '' : 's'} defined`}>
            {variantCount}
          </span>
        )}
      </div>
      {/* Right-edge expand/collapse toggle — always visible */}
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: 'transparent', border: 'none', width: 22, height: 22, borderRadius: 11, right: -11, zIndex: 1 }}
      />
      <button
        className={styles.combinerEdgeToggle}
        onClick={(e: React.MouseEvent) => { e.stopPropagation(); onToggleVariants && onToggleVariants(id); }}
        title={variantsExpanded ? 'Collapse variants' : 'Expand variants'}
      >
        {variantsExpanded ? '\u2212' : '+'}
      </button>
    </div>
  );
};

// Variant node — expand toggle lives on the right edge, always visible
const PRIMITIVE_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null']);

const isExpandableVariant = (data: any): boolean => {
  // $ref variants always need expansion (resolved lazily)
  if (data.variantRef) return true;
  const s = data.variantSchema;
  if (!s || typeof s !== 'object') return false;
  // Primitive type with no children
  if (PRIMITIVE_TYPES.has(s.type) &&
      !s.properties && !s.items && !s.oneOf && !s.anyOf && !s.allOf && !s.$ref) return false;
  // If no type at all but also no children, not expandable
  if (!s.type && !s.properties && !s.items && !s.oneOf && !s.anyOf && !s.allOf && !s.$ref) return false;
  return true;
};

export const VariantNode = ({ data }: { data: any }) => {
  const { variantIndex, label, variantRef, variantExpanded, isResolving, onToggleVariant, onDeleteVariant, id } = data;
  const expandable = isExpandableVariant(data);
  return (
    <div className={`${styles.variantNode}${expandable ? '' : ` ${styles.variantNodePrimitive}`}`}>
      <Handle type="target" position={Position.Left} style={{ background: '#7c3aed', width: 8, height: 8, borderRadius: 4 }} />
      <div className={styles.variantNodeHeader}>
        <div className={styles.variantNodeTitle}>
          <span>{(variantIndex ?? 0) + 1}. {label}</span>
          {variantRef && (
            <span className={styles.variantRefBadge} title={`Imported: ${variantRef}`}>
              {variantRef.split('/').pop() || 'REF'}
            </span>
          )}
        </div>
        <button
          className={styles.variantDeleteButton}
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); onDeleteVariant && onDeleteVariant(id); }}
          title="Delete variant"
        >
          <Trash2 size={12} />
        </button>
      </div>
      {/* Expand/collapse toggle — only shown when variant has children to expand */}
      {expandable && (
        <>
          <Handle
            type="source"
            position={Position.Right}
            style={{ background: 'transparent', border: 'none', width: 20, height: 20, borderRadius: 10, right: -10, cursor: 'pointer' }}
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); onToggleVariant && onToggleVariant(id); }}
          />
          <button
            className={styles.variantEdgeToggle}
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); onToggleVariant && onToggleVariant(id); }}
            title={variantExpanded ? 'Collapse variant' : 'Expand variant'}
          >
            {isResolving
              ? <Loader2 size={10} className={styles.loadingSpinner} />
              : variantExpanded ? '−' : '+'}
          </button>
        </>
      )}
    </div>
  );
};

// Define nodeTypes
export const nodeTypes: { [key: string]: React.FC<any> } = {
  root: RootNode,
  property: CustomNode,
  enum: EnumNode,
  combiner: CombinerNode,
  variant: VariantNode,
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
