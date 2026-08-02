import React from 'react';
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip/tooltip";
import { AlertCircle, ArrowUpLeft, FileText, GitFork, Link2, ListOrdered, Loader2, Regex, Shuffle, Trash2 } from "lucide-react";

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

// XSD compositor (sequence/choice/all) icon + tooltip + color scheme — shown
// in place of the node label so these compact nodes stay short.
const XML_COMPOSITOR_ICONS: Record<string, React.FC<{ size?: number }>> = {
  sequence: ListOrdered,
  choice: GitFork,
  all: Shuffle,
};

const XML_COMPOSITOR_TITLES: Record<string, string> = {
  sequence: 'sequence — children occur in this exact order',
  choice: 'choice — exactly one child occurs',
  all: 'all — every child occurs, in any order',
};

// Inverted relative to the node's own light background: a light chip with a
// dark, kind-specific foreground icon.
const XML_COMPOSITOR_STYLES: Record<string, { bg: string; color: string }> = {
  sequence: { bg: '#e0e7ff', color: '#3730a3' },
  choice: { bg: '#fae8ff', color: '#86198f' },
  all: { bg: '#d1fae5', color: '#065f46' },
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
import { Handle, Position, BaseEdge, EdgeLabelRenderer, getBezierPath } from "reactflow";
import type { Edge, EdgeProps, Node } from "reactflow"
import type { SchemaNodeData } from "./schema-behaviors";
import styles from "./graphical-schema-editor.module.css";
import { renderTooltipContentChildren } from './tooltip-utils';
import { buildBadges, BADGE_DEFS } from './graphical-schema-badges';
import type { SchemaNodeType } from './types';

import { renderBadges } from './graphical-schema-badges';

const canToggleXmlNodeChildren = (data: any) =>
  Boolean(data.hasChildren) && (
    ((!data.xmlIsRef) && !data.xmlReadOnlySource && !data.isRef) ||
    (Boolean(data.xmlIsRef) && Boolean(data.xmlHasRefExpansion))
  );

// Group box for Properties/Items
export const GroupBox = ({ children }: { title: string; children: React.ReactNode }) => (
  <div style={{
    background: 'var(--graph-node-bg-subtle)',
    border: '2px dashed var(--graph-node-border-accent)',
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
      border: '1px dashed var(--graph-node-border-accent)',
      color: 'var(--color-accent-10)',
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

// Global type node (e.g., global simpleType, complexType) — renders as a green leaf
export const GlobalTypeNode = ({ data }: { data: SchemaNodeData }) => {
  const { label } = data;
  const badges = buildBadges(data);
  const handleStyle = { background: '#4caf50', width: 10, height: 10, borderRadius: 5 };
  return (
    <div style={{
      background: '#e8f5e9',
      border: '2px solid #4caf50',
      borderRadius: 8,
      padding: '7px 14px',
      marginBottom: 12,
      minWidth: 180,
      boxShadow: 'var(--graph-node-shadow)',
      textAlign: 'left',
      position: 'relative',
    }}>
      <Handle id="target-Left" type="target" position={Position.Left} style={handleStyle} />
      <Handle id="target-Right" type="target" position={Position.Right} style={handleStyle} />
      <div className={styles.nodeHeader}>
        {(data as any).isRef && (
          <div style={{ position: 'absolute', top: 6, left: 6, width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, background: 'rgba(30, 64, 175, 0.12)', color: '#1d4ed8', zIndex: 1 }}>
            <ArrowUpLeft size={14} />
          </div>
        )}
        <div className={styles.nodeHeaderLeft}>
          <div className={styles.nodeLabel} style={{ color: '#2e7d32', fontWeight: 600 }}>{label}</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        {renderBadges(badges)}
      </div>
      <Handle id="source-Left" type="source" position={Position.Left} style={handleStyle} />
      <Handle id="source-Right" type="source" position={Position.Right} style={handleStyle} />
      {(data as any).hasChildren && (
        <button
          className={styles.variantEdgeToggle}
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); (data as any).onToggleChildren?.((data as any).id); }}
          title={(data as any).childrenCollapsed ? 'Expand children' : 'Collapse children'}
        >
          {(data as any).childrenCollapsed ? '+' : '\u2212'}
        </button>
      )}
    </div>
  );
};

// Enum node component for displaying enum type (no inline editor)
export const EnumNode = ({ data }: { data: SchemaNodeData & { enum: string[] } }) => {
  const { label, required } = data;
  const badges = buildBadges(data);
  const handleStyle = { background: 'var(--color-accent-7)', width: 10, height: 10, borderRadius: 5 };
  return (
    <div style={{
      background: 'var(--graph-node-bg)',
      border: '2px solid var(--color-accent-6)',
      borderRadius: 8,
      padding: '7px 14px',
      marginBottom: 12,
      minWidth: 180,
      boxShadow: 'var(--graph-node-shadow)',
      textAlign: 'left',
      position: 'relative',
    }}>
      <Handle id="target-Left" type="target" position={Position.Left} style={handleStyle} />
      <Handle id="target-Right" type="target" position={Position.Right} style={handleStyle} />
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
                  <AlertCircle size={16} color="var(--color-accent-10)" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{renderTooltipContentChildren(data.description)}</TooltipContent>
            </Tooltip>
          )}
          {(data as any).$comment && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button aria-label="Node comment" className={styles.nodeIcon}>
                  <FileText size={16} color="var(--graph-node-muted)" />
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
      <Handle id="source-Left" type="source" position={Position.Left} style={handleStyle} />
      <Handle id="source-Right" type="source" position={Position.Right} style={handleStyle} />
      {(data as any).hasChildren && (
        <button
          className={styles.variantEdgeToggle}
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); (data as any).onToggleChildren?.((data as any).id); }}
          title={(data as any).childrenCollapsed ? 'Expand children' : 'Collapse children'}
        >
          {(data as any).childrenCollapsed ? '+' : '\u2212'}
        </button>
      )}
    </div>
  );
};

