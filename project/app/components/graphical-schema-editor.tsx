import React from 'react';
import * as dagreLib from 'dagre';
import { ContextMenu } from "./ContextMenu";
import {
  addPropertyToSchema,
  addPatternPropertyToSchema,
  schemaNodeDataToSchema
} from "./schema-behaviors";
import ReactFlow, {
  ReactFlowProvider,
  addEdge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Position,
} from "reactflow";
import { TooltipProvider } from "./ui/tooltip/tooltip";
import { HorizontalSplitPane } from "./ui/split-pane";
import { getVariantLabel } from '../utils/labels';
import { XSD_BUILTIN_SIMPLE_TYPES } from '../utils/xsd-types';
import { applySnappedDagreLayout } from './graphical-schema-layout-snapped';
import { GraphicalSchemaRhsControl } from './graphical-schema-rhs-control';
import type { Connection, Edge, Node, OnConnect } from "reactflow"
import type { SchemaNodeData } from "./schema-behaviors";
import type { NodeData, GraphicalSchemaEditorProps, InlineSimpleTypeData, SimpleTypeFacets } from './types';
import { nodeTypes, edgeTypes, initialNodes, initialEdges } from './schema-node-types';
import { printGraphSection } from '../utils/print-graph';
import "reactflow/dist/style.css";
import styles from "./graphical-schema-editor.module.css";

// Persists node collapse/expand state across a real browser refresh (globalThis alone only
// survives a tab switch within the same page load, since it's wiped on reload).
const COLLAPSE_STATE_STORAGE_KEY = 'schema-sculptor-graph-collapse-state';

interface PersistedCollapseState {
  schemaKey: string | null;
  collapsed: string[];
  expanded: string[];
  userToggled: boolean;
}

function loadPersistedCollapseState(): PersistedCollapseState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(COLLAPSE_STATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      schemaKey: typeof parsed.schemaKey === 'string' ? parsed.schemaKey : null,
      collapsed: Array.isArray(parsed.collapsed) ? parsed.collapsed : [],
      expanded: Array.isArray(parsed.expanded) ? parsed.expanded : [],
      userToggled: Boolean(parsed.userToggled),
    };
  } catch (_) {
    return null;
  }
}

function savePersistedCollapseState(state: PersistedCollapseState) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(COLLAPSE_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch (_) {
    // ignore (e.g. storage disabled or quota exceeded)
  }
}

// Runs once per JS realm (i.e. once per real page load) to seed the globalThis-backed
// collapse-state containers from localStorage before any component instance reads them —
// without this, a fresh page load starts with empty globalThis containers even though the
// user's collapse shape was saved from the previous page load.
function hydrateCollapseStateFromStorageIfNeeded() {
  const runtime = globalThis as typeof globalThis & {
    __graphicalSchemaCollapseHydratedFromStorage?: boolean;
    __graphicalSchemaCollapsedNodeIds?: Set<string>;
    __graphicalSchemaExpandedNodeIds?: Set<string>;
    __graphicalSchemaCollapsedNodeIdsKey?: string | null;
    __graphicalSchemaUserToggledChildren?: boolean;
  };
  if (runtime.__graphicalSchemaCollapseHydratedFromStorage) return;
  runtime.__graphicalSchemaCollapseHydratedFromStorage = true;
  const persisted = loadPersistedCollapseState();
  if (!persisted) return;
  runtime.__graphicalSchemaCollapsedNodeIds = new Set(persisted.collapsed);
  runtime.__graphicalSchemaExpandedNodeIds = new Set(persisted.expanded);
  runtime.__graphicalSchemaCollapsedNodeIdsKey = persisted.schemaKey;
  runtime.__graphicalSchemaUserToggledChildren = persisted.userToggled;
}

// Helper functions for edge positioning — connect to the nearest side of parent nodes
function positionForDirection(dx: number): Position {
  // Only Left/Right handles are guaranteed to exist on every node type (Top/Bottom
  // are only rendered by the non-expandable VariantNode); picking Top/Bottom here for
  // any other node silently fails to render the edge (React Flow error #008).
  return dx >= 0 ? Position.Right : Position.Left;
}

function oppositePosition(position: Position): Position {
  if (position === Position.Left) return Position.Right;
  if (position === Position.Right) return Position.Left;
  if (position === Position.Top) return Position.Bottom;
  return Position.Top;
}

function handleId(kind: 'source' | 'target', position: Position): string {
  // Capitalize first letter of position (e.g., "right" -> "Right")
  const capitalizedPosition = position.charAt(0).toUpperCase() + position.slice(1);
  return `${kind}-${capitalizedPosition}`;
}

// Formats an XML element/compositor's minOccurs/maxOccurs as a short cardinality
// label (e.g. "0..1", "1..∞"), collapsing to a single number when min === max.
// Returns undefined when neither bound is present (nothing to label).
function formatCardinality(minOccurs: unknown, maxOccurs: unknown): string | undefined {
  if (minOccurs === undefined && maxOccurs === undefined) return undefined;
  const min = minOccurs !== undefined && minOccurs !== null ? String(minOccurs) : '1';
  const maxRaw = maxOccurs !== undefined && maxOccurs !== null ? String(maxOccurs) : '1';
  const max = maxRaw === 'unbounded' ? '\u221E' : maxRaw;
  return min === max ? min : `${min}..${max}`;
}

function isXmlCompositorNode(node: Node<SchemaNodeData>): boolean {
  const xmlKind = (node.data as any)?.xmlNodeKind as string | undefined;
  return xmlKind === 'sequence' || xmlKind === 'choice' || xmlKind === 'all';
}

function estimateNodeWidth(node: Node<SchemaNodeData>): number {
  // Compositor nodes render only a small icon chip, not a text label.
  if (isXmlCompositorNode(node)) return 44;
  const label = (node.data?.label as string) || '';
  const CHAR_WIDTH = 8;
  const MIN_WIDTH = 180;
  const H_PADDING = 40;
  const minW = (node.type === 'combiner' || node.type === 'variant') ? 80 : MIN_WIDTH;
  return Math.max(minW, label.length * CHAR_WIDTH + H_PADDING);
}

function estimateNodeHeight(node: Node<SchemaNodeData>): number {
  if (node.type === 'combiner') return 48;
  if (node.type === 'variant') return 52;
  return 64;
}

function attachEdgePositions(edge: Edge, sourceNode: Node<SchemaNodeData>, targetNode: Node<SchemaNodeData>): Edge {
  const sourceWidth = estimateNodeWidth(sourceNode);
  const sourceHeight = estimateNodeHeight(sourceNode);
  const targetWidth = estimateNodeWidth(targetNode);
  const targetHeight = estimateNodeHeight(targetNode);
  const sourceCenter = {
    x: sourceNode.position.x + sourceWidth / 2,
    y: sourceNode.position.y + sourceHeight / 2,
  };
  const targetCenter = {
    x: targetNode.position.x + targetWidth / 2,
    y: targetNode.position.y + targetHeight / 2,
  };
  
  let sourcePosition: Position;
  let targetPosition: Position;
  
  // Root node (schema node) always connects via Right side
  if (sourceNode.type === 'root') {
    sourcePosition = Position.Right;
  } else {
    sourcePosition = positionForDirection(targetCenter.x - sourceCenter.x);
  }
  
  if (targetNode.type === 'root') {
    targetPosition = Position.Left;
  } else {
    targetPosition = oppositePosition(sourcePosition);
  }

  return {
    ...edge,
    sourcePosition,
    targetPosition,
    sourceHandle: handleId('source', sourcePosition),
    targetHandle: handleId('target', targetPosition),
  } as unknown as Edge;
}

// Apply edge positioning to all edges based on node positions
function applyEdgePositioning(edges: Edge[], nodes: Node<SchemaNodeData>[]): Edge[] {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  return edges.map(edge => {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if (sourceNode && targetNode) {
      return attachEdgePositions(edge, sourceNode, targetNode);
    }
    return edge;
  });
}

// Minimal, dependency-free versions of getXmlAttrs/asArray for the pure parse/serialize
// helpers below (those live at module scope, outside the component's useCallback closures).
function rawXmlAttrs(node: any): Record<string, unknown> {
  if (!node || typeof node !== 'object') return {};
  return node['@attributes'] && typeof node['@attributes'] === 'object' ? (node['@attributes'] as Record<string, unknown>) : {};
}
function rawAsArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

// Single-value XSD restriction facets (as opposed to the repeatable `xs:enumeration`), each
// shaped `<xs:pattern value="..."/>` etc — read/written as plain scalar strings.
const SIMPLE_TYPE_FACET_TAGS: Array<[keyof SimpleTypeFacets, string]> = [
  ['pattern', 'xs:pattern'],
  ['minInclusive', 'xs:minInclusive'],
  ['maxInclusive', 'xs:maxInclusive'],
  ['minLength', 'xs:minLength'],
  ['maxLength', 'xs:maxLength'],
  ['totalDigits', 'xs:totalDigits'],
  ['fractionDigits', 'xs:fractionDigits'],
  ['whiteSpace', 'xs:whiteSpace'],
];

function parseSimpleTypeFacets(restriction: any): SimpleTypeFacets | undefined {
  const facets: SimpleTypeFacets = {};
  let found = false;
  for (const [facetKey, tag] of SIMPLE_TYPE_FACET_TAGS) {
    const raw = restriction[tag];
    if (raw === undefined || raw === null) continue;
    const value = rawXmlAttrs(Array.isArray(raw) ? raw[0] : raw).value;
    if (typeof value === 'string') {
      facets[facetKey] = value;
      found = true;
    }
  }
  return found ? facets : undefined;
}

function serializeSimpleTypeFacets(result: any, facets: SimpleTypeFacets | undefined): void {
  if (!facets) return;
  for (const [facetKey, tag] of SIMPLE_TYPE_FACET_TAGS) {
    const value = facets[facetKey];
    if (value !== undefined && value !== null && value !== '') result[tag] = { '@attributes': { value } };
  }
}

// Parses an `xs:attribute`'s inline (anonymous) `xs:simpleType` — including arbitrarily
// nested `xs:union`/`xs:list` member simpleTypes — into a plain serializable tree so it can
// be edited in the RHS and written back via `serializeInlineSimpleType`.
function parseInlineSimpleType(simpleTypeValue: any): InlineSimpleTypeData | undefined {
  if (!simpleTypeValue || typeof simpleTypeValue !== 'object') return undefined;
  const restriction = simpleTypeValue['xs:restriction'];
  const union = simpleTypeValue['xs:union'];
  const list = simpleTypeValue['xs:list'];

  if (restriction && typeof restriction === 'object') {
    const attrs = rawXmlAttrs(restriction);
    const enumerations = rawAsArray(restriction['xs:enumeration'])
      .map((entry: any) => rawXmlAttrs(entry).value)
      .filter((value: unknown): value is string => typeof value === 'string');
    const facets = parseSimpleTypeFacets(restriction);
    return { mode: 'restriction', base: typeof attrs.base === 'string' ? attrs.base : undefined, enumerations, ...(facets ? { facets } : {}) };
  }
  if (union && typeof union === 'object') {
    const attrs = rawXmlAttrs(union);
    const memberSimpleTypes = rawAsArray(union['xs:simpleType'])
      .map((entry: any) => parseInlineSimpleType(entry))
      .filter((entry): entry is InlineSimpleTypeData => Boolean(entry));
    return { mode: 'union', memberTypes: typeof attrs.memberTypes === 'string' ? attrs.memberTypes : undefined, memberSimpleTypes };
  }
  if (list && typeof list === 'object') {
    const attrs = rawXmlAttrs(list);
    const rawNested = Array.isArray(list['xs:simpleType']) ? list['xs:simpleType'][0] : list['xs:simpleType'];
    const itemSimpleType = rawNested ? parseInlineSimpleType(rawNested) : undefined;
    return { mode: 'list', itemType: typeof attrs.itemType === 'string' ? attrs.itemType : undefined, itemSimpleType };
  }
  return undefined;
}

// Inverse of parseInlineSimpleType: turns the edited tree back into the raw XML JSON shape
// expected under an `xs:attribute`'s `xs:simpleType` key.
function serializeInlineSimpleType(data: InlineSimpleTypeData): any {
  if (data.mode === 'union') {
    const attrs: Record<string, unknown> = {};
    if (data.memberTypes) attrs.memberTypes = data.memberTypes;
    const result: any = { '@attributes': attrs };
    const members = (data.memberSimpleTypes || []).map(serializeInlineSimpleType);
    // Follows this codebase's convention: a single occurrence is a plain object, only
    // repeated occurrences (2+) become an array (see `xmlSchemaToGraph`'s `asArray` reads,
    // which already accept either shape when parsing this back).
    if (members.length === 1) result['xs:simpleType'] = members[0];
    else if (members.length > 1) result['xs:simpleType'] = members;
    return { 'xs:union': result };
  }
  if (data.mode === 'list') {
    const attrs: Record<string, unknown> = {};
    if (data.itemType) attrs.itemType = data.itemType;
    const result: any = { '@attributes': attrs };
    if (data.itemSimpleType) result['xs:simpleType'] = serializeInlineSimpleType(data.itemSimpleType);
    return { 'xs:list': result };
  }
  // restriction (default)
  const attrs: Record<string, unknown> = {};
  if (data.base) attrs.base = data.base;
  const result: any = { '@attributes': attrs };
  const enumerations = (data.enumerations || []).filter((value) => value !== undefined && value !== null);
  if (enumerations.length > 0) result['xs:enumeration'] = enumerations.map((value) => ({ '@attributes': { value } }));
  serializeSimpleTypeFacets(result, data.facets);
  return { 'xs:restriction': result };
}

// Human-readable label for an `xmlNodeKind` value, used to build "Delete <Kind>" context-menu text.
const XML_KIND_LABELS: Record<string, string> = {
  schema: 'Schema',
  complexType: 'ComplexType',
  simpleType: 'SimpleType',
  attributeGroup: 'AttributeGroup',
  element: 'Element',
  attribute: 'Attribute',
  sequence: 'Sequence',
  choice: 'Choice',
  all: 'All',
  any: 'Any',
};
function xmlKindLabel(kind: string): string {
  return XML_KIND_LABELS[kind] || (kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : 'Node');
}

// Deletes the value at `path` (a node's own `xmlPath`, pointing at itself) from a cloned
// raw XML-schema JSON tree — splices an array index or deletes an object key.
function deleteAtXmlPath(root: any, path: Array<string | number>): boolean {
  if (!Array.isArray(path) || path.length === 0) return false;
  let parent: any = root;
  for (let i = 0; i < path.length - 1; i++) {
    parent = parent?.[path[i] as any];
    if (parent == null) return false;
  }
  const last = path[path.length - 1];
  if (Array.isArray(parent) && typeof last === 'number') {
    if (last < 0 || last >= parent.length) return false;
    parent.splice(last, 1);
    return true;
  }
  if (parent && typeof parent === 'object' && !Array.isArray(parent) && last in parent) {
    delete parent[last as any];
    return true;
  }
  return false;
}

// Reads the value at `path` from a raw XML-schema JSON tree (array index or object key).
function getAtXmlPath(root: any, path: Array<string | number>): any {
  let current = root;
  for (const segment of path) {
    if (current == null) return undefined;
    current = typeof segment === 'number' ? (Array.isArray(current) ? current[segment] : undefined) : current[segment as string];
  }
  return current;
}

// Writes `value` at `path` (the parent container must already exist) in a raw XML-schema JSON tree.
function setAtXmlPath(root: any, path: Array<string | number>, value: any): boolean {
  if (!Array.isArray(path) || path.length === 0) return false;
  let parent: any = root;
  for (let i = 0; i < path.length - 1; i++) {
    parent = parent?.[path[i] as any];
    if (parent == null) return false;
  }
  parent[path[path.length - 1] as any] = value;
  return true;
}

// Collects the ids of every node transitively parented (via `data.parent`) under `rootId`, so a
// dragged node's whole subtree can be moved along with it. (Distinct from the in-component
// `collectDescendantIds` used for collapse/hide, which only walks visible collapse targets.)
function collectDragSubtreeIds(rootId: string, allNodes: Array<Node<any>>): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const n of allNodes) {
    const parentId = (n.data as any)?.parent as string | undefined;
    if (!parentId) continue;
    const siblings = childrenByParent.get(parentId);
    if (siblings) siblings.push(n.id);
    else childrenByParent.set(parentId, [n.id]);
  }
  const result = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const childId of childrenByParent.get(id) ?? []) {
      if (!result.has(childId)) {
        result.add(childId);
        stack.push(childId);
      }
    }
  }
  return result;
}

// Recursively removes every `xs:element`/`xs:attribute`/`xs:attributeGroup` (etc, per `tagKeys`)
// entry anywhere in the tree whose `@attributes[attrKey]` (namespace-stripped) equals `name` —
// used to cascade-delete all usages of a global type/element/attribute/group that was just deleted.
function pruneXmlRefEntries(root: any, tagKeys: string[], attrKey: 'type' | 'ref', name: string): void {
  if (!root || typeof root !== 'object') return;
  const localName = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    return value.includes(':') ? value.split(':').pop() : value;
  };
  for (const key of Object.keys(root)) {
    const value = (root as any)[key];
    if (tagKeys.includes(key)) {
      if (Array.isArray(value)) {
        const kept: any[] = [];
        for (const entry of value) {
          const attrs = entry && typeof entry === 'object' ? (entry['@attributes'] || {}) : {};
          if (localName(attrs[attrKey]) === name) continue;
          pruneXmlRefEntries(entry, tagKeys, attrKey, name);
          kept.push(entry);
        }
        if (kept.length === 0) delete (root as any)[key];
        else (root as any)[key] = kept;
        continue;
      }
      if (value && typeof value === 'object') {
        const attrs = value['@attributes'] || {};
        if (localName(attrs[attrKey]) === name) {
          delete (root as any)[key];
          continue;
        }
        pruneXmlRefEntries(value, tagKeys, attrKey, name);
        continue;
      }
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => pruneXmlRefEntries(entry, tagKeys, attrKey, name));
    } else if (value && typeof value === 'object') {
      pruneXmlRefEntries(value, tagKeys, attrKey, name);
    }
  }
}

// Which tags/attribute reference a top-level global definition of each `xmlNodeKind`, used to
// cascade-delete usages when the global definition itself is deleted.
const XML_GLOBAL_REF_TARGETS: Record<string, { tagKeys: string[]; attrKey: 'type' | 'ref' }> = {
  complexType: { tagKeys: ['xs:element', 'xs:attribute'], attrKey: 'type' },
  simpleType: { tagKeys: ['xs:element', 'xs:attribute'], attrKey: 'type' },
  attributeGroup: { tagKeys: ['xs:attributeGroup'], attrKey: 'ref' },
  element: { tagKeys: ['xs:element'], attrKey: 'ref' },
  attribute: { tagKeys: ['xs:attribute'], attrKey: 'ref' },
};