// Custom node component that renders all data properties
export const CustomNode = ({ data }: { data: SchemaNodeData & { required?: boolean } }) => {
  const { label, required } = data;
  const isPattern = Boolean((data as any).patternKey);
  const badges = buildBadges(data);
  const compositorKind = (data as any).xmlNodeKind as string | undefined;
  const CompositorIcon = compositorKind ? XML_COMPOSITOR_ICONS[compositorKind] : undefined;
  
  // In XML mode, filter out the 'property' type badge (internal node type, not useful for display)
  const isXmlMode = Boolean((data as any).xmlNodeKind);
  const filteredBadges = isXmlMode 
    ? badges.filter(b => !(b.key === 'type' && ((data as any).type === 'property' || (data as any).type === 'globalType')))
    : badges;
  return (
    <div className={isPattern ? styles.patternNode : undefined} style={{
      background: isPattern ? undefined : 'var(--graph-node-bg)',
      border: '2px solid var(--graph-node-border)',
      borderRadius: 8,
      // Compositor nodes render only an icon, so shrink the box to fit it instead of the default text minWidth.
      padding: CompositorIcon ? '4px 6px' : '7px 14px',
      marginBottom: 12,
      minWidth: CompositorIcon ? 'fit-content' : 180,
      boxShadow: 'var(--graph-node-shadow)',
      textAlign: 'left',
      position: 'relative',
    }}>
      <Handle id="target-Left" type="target" position={Position.Left} style={{ background: 'var(--color-accent-7)', width: 10, height: 10, borderRadius: 5 }} />
      <Handle id="target-Right" type="target" position={Position.Right} style={{ background: 'var(--color-accent-7)', width: 10, height: 10, borderRadius: 5 }} />
      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4, color: 'var(--graph-node-text)', position: 'relative' }}>
        {(data as any).isRef && (
          <div style={{ position: 'absolute', top: -6, left: -6, width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: 'rgba(30, 64, 175, 0.12)', color: '#1d4ed8', zIndex: 1 }}>
            <ArrowUpLeft size={14} />
          </div>
        )}
        { (data as any).patternKey ? <span className={styles.patternBadge}>pattern</span> : null }
        {required && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button aria-label="Required" title="Required" className={`${styles.nodeIcon} ${styles.requiredAsterisk}`}>*</button>
            </TooltipTrigger>
            <TooltipContent>Required property</TooltipContent>
          </Tooltip>
        )}
        {CompositorIcon ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                aria-label={`${compositorKind} compositor`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  verticalAlign: 'middle',
                  cursor: 'help',
                  background: XML_COMPOSITOR_STYLES[compositorKind as string].bg,
                  color: XML_COMPOSITOR_STYLES[compositorKind as string].color,
                }}
              >
                <CompositorIcon size={14} />
              </span>
            </TooltipTrigger>
            <TooltipContent>{XML_COMPOSITOR_TITLES[compositorKind as string]}</TooltipContent>
          </Tooltip>
        ) : label}
        {data.imported && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 5, verticalAlign: 'middle', flexShrink: 0, cursor: 'help' }}>
                <Link2 size={13} color="var(--color-accent-10)" />
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
                  <AlertCircle size={16} color="var(--color-accent-10)" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{renderTooltipContentChildren(data.description)}</TooltipContent>
            </Tooltip>
          )}
          {(data as any).$comment && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button aria-label="Node comment" className={styles.nodeIcon} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>
                  <FileText size={16} color="var(--graph-node-muted)" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{renderTooltipContentChildren((data as any).$comment)}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {renderBadges(filteredBadges)}
        {Object.entries(data).map(([key, value]) => {
          if (value === undefined || value === null || value === '' || typeof value === 'boolean') return null;
          const hidden = [
            // JSON Schema properties
            'label', 'id', 'parent', 'type', 'ofType', 'required', 'enum', 'items', 'default', 'title', 'description', '$comment', 'patternKey', 'typeUnion', 'isAdditionalProperties', 'additionalProperties', 'minProperties', 'maxProperties', '$ref',
            // XML Schema metadata (path, kind, etc.)
            'xmlPath', 'xmlNodeKind', 'xmlName', 'xmlElementType', 'xmlHasInlineComplexType', 'xmlInlineComplexTypeName', 'xmlSimpleTypeMode', 'xmlBase', 'xmlMemberTypes', 'xmlItemType', 'xmlEnumerations', 'xmlFacets', 'xmlUnionReferencedEnumerations', 'xmlAttributes', 'xmlAnyAttribute', 'xmlAnyAttributeNamespace', 'xmlIsRef', 'xmlHasRefExpansion', 'xmlReadOnlySource', 'xmlIsAnonymous', 'xmlAttributeInlineSimpleType', 'xmlHasInlineSimpleType', 'xmlAttributeReferencedEnumerations', 'xmlAttributeReferencedTypeName', 'xmlMyTypeNames', 'xmlMyElementNames', 'xmlAnnotation', 'xmlMixed', 'xmlDoc', 'xmlPropertyMap', 'xmlSchemaNodeData', 'xmlns',
            // xs:complexContent inheritance metadata (used only to compute the inheritance-group bounding box, never shown as a badge)
            'xmlExtendsType', 'xmlInheritedFrom',
            // xs:attributeGroup ref metadata (drives the isRef badge tooltip, not a separate badge)
            'xmlAttributeGroupRef',
            // XML Attribute properties
            'xmlAttributeType', 'xmlAttributeUse', 'xmlMinOccurs', 'xmlMaxOccurs',
            // xs:any wildcard content particle properties
            'xmlAnyNamespace', 'xmlAnyProcessContents',
            // XML Schema root attributes
            'xmlTargetNamespace', 'xmlElementFormDefault', 'xmlAttributeFormDefault', 'xmlBlockDefault', 'xmlFinalDefault', 'xmlVersion', 'xmlId',
            // XML mutation operations
            'xmlAddAttribute', 'xmlRemoveAttributeIndex', 'xmlUpdateAttributeIndex',
            // Generic per-node collapse/expand-children toggle metadata (rendered as a button, not a badge)
            'hasChildren', 'childrenCollapsed', 'onToggleChildren',
          ];
          if (hidden.includes(key)) return null;
          if (key === 'format') {
            return (
              <span key={key} style={{
                display: 'inline-block',
                  color: 'var(--color-accent-10)',
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
                    <span style={{ display: 'inline-flex', alignItems: 'center', cursor: 'default', color: 'var(--color-accent-10)' }}>
                    <Regex size={13} />
                  </span>
                </TooltipTrigger>
                <TooltipContent><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{String(value)}</span></TooltipContent>
              </Tooltip>
            );
          }
          if (key === 'xmlAttributeDefault') return null;
          if (Object.prototype.hasOwnProperty.call(BADGE_DEFS, key)) return null;
          if (key === 'imported' && value === true) {
            return (
              <span key={key} style={{
                display: 'inline-block',
                  background: 'color-mix(in srgb, var(--color-accent-7) 16%, var(--graph-node-bg))',
                  color: 'var(--color-accent-10)',
                borderRadius: 8,
                padding: '2px 8px',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.03em',
                  border: '1px solid var(--color-accent-6)',
                marginRight: 4,
                marginBottom: 2,
              }}>imported</span>
            );
          }

          return (
            <span key={key} style={{
              display: 'inline-block',
                background: 'var(--graph-node-bg-subtle)',
                color: 'var(--graph-node-text)',
              borderRadius: 8,
              padding: '2px 8px',
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: '0.03em',
                border: '1px solid var(--graph-node-border)',
              marginRight: 4,
              marginBottom: 2,
            }}>{String(value)}</span>
          );
        })}
      </div>
      <Handle id="source-Left" type="source" position={Position.Left} style={{ background: 'var(--color-accent-7)', width: 10, height: 10, borderRadius: 5 }} />
      <Handle id="source-Right" type="source" position={Position.Right} style={{ background: 'var(--color-accent-7)', width: 10, height: 10, borderRadius: 5 }} />
      {canToggleXmlNodeChildren(data) && (
        <button
          className={styles.variantEdgeToggle}
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); (data as any).onToggleChildren?.((data as any).id); }}
          title={(data as any).childrenCollapsed ? 'Expand children' : 'Collapse children'}
        >
          {(data as any).childrenCollapsed ? '+' : '\u2212'}
        </button>
      )}
    </div>
  );
};

// Simple SchemaCard component for displaying label and type
export const SchemaCard = ({ label, type, imported }: { label: string; type: SchemaNodeType; imported?: boolean }) => (
  <div style={{
    background: 'var(--graph-node-bg)',
    border: '1px solid var(--graph-node-border)',
    borderRadius: 8,
    padding: '8px 14px',
    marginBottom: 8,
    minWidth: 100,
    fontSize: 15,
    fontWeight: 500,
    color: 'var(--graph-node-text)',
    display: 'inline-block',
  }}>
    {label}{imported && (
      <span title="Imported definition (create local override to change)" style={{ color: 'var(--color-accent-10)', marginLeft: 6 }}>*</span>
    )} <span style={{ color: 'var(--graph-node-muted)', fontWeight: 400 }}>({type})</span>
  </div>
);

// Root node as a group box with a property card
export const RootNode: React.FC<{ data: SchemaNodeData }> = ({ data }) => (
  <div style={{ background: 'var(--graph-node-bg-subtle)', border: '2px dashed var(--graph-node-border-accent)', borderRadius: 12, padding: '18px', position: 'relative' }}>
    <Handle id="target-Left" type="target" position={Position.Left} style={{ display: 'none' }} />
    <Handle id="source-Right" type="source" position={Position.Right} />
    <div className="root-node" style={{ pointerEvents: 'none', cursor: 'default' }}>
      <SchemaCard label={data.label} type={data.type} imported={data.imported} />
    </div>
    {canToggleXmlNodeChildren(data) && (
      <button
        className={styles.variantEdgeToggle}
        style={{ pointerEvents: 'auto' }}
        onClick={(e: React.MouseEvent) => { e.stopPropagation(); (data as any).onToggleChildren?.((data as any).id); }}
        title={(data as any).childrenCollapsed ? 'Expand children' : 'Collapse children'}
      >
        {(data as any).childrenCollapsed ? '+' : '\u2212'}
      </button>
    )}
  </div>
);