export function GraphicalSchemaEditor({ schema, onChange, useTestData, schemaLanguage }: GraphicalSchemaEditorProps) {
  type ExpansionState = {
    combiners: Record<string, boolean>;
    variants: Record<string, boolean>;
  };

  // Ref to store label of selected node before graph rebuild
  const selectedNodeLabelRef = React.useRef<string | null>(null);
  const initialLoadRef = React.useRef(true);
  const flowWrapperRef = React.useRef<HTMLDivElement | null>(null);
  const pendingCenterRef = React.useRef(false);
  // Id of the node whose collapse/expand toggle triggered `pendingCenterRef` — the re-centre
  // effect uses this to keep that specific node in view instead of refitting the whole graph.
  const pendingCenterNodeIdRef = React.useRef<string | null>(null);
  const pendingTimeoutsRef = React.useRef<number[]>([]);
  const isMountedRef = React.useRef(true);
  const edgePositioningCacheRef = React.useRef<Map<string, Edge[]>>(new Map());
  // Only render ReactFlow when the wrapper has a measured non-zero height.
  // This avoids React Flow error #004 when the parent container has no height
  // at initial render (e.g. due to CSS/layout timing).
  const [canRenderFlow, setCanRenderFlow] = React.useState<boolean>(() => false);
  const [explicitHeight, setExplicitHeight] = React.useState<number | undefined>(undefined);
  const failedChecksRef = React.useRef<number>(0);

  // Memoized edge positioning with caching to avoid recalculating positions
  const applyEdgePositioningCached = React.useCallback((edges: Edge[], nodes: Node<SchemaNodeData>[]): Edge[] => {
    const cache = edgePositioningCacheRef.current;
    const cacheKey = nodes.map(n => `${n.id}:${Math.round(n.position.x)}:${Math.round(n.position.y)}`).join('|');
    
    // Always recompute when node positions have changed; if all edges are cached from a previous
    // run with these same positions, we can reuse them. But if new edges were added (lazy-loaded),
    // they won't be in the cache and need positioning from scratch.
    const result = applyEdgePositioning(edges, nodes);
    
    // Cache the result for this node position set to avoid recomputation if called again
    // with the same node positions. Clear old entries if cache gets too large.
    cache.set(cacheKey, result);
    if (cache.size > 50) {
      const firstKey = cache.keys().next().value;
      if (firstKey !== undefined) {
        cache.delete(firstKey);
      }
    }
    return result;
  }, []);

  const scheduleTask = React.useCallback((task: () => void, delay = 0) => {
    const timeoutId = window.setTimeout(() => {
      if (!isMountedRef.current) return;
      pendingTimeoutsRef.current = pendingTimeoutsRef.current.filter((id) => id !== timeoutId);
      task();
    }, delay);
    pendingTimeoutsRef.current.push(timeoutId);
    return timeoutId;
  }, []);

  React.useEffect(() => {
    return () => {
      isMountedRef.current = false;
      for (const timeoutId of pendingTimeoutsRef.current) {
        window.clearTimeout(timeoutId);
      }
      pendingTimeoutsRef.current = [];
    };
  }, []);

  React.useEffect(() => {
    const el = flowWrapperRef.current;
    const check = () => {
      const rect = el?.getBoundingClientRect();
      const w = rect?.width ?? 0;
      const h = rect?.height ?? 0;
      // Debug logging in development to help diagnose layout issues
      try {
        // eslint-disable-next-line no-undef
        if (process && process.env && process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.debug('[GraphicalSchemaEditor] flowWrapper rect', { width: w, height: h, explicitHeight });
        }
      } catch (e) { /* ignore in non-node environments */ }

      // Only render when both width and height are available. This avoids
      // React Flow error #004 which occurs when one dimension is zero.
      if (w > 0 && h > 0) {
        setCanRenderFlow(true);
        failedChecksRef.current = 0;
        return;
      }

      // In JSDOM (tests) element measurements are 0; allow rendering in Jest.
      try {
        // eslint-disable-next-line no-undef
        if (typeof process !== 'undefined' && process?.env?.JEST_WORKER_ID) {
          setCanRenderFlow(true);
          return;
        }
      } catch (e) { /* ignore */ }

      // Keep count of failed checks; after several failures, apply a robust
      // fallback: set an explicit height on the wrapper so ReactFlow has a
      // measurable container to render into. This helps in cases where the
      // layout settles asynchronously (e.g., external CSS or dynamic header).
      failedChecksRef.current += 1;
      if (failedChecksRef.current >= 5 && !explicitHeight) {
        const fallback = Math.max(480, (typeof window !== 'undefined' ? Math.floor(window.innerHeight - 200) : 480));
        // eslint-disable-next-line no-console
        if (typeof process !== 'undefined' && process?.env?.NODE_ENV !== 'production') console.debug('[GraphicalSchemaEditor] applying explicit fallback height', fallback);
        setExplicitHeight(fallback);
        // Wait a tick to allow the explicit height to flush into the DOM
        scheduleTask(() => setCanRenderFlow(true), 0);
        return;
      }

      // Layout may settle after a tick; schedule a short re-check.
      scheduleTask(() => {
        const r2 = el?.getBoundingClientRect();
        if (r2 && r2.width > 0 && r2.height > 0) setCanRenderFlow(true);
      }, 50);
    };
    check();

    // Prefer ResizeObserver when available; otherwise listen for window resize
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(check);
      if (el) ro.observe(el);
    } else {
      window.addEventListener('resize', check);
    }
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', check);
    };
  }, [explicitHeight]);

  // When ReactFlow becomes renderable, dispatch a resize so it can calculate layout
  React.useEffect(() => {
    if (canRenderFlow) {
      // Dispatch asynchronously to allow layout to settle
      scheduleTask(() => window.dispatchEvent(new Event('resize')), 0);
    }
  }, [canRenderFlow, scheduleTask]);

  // Helper to generate deterministic IDs based on path
  const makeId = (parentId?: string, label?: string) => {
    if (!parentId) return '1';
    const safeLabel = (label || '').toString().replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${parentId}.${safeLabel}`;
  };

  const isXmlGraphMode = React.useMemo(() => {
    const s = schema as any;
    // Check if schema actually has XML structure (xs:schema key)
    // Only use XML mode if the schema has the XML namespace structure
    return Boolean(s && typeof s === 'object' && s['xs:schema']);
  }, [schema]);

  const asArray = React.useCallback((value: unknown): any[] => {
    if (Array.isArray(value)) return value;
    if (value == null) return [];
    return [value];
  }, []);

  const toNodeLabel = React.useCallback((kind: string, attrs: Record<string, unknown> | undefined, fallback: string) => {
    const name = typeof attrs?.name === 'string' ? attrs.name : '';
    // The node's kind is conveyed via a badge, so the label is just the name.
    return name || fallback;
  }, []);

  const getXmlAttrs = React.useCallback((node: any): Record<string, unknown> => {
    if (!node || typeof node !== 'object') return {};
    // Start with @attributes if they exist (XML form)
    const fromAttrs = node['@attributes'] && typeof node['@attributes'] === 'object' ? (node['@attributes'] as Record<string, unknown>) : {};
    // Also check for direct properties (normalized form, e.g., MS SchemaObject)
    // These would be things like targetNamespace, elementFormDefault, etc. at the root
    const directProps: Record<string, unknown> = {};
    const xmlSchemaProps = ['targetNamespace', 'elementFormDefault', 'attributeFormDefault', 'blockDefault', 'finalDefault', 'version', 'id', 'xmlns', 'xmlns:xs', 'mixed'];
    xmlSchemaProps.forEach(prop => {
      if (Object.prototype.hasOwnProperty.call(node, prop)) {
        directProps[prop] = (node as any)[prop];
      }
    });
    // Merge: direct properties override @attributes
    const merged = { ...fromAttrs, ...directProps };
    return merged;
  }, []);

  // Reads ALL `xs:annotation/xs:documentation` text from a raw XSD node, supporting paging.
  // Returns an array of annotation texts (one per xs:annotation element).
  const getXmlAnnotationDocs = React.useCallback((node: any): string[] => {
    if (!node || typeof node !== 'object') return [];
    const annotations = asArray((node as any)['xs:annotation']);
    return annotations
      .map((annotation: any) => {
        if (!annotation || typeof annotation !== 'object') return '';
        const documentation = Array.isArray(annotation['xs:documentation']) 
          ? annotation['xs:documentation'][0] 
          : annotation['xs:documentation'];
        if (typeof documentation === 'string') return documentation;
        if (documentation && typeof documentation === 'object') {
          const text = (documentation as any)['#text'];
          if (typeof text === 'string') return text;
        }
        return '';
      })
      .filter((text: string) => text !== '');
  }, []);

  // Helper to add annotation field(s) to node data
  // Returns { xmlAnnotations } if multiple, { xmlAnnotation } if single, {} if none
  const getAnnotationField = React.useCallback((node: any) => {
    const docs = getXmlAnnotationDocs(node);
    if (docs.length > 1) {
      return { xmlAnnotations: docs };
    } else if (docs.length === 1) {
      return { xmlAnnotation: docs[0] };
    }
    return {};
  }, [getXmlAnnotationDocs]);

  const xmlSchemaToGraph = React.useCallback(
    (xmlDoc: Record<string, unknown>, options?: { visibleOnly?: boolean; xmlShowAnnotations?: boolean; xmlShowImports?: boolean }): { nodes: Node<SchemaNodeData>[]; edges: Edge[] } => {
      const buildVisibleOnly = options?.visibleOnly === true;
      const showAnnotations = options?.xmlShowAnnotations === true;
      const showImports = options?.xmlShowImports === true;
      const nodes: Node<SchemaNodeData>[] = [];
      const edges: Edge[] = [];

    const schemaRoot = ((xmlDoc as any)?.['xs:schema'] && typeof (xmlDoc as any)['xs:schema'] === 'object')
      ? (xmlDoc as any)['xs:schema']
      : xmlDoc;

    const schemaAttrs = getXmlAttrs(schemaRoot);

    const addNode = (data: any, parentId?: string, hasHiddenChildren = false) => {
      const id = data.id as string;
      if (buildVisibleOnly && hasHiddenChildren) {
        data = { ...data, hasHiddenChildren: true, childrenCollapsed: true };
      }
      nodes.push({
        id,
        type: data.type || 'property',
        data,
        position: { x: data.x ?? 0, y: data.y ?? 0 },
      } as Node<SchemaNodeData>);
      if (parentId) {
        const cardinality = formatCardinality(data.xmlMinOccurs, data.xmlMaxOccurs);
        edges.push({
          id: `e${parentId}-${id}`,
          source: parentId,
          target: id,
          type: cardinality ? 'cardinality' : 'default',
          ...(cardinality ? { data: { cardinality } } : {}),
        } as Edge);
      }
    };

    // An `xs:attribute`'s inline (anonymous) `xs:simpleType` gets its own child graph node
    // (rather than being edited inline within the attribute's own RHS form) so it can be
    // selected and edited via the same "SimpleType Editor" experience as a named simpleType.
    // `xmlIsAnonymous` distinguishes it from a real top-level named simpleType node so the RHS
    // routes it to the anonymous-simpleType editor and the reducer patches its own `xs:simpleType`
    // object in place (at `attrPath` + 'xs:simpleType') instead of a named simpleType's flat fields.
    const addAttributeInlineSimpleTypeChild = (attributeEntry: any, attributeId: string, attrPath: Array<string | number>) => {
      const simpleTypeValue = (attributeEntry as any)?.['xs:simpleType'];
      if (!simpleTypeValue || typeof simpleTypeValue !== 'object') return;
      const inlineSimpleType = parseInlineSimpleType(simpleTypeValue);
      if (!inlineSimpleType) return;
      addNode({
        id: `${attributeId}.simpleType`,
        label: 'SimpleType',
        type: 'property',
        parent: attributeId,
        xmlNodeKind: 'simpleType',
        xmlIsAnonymous: true,
        xmlPath: [...attrPath, 'xs:simpleType'],
        xmlAttributeInlineSimpleType: attachUnionReferencedEnumerations(inlineSimpleType),
        ...getAnnotationField(simpleTypeValue),
      }, attributeId);
    };

    const XML_COMPOSITOR_TAG_KEYS = ['xs:sequence', 'xs:choice', 'xs:all'] as const;
    type XmlCompositorTagKey = typeof XML_COMPOSITOR_TAG_KEYS[number];

    const xmlEntryMayHaveChildren = (entry: any): boolean => {
      if (!entry || typeof entry !== 'object') return false;
      const attrs = getXmlAttrs(entry);
      if (attrs.type || attrs.ref) return true;
      if (entry['xs:simpleType'] || entry['xs:complexType'] || entry['xs:any']) return true;
      if (entry['xs:attribute'] || entry['xs:attributeGroup']) return true;
      if (XML_COMPOSITOR_TAG_KEYS.some((key) => entry[key] !== undefined)) return true;
      if (entry['xs:complexContent'] || entry['xs:simpleContent']) return true;
      return false;
    };

    // Strips a namespace prefix (e.g. "tns:TreeNode" -> "TreeNode") so element `type`
    // attributes can be matched against locally-declared complexType names.
    const localTypeName = (type: string) => (type.includes(':') ? type.split(':').pop()! : type);

    // Looks up whether an element's `type` attribute references a global complexType,
    // and whether that type has already been expanded once on this branch (circular reference).
    const resolveElementTypeExpansion = (elemAttrs: Record<string, unknown>, ancestors: Set<string>) => {
      const rawType = typeof elemAttrs.type === 'string' ? elemAttrs.type : undefined;
      const typeName = rawType ? localTypeName(rawType) : undefined;
      const referenced = typeName ? complexTypesByName.get(typeName) : undefined;
      return { referenced, typeName, circular: Boolean(referenced && typeName && ancestors.has(typeName)) };
    };

    // Looks up whether an element's `ref` attribute references a top-level global element
    // (`<xs:element ref="AUTOFORM"/>`), so its own content (inline complexType, or `type=`
    // complexType) can be expanded inline right under the referencing element node — real XSD
    // tools resolve `ref=` to the target element's full declaration. Uses an `element:`-prefixed
    // ancestor key (distinct from the plain complexType-name keys `resolveElementTypeExpansion`
    // uses) in the same shared `ancestors` set, so mutually-referencing elements (e.g. two
    // elements that `ref` each other) are expanded once each, then stopped/flagged instead of
    // recursing forever.
    const resolveElementRefExpansion = (elemAttrs: Record<string, unknown>, ancestors: Set<string>) => {
      const rawRef = typeof elemAttrs.ref === 'string' ? elemAttrs.ref : undefined;
      const refName = rawRef ? localTypeName(rawRef) : undefined;
      const referencedElement = refName ? elementsByName.get(refName) : undefined;
      const ancestorKey = refName ? `element:${refName}` : undefined;
      return {
        referencedElement,
        refName,
        ancestorKey,
        circular: Boolean(referencedElement && ancestorKey && ancestors.has(ancestorKey)),
      };
    };

    // Looks up whether an element has a `substitutionGroup` attribute that references a parent element,
    // so the child element can inherit the parent's structure (inline complexType, or `type=` complexType)
    // inline right under this substituting element's node. Similar to ref expansion but for substitution
    // groups. Uses an `element:`-prefixed ancestor key to guard against cycles.
    const resolveSubstitutionGroupExpansion = (elemAttrs: Record<string, unknown>, ancestors: Set<string>) => {
      const rawSubstitutionGroup = typeof elemAttrs.substitutionGroup === 'string' ? elemAttrs.substitutionGroup : undefined;
      const parentName = rawSubstitutionGroup ? localTypeName(rawSubstitutionGroup) : undefined;
      const parentElement = parentName ? elementsByName.get(parentName) : undefined;
      const ancestorKey = parentName ? `element:${parentName}` : undefined;
      return {
        parentElement,
        parentName,
        ancestorKey,
        circular: Boolean(parentElement && ancestorKey && ancestors.has(ancestorKey)),
      };
    };

    // Reads `xs:complexContent`/`xs:extension` (or `xs:restriction`) off a complexType value and
    // returns the local (namespace-stripped) name of its `base` type, if any.
    const getComplexContentBaseInfo = (complexTypeValue: any): { baseTypeName: string; derivationKey: 'xs:extension' | 'xs:restriction' } | undefined => {
      const complexContent = complexTypeValue?.['xs:complexContent'];
      if (!complexContent || typeof complexContent !== 'object') return undefined;
      const derivationKey = (['xs:extension', 'xs:restriction'] as const).find((key) => (complexContent as any)[key] !== undefined);
      const derivation = derivationKey ? (complexContent as any)[derivationKey] : undefined;
      if (!derivation || typeof derivation !== 'object') return undefined;
      const rawBase = getXmlAttrs(derivation).base;
      if (typeof rawBase !== 'string' || !rawBase) return undefined;
      return { baseTypeName: localTypeName(rawBase), derivationKey: derivationKey! };
    };

    // Reads `xs:simpleContent`/`xs:extension` (or `xs:restriction`) off a complexType value —
    // this is a complexType whose content is just text (of `base`, a simple type) plus attributes,
    // e.g. `<xs:complexType><xs:simpleContent><xs:extension base="xs:string"><xs:attribute .../>`.
    // `base` is returned raw (not namespace-stripped) since it's shown/edited the same way a plain
    // `xs:simpleType`'s `xmlBase` is (may be a built-in like "xs:string" or a named simple/complex type).
    const getSimpleContentBaseInfo = (complexTypeValue: any): { base: string; derivationKey: 'xs:extension' | 'xs:restriction'; derivation: any } | undefined => {
      const simpleContent = complexTypeValue?.['xs:simpleContent'];
      if (!simpleContent || typeof simpleContent !== 'object') return undefined;
      const derivationKey = (['xs:extension', 'xs:restriction'] as const).find((key) => (simpleContent as any)[key] !== undefined);
      const derivation = derivationKey ? (simpleContent as any)[derivationKey] : undefined;
      if (!derivation || typeof derivation !== 'object') return undefined;
      const rawBase = getXmlAttrs(derivation).base;
      if (typeof rawBase !== 'string' || !rawBase) return undefined;
      return { base: rawBase, derivationKey: derivationKey!, derivation };
    };

    // Adds an `element` node under `parentId`, recursing into any inline
    // (anonymous) complexType defined directly on the element (e.g. an
    // `xs:element` whose type is declared inline rather than referenced by name),
    // or, failing that, the global complexType named by the element's `type` attribute.
    // `ancestors` tracks complexType names already expanded on this branch so a type
    // that (directly or transitively) references itself is expanded once, then stopped
    // and flagged with an `isRef` badge instead of recursing forever.
    // `inheritedFrom`, when set, means this whole element was reached while expanding a
    // `complexContent`/`extension` base type — it's tagged onto the node so the graph can
    // later draw a background box grouping the owning node with its inherited descendants.
    const addXmlElementNode = (elemEntry: any, parentId: string, elementPath: Array<string | number>, index: number, ancestors: Set<string> = new Set(), inheritedFrom?: string, readOnlySource?: string) => {
      if (!elemEntry || typeof elemEntry !== 'object') return;
      const elemAttrs = getXmlAttrs(elemEntry);
      const elementId = `${parentId}.element_${index}`;
      const { referenced, typeName, circular } = resolveElementTypeExpansion(elemAttrs, ancestors);
      // `ref=`-only elements (no own `type`/inline complexType) resolve against the referenced
      // global element's own declaration instead — only attempted when this element doesn't
      // already have its own type/inline complexType to expand (real XSD disallows both anyway).
      const inlineComplexType = (elemEntry as any)['xs:complexType'];
      const ownElementAncestorKey = typeof elemAttrs.name === 'string' && elemAttrs.name
        ? `element:${elemAttrs.name}`
        : (typeof elemAttrs.ref === 'string' && elemAttrs.ref ? `element:${localTypeName(elemAttrs.ref)}` : undefined);
      const elementAncestors = ownElementAncestorKey ? new Set(ancestors).add(ownElementAncestorKey) : ancestors;
      // Checked against the plain `ancestors` (NOT `elementAncestors`) — `elementAncestors`
      // already contains this element's OWN key (added just above), so checking against it
      // would make every `ref=`-only element immediately flag itself as circular on its very
      // first resolution. `ancestors` only contains keys from actual ANCESTOR elements/types,
      // which is what a true cycle (this ref eventually referencing itself again) requires.
      const refExpansion = (!inlineComplexType && !referenced)
        ? resolveElementRefExpansion(elemAttrs, ancestors)
        : { referencedElement: undefined, refName: undefined, ancestorKey: undefined, circular: false };
      // Check for substitution group parent
      const substitutionGroupExpansion = (!inlineComplexType && !referenced && !refExpansion.referencedElement)
        ? resolveSubstitutionGroupExpansion(elemAttrs, ancestors)
        : { parentElement: undefined, parentName: undefined, ancestorKey: undefined, circular: false };
      const effectiveCircular = circular || refExpansion.circular || substitutionGroupExpansion.circular;
      const inlineComplexTypeAttrs = inlineComplexType && typeof inlineComplexType === 'object' ? getXmlAttrs(inlineComplexType) : {};
      const inlineComplexAnyAttribute = inlineComplexType && typeof inlineComplexType === 'object'
        ? getXmlAttrs((inlineComplexType as any)['xs:anyAttribute'])
        : undefined;
      const ownBaseInfo = inlineComplexType && typeof inlineComplexType === 'object' ? getComplexContentBaseInfo(inlineComplexType) : undefined;
      const ownSimpleContentInfo = inlineComplexType && typeof inlineComplexType === 'object' ? getSimpleContentBaseInfo(inlineComplexType) : undefined;
      const elementAttributeSourceValue = inlineComplexType && typeof inlineComplexType === 'object'
        ? (
          ownSimpleContentInfo
            ? (ownSimpleContentInfo.derivation as any)['xs:attribute']
            : (ownBaseInfo
              ? (((inlineComplexType as any)['xs:complexContent']?.[ownBaseInfo.derivationKey]) as any)?.['xs:attribute']
              : (inlineComplexType as any)['xs:attribute'])
        )
        : undefined;
      const elementAttributes = asArray(elementAttributeSourceValue).map((attrEntry: any) => {
        const attrAttrs = getXmlAttrs(attrEntry);
        return { name: attrAttrs.name, type: attrAttrs.type, use: attrAttrs.use || 'optional' };
      });
      const elementHasChildren = buildVisibleOnly && parentId === '1' && (
        inlineComplexType ||
        referenced ||
        refExpansion.referencedElement ||
        substitutionGroupExpansion.parentElement ||
        Boolean((elemEntry as any)['xs:simpleType']) ||
        Boolean((elemEntry as any)['xs:any']) ||
        XML_COMPOSITOR_TAG_KEYS.some((key) => (elemEntry as any)[key] !== undefined)
      );

      addNode({
        id: elementId,
        label: toNodeLabel('element', elemAttrs, (elemAttrs.name as string) || (elemAttrs.ref as string) || `${index + 1}`),
        type: 'property',
        parent: parentId,
        xmlNodeKind: 'element',
        xmlPath: elementPath,
        // A `ref`-only element (e.g. `<xs:element ref="Enum"/>`) has no `name` attribute at
        // all — fall back to `ref` so the RHS Name field isn't blank, matching the graph label.
        xmlName: (elemAttrs.name as string) || (elemAttrs.ref as string),
        xmlElementType: elemAttrs.type,
        xmlMinOccurs: elemAttrs.minOccurs ?? '1',
        xmlMaxOccurs: elemAttrs.maxOccurs ?? '1',
        ...(inlineComplexType && typeof inlineComplexType === 'object' ? { xmlAttributes: elementAttributes } : {}),
        xmlAvailableTypes: availableTypes,
        xmlMyTypeNames: namedElementTypeNames,
        xmlMyComplexTypeNames: namedComplexTypeNames,
        xmlMyElementNames: namedGlobalElementNames,
        xmlIsRef: Boolean(elemAttrs.ref),
        // Inline `xs:complexType` (no `type` attribute) — the RHS Type field has nothing to show
        // via `xmlElementType`, so flag it to display "complexType - <name>" (or "- Anon" when the
        // inline complexType itself has no `name`) instead of blank/(none).
        ...(inlineComplexType && typeof inlineComplexType === 'object' ? {
          xmlHasInlineComplexType: true,
          xmlInlineComplexTypeName: getXmlAttrs(inlineComplexType).name,
          xmlMixed: inlineComplexTypeAttrs.mixed === 'true',
          ...(inlineComplexAnyAttribute ? { xmlAnyAttribute: inlineComplexAnyAttribute } : {}),
        } : {}),
        ...getAnnotationField(elemEntry),
        ...(effectiveCircular ? { isRef: true } : {}),
        // A `ref=` element whose target resolves to a real (non-circular) global element can
        // have its content expanded inline (see the `refExpansion.referencedElement` branch
        // below) — flag it so the graph shows an expand/collapse toggle for it, at any nesting
        // depth (unlike normal elements, a ref's own fields stay read-only; only its expanded
        // children do too, via `xmlReadOnlySource` threaded through that branch).
        ...(refExpansion.referencedElement && !refExpansion.circular ? { xmlHasRefExpansion: true } : {}),
        // A substitution group element whose parent resolves to a real (non-circular) global element
        // can have its content expanded inline — tag it so the graph shows an expand/collapse toggle.
        ...(substitutionGroupExpansion.parentElement && !substitutionGroupExpansion.circular ? { xmlHasSubstitutionExpansion: true, xmlSubstitutionGroupParent: substitutionGroupExpansion.parentName } : {}),
        ...(readOnlySource ? { xmlReadOnlySource: readOnlySource } : {}),
        ...(inheritedFrom ? { xmlInheritedFrom: inheritedFrom } : {}),
        ...(ownBaseInfo ? { xmlExtendsType: ownBaseInfo.baseTypeName } : {}),
        // A `simpleContent` complexType is a simple type (text + attributes) under the hood, so
        // tag it with the same `xmlSimpleTypeMode`/`xmlBase` fields a real `xs:simpleType` uses.
        ...(ownSimpleContentInfo ? { xmlSimpleTypeMode: ownSimpleContentInfo.derivationKey === 'xs:extension' ? 'extension' : 'restriction', xmlBase: ownSimpleContentInfo.base } : {}),
      }, parentId, elementHasChildren);

      if (buildVisibleOnly && parentId === '1') {
        return;
      }

      if (inlineComplexType && typeof inlineComplexType === 'object') {
        addInlineComplexTypeChildren(inlineComplexType, elementId, [...elementPath, 'xs:complexType'], elementAncestors, '', inheritedFrom);
      } else if (referenced && typeName && !circular) {
        addInlineComplexTypeChildren(referenced.entry, elementId, ['xs:schema', 'xs:complexType', referenced.index], new Set(elementAncestors).add(typeName), '', inheritedFrom);
      } else if (refExpansion.referencedElement && refExpansion.ancestorKey && !refExpansion.circular) {
        // Expand the referenced top-level global element's own content (inline complexType, or
        // its own `type=` complexType) inline right under this referencing element's node.
        // Its content belongs to the shared global element definition, not this ref instance,
        // so it's always tagged read-only (`elementId` doubles as the `xmlReadOnlySource` value).
        const targetEntry = refExpansion.referencedElement.entry;
        const targetAttrs = getXmlAttrs(targetEntry);
        const targetInlineComplexType = (targetEntry as any)['xs:complexType'];
        const nextAncestors = new Set(elementAncestors).add(refExpansion.ancestorKey);
        if (targetInlineComplexType && typeof targetInlineComplexType === 'object') {
          addInlineComplexTypeChildren(targetInlineComplexType, elementId, ['xs:schema', 'xs:element', refExpansion.referencedElement.index, 'xs:complexType'], nextAncestors, '', inheritedFrom, elementId);
        } else {
          const targetTypeExpansion = resolveElementTypeExpansion(targetAttrs, nextAncestors);
          if (targetTypeExpansion.referenced && targetTypeExpansion.typeName && !targetTypeExpansion.circular) {
            addInlineComplexTypeChildren(targetTypeExpansion.referenced.entry, elementId, ['xs:schema', 'xs:complexType', targetTypeExpansion.referenced.index], new Set(nextAncestors).add(targetTypeExpansion.typeName), '', inheritedFrom, elementId);
          }
        }
      } else if (substitutionGroupExpansion.parentElement && substitutionGroupExpansion.ancestorKey && !substitutionGroupExpansion.circular) {
        // Expand the parent element's structure inline under this substituting element's node.
        // This is similar to ref expansion: inherit the parent's complexType and mark as read-only.
        const parentEntry = substitutionGroupExpansion.parentElement.entry;
        const parentAttrs = getXmlAttrs(parentEntry);
        const parentInlineComplexType = (parentEntry as any)['xs:complexType'];
        const nextAncestors = new Set(elementAncestors).add(substitutionGroupExpansion.ancestorKey);
        if (parentInlineComplexType && typeof parentInlineComplexType === 'object') {
          addInlineComplexTypeChildren(parentInlineComplexType, elementId, ['xs:schema', 'xs:element', substitutionGroupExpansion.parentElement.index, 'xs:complexType'], nextAncestors, '', substitutionGroupExpansion.parentName, elementId);
        } else {
          const parentTypeExpansion = resolveElementTypeExpansion(parentAttrs, nextAncestors);
          if (parentTypeExpansion.referenced && parentTypeExpansion.typeName && !parentTypeExpansion.circular) {
            addInlineComplexTypeChildren(parentTypeExpansion.referenced.entry, elementId, ['xs:schema', 'xs:complexType', parentTypeExpansion.referenced.index], new Set(nextAncestors).add(parentTypeExpansion.typeName), '', substitutionGroupExpansion.parentName, elementId);
          }
        }
      }
    };

    // Adds every attribute declared on a top-level `xs:attributeGroup name="..."` (looked up by
    // `groupName` via `attributeGroupsByName`, populated later in this closure) as `attribute`
    // nodes directly under `parentId`. Each attribute is tagged `isRef: true` plus
    // `xmlAttributeGroupRef: groupName` so it renders the shared `isRef` badge and is treated as
    // read-only in the RHS editor (it belongs to the shared group definition, not the local type).
    // `ancestors` (shared with the complexType/element expansion ancestor set, using an
    // `attributeGroup:`-prefixed key so it can't collide with a complexType/element name) guards
    // against a group that (directly or transitively) references itself.
    const addAttributeGroupAttributes = (groupName: string, parentId: string, ancestors: Set<string> = new Set(), idSuffix: string = '', inheritedFrom?: string) => {
      if (buildVisibleOnly && parentId !== '1') return;
      const group = attributeGroupsByName.get(groupName);
      const ancestorKey = `attributeGroup:${groupName}`;
      if (!group || ancestors.has(ancestorKey)) return;
      const nextAncestors = new Set(ancestors).add(ancestorKey);

      const attributeValue = (group.entry as any)['xs:attribute'];
      asArray(attributeValue).forEach((attributeEntry: any, attributeIndex: number) => {
        if (!attributeEntry || typeof attributeEntry !== 'object') return;
        const attributeAttrs = getXmlAttrs(attributeEntry);
        const attrPath = Array.isArray(attributeValue)
          ? ['xs:schema', 'xs:attributeGroup', group.index, 'xs:attribute', attributeIndex]
          : ['xs:schema', 'xs:attributeGroup', group.index, 'xs:attribute'];
        const attributeId = `${parentId}${idSuffix}.attributeGroupRef_${groupName}_${attributeIndex}`;
        const hasInlineSimpleType = Boolean((attributeEntry as any)['xs:simpleType']);
        addNode({
          id: attributeId,
          label: toNodeLabel('attribute', attributeAttrs, `${attributeIndex + 1}`),
          type: 'property',
          parent: parentId,
          xmlNodeKind: 'attribute',
          xmlPath: attrPath,
          xmlName: attributeAttrs.name,
          xmlAttributeType: attributeAttrs.type,
          xmlAttributeUse: attributeAttrs.use || 'optional',
          required: (attributeAttrs.use || 'optional') === 'required',
          isRef: true,
          xmlAttributeGroupRef: groupName,
          ...(attributeAttrs.default !== undefined ? { xmlAttributeDefault: attributeAttrs.default } : {}),
          ...(hasInlineSimpleType ? { xmlHasInlineSimpleType: true } : {}),
          ...(inheritedFrom ? { xmlInheritedFrom: inheritedFrom } : {}),
          ...referencedEnumFields(attributeAttrs.type),
          ...getAnnotationField(attributeEntry),
          xmlMyTypeNames: namedSimpleTypeNames,
        }, parentId);
        addAttributeInlineSimpleTypeChild(attributeEntry, attributeId, attrPath);
      });

      // An attributeGroup may itself reference other attributeGroups — expand those too.
      asArray((group.entry as any)['xs:attributeGroup']).forEach((nestedEntry: any) => {
        if (!nestedEntry || typeof nestedEntry !== 'object') return;
        const nestedAttrs = getXmlAttrs(nestedEntry);
        if (typeof nestedAttrs.ref === 'string' && nestedAttrs.ref) {
          addAttributeGroupAttributes(localTypeName(nestedAttrs.ref), parentId, nextAncestors, idSuffix, inheritedFrom);
        }
      });
    };

    // Adds the attribute and compositor children found on an inline (anonymous)
    // complexType, e.g. `<xs:element><xs:complexType>...</xs:complexType></xs:element>`,
    // or a named complexType being expanded inline under an element that references it by type.
    // `idSuffix` disambiguates node ids when this function is invoked more than once for the
    // same `parentId` (currently only happens for `xs:complexContent`/`xs:extension`, where the
    // base type's own children and the extension's own children are both merged in under the
    // same parent), so base-type ids don't collide with the extension's own attribute/compositor ids.
    // `inheritedFrom`, when set, tags every node created here as having come from an ancestor
    // base type (propagated down from an enclosing complexContent expansion); the base type's own
    // recursive call additionally sets/overrides it to that base type's name.
    const addInlineComplexTypeChildren = (complexTypeValue: any, parentId: string, basePath: Array<string | number>, ancestors: Set<string> = new Set(), idSuffix: string = '', inheritedFrom?: string, readOnlySource?: string) => {
      if (!complexTypeValue || typeof complexTypeValue !== 'object') return;
      if (buildVisibleOnly && parentId !== '1') return;

      // `xs:complexContent` replaces the direct content model with `xs:extension`/`xs:restriction`
      // of a `base` type: expand the base type's own children first (inherited), then merge in
      // the attributes/compositor declared directly on the extension/restriction itself.
      const baseInfo = getComplexContentBaseInfo(complexTypeValue);
      if (baseInfo) {
        const { baseTypeName, derivationKey } = baseInfo;
        const derivation = (complexTypeValue as any)['xs:complexContent'][derivationKey];
        const baseType = complexTypesByName.get(baseTypeName);
        if (baseType && !ancestors.has(baseTypeName)) {
          // Preserve inheritedFrom through base type expansion (e.g. for substitution groups)
          // so all attributes in the chain get marked with the same inheritance source.
          addInlineComplexTypeChildren(baseType.entry, parentId, ['xs:schema', 'xs:complexType', baseType.index], new Set(ancestors).add(baseTypeName), `${idSuffix}.base`, inheritedFrom || baseTypeName, readOnlySource);
        }
        addInlineComplexTypeChildren(derivation, parentId, [...basePath, 'xs:complexContent', derivationKey], ancestors, idSuffix, inheritedFrom, readOnlySource);
        return;
      }

      // `xs:simpleContent` means the content is just text (of `base`) plus whatever attributes
      // are declared on the extension/restriction — there's no compositor content and no direct
      // `xs:attribute` on `complexTypeValue` itself, so exit early after adding those attributes
      // (this complexType behaves like a simpleType under the hood; the owning node is tagged
      // with `xmlSimpleTypeMode`/`xmlBase` by the caller).
      const simpleContentInfo = getSimpleContentBaseInfo(complexTypeValue);
      if (simpleContentInfo) {
        const { base, derivationKey: simpleDerivationKey, derivation: simpleDerivation } = simpleContentInfo;
        // The base may itself be a locally-declared complexType with its OWN simpleContent
        // (attribute chaining) — merge its attributes in first (inherited), then this
        // derivation's own attributes, same pattern as the complexContent base-merge above.
        const baseLocalName = localTypeName(base);
        const baseType = complexTypesByName.get(baseLocalName);
        if (baseType && !ancestors.has(baseLocalName) && getSimpleContentBaseInfo(baseType.entry)) {
          // Preserve inheritedFrom through base type expansion (e.g. for substitution groups)
          addInlineComplexTypeChildren(baseType.entry, parentId, ['xs:schema', 'xs:complexType', baseType.index], new Set(ancestors).add(baseLocalName), `${idSuffix}.base`, inheritedFrom || baseLocalName, readOnlySource);
        }
        const derivationAttrValue = (simpleDerivation as any)['xs:attribute'];
        asArray(derivationAttrValue).forEach((attributeEntry: any, attributeIndex: number) => {
          if (!attributeEntry || typeof attributeEntry !== 'object') return;
          const attributeAttrs = getXmlAttrs(attributeEntry);
          const attrPath = Array.isArray(derivationAttrValue)
            ? [...basePath, 'xs:simpleContent', simpleDerivationKey, 'xs:attribute', attributeIndex]
            : [...basePath, 'xs:simpleContent', simpleDerivationKey, 'xs:attribute'];
          const attributeId = `${parentId}${idSuffix}.attribute_${attributeIndex}`;
          const hasInlineSimpleType = Boolean((attributeEntry as any)['xs:simpleType']);
          addNode({
            id: attributeId,
            label: toNodeLabel('attribute', attributeAttrs, `${attributeIndex + 1}`),
            type: 'property',
            parent: parentId,
            xmlNodeKind: 'attribute',
            xmlPath: attrPath,
            xmlName: attributeAttrs.name,
            xmlAttributeType: attributeAttrs.type,
            xmlAttributeUse: attributeAttrs.use || 'optional',
            required: (attributeAttrs.use || 'optional') === 'required',
            ...(attributeAttrs.default !== undefined ? { xmlAttributeDefault: attributeAttrs.default } : {}),
            ...(hasInlineSimpleType ? { xmlHasInlineSimpleType: true } : {}),
            ...(inheritedFrom ? { xmlInheritedFrom: inheritedFrom } : {}),
            ...(readOnlySource ? { xmlReadOnlySource: readOnlySource } : {}),
            ...referencedEnumFields(attributeAttrs.type),
            ...getAnnotationField(attributeEntry),
            xmlMyTypeNames: namedSimpleTypeNames,
          }, parentId);
          addAttributeInlineSimpleTypeChild(attributeEntry, attributeId, attrPath);
        });
        asArray((simpleDerivation as any)['xs:attributeGroup']).forEach((agEntry: any) => {
          if (!agEntry || typeof agEntry !== 'object') return;
          const agAttrs = getXmlAttrs(agEntry);
          if (typeof agAttrs.ref === 'string' && agAttrs.ref) {
            addAttributeGroupAttributes(localTypeName(agAttrs.ref), parentId, ancestors, idSuffix, inheritedFrom);
          }
        });
        return;
      }

      const attributeValue = (complexTypeValue as any)['xs:attribute'];
      asArray(attributeValue).forEach((attributeEntry, attributeIndex) => {
        if (!attributeEntry || typeof attributeEntry !== 'object') return;
        const attributeAttrs = getXmlAttrs(attributeEntry);
        const attrPath = Array.isArray(attributeValue)
          ? [...basePath, 'xs:attribute', attributeIndex]
          : [...basePath, 'xs:attribute'];
        const attributeId = `${parentId}${idSuffix}.attribute_${attributeIndex}`;
        const hasInlineSimpleType = Boolean((attributeEntry as any)['xs:simpleType']);
        addNode({
          id: attributeId,
          label: toNodeLabel('attribute', attributeAttrs, `${attributeIndex + 1}`),
          type: 'property',
          parent: parentId,
          xmlNodeKind: 'attribute',
          xmlPath: attrPath,
          xmlName: attributeAttrs.name,
          xmlAttributeType: attributeAttrs.type,
          xmlAttributeUse: attributeAttrs.use || 'optional',
          required: (attributeAttrs.use || 'optional') === 'required',
          ...(attributeAttrs.default !== undefined ? { xmlAttributeDefault: attributeAttrs.default } : {}),
          ...(hasInlineSimpleType ? { xmlHasInlineSimpleType: true } : {}),
          ...(inheritedFrom ? { xmlInheritedFrom: inheritedFrom } : {}),
          ...(readOnlySource ? { xmlReadOnlySource: readOnlySource } : {}),
          ...referencedEnumFields(attributeAttrs.type),
          ...getAnnotationField(attributeEntry),
          xmlMyTypeNames: namedSimpleTypeNames,
        }, parentId);
        addAttributeInlineSimpleTypeChild(attributeEntry, attributeId, attrPath);
      });

      // `xs:attributeGroup ref="..."` pulls in a shared group of attribute declarations —
      // expand those into read-only (isRef) attribute nodes right alongside this type's own.
      asArray((complexTypeValue as any)['xs:attributeGroup']).forEach((agEntry: any) => {
        if (!agEntry || typeof agEntry !== 'object') return;
        const agAttrs = getXmlAttrs(agEntry);
        if (typeof agAttrs.ref === 'string' && agAttrs.ref) {
          addAttributeGroupAttributes(localTypeName(agAttrs.ref), parentId, ancestors, idSuffix, inheritedFrom);
        }
      });

      XML_COMPOSITOR_TAG_KEYS.forEach((compositorKey) => {
        const compositorValue = (complexTypeValue as any)[compositorKey];
        if (compositorValue !== undefined && compositorValue !== null) {
          addCompositorNode(compositorValue, parentId, [...basePath, compositorKey], compositorKey, undefined, ancestors, idSuffix, inheritedFrom, readOnlySource);
        }
      });
    };

    // Adds a read-only `xs:any` wildcard-content node under `parentId` — this represents
    // "any element from this namespace is allowed here" (e.g. embedded (X)HTML markup), so
    // unlike `xs:element` there's no name/type to resolve, just the wildcard's own attributes.
    const addAnyNode = (anyEntry: any, parentId: string, anyPath: Array<string | number>, index: number, inheritedFrom?: string, readOnlySource?: string) => {
      if (!anyEntry || typeof anyEntry !== 'object') return;
      const anyAttrs = getXmlAttrs(anyEntry);
      const anyId = `${parentId}.any_${index}`;
      addNode({
        id: anyId,
        label: 'xs:any',
        type: 'property',
        parent: parentId,
        xmlNodeKind: 'any',
        xmlPath: anyPath,
        xmlAnyNamespace: anyAttrs.namespace,
        xmlAnyProcessContents: anyAttrs.processContents,
        xmlMinOccurs: anyAttrs.minOccurs ?? '1',
        xmlMaxOccurs: anyAttrs.maxOccurs ?? '1',
        ...(inheritedFrom ? { xmlInheritedFrom: inheritedFrom } : {}),
        ...(readOnlySource ? { xmlReadOnlySource: readOnlySource } : {}),
        ...getAnnotationField(anyEntry),
      }, parentId);
    };

    // Adds a compositor node (sequence/choice/all) under `parentId` and recurses
    // into its own element / nested-compositor children so deeply-nested
    // content (e.g. a sequence nested inside a choice) renders correctly.
    const addCompositorNode = (
      compositorValue: any,
      parentId: string,
      path: Array<string | number>,
      compositorKey: XmlCompositorTagKey,
      suffixIndex?: number,
      ancestors: Set<string> = new Set(),
      idSuffix: string = '',
      inheritedFrom?: string,
      readOnlySource?: string,
    ) => {
      if (buildVisibleOnly && parentId !== '1') return;
      if (compositorValue === undefined || compositorValue === null) return;
      const first = Array.isArray(compositorValue) ? compositorValue[0] : compositorValue;
      if (!first || typeof first !== 'object') return;
      const compositorAttrs = getXmlAttrs(first);
      const compositorKind = compositorKey.replace('xs:', '') as 'sequence' | 'choice' | 'all';
      const compositorId = `${parentId}${idSuffix}.${compositorKind}${suffixIndex !== undefined ? `_${suffixIndex}` : ''}`;
      addNode({
        id: compositorId,
        label: compositorKey,
        type: 'property',
        parent: parentId,
        xmlNodeKind: compositorKind,
        xmlPath: path,
        xmlMinOccurs: compositorAttrs.minOccurs ?? '1',
        xmlMaxOccurs: compositorAttrs.maxOccurs ?? '1',
        ...(inheritedFrom ? { xmlInheritedFrom: inheritedFrom } : {}),
        ...(readOnlySource ? { xmlReadOnlySource: readOnlySource } : {}),
        ...getAnnotationField(first),
      }, parentId);

      addCompositorChildren(compositorValue, compositorId, path, ancestors, inheritedFrom, readOnlySource);
    };

    // Processes the children living under a compositor's raw value (or a
    // top-level complexType's compositor). Supports both the flat-array
    // convention used by this editor's own context-menu "Add element"/"Add
    // sequence|choice|all" actions, and the tag-keyed shape produced by
    // parsing real XSD documents (e.g. `{ 'xs:sequence': {...}, 'xs:element': {...} }`).
    const addCompositorChildren = (containerValue: any, parentId: string, basePath: Array<string | number>, ancestors: Set<string> = new Set(), inheritedFrom?: string, readOnlySource?: string) => {
      if (!containerValue || typeof containerValue !== 'object') return;

      if (Array.isArray(containerValue)) {
        containerValue.forEach((item, itemIndex) => {
          if (!item || typeof item !== 'object') return;
          const itemPath = [...basePath, itemIndex];
          const nestedCompositorKey = XML_COMPOSITOR_TAG_KEYS.find((key) => (item as any)[key] !== undefined);
          if (nestedCompositorKey) {
            addCompositorNode((item as any)[nestedCompositorKey], parentId, [...itemPath, nestedCompositorKey], nestedCompositorKey, undefined, ancestors, '', inheritedFrom, readOnlySource);
            return;
          }
          const itemAttrs = getXmlAttrs(item);
          if (itemAttrs.name || itemAttrs.ref) {
            addXmlElementNode(item, parentId, itemPath, itemIndex, ancestors, inheritedFrom, readOnlySource);
          }
        });
        return;
      }

      // Object shape (real XSD-parsed documents): child particles are keyed by tag name.
      const elementValue = (containerValue as any)['xs:element'];
      if (elementValue !== undefined && elementValue !== null) {
        asArray(elementValue).forEach((elemEntry, elemIndex) => {
          const elementPath = Array.isArray(elementValue)
            ? [...basePath, 'xs:element', elemIndex]
            : [...basePath, 'xs:element'];
          addXmlElementNode(elemEntry, parentId, elementPath, elemIndex, ancestors, inheritedFrom, readOnlySource);
        });
      }

      // `xs:any` wildcard content particle (e.g. embedded (X)HTML markup) — read-only, no
      // name/type to resolve, just its own namespace/processContents/occurs attributes.
      const anyValue = (containerValue as any)['xs:any'];
      if (anyValue !== undefined && anyValue !== null) {
        asArray(anyValue).forEach((anyEntry, anyIndex) => {
          const anyPath = Array.isArray(anyValue)
            ? [...basePath, 'xs:any', anyIndex]
            : [...basePath, 'xs:any'];
          addAnyNode(anyEntry, parentId, anyPath, anyIndex, inheritedFrom, readOnlySource);
        });
      }

      XML_COMPOSITOR_TAG_KEYS.forEach((nestedKey) => {
        const nestedValue = (containerValue as any)[nestedKey];
        if (nestedValue !== undefined && nestedValue !== null) {
          addCompositorNode(nestedValue, parentId, [...basePath, nestedKey], nestedKey, undefined, ancestors, '', inheritedFrom, readOnlySource);
        }
      });
    };

    // Extract all schema attributes generically
    const xmlSchemaNodeData: any = {
      id: '1',
      label: 'xs:schema',
      type: 'root',
      xmlNodeKind: 'schema',
      xmlPath: ['xs:schema'],
    };

    // Map XML attributes to xml* prefixed node data properties
    const attrXmlMap: Record<string, string> = {
      targetNamespace: 'xmlTargetNamespace',
      elementFormDefault: 'xmlElementFormDefault',
      attributeFormDefault: 'xmlAttributeFormDefault',
      blockDefault: 'xmlBlockDefault',
      finalDefault: 'xmlFinalDefault',
      version: 'xmlVersion',
      id: 'xmlId',
    };

    Object.entries(attrXmlMap).forEach(([attrKey, xmlKey]) => {
      const attrValue = schemaAttrs[attrKey];
      if (attrValue) {
        xmlSchemaNodeData[xmlKey] = attrValue;
      }
    });

    const schemaAnnotations = getXmlAnnotationDocs(schemaRoot);
    if (schemaAnnotations.length > 0) {
      xmlSchemaNodeData.xmlAnnotations = schemaAnnotations;
    }

    // Extract xs:import declarations (namespace and schemaLocation pairs)
    const importElements = asArray((schemaRoot as any)?.['xs:import']);
    if (importElements.length > 0) {
      xmlSchemaNodeData.xmlImports = importElements
        .map((importElem: any) => {
          const importAttrs = getXmlAttrs(importElem);
          return {
            namespace: importAttrs.namespace || '',
            schemaLocation: importAttrs.schemaLocation || '',
          };
        })
        .filter((imp: any) => imp.namespace || imp.schemaLocation);
    }

    // Extract custom xmlns:* namespace declarations
    const customNamespaces: Array<{ prefix: string; uri: string }> = [];
    Object.entries(schemaAttrs).forEach(([key, value]) => {
      if (typeof key === 'string' && key.startsWith('xmlns:') && typeof value === 'string') {
        const prefix = key.substring(6); // Remove 'xmlns:' prefix
        customNamespaces.push({ prefix, uri: value });
      }
    });
    if (customNamespaces.length > 0) {
      xmlSchemaNodeData.xmlnsNamespaces = customNamespaces;
    }

    addNode(xmlSchemaNodeData);

    const simpleTypes = asArray((schemaRoot as any)?.['xs:simpleType']);
    const complexTypes = asArray((schemaRoot as any)?.['xs:complexType']);
    const elements = asArray((schemaRoot as any)?.['xs:element']);
    const attributeGroups = asArray((schemaRoot as any)?.['xs:attributeGroup']);
    const attributes = asArray((schemaRoot as any)?.['xs:attribute']);

    // Name -> definition/index lookup so element `type` attributes can be resolved and
    // expanded inline (with circular-reference protection via resolveElementTypeExpansion).
    const complexTypesByName = new Map<string, { entry: any; index: number }>();
    complexTypes.forEach((ct: any, idx: number) => {
      if (!ct || typeof ct !== 'object') return;
      const ctAttrs = getXmlAttrs(ct);
      if (typeof ctAttrs.name === 'string' && ctAttrs.name) complexTypesByName.set(ctAttrs.name, { entry: ct, index: idx });
    });

    // Name -> definition/index lookup so `xs:attributeGroup ref="..."` can be resolved
    // and its attributes expanded inline (see `addAttributeGroupAttributes` above).
    const attributeGroupsByName = new Map<string, { entry: any; index: number }>();
    attributeGroups.forEach((ag: any, idx: number) => {
      if (!ag || typeof ag !== 'object') return;
      const agAttrs = getXmlAttrs(ag);
      if (typeof agAttrs.name === 'string' && agAttrs.name) attributeGroupsByName.set(agAttrs.name, { entry: ag, index: idx });
    });

    // Name -> definition/index lookup so `xs:element ref="..."` can be resolved and that
    // top-level global element's own content (inline complexType, or `type=` complexType)
    // expanded inline right under the referencing element node — see `addXmlElementNode`'s
    // ref-expansion branch below. Guarded against cycles via an `element:`-prefixed key in
    // the same shared `ancestors` set used for `type=` complexType expansion.
    const elementsByName = new Map<string, { entry: any; index: number }>();
    elements.forEach((el: any, idx: number) => {
      if (!el || typeof el !== 'object') return;
      const elAttrs = getXmlAttrs(el);
      if (typeof elAttrs.name === 'string' && elAttrs.name) elementsByName.set(elAttrs.name, { entry: el, index: idx });
    });

    // Maps for substitution group support: tracks which elements substitute for which parent elements.
    // `substitutionGroupsByName` maps parent element name → array of {entry, index, name} for all substitutes.
    // `elementParentGroupMap` maps substituting element name → parent element name (direct lookup for a single child).
    const substitutionGroupsByName = new Map<string, Array<{ entry: any; index: number; name: string }>>();
    const elementParentGroupMap = new Map<string, string>();
    elements.forEach((el: any, idx: number) => {
      if (!el || typeof el !== 'object') return;
      const elAttrs = getXmlAttrs(el);
      const substitutionGroup = typeof elAttrs.substitutionGroup === 'string' ? elAttrs.substitutionGroup : undefined;
      if (!substitutionGroup) return;
      const parentName = localTypeName(substitutionGroup);
      const childName = elAttrs.name;
      if (typeof childName !== 'string' || !childName) return;
      // Track this element as a substitute for the parent
      if (!substitutionGroupsByName.has(parentName)) {
        substitutionGroupsByName.set(parentName, []);
      }
      substitutionGroupsByName.get(parentName)!.push({ entry: el, index: idx, name: childName });
      elementParentGroupMap.set(childName, parentName);
    });

    // Name -> enumeration values, so an `xs:attribute type="X"` referencing a named simpleType
    // by name (rather than declaring its own inline simpleType) can show that type's enumeration
    // values read-only in the RHS attribute editor (see `xmlAttributeReferencedEnumerations` below).
    const simpleTypesByName = new Map<string, { enumerations: string[] }>();
    simpleTypes.forEach((st: any) => {
      if (!st || typeof st !== 'object') return;
      const stAttrs = getXmlAttrs(st);
      if (typeof stAttrs.name !== 'string' || !stAttrs.name) return;
      const restriction = (st as any)['xs:restriction'];
      if (!restriction || typeof restriction !== 'object') return;
      const enumerations = asArray((restriction as any)['xs:enumeration'])
        .map((enumEntry: any) => getXmlAttrs(enumEntry).value)
        .filter((value): value is string => typeof value === 'string');
      if (enumerations.length > 0) simpleTypesByName.set(stAttrs.name, { enumerations });
    });

    // Looks up `type` (namespace-stripped) against `simpleTypesByName`; returns the extra node-data
    // fields to spread onto an attribute node, or `{}` when `type` isn't a named enum simpleType.
    const referencedEnumFields = (type: unknown) => {
      if (typeof type !== 'string' || !type) return {};
      const referenced = simpleTypesByName.get(localTypeName(type));
      if (!referenced) return {};
      return { xmlAttributeReferencedEnumerations: referenced.enumerations, xmlAttributeReferencedTypeName: localTypeName(type) };
    };

    // Splits an `xs:union`'s `memberTypes` attribute (space-separated QNames, e.g.
    // "xs:string frame-target") and resolves each token against `simpleTypesByName`,
    // merging any matches' enumeration values into one flat read-only list for display.
    const resolveUnionReferencedEnumerations = (memberTypes: unknown): string[] => {
      if (typeof memberTypes !== 'string' || !memberTypes.trim()) return [];
      const values: string[] = [];
      memberTypes.trim().split(/\s+/).forEach((token) => {
        const referenced = simpleTypesByName.get(localTypeName(token));
        if (referenced) values.push(...referenced.enumerations);
      });
      return values;
    };

    // Recursively attaches `unionReferencedEnumerations` onto every `union`-mode node in an
    // (already-parsed) `InlineSimpleTypeData` tree, so nested anonymous union members (which
    // can themselves reference named enum simpleTypes via their own `memberTypes`) show their
    // resolved enums too, not just the outermost union.
    const attachUnionReferencedEnumerations = (data: InlineSimpleTypeData): InlineSimpleTypeData => {
      if (data.mode === 'union') {
        return {
          ...data,
          unionReferencedEnumerations: resolveUnionReferencedEnumerations(data.memberTypes),
          memberSimpleTypes: (data.memberSimpleTypes || []).map(attachUnionReferencedEnumerations),
        };
      }
      if (data.mode === 'list' && data.itemSimpleType) {
        return { ...data, itemSimpleType: attachUnionReferencedEnumerations(data.itemSimpleType) };
      }
      return data;
    };

    // Names of every top-level named `xs:simpleType`/`xs:complexType`, so the RHS "Type" dropdown
    // (`XmlTypeSelector` in xml-rhs-editors.tsx) can offer them under a "My Types" group alongside
    // the built-in XSD simple types. Attributes may only be a simpleType; elements may be either.
    const namedSimpleTypeNames = simpleTypes
      .map((st: any) => (st && typeof st === 'object' ? getXmlAttrs(st).name : undefined))
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
      .sort((a, b) => a.localeCompare(b));
    const namedComplexTypeNames = complexTypes
      .map((ct: any) => (ct && typeof ct === 'object' ? getXmlAttrs(ct).name : undefined))
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
      .sort((a, b) => a.localeCompare(b));
    const namedElementTypeNames = [...namedSimpleTypeNames, ...namedComplexTypeNames].sort((a, b) => a.localeCompare(b));

    // Names of every top-level named `xs:element`, so a `ref="..."` element's RHS dropdown
    // (repurposing `XmlTypeSelector`) can offer valid ref targets instead of a freeform text box.
    const namedGlobalElementNames = elements
      .map((el: any) => (el && typeof el === 'object' ? getXmlAttrs(el).name : undefined))
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
      .sort((a, b) => a.localeCompare(b));

    // Available types for the attribute type dropdown: built-in XSD types + user-defined named simple types
    const availableTypes = [...XSD_BUILTIN_SIMPLE_TYPES, ...namedSimpleTypeNames];

    // Track indices for each type as we process in document order
    const typeIndices: Record<string, number> = {
      'xs:annotation': 0,
      'xs:import': 0,
      'xs:simpleType': 0,
      'xs:complexType': 0,
      'xs:element': 0,
      'xs:attributeGroup': 0,
      'xs:attribute': 0,
    };

    // Use __childrenInOrder if available (preserves document order from XML parsing),
    // otherwise fall back to manual iteration (for pre-parsed or non-XML schemas)
    const childrenInOrder = (schemaRoot as any)['__childrenInOrder'] as Array<{ tagName: string; value: any }> | undefined;
    
    if (childrenInOrder) {
      // Process in exact document order using the parsed order list
      childrenInOrder.forEach(({ tagName, value }) => {
        const key = tagName;
        const entries = asArray(value);
      
      if (key === 'xs:simpleType') {
        entries.forEach((entry: any) => {
          if (!entry || typeof entry !== 'object') return;
          const index = typeIndices['xs:simpleType']++;
          const attrs = getXmlAttrs(entry);
          const restriction = (entry as any)['xs:restriction'];
          const union = (entry as any)['xs:union'];
          const list = (entry as any)['xs:list'];
          let mode = 'restriction';
          if (union) mode = 'union';
          if (list) mode = 'list';

          const restrictionAttrs = restriction && typeof restriction === 'object' ? getXmlAttrs(restriction) : {};
          const unionAttrs = union && typeof union === 'object' ? getXmlAttrs(union) : {};
          const listAttrs = list && typeof list === 'object' ? getXmlAttrs(list) : {};
          // Extract nested member simpleTypes from union
          const memberSimpleTypes: InlineSimpleTypeData[] = [];
          if (union && typeof union === 'object') {
            const nestedSimpleTypes = asArray((union as any)['xs:simpleType']);
            memberSimpleTypes.push(
              ...nestedSimpleTypes
                .map((st: any) => parseInlineSimpleType(st))
                .filter((st): st is InlineSimpleTypeData => Boolean(st))
            );
          }
          // Extract nested item simpleType from list
          const itemSimpleType: InlineSimpleTypeData | undefined = list && typeof list === 'object'
            ? (() => {
                const nested = (list as any)['xs:simpleType'];
                return nested ? parseInlineSimpleType(nested) : undefined;
              })()
            : undefined;
          const enumerations = restriction && typeof restriction === 'object'
            ? asArray((restriction as any)['xs:enumeration'])
                .map((enumEntry: any) => getXmlAttrs(enumEntry).value)
                .filter((value): value is string => typeof value === 'string')
            : [];
          const facets = restriction && typeof restriction === 'object' ? parseSimpleTypeFacets(restriction) : undefined;
          const simpleTypeAttributes = asArray((entry as any)?.['xs:attribute']).map((attrEntry: any) => {
            const attrAttrs = getXmlAttrs(attrEntry);
            return { name: attrAttrs.name, type: attrAttrs.type, use: attrAttrs.use || 'optional' };
          });
          
          const isGlobalRef = Boolean(attrs.ref);
          const nodeType = isGlobalRef ? 'globalType' : 'property';

          addNode({
            id: `1.simpleType_${index}`,
            label: toNodeLabel('simpleType', attrs, `${index + 1}`),
            type: nodeType,
            parent: '1',
            xmlNodeKind: 'simpleType',
            xmlPath: ['xs:schema', 'xs:simpleType', index],
            xmlName: attrs.name,
            xmlSimpleTypeMode: mode,
            xmlBase: restrictionAttrs.base,
            xmlMemberTypes: unionAttrs.memberTypes,
            ...(memberSimpleTypes.length > 0 ? { xmlMemberSimpleTypes: memberSimpleTypes } : {}),
            xmlItemType: listAttrs.itemType,
            ...(itemSimpleType ? { xmlItemSimpleType: itemSimpleType } : {}),
            xmlEnumerations: enumerations,
            ...(mode === 'list' ? { xmlListValues: [] } : {}),
            ...(facets ? { xmlFacets: facets } : {}),
            ...(mode === 'union' ? { xmlUnionReferencedEnumerations: resolveUnionReferencedEnumerations(unionAttrs.memberTypes) } : {}),
            xmlAttributes: simpleTypeAttributes,
            xmlAvailableTypes: availableTypes,
            xmlIsRef: isGlobalRef,
            xmlMyTypeNames: namedSimpleTypeNames,
            ...getAnnotationField(entry),
          }, '1');
        });
      } else if (key === 'xs:complexType') {
        entries.forEach((entry: any) => {
          if (!entry || typeof entry !== 'object') return;
          const index = typeIndices['xs:complexType']++;
          const attrs = getXmlAttrs(entry);
          const complexId = `1.complexType_${index}`;
          const simpleContentInfo = getSimpleContentBaseInfo(entry);
          const baseInfo = getComplexContentBaseInfo(entry);
          const complexContent = (entry as any)['xs:complexContent'];
          const complexDerivation = baseInfo ? (complexContent as any)?.[baseInfo.derivationKey] : undefined;
          const attributeSourceValue = simpleContentInfo
            ? (simpleContentInfo.derivation as any)['xs:attribute']
            : (complexDerivation && typeof complexDerivation === 'object' ? (complexDerivation as any)['xs:attribute'] : (entry as any)?.['xs:attribute']);
          const complexTypeAttributes = asArray(attributeSourceValue).map((attrEntry: any) => {
            const attrAttrs = getXmlAttrs(attrEntry);
            return { name: attrAttrs.name, type: attrAttrs.type, use: attrAttrs.use || 'optional' };
          });
          
          const isGlobalRef = Boolean(attrs.ref);
          const nodeType = isGlobalRef ? 'globalType' : 'property';

          const anyAttributeValue = (entry as any)['xs:anyAttribute'];
          const anyAttributeAttrs = anyAttributeValue && typeof anyAttributeValue === 'object' ? getXmlAttrs(anyAttributeValue) : undefined;
          const complexTypeHasChildren = buildVisibleOnly && xmlEntryMayHaveChildren(entry);
          addNode({
            id: complexId,
            label: toNodeLabel('complexType', attrs, `${index + 1}`),
            type: nodeType,
            parent: '1',
            xmlNodeKind: 'complexType',
            xmlPath: ['xs:schema', 'xs:complexType', index],
            xmlName: attrs.name,
            xmlAttributes: complexTypeAttributes,
            xmlAvailableTypes: availableTypes,
            xmlMyComplexTypeNames: namedComplexTypeNames,
            xmlIsRef: isGlobalRef,
            xmlMixed: attrs.mixed === 'true',
            ...(anyAttributeAttrs ? { xmlAnyAttribute: anyAttributeAttrs } : {}),
            ...(baseInfo ? { xmlExtendsType: baseInfo.baseTypeName } : {}),
            ...(simpleContentInfo ? { xmlSimpleTypeMode: simpleContentInfo.derivationKey === 'xs:extension' ? 'extension' : 'restriction', xmlBase: simpleContentInfo.base } : {}),
            ...getAnnotationField(entry),
          }, '1', complexTypeHasChildren);

          const ownTypeAncestors = typeof attrs.name === 'string' && attrs.name ? new Set([attrs.name]) : new Set<string>();
          if (!buildVisibleOnly) {
            addInlineComplexTypeChildren(entry, complexId, ['xs:schema', 'xs:complexType', index], ownTypeAncestors);
          }
        });
      } else if (key === 'xs:element') {
        entries.forEach((entry: any) => {
          if (!entry || typeof entry !== 'object') return;
          const index = typeIndices['xs:element']++;
          addXmlElementNode(entry, '1', ['xs:schema', 'xs:element', index], index);
        });
      } else if (key === 'xs:attributeGroup') {
        entries.forEach((entry: any) => {
          if (!entry || typeof entry !== 'object') return;
          const index = typeIndices['xs:attributeGroup']++;
          const attrs = getXmlAttrs(entry);
          const groupId = `1.attributeGroup_${index}`;
          const attributeGroupAttributes = asArray((entry as any)?.['xs:attribute']).map((attrEntry: any) => {
            const attrAttrs = getXmlAttrs(attrEntry);
            return { name: attrAttrs.name, type: attrAttrs.type, use: attrAttrs.use || 'optional' };
          });

          const isGlobalRef = Boolean(attrs.ref);
          const nodeType = isGlobalRef ? 'globalType' : 'property';
          const groupHasChildren = buildVisibleOnly && xmlEntryMayHaveChildren(entry);

          addNode({
            id: groupId,
            label: toNodeLabel('attributeGroup', attrs, `${index + 1}`),
            type: nodeType,
            parent: '1',
            xmlNodeKind: 'attributeGroup',
            xmlPath: ['xs:schema', 'xs:attributeGroup', index],
            xmlName: attrs.name,
            xmlAttributes: attributeGroupAttributes,
            xmlAvailableTypes: availableTypes,
            xmlIsRef: isGlobalRef,
            ...getAnnotationField(entry),
          }, '1', groupHasChildren);

          const ownGroupAncestors = typeof attrs.name === 'string' && attrs.name ? new Set([`attributeGroup:${attrs.name}`]) : new Set<string>();
          if (!buildVisibleOnly) {
            addInlineComplexTypeChildren(entry, groupId, ['xs:schema', 'xs:attributeGroup', index], ownGroupAncestors);
          }
        });
      } else if (key === 'xs:attribute') {
        entries.forEach((entry: any) => {
          if (!entry || typeof entry !== 'object') return;
          const index = typeIndices['xs:attribute']++;
          const attrs = getXmlAttrs(entry);
          const attributeId = `1.attribute_${index}`;
          const attrPath = ['xs:schema', 'xs:attribute', index];
          const hasInlineSimpleType = Boolean((entry as any)['xs:simpleType']);
          addNode({
            id: attributeId,
            label: toNodeLabel('attribute', attrs, `${index + 1}`),
            type: 'property',
            parent: '1',
            xmlNodeKind: 'attribute',
            xmlPath: attrPath,
            xmlName: attrs.name,
            xmlAttributeType: attrs.type,
            xmlAttributeUse: attrs.use || 'optional',
            required: (attrs.use || 'optional') === 'required',
            ...(attrs.default !== undefined ? { xmlAttributeDefault: attrs.default } : {}),
            ...(hasInlineSimpleType ? { xmlHasInlineSimpleType: true } : {}),
            ...referencedEnumFields(attrs.type),
            xmlMyTypeNames: namedSimpleTypeNames,
            ...getAnnotationField(entry),
          }, '1', buildVisibleOnly && hasInlineSimpleType);
          if (!buildVisibleOnly) {
            addAttributeInlineSimpleTypeChild(entry, attributeId, attrPath);
          }
        });
      } else if (key === 'xs:annotation' && showAnnotations) {
        entries.forEach((entry: any) => {
          if (!entry || typeof entry !== 'object') return;
          const index = typeIndices['xs:annotation']++;
          const docElement = (entry as any)['xs:documentation'];
          const docText = typeof docElement === 'string' 
            ? docElement 
            : (docElement && typeof docElement === 'object' && docElement['#text'] 
              ? String(docElement['#text']) 
              : '');
          
          const annotationNodeId = `1.annotation_${index}`;
          const annotationPath = ['xs:schema', 'xs:annotation', index];
          
          addNode({
            id: annotationNodeId,
            label: `Annotation ${index + 1}`,
            type: 'annotation',
            parent: '1',
            xmlNodeKind: 'annotation',
            xmlPath: annotationPath,
            xmlAnnotationText: docText,
            xmlAnnotationIndex: index,
          }, '1');
        });
      } else if (key === 'xs:import' && showImports) {
        entries.forEach((entry: any) => {
          if (!entry || typeof entry !== 'object') return;
          const index = typeIndices['xs:import']++;
          const importAttrs = getXmlAttrs(entry);
          const namespace = importAttrs.namespace || '(no namespace)';
          const schemaLocation = importAttrs.schemaLocation || '(no location)';
          
          const importNodeId = `1.import_${index}`;
          const importPath = ['xs:schema', 'xs:import', index];
          
          addNode({
            id: importNodeId,
            label: `Import ${index + 1}`,
            type: 'import',
            parent: '1',
            xmlNodeKind: 'import',
            xmlPath: importPath,
            xmlImportNamespace: namespace,
            xmlImportSchemaLocation: schemaLocation,
            xmlImportIndex: index,
          }, '1');
        });
      }
      });
    } else {
      
      simpleTypes.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const idx = typeIndices['xs:simpleType']++;
        const attrs = getXmlAttrs(entry);
        const restriction = (entry as any)['xs:restriction'];
        const union = (entry as any)['xs:union'];
        const list = (entry as any)['xs:list'];
        let mode = 'restriction';
        if (union) mode = 'union';
        if (list) mode = 'list';

        const restrictionAttrs = restriction && typeof restriction === 'object' ? getXmlAttrs(restriction) : {};
        const unionAttrs = union && typeof union === 'object' ? getXmlAttrs(union) : {};
        const listAttrs = list && typeof list === 'object' ? getXmlAttrs(list) : {};
        // Extract nested member simpleTypes from union
        const memberSimpleTypes: InlineSimpleTypeData[] = [];
        if (union && typeof union === 'object') {
          const nestedSimpleTypes = asArray((union as any)['xs:simpleType']);
          memberSimpleTypes.push(
            ...nestedSimpleTypes
              .map((st: any) => parseInlineSimpleType(st))
              .filter((st): st is InlineSimpleTypeData => Boolean(st))
          );
        }
        // Extract nested item simpleType from list
        const itemSimpleType: InlineSimpleTypeData | undefined = list && typeof list === 'object'
          ? (() => {
              const nested = (list as any)['xs:simpleType'];
              return nested ? parseInlineSimpleType(nested) : undefined;
            })()
          : undefined;
        const enumerations = restriction && typeof restriction === 'object'
          ? asArray((restriction as any)['xs:enumeration'])
              .map((enumEntry: any) => getXmlAttrs(enumEntry).value)
              .filter((value): value is string => typeof value === 'string')
          : [];
        const facets = restriction && typeof restriction === 'object' ? parseSimpleTypeFacets(restriction) : undefined;
        const simpleTypeAttributes = asArray((entry as any)?.['xs:attribute']).map((attrEntry: any) => {
          const attrAttrs = getXmlAttrs(attrEntry);
          return { name: attrAttrs.name, type: attrAttrs.type, use: attrAttrs.use || 'optional' };
        });
        
        const isGlobalRef = Boolean(attrs.ref);
        const nodeType = isGlobalRef ? 'globalType' : 'property';

        addNode({
          id: `1.simpleType_${idx}`,
          label: toNodeLabel('simpleType', attrs, `${idx + 1}`),
          type: nodeType,
          parent: '1',
          xmlNodeKind: 'simpleType',
          xmlPath: ['xs:schema', 'xs:simpleType', idx],
          xmlName: attrs.name,
          xmlSimpleTypeMode: mode,
          xmlBase: restrictionAttrs.base,
          xmlMemberTypes: unionAttrs.memberTypes,
          ...(memberSimpleTypes.length > 0 ? { xmlMemberSimpleTypes: memberSimpleTypes } : {}),
          xmlItemType: listAttrs.itemType,
          ...(itemSimpleType ? { xmlItemSimpleType: itemSimpleType } : {}),
          xmlEnumerations: enumerations,
          ...(mode === 'list' ? { xmlListValues: [] } : {}),
          ...(facets ? { xmlFacets: facets } : {}),
          ...(mode === 'union' ? { xmlUnionReferencedEnumerations: resolveUnionReferencedEnumerations(unionAttrs.memberTypes) } : {}),
          xmlAttributes: simpleTypeAttributes,
          xmlAvailableTypes: availableTypes,
          xmlIsRef: isGlobalRef,
          xmlMyTypeNames: namedSimpleTypeNames,
          ...getAnnotationField(entry),
        }, '1');
      });

      complexTypes.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const idx = typeIndices['xs:complexType']++;
        const attrs = getXmlAttrs(entry);
        const complexId = `1.complexType_${idx}`;
        const simpleContentInfo = getSimpleContentBaseInfo(entry);
        const baseInfo = getComplexContentBaseInfo(entry);
        const complexContent = (entry as any)['xs:complexContent'];
        const complexDerivation = baseInfo ? (complexContent as any)?.[baseInfo.derivationKey] : undefined;
        const attributeSourceValue = simpleContentInfo
          ? (simpleContentInfo.derivation as any)['xs:attribute']
          : (complexDerivation && typeof complexDerivation === 'object' ? (complexDerivation as any)['xs:attribute'] : (entry as any)?.['xs:attribute']);
        const complexTypeAttributes = asArray(attributeSourceValue).map((attrEntry: any) => {
          const attrAttrs = getXmlAttrs(attrEntry);
          return { name: attrAttrs.name, type: attrAttrs.type, use: attrAttrs.use || 'optional' };
        });
        
        const isGlobalRef = Boolean(attrs.ref);
        const nodeType = isGlobalRef ? 'globalType' : 'property';

        const anyAttributeValue = (entry as any)['xs:anyAttribute'];
        const anyAttributeAttrs = anyAttributeValue && typeof anyAttributeValue === 'object' ? getXmlAttrs(anyAttributeValue) : undefined;
        const complexTypeHasChildren = buildVisibleOnly && xmlEntryMayHaveChildren(entry);
        addNode({
          id: complexId,
          label: toNodeLabel('complexType', attrs, `${idx + 1}`),
          type: nodeType,
          parent: '1',
          xmlNodeKind: 'complexType',
          xmlPath: ['xs:schema', 'xs:complexType', idx],
          xmlName: attrs.name,
          xmlAttributes: complexTypeAttributes,
          xmlAvailableTypes: availableTypes,
          xmlMyComplexTypeNames: namedComplexTypeNames,
          xmlIsRef: isGlobalRef,
          xmlMixed: attrs.mixed === 'true',
          ...(anyAttributeAttrs ? { xmlAnyAttribute: anyAttributeAttrs } : {}),
          ...(baseInfo ? { xmlExtendsType: baseInfo.baseTypeName } : {}),
          ...(simpleContentInfo ? { xmlSimpleTypeMode: simpleContentInfo.derivationKey === 'xs:extension' ? 'extension' : 'restriction', xmlBase: simpleContentInfo.base } : {}),
          ...getAnnotationField(entry),
        }, '1', complexTypeHasChildren);

        const ownTypeAncestors = typeof attrs.name === 'string' && attrs.name ? new Set([attrs.name]) : new Set<string>();
        if (!buildVisibleOnly) {
          addInlineComplexTypeChildren(entry, complexId, ['xs:schema', 'xs:complexType', idx], ownTypeAncestors);
        }
      });

      attributeGroups.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const idx = typeIndices['xs:attributeGroup']++;
        const attrs = getXmlAttrs(entry);
        const groupId = `1.attributeGroup_${idx}`;
        const attributeGroupAttributes = asArray((entry as any)?.['xs:attribute']).map((attrEntry: any) => {
          const attrAttrs = getXmlAttrs(attrEntry);
          return { name: attrAttrs.name, type: attrAttrs.type, use: attrAttrs.use || 'optional' };
        });

        const isGlobalRef = Boolean(attrs.ref);
        const nodeType = isGlobalRef ? 'globalType' : 'property';
        const groupHasChildren = buildVisibleOnly && xmlEntryMayHaveChildren(entry);

        addNode({
          id: groupId,
          label: toNodeLabel('attributeGroup', attrs, `${idx + 1}`),
          type: nodeType,
          parent: '1',
          xmlNodeKind: 'attributeGroup',
          xmlPath: ['xs:schema', 'xs:attributeGroup', idx],
          xmlName: attrs.name,
          xmlAttributes: attributeGroupAttributes,
          xmlAvailableTypes: availableTypes,
          xmlIsRef: isGlobalRef,
          ...getAnnotationField(entry),
        }, '1', groupHasChildren);

        const ownGroupAncestors = typeof attrs.name === 'string' && attrs.name ? new Set([`attributeGroup:${attrs.name}`]) : new Set<string>();
        if (!buildVisibleOnly) {
          addInlineComplexTypeChildren(entry, groupId, ['xs:schema', 'xs:attributeGroup', idx], ownGroupAncestors);
        }
      });

      elements.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const idx = typeIndices['xs:element']++;
        addXmlElementNode(entry, '1', ['xs:schema', 'xs:element', idx], idx);
      });

      attributes.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const idx = typeIndices['xs:attribute']++;
        const attrs = getXmlAttrs(entry);
        const attributeId = `1.attribute_${idx}`;
        const attrPath = ['xs:schema', 'xs:attribute', idx];
        const hasInlineSimpleType = Boolean((entry as any)['xs:simpleType']);
        addNode({
          id: attributeId,
          label: toNodeLabel('attribute', attrs, `${idx + 1}`),
          type: 'property',
          parent: '1',
          xmlNodeKind: 'attribute',
          xmlPath: attrPath,
          xmlName: attrs.name,
          xmlAttributeType: attrs.type,
          xmlAttributeUse: attrs.use || 'optional',
          required: (attrs.use || 'optional') === 'required',
          ...(attrs.default !== undefined ? { xmlAttributeDefault: attrs.default } : {}),
          ...(hasInlineSimpleType ? { xmlHasInlineSimpleType: true } : {}),
          ...referencedEnumFields(attrs.type),
          xmlMyTypeNames: namedSimpleTypeNames,
          ...getAnnotationField(entry),
        }, '1', buildVisibleOnly && hasInlineSimpleType);
        if (!buildVisibleOnly) {
          addAttributeInlineSimpleTypeChild(entry, attributeId, attrPath);
        }
      });
    }

    return { nodes, edges };
  }, [asArray, getXmlAttrs, toNodeLabel]);

  const updateXmlNodeAtPath = React.useCallback((sourceSchema: Record<string, unknown>, patch: Partial<NodeData>, node?: Node<SchemaNodeData>) => {
    // Use provided node or search in nodesRef
    const targetNode = node || nodesRef.current.find((n) => n.id === patch.id);
    if (!targetNode) {
      console.warn(`[updateXmlNodeAtPath] Node with id "${patch.id}" not found.`);
      return null;
    }
    const xmlPath = (targetNode?.data as any)?.xmlPath as Array<string | number> | undefined;
    if (!xmlPath || xmlPath.length === 0) {
      console.warn(`[updateXmlNodeAtPath] No xmlPath found for node ${patch.id}`);
      return null;
    }

    const cloned = JSON.parse(JSON.stringify(sourceSchema || {})) as any;
    const getAtPath = (root: any, path: Array<string | number>) => {
      let current = root;
      for (const segment of path) {
        if (current == null) return null;
        if (typeof segment === 'number') {
          if (Array.isArray(current)) {
            current = current[segment];
          } else if (segment === 0 && typeof current === 'object') {
            // XML parser may represent a single repeated node as an object rather than
            // an array, so index 0 should still resolve to the object when only one
            // occurrence exists.
            // No reassignment needed; keep current as-is.
          } else {
            return null;
          }
        } else {
          current = current[segment as string];
        }
      }
      return current;
    };

    const getOrCreateAttrs = (target: any) => {
      if (!target || typeof target !== 'object') return null;
      if (!target['@attributes'] || typeof target['@attributes'] !== 'object') target['@attributes'] = {};
      return target['@attributes'] as Record<string, unknown>;
    };

    const getComplexContentExtension = (complexTypeTarget: any) => {
      if (!complexTypeTarget || typeof complexTypeTarget !== 'object') return null;
      const complexContent = (complexTypeTarget as any)['xs:complexContent'];
      if (!complexContent || typeof complexContent !== 'object') return null;
      const extension = (complexContent as any)['xs:extension'];
      if (!extension || typeof extension !== 'object') return null;
      return extension;
    };

    const ensureComplexContentExtension = (complexTypeTarget: any) => {
      if (!complexTypeTarget || typeof complexTypeTarget !== 'object') return null;
      if (!(complexTypeTarget as any)['xs:complexContent'] || typeof (complexTypeTarget as any)['xs:complexContent'] !== 'object') {
        (complexTypeTarget as any)['xs:complexContent'] = {};
      }
      const complexContent = (complexTypeTarget as any)['xs:complexContent'];
      if (!(complexContent as any)['xs:extension'] || typeof (complexContent as any)['xs:extension'] !== 'object') {
        (complexContent as any)['xs:extension'] = { '@attributes': {} };
      }
      const extension = (complexContent as any)['xs:extension'];
      if (!(extension as any)['@attributes'] || typeof (extension as any)['@attributes'] !== 'object') {
        (extension as any)['@attributes'] = {};
      }
      return extension;
    };

    let target = getAtPath(cloned, xmlPath);
    
    // If the target is not found at xmlPath but xmlPath is ['xs:schema'] for kind='schema',
    // the schema might be normalized without the xs:schema wrapper.
    // In that case, check if cloned itself looks like a schema root.
    if (!target && xmlPath.length === 1 && xmlPath[0] === 'xs:schema' && String((node?.data as any)?.xmlNodeKind || '') === 'schema') {
      if (Object.prototype.hasOwnProperty.call(cloned, 'xs:schema')) {
        // The schema has xs:schema as a key - use it
        target = cloned['xs:schema'];
      } else {
        // Check if cloned itself is the root schema (normalized form)
        // In normalized form (MS SchemaObject style), properties are direct on the root
        // Check for the presence of XSD schema property names
        const xsdSchemaProps = ['targetNamespace', 'elementFormDefault', 'attributeFormDefault', 'blockDefault', 'finalDefault', 'version', 'id'];
        const hasXsdProps = xsdSchemaProps.some(prop => Object.prototype.hasOwnProperty.call(cloned, prop));
        // Also check for XML element markers
        const hasXmlKeys = Object.keys(cloned).some(k => k.startsWith('xs:') || k === '@attributes');
        
        if (hasXsdProps || hasXmlKeys) {
          // This looks like a schema root
          target = cloned;
        }
      }
    }
    
    if (!target || typeof target !== 'object') {
      console.warn(`[updateXmlNodeAtPath] target not found or not an object at path ${JSON.stringify(xmlPath)}`);
      return null;
    }
    const kind = String((targetNode?.data as any)?.xmlNodeKind || '');

    const getAttributeDeclEntries = (container: any): any[] => {
      const raw = container?.['xs:attribute'];
      if (Array.isArray(raw)) return [...raw];
      if (raw && typeof raw === 'object') return [raw];
      return [];
    };

    const setAttributeDeclEntries = (container: any, entries: any[]) => {
      if (!container || typeof container !== 'object') return;
      container['xs:attribute'] = Array.isArray(entries) ? entries : [];
    };

    // `xs:annotation/xs:documentation` is a free-text field common to every XSD node kind, so it's
    // handled generically here (once) rather than duplicated in each kind-specific branch below.
    // (A compositor's `target` may be an array — e.g. multiple `xs:sequence` siblings — so unwrap
    // to the first entry the same way the minOccurs/maxOccurs handling below does.)
    if (Object.prototype.hasOwnProperty.call(patch, 'xmlAnnotation')) {
      const annotationTarget = Array.isArray(target) ? target[0] : target;
      if (annotationTarget && typeof annotationTarget === 'object') {
        const value = (patch as any).xmlAnnotation;
        if (typeof value === 'string' && value.trim().length > 0) {
          annotationTarget['xs:annotation'] = { 'xs:documentation': { '#text': value } };
        } else {
          delete annotationTarget['xs:annotation'];
        }
      }
    }

    // Handle multiple annotations (xs:annotation elements with xs:documentation)
    if (Object.prototype.hasOwnProperty.call(patch, 'xmlAnnotations')) {
      const annotationTarget = Array.isArray(target) ? target[0] : target;
      if (annotationTarget && typeof annotationTarget === 'object') {
        const values = (patch as any).xmlAnnotations;
        if (Array.isArray(values) && values.length > 0) {
          // Create an array of xs:annotation elements, each with xs:documentation
          annotationTarget['xs:annotation'] = values.map((text: string) => ({
            'xs:documentation': { '#text': text },
          }));
        } else {
          delete annotationTarget['xs:annotation'];
        }
      }
    }

    // A named top-level simpleType's flat mode/base/enumerations/memberTypes/itemType fields —
    // does not apply to an attribute's anonymous inline simpleType child (handled separately
    // below via `xmlAttributeInlineSimpleType`, which replaces its whole tree at once).
    if (kind === 'simpleType' && !(node?.data as any)?.xmlIsAnonymous) {
      const attrs = getOrCreateAttrs(target);
      if (!attrs) return null;
      if (Object.prototype.hasOwnProperty.call(patch, 'xmlName')) {
        const value = (patch as any).xmlName;
        if (value) attrs.name = value;
        else delete attrs.name;
      }

      if (Object.prototype.hasOwnProperty.call(patch, 'xmlIsRef')) {
        const value = Boolean((patch as any).xmlIsRef);
        if (value) attrs.ref = 'true';
        else delete attrs.ref;
      }

      if (Object.prototype.hasOwnProperty.call(patch, 'xmlSimpleTypeMode')) {
        const mode = String((patch as any).xmlSimpleTypeMode || 'restriction');
        delete (target as any)['xs:restriction'];
        delete (target as any)['xs:union'];
        delete (target as any)['xs:list'];
        if (mode === 'restriction') (target as any)['xs:restriction'] = { '@attributes': { base: 'xs:string' } };
        if (mode === 'union') (target as any)['xs:union'] = { '@attributes': { memberTypes: '' } };
        if (mode === 'list') (target as any)['xs:list'] = { '@attributes': { itemType: 'xs:string' } };
      }

      if (Object.prototype.hasOwnProperty.call(patch, 'xmlBase')) {
        if (!(target as any)['xs:restriction']) (target as any)['xs:restriction'] = { '@attributes': {} };
        const rAttrs = getOrCreateAttrs((target as any)['xs:restriction']);
        if (rAttrs) {
          const value = (patch as any).xmlBase;
          if (value) rAttrs.base = value;
          else delete rAttrs.base;
        }
      }

      if (Object.prototype.hasOwnProperty.call(patch, 'xmlEnumerations')) {
        if (!(target as any)['xs:restriction']) (target as any)['xs:restriction'] = { '@attributes': {} };
        const values = (((patch as any).xmlEnumerations as string[] | undefined) || []).filter((value) => value !== undefined && value !== null);
        if (values.length > 0) (target as any)['xs:restriction']['xs:enumeration'] = values.map((value) => ({ '@attributes': { value } }));
        else delete (target as any)['xs:restriction']['xs:enumeration'];
      }

      if (Object.prototype.hasOwnProperty.call(patch, 'xmlFacets')) {
        if (!(target as any)['xs:restriction']) (target as any)['xs:restriction'] = { '@attributes': {} };
        const restrictionTarget = (target as any)['xs:restriction'];
        const facets = ((patch as any).xmlFacets as SimpleTypeFacets | undefined) || {};
        for (const [facetKey, tag] of SIMPLE_TYPE_FACET_TAGS) {
          const value = facets[facetKey];
          if (value !== undefined && value !== null && value !== '') restrictionTarget[tag] = { '@attributes': { value } };
          else delete restrictionTarget[tag];
        }
      }

      if (Object.prototype.hasOwnProperty.call(patch, 'xmlMemberTypes')) {
        if (!(target as any)['xs:union']) (target as any)['xs:union'] = { '@attributes': {} };
        const uAttrs = getOrCreateAttrs((target as any)['xs:union']);
        if (uAttrs) {
          const value = (patch as any).xmlMemberTypes;
          if (value) uAttrs.memberTypes = value;
          else delete uAttrs.memberTypes;
        }
      }

      if (Object.prototype.hasOwnProperty.call(patch, 'xmlItemType')) {
        if (!(target as any)['xs:list']) (target as any)['xs:list'] = { '@attributes': {} };
        const lAttrs = getOrCreateAttrs((target as any)['xs:list']);
        if (lAttrs) {
          const value = (patch as any).xmlItemType;
          if (value) lAttrs.itemType = value;
          else delete lAttrs.itemType;
        }
      }
    }

    // An attribute's anonymous inline `xs:simpleType` child node — `target` here IS the
    // `xs:simpleType` object itself (per its own xmlPath), so the whole tree is replaced in
    // place rather than patched via the flat xmlSimpleTypeMode/xmlBase/... fields above (which
    // only apply to a real named simpleType's own `target`, one level up from its content).
    if (kind === 'simpleType' && Boolean((node?.data as any)?.xmlIsAnonymous) && Object.prototype.hasOwnProperty.call(patch, 'xmlAttributeInlineSimpleType')) {
      const value = (patch as any).xmlAttributeInlineSimpleType as InlineSimpleTypeData | undefined | null;
      if (value) {
        const serialized = serializeInlineSimpleType(value);
        delete (target as any)['xs:restriction'];
        delete (target as any)['xs:union'];
        delete (target as any)['xs:list'];
        Object.assign(target as any, serialized);
      }
    }

    if (kind === 'complexType') {
      const attrs = getOrCreateAttrs(target);
      if (attrs && Object.prototype.hasOwnProperty.call(patch, 'xmlName')) {
        const value = (patch as any).xmlName;
        if (value) attrs.name = value;
        else delete attrs.name;
      }
      if (attrs && Object.prototype.hasOwnProperty.call(patch, 'xmlIsRef')) {
        const value = Boolean((patch as any).xmlIsRef);
        if (value) attrs.ref = 'true';
        else delete attrs.ref;
      }
      if (attrs && Object.prototype.hasOwnProperty.call(patch, 'xmlMixed')) {
        const value = Boolean((patch as any).xmlMixed);
        if (value) attrs.mixed = 'true';
        else delete attrs.mixed;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'xmlAnyAttributeNamespace')) {
        const value = (patch as any).xmlAnyAttributeNamespace;
        if (typeof value === 'string' && value.trim().length > 0) {
          (target as any)['xs:anyAttribute'] = { '@attributes': { namespace: value } };
        } else {
          delete (target as any)['xs:anyAttribute'];
        }
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'xmlComplexContentEnabled')) {
        const enabled = Boolean((patch as any).xmlComplexContentEnabled);
        if (enabled) {
          const extension = ensureComplexContentExtension(target);
          const extensionAttrs = extension ? getOrCreateAttrs(extension) : null;
          if (extensionAttrs && !extensionAttrs.base) {
            const fallbackBase = String((patch as any).xmlExtendsType || (targetNode.data as any)?.xmlExtendsType || 'xs:anyType');
            extensionAttrs.base = fallbackBase;
          }
        } else {
          delete (target as any)['xs:complexContent'];
        }
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'xmlExtendsType')) {
        const value = String((patch as any).xmlExtendsType || '').trim();
        if (value) {
          const extension = ensureComplexContentExtension(target);
          const extensionAttrs = extension ? getOrCreateAttrs(extension) : null;
          if (extensionAttrs) extensionAttrs.base = value;
        }
      }
    }

    if (kind === 'attributeGroup') {
      const attrs = getOrCreateAttrs(target);
      if (attrs && Object.prototype.hasOwnProperty.call(patch, 'xmlName')) {
        const value = (patch as any).xmlName;
        if (value) attrs.name = value;
        else delete attrs.name;
      }
      if (attrs && Object.prototype.hasOwnProperty.call(patch, 'xmlIsRef')) {
        const value = Boolean((patch as any).xmlIsRef);
        if (value) attrs.ref = 'true';
        else delete attrs.ref;
      }
    }

    if (kind === 'attribute') {
      const attrs = getOrCreateAttrs(target);
      if (!attrs) return null;
      if (Object.prototype.hasOwnProperty.call(patch, 'xmlName')) {
        const value = (patch as any).xmlName;
        if (value) attrs.name = value;
        else delete attrs.name;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'xmlAttributeType')) {
        const value = (patch as any).xmlAttributeType;
        if (value) attrs.type = value;
        else delete attrs.type;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'xmlAttributeUse')) {
        const value = (patch as any).xmlAttributeUse;
        if (value) attrs.use = value;
        else delete attrs.use;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'xmlAttributeDefault')) {
        const value = (patch as any).xmlAttributeDefault;
        if (value) attrs.default = value;
        else delete attrs.default;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'xmlAttributeInlineSimpleType')) {
        const value = (patch as any).xmlAttributeInlineSimpleType as InlineSimpleTypeData | undefined | null;
        if (value) {
          (target as any)['xs:simpleType'] = serializeInlineSimpleType(value);
          // An attribute can't have both a `type=` attribute and an inline `xs:simpleType`.
          delete attrs.type;
        } else {
          delete (target as any)['xs:simpleType'];
        }
      }
    }

    if (kind === 'element') {
      const attrs = getOrCreateAttrs(target);
      if (!attrs) return null;
      if (Object.prototype.hasOwnProperty.call(patch, 'xmlConvertToComplexType')) {
        const existingType = typeof attrs.type === 'string' ? attrs.type : undefined;
        if (!(target as any)['xs:complexType'] || typeof (target as any)['xs:complexType'] !== 'object') {
          (target as any)['xs:complexType'] = {};
        }
        const complexTypeTarget = (target as any)['xs:complexType'];
        if (existingType && existingType.trim().length > 0) {
          (complexTypeTarget as any)['xs:simpleContent'] = {
            'xs:extension': {
              '@attributes': {
                base: existingType,
              },
            },
          };
        }
        delete (complexTypeTarget as any)['xs:complexContent'];
        delete attrs.type;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'xmlName')) {
        const value = (patch as any).xmlName;
        // A `ref`-only element stores its display name on `ref`, not `name` — write back
        // to whichever attribute is actually present so we don't add a stray `name`.
        const nameField = attrs.ref !== undefined ? 'ref' : 'name';
        if (value) attrs[nameField] = value;
        else delete attrs[nameField];
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'xmlElementType')) {
        const value = (patch as any).xmlElementType;
        if (value) attrs.type = value;
        else delete attrs.type;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'xmlSubstitutionGroupParent')) {
        const value = (patch as any).xmlSubstitutionGroupParent;
        if (value) attrs.substitutionGroup = value;
        else delete attrs.substitutionGroup;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'xmlMinOccurs')) {
        const value = (patch as any).xmlMinOccurs;
        if (value !== undefined && value !== null && String(value).length > 0) attrs.minOccurs = String(value);
        else delete attrs.minOccurs;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'xmlMaxOccurs')) {
        const value = (patch as any).xmlMaxOccurs;
        if (value !== undefined && value !== null && String(value).length > 0) attrs.maxOccurs = String(value);
        else delete attrs.maxOccurs;
      }
      const complexTypeTarget = (target as any)['xs:complexType'];
      const anyAttributeTarget = complexTypeTarget && typeof complexTypeTarget === 'object' ? complexTypeTarget : target;
      if (Object.prototype.hasOwnProperty.call(patch, 'xmlMixed')) {
        const value = Boolean((patch as any).xmlMixed);
        const anyAttrs = getOrCreateAttrs(anyAttributeTarget);
        if (anyAttrs) {
          if (value) anyAttrs.mixed = 'true';
          else delete anyAttrs.mixed;
        }
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'xmlAnyAttributeNamespace')) {
        const value = (patch as any).xmlAnyAttributeNamespace;
        if (typeof value === 'string' && value.trim().length > 0) {
          (anyAttributeTarget as any)['xs:anyAttribute'] = { '@attributes': { namespace: value } };
        } else {
          delete (anyAttributeTarget as any)['xs:anyAttribute'];
        }
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'xmlComplexContentEnabled') || Object.prototype.hasOwnProperty.call(patch, 'xmlExtendsType')) {
        if (!(target as any)['xs:complexType'] || typeof (target as any)['xs:complexType'] !== 'object') {
          (target as any)['xs:complexType'] = {};
          delete attrs.type;
        }
        const complexTypeTarget = (target as any)['xs:complexType'];
        if (Object.prototype.hasOwnProperty.call(patch, 'xmlComplexContentEnabled')) {
          const enabled = Boolean((patch as any).xmlComplexContentEnabled);
          if (enabled) {
            const extension = ensureComplexContentExtension(complexTypeTarget);
            const extensionAttrs = extension ? getOrCreateAttrs(extension) : null;
            if (extensionAttrs && !extensionAttrs.base) {
              const fallbackBase = String((patch as any).xmlExtendsType || (targetNode.data as any)?.xmlExtendsType || 'xs:anyType');
              extensionAttrs.base = fallbackBase;
            }
          } else {
            delete (complexTypeTarget as any)['xs:complexContent'];
          }
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'xmlExtendsType')) {
          const value = String((patch as any).xmlExtendsType || '').trim();
          if (value) {
            const extension = ensureComplexContentExtension(complexTypeTarget);
            const extensionAttrs = extension ? getOrCreateAttrs(extension) : null;
            if (extensionAttrs) extensionAttrs.base = value;
          }
        }
      }
    }

    if (kind === 'sequence' || kind === 'choice' || kind === 'all') {
      const compositor = target as any;
      const compositorNode = Array.isArray(compositor) ? compositor[0] : compositor;
      if (compositorNode && typeof compositorNode === 'object') {
        const attrs = getOrCreateAttrs(compositorNode);
        if (attrs && Object.prototype.hasOwnProperty.call(patch, 'xmlMinOccurs')) {
          const value = (patch as any).xmlMinOccurs;
          if (value !== undefined && value !== null && String(value).length > 0) attrs.minOccurs = String(value);
          else delete attrs.minOccurs;
        }
        if (attrs && Object.prototype.hasOwnProperty.call(patch, 'xmlMaxOccurs')) {
          const value = (patch as any).xmlMaxOccurs;
          if (value !== undefined && value !== null && String(value).length > 0) attrs.maxOccurs = String(value);
          else delete attrs.maxOccurs;
        }
      }
    }

    if (kind === 'schema') {
      // Determine if we should store properties as direct properties or in @attributes
      // In normalized form (e.g., MS SchemaObject), they're direct properties on root
      // In raw XML form, they're in @attributes
      
      const hasAttributes = Object.prototype.hasOwnProperty.call(target, '@attributes');
      let attrs: Record<string, unknown>;
      
      if (hasAttributes) {
        // XML form: store in @attributes
        attrs = target['@attributes'] as Record<string, unknown>;
      } else {
        // Normalized form: store as direct properties on root
        attrs = target as Record<string, unknown>;
      }

      // Generic handler for any xml* schema attributes
      // Maps xmlPropertyName -> propertyName (e.g., xmlTargetNamespace -> targetNamespace)
      const xmlPropertyMap: Record<string, string> = {
        xmlTargetNamespace: 'targetNamespace',
        xmlElementFormDefault: 'elementFormDefault',
        xmlAttributeFormDefault: 'attributeFormDefault',
        xmlBlockDefault: 'blockDefault',
        xmlFinalDefault: 'finalDefault',
        xmlVersion: 'version',
        xmlId: 'id',
      };

      Object.entries(xmlPropertyMap).forEach(([xmlKey, attrKey]) => {
        if (Object.prototype.hasOwnProperty.call(patch, xmlKey)) {
          const value = (patch as any)[xmlKey];
          if (value !== undefined && value !== null && String(value).trim().length > 0) {
            attrs[attrKey] = String(value);
          } else {
            delete attrs[attrKey];
          }
        }
      });

      // Handle xs:import updates
      if (Object.prototype.hasOwnProperty.call(patch, 'xmlImports')) {
        const imports = (patch as any).xmlImports as Array<{ namespace: string; schemaLocation: string }>;
        if (Array.isArray(imports) && imports.length > 0) {
          // Replace or create xs:import array
          target['xs:import'] = imports.map((imp) => ({
            '@attributes': {
              ...(imp.namespace ? { namespace: imp.namespace } : {}),
              ...(imp.schemaLocation ? { schemaLocation: imp.schemaLocation } : {}),
            },
          }));
        } else {
          // Remove xs:import if empty
          delete target['xs:import'];
        }
      }

      // Handle custom xmlns:* namespace declarations
      if (Object.prototype.hasOwnProperty.call(patch, 'xmlnsNamespaces')) {
        const namespaces = (patch as any).xmlnsNamespaces as Array<{ prefix: string; uri: string }>;
        if (Array.isArray(namespaces) && namespaces.length > 0) {
          // Add/update xmlns:* attributes on root
          namespaces.forEach((ns) => {
            if (ns.prefix && ns.uri) {
              attrs[`xmlns:${ns.prefix}`] = ns.uri;
            }
          });
        }
      }
    }

    // Handle attribute operations on simpleType, complexType, attributeGroup, or element.
    // For element nodes, attributes live on the inline xs:complexType (or its complexContent extension),
    // not on the element itself.
    if ((kind === 'simpleType' || kind === 'complexType' || kind === 'attributeGroup' || kind === 'element') && target && typeof target === 'object') {
      let attributeOpsTarget = target;
      if (kind === 'complexType') {
        attributeOpsTarget = getComplexContentExtension(target) || target;
      } else if (kind === 'element') {
        if (!(target as any)['xs:complexType'] || typeof (target as any)['xs:complexType'] !== 'object') {
          (target as any)['xs:complexType'] = {};
          const attrs = getOrCreateAttrs(target);
          if (attrs) delete attrs.type;
        }
        const elementComplexTypeTarget = (target as any)['xs:complexType'];
        attributeOpsTarget = getComplexContentExtension(elementComplexTypeTarget) || elementComplexTypeTarget;
      }

      if (Object.prototype.hasOwnProperty.call(patch, 'xmlAddAttribute')) {
        const newAttr = (patch as any).xmlAddAttribute;
        const attrDecls = getAttributeDeclEntries(attributeOpsTarget);
        const attrObj: any = { '@attributes': {} };
        if (newAttr.name) attrObj['@attributes'].name = newAttr.name;
        if (newAttr.type) attrObj['@attributes'].type = newAttr.type;
        if (newAttr.use && newAttr.use !== 'optional') attrObj['@attributes'].use = newAttr.use;
        attrDecls.push(attrObj);
        setAttributeDeclEntries(attributeOpsTarget, attrDecls);
      }

      if (Object.prototype.hasOwnProperty.call(patch, 'xmlRemoveAttributeIndex')) {
        const index = Number((patch as any).xmlRemoveAttributeIndex);
        const attrDecls = getAttributeDeclEntries(attributeOpsTarget);
        if (!Number.isNaN(index) && index >= 0 && index < attrDecls.length) {
          attrDecls.splice(index, 1);
          setAttributeDeclEntries(attributeOpsTarget, attrDecls);
        }
      }

      if (Object.prototype.hasOwnProperty.call(patch, 'xmlUpdateAttributeIndex')) {
        const update = (patch as any).xmlUpdateAttributeIndex;
        const index = Number(update.index);
        const attrDecls = getAttributeDeclEntries(attributeOpsTarget);
        if (!Number.isNaN(index) && index >= 0 && index < attrDecls.length) {
          const attrEntry = attrDecls[index];
          if (attrEntry && typeof attrEntry === 'object') {
            const attrs = getOrCreateAttrs(attrEntry);
            if (attrs) {
              if (update.name) attrs.name = update.name;
              else delete attrs.name;
              if (update.type) attrs.type = update.type;
              else delete attrs.type;
              if (update.use && update.use !== 'optional') attrs.use = update.use;
              else delete attrs.use;
            }
            setAttributeDeclEntries(attributeOpsTarget, attrDecls);
          }
        }
      }
    }

    return cloned as Record<string, unknown>;
  }, []);

  // Full schemaToGraph implementation
  const schemaToGraph = React.useCallback((schema: Record<string, unknown>): { nodes: Node<SchemaNodeData>[]; edges: Edge[] } => {
    if (isXmlGraphMode) {
      return xmlSchemaToGraph(schema);
    }
    const nodes: Node<SchemaNodeData>[] = [];
    const edges: Edge[] = [];

    // Derive the schema type for a variant entry, resolving local $refs via definitions
    function getVariantSchemaType(v: any): string {
      if (!v || typeof v !== 'object') return 'string';
      if (typeof v.type === 'string') return v.type;
      if (Array.isArray(v.type) && v.type.length > 0) return v.type[0];
      if (v.properties || v.patternProperties) return 'object';
      if (v.items !== undefined) return 'array';
      if (Array.isArray(v.enum)) return 'string';
      if (typeof v.$ref === 'string' && v.$ref.startsWith('#/definitions/')) {
        const defName = v.$ref.replace('#/definitions/', '');
        const def = (schema as any).definitions?.[defName];
        if (def) return getVariantSchemaType(def);
      }
      return 'string';
    }

    function inferArrayItemType(candidate: any): string | undefined {
      const inferFromItems = (items: any): string | undefined => {
        if (!items) return undefined;
        if (Array.isArray(items)) {
          for (const entry of items) {
            const inferred = inferFromItems(entry);
            if (inferred) return inferred;
          }
          return undefined;
        }
        if (typeof items !== 'object') return undefined;
        if (typeof items.type === 'string') return items.type;
        if (Array.isArray(items.type) && items.type.length > 0) return items.type[0];
        if (items.properties || items.patternProperties) return 'object';
        if (items.items !== undefined) return inferFromItems(items.items);
        if (Array.isArray(items.oneOf)) {
          for (const variant of items.oneOf) {
            const inferred = inferFromItems(variant);
            if (inferred) return inferred;
          }
        }
        if (Array.isArray(items.anyOf)) {
          for (const variant of items.anyOf) {
            const inferred = inferFromItems(variant);
            if (inferred) return inferred;
          }
        }
        if (Array.isArray(items.allOf)) {
          for (const variant of items.allOf) {
            const inferred = inferFromItems(variant);
            if (inferred) return inferred;
          }
        }
        return undefined;
      };

      if (!candidate || typeof candidate !== 'object') return undefined;

      if (candidate.items !== undefined) {
        const direct = inferFromItems(candidate.items);
        if (direct) return direct;
      }

      if (candidate.additionalItems && typeof candidate.additionalItems === 'object') {
        const fromAdditionalItems = inferFromItems(candidate.additionalItems);
        if (fromAdditionalItems) return fromAdditionalItems;
      }

      if (Array.isArray(candidate.oneOf)) {
        for (const variant of candidate.oneOf) {
          const inferred = inferArrayItemType(variant);
          if (inferred) return inferred;
        }
      }
      if (Array.isArray(candidate.anyOf)) {
        for (const variant of candidate.anyOf) {
          const inferred = inferArrayItemType(variant);
          if (inferred) return inferred;
        }
      }
      if (Array.isArray(candidate.allOf)) {
        for (const variant of candidate.allOf) {
          const inferred = inferArrayItemType(variant);
          if (inferred) return inferred;
        }
      }

      return undefined;
    }

    function walkSchema(obj: any, parentId?: string, label?: string, x = 0, y = 0, parentRequired?: string[], refAncestors: Set<string> = new Set()): string {
      const id = makeId(parentId, label);
      // Set when a $ref points back to a definition already being expanded on this branch (circular reference).
      let circularRefPath: string | undefined;
      // Resolve local $ref and oneOf refs that reference definitions within the schema so we can traverse referenced definitions
      const resolveLocalRef = (candidate: any): any => {
        if (!candidate || typeof candidate !== 'object') return candidate;
        // Direct $ref to local definition — resolve and merge
        if (typeof candidate.$ref === 'string' && candidate.$ref.startsWith('#/')) {
          if (refAncestors.has(candidate.$ref)) {
            // Already expanded this definition once on this branch — stop here instead of recursing forever.
            circularRefPath = candidate.$ref;
            return candidate;
          }
          const path = candidate.$ref.replace(/^#\//, '').split('/');
          let target: any = schema;
          for (const p of path) {
            if (target && typeof target === 'object') target = target[p];
            else { target = null; break; }
          }
          if (target && typeof target === 'object') {
            const rest = { ...candidate };
            delete (rest as any).$ref;
            return { ...JSON.parse(JSON.stringify(target)), ...rest };
          }
          return candidate;
        }
        // NOTE: oneOf/anyOf/allOf are NO LONGER flattened here.
        // They are handled by the combiner node creation logic in walkSchema below.
        return candidate;
      };
      const resolvedRefPath = typeof obj?.$ref === 'string' ? obj.$ref : undefined;
      obj = resolveLocalRef(obj);
      // Children inherit this ref on their ancestor chain so a repeat of the same $ref further down is caught.
      const childRefAncestors = (resolvedRefPath && !circularRefPath) ? new Set(refAncestors).add(resolvedRefPath) : refAncestors;

      // Normalize type values so we can handle arrays like ['object','null'] and implicit objects/arrays
      const rawType = obj.type;
      let type = Array.isArray(rawType) ? rawType[0] : rawType; // prefer first declared type for display
      const hasItemsKeyword = obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, 'items');
      if (!type) {
        // If no explicit type, infer type from schema shape
        if (obj.properties) type = 'object';
        else if (obj.items) type = 'array';
        else type = 'object';
      }
      // Some schemas use "$ref" with sibling "items" constraints (for example
      // GitHub workflow event "types"). Ensure we preserve array semantics even
      // when the referenced definition doesn't declare a direct "type".
      if (!rawType && hasItemsKeyword && type !== 'array') {
        type = 'array';
      }
      let ofType = undefined;
      let nodeType = 'property';
      let isRequired = false;
      // If not root, check if required
      if (parentId && parentRequired && label) {
        isRequired = parentRequired.includes(label);
      }
      // Include common annotations so editors stay in sync (default, format, pattern, description, enum)
      const nodeData: any = { id, label: label || obj.title || (parentId ? type : 'Root'), type, parent: parentId };
      // Preserve raw type arrays (e.g., ["boolean","number"]) so editors can show unions
      if (Array.isArray(rawType)) nodeData.typeUnion = rawType;
      // Mark nodes that originate from a $ref or external provenance so the UI can show an indicator
      try {
        if (circularRefPath) {
          // Circular $ref: show as a reference stub with its own badge instead of "imported"
          nodeData.isRef = true;
          nodeData.$ref = circularRefPath;
        } else if (obj && typeof obj === 'object') {
          if (typeof obj.$ref === 'string') nodeData.imported = true;
          else if (Array.isArray(obj.allOf) && obj.allOf.some((e: any) => e && typeof e.$ref === 'string')) nodeData.imported = true;
          else if ((obj as any).__from) nodeData.imported = true;
        }
      } catch (e) {
        // ignore
      }
      if (obj.default !== undefined) nodeData.default = obj.default;
      if (obj.format !== undefined) nodeData.format = obj.format;
      if (obj.pattern !== undefined) nodeData.pattern = obj.pattern;
      if (obj.description !== undefined) nodeData.description = obj.description;
      if (obj.contentMediaType !== undefined) nodeData.contentMediaType = obj.contentMediaType;
      if (obj.contentEncoding !== undefined) nodeData.contentEncoding = obj.contentEncoding;
      // Preserve $comment into node data for rendering as a tooltip on a note icon
      if (obj.$comment !== undefined) nodeData.$comment = obj.$comment;
      if (Array.isArray(obj.enum)) nodeData.enum = obj.enum;
      // Additional common annotations/constraints
      if (obj.examples !== undefined) nodeData.examples = obj.examples;
      if (obj.minimum !== undefined) nodeData.minimum = obj.minimum;
      if (obj.maximum !== undefined) nodeData.maximum = obj.maximum;
      if (obj.exclusiveMinimum !== undefined) nodeData.exclusiveMinimum = obj.exclusiveMinimum;
      if (obj.exclusiveMaximum !== undefined) nodeData.exclusiveMaximum = obj.exclusiveMaximum;
      if (obj.minLength !== undefined) nodeData.minLength = obj.minLength;
      if (obj.maxLength !== undefined) nodeData.maxLength = obj.maxLength;
      if (obj.multipleOf !== undefined) nodeData.multipleOf = obj.multipleOf;
      if (obj.minItems !== undefined) nodeData.minItems = obj.minItems;
      if (obj.maxItems !== undefined) nodeData.maxItems = obj.maxItems;
      if (obj.minProperties !== undefined) nodeData.minProperties = obj.minProperties;
      if (obj.maxProperties !== undefined) nodeData.maxProperties = obj.maxProperties;
      if (obj.additionalProperties !== undefined) nodeData.additionalProperties = obj.additionalProperties;
      if (obj.uniqueItems !== undefined) nodeData.uniqueItems = obj.uniqueItems;
      if (obj.readOnly !== undefined) nodeData.readOnly = obj.readOnly;
      if (obj.writeOnly !== undefined) nodeData.writeOnly = obj.writeOnly;
      if (obj.deprecated !== undefined) nodeData.deprecated = obj.deprecated;
      if (obj.const !== undefined) nodeData.const = obj.const;
      if (obj.title !== undefined) nodeData.title = obj.title;
      // If array, check if items is enum and propagate imported provenance from items
      if (type === 'array' && obj.items) {
        const items = obj.items as any;
        // normalize ofType (handle arrays and infer object when properties present)
        ofType = inferArrayItemType({ type: 'array', items }) || (items.properties ? 'object' : undefined);
        if (!ofType && Array.isArray(items.enum)) ofType = 'string';
        nodeData.ofType = ofType;
        if (Array.isArray(items.enum)) {
          nodeType = 'enum';
          nodeData.enum = items.enum;
        }
        try {
          if (items && typeof items === 'object') {
            if (typeof items.$ref === 'string') nodeData.imported = true;
            else if (Array.isArray(items.allOf) && items.allOf.some((e: any) => e && typeof e.$ref === 'string')) nodeData.imported = true;
            else if (items.__from) nodeData.imported = true;
          }
        } catch (e) {
          /* ignore */
        }
      }
      // If enum, use enum node type
      if (Array.isArray(obj.enum)) {
        nodeType = 'enum';
        nodeData.enum = obj.enum;
      }
      if (parentId) {
        nodeData.required = isRequired;
      }
      nodes.push({
        id,
        type: nodeType,
        data: nodeData,
        position: { x, y },
      });
      if (parentId) {
        edges.push({ id: `e${parentId}-${id}`, source: parentId, target: id, type: 'default' });
      }
      // Properties and patternProperties for objects
      if (type === 'object') {
        let propY = y - 80;
        if (obj.properties) {
          for (const [key, propSchema] of Object.entries(obj.properties).filter(([k]) => !k.startsWith('__'))) {
            walkSchema(propSchema, id, key, x + 250, propY, obj.required || [], childRefAncestors);
            propY += 140;
          }
        }
        // Pattern properties (render as compact nodes labeled `pattern` and store regex in data.patternKey)
        if (obj.patternProperties && typeof obj.patternProperties === 'object') {
          for (const [pat, subschema] of Object.entries(obj.patternProperties)) {
            // Use a deterministic unique label for ID generation but display a concise 'pattern' label on the node
            const patLabelForId = `pattern: ${pat}`;
            const createdId = walkSchema(subschema, id, patLabelForId, x + 250, propY, obj.required || [], childRefAncestors);
            // Attach the raw pattern key to the node data so we can round-trip back to schema.patternProperties and show it in the RHS editor
            const createdNode = nodes.find(n => n.id === createdId);
            if (createdNode) {
              createdNode.data.patternKey = pat;
              createdNode.data.label = 'pattern';
            }
            propY += 140;
          }
        }

        // additionalProperties schema (object form) — render as a synthetic child so
        // combiners like additionalProperties.oneOf become visible/editable in the graph.
        if (obj.additionalProperties && typeof obj.additionalProperties === 'object' && !Array.isArray(obj.additionalProperties)) {
          const additionalPropertiesSchema = {
            ...(obj.additionalProperties as Record<string, unknown>),
            __autoExpandVariants: true,
          } as Record<string, unknown>;
          const additionalId = walkSchema(additionalPropertiesSchema, id, 'additionalProperties', x + 250, propY, obj.required || [], childRefAncestors);
          const additionalNode = nodes.find(n => n.id === additionalId);
          if (additionalNode) {
            (additionalNode.data as any).isAdditionalProperties = true;
          }
          propY += 140;
        }
      }
      // If array of objects, walk into properties of items, but do not create a subnode for 'items'
      if (type === 'array' && obj.items && ((Array.isArray(obj.items.type) && obj.items.type.includes('object')) || obj.items.type === 'object' || obj.items.properties)) {
        let propY = y - 80;
        for (const [key, propSchema] of Object.entries(obj.items.properties || {}).filter(([k]) => !k.startsWith('__'))) {
          walkSchema(propSchema, id, key, x + 250, propY, obj.items.required || [], childRefAncestors);
          propY += 140;
        }
      }

      // ── Combiner detection: oneOf / anyOf / allOf ─────────────────────────
      // allOf is only treated as a combiner when there is no outer $ref (otherwise
      // it is an import-marker and is handled by the imported detection above).
      const rawCombinerKey: 'oneOf' | 'anyOf' | 'allOf' | null =
        obj.oneOf ? 'oneOf'
        : obj.anyOf ? 'anyOf'
        : (obj.allOf && !obj.$ref && !(obj as any).__from) ? 'allOf'
        : null;

      if (rawCombinerKey) {
        const variantsArray = (obj[rawCombinerKey] as any[]) || [];
        const combinerId = `${id}.__combiner`;
        const autoExpandVariants = Boolean((obj as any).__autoExpandVariants);

        // Derive a display label for a variant entry using shared label utilities

        // Combiner node
        nodes.push({
          id: combinerId,
          type: 'combiner',
          data: {
            id: combinerId,
            label: rawCombinerKey,
            type: 'string' as any,
            combinerType: rawCombinerKey,
            variantCount: variantsArray.length,
            variantsExpanded: autoExpandVariants,
            parent: id,
            // handler callbacks are injected later via injectHandlers()
          } as any,
          position: { x: x + 300, y },
        });
        edges.push({ id: `e${id}-${combinerId}`, source: id, target: combinerId, type: 'default' });

        // Variant placeholder nodes (start hidden; expanded lazily)
        variantsArray.forEach((variant: any, i: number) => {
          const variantId = `${combinerId}.v${i}`;
          const varLabel = getVariantLabel(variant as Record<string, unknown>, i, variantsArray as Record<string, unknown>[]).title;
          const variantRef = (variant && typeof variant.$ref === 'string') ? variant.$ref : undefined;
          const variantItems = (variant && typeof variant === 'object' && !Array.isArray(variant) && (variant as any).items && typeof (variant as any).items === 'object')
            ? ((variant as any).items as Record<string, unknown>)
            : undefined;
          const variantOfType = inferArrayItemType(variant);
          nodes.push({
            id: variantId,
            type: 'variant',
            data: {
              id: variantId,
              label: varLabel,
              type: getVariantSchemaType(variant) as any,
              ...(variantItems ? { items: variantItems } : {}),
              ...(variantOfType ? { ofType: variantOfType } : {}),
              isCombinerVariant: true,
              variantIndex: i,
              variantRef,
              variantResolved: false,
              variantExpanded: false,
              variantSchema: variant,
              parent: combinerId,
              // handler callbacks injected later
            } as any,
            position: { x: x + 600, y: y + i * 60 },
            hidden: !autoExpandVariants,
          });
          edges.push({
            id: `e${combinerId}-${variantId}`,
            source: combinerId,
            target: variantId,
            type: 'default',
            hidden: !autoExpandVariants,
          });
        });
      }
      // ── end combiner detection ─────────────────────────────────────────────

      return id;
    }
    walkSchema(schema, undefined, 'Root', 0, 200);
    return { nodes, edges };
  }, [isXmlGraphMode, xmlSchemaToGraph]);

  // Relayout nodes into a horizontal tree using Dagre when available.
  // If Dagre is unavailable or fails, preserve current positions.
  const relayoutNodes = React.useCallback((rawInputNodes: Node<SchemaNodeData>[], inputEdges: Edge[]) => {
    if (!Array.isArray(rawInputNodes) || rawInputNodes.length === 0) return rawInputNodes;

    // Strip any inheritance-group boxes from a previous relayout pass — they're purely
    // decorative and recomputed fresh below from the new positions, never carried over.
    const inputNodes = rawInputNodes.filter(n => n.type !== 'inheritanceGroup');
    if (inputNodes.length === 0) return inputNodes;

    const visibleNodes = inputNodes.filter(n => !n.hidden);
    const hiddenNodes = inputNodes.filter(n => n.hidden);
    if (visibleNodes.length === 0) return inputNodes;

    const NODE_HEIGHT = 64;
    const COMBINER_HEIGHT = 48;  // compact: just type-label + picker buttons
    const VARIANT_HEIGHT = 52;   // header row + title row
    const CHAR_WIDTH = 8;
    const MIN_WIDTH = 180;
    const H_PADDING = 40;

    const estimateWidth = (n: Node<SchemaNodeData>) => {
      // Compositor nodes render only a small icon chip, not a text label.
      if (isXmlCompositorNode(n)) return 44;
      const lbl = (n.data && (n.data.label as string)) || '';
      // Combiner/variant nodes render fit-content and are compact; use a smaller minimum.
      const minW = (n.type === 'combiner' || n.type === 'variant') ? 80 : MIN_WIDTH;
      return Math.max(minW, lbl.length * CHAR_WIDTH + H_PADDING);
    };

    const estimateHeight = (n: Node<SchemaNodeData>) => {
      if (n.type === 'combiner') return COMBINER_HEIGHT;
      if (n.type === 'variant') return VARIANT_HEIGHT;
      return NODE_HEIGHT;
    };

    // Builds a decorative background box (`inheritanceGroup` node) behind each XML element/
    // complexType node tagged `xmlExtendsType` (via `xs:complexContent`/`xs:extension`) and the
    // descendant nodes tagged `xmlInheritedFrom` that same base type name, so inherited fields
    // are visually grouped with the node that inherits them. Purely additive/decorative — never
    // affects dagre's own layout, since it's computed from already-final node positions.
    const GROUP_PADDING = 16;
    const buildInheritanceGroupNodes = (laidOutNodes: Node<SchemaNodeData>[]): Node<SchemaNodeData>[] => {
      const visible = laidOutNodes.filter(n => !n.hidden);
      const groups: Node<SchemaNodeData>[] = [];
      visible.forEach((owner) => {
        // Handle both complexContent inheritance (xmlExtendsType) and substitution groups (xmlSubstitutionGroupParent)
        const baseTypeName = (owner.data as any)?.xmlExtendsType || (owner.data as any)?.xmlSubstitutionGroupParent;
        const inheritanceMode = (owner.data as any)?.xmlExtendsType ? 'extends' : (owner.data as any)?.xmlSubstitutionGroupParent ? 'substitutes' : undefined;
        if (!baseTypeName || !inheritanceMode) return;
        const memberPrefix = `${owner.id}.`;
        const members = visible.filter(n => n.id !== owner.id && n.id.startsWith(memberPrefix) && (n.data as any)?.xmlInheritedFrom === baseTypeName);
        if (members.length === 0) return;

        // Anchor the box's left edge at the owner node's own right edge (not around the owner
        // itself) so it wraps only the inherited descendant nodes, like a bracket around "just
        // the properties" rather than enclosing the owner node too. Left edge is fixed there
        // (no padding) so the box never overlaps back over the owner node.
        const minX = owner.position.x + estimateWidth(owner);
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        members.forEach((m) => {
          minY = Math.min(minY, m.position.y);
          maxX = Math.max(maxX, m.position.x + estimateWidth(m));
          maxY = Math.max(maxY, m.position.y + estimateHeight(m));
        });

        const label = inheritanceMode === 'extends' ? `inherits ${baseTypeName}` : `substitutes ${baseTypeName}`;
        groups.push({
          id: `${owner.id}.inheritance-group`,
          type: 'inheritanceGroup',
          position: { x: minX, y: minY - GROUP_PADDING * 2.5 },
          style: { width: maxX - minX + GROUP_PADDING, height: maxY - minY + GROUP_PADDING * 3.5 },
          data: { label } as any,
          draggable: false,
          selectable: false,
          focusable: false,
          zIndex: -1,
        } as Node<SchemaNodeData>);
      });
      return groups;
    };

    // Appended (not prepended) so `nodes[0]` stays the real root/first node — several
    // selection fallbacks elsewhere default to `nodes[0]` when nothing is selected, and an
    // inheritanceGroup node accidentally becoming that default selection shows a bogus
    // generic property editor. `zIndex: -1` (set on each group node) keeps them rendered
    // behind everything else regardless of array order.
    const withInheritanceGroups = (laidOutNodes: Node<SchemaNodeData>[]): Node<SchemaNodeData>[] =>
      [...laidOutNodes, ...buildInheritanceGroupNodes(laidOutNodes)];

    // Preserves document/schema order (the order nodes were pushed while building the graph —
    // property insertion order for JSON, array order for XML) as the tiebreaker instead of
    // alphabetical label order, so dagre lays out siblings top-to-bottom in schema order. This
    // is what makes drag-to-reorder (`handleNodeDragStop`) visually "stick": after a reorder
    // mutation the schema/array order changes, the graph gets rebuilt from it, and this order
    // is what dagre uses to position the reordered siblings.
    const originalIndexById = new Map(inputNodes.map((n, i) => [n.id, i]));
    const compareLayoutSiblings = (a: Node<SchemaNodeData>, b: Node<SchemaNodeData>) => {
      const aParent = (((a.data as any)?.parent as string) || '');
      const bParent = (((b.data as any)?.parent as string) || '');
      const byParent = aParent.localeCompare(bParent, undefined, { numeric: true, sensitivity: 'base' });
      if (byParent !== 0) return byParent;

      if (a.type === 'variant' && b.type === 'variant') {
        const aIndex = Number(((a.data as any)?.variantIndex ?? 0));
        const bIndex = Number(((b.data as any)?.variantIndex ?? 0));
        if (aIndex !== bIndex) return aIndex - bIndex;
      }

      const aOrder = originalIndexById.get(a.id) ?? 0;
      const bOrder = originalIndexById.get(b.id) ?? 0;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' });
    };

    const orderedVisibleNodes = [...visibleNodes].sort(compareLayoutSiblings);
    const visibleNodeById = new Map(orderedVisibleNodes.map((n) => [n.id, n]));

    const DAGRE_NODE_SEP = 32;
    const DAGRE_RANK_SEP = 35;
    const SIBLING_COMPACTION_MIN_GAP = 8;
    const SIBLING_COMPACTION_MAX_DESIRED_GAP = 24;
    const SIBLING_COMPACTION_MAX_ALLOWED_GAP = 56;
    const SIBLING_COMPACTION_GAP_FACTOR = 3;

    // Dagre can occasionally produce very large vertical gaps between adjacent siblings.
    // Compact those outliers by pulling the current and following siblings closer while
    // preserving sibling order and leaving modest/intentional spacing untouched.
    const compactSiblingVerticalGaps = (laidOutNodes: Node<SchemaNodeData>[]) => {
      const byParent = new Map<string, Node<SchemaNodeData>[]>();
      laidOutNodes.forEach((n) => {
        const parentId = ((n.data as any)?.parent as string | undefined) || '';
        const siblings = byParent.get(parentId);
        if (siblings) {
          siblings.push(n);
        } else {
          byParent.set(parentId, [n]);
        }
      });

      const updatedById = new Map(laidOutNodes.map((n) => [n.id, n]));

      for (const siblings of byParent.values()) {
        if (siblings.length < 2) continue;
        const ordered = [...siblings].sort(compareLayoutSiblings);

        for (let i = 1; i < ordered.length; i += 1) {
          const prev = updatedById.get(ordered[i - 1].id);
          const curr = updatedById.get(ordered[i].id);
          if (!prev || !curr) continue;

          const prevBottom = (prev.position?.y ?? 0) + estimateHeight(prev);
          const currentTop = curr.position?.y ?? 0;
          const gap = currentTop - prevBottom;

          const desiredGap = Math.max(
            SIBLING_COMPACTION_MIN_GAP,
            Math.min(
              SIBLING_COMPACTION_MAX_DESIRED_GAP,
              Math.round((estimateHeight(prev) + estimateHeight(curr)) / 8),
            ),
          );
          const maxAllowedGap = Math.max(
            SIBLING_COMPACTION_MAX_ALLOWED_GAP,
            desiredGap * SIBLING_COMPACTION_GAP_FACTOR,
          );
          if (gap <= maxAllowedGap) continue;

          const shiftUp = gap - desiredGap;
          for (let j = i; j < ordered.length; j += 1) {
            const nodeToShift = updatedById.get(ordered[j].id);
            if (!nodeToShift) continue;
            updatedById.set(nodeToShift.id, {
              ...nodeToShift,
              position: {
                ...nodeToShift.position,
                y: (nodeToShift.position?.y ?? 0) - shiftUp,
              },
            });
          }
        }
      }

      return laidOutNodes.map((n) => updatedById.get(n.id) || n);
    };

    // Try dagre
    if (dagreLib) {
      try {
        const g = new dagreLib.graphlib.Graph();
        g.setGraph({ rankdir: 'LR', nodesep: DAGRE_NODE_SEP, ranksep: DAGRE_RANK_SEP });
        g.setDefaultEdgeLabel(() => ({}));

        // All visible nodes go into dagre — let it handle spacing for
        // combiner and variant nodes using normal edge lengths.
        for (const n of orderedVisibleNodes) {
          g.setNode(n.id, { width: estimateWidth(n), height: estimateHeight(n) });
        }

        const visibleIds = new Set(orderedVisibleNodes.map(n => n.id));
        const orderedVisibleEdges = (inputEdges || [])
          .filter((e) => e.source && e.target && !e.hidden && visibleIds.has(e.source) && visibleIds.has(e.target))
          .sort((a, b) => {
            const bySource = (a.source || '').localeCompare((b.source || ''), undefined, { numeric: true, sensitivity: 'base' });
            if (bySource !== 0) return bySource;
            const aTargetNode = a.target ? visibleNodeById.get(a.target) : undefined;
            const bTargetNode = b.target ? visibleNodeById.get(b.target) : undefined;
            if (aTargetNode && bTargetNode) {
              const byTargetNode = compareLayoutSiblings(aTargetNode, bTargetNode);
              if (byTargetNode !== 0) return byTargetNode;
            }
            return (a.target || '').localeCompare((b.target || ''), undefined, { numeric: true, sensitivity: 'base' });
          });

        for (const e of orderedVisibleEdges) {
          g.setEdge(e.source!, e.target!);
        }

        dagreLib.layout(g);

        const finalLaid = visibleNodes.map(n => {
          const dn = g.node(n.id);
          if (!dn) return n;
          return { ...n, position: { x: dn.x - dn.width / 2, y: dn.y - dn.height / 2 } };
        });
        const compactedFinalLaid = compactSiblingVerticalGaps(finalLaid);

        // Layout mode toggle for experimentation and debugging.
        // Current default keeps Dagre positions for combiner + variant nodes.
        const COMBINER_VARIANT_LAYOUT_MODE: 'manual' | 'dagre-variants' | 'dagre-all' = 'dagre-all';
        if (COMBINER_VARIANT_LAYOUT_MODE === 'dagre-all') {
          return withInheritanceGroups([...compactedFinalLaid, ...hiddenNodes]);
        }

        const useDagreVariantLayout = COMBINER_VARIANT_LAYOUT_MODE === 'dagre-variants';
        return withInheritanceGroups(applySnappedDagreLayout({
          finalLaid: compactedFinalLaid,
          hiddenNodes,
          dagreNodeFor: (id) => g.node(id),
          estimateWidth,
          estimateHeight,
          compareLayoutSiblings,
          useDagreVariantLayout,
          nodeGap: 16,
          ranksep: DAGRE_RANK_SEP,
          additionalPropertiesGap: 60,
        }));
      } catch (err) {
        // If Dagre fails, keep current positions.
      }
    }

    // No heuristic fallback: preserve current positions when Dagre isn't available.
    return withInheritanceGroups(inputNodes);
  }, []);

  const preserveAnchorY = React.useCallback((
    nextNodes: Node<SchemaNodeData>[],
    prevNodes: Node<SchemaNodeData>[],
    anchorId?: string | null,
  ) => {
    if (!anchorId) return nextNodes;
    const prevAnchor = prevNodes.find((n) => n.id === anchorId);
    const nextAnchor = nextNodes.find((n) => n.id === anchorId);
    if (!prevAnchor || !nextAnchor) return nextNodes;
    const prevY = prevAnchor.position?.y;
    const nextY = nextAnchor.position?.y;
    if (typeof prevY !== 'number' || typeof nextY !== 'number') return nextNodes;
    const deltaY = prevY - nextY;
    if (Math.abs(deltaY) < 0.5) return nextNodes;
    return nextNodes.map((n) => ({
      ...n,
      position: { ...n.position, y: (n.position?.y ?? 0) + deltaY },
    }));
  }, []);

  // Build a JSON Schema from the current nodes collection (authoritative)
  const buildSchemaFromNodes = (allNodes: Node<SchemaNodeData>[]) => {
    const root = allNodes.find(n => n.type === 'root') || allNodes.find(n => n.data && n.data.label === 'Root') || allNodes.find(n => n.id === '1');
    if (!root) return {} as Record<string, unknown>;

    // Recursive builder: assemble schema for a node by finding its children
    const buildNodeSchema = (node: Node<SchemaNodeData>): Record<string, unknown> => {
      // Check if this node has a combiner child
      const combinerChild = allNodes.find(n => n.type === 'combiner' && n.data && (n.data as any).parent === node.id);

      if (combinerChild) {
        // Build base with only metadata (no type — combiners replace the type)
        const base: Record<string, unknown> = {};
        if (node.data.description) base.description = node.data.description;
        if ((node.data as any).$comment) base.$comment = (node.data as any).$comment;
        if (node.data.label && node.id !== '1') base.title = node.data.label;
        const combinerType = ((combinerChild.data as any).combinerType as string) || 'oneOf';
        // Collect variant children in order
        const variantChildren = allNodes
          .filter(n => n.type === 'variant' && n.data && (n.data as any).parent === combinerChild.id)
          .sort((a, b) => (((a.data as any).variantIndex) || 0) - (((b.data as any).variantIndex) || 0));
        const variants = variantChildren.map(v => {
          const vData = v.data as any;
          // Not yet expanded: return the original raw variant schema
          if (!vData.variantResolved || !vData.variantExpanded) {
            return vData.variantSchema || (vData.variantRef ? { $ref: vData.variantRef } : { type: 'string' });
          }
          // Expanded and resolved: rebuild from child property nodes
          const childProps = allNodes.filter(n =>
            (n.type === 'property' || n.type === 'enum') && n.data && (n.data as any).parent === v.id
          );
          if (childProps.length === 0) {
            return vData.variantSchema || { type: 'string' };
          }
          const props: Record<string, unknown> = {};
          const required: string[] = [];
          let additionalPropertiesSchema: Record<string, unknown> | undefined;
          childProps.forEach(child => {
            const key = child.data.label;
            const isAdditionalProperties = Boolean((child.data as any)?.isAdditionalProperties);
            if (isAdditionalProperties) {
              additionalPropertiesSchema = buildNodeSchema(child);
              return;
            }
            if (key && !key.startsWith('__')) {
              props[key] = buildNodeSchema(child);
              if ((child.data as any).required) required.push(key);
            }
          });
          const variantObjectSchema: Record<string, unknown> = {
            type: 'object',
            ...vData.variantSchema,
            properties: props,
            ...(required.length > 0 ? { required } : {}),
          };
          if (additionalPropertiesSchema) {
            variantObjectSchema.additionalProperties = additionalPropertiesSchema;
          }
          return variantObjectSchema;
        });
        return { ...base, [combinerType]: variants };
      }

      const base = schemaNodeDataToSchema(node.data as SchemaNodeData) as any;
      if (node.data.type === 'object') {
        const props: Record<string, unknown> = {};
        const patternProps: Record<string, unknown> = {};
        const requiredList: string[] = [];
        allNodes.forEach(child => {
          // Skip combiner nodes — they are handled via the combinerChild path above
          if (child.type === 'combiner' || child.type === 'variant') return;
          if (child.data && child.data.parent === node.id) {
            const key = child.data.label;
            const patternKey = (child.data as any).patternKey;
            const isAdditionalProperties = Boolean((child.data as any).isAdditionalProperties);
            if (patternKey) {
              patternProps[patternKey] = buildNodeSchema(child);
            } else if (isAdditionalProperties) {
              base.additionalProperties = buildNodeSchema(child);
            } else {
              if (key) props[key] = buildNodeSchema(child);
              if (child.data && (child.data as any).required) {
                if (key) requiredList.push(key);
              }
            }
          }
        });
        if (Object.keys(props).length > 0) base.properties = props;
        if (Object.keys(patternProps).length > 0) base.patternProperties = patternProps;
        if (requiredList.length > 0) base.required = requiredList;
      }
      if (node.data.type === 'array') {
        // If array of objects, collect children as items.properties
        if (node.data.ofType === 'object') {
          const itemProps: Record<string, unknown> = {};
          const itemRequired: string[] = [];
          allNodes.forEach(child => {
            if (child.type === 'combiner' || child.type === 'variant') return;
            if (child.data && child.data.parent === node.id) {
              const key = child.data.label;
              if (key) itemProps[key] = buildNodeSchema(child);
              if (child.data && (child.data as any).required) {
                if (key) itemRequired.push(key);
              }
            }
          });
          if (Object.keys(itemProps).length > 0) {
            base.items = { type: 'object', properties: itemProps } as any;
            if (itemRequired.length > 0) (base.items as any).required = itemRequired;
          }
        } else {
          // For primitives, preserve items enum if present on node.data
          if (node.data.items && (node.data.items as any).enum) {
            base.items = { ...(base.items || {}), enum: (node.data.items as any).enum };
          }
        }
      }
      return base;
    };

    // Check if root itself has a combiner child
    const rootCombiner = allNodes.find(n => n.type === 'combiner' && n.data && (n.data as any).parent === root.id);
    if (rootCombiner) {
      return buildNodeSchema(root);
    }

    const schema: Record<string, unknown> = { type: root.data.type, title: root.data.label };
    // Preserve root annotation fields (description and $comment)
    if (root.data && root.data.description !== undefined) schema.description = root.data.description as string;
    if (root.data && root.data.contentMediaType !== undefined) schema.contentMediaType = root.data.contentMediaType as string;
    if (root.data && root.data.contentEncoding !== undefined) schema.contentEncoding = root.data.contentEncoding as string;
    if (root.data && (root.data as any).$comment !== undefined) schema.$comment = (root.data as any).$comment;
    const props: Record<string, unknown> = {};
    allNodes.forEach(n => {
      // Skip combiner/variant infrastructure nodes — they're rebuilt via buildNodeSchema above
      if (n.type === 'combiner' || n.type === 'variant') return;
      if (n.data && n.data.parent === root.id) {
        const key = n.data.label;
        if (key) props[key] = buildNodeSchema(n);
      }
    });
    if (Object.keys(props).length > 0) schema.properties = props;
    return schema;
  };

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const nodesRef = React.useRef<Node<SchemaNodeData>[]>(nodes);
  nodesRef.current = nodes;
  // Ref that always holds the latest edges so async callbacks can read them
  const edgesRef = React.useRef(edges);
  edgesRef.current = edges;
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  // When we emit a schema update originating from this component, skip
  // syncing back from the `schema` prop for that single change to avoid
  // tearing down and rebuilding nodes (which causes selection loss).
  const skipSchemaSyncRef = React.useRef(false);
  const expansionStateRef = React.useRef<ExpansionState>((() => {
    const runtime = globalThis as typeof globalThis & { __graphicalSchemaExpansionState?: ExpansionState };
    if (!runtime.__graphicalSchemaExpansionState) {
      runtime.__graphicalSchemaExpansionState = { combiners: {}, variants: {} };
    }
    return runtime.__graphicalSchemaExpansionState;
  })());
  const pendingLocalSchemaFingerprintRef = React.useRef<string | null>(null);
  const writeExpansionState = React.useCallback((nextState: ExpansionState) => {
    expansionStateRef.current = nextState;
    const runtime = globalThis as typeof globalThis & { __graphicalSchemaExpansionState?: ExpansionState };
    runtime.__graphicalSchemaExpansionState = nextState;
  }, []);
  // Persists which plain (property/globalType/enum) nodes the user has manually collapsed,
  // keyed by globalThis like `__graphicalSchemaExpansionState` above, so that switching tabs
  // away from and back to the graphical editor (which fully unmounts/remounts it) restores the
  // user's own collapse state instead of resetting to the default "collapse everything below
  // root's direct children" heuristic.
  hydrateCollapseStateFromStorageIfNeeded();
  const collapsedNodeIdsRef = React.useRef<Set<string>>((() => {
    const runtime = globalThis as typeof globalThis & { __graphicalSchemaCollapsedNodeIds?: Set<string> };
    if (!runtime.__graphicalSchemaCollapsedNodeIds) {
      runtime.__graphicalSchemaCollapsedNodeIds = new Set<string>();
    }
    return runtime.__graphicalSchemaCollapsedNodeIds;
  })());
  // Ids explicitly expanded (by the user, or by lazily fetching an already-visited node's
  // children) — distinct from "absent from `collapsedNodeIdsRef`", which can also mean
  // "never decided yet" (e.g. a node whose children weren't fetched during the initial lazy
  // load). Without this, a rebuild that suddenly sees the node's real children for the first
  // time (e.g. `visibleOnly: false` after some other node was toggled) would treat it as
  // "never collapsed" and show it fully expanded instead of applying the collapsed default.
  const expandedNodeIdsRef = React.useRef<Set<string>>((() => {
    const runtime = globalThis as typeof globalThis & { __graphicalSchemaExpandedNodeIds?: Set<string> };
    if (!runtime.__graphicalSchemaExpandedNodeIds) {
      runtime.__graphicalSchemaExpandedNodeIds = new Set<string>();
    }
    return runtime.__graphicalSchemaExpandedNodeIds;
  })());
  // Tracks which schema (by fingerprint) `collapsedNodeIdsRef`/`expandedNodeIdsRef`/
  // `hasUserToggledChildrenRef` currently describe, so that loading a genuinely *different*
  // schema resets collapse tracking instead of accumulating unrelated node ids (and the
  // "has ever toggled" flag) forever across every schema ever opened in this tab.
  const collapsedNodeIdsSchemaKeyRef = React.useRef<string | null>((() => {
    const runtime = globalThis as typeof globalThis & { __graphicalSchemaCollapsedNodeIdsKey?: string | null };
    return runtime.__graphicalSchemaCollapsedNodeIdsKey ?? null;
  })());
  const resetCollapsedNodeIdsForSchema = React.useCallback((schemaKey: string | null) => {
    if (collapsedNodeIdsSchemaKeyRef.current === schemaKey) return;
    collapsedNodeIdsSchemaKeyRef.current = schemaKey;
    // Rather than unconditionally clearing, check whether this exact schema already has a
    // persisted collapse shape from a previous page load — without this, a transient earlier
    // render with a *different* (e.g. default/placeholder, pre-hydration) schema would clear the
    // globalThis containers that were just seeded from localStorage for this schema before this
    // schema's own render ever got a chance to use them, permanently losing the restored shape.
    const persisted = loadPersistedCollapseState();
    if (persisted && persisted.schemaKey === schemaKey) {
      collapsedNodeIdsRef.current = new Set(persisted.collapsed);
      expandedNodeIdsRef.current = new Set(persisted.expanded);
      hasUserToggledChildrenRef.current = persisted.userToggled;
    } else {
      collapsedNodeIdsRef.current.clear();
      expandedNodeIdsRef.current.clear();
      hasUserToggledChildrenRef.current = false;
    }
    const runtime = globalThis as typeof globalThis & {
      __graphicalSchemaCollapsedNodeIds?: Set<string>;
      __graphicalSchemaExpandedNodeIds?: Set<string>;
      __graphicalSchemaCollapsedNodeIdsKey?: string | null;
      __graphicalSchemaUserToggledChildren?: boolean;
    };
    runtime.__graphicalSchemaCollapsedNodeIds = collapsedNodeIdsRef.current;
    runtime.__graphicalSchemaExpandedNodeIds = expandedNodeIdsRef.current;
    runtime.__graphicalSchemaCollapsedNodeIdsKey = schemaKey;
    runtime.__graphicalSchemaUserToggledChildren = hasUserToggledChildrenRef.current;
    persistCollapseState();
  }, []);
  const hasUserToggledChildrenRef = React.useRef<boolean>((() => {
    const runtime = globalThis as typeof globalThis & { __graphicalSchemaUserToggledChildren?: boolean };
    return Boolean(runtime.__graphicalSchemaUserToggledChildren);
  })());
  const markUserToggledChildren = React.useCallback(() => {
    hasUserToggledChildrenRef.current = true;
    const runtime = globalThis as typeof globalThis & { __graphicalSchemaUserToggledChildren?: boolean };
    runtime.__graphicalSchemaUserToggledChildren = true;
  }, []);
  // Mirrors the current collapse-state refs into localStorage so the graph's expand/collapse
  // shape survives a real browser refresh, not just a tab switch (globalThis is wiped on reload).
  const persistCollapseState = React.useCallback(() => {
    savePersistedCollapseState({
      schemaKey: collapsedNodeIdsSchemaKeyRef.current,
      collapsed: Array.from(collapsedNodeIdsRef.current),
      expanded: Array.from(expandedNodeIdsRef.current),
      userToggled: hasUserToggledChildrenRef.current,
    });
  }, []);
  const setVariantExpandedPersisted = React.useCallback((variantId: string, expanded: boolean) => {
    const current = expansionStateRef.current;
    const nextVariants = { ...current.variants };
    if (expanded) nextVariants[variantId] = true;
    else delete nextVariants[variantId];
    writeExpansionState({ combiners: { ...current.combiners }, variants: nextVariants });
  }, [writeExpansionState]);
  const setCombinerExpandedPersisted = React.useCallback((combinerId: string, expanded: boolean) => {
    const current = expansionStateRef.current;
    const nextCombiners = { ...current.combiners };
    if (expanded) nextCombiners[combinerId] = true;
    else delete nextCombiners[combinerId];
    writeExpansionState({ combiners: nextCombiners, variants: { ...current.variants } });
  }, [writeExpansionState]);
  const fingerprintSchema = React.useCallback((value: unknown): string | null => {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }, []);
  const emitLocalSchemaUpdate = React.useCallback((nextSchema: Record<string, unknown>) => {
    pendingLocalSchemaFingerprintRef.current = fingerprintSchema(nextSchema);
    skipSchemaSyncRef.current = true;
    onChange(nextSchema);
  }, [fingerprintSchema, onChange]);

  // ──────────────────────────────────────────────────────────────────────
  // Combiner / variant handler infrastructure
  // ──────────────────────────────────────────────────────────────────────

  // Live ref populated after all handlers are defined (avoids stale-closure issues)
  const nodeHandlersRef = React.useRef<Record<string, (...args: any[]) => void>>({});

  // Inject live handler functions into combiner/variant node data
  const injectHandlers = React.useCallback((inputNodes: Node<SchemaNodeData>[]) =>
    inputNodes.map(n =>
      (n.type === 'combiner' || n.type === 'variant')
        ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } }
        : n
    ), []);

  // Resolve a JSON $ref path (e.g. "#/definitions/Foo") from the current schema prop
  const resolveRefInSchema = React.useCallback((ref: string): Record<string, unknown> | null => {
    if (!schema || !ref.startsWith('#/')) return null;
    const parts = ref.replace('#/', '').split('/');
    let cur: any = schema;
    for (const part of parts) {
      if (cur == null || typeof cur !== 'object') return null;
      cur = cur[part];
    }
    return (cur && typeof cur === 'object') ? cur : null;
  }, [schema]);

  // Toggle a variant node expand / collapse; lazily resolve $ref on first expand
  const handleToggleVariant = React.useCallback((variantId: string) => {

    // Use setNodes functional updater so we always read the freshest state.
    // Any sub-graph computation that doesn't need prev-nodes is done eagerly here
    // so we can also call setEdges synchronously before the React batch flushes.

    setNodes(prev => {
      const variantNode = prev.find(n => n.id === variantId);
      if (!variantNode) return prev;
      const vData = variantNode.data as any;
      const willExpand = !vData.variantExpanded;
      setVariantExpandedPersisted(variantId, willExpand);
      if (typeof vData.parent === 'string' && willExpand) {
        setCombinerExpandedPersisted(vData.parent, true);
      }

      // Run relayout+handler-inject synchronously so there is only one committed
      // state (no flash from un-snapped positions on an intermediate render).
      // Accepts the edges that will apply after this update (not edgesRef.current
      // which still reflects the pre-update state at this point in the batch).
      const applyRelayout = (ns: Node<SchemaNodeData>[], es: Edge[]) => {
        const laid = relayoutNodes(ns, es);
        const anchored = preserveAnchorY(laid, prev, variantId);
        return anchored.map(n =>
          (n.type === 'combiner' || n.type === 'variant')
            ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } }
            : n
        );
      };

      if (willExpand && !vData.variantResolved) {
        let resolved: Record<string, unknown> | null = null;
        if (vData.variantRef) {
          resolved = resolveRefInSchema(vData.variantRef);
        } else if (vData.variantSchema && typeof vData.variantSchema === 'object') {
          resolved = vData.variantSchema as Record<string, unknown>;
        }
        if (!resolved) {
          return prev.map(n =>
            n.id === variantId
              ? { ...n, data: { ...n.data, variantExpanded: true, variantResolved: true, isResolving: false } as any }
              : n
          );
        }

        const subGraph = schemaToGraph(resolved as any);
        const idMap: Record<string, string> = {};
        subGraph.nodes.forEach((sn: Node<SchemaNodeData>) => { idMap[sn.id] = `${variantId}.__${sn.id}`; });

        const subNodes: Node<SchemaNodeData>[] = subGraph.nodes
          .filter((sn: Node<SchemaNodeData>) => sn.id !== '1')
          .map((sn: Node<SchemaNodeData>) => ({
            ...sn,
            id: idMap[sn.id],
            hidden: false,
            data: {
              ...sn.data,
              id: idMap[sn.id],
              parent: sn.data.parent === '1'
                ? variantId
                : (sn.data.parent ? (idMap[sn.data.parent] ?? `${variantId}.__${sn.data.parent}`) : variantId),
            } as SchemaNodeData,
          }));

        const subNodeIds = new Set(subNodes.map((n: Node<SchemaNodeData>) => n.id));

        const repairedSubNodes: Node<SchemaNodeData>[] = subNodes.map((sn: Node<SchemaNodeData>) => {
          const parent = (sn.data as any)?.parent as string | undefined;
          const parentIsValid = parent === variantId || (parent ? subNodeIds.has(parent) : false);
          if (parentIsValid) return sn;
          return {
            ...sn,
            data: { ...sn.data, parent: variantId } as SchemaNodeData,
          };
        });

        const repairedSubNodeIds = new Set(repairedSubNodes.map((n: Node<SchemaNodeData>) => n.id));

        const subEdgesFromGraph: Edge[] = subGraph.edges
          .filter((se: Edge) => se.target !== '1')
          .map((se: Edge) => {
            const src = se.source === '1' ? variantId : (idMap[se.source] ?? se.source);
            const tgt = idMap[se.target] ?? se.target;
            return { ...se, id: `e${src}-${tgt}`, source: src, target: tgt, hidden: false };
          });

        const subEdgesFromParents: Edge[] = repairedSubNodes
          .map((n: Node<SchemaNodeData>) => {
            const parentId = (n.data as any)?.parent as string | undefined;
            if (!parentId) return null;
            if (parentId !== variantId && !repairedSubNodeIds.has(parentId)) return null;
            return {
              id: `e${parentId}-${n.id}`,
              source: parentId,
              target: n.id,
              type: 'default',
              hidden: false,
            } as Edge;
          })
          .filter((e): e is Edge => Boolean(e));

        const subEdgesMap = new Map<string, Edge>();
        [...subEdgesFromGraph, ...subEdgesFromParents].forEach((e: Edge) => {
          subEdgesMap.set(e.id, e);
        });
        const subEdges = Array.from(subEdgesMap.values());

        // Compute new edges synchronously so applyRelayout sees them immediately
        const newEdges: Edge[] = [
          ...edgesRef.current.map((e: Edge) => e.target === variantId ? { ...e, hidden: false } : e),
          ...subEdges,
        ];

        const finalNodes = applyRelayout([
          ...prev.map((n: Node<SchemaNodeData>) =>
            n.id === variantId
              ? { ...variantNode, data: { ...vData, variantExpanded: true, variantResolved: true, isResolving: false } as any }
              : n
          ),
          ...injectHandlers(repairedSubNodes),
        ], newEdges);
        // Newly revealed nodes had no real dagre position while hidden, so handles computed
        // against their old placeholder position can point at the parent's wrong (rear) side —
        // recompute now that finalNodes holds real laid-out positions.
        setEdges(() => applyEdgePositioningCached(newEdges, finalNodes) as Edge[]);
        return finalNodes;
      }

      if (willExpand) {
        const willExpand_edges = edgesRef.current.map((e: Edge) =>
          e.source === variantId || e.target === variantId ? { ...e, hidden: false } : e
        );
        const finalNodes = applyRelayout(prev.map((n: Node<SchemaNodeData>) => {
          if (n.id === variantId) return { ...n, data: { ...n.data, variantExpanded: true } as any };
          if ((n.data as any)?.parent === variantId) return { ...n, hidden: false };
          return n;
        }), willExpand_edges);
        setEdges(() => applyEdgePositioningCached(willExpand_edges, finalNodes) as Edge[]);
        return finalNodes;
      }

      // Collapse — hide all descendants recursively
      const toHide = new Set<string>();
      const collectDesc = (pid: string) => {
        prev.forEach((n: Node<SchemaNodeData>) => {
          if ((n.data as any)?.parent === pid) { toHide.add(n.id); collectDesc(n.id); }
        });
      };
      collectDesc(variantId);
      const collapseEdges = edgesRef.current.map((e: Edge) =>
        toHide.has(e.source) || toHide.has(e.target) ? { ...e, hidden: true } : e
      );
      setEdges(() => collapseEdges);
      pendingCenterRef.current = true;
      pendingCenterNodeIdRef.current = variantId;
      const collapsed = applyRelayout(prev.map((n: Node<SchemaNodeData>) => {
        if (n.id === variantId) return { ...n, data: { ...n.data, variantExpanded: false } as any };
        if (toHide.has(n.id)) return { ...n, hidden: true };
        return n;
      }), collapseEdges);
      return preserveAnchorY(collapsed, prev, variantId);
    });
  }, [edgesRef, injectHandlers, nodeHandlersRef, resolveRefInSchema, schemaToGraph, relayoutNodes, preserveAnchorY, setEdges, setNodes, setVariantExpandedPersisted, setCombinerExpandedPersisted]);

  // Whether a node's own children (properties/descendants) are currently displayed —
  // used when expanding an ancestor so we don't blow past a nested node's own collapsed state.
  const isNodeDisplayCollapsed = (n: Node<SchemaNodeData>): boolean => {
    const d = n.data as any;
    if (n.type === 'variant') return !d.variantExpanded;
    if (n.type === 'combiner') return !d.variantsExpanded;
    return Boolean(d.childrenCollapsed);
  };

  const collectDescendantIds = React.useCallback((parentId: string, allNodes: Node<SchemaNodeData>[]): string[] => {
    const result: string[] = [];
    const walk = (pid: string) => {
      allNodes.forEach(n => {
        if ((n.data as any)?.parent === pid) {
          result.push(n.id);
          walk(n.id);
        }
      });
    };
    walk(parentId);
    return result;
  }, []);

  // Generic collapse/expand toggle for any node's children — mirrors the variant/combiner
  // collapse pattern above, but works for plain property/globalType/enum/root nodes whose
  // children already exist in the graph (no lazy $ref resolution needed).
  const handleToggleNodeChildren = React.useCallback((nodeId: string) => {
    userToggledChildrenRef.current = true;
    markUserToggledChildren();
    // Determine willCollapse and mutate the collapse-state refs synchronously (outside the
    // setNodes updater) so persistCollapseState(), called right after setNodes() below, reads
    // up-to-date ref values — setNodes' functional updater isn't invoked until the next render,
    // so mutating these refs inside it would make a same-tick persistCollapseState() call see stale state.
    const targetNodeForToggle = nodesRef.current.find((n) => n.id === nodeId);
    const willCollapse = !((targetNodeForToggle?.data as any)?.childrenCollapsed);
    if (targetNodeForToggle) {
      if (willCollapse) {
        collapsedNodeIdsRef.current.add(nodeId);
        expandedNodeIdsRef.current.delete(nodeId);
      } else {
        collapsedNodeIdsRef.current.delete(nodeId);
        expandedNodeIdsRef.current.add(nodeId);
      }
    }
    setNodes((prev: Node<SchemaNodeData>[]) => {
      const targetNode = prev.find(n => n.id === nodeId);
      if (!targetNode) return prev;
      let nodesToUse = prev;
      let edgesToUse = edgesRef.current;
      if (isXmlGraphMode && !willCollapse && (targetNode.data as any).hasHiddenChildren) {
        const hasVisibleChildren = prev.some((n) => (n.data as any)?.parent === nodeId);
        if (!hasVisibleChildren) {
          const fullGraph = schemaToGraph(schema as Record<string, unknown>);
          const existingIds = new Set(prev.map((n) => n.id));
          const additionalNodes = fullGraph.nodes.filter((n) => !existingIds.has(n.id));
          const additionalEdges = fullGraph.edges.filter((e) => !existingIds.has(e.source) || !existingIds.has(e.target));
          if (additionalNodes.length > 0) {
            const childParentIds = new Set(additionalNodes.map((n) => (n.data as any)?.parent).filter(Boolean));
            const directChildIds = new Set(additionalNodes.filter((n) => (n.data as any)?.parent === nodeId).map((n) => n.id));
            const collapsedAdditionalNodes = additionalNodes.map((n) => {
              const nodeData = n.data as any;
              const hasChildren = childParentIds.has(n.id);
              const shouldCollapse = n.id !== nodeId && hasChildren && n.type !== 'combiner' && n.type !== 'variant' && !isXmlCompositorNode(n);
              // Lazily-fetched nodes are collapsed by default (mirrors the initial-load
              // heuristic in the schema-sync effect) — persist that so a later remount
              // restores this node's collapsed state instead of showing it expanded.
              if (shouldCollapse) collapsedNodeIdsRef.current.add(n.id);
              return {
                ...n,
                hidden: n.id !== nodeId && !directChildIds.has(n.id),
                data: hasChildren ? { ...nodeData, hasHiddenChildren: true, childrenCollapsed: shouldCollapse || Boolean(nodeData.childrenCollapsed) } : nodeData,
              } as Node<SchemaNodeData>;
            });
            nodesToUse = [...prev, ...collapsedAdditionalNodes];
          }
          if (additionalEdges.length > 0) {
            edgesToUse = [...edgesRef.current, ...additionalEdges];
            setEdges(() => edgesToUse);
          }
        }
      }

      if (willCollapse) {
        const toHide = new Set(collectDescendantIds(nodeId, nodesToUse));
        const nextEdges = edgesRef.current.map((e: Edge) =>
          (toHide.has(e.source) || toHide.has(e.target)) ? { ...e, hidden: true } : e
        );
        setEdges(() => nextEdges);
        const updated = nodesToUse.map((n: Node<SchemaNodeData>) => {
          if (n.id === nodeId) return { ...n, data: { ...n.data, childrenCollapsed: true } };
          if (toHide.has(n.id)) return { ...n, hidden: true };
          return n;
        });
        pendingCenterRef.current = true;
        pendingCenterNodeIdRef.current = nodeId;
        const laidCollapsed = relayoutNodes(updated, nextEdges);
        return preserveAnchorY(laidCollapsed, nodesToUse, nodeId);
      }

      // Expanding: reveal descendants, but stop descending past any node that is itself
      // still collapsed (nested combiner/variant/childrenCollapsed state is preserved).
      const toShow = new Set<string>();
      const walk = (parentId: string) => {
        nodesToUse.forEach((n: Node<SchemaNodeData>) => {
          if ((n.data as any)?.parent === parentId) {
            toShow.add(n.id);
            if (!isNodeDisplayCollapsed(n)) walk(n.id);
          }
        });
      };
      walk(nodeId);
      const nextEdges = edgesToUse.map((e: Edge) =>
        (toShow.has(e.source) || toShow.has(e.target)) ? { ...e, hidden: false } : e
      );
      const updated = nodesToUse.map((n: Node<SchemaNodeData>) => {
        if (n.id === nodeId) return { ...n, data: { ...n.data, childrenCollapsed: false } };
        if (toShow.has(n.id)) return { ...n, hidden: false };
        return n;
      });
      const laid = relayoutNodes(updated, nextEdges);
      const anchored = preserveAnchorY(laid, nodesToUse, nodeId);
      // Newly revealed nodes never had real dagre coordinates while hidden (they sat at their
      // stale/default position), so the earlier-computed sourceHandle/targetHandle on these
      // edges can point at the wrong (rear) side of the parent — recompute from the now-laid-out
      // positions instead of reusing nextEdges' stale handles.
      setEdges(() => applyEdgePositioningCached(nextEdges, anchored) as Edge[]);
      return anchored;
    });
    persistCollapseState();
  }, [collectDescendantIds, edgesRef, nodesRef, relayoutNodes, preserveAnchorY, setEdges, setNodes, markUserToggledChildren]);

  const handleExpandAllChildren = React.useCallback((nodeId: string) => {
    userToggledChildrenRef.current = true;
    markUserToggledChildren();
    const currentNodes = nodesRef.current;
    const descendantIdsArray = collectDescendantIds(nodeId, currentNodes);
    const descendantIds = new Set<string>(descendantIdsArray);
    collapsedNodeIdsRef.current.delete(nodeId);
    expandedNodeIdsRef.current.add(nodeId);
    descendantIdsArray.forEach((id) => {
      collapsedNodeIdsRef.current.delete(id);
      expandedNodeIdsRef.current.add(id);
    });
    const combinerIds: string[] = [];
    const variantIds: string[] = [];
    currentNodes.forEach((n) => {
      if (descendantIds.has(n.id)) {
        if (n.type === 'combiner') combinerIds.push(n.id);
        if (n.type === 'variant') variantIds.push(n.id);
      }
    });

    setNodes((prev: Node<SchemaNodeData>[]) => {
      const updated = prev.map((n: Node<SchemaNodeData>) => {
        if (n.id === nodeId) {
          return { ...n, data: { ...n.data, childrenCollapsed: false } };
        }
        if (!descendantIds.has(n.id)) return n;

        const baseData: any = { ...n.data };
        if (n.type === 'combiner') {
          baseData.variantsExpanded = true;
        }
        if (n.type === 'variant') {
          baseData.variantExpanded = true;
        }
        if (n.type !== 'combiner' && n.type !== 'variant') {
          baseData.childrenCollapsed = false;
        }
        return { ...n, hidden: false, data: baseData };
      });
      const visibleIds = new Set<string>([nodeId, ...descendantIds]);
      const nextEdges = edgesRef.current.map((e: Edge) =>
        visibleIds.has(e.source) && visibleIds.has(e.target) ? { ...e, hidden: false } : e
      );
      const laid = relayoutNodes(updated, nextEdges);
      const anchored = preserveAnchorY(laid, prev, nodeId);
      setEdges(() => applyEdgePositioningCached(nextEdges, anchored) as Edge[]);
      return anchored;
    });

    combinerIds.forEach((id) => setCombinerExpandedPersisted(id, true));
    variantIds.forEach((id) => setVariantExpandedPersisted(id, true));
    persistCollapseState();
  }, [collectDescendantIds, edgesRef, preserveAnchorY, relayoutNodes, setCombinerExpandedPersisted, setVariantExpandedPersisted, setEdges, setNodes, markUserToggledChildren]);

  // Add a new blank variant to a combiner node
  const handleAddVariant = React.useCallback((combinerId: string) => {
    setNodes((prev: Node<SchemaNodeData>[]) => {
      const combiner = prev.find(n => n.id === combinerId);
      if (!combiner) return prev;
      const existingVariants = prev.filter(n => n.type === 'variant' && (n.data as any)?.parent === combinerId);
      const newIdx = existingVariants.length;
      const newVariantId = `${combinerId}.v${newIdx}`;
      const newVariant: Node<SchemaNodeData> = {
        id: newVariantId,
        type: 'variant',
        position: { x: 0, y: 0 },
        data: {
          id: newVariantId,
          label: `Variant ${newIdx + 1}`,
          type: 'object',
          parent: combinerId,
          variantIndex: newIdx,
          variantRef: undefined,
          variantResolved: false,
          variantExpanded: false,
          variantSchema: { type: 'string' },
          isResolving: false,
          ...nodeHandlersRef.current,
        } as any,
        hidden: false,
      };
      setEdges((prevEdges: Edge[]) => [
        ...prevEdges,
        {
          id: `e${combinerId}-${newVariantId}`,
          source: combinerId,
          target: newVariantId,
          type: 'smoothstep',
          hidden: false,
        } as Edge,
      ]);
      const updated = [
        ...prev.map((n: Node<SchemaNodeData>) =>
          n.id === combinerId
            ? { ...n, data: { ...n.data, variantCount: ((n.data as any).variantCount || 0) + 1 } as any }
            : n
        ),
        newVariant,
      ];
      const newSchema = buildSchemaFromNodes(updated);
      emitLocalSchemaUpdate(newSchema);
      return updated;
    });
  }, [emitLocalSchemaUpdate]);

  // Change combiner type (oneOf / anyOf / allOf)
  const handleChangeCombinerType = React.useCallback((combinerId: string, newType: string) => {
    setNodes((prev: Node<SchemaNodeData>[]) => {
      const updated = prev.map((n: Node<SchemaNodeData>) =>
        n.id === combinerId ? { ...n, data: { ...n.data, combinerType: newType } as any } : n
      );
      const newSchema = buildSchemaFromNodes(updated);
      emitLocalSchemaUpdate(newSchema);
      return updated;
    });
  }, [emitLocalSchemaUpdate]);

  // Delete a variant (and possibly its combiner if it was the last one)
  const handleDeleteVariant = React.useCallback((variantId: string) => {
    setNodes((prev: Node<SchemaNodeData>[]) => {
      const variantNode = prev.find(n => n.id === variantId);
      if (!variantNode) return prev;
      const combinerId = (variantNode.data as any).parent as string;
      const siblings = prev.filter(n => n.type === 'variant' && (n.data as any)?.parent === combinerId && n.id !== variantId);
      // Collect all descendants to remove
      const toRemove = new Set<string>([variantId]);
      const collectDesc = (pid: string) => {
        prev.forEach((n: Node<SchemaNodeData>) => {
          if ((n.data as any)?.parent === pid) { toRemove.add(n.id); collectDesc(n.id); }
        });
      };
      collectDesc(variantId);
      let updated: Node<SchemaNodeData>[];
      if (siblings.length === 0) {
        // Last variant: remove combiner too, restore scalar on parent
        const combiner = prev.find(n => n.id === combinerId);
        const parentId = combiner ? (combiner.data as any).parent as string : null;
        toRemove.add(combinerId);
        updated = prev.filter((n: Node<SchemaNodeData>) => !toRemove.has(n.id));
        if (parentId) {
          updated = updated.map((n: Node<SchemaNodeData>) =>
            n.id === parentId ? { ...n, data: { ...n.data, type: 'string' as any } } : n
          );
        }
      } else if (siblings.length === 1) {
        // One variant left: flatten its schema onto combiner's parent
        const combiner = prev.find(n => n.id === combinerId);
        const parentId = combiner ? (combiner.data as any).parent as string : null;
        const remainingData = siblings[0].data as any;
        const flatSchema = remainingData.variantSchema || { type: 'string' };
        toRemove.add(combinerId);
        toRemove.add(siblings[0].id);
        updated = prev.filter((n: Node<SchemaNodeData>) => !toRemove.has(n.id));
        if (parentId) {
          updated = updated.map((n: Node<SchemaNodeData>) =>
            n.id === parentId ? { ...n, data: { ...n.data, ...flatSchema } as any } : n
          );
        }
      } else {
        // Multiple variants remain: remove this one, renumber survivors
        updated = prev.filter((n: Node<SchemaNodeData>) => !toRemove.has(n.id)).map((n: Node<SchemaNodeData>) => {
          if (n.type === 'variant' && (n.data as any)?.parent === combinerId) {
            const survivors = prev.filter(v => v.type === 'variant' && (v.data as any)?.parent === combinerId && !toRemove.has(v.id));
            const newIdx = survivors.findIndex(v => v.id === n.id);
            return { ...n, data: { ...n.data, variantIndex: newIdx } as any };
          }
          if (n.id === combinerId) {
            return { ...n, data: { ...n.data, variantCount: (n.data as any).variantCount - 1 } as any };
          }
          return n;
        });
      }
      setEdges((prevEdges: Edge[]) =>
        prevEdges.filter((e: Edge) => !toRemove.has(e.source) && !toRemove.has(e.target))
      );
      const newSchema = buildSchemaFromNodes(updated);
      emitLocalSchemaUpdate(newSchema);
      return updated;
    });
  }, [emitLocalSchemaUpdate]);

  // Delete an entire combiner (and all its variants), restoring the parent's schema to the
  // first variant's schema (or a plain string as a last resort) — used when the user targets
  // the combiner node itself, rather than one of its individual variants.
  const handleDeleteCombiner = React.useCallback((combinerId: string) => {
    setNodes((prev: Node<SchemaNodeData>[]) => {
      const combiner = prev.find(n => n.id === combinerId);
      if (!combiner) return prev;
      const parentId = (combiner.data as any).parent as string | undefined;
      const toRemove = new Set<string>([combinerId]);
      const collectDesc = (pid: string) => {
        prev.forEach((n: Node<SchemaNodeData>) => {
          if ((n.data as any)?.parent === pid) { toRemove.add(n.id); collectDesc(n.id); }
        });
      };
      collectDesc(combinerId);
      const variants = prev
        .filter(n => n.type === 'variant' && (n.data as any)?.parent === combinerId)
        .sort((a, b) => (((a.data as any).variantIndex) || 0) - (((b.data as any).variantIndex) || 0));
      const fallbackSchema = variants.length > 0 ? ((variants[0].data as any).variantSchema || { type: 'string' }) : { type: 'string' };
      let updated = prev.filter((n: Node<SchemaNodeData>) => !toRemove.has(n.id));
      if (parentId) {
        updated = updated.map((n: Node<SchemaNodeData>) =>
          n.id === parentId ? { ...n, data: { ...n.data, ...fallbackSchema } as any } : n
        );
      }
      setEdges((prevEdges: Edge[]) =>
        prevEdges.filter((e: Edge) => !toRemove.has(e.source) && !toRemove.has(e.target))
      );
      const newSchema = buildSchemaFromNodes(updated);
      emitLocalSchemaUpdate(newSchema);
      return updated;
    });
  }, [emitLocalSchemaUpdate]);

  // Expand/collapse all variants of a combiner node at once
  const handleToggleCombinerVariants = React.useCallback((combinerId: string) => {
    setNodes((prev: Node<SchemaNodeData>[]) => {
      const combiner = prev.find(n => n.id === combinerId);
      if (!combiner) return prev;
      const willExpand = !(combiner.data as any).variantsExpanded;
      setCombinerExpandedPersisted(combinerId, willExpand);
      const variantIds = new Set(
        prev.filter(n => n.type === 'variant' && (n.data as any)?.parent === combinerId).map(n => n.id)
      );
      const toggledEdges = edgesRef.current.map((e: Edge) =>
        (e.source === combinerId && variantIds.has(e.target))
          ? { ...e, hidden: !willExpand }
          : e
      );
      const next = prev.map((n: Node<SchemaNodeData>) => {
        if (n.id === combinerId)
          return { ...n, data: { ...n.data, variantsExpanded: willExpand } as any };
        if (variantIds.has(n.id))
          return { ...n, hidden: !willExpand };
        return n;
      });
      const laid = relayoutNodes(next, toggledEdges);
      const anchored = preserveAnchorY(laid, prev, combinerId);
      const finalNodes = anchored.map(n =>
        (n.type === 'combiner' || n.type === 'variant')
          ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } }
          : n
      );
      // Revealed variants had no real dagre position while hidden, so recompute handles from
      // the now-laid-out positions instead of reusing toggledEdges' stale (rear-side) handles.
      setEdges(() => applyEdgePositioningCached(toggledEdges, finalNodes) as Edge[]);
      return finalNodes;
    });
  }, [relayoutNodes, preserveAnchorY, setCombinerExpandedPersisted]);

  const restoreExpandedStateRecursively = React.useCallback((state: ExpansionState) => {
    let attempts = 0;
    const maxAttempts = 12;

    const runPass = () => {
      attempts += 1;
      const currentNodes = nodesRef.current;

      const combinersToExpand = currentNodes
        .filter((n) => n.type === 'combiner')
        .map((n) => n.id)
        .filter((id) => {
          const node = currentNodes.find((n) => n.id === id);
          if (!node) return false;
          const shouldExpand = Boolean(state.combiners[id]);
          const isExpanded = Boolean((node.data as any)?.variantsExpanded);
          return shouldExpand && !isExpanded;
        });

      const variantsToExpand = currentNodes
        .filter((n) => n.type === 'variant')
        .map((n) => n.id)
        .filter((id) => {
          const node = currentNodes.find((n) => n.id === id);
          if (!node) return false;
          const shouldExpand = Boolean(state.variants[id]);
          const isExpanded = Boolean((node.data as any)?.variantExpanded);
          return shouldExpand && !isExpanded;
        });

      combinersToExpand.forEach((combinerId) => handleToggleCombinerVariants(combinerId));
      variantsToExpand.forEach((variantId) => handleToggleVariant(variantId));

      const madeProgress = combinersToExpand.length > 0 || variantsToExpand.length > 0;
      if (madeProgress && attempts < maxAttempts) {
        setTimeout(runPass, 0);
      }
    };

    scheduleTask(runPass, 0);
  }, [handleToggleCombinerVariants, handleToggleVariant, scheduleTask]);

  // Always reflect current closures (runs every render)
  nodeHandlersRef.current = {
    onToggleVariant: handleToggleVariant,
    onAddVariant: handleAddVariant,
    onChangeCombinerType: handleChangeCombinerType,
    onDeleteVariant: handleDeleteVariant,
    onToggleVariants: handleToggleCombinerVariants,
  };

  // Wrap an existing property node in a new oneOf combiner
  const handleAddCombinerToNode = React.useCallback((nodeId: string) => {
    setNodes((prev: Node<SchemaNodeData>[]) => {
      const targetNode = prev.find(n => n.id === nodeId);
      if (!targetNode) return prev;
      const combinerId = `${nodeId}.__combiner`;
      // Capture the current schema of the target node as the first variant
      const existingVariantSchema = schemaNodeDataToSchema(targetNode.data as SchemaNodeData) as Record<string, unknown>;
      const variant0Id = `${combinerId}.v0`;
      const combinerNode: Node<SchemaNodeData> = {
        id: combinerId,
        type: 'combiner',
        position: { x: 0, y: 0 },
        data: {
          id: combinerId,
          label: '__combiner',
          type: 'object',
          parent: nodeId,
          combinerType: 'oneOf',
          variantCount: 1,
          ...nodeHandlersRef.current,
        } as any,
      };
      const variant0: Node<SchemaNodeData> = {
        id: variant0Id,
        type: 'variant',
        position: { x: 0, y: 0 },
        data: {
          id: variant0Id,
          label: 'Variant 1',
          type: 'object',
          parent: combinerId,
          variantIndex: 0,
          variantRef: (existingVariantSchema as any).$ref,
          variantResolved: false,
          variantExpanded: false,
          variantSchema: existingVariantSchema,
          isResolving: false,
          ...nodeHandlersRef.current,
        } as any,
        hidden: false,
      };
      setEdges((prevEdges: Edge[]) => [
        ...prevEdges,
        { id: `e${nodeId}-${combinerId}`, source: nodeId, target: combinerId, type: 'smoothstep' } as Edge,
        { id: `e${combinerId}-${variant0Id}`, source: combinerId, target: variant0Id, type: 'smoothstep' } as Edge,
      ]);
      const updated = [...prev, combinerNode, variant0];
      const newSchema = buildSchemaFromNodes(updated);
      emitLocalSchemaUpdate(newSchema);
      return updated;
    });
  }, [emitLocalSchemaUpdate]);

  // Find the selected node from nodes and selectedNodeId
  const selectedNode = React.useMemo(() => {
    if (!selectedNodeId) return null;
    // Try to find by ID
    let node = nodes.find(n => n.id === selectedNodeId);
    if (node) return node;
    // If not found, try to find enum node with same label as previous selection
    if (selectedNodeLabelRef.current) {
      node = nodes.find(n => n.type === 'enum' && n.data && n.data.label === selectedNodeLabelRef.current);
      if (node) return node;
    }
    return null;
  }, [nodes, selectedNodeId]);

  // Node property update handler
  const handleNodePropertyChange = (patch: Partial<NodeData>) => {
    if (isXmlGraphMode) {
      const updated = updateXmlNodeAtPath(schema as Record<string, unknown>, patch, selectedNode ?? undefined);
      if (!updated) {
        console.warn('[handleNodePropertyChange] updateXmlNodeAtPath returned null for patch:', patch);
        return;
      }
      
      emitLocalSchemaUpdate(updated);

      // Annotation is stored per graph node's own `data` (even for a read-only ref expansion) and
      // never changes node/edge shape, so patch it in place instead of rebuilding the whole graph.
      const patchKeys = Object.keys(patch).filter((key) => key !== 'id');
      if (patchKeys.length === 1 && (patchKeys[0] === 'xmlAnnotation' || patchKeys[0] === 'xmlAnnotations')) {
        setNodes((prevNodes) => prevNodes.map((n) => (
          n.id === patch.id ? { ...n, data: { ...n.data, ...patch } } : n
        )));
        return;
      }
      
      // Rebuild the graph data from the updated schema so all changes are reflected.
      const rawRebuilt = schemaToGraph(updated as Record<string, unknown>);
      const currentNodesById = new Map(nodesRef.current.map((n) => [n.id, n]));
      const currentEdgesById = new Map(edgesRef.current.map((e) => [e.id, e]));
      const sameStructure =
        rawRebuilt.nodes.length === nodesRef.current.length &&
        rawRebuilt.edges.length === edgesRef.current.length &&
        rawRebuilt.nodes.every((n) => currentNodesById.has(n.id)) &&
        rawRebuilt.edges.every((e) => currentEdgesById.has(e.id));

      if (sameStructure) {
        // A simple field edit (name/type/use/default/annotation/...) doesn't add or remove any
        // node/edge — reuse existing positions instead of re-running the (expensive) dagre
        // layout, which otherwise re-lays-out the whole graph on every keystroke commit.
        const positionedNodes = rawRebuilt.nodes.map((n) => {
          const existing = currentNodesById.get(n.id);
          // Preserve `hidden` along with `position` — rawRebuilt nodes are freshly built by
          // schemaToGraph/xmlSchemaToGraph and never carry a `hidden` flag, so without this
          // every previously-collapsed (hidden) node in the whole graph would silently become
          // visible again on every field edit, rendered at its stale never-laid-out position.
          const merged = existing ? { ...n, position: existing.position, hidden: existing.hidden } : n;
          return (merged.type === 'combiner' || merged.type === 'variant')
            ? { ...merged, data: { ...merged.data, id: merged.id, ...nodeHandlersRef.current } }
            : merged;
        });
        setNodes(positionedNodes);
        // Recompute sourceHandle/targetHandle from the (reused) positions — rawRebuilt.edges
        // are freshly built with no handle ids, so without this they fall back to whichever
        // handle React Flow picks by default (the first-declared "Left"/rear handle) instead
        // of the correct front/rear side for each node's actual position. Also preserve `hidden`
        // for the same reason as nodes above — a freshly built edge is never hidden by default.
        const positionedEdges = rawRebuilt.edges.map((e) => {
          const existing = currentEdgesById.get(e.id);
          return existing ? { ...e, hidden: existing.hidden } : e;
        });
        setEdges(applyEdgePositioningCached(positionedEdges, positionedNodes) as Edge[]);
        return;
      }

      // Structural change (e.g. adding/removing an inline SimpleType's own node) — do a full relayout.
      const laidOutNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges).map(n =>
        (n.type === 'combiner' || n.type === 'variant') ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } } : n
      );
      setNodes(laidOutNodes);
      setEdges(applyEdgePositioningCached(rawRebuilt.edges, laidOutNodes) as Edge[]);
      return;
    }
    
    // Non-XML mode handling (original code below)
    // Compute rename/new id ahead of mutating nodes so we can preserve selection
    const targetNode = nodes.find((n) => n.id === patch.id);
    const oldId = targetNode?.id ?? (patch.id as string);
    const oldLabel = targetNode?.data?.label;
    const parentId = targetNode?.data?.parent;
    const newLabel = (patch.label ?? oldLabel) as string;
    let idChanged = false;
    let newId = oldId;
    if (oldLabel !== newLabel && parentId) {
      newId = makeId(parentId, newLabel);
      idChanged = newId !== oldId;
    }

    // Only patch the targeted node
    setNodes((prevNodes: Node<SchemaNodeData>[]) => {
      // Apply the patch to the node list, and if id changed, update child parent refs
      let updatedNodes = prevNodes.map((node: Node<SchemaNodeData>) => {
        // Update the node being patched
        if (node.id === oldId) {
          const newData = { ...node.data, ...patch } as SchemaNodeData;
          if (node.type === 'variant') {
            const variantSchema = schemaNodeDataToSchema(newData as SchemaNodeData) as Record<string, unknown>;
            (newData as any).variantSchema = variantSchema;
            (newData as any).variantRef = undefined;
          }
          const updatedNode: Node<SchemaNodeData> = {
            ...node,
            id: newId,
            data: { ...newData },
          };
          return updatedNode;
        }
        // If another node had this as parent, update its parent id
        if (idChanged && node.data && node.data.parent === oldId) {
          return { ...node, data: { ...node.data, parent: newId } };
        }
        return node;
      });

      const additionalPropertiesPatch = patch.additionalProperties;
      const isBooleanAdditionalPropertiesPatch = additionalPropertiesPatch === true || additionalPropertiesPatch === false;
      const removedNodeIds = new Set<string>();

      if (isBooleanAdditionalPropertiesPatch) {
        const updatedTargetId = idChanged ? newId : oldId;
        const updatedTargetNode = updatedNodes.find((node) => node.id === updatedTargetId);

        if (updatedTargetNode?.data?.additionalProperties) {
          const ownerId = updatedTargetNode.data.parent;
          if (ownerId) {
            const queue = [updatedTargetId];
            while (queue.length > 0) {
              const currentId = queue.shift() as string;
              if (removedNodeIds.has(currentId)) continue;
              removedNodeIds.add(currentId);
              const childIds = updatedNodes
                .filter((node) => node.data?.parent === currentId)
                .map((node) => node.id);
              queue.push(...childIds);
            }

            updatedNodes = updatedNodes
              .filter((node) => !removedNodeIds.has(node.id))
              .map((node) => {
                if (node.id !== ownerId) return node;
                return {
                  ...node,
                  data: { ...node.data, additionalProperties: additionalPropertiesPatch as boolean },
                };
              });
          }
        } else {
          const queue = updatedNodes
            .filter((node) => node.data?.parent === updatedTargetId && node.data?.additionalProperties)
            .map((node) => node.id);

          while (queue.length > 0) {
            const currentId = queue.shift() as string;
            if (removedNodeIds.has(currentId)) continue;
            removedNodeIds.add(currentId);
            const childIds = updatedNodes
              .filter((node) => node.data?.parent === currentId)
              .map((node) => node.id);
            queue.push(...childIds);
          }

          if (removedNodeIds.size > 0) {
            updatedNodes = updatedNodes.filter((node) => !removedNodeIds.has(node.id));
          }
        }
      }

      // If id changed, also update edges referencing the old id
      if (idChanged) {
        setEdges(prevEdges => prevEdges.map(e => {
          let s = e.source;
          let t = e.target;
          if (s === oldId) s = newId;
          if (t === oldId) t = newId;
          return { ...e, id: `e${s}-${t}`, source: s, target: t } as Edge;
        }));
      }
      if (removedNodeIds.size > 0) {
        setEdges(prevEdges => prevEdges.filter(e => !removedNodeIds.has(e.source) && !removedNodeIds.has(e.target)));
      }

      // After node patching (rename or other edits), derive the authoritative
      // schema from the updated graph state (using nodes collection) and emit it once.
      const newSchema = buildSchemaFromNodes(updatedNodes);
      if (newSchema) {
        emitLocalSchemaUpdate(newSchema);
      }
      return updatedNodes;
    });

    // Preserve selection when we changed the id of the currently selected node
    if (idChanged) {
      setSelectedNodeId(newId);
    }
  };

  const handleToggleShowAnnotations = (show: boolean) => {
    setXmlShowAnnotations(show);
  };

  const handleToggleShowImports = (show: boolean) => {
    setXmlShowImports(show);
  };

  // Context menu state
  const [contextMenu, setContextMenu] = React.useState<{ visible: boolean; position: { x: number; y: number }; nodeId: string | null } | null>(null);
  const [showSchemaDetails, setShowSchemaDetails] = React.useState(false);
  const [xmlShowAnnotations, setXmlShowAnnotations] = React.useState(false);
  const [xmlShowImports, setXmlShowImports] = React.useState(false);

  const xmlSchemaDetails = React.useMemo(() => {
    const candidate = schema as any;
    const directAttributes = candidate?.['@attributes'] && typeof candidate['@attributes'] === 'object'
      ? candidate['@attributes'] as Record<string, unknown>
      : null;
    const schemaRoot = candidate?.['xs:schema'] && typeof candidate['xs:schema'] === 'object'
      ? candidate['xs:schema'] as Record<string, unknown>
      : null;
    const nestedAttributes = schemaRoot?.['@attributes'] && typeof schemaRoot['@attributes'] === 'object'
      ? schemaRoot['@attributes'] as Record<string, unknown>
      : null;
    const attributes = nestedAttributes || directAttributes;
    const targetNamespace = attributes?.targetNamespace || candidate?.targetNamespace || schemaRoot?.targetNamespace;
    const elementFormDefault = attributes?.elementFormDefault || candidate?.elementFormDefault || schemaRoot?.elementFormDefault;
    const attributeFormDefault = attributes?.attributeFormDefault || candidate?.attributeFormDefault || schemaRoot?.attributeFormDefault;
    const xmlnsEntries = attributes
      ? Object.entries(attributes).filter(([key]) => key.startsWith('xmlns'))
      : [];

    return {
      targetNamespace: typeof targetNamespace === 'string' ? targetNamespace : null,
      elementFormDefault: typeof elementFormDefault === 'string' ? elementFormDefault : null,
      attributeFormDefault: typeof attributeFormDefault === 'string' ? attributeFormDefault : null,
      xmlnsEntries,
    };
  }, [schema]);

  const schemaDialectLabel = schemaLanguage === 'xml' ? 'XML Schema' : 'JSON Schema';
  const showXmlDetails = schemaLanguage === 'xml' || Boolean(xmlSchemaDetails.targetNamespace || xmlSchemaDetails.xmlnsEntries.length > 0);

  // Sync nodes/edges with schema prop unless using test data
  // Only reset selected node if the graph structure changes (add/remove), not for every property edit
  const prevNodeCount = React.useRef(0);
  const prevEdgeCount = React.useRef(0);
  // Tracks whether the user has manually toggled any node's children collapse state. Real
  // schema loads can rebuild nodes/edges from the `schema` prop multiple times before settling
  // (e.g. remote $ref resolution completing after an initial local-refs-only pass) — each such
  // rebuild should keep collapsing everything below the root's direct children until the user
  // starts managing expansion themselves, not just on the very first ever build.
  const userToggledChildrenRef = React.useRef(false);
  const reactFlowInstanceRef = React.useRef<any>(null);
  React.useEffect(() => {
    // If we recently emitted a schema update from inside this component,
    // skip syncing back from the `schema` prop for this change to avoid
    // tearing down and rebuilding nodes (which causes selection loss).
    if (skipSchemaSyncRef.current) {
      const incomingFingerprint = fingerprintSchema(schema);
      const pendingFingerprint = pendingLocalSchemaFingerprintRef.current;
      skipSchemaSyncRef.current = false;
      pendingLocalSchemaFingerprintRef.current = null;
      if (pendingFingerprint && incomingFingerprint === pendingFingerprint) {
        return;
      }
    }
    if (useTestData) return;
    const activeSchema = schema;
    if (!activeSchema) return;
    // If this is genuinely a different schema than the one `collapsedNodeIdsRef` was tracking
    // (not just a reference change to equivalent/related content), drop the persisted collapse
    // state — otherwise it would keep accumulating node ids for every schema ever opened.
    resetCollapsedNodeIdsForSchema(fingerprintSchema(activeSchema));
    // Normalize schema for graph: if top-level is a $ref into $defs, hoist that definition
    const normalizeForGraph = (root: any) => {
      if (!root || typeof root !== 'object') return root;
      try {
        if (root.$ref && typeof root.$ref === 'string' && root.$defs && root.$ref.startsWith('#/$defs/')) {
          const key = root.$ref.replace('#/$defs/', '');
          const def = (root.$defs || {})[key];
          if (def) {
            // shallow clone and replace internal anchor refs using $defs anchors
            const anchorMap: Record<string, any> = {};
            for (const v of Object.values(root.$defs || {})) {
              if ((v as any).$anchor) anchorMap[`#${(v as any).$anchor}`] = v;
            }
            const replaceRefs = (obj: any): any => {
              if (!obj || typeof obj !== 'object') return obj;
              if (Array.isArray(obj)) return obj.map(replaceRefs);
              if (obj.$ref && typeof obj.$ref === 'string' && anchorMap[obj.$ref]) return anchorMap[obj.$ref];
              const out: any = {};
              for (const [kk, vv] of Object.entries(obj)) out[kk] = replaceRefs(vv);
              return out;
            };
            return replaceRefs(JSON.parse(JSON.stringify(def)));
          }
        }
      } catch (e) {
        // ignore and return root
      }
      return root;
    };
    const schemaForGraph = normalizeForGraph(activeSchema);
    const isInitialLoad = !userToggledChildrenRef.current;
    // A genuinely fresh load (nothing collapsed yet, ever — including in prior mounts of this
    // component, e.g. before the user switched tabs away and back) can use the cheap lazy
    // `visibleOnly` graph build. Once the user has collapsed/expanded anything (persisted in
    // `collapsedNodeIdsRef`, which survives remounts), we need the full graph so we can restore
    // their exact collapse state below instead of falling back to "everything expanded".
    const hasPersistedCollapse = collapsedNodeIdsRef.current.size > 0;
    const useDefaultCollapseHeuristic = isInitialLoad && !hasPersistedCollapse && !hasUserToggledChildrenRef.current;
    const rawGraph = isXmlGraphMode
      ? xmlSchemaToGraph(schemaForGraph, { visibleOnly: useDefaultCollapseHeuristic, xmlShowAnnotations, xmlShowImports })
      : schemaToGraph(schemaForGraph);
    const restoredExpansionState = expansionStateRef.current;
    const nodesWithRestoredExpansion = rawGraph.nodes.map((n) => {
      if (n.type === 'combiner') {
        const expanded = Boolean(restoredExpansionState.combiners[n.id]);
        if (expanded) {
          return { ...n, data: { ...n.data, variantsExpanded: true } as any };
        }
      }
      return n;
    }).map((n) => {
      if (n.type !== 'variant') return n;
      const parentId = (n.data as any)?.parent as string | undefined;
      const parentExpanded = parentId ? Boolean(restoredExpansionState.combiners[parentId]) : false;
      return {
        ...n,
        hidden: !parentExpanded,
      };
    });

    const edgesWithRestoredExpansion = rawGraph.edges.map((e) => {
      const src = nodesWithRestoredExpansion.find((n) => n.id === e.source);
      const tgt = nodesWithRestoredExpansion.find((n) => n.id === e.target);
      if (src?.type === 'combiner' && tgt?.type === 'variant') {
        const expanded = Boolean(restoredExpansionState.combiners[src.id]);
        return { ...e, hidden: !expanded };
      }
      return e;
    });

    const rootNodeForCollapse = nodesWithRestoredExpansion.find((n) => n.type === 'root');
    let visibleNodesForLayout = nodesWithRestoredExpansion;
    let visibleEdgesForLayout = edgesWithRestoredExpansion;
    const hiddenNodes: Node<SchemaNodeData>[] = [];
    const hiddenEdges: Edge[] = [];

    // Recompute visibility whenever we have a root to anchor the BFS from — not just on the
    // very first ever load — so that a structural rebuild (e.g. triggered by an unrelated
    // schema edit, or by this component remounting on a tab switch) restores the user's own
    // collapse state (from `collapsedNodeIdsRef`) instead of silently showing everything expanded.
    if (rootNodeForCollapse) {
      const parentIds = new Set<string>();
      nodesWithRestoredExpansion.forEach((n) => {
        const parent = (n.data as any)?.parent;
        if (parent) parentIds.add(parent);
      });
      const primedNodes = nodesWithRestoredExpansion.map((n) => {
        const isRootNode = n.id === rootNodeForCollapse.id;
        const isXmlCompositor = isXmlCompositorNode(n);
        const canCollapse = isRootNode || (!isXmlCompositor && (n.type === 'property' || n.type === 'globalType' || n.type === 'enum') && parentIds.has(n.id));
        if (!canCollapse) return n;
        // Three-state decision per node: explicitly collapsed, explicitly expanded, or
        // "never decided yet" (e.g. its children weren't visible during an earlier lazy
        // build) — the last case falls back to the collapsed-by-default heuristic and
        // records the decision so future rebuilds/remounts stay consistent. The root node's
        // "never decided" default is expanded (not collapsed), matching its pre-existing
        // default-open behavior, but an explicit persisted collapse/expand still applies.
        let shouldCollapse: boolean;
        if (collapsedNodeIdsRef.current.has(n.id)) {
          shouldCollapse = true;
        } else if (expandedNodeIdsRef.current.has(n.id)) {
          shouldCollapse = false;
        } else if (isRootNode) {
          shouldCollapse = false;
        } else {
          shouldCollapse = true;
          collapsedNodeIdsRef.current.add(n.id);
        }
        return { ...n, data: { ...n.data, childrenCollapsed: shouldCollapse } };
      });

      const nodeById = new Map(primedNodes.map((n) => [n.id, n]));
      const primedRootNode = nodeById.get(rootNodeForCollapse.id);
      const visibleIds = new Set<string>();
      visibleIds.add(rootNodeForCollapse.id);
      if (!primedRootNode || !isNodeDisplayCollapsed(primedRootNode)) {
        primedNodes.forEach((n) => {
          if ((n.data as any)?.parent === rootNodeForCollapse.id) {
            visibleIds.add(n.id);
          }
        });
      }
      const queue = [...visibleIds];
      while (queue.length > 0) {
        const parentId = queue.shift()!;
        primedNodes.forEach((n) => {
          if ((n.data as any)?.parent === parentId && !visibleIds.has(n.id)) {
            const parent = nodeById.get(parentId);
            if (parent && !isNodeDisplayCollapsed(parent)) {
              visibleIds.add(n.id);
              queue.push(n.id);
            }
          }
        });
      }

      visibleNodesForLayout = primedNodes.filter((n) => visibleIds.has(n.id));
      hiddenNodes.push(...primedNodes.filter((n) => !visibleIds.has(n.id)).map((n) => ({ ...n, hidden: true })));
      visibleEdgesForLayout = edgesWithRestoredExpansion.filter((e) => e.source && e.target && visibleIds.has(e.source) && visibleIds.has(e.target));
      hiddenEdges.push(...edgesWithRestoredExpansion.filter((e) => !visibleIds.has(e.source) || !visibleIds.has(e.target)).map((e) => ({ ...e, hidden: true })));
    }

    const nodes = relayoutNodes([...visibleNodesForLayout, ...hiddenNodes], [...visibleEdgesForLayout, ...hiddenEdges]).map(n =>
      (n.type === 'combiner' || n.type === 'variant')
        ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } }
        : n
    );
    const edges = applyEdgePositioningCached([...visibleEdgesForLayout, ...hiddenEdges], nodes);
    // Only rebuild nodes/edges if the count changes (structural change)
    // Store label of selected node before graph rebuild
    setNodes(prevNodes => {
      if (selectedNodeId) {
        const prevNode = prevNodes.find(n => n.id === selectedNodeId);
        selectedNodeLabelRef.current = prevNode?.data?.label || null;
      }
      return prevNodes;
    });
    if ((nodes.length !== prevNodeCount.current) || (edges.length !== prevEdgeCount.current)) {
      setNodes(nodes);
      setEdges(edges);
      const hasPersistedExpansion =
        Object.keys(restoredExpansionState.combiners).length > 0 ||
        Object.keys(restoredExpansionState.variants).length > 0;
      if (hasPersistedExpansion) {
        restoreExpandedStateRecursively(restoredExpansionState);
      }
      // Try to preserve selected node if possible
      setSelectedNodeId(prevSelected => {
        if (!prevSelected) return nodes.length > 0 ? nodes[0].id : null;
        // If the node still exists after rebuild, keep it selected
        if (nodes.some(n => n.id === prevSelected)) return prevSelected;
        // Try to restore selection by label if node is lost
        const label = selectedNodeLabelRef.current;
        if (label) {
          const nodeByLabel = nodes.find(n => n.data && n.data.label === label);
          if (nodeByLabel) return nodeByLabel.id;
        }
        // Fallback: select first node if available
        return nodes.length > 0 ? nodes[0].id : null;
      });
      prevNodeCount.current = nodes.length;
      prevEdgeCount.current = edges.length;
      // Set a fixed comfortable zoom and center the graph.
      // fitView counteracts nodesep changes (bigger graph → more zoom-out → same density).
      scheduleTask(() => {
        const rf = reactFlowInstanceRef.current;
        if (!rf) return;
        const allNodes = rf.getNodes();
        if (allNodes.length === 0) return;
        const ZOOM = 0.75;
        const xs = allNodes.map((n: any) => n.position.x);
        const ys = allNodes.map((n: any) => n.position.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs) + 200;
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys) + 64;
        const graphCX = (minX + maxX) / 2;
        const graphCY = (minY + maxY) / 2;
        const wrapper = flowWrapperRef.current;
        const containerW = wrapper?.offsetWidth ?? 800;
        const containerH = wrapper?.offsetHeight ?? 600;
        rf.setViewport({
          x: containerW / 2 - graphCX * ZOOM,
          y: containerH / 2 - graphCY * ZOOM,
          zoom: ZOOM,
        });
      }, 150);
    } else {
      // Structure unchanged (property edit) — update data and use freshly-computed positions.
      setNodes(nodes);
      setEdges(edges);
    }
    // Otherwise, do not reset selection (preserve selection and form)
    persistCollapseState();
  }, [schema, setNodes, setEdges, useTestData, schemaToGraph, fingerprintSchema, relayoutNodes, restoreExpandedStateRecursively, scheduleTask, isXmlGraphMode, resetCollapsedNodeIdsForSchema, xmlShowAnnotations, xmlShowImports]);

  // Note: dereferencing is handled by the top-level reducer/workbench.

  // Parent supplies resolved schema when available; no local emission.

  // Two-way sync: only trigger graphToSchema when nodes/edges are changed by user actions
  const [isUserEdit, setIsUserEdit] = React.useState(false);

  // Mark as user edit when nodes/edges change via React Flow events
  const handleNodesChange = (...args: Parameters<typeof onNodesChange>) => {
    setIsUserEdit(true);
    onNodesChange(...args);
  };
  const handleEdgesChange = (...args: Parameters<typeof onEdgesChange>) => {
    setIsUserEdit(true);
    onEdgesChange(...args);
  };

  // No longer rebuild schema from graph; only patch schema directly
  // (graphToSchema removed)
  React.useEffect(() => {
    if (initialLoadRef.current || !isUserEdit) return;
    setIsUserEdit(false);
  }, [nodes, edges, schema, onChange, isUserEdit]);

  // Re-centre the graph after a collapse — but only when the toggled node itself has drifted
  // outside the current viewport (user is "lost in space"). Anchors on the specific node that
  // was collapsed rather than the bounding box of everything still visible, so collapsing a
  // node elsewhere in a large graph doesn't yank the view away from what the user was looking at.
  React.useEffect(() => {
    if (!pendingCenterRef.current) return;
    pendingCenterRef.current = false;
    const anchorNodeId = pendingCenterNodeIdRef.current;
    pendingCenterNodeIdRef.current = null;
    const rf = reactFlowInstanceRef.current;
    if (!rf) return;
    const allNodes = (rf.getNodes() as any[]).filter((n: any) => !n.hidden);
    if (allNodes.length === 0) return;

    const anchorNode = anchorNodeId ? allNodes.find((n: any) => n.id === anchorNodeId) : null;

    const wrapper = flowWrapperRef.current;
    const containerW = wrapper?.offsetWidth ?? 800;
    const containerH = wrapper?.offsetHeight ?? 600;

    // Bounding box: just the toggled node (with rough node size) if we found it, otherwise
    // fall back to the whole remaining graph.
    const xs = anchorNode ? [anchorNode.position.x] : allNodes.map((n: any) => n.position.x);
    const ys = anchorNode ? [anchorNode.position.y] : allNodes.map((n: any) => n.position.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs) + 200;
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys) + 64;

    // Current viewport in graph coordinates
    const vp = rf.getViewport();
    const vpLeft   =  -vp.x / vp.zoom;
    const vpTop    =  -vp.y / vp.zoom;
    const vpRight  = vpLeft + containerW / vp.zoom;
    const vpBottom = vpTop  + containerH / vp.zoom;

    // If the bbox still overlaps the viewport, the user can see it — no need to move
    const inView = minX < vpRight && maxX > vpLeft && minY < vpBottom && maxY > vpTop;
    if (inView) return;

    const ZOOM = 0.75;
    const graphCX = (minX + maxX) / 2;
    const graphCY = (minY + maxY) / 2;
    rf.setViewport({
      x: containerW / 2 - graphCX * ZOOM,
      y: containerH / 2 - graphCY * ZOOM,
      zoom: ZOOM,
    });
  }, [nodes]);

  const onConnect: OnConnect = (params: Connection) => setEdges((eds: Edge[]) => addEdge(params, eds));

  // Node click handler
  const handleNodeClick = (_: any, node: Node) => {
    // Allow root node selection in XML mode for schema-level property editing
    if (node.id === '1' && !isXmlGraphMode) return;
    setSelectedNodeId(node.id);
  };

  // Node right-click handler
  const handleNodeContextMenu = (event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    // Allow root node to open context menu for property addition
    setContextMenu({
      visible: true,
      position: { x: event.clientX, y: event.clientY },
      nodeId: node.id,
    });
  };

  // Reorder a same-parent sibling group (in JSON mode: a plain property group; in XML mode: the
  // array backing a node's `xmlPath`) so their order matches `newOrderIds`, then re-emit the
  // schema and rebuild the graph from it. Only called once a real order change was detected;
  // if the mutation can't actually be applied (path/data mismatch) it relays out to recover a
  // consistent graph, since the schema was never touched in that case.
  const applySiblingReorder = (
    draggedNodeId: string,
    siblingGroup: Node<SchemaNodeData>[],
    newOrderIds: string[],
  ) => {
    const snapBack = () => setNodes((prev) => relayoutNodes(prev, edgesRef.current));

    if (isXmlGraphMode) {
      const draggedPath = (siblingGroup.find((n) => n.id === draggedNodeId)?.data as any)?.xmlPath as Array<string | number> | undefined;
      if (!Array.isArray(draggedPath) || draggedPath.length === 0 || typeof draggedPath[draggedPath.length - 1] !== 'number') {
        snapBack();
        return;
      }
      const basePath = draggedPath.slice(0, -1);
      const cloned = JSON.parse(JSON.stringify(schema || {})) as any;
      const container = getAtXmlPath(cloned, basePath);
      if (!Array.isArray(container)) {
        snapBack();
        return;
      }
      const idToIndex = new Map(
        siblingGroup.map((n) => [n.id, ((n.data as any).xmlPath as Array<string | number>)[((n.data as any).xmlPath as Array<string | number>).length - 1] as number])
      );
      const reordered = newOrderIds.map((id) => container[idToIndex.get(id) as number]);
      if (reordered.some((entry) => entry === undefined)) {
        snapBack();
        return;
      }
      setAtXmlPath(cloned, basePath, reordered);
      
      // Clear __childrenInOrder so the graph rebuild uses the reordered array directly,
      // not stale metadata from the original parse
      if ('__childrenInOrder' in cloned) {
        delete (cloned as any)['__childrenInOrder'];
      }
      
      emitLocalSchemaUpdate(cloned as Record<string, unknown>);

      const rawRebuilt = schemaToGraph(cloned as Record<string, unknown>);
      const laidOutNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges).map(n =>
        (n.type === 'combiner' || n.type === 'variant') ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } } : n
      );
      const rebuiltNodes = preserveAnchorY(laidOutNodes, nodesRef.current, draggedNodeId);
      setNodes(rebuiltNodes);
      setEdges(applyEdgePositioningCached(rawRebuilt.edges, rebuiltNodes) as Edge[]);
      return;
    }

    // JSON mode: reorder the same-parent group within the full `nodes` array in place, then
    // derive the schema from it — `buildSchemaFromNodes` assigns `properties` keys in the same
    // order its `allNodes.forEach` visits same-parent children, so this reorders the emitted
    // schema's property order too.
    const currentNodes = nodesRef.current;
    const groupIds = new Set(siblingGroup.map((n) => n.id));
    const orderedGroupNodes = newOrderIds.map((id) => currentNodes.find((n) => n.id === id)).filter((n): n is Node<SchemaNodeData> => Boolean(n));
    if (orderedGroupNodes.length !== siblingGroup.length) {
      snapBack();
      return;
    }
    let cursor = 0;
    const reorderedNodes = currentNodes.map((n) => (groupIds.has(n.id) ? orderedGroupNodes[cursor++] : n));
    const newSchema = buildSchemaFromNodes(reorderedNodes);
    emitLocalSchemaUpdate(newSchema);

    const rawRebuilt = schemaToGraph(newSchema as Record<string, unknown>);
    const laidOutNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges).map(n =>
      (n.type === 'combiner' || n.type === 'variant') ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } } : n
    );
    const rebuiltNodes = preserveAnchorY(laidOutNodes, currentNodes, draggedNodeId);
    setNodes(rebuiltNodes);
    setEdges(applyEdgePositioningCached(rawRebuilt.edges, rebuiltNodes) as Edge[]);
  };

  // Snapshot of the dragged node's start position + its descendants' start positions, captured
  // in `handleNodeDragStart` and consumed by `handleNodeDrag` on each drag tick.
  const dragOriginRef = React.useRef<{
    nodeId: string;
    start: { x: number; y: number };
    descendantStarts: Map<string, { x: number; y: number }>;
  } | null>(null);

  const handleNodeDragStart = (_event: React.MouseEvent, draggedNode: Node<SchemaNodeData>) => {
    const currentNodes = nodesRef.current;
    const descendantIds = collectDragSubtreeIds(draggedNode.id, currentNodes);
    const descendantStarts = new Map<string, { x: number; y: number }>();
    for (const n of currentNodes) {
      if (descendantIds.has(n.id)) descendantStarts.set(n.id, { ...n.position });
    }
    dragOriginRef.current = { nodeId: draggedNode.id, start: { ...draggedNode.position }, descendantStarts };
  };

  // Moves the whole dragged subtree together by re-applying the parent's live drag delta to
  // each descendant's start position (not compounding deltas across ticks).
  const handleNodeDrag = (_event: React.MouseEvent, draggedNode: Node<SchemaNodeData>) => {
    const origin = dragOriginRef.current;
    if (!origin || origin.nodeId !== draggedNode.id || origin.descendantStarts.size === 0) return;
    const deltaX = draggedNode.position.x - origin.start.x;
    const deltaY = draggedNode.position.y - origin.start.y;
    setNodes((prev) => prev.map((n) => {
      const startPos = origin.descendantStarts.get(n.id);
      if (!startPos) return n;
      return { ...n, position: { x: startPos.x + deltaX, y: startPos.y + deltaY } };
    }));
  };

  // Fires when the user drops a dragged node — if it ended up above/below a sibling (same
  // parent, and in XML mode the same underlying array), reorders the siblings to match the
  // dropped node's new vertical position; otherwise leaves the node exactly where it was
  // dropped (no relayout/snap-back), since the user may just be repositioning it to look at
  // the graph rather than intending to reorder anything.
  const handleNodeDragStop = (_event: React.MouseEvent, draggedNode: Node<SchemaNodeData>) => {
    dragOriginRef.current = null;
    const currentNodes = nodesRef.current;
    const live = currentNodes.find((n) => n.id === draggedNode.id);
    const parentId = (live?.data as any)?.parent as string | undefined;
    if (!live || !parentId) {
      return;
    }

    const isReorderableSibling = (n: Node<SchemaNodeData>) =>
      !n.hidden &&
      n.type !== 'combiner' && n.type !== 'variant' && n.type !== 'root' && n.type !== 'inheritanceGroup' &&
      (n.data as any)?.parent === parentId;

    let siblingGroup: Node<SchemaNodeData>[];
    if (isXmlGraphMode) {
      const draggedPath = (live.data as any)?.xmlPath as Array<string | number> | undefined;
      if (!Array.isArray(draggedPath) || draggedPath.length === 0 || typeof draggedPath[draggedPath.length - 1] !== 'number') {
        return;
      }
      const basePathKey = JSON.stringify(draggedPath.slice(0, -1));
      siblingGroup = currentNodes.filter((n) => {
        if (!isReorderableSibling(n)) return false;
        const p = (n.data as any)?.xmlPath as Array<string | number> | undefined;
        if (!Array.isArray(p) || p.length === 0 || typeof p[p.length - 1] !== 'number') return false;
        return JSON.stringify(p.slice(0, -1)) === basePathKey;
      });
    } else {
      siblingGroup = currentNodes.filter((n) =>
        isReorderableSibling(n) && !(n.data as any)?.patternKey && !(n.data as any)?.isAdditionalProperties
      );
    }

    if (siblingGroup.length < 2) {
      return;
    }

    const previousOrder = siblingGroup.map((n) => n.id);
    const newOrder = [...siblingGroup].sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0)).map((n) => n.id);
    const orderChanged = newOrder.some((id, i) => id !== previousOrder[i]);
    if (!orderChanged) {
      return;
    }

    applySiblingReorder(draggedNode.id, siblingGroup, newOrder);
  };

  // Add Property action
  const handleAddProperty = () => {
    const parentNode = nodes.find(n => n.id === contextMenu?.nodeId);
    if (!parentNode) {
      setContextMenu(null);
      return;
    }

    // Build authoritative base schema from current graph and keep a snapshot
    const baseSchema = buildSchemaFromNodes(nodes);
    const prevSchema = JSON.parse(JSON.stringify(baseSchema));

    // Helper: collect labels from root -> target node
    const collectPath = (n: Node<SchemaNodeData> | undefined) => {
      const labels: string[] = [];
      let cur = n;
      while (cur && cur.id !== '1') {
        if (cur.data && cur.data.label) labels.unshift(cur.data.label);
        cur = nodes.find(x => x.id === cur?.data?.parent);
      }
      return labels;
    };

    const path = collectPath(parentNode);

    const getSchemaAtPath = (schema: any, pathArr: string[]) => {
      let cur: any = schema;
      for (const lbl of pathArr) {
        if (!cur) return null;
        if (cur.type === 'object') {
          cur = (cur.properties || {})[lbl];
        } else if (cur.type === 'array') {
          // dive into items
          cur = (cur.items && cur.items.type === 'object') ? ((cur.items.properties || {})[lbl]) : undefined;
        } else {
          cur = undefined;
        }
      }
      return cur;
    };

    // Find the target schema object where we'll add a property
    const targetSchema = getSchemaAtPath(baseSchema, path);

    let emittedSchema: Record<string, unknown> | null = null;

    if (!targetSchema) {
      // Fallback: add to root
      emittedSchema = addPropertyToSchema(baseSchema as Record<string, unknown>);
    } else {
      // Add property to the target schema object (object or items)
      const updatedTarget = addPropertyToSchema(targetSchema as Record<string, unknown>);
      // Integrate updatedTarget back into baseSchema at the correct location
      if (path.length === 1) {
        // Direct child of root
        if (!baseSchema.properties) baseSchema.properties = {};
        (baseSchema.properties as Record<string, unknown>)[path[0]] = updatedTarget;
      } else {
        const parentPath = path.slice(0, -1);
        const lastLabel = path[path.length - 1];
        const parentContainer = getSchemaAtPath(baseSchema, parentPath);
        if (parentContainer) {
          if (parentContainer.type === 'object') {
            if (!parentContainer.properties) parentContainer.properties = {};
            parentContainer.properties[lastLabel] = updatedTarget;
          } else if (parentContainer.type === 'array') {
            parentContainer.items = parentContainer.items || { type: 'object', properties: {} } as any;
            parentContainer.items.properties = parentContainer.items.properties || {};
            parentContainer.items.properties[lastLabel] = updatedTarget;
          }
        } else {
          // As a last resort, add to root
          emittedSchema = addPropertyToSchema(baseSchema as Record<string, unknown>);
        }
      }
      if (!emittedSchema) emittedSchema = baseSchema;
    }

    // Do not emit the schema immediately here. Wait for the user to finish
    // editing the new property's name so the final key in the schema matches
    // the user-provided label. The NodePropertyEditor will emit the
    // authoritative schema after the rename via handleNodePropertyChange.

    // Rebuild graph from emitted schema
    const rawRebuilt = schemaToGraph(emittedSchema as Record<string, unknown>);
    const laidOutNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges).map(n =>
      (n.type === 'combiner' || n.type === 'variant') ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } } : n
    );
    const rebuiltNodes = preserveAnchorY(laidOutNodes, nodes, parentNode.id);
    const rebuiltEdges = applyEdgePositioningCached(rawRebuilt.edges, rebuiltNodes) as Edge[];
    setNodes(rebuiltNodes);
    setEdges(rebuiltEdges);

    // Compute added key by diffing previous and new properties at the target location
    const prevProps = getSchemaAtPath(prevSchema, path)?.properties || ((prevSchema.properties as Record<string, unknown>) || {});
    const newProps = getSchemaAtPath(emittedSchema, path)?.properties || ((emittedSchema.properties as Record<string, unknown>) || {});
    const addedKey = Object.keys(newProps).find(k => !(k in prevProps)) || `newProperty${Object.keys(prevProps).length + 1}`;

    // Prefer selecting the deterministic id for the new node
    const newId = makeId(parentNode.id, addedKey);
    const newNode = rebuiltNodes.find(n => n.id === newId || (n.data && n.data.label === addedKey));
    if (newNode) setSelectedNodeId(newNode.id);
    setContextMenu(null);
  };

  // Add Pattern Property action
  const handleAddPatternProperty = () => {
    const parentNode = nodes.find(n => n.id === contextMenu?.nodeId);
    if (!parentNode) {
      setContextMenu(null);
      return;
    }

    // Build authoritative base schema from current graph and keep a snapshot
    const baseSchema = buildSchemaFromNodes(nodes);
    const prevSchema = JSON.parse(JSON.stringify(baseSchema));

    // Helper: collect labels from root -> target node
    const collectPath = (n: Node<SchemaNodeData> | undefined) => {
      const labels: string[] = [];
      let cur = n;
      while (cur && cur.id !== '1') {
        if (cur.data && cur.data.label) labels.unshift(cur.data.label);
        cur = nodes.find(x => x.id === cur?.data?.parent);
      }
      return labels;
    };

    const path = collectPath(parentNode);

    const getSchemaAtPath = (schema: any, pathArr: string[]) => {
      let cur: any = schema;
      for (const lbl of pathArr) {
        if (!cur) return null;
        if (cur.type === 'object') {
          cur = (cur.properties || {})[lbl];
        } else if (cur.type === 'array') {
          // dive into items
          cur = (cur.items && cur.items.type === 'object') ? ((cur.items.properties || {})[lbl]) : undefined;
        } else {
          cur = undefined;
        }
      }
      return cur;
    };

    // Find the target schema object where we'll add a patternProperty
    const targetSchema = getSchemaAtPath(baseSchema, path);

    let emittedSchema: Record<string, unknown> | null = null;

    if (!targetSchema) {
      // Fallback: add to root
      emittedSchema = addPatternPropertyToSchema(baseSchema as Record<string, unknown>);
    } else {
      // Add a pattern property to the target schema object (object or items)
      const updatedTarget = addPatternPropertyToSchema(targetSchema as Record<string, unknown>);
      // Integrate updatedTarget back into baseSchema at the correct location
      if (path.length === 1) {
        // Direct child of root
        if (!baseSchema.properties) baseSchema.properties = {};
        (baseSchema.properties as Record<string, unknown>)[path[0]] = updatedTarget;
      } else {
        const parentPath = path.slice(0, -1);
        const lastLabel = path[path.length - 1];
        const parentContainer = getSchemaAtPath(baseSchema, parentPath);
        if (parentContainer) {
          if (parentContainer.type === 'object') {
            if (!parentContainer.properties) parentContainer.properties = {};
            parentContainer.properties[lastLabel] = updatedTarget;
          } else if (parentContainer.type === 'array') {
            parentContainer.items = parentContainer.items || { type: 'object', properties: {} } as any;
            parentContainer.items.properties = parentContainer.items.properties || {};
            parentContainer.items.properties[lastLabel] = updatedTarget;
          }
        } else {
          // As a last resort, add to root
          emittedSchema = addPatternPropertyToSchema(baseSchema as Record<string, unknown>);
        }
      }
      if (!emittedSchema) emittedSchema = baseSchema;
    }

    // Rebuild graph from emitted schema
    const rawRebuilt = schemaToGraph(emittedSchema as Record<string, unknown>);
    const laidOutNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges).map(n =>
      (n.type === 'combiner' || n.type === 'variant') ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } } : n
    );
    const rebuiltNodes = preserveAnchorY(laidOutNodes, nodes, parentNode.id);
    const rebuiltEdges = applyEdgePositioningCached(rawRebuilt.edges, rebuiltNodes) as Edge[];
    setNodes(rebuiltNodes);
    setEdges(rebuiltEdges);

    // Compute added pattern key by diffing previous and new patternProperties at the target location
    const prevPattern = getSchemaAtPath(prevSchema, path)?.patternProperties || {};
    const newPattern = getSchemaAtPath(emittedSchema, path)?.patternProperties || {};
    const addedKey = Object.keys(newPattern).find(k => !(k in prevPattern));
    const addedLabel = addedKey ? `pattern: ${addedKey}` : undefined;

    // Prefer selecting the deterministic id for the new node
    const newId = addedLabel ? makeId(parentNode.id, addedLabel) : undefined;
    const newNode = (newId && rebuiltNodes.find(n => n.id === newId)) || (addedLabel && rebuiltNodes.find(n => n.data && n.data.label === addedLabel));
    if (newNode) setSelectedNodeId(newNode.id);
    setContextMenu(null);
  };

  // Create a local override for an imported/ref'd node by adding a `username` property
  const handleCreateLocalOverride = () => {
    const parentNode = nodes.find(n => n.id === contextMenu?.nodeId);
    if (!parentNode) {
      setContextMenu(null);
      return;
    }

    // Build authoritative base schema from current graph
    const baseSchema = buildSchemaFromNodes(nodes);

    // Helper: collect labels from root -> target node
    const collectPath = (n: Node<SchemaNodeData> | undefined) => {
      const labels: string[] = [];
      let cur = n;
      while (cur && cur.id !== '1') {
        if (cur.data && cur.data.label) labels.unshift(cur.data.label);
        cur = nodes.find(x => x.id === cur?.data?.parent);
      }
      return labels;
    };

    const path = collectPath(parentNode);

    const getSchemaAtPath = (schema: any, pathArr: string[]) => {
      let cur: any = schema;
      for (const lbl of pathArr) {
        if (!cur) return null;
        if (cur.type === 'object') {
          cur = (cur.properties || {})[lbl];
        } else if (cur.type === 'array') {
          // if items is object, descend into its properties
          if (cur.items && cur.items.type === 'object') cur = (cur.items.properties || {})[lbl];
          else cur = null;
        } else {
          cur = null;
        }
      }
      return cur;
    };

    const targetSchema = getSchemaAtPath(baseSchema, path);
    if (!targetSchema) {
      // nothing to override
      setContextMenu(null);
      return;
    }

    // If username already exists, just close
    const existing = (targetSchema.properties || {})['username'];
    if (existing) {
      setContextMenu(null);
      return;
    }

    // Determine original $ref from the source prop at this path so we can build an allOf override
    const getSourceAtPath = (src: any, pathArr: string[]) => {
      let cur = src;
      for (const lbl of pathArr) {
        if (!cur) return null;
        if (cur.type === 'object') {
          cur = (cur.properties || {})[lbl];
        } else if (cur.type === 'array') {
          if (cur.items && cur.items.type === 'object') cur = (cur.items.properties || {})[lbl];
          else cur = null;
        } else {
          cur = null;
        }
      }
      return cur;
    };

    const originalAtPath = getSourceAtPath(schema, path);
    const refStr = originalAtPath && typeof originalAtPath === 'object' && typeof originalAtPath.$ref === 'string' ? originalAtPath.$ref : null;

    // Build override: prefer allOf [$ref, { properties: { username: { type: 'string' } } }]
    const overrideNode = refStr
      ? { allOf: [{ $ref: refStr }, { type: 'object', properties: { username: { type: 'string' } } }] }
      : { ...(targetSchema as Record<string, unknown>), properties: { ...(targetSchema.properties || {}), username: { type: 'string' } } } as Record<string, unknown>;

    // Integrate overrideNode back into baseSchema at the correct location
    if (path.length === 1) {
      if (!baseSchema.properties) baseSchema.properties = {};
      (baseSchema.properties as Record<string, unknown>)[path[0]] = overrideNode;
    } else {
      const parentPath = path.slice(0, -1);
      const lastLabel = path[path.length - 1];
      const parentContainer = getSchemaAtPath(baseSchema, parentPath);
      if (parentContainer) {
        if (parentContainer.type === 'object') {
          if (!parentContainer.properties) parentContainer.properties = {};
          (parentContainer.properties as Record<string, unknown>)[lastLabel] = overrideNode;
        } else if (parentContainer.type === 'array') {
          if (!parentContainer.items) parentContainer.items = { type: 'object', properties: {} } as any;
          if ((parentContainer.items as any).type === 'object') {
            if (!(parentContainer.items as any).properties) (parentContainer.items as any).properties = {};
            (parentContainer.items as any).properties[lastLabel] = overrideNode;
          }
        }
      } else {
        // fallback: attach at root
        if (!baseSchema.properties) baseSchema.properties = {};
        (baseSchema.properties as Record<string, unknown>)[path[path.length - 1]] = overrideNode;
      }
    }

    // Emit the edited resolved schema so reducer will rehydrate into source
    emitLocalSchemaUpdate(baseSchema);

    // Rebuild graph from emitted schema and select the new node if present
    const rawRebuilt = schemaToGraph(baseSchema as Record<string, unknown>);
    const laidOutNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges).map(n =>
      (n.type === 'combiner' || n.type === 'variant') ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } } : n
    );
    const rebuiltNodes = preserveAnchorY(laidOutNodes, nodes, parentNode.id);
    const rebuiltEdges = applyEdgePositioningCached(rawRebuilt.edges, rebuiltNodes) as Edge[];
    setNodes(rebuiltNodes);
    setEdges(rebuiltEdges);

    const newId = makeId(parentNode.id, 'username');
    const newNode = rebuiltNodes.find(n => n.id === newId || (n.data && n.data.label === 'username'));
    if (newNode) setSelectedNodeId(newNode.id);

    setContextMenu(null);
  };

  // Collect the chain of labels from root -> `n`, used to look up `n`'s raw location in `schema`.
  const collectNodePathLabels = React.useCallback((n: Node<SchemaNodeData> | undefined): string[] => {
    const labels: string[] = [];
    let cur = n;
    while (cur && cur.id !== '1') {
      if (cur.data && cur.data.label) labels.unshift(cur.data.label);
      cur = nodes.find(x => x.id === cur?.data?.parent);
    }
    return labels;
  }, [nodes]);

  // Resolves a label path against the raw `schema` prop and returns the `$ref` found there
  // (either a direct `$ref` or the first `$ref` inside an `allOf`), or null if none.
  const getRefAtPathInSchema = React.useCallback((root: any, pathArr: string[]): string | null => {
    let cur: any = root;
    for (const lbl of pathArr) {
      if (!cur) return null;
      if (cur.type === 'object') {
        cur = (cur.properties || {})[lbl];
      } else if (cur.type === 'array') {
        cur = (cur.items && cur.items.type === 'object') ? ((cur.items.properties || {})[lbl]) : undefined;
      } else {
        cur = undefined;
      }
    }
    if (!cur || typeof cur !== 'object') return null;
    if (typeof cur.$ref === 'string') return cur.$ref;
    if (Array.isArray(cur.allOf)) {
      const refEntry = cur.allOf.find((e: any) => e && typeof e.$ref === 'string');
      if (refEntry) return refEntry.$ref;
    }
    return null;
  }, []);

  // Delete Property/Enum/Combiner/Variant action (with confirmation). If the targeted node
  // originated from a `$ref` to a global `$defs`/`definitions` entry, every other node in the
  // graph referencing that same global definition is deleted too.
  const handleDeleteNode = React.useCallback(() => {
    const ctxNodeId = contextMenu?.nodeId;
    if (!ctxNodeId) { setContextMenu(null); return; }
    const node = nodes.find(n => n.id === ctxNodeId);
    if (!node) { setContextMenu(null); return; }

    if (node.type === 'variant') {
      if (!window.confirm('Are you sure you want to delete this variant?')) { setContextMenu(null); return; }
      handleDeleteVariant(node.id);
      setContextMenu(null);
      return;
    }
    if (node.type === 'combiner') {
      if (!window.confirm('Are you sure you want to delete this combiner?')) { setContextMenu(null); return; }
      handleDeleteCombiner(node.id);
      setContextMenu(null);
      return;
    }
    if (node.type === 'root') { setContextMenu(null); return; }

    const kindLabel = node.type === 'enum' ? 'enum' : 'property';
    if (!window.confirm(`Are you sure you want to delete this ${kindLabel}?`)) { setContextMenu(null); return; }

    const idsToRemove = new Set<string>();
    const collectDesc = (pid: string) => {
      idsToRemove.add(pid);
      nodes.forEach(n => { if ((n.data as any)?.parent === pid) collectDesc(n.id); });
    };
    collectDesc(node.id);

    // Cascade: this node came from a global `$ref` — remove every other node referencing it too.
    if ((node.data as any)?.imported && schema) {
      const originalRef = getRefAtPathInSchema(schema, collectNodePathLabels(node));
      if (originalRef && (originalRef.startsWith('#/$defs/') || originalRef.startsWith('#/definitions/'))) {
        nodes.forEach(n => {
          if (idsToRemove.has(n.id) || n.type === 'variant' || n.type === 'combiner' || n.type === 'root') return;
          const otherRef = getRefAtPathInSchema(schema, collectNodePathLabels(n));
          if (otherRef === originalRef) collectDesc(n.id);
        });
      }
    }

    const updatedNodes = nodes.filter(n => !idsToRemove.has(n.id));
    setNodes(updatedNodes);
    setEdges((eds: Edge[]) => eds.filter((e: Edge) => !idsToRemove.has(e.source) && !idsToRemove.has(e.target)));
    emitLocalSchemaUpdate(buildSchemaFromNodes(updatedNodes));
    setContextMenu(null);
  }, [contextMenu, nodes, schema, collectNodePathLabels, getRefAtPathInSchema, handleDeleteVariant, handleDeleteCombiner, emitLocalSchemaUpdate]);

  // Delete action for XML-mode nodes (element/attribute/complexType/simpleType/attributeGroup/
  // sequence/choice/all), with confirmation. Deleting a top-level global definition also removes
  // every other element/attribute in the schema that references it via `type=`/`ref=`.
  const handleDeleteXmlNode = React.useCallback(() => {
    const ctxNode = nodes.find((n) => n.id === contextMenu?.nodeId);
    if (!ctxNode) { setContextMenu(null); return; }
    const kind = String((ctxNode.data as any)?.xmlNodeKind || '');
    if (!kind || kind === 'schema') { setContextMenu(null); return; }
    const path = ((ctxNode.data as any)?.xmlPath || []) as Array<string | number>;
    if (!Array.isArray(path) || path.length === 0) { setContextMenu(null); return; }

    if (!window.confirm(`Are you sure you want to delete this ${xmlKindLabel(kind).toLowerCase()}?`)) {
      setContextMenu(null);
      return;
    }

    const cloned = JSON.parse(JSON.stringify(schema || {})) as any;

    // Read the definition's own name (needed for the ref-cascade below) before removing it.
    let target: any = cloned;
    for (const segment of path) {
      target = target?.[segment as any];
      if (target == null) break;
    }
    const definitionName = target && typeof target === 'object' ? (target['@attributes']?.name as string | undefined) : undefined;

    if (!deleteAtXmlPath(cloned, path)) {
      setContextMenu(null);
      return;
    }

    const isTopLevelGlobalDefinition =
      path.length === 3 &&
      path[0] === 'xs:schema' &&
      ['xs:complexType', 'xs:simpleType', 'xs:attributeGroup', 'xs:element', 'xs:attribute'].includes(String(path[1]));

    if (isTopLevelGlobalDefinition && definitionName) {
      const refTarget = XML_GLOBAL_REF_TARGETS[kind];
      if (refTarget) {
        refTarget.tagKeys.forEach((tagKey) => pruneXmlRefEntries(cloned, [tagKey], refTarget.attrKey, definitionName));
      }
    }

    emitLocalSchemaUpdate(cloned as Record<string, unknown>);

    const rawRebuilt = schemaToGraph(cloned as Record<string, unknown>);
    const laidOutNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges).map(n =>
      (n.type === 'combiner' || n.type === 'variant') ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } } : n
    );
    setNodes(laidOutNodes);
    setEdges(applyEdgePositioningCached(rawRebuilt.edges, laidOutNodes) as Edge[]);
    setSelectedNodeId(null);
    setContextMenu(null);
  }, [nodes, contextMenu, schema, emitLocalSchemaUpdate, schemaToGraph, relayoutNodes]);

  // Content (attributes/compositor) for an `xs:element` node lives under its inline
  // `xs:complexType`, not the element itself — create one if missing (dropping any `type=`
  // reference, since an element can't have both). No-op (returns `target` unchanged) for
  // any other node kind (e.g. `complexType`, which already IS its own content container).
  const resolveComplexTypeLikeTarget = (target: any, ctxKind: string): any => {
    if (ctxKind !== 'element') return target;
    if (!target['xs:complexType'] || typeof target['xs:complexType'] !== 'object') {
      target['xs:complexType'] = {};
      if (target['@attributes']) delete target['@attributes'].type;
    }
    return target['xs:complexType'];
  };

  // If this complexType is authored as complexContent/extension, content mutations
  // (attributes and compositors) should be written into the extension body.
  const resolveComplexContentAuthoringTarget = (complexTypeLikeTarget: any): any => {
    if (!complexTypeLikeTarget || typeof complexTypeLikeTarget !== 'object') return complexTypeLikeTarget;
    const complexContent = complexTypeLikeTarget['xs:complexContent'];
    if (!complexContent || typeof complexContent !== 'object') return complexTypeLikeTarget;
    const extension = (complexContent as any)['xs:extension'];
    if (!extension || typeof extension !== 'object') return complexTypeLikeTarget;
    return extension;
  };

  // Appends a default `xs:element` particle to a compositor's raw value at `container[key]`,
  // creating the compositor itself if missing. Supports both the flat-array convention (used
  // when this editor authors compositors itself) and the tag-keyed convention produced by
  // parsing real XSD (`{ 'xs:element': [...], ... }`).
  const appendXmlElementToCompositorRawValue = (container: any, key: string) => {
    const compositorValue = container[key];
    if (Array.isArray(compositorValue)) {
      const elementIndex = compositorValue.length;
      compositorValue.push({ '@attributes': { name: `element${elementIndex + 1}`, type: 'xs:string', minOccurs: '1', maxOccurs: '1' } });
      return;
    }
    const holder = (compositorValue && typeof compositorValue === 'object') ? compositorValue : (container[key] = { '@attributes': { minOccurs: '1', maxOccurs: '1' } });
    const existingElementValue = holder['xs:element'];
    const elementIndex = asArray(existingElementValue).length;
    const newElement = { '@attributes': { name: `element${elementIndex + 1}`, type: 'xs:string', minOccurs: '1', maxOccurs: '1' } };
    if (existingElementValue === undefined) holder['xs:element'] = newElement;
    else if (Array.isArray(existingElementValue)) existingElementValue.push(newElement);
    else holder['xs:element'] = [existingElementValue, newElement];
  };

  // Resolves the ctx-menu node's `xmlPath` to its raw schema target, cloning `schema` first.
  // Returns `null` (and closes the menu) if the node/path/target can't be resolved.
  const resolveCtxNodeCloneTarget = (): { ctxNode: Node<SchemaNodeData>; cloned: any; target: any } | null => {
    const ctxNode = nodes.find((n) => n.id === contextMenu?.nodeId);
    if (!ctxNode) {
      setContextMenu(null);
      return null;
    }
    const path = ((ctxNode.data as any)?.xmlPath || []) as Array<string | number>;
    if (!Array.isArray(path) || path.length === 0) {
      setContextMenu(null);
      return null;
    }

    const cloned = JSON.parse(JSON.stringify(schema || {})) as any;
    let target: any = cloned;
    for (const segment of path) {
      if (typeof segment === 'number') {
        if (!Array.isArray(target)) {
          target = null;
          break;
        }
        target = target[segment];
      } else {
        target = target?.[segment];
      }
      if (target == null) break;
    }

    if (!target || typeof target !== 'object') {
      setContextMenu(null);
      return null;
    }
    return { ctxNode, cloned, target };
  };

  // Add a compositor (sequence/choice/all) directly to a `complexType` node, or to an
  // `element` node's inline `xs:complexType` (created on demand).
  const addXmlCompositorToComplexType = (compositorKind: 'sequence' | 'choice' | 'all') => {
    const resolved = resolveCtxNodeCloneTarget();
    if (!resolved) return;
    const { ctxNode, cloned, target: rawTarget } = resolved;

    const ctxKind = String((ctxNode.data as any)?.xmlNodeKind || '');
    const complexTypeLike = resolveComplexTypeLikeTarget(rawTarget, ctxKind);
    const target = resolveComplexContentAuthoringTarget(complexTypeLike);

    const key = `xs:${compositorKind}`;
    if (!target[key] || typeof target[key] !== 'object') {
      target[key] = { '@attributes': { minOccurs: '1', maxOccurs: '1' } };
    }

    emitLocalSchemaUpdate(cloned as Record<string, unknown>);

    const rawRebuilt = schemaToGraph(cloned as Record<string, unknown>);
    const laidOutNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges).map(n =>
      (n.type === 'combiner' || n.type === 'variant') ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } } : n
    );
    const rebuiltNodes = preserveAnchorY(laidOutNodes, nodes, ctxNode.id);
    setNodes(rebuiltNodes);
    setEdges(applyEdgePositioningCached(rawRebuilt.edges, rebuiltNodes) as Edge[]);

    const newNodeId = `${ctxNode.id}.${compositorKind}`;
    if (rebuiltNodes.some((n) => n.id === newNodeId)) {
      setSelectedNodeId(newNodeId);
    }

    setContextMenu(null);
  };

  // Add a nested compositor (sequence/choice/all) inside another compositor
  const addXmlCompositorToCompositor = (compositorKind: 'sequence' | 'choice' | 'all') => {
    const ctxNode = nodes.find((n) => n.id === contextMenu?.nodeId);
    if (!ctxNode) {
      setContextMenu(null);
      return;
    }
    const path = ((ctxNode.data as any)?.xmlPath || []) as Array<string | number>;
    if (!Array.isArray(path) || path.length === 0) {
      setContextMenu(null);
      return;
    }

    const cloned = JSON.parse(JSON.stringify(schema || {})) as any;
    let target: any = cloned;
    for (const segment of path) {
      if (typeof segment === 'number') {
        if (!Array.isArray(target)) {
          target = null;
          break;
        }
        target = target[segment];
      } else {
        target = target?.[segment];
      }
      if (target == null) break;
    }

    if (!Array.isArray(target)) {
      setContextMenu(null);
      return;
    }

    // Add the nested compositor as an array element to the current compositor array
    target.push({
      [`xs:${compositorKind}`]: [],
      '@attributes': { minOccurs: '1', maxOccurs: '1' },
    });

    emitLocalSchemaUpdate(cloned as Record<string, unknown>);

    const rawRebuilt = schemaToGraph(cloned as Record<string, unknown>);
    const laidOutNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges).map(n =>
      (n.type === 'combiner' || n.type === 'variant') ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } } : n
    );
    const rebuiltNodes = preserveAnchorY(laidOutNodes, nodes, ctxNode.id);
    setNodes(rebuiltNodes);
    setEdges(applyEdgePositioningCached(rawRebuilt.edges, rebuiltNodes) as Edge[]);

    setContextMenu(null);
  };

  // Add an element inside a compositor
  const addXmlElementToCompositor = () => {
    const resolved = resolveCtxNodeCloneTarget();
    if (!resolved) return;
    const { ctxNode, cloned, target } = resolved;

    if (Array.isArray(target)) {
      // Flat-array convention: children are pushed directly onto the compositor's own array.
      const elementIndex = target.length;
      target.push({
        '@attributes': {
          name: `element${elementIndex + 1}`,
          type: 'xs:string',
          minOccurs: '1',
          maxOccurs: '1',
        },
      });
    } else {
      // Tag-keyed convention (real parsed XSD, or a compositor created via "Add sequence/choice/all"
      // on a complexType/element node): children live under the compositor's own `xs:element` key.
      const existingElementValue = target['xs:element'];
      const elementIndex = asArray(existingElementValue).length;
      const newElement = { '@attributes': { name: `element${elementIndex + 1}`, type: 'xs:string', minOccurs: '1', maxOccurs: '1' } };
      if (existingElementValue === undefined) target['xs:element'] = newElement;
      else if (Array.isArray(existingElementValue)) existingElementValue.push(newElement);
      else target['xs:element'] = [existingElementValue, newElement];
    }

    emitLocalSchemaUpdate(cloned as Record<string, unknown>);

    const rawRebuilt = schemaToGraph(cloned as Record<string, unknown>);
    const laidOutNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges).map(n =>
      (n.type === 'combiner' || n.type === 'variant') ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } } : n
    );
    const rebuiltNodes = preserveAnchorY(laidOutNodes, nodes, ctxNode.id);
    setNodes(rebuiltNodes);
    setEdges(applyEdgePositioningCached(rawRebuilt.edges, rebuiltNodes) as Edge[]);

    setContextMenu(null);
  };

  // Add an element to a `complexType` node (or an `element` node's inline `xs:complexType`,
  // created on demand), inside its first existing compositor or a newly-created `xs:sequence`.
  const addXmlElementToComplexTypeOrElement = () => {
    const resolved = resolveCtxNodeCloneTarget();
    if (!resolved) return;
    const { ctxNode, cloned, target: rawTarget } = resolved;

    const ctxKind = String((ctxNode.data as any)?.xmlNodeKind || '');
    const complexTypeLike = resolveComplexTypeLikeTarget(rawTarget, ctxKind);
    const contentTarget = resolveComplexContentAuthoringTarget(complexTypeLike);

    const compositorKey = (['xs:sequence', 'xs:choice', 'xs:all'] as const).find((key) => contentTarget[key] !== undefined) || 'xs:sequence';
    appendXmlElementToCompositorRawValue(contentTarget, compositorKey);

    emitLocalSchemaUpdate(cloned as Record<string, unknown>);

    const rawRebuilt = schemaToGraph(cloned as Record<string, unknown>);
    const laidOutNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges).map(n =>
      (n.type === 'combiner' || n.type === 'variant') ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } } : n
    );
    const rebuiltNodes = preserveAnchorY(laidOutNodes, nodes, ctxNode.id);
    setNodes(rebuiltNodes);
    setEdges(applyEdgePositioningCached(rawRebuilt.edges, rebuiltNodes) as Edge[]);

    setContextMenu(null);
  };

  // Add an attribute to a `complexType` node (or an `element` node's inline `xs:complexType`,
  // created on demand).
  const addXmlAttributeToComplexTypeOrElement = () => {
    const resolved = resolveCtxNodeCloneTarget();
    if (!resolved) return;
    const { ctxNode, cloned, target: rawTarget } = resolved;

    const ctxKind = String((ctxNode.data as any)?.xmlNodeKind || '');
    const complexTypeLike = resolveComplexTypeLikeTarget(rawTarget, ctxKind);
    const contentTarget = resolveComplexContentAuthoringTarget(complexTypeLike);

    const existingAttributeValue = contentTarget['xs:attribute'];
    const attributeIndex = asArray(existingAttributeValue).length;
    const newAttribute = { '@attributes': { name: `attribute${attributeIndex + 1}`, type: 'xs:string' } };
    if (existingAttributeValue === undefined) contentTarget['xs:attribute'] = newAttribute;
    else if (Array.isArray(existingAttributeValue)) existingAttributeValue.push(newAttribute);
    else contentTarget['xs:attribute'] = [existingAttributeValue, newAttribute];

    emitLocalSchemaUpdate(cloned as Record<string, unknown>);

    const rawRebuilt = schemaToGraph(cloned as Record<string, unknown>);
    const laidOutNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges).map(n =>
      (n.type === 'combiner' || n.type === 'variant') ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } } : n
    );
    const rebuiltNodes = preserveAnchorY(laidOutNodes, nodes, ctxNode.id);
    setNodes(rebuiltNodes);
    setEdges(applyEdgePositioningCached(rawRebuilt.edges, rebuiltNodes) as Edge[]);

    setContextMenu(null);
  };

  // Explicitly convert a simpleType-backed element into an inline complexType.
  // If a `type` exists, preserve simple content via `xs:simpleContent/xs:extension/@base`.
  const convertXmlElementToInlineComplexType = () => {
    const resolved = resolveCtxNodeCloneTarget();
    if (!resolved) return;
    const { ctxNode, cloned, target } = resolved;

    const ctxKind = String((ctxNode.data as any)?.xmlNodeKind || '');
    if (ctxKind !== 'element' || !target || typeof target !== 'object') {
      setContextMenu(null);
      return;
    }

    if (target['xs:complexType'] && typeof target['xs:complexType'] === 'object') {
      setContextMenu(null);
      return;
    }

    const attrs = (target['@attributes'] && typeof target['@attributes'] === 'object')
      ? target['@attributes'] as Record<string, unknown>
      : undefined;
    const existingType = typeof attrs?.type === 'string' ? attrs.type : undefined;

    if (existingType && existingType.trim().length > 0) {
      target['xs:complexType'] = {
        'xs:simpleContent': {
          'xs:extension': {
            '@attributes': {
              base: existingType,
            },
          },
        },
      };
      delete attrs!.type;
    } else {
      target['xs:complexType'] = {};
      if (attrs) delete attrs.type;
    }

    emitLocalSchemaUpdate(cloned as Record<string, unknown>);

    const rawRebuilt = schemaToGraph(cloned as Record<string, unknown>);
    const laidOutNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges).map(n =>
      (n.type === 'combiner' || n.type === 'variant') ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } } : n
    );
    const rebuiltNodes = preserveAnchorY(laidOutNodes, nodes, ctxNode.id);
    setNodes(rebuiltNodes);
    setEdges(applyEdgePositioningCached(rawRebuilt.edges, rebuiltNodes) as Edge[]);
    setSelectedNodeId(ctxNode.id);

    setContextMenu(null);
  };

  // Add element to schema
  const addXmlElementToSchema = () => {
    try {
      const cloned = JSON.parse(JSON.stringify(schema || {})) as any;
      
      // Handle both { 'xs:schema': {...} } and direct xs:schema object
      const schemaObj = cloned['xs:schema'] || cloned;
      if (!schemaObj || typeof schemaObj !== 'object') {
        setContextMenu(null);
        return;
      }
      
      if (!Array.isArray(schemaObj['xs:element'])) {
        schemaObj['xs:element'] = [];
      }
      
      const elementIndex = schemaObj['xs:element'].length;
      schemaObj['xs:element'].push({
        '@attributes': {
          name: `element${elementIndex + 1}`,
          type: 'xs:string',
        },
      });
      
      // If cloned had xs:schema wrapper, use cloned; otherwise use schemaObj
      const toEmit = cloned['xs:schema'] ? cloned : schemaObj;
      emitLocalSchemaUpdate(toEmit as Record<string, unknown>);
      
      const rawRebuilt = schemaToGraph(toEmit as Record<string, unknown>);
      const laidOutNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges).map(n =>
        (n.type === 'combiner' || n.type === 'variant') ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } } : n
      );
      const schemaNode = nodes.find(n => n.id === '1');
      const rebuiltNodes = preserveAnchorY(laidOutNodes, nodes, schemaNode?.id);
      setNodes(rebuiltNodes);
      setEdges(applyEdgePositioningCached(rawRebuilt.edges, rebuiltNodes) as Edge[]);
    } catch (err) {
      console.error('Failed to add element to schema:', err);
    }
    setContextMenu(null);
  };

  // Add attribute to schema
  const addXmlAttributeToSchema = () => {
    try {
      const cloned = JSON.parse(JSON.stringify(schema || {})) as any;
      
      // Handle both { 'xs:schema': {...} } and direct xs:schema object
      const schemaObj = cloned['xs:schema'] || cloned;
      if (!schemaObj || typeof schemaObj !== 'object') {
        setContextMenu(null);
        return;
      }
      
      if (!Array.isArray(schemaObj['xs:attribute'])) {
        schemaObj['xs:attribute'] = [];
      }
      
      const attributeIndex = schemaObj['xs:attribute'].length;
      schemaObj['xs:attribute'].push({
        '@attributes': {
          name: `attribute${attributeIndex + 1}`,
          type: 'xs:string',
        },
      });
      
      const toEmit = cloned['xs:schema'] ? cloned : schemaObj;
      emitLocalSchemaUpdate(toEmit as Record<string, unknown>);
      
      const rawRebuilt = schemaToGraph(toEmit as Record<string, unknown>);
      const laidOutNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges).map(n =>
        (n.type === 'combiner' || n.type === 'variant') ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } } : n
      );
      const schemaNode = nodes.find(n => n.id === '1');
      const rebuiltNodes = preserveAnchorY(laidOutNodes, nodes, schemaNode?.id);
      setNodes(rebuiltNodes);
      setEdges(applyEdgePositioningCached(rawRebuilt.edges, rebuiltNodes) as Edge[]);
    } catch (err) {
      console.error('Failed to add attribute to schema:', err);
    }
    setContextMenu(null);
  };

  // Add complexType to schema
  const addXmlComplexTypeToSchema = () => {
    try {
      const cloned = JSON.parse(JSON.stringify(schema || {})) as any;
      
      // Handle both { 'xs:schema': {...} } and direct xs:schema object
      const schemaObj = cloned['xs:schema'] || cloned;
      if (!schemaObj || typeof schemaObj !== 'object') {
        setContextMenu(null);
        return;
      }
      
      if (!Array.isArray(schemaObj['xs:complexType'])) {
        schemaObj['xs:complexType'] = [];
      }
      
      const complexTypeIndex = schemaObj['xs:complexType'].length;
      schemaObj['xs:complexType'].push({
        '@attributes': {
          name: `Type${complexTypeIndex + 1}`,
        },
      });
      
      const toEmit = cloned['xs:schema'] ? cloned : schemaObj;
      emitLocalSchemaUpdate(toEmit as Record<string, unknown>);
      
      const rawRebuilt = schemaToGraph(toEmit as Record<string, unknown>);
      const laidOutNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges).map(n =>
        (n.type === 'combiner' || n.type === 'variant') ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } } : n
      );
      const schemaNode = nodes.find(n => n.id === '1');
      const rebuiltNodes = preserveAnchorY(laidOutNodes, nodes, schemaNode?.id);
      setNodes(rebuiltNodes);
      setEdges(applyEdgePositioningCached(rawRebuilt.edges, rebuiltNodes) as Edge[]);
    } catch (err) {
      console.error('Failed to add complexType to schema:', err);
    }
    setContextMenu(null);
  };

  // Add simpleType to schema
  const addXmlSimpleTypeToSchema = () => {
    try {
      const cloned = JSON.parse(JSON.stringify(schema || {})) as any;
      
      // Handle both { 'xs:schema': {...} } and direct xs:schema object
      const schemaObj = cloned['xs:schema'] || cloned;
      if (!schemaObj || typeof schemaObj !== 'object') {
        setContextMenu(null);
        return;
      }
      
      if (!Array.isArray(schemaObj['xs:simpleType'])) {
        schemaObj['xs:simpleType'] = [];
      }
      
      const simpleTypeIndex = schemaObj['xs:simpleType'].length;
      schemaObj['xs:simpleType'].push({
        '@attributes': {
          name: `SimpleType${simpleTypeIndex + 1}`,
        },
      });
      
      const toEmit = cloned['xs:schema'] ? cloned : schemaObj;
      emitLocalSchemaUpdate(toEmit as Record<string, unknown>);
      
      const rawRebuilt = schemaToGraph(toEmit as Record<string, unknown>);
      const laidOutNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges).map(n =>
        (n.type === 'combiner' || n.type === 'variant') ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } } : n
      );
      const schemaNode = nodes.find(n => n.id === '1');
      const rebuiltNodes = preserveAnchorY(laidOutNodes, nodes, schemaNode?.id);
      setNodes(rebuiltNodes);
      setEdges(applyEdgePositioningCached(rawRebuilt.edges, rebuiltNodes) as Edge[]);
    } catch (err) {
      console.error('Failed to add simpleType to schema:', err);
    }
    setContextMenu(null);
  };

  // Add attributeGroup (top-level) to schema
  const addXmlAttributeGroupToSchema = () => {
    try {
      const cloned = JSON.parse(JSON.stringify(schema || {})) as any;
      
      // Handle both { 'xs:schema': {...} } and direct xs:schema object
      const schemaObj = cloned['xs:schema'] || cloned;
      if (!schemaObj || typeof schemaObj !== 'object') {
        setContextMenu(null);
        return;
      }
      
      if (!Array.isArray(schemaObj['xs:attributeGroup'])) {
        schemaObj['xs:attributeGroup'] = [];
      }
      
      const attributeGroupIndex = schemaObj['xs:attributeGroup'].length;
      schemaObj['xs:attributeGroup'].push({
        '@attributes': {
          name: `AttributeGroup${attributeGroupIndex + 1}`,
        },
      });
      
      const toEmit = cloned['xs:schema'] ? cloned : schemaObj;
      emitLocalSchemaUpdate(toEmit as Record<string, unknown>);
      
      const rawRebuilt = schemaToGraph(toEmit as Record<string, unknown>);
      const laidOutNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges).map(n =>
        (n.type === 'combiner' || n.type === 'variant') ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } } : n
      );
      const schemaNode = nodes.find(n => n.id === '1');
      const rebuiltNodes = preserveAnchorY(laidOutNodes, nodes, schemaNode?.id);
      setNodes(rebuiltNodes);
      setEdges(applyEdgePositioningCached(rawRebuilt.edges, rebuiltNodes) as Edge[]);
    } catch (err) {
      console.error('Failed to add attributeGroup to schema:', err);
    }
    setContextMenu(null);
  };

  // Resolves a right-clicked XML node's `ref`/`type`/attributeGroup-ref/complexContent-base
  // back to the id of the top-level node that actually defines it, so "Go to type definition"
  // can jump there. Returns null when the node doesn't reference anything resolvable in-graph
  // (e.g. a built-in type like `xs:string`, or a plain non-ref node).
  const resolveXmlRefTarget = React.useCallback((node: Node<SchemaNodeData> | undefined): string | null => {
    if (!node) return null;
    const data = node.data as any;
    const kind = data.xmlNodeKind as string | undefined;
    const localName = (name: string) => (name.includes(':') ? name.split(':').pop()! : name);

    // `<xs:element ref="Foo"/>` — jump to the global `<xs:element name="Foo">` declaration.
    if (kind === 'element' && data.xmlIsRef && typeof data.xmlName === 'string' && data.xmlName) {
      const target = nodes.find((n) => {
        const nd = n.data as any;
        return nd?.xmlNodeKind === 'element' && nd?.parent === '1' && nd?.xmlName === data.xmlName && n.id !== node.id;
      });
      if (target) return target.id;
    }

    // `type="Foo"` on an element/attribute — jump to the named complexType/simpleType.
    const typeName = kind === 'element' ? data.xmlElementType : kind === 'attribute' ? (data.xmlAttributeType || data.xmlAttributeReferencedTypeName) : undefined;
    if (typeof typeName === 'string' && typeName) {
      const name = localName(typeName);
      const target = nodes.find((n) => {
        const nd = n.data as any;
        return (nd?.xmlNodeKind === 'complexType' || nd?.xmlNodeKind === 'simpleType') && nd?.parent === '1' && nd?.xmlName === name;
      });
      if (target) return target.id;
    }

    // `xs:attributeGroup ref="Foo"` expansion — jump to the top-level group definition.
    if (typeof data.xmlAttributeGroupRef === 'string' && data.xmlAttributeGroupRef) {
      const target = nodes.find((n) => {
        const nd = n.data as any;
        return nd?.xmlNodeKind === 'attributeGroup' && nd?.parent === '1' && nd?.xmlName === data.xmlAttributeGroupRef;
      });
      if (target) return target.id;
    }

    // `xs:complexContent`/`xs:extension base="Foo"` — jump to the base complexType.
    if (typeof data.xmlExtendsType === 'string' && data.xmlExtendsType) {
      const target = nodes.find((n) => {
        const nd = n.data as any;
        return nd?.xmlNodeKind === 'complexType' && nd?.parent === '1' && nd?.xmlName === data.xmlExtendsType;
      });
      if (target) return target.id;
    }

    return null;
  }, [nodes]);

  // Selects the referenced definition's node and pans/zooms the canvas to center on it.
  const goToXmlRefTarget = React.useCallback((targetId: string) => {
    setSelectedNodeId(targetId);
    const rf = reactFlowInstanceRef.current;
    const targetNode = nodes.find((n) => n.id === targetId);
    if (rf && targetNode) {
      const width = estimateNodeWidth(targetNode);
      const height = estimateNodeHeight(targetNode);
      rf.setCenter(targetNode.position.x + width / 2, targetNode.position.y + height / 2, { zoom: 1, duration: 500 });
    }
    setContextMenu(null);
  }, [nodes]);

  // Adds a default anonymous `xs:simpleType` (restriction base="xs:string") to an `xs:attribute`,
  // clearing its `type=` attribute since the two are mutually exclusive in XSD. The new
  // `xs:simpleType` becomes its own child graph node (see `addAttributeInlineSimpleTypeChild`
  // in `xmlSchemaToGraph`), selected immediately so the user can start editing it.
  const addXmlSimpleTypeToAttribute = () => {
    const ctxNode = nodes.find((n) => n.id === contextMenu?.nodeId);
    if (!ctxNode) {
      setContextMenu(null);
      return;
    }
    const path = ((ctxNode.data as any)?.xmlPath || []) as Array<string | number>;
    if (!Array.isArray(path) || path.length === 0) {
      setContextMenu(null);
      return;
    }

    const cloned = JSON.parse(JSON.stringify(schema || {})) as any;
    let target: any = cloned;
    for (const segment of path) {
      if (typeof segment === 'number') {
        if (!Array.isArray(target)) {
          target = null;
          break;
        }
        target = target[segment];
      } else {
        target = target?.[segment];
      }
      if (target == null) break;
    }

    if (!target || typeof target !== 'object') {
      setContextMenu(null);
      return;
    }

    const existingType = (target['@attributes'] as any)?.type;
    if (target['@attributes']) delete (target['@attributes'] as any).type;
    target['xs:simpleType'] = { 'xs:restriction': { '@attributes': { base: existingType || 'xs:string' } } };

    emitLocalSchemaUpdate(cloned as Record<string, unknown>);

    const rawRebuilt = schemaToGraph(cloned as Record<string, unknown>);
    const laidOutNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges).map(n =>
      (n.type === 'combiner' || n.type === 'variant') ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } } : n
    );
    const rebuiltNodes = preserveAnchorY(laidOutNodes, nodes, ctxNode.id);
    setNodes(rebuiltNodes);
    setEdges(applyEdgePositioningCached(rawRebuilt.edges, rebuiltNodes) as Edge[]);

    const newNodeId = `${ctxNode.id}.simpleType`;
    if (rebuiltNodes.some((n) => n.id === newNodeId)) {
      setSelectedNodeId(newNodeId);
    }

    setContextMenu(null);
  };

  // Removes an `xs:attribute`'s inline (anonymous) `xs:simpleType`, restoring a plain
  // `type="xs:string"` so the attribute still has a valid type afterward.
  const removeXmlSimpleTypeFromAttribute = () => {
    const ctxNode = nodes.find((n) => n.id === contextMenu?.nodeId);
    if (!ctxNode) {
      setContextMenu(null);
      return;
    }
    const path = ((ctxNode.data as any)?.xmlPath || []) as Array<string | number>;
    if (!Array.isArray(path) || path.length === 0) {
      setContextMenu(null);
      return;
    }

    const cloned = JSON.parse(JSON.stringify(schema || {})) as any;
    let target: any = cloned;
    for (const segment of path) {
      if (typeof segment === 'number') {
        if (!Array.isArray(target)) {
          target = null;
          break;
        }
        target = target[segment];
      } else {
        target = target?.[segment];
      }
      if (target == null) break;
    }

    if (!target || typeof target !== 'object') {
      setContextMenu(null);
      return;
    }

    delete target['xs:simpleType'];
    if (!target['@attributes']) target['@attributes'] = {};
    if (!target['@attributes'].type) target['@attributes'].type = 'xs:string';

    emitLocalSchemaUpdate(cloned as Record<string, unknown>);

    const rawRebuilt = schemaToGraph(cloned as Record<string, unknown>);
    const laidOutNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges).map(n =>
      (n.type === 'combiner' || n.type === 'variant') ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } } : n
    );
    const rebuiltNodes = preserveAnchorY(laidOutNodes, nodes, ctxNode.id);
    setNodes(rebuiltNodes);
    setEdges(applyEdgePositioningCached(rawRebuilt.edges, rebuiltNodes) as Edge[]);
    setSelectedNodeId(ctxNode.id);

    setContextMenu(null);
  };

  const contextMenuItems = (() => {
    if (isXmlGraphMode) {
      const items: any[] = [];
      const ctxNode = nodes.find((n) => n.id === contextMenu?.nodeId);
      const kind = String((ctxNode?.data as any)?.xmlNodeKind || '');
      if (kind === 'complexType') {
        items.push({ label: 'Add sequence', onClick: () => addXmlCompositorToComplexType('sequence'), disabled: false });
        items.push({ label: 'Add choice', onClick: () => addXmlCompositorToComplexType('choice'), disabled: false });
        items.push({ label: 'Add all', onClick: () => addXmlCompositorToComplexType('all'), disabled: false });
        items.push({ label: 'Add element', onClick: () => addXmlElementToComplexTypeOrElement(), disabled: false });
        items.push({ label: 'Add Attribute', onClick: () => addXmlAttributeToComplexTypeOrElement(), disabled: false });
        items.push({ label: 'Add AttributeGroup', onClick: () => addXmlAttributeGroupToSchema(), disabled: false });
      } else if (kind === 'element') {
        const hasInlineComplexType = Boolean((ctxNode?.data as any)?.xmlHasInlineComplexType);
        const isRefElement = Boolean((ctxNode?.data as any)?.xmlIsRef);
        const elementType = String((ctxNode?.data as any)?.xmlElementType || '');
        const localElementType = elementType.includes(':') ? elementType.split(':').pop()! : elementType;
        const referencesNamedComplexType =
          localElementType.length > 0
          && Array.isArray((ctxNode?.data as any)?.xmlMyComplexTypeNames)
          && ((ctxNode?.data as any).xmlMyComplexTypeNames as string[]).some((name) => {
            const localName = String(name || '').includes(':') ? String(name).split(':').pop()! : String(name);
            return localName === localElementType;
          });
        if (hasInlineComplexType) {
          items.push({ label: 'Add sequence', onClick: () => addXmlCompositorToComplexType('sequence'), disabled: false });
          items.push({ label: 'Add choice', onClick: () => addXmlCompositorToComplexType('choice'), disabled: false });
          items.push({ label: 'Add all', onClick: () => addXmlCompositorToComplexType('all'), disabled: false });
          items.push({ label: 'Add element', onClick: () => addXmlElementToComplexTypeOrElement(), disabled: false });
          items.push({ label: 'Add Attribute', onClick: () => addXmlAttributeToComplexTypeOrElement(), disabled: false });
          items.push({ label: 'Add AttributeGroup', onClick: () => addXmlAttributeGroupToSchema(), disabled: false });
        } else if (!referencesNamedComplexType) {
          items.push({ label: 'Convert to ComplexType', onClick: () => convertXmlElementToInlineComplexType(), disabled: isRefElement });
        }
      } else if (kind === 'sequence' || kind === 'choice' || kind === 'all') {
        // Compositor node context menu
        items.push({ label: 'Add sequence', onClick: () => addXmlCompositorToCompositor('sequence'), disabled: false });
        items.push({ label: 'Add choice', onClick: () => addXmlCompositorToCompositor('choice'), disabled: false });
        items.push({ label: 'Add all', onClick: () => addXmlCompositorToCompositor('all'), disabled: false });
        items.push({ label: 'Add element', onClick: () => addXmlElementToCompositor(), disabled: false });
      } else if (kind === 'schema') {
        // Schema node context menu
        items.push({ label: 'Add Element', onClick: () => addXmlElementToSchema(), disabled: false });
        items.push({ label: 'Add Attribute', onClick: () => addXmlAttributeToSchema(), disabled: false });
        items.push({ label: 'Add ComplexType', onClick: () => addXmlComplexTypeToSchema(), disabled: false });
        items.push({ label: 'Add SimpleType', onClick: () => addXmlSimpleTypeToSchema(), disabled: false });
        items.push({ label: 'Add AttributeGroup', onClick: () => addXmlAttributeGroupToSchema(), disabled: false });
      } else if (kind === 'attribute') {
        // Attribute node context menu — add/remove its inline (anonymous) xs:simpleType.
        const hasInlineSimpleType = Boolean((ctxNode?.data as any)?.xmlHasInlineSimpleType);
        items.push({ label: 'Add SimpleType', onClick: () => addXmlSimpleTypeToAttribute(), disabled: hasInlineSimpleType });
        items.push({ label: 'Remove SimpleType', onClick: () => removeXmlSimpleTypeFromAttribute(), disabled: !hasInlineSimpleType });
      }
      const refTargetId = resolveXmlRefTarget(ctxNode);
      if (refTargetId) {
        items.push({ label: 'Go to type definition', onClick: () => goToXmlRefTarget(refTargetId), disabled: false });
      }
      if (ctxNode && collectDescendantIds(ctxNode.id, nodes).length > 0) {
        items.push({ label: 'Expand all', onClick: () => ctxNode && handleExpandAllChildren(ctxNode.id), disabled: false });
      }
      if (kind && kind !== 'schema') {
        items.push({ label: `Delete ${xmlKindLabel(kind)}`, onClick: () => handleDeleteXmlNode(), disabled: false, danger: true });
      }
      return items;
    }

    const items: any[] = [];
    items.push({
      label: 'Add Property',
      onClick: handleAddProperty,
      disabled: (() => {
        const node = nodes.find(n => n.id === contextMenu?.nodeId);
        if (!node) return true;
        if (!(node.data.type === 'object' || (node.data.type === 'array' && node.data.ofType === 'object'))) return true;
        // Inspect the provided `schema` prop (authoritative source) to find the target schema
        try {
          if (schema) {
            const collectPath = (n: Node<SchemaNodeData> | undefined) => {
              const labels: string[] = [];
              let cur = n;
              while (cur && cur.id !== '1') {
                if (cur.data && cur.data.label) labels.unshift(cur.data.label);
                cur = nodes.find(x => x.id === cur?.data?.parent);
              }
              return labels;
            };
            const path = collectPath(node);
            const getSchemaAtPath = (rootSchema: any, pathArr: string[]) => {
              let cur: any = rootSchema;
              for (const lbl of pathArr) {
                if (!cur) return null;
                if (cur.type === 'object') {
                  cur = (cur.properties || {})[lbl];
                } else if (cur.type === 'array') {
                  cur = (cur.items && cur.items.type === 'object') ? ((cur.items.properties || {})[lbl]) : undefined;
                } else {
                  cur = undefined;
                }
              }
              return cur;
            };
            const target = getSchemaAtPath(schema, path);
            if (target && target.additionalProperties === false) {
              const pp = target.patternProperties || {};
              if (!pp || Object.keys(pp).length === 0) return true; // block adding ad-hoc properties when additionalProperties:false and no patternProperties
            }
          }
        } catch (e) {
          // conservative fallback: allow add
        }
        return false;
      })(),
    });

    // Only show Create Local Override for imported nodes, including imported array nodes.
    const selNode = nodes.find(n => n.id === contextMenu?.nodeId);
    const canShowOverride = Boolean(
      selNode &&
      (selNode.data as any).imported &&
      (selNode.data.type === 'object' || selNode.data.type === 'array')
    );
    if (canShowOverride) {
      items.push({
        label: 'Create Local Override',
        onClick: handleCreateLocalOverride,
        disabled: false,
      });
    }

    items.push({
      label: 'Add Pattern Property',
      onClick: handleAddPatternProperty,
      disabled: (() => {
        const node = nodes.find(n => n.id === contextMenu?.nodeId);
        return !node || !(node.data.type === 'object' || (node.data.type === 'array' && node.data.ofType === 'object'));
      })(),
    });

    const ctxNode = nodes.find(n => n.id === contextMenu?.nodeId);

    if (ctxNode && collectDescendantIds(ctxNode.id, nodes).length > 0) {
      items.push({ label: 'Expand all', onClick: () => handleExpandAllChildren(ctxNode.id), disabled: false });
    }

    if (ctxNode && ctxNode.type !== 'root') {
      const deleteLabel =
        ctxNode.type === 'variant' ? 'Delete Variant'
        : ctxNode.type === 'combiner' ? 'Delete Combiner'
        : ctxNode.type === 'enum' ? 'Delete Enum'
        : 'Delete Property';
      items.push({
        label: deleteLabel,
        onClick: handleDeleteNode,
        disabled: false,
        danger: true,
      });
    }

    // Combiner-specific items
    if (ctxNode?.type === 'combiner') {
      items.push({
        label: 'Add Variant',
        onClick: () => ctxNode && handleAddVariant(ctxNode.id),
        disabled: false,
      });
    }

    // Allow Add Combiner on combiner nodes, variant nodes, and object nodes only.
    // Exclude primitive/array schema nodes.
    if (ctxNode) {
      const isObjectNode = ctxNode.data?.type === 'object';
      const canAddCombiner = ctxNode.type === 'combiner' || ctxNode.type === 'variant' || isObjectNode;
      const alreadyHasCombiner = nodes.some(n => n.type === 'combiner' && (n.data as any)?.parent === ctxNode.id);
      if (canAddCombiner && !alreadyHasCombiner) {
        items.push({
          label: 'Add Combiner',
          onClick: () => ctxNode && handleAddCombinerToNode(ctxNode.id),
          disabled: false,
        });
      }
    }

    return items;
  })();

  const handlePrintGraph = React.useCallback(() => {
    printGraphSection('graphical');
  }, []);

  // Adds `hasChildren`/`onToggleChildren` to every node without touching the many mutation
  // call sites that build `nodes` state — computed fresh from the current parent/child graph.
  const visibleNodesMemo = React.useMemo(() => nodes.filter((n) => !n.hidden), [nodes]);
  const renderNodes = React.useMemo(() => {
    const parentIds = new Set<string>();
    nodes.forEach((n) => {
      const parent = (n.data as any)?.parent;
      if (parent) parentIds.add(parent);
    });
    return visibleNodesMemo.map((n) => ({
      ...n,
      data: {
        ...n.data,
        hasChildren: ((n.data as any).isRef) ? false : parentIds.has(n.id) || Boolean((n.data as any).hasHiddenChildren),
        onToggleChildren: handleToggleNodeChildren,
      },
    }));
  }, [nodes, visibleNodesMemo, handleToggleNodeChildren]);

  const nodeTypesMemo = React.useMemo(() => nodeTypes, []);
  const edgeTypesMemo = React.useMemo(() => edgeTypes, []);
  const visibleNodes = React.useMemo(() => renderNodes.filter((n) => !n.hidden), [renderNodes]);
  const visibleEdges = React.useMemo(() => edges.filter((e) => !e.hidden), [edges]);
  const styledEdges = React.useMemo(
    () => visibleEdges.map((e) => ({ ...e, style: { stroke: '#00e676', strokeWidth: 3 } })),
    [visibleEdges],
  );

  return (
    <>
    <HorizontalSplitPane className={styles.graphicalEditorContainer} defaultRightWidth={385} minRightWidth={280} minLeftWidth={360}>
      <div className={styles.flowPanel}>
        <TooltipProvider>
          <ReactFlowProvider>
            <div ref={flowWrapperRef} className={styles.flowWrapper} style={{ width: '100%', height: explicitHeight ? `${explicitHeight}px` : '100%', minHeight: 360 }}>
              {canRenderFlow ? (
                <ReactFlow
                  style={{ width: '100%', height: explicitHeight ? `${explicitHeight}px` : '100%' }}
                  nodes={visibleNodes}
                  edges={styledEdges}
                  minZoom={0.16}
                  onNodesChange={handleNodesChange}
                  onEdgesChange={handleEdgesChange}
                  onConnect={onConnect}
                  nodeTypes={nodeTypesMemo}
                  edgeTypes={edgeTypesMemo}
                  onInit={(instance) => {
                    reactFlowInstanceRef.current = instance;
                  }}
                  onPaneClick={() => {
                    if (schemaLanguage !== 'xml') {
                      setSelectedNodeId(null);
                    }
                  }}
                  onNodeClick={handleNodeClick}
                  onNodeContextMenu={handleNodeContextMenu}
                  onNodeDragStart={handleNodeDragStart}
                  onNodeDrag={handleNodeDrag}
                  onNodeDragStop={handleNodeDragStop}
                >
                  {/* <MiniMap /> */}
                  <Controls />
                  <Background />
                </ReactFlow>
              ) : (
                /* Render a placeholder box while we wait for layout to measure */
                <div style={{ width: '100%', height: 360 }} />
              )}
            </div>
          </ReactFlowProvider>
        </TooltipProvider>
      </div>
      <div className={styles.sidebarPanel}>
        <GraphicalSchemaRhsControl
          selectedNode={selectedNode}
          onChange={handleNodePropertyChange}
          schemaLanguage={schemaLanguage}
          schemaDialectLabel={schemaDialectLabel}
          showXmlDetails={showXmlDetails}
          showSchemaDetails={showSchemaDetails}
          xmlSchemaDetails={xmlSchemaDetails}
          onToggleSchemaDetails={() => setShowSchemaDetails(prev => !prev)}
          onToggleShowAnnotations={handleToggleShowAnnotations}
          xmlShowAnnotations={xmlShowAnnotations}
          onToggleShowImports={handleToggleShowImports}
          xmlShowImports={xmlShowImports}
          onPrintGraph={handlePrintGraph}
          getNodeByName={(name: string) => {
            if (!reactFlowInstanceRef.current) return null;
            const allNodes = reactFlowInstanceRef.current.getNodes();
            return allNodes.find((n: any) => n.data?.xmlName === name) || null;
          }}
        />
      </div>
    </HorizontalSplitPane>
    {contextMenu?.visible && (
      <ContextMenu
        items={contextMenuItems}
        position={contextMenu.position}
        onClose={() => setContextMenu(null)}
      />
    )}
    </>
  );
}