// Properties group node type
export const PropertiesGroupNode = ({ children }: { children?: React.ReactNode }) => (
  <div style={{ background: 'var(--graph-node-bg-subtle)', border: '2px dashed var(--graph-node-border-accent)', borderRadius: 12, padding: '18px' }}>{children}</div>
);

// Items group node type
export const ItemsGroupNode = ({ data }: { data: SchemaNodeData }) => (
  <div style={{ background: 'var(--graph-node-bg-subtle)', border: '2px dashed var(--graph-node-border-accent)', borderRadius: 12, padding: '18px' }}>
    <SchemaCard label={data.label} type={data.type} imported={data.imported} />
  </div>
);

// Decorative background box drawn behind an XML element/complexType node and the
// descendant nodes it inherited via `xs:complexContent`/`xs:extension` (or `xs:restriction`)
// — purely visual, not draggable/selectable; sized and positioned by the caller (relayoutNodes)
// to bound the owning node together with its inherited-from-base-type children.
export const InheritanceGroupNode = ({ data }: { data: any }) => (
  <div
    style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      background: 'var(--graph-node-bg-subtle)',
      border: '2px dashed var(--graph-node-border-accent)',
      borderRadius: 12,
      pointerEvents: 'none',
    }}
  >
    {data?.label && (
      <div style={{ padding: '4px 10px', fontSize: 11, opacity: 0.7 }}>{data.label}</div>
    )}
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
    const handler = (e: Event) => {
      const target = e.target as globalThis.Node | null;
      if (dropdownRef.current && target && !dropdownRef.current.contains(target)) {
        setOpen(false);
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // Capture phase makes this resilient even when inner layers stop propagation.
    document.addEventListener('pointerdown', handler, true);
    document.addEventListener('mousedown', handler, true);
    document.addEventListener('keydown', keyHandler, true);
    return () => {
      document.removeEventListener('pointerdown', handler, true);
      document.removeEventListener('mousedown', handler, true);
      document.removeEventListener('keydown', keyHandler, true);
    };
  }, [open]);

  return (
    <div className={styles.combinerNode}>
      <Handle id="target-Left" type="target" position={Position.Left} style={{ background: 'var(--color-accent-7, #7c3aed)', width: 8, height: 8, borderRadius: 4 }} />
      <Handle id="target-Right" type="target" position={Position.Right} style={{ background: 'var(--color-accent-7, #7c3aed)', width: 8, height: 8, borderRadius: 4 }} />
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
      <Handle id="source-Left" type="source" position={Position.Left} style={{ background: 'transparent', border: 'none', width: 8, height: 8, borderRadius: 4 }} />
      <Handle id="source-Right" type="source" position={Position.Right} style={{ background: 'transparent', border: 'none', width: 8, height: 8, borderRadius: 4 }} />
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

  // Array variants are edited in the RHS NodePropertyEditor; no inline expansion.
  if (s.type === 'array' || (Array.isArray(s.type) && s.type.includes('array')) || s.items !== undefined) {
    return false;
  }

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
      <Handle id="target-Left" type="target" position={Position.Left} style={{ background: 'var(--color-accent-7)', width: 8, height: 8, borderRadius: 4 }} />
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
          <Handle id="source-Left" type="source" position={Position.Left} style={{ background: 'transparent', border: 'none', width: 8, height: 8, borderRadius: 4 }} />
          <Handle id="source-Right" type="source" position={Position.Right} style={{ background: 'transparent', border: 'none', width: 8, height: 8, borderRadius: 4 }} />
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
      {!expandable && (
        <>
          <Handle id="source-Top" type="source" position={Position.Top} style={{ background: 'transparent', border: 'none', width: 8, height: 8, borderRadius: 4 }} />
          <Handle id="source-Right" type="source" position={Position.Right} style={{ background: 'transparent', border: 'none', width: 8, height: 8, borderRadius: 4 }} />
          <Handle id="source-Bottom" type="source" position={Position.Bottom} style={{ background: 'transparent', border: 'none', width: 8, height: 8, borderRadius: 4 }} />
          <Handle id="source-Left" type="source" position={Position.Left} style={{ background: 'transparent', border: 'none', width: 8, height: 8, borderRadius: 4 }} />
        </>
      )}
    </div>
  );
};

// Edge that renders a small cardinality label (minOccurs/maxOccurs) beside its
// target node's incoming handle, e.g. "0..1", "1..∞" — used for XML element/
// compositor edges where `data.cardinality` is set.
export const CardinalityEdge = ({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, data,
}: EdgeProps) => {
  const [edgePath] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const cardinality = (data as any)?.cardinality as string | undefined;

  // Nudge the label out from the target node's connecting side, toward the edge.
  const LABEL_OFFSET = 20;
  let labelX = targetX;
  let labelY = targetY;
  if (targetPosition === Position.Left) labelX = targetX - LABEL_OFFSET;
  else if (targetPosition === Position.Right) labelX = targetX + LABEL_OFFSET;
  else if (targetPosition === Position.Top) labelY = targetY - LABEL_OFFSET;
  else labelY = targetY + LABEL_OFFSET;

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      {cardinality && (
        <EdgeLabelRenderer>
          <div
            className={styles.cardinalityLabel}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {cardinality}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

// Define nodeTypes
export const nodeTypes: { [key: string]: React.FC<any> } = {
  root: RootNode,
  property: CustomNode,
  globalType: GlobalTypeNode,
  enum: EnumNode,
  combiner: CombinerNode,
  variant: VariantNode,
  propertiesGroup: PropertiesGroupNode,
  itemsGroup: ItemsGroupNode,
  inheritanceGroup: InheritanceGroupNode,
};

// Define edgeTypes
export const edgeTypes: { [key: string]: React.FC<any> } = {
  cardinality: CardinalityEdge,
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
