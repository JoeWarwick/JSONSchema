import React from 'react';
import * as dagreLib from 'dagre';
import { ContextMenu } from "./ContextMenu";
import {
  addPropertyToSchema,
  addPatternPropertyToSchema,
  removePropertyFromSchema,
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
import { applySnappedDagreLayout } from './graphical-schema-layout-snapped';
import { GraphicalSchemaRhsControl } from './graphical-schema-rhs-control';
import type { Connection, Edge, Node, OnConnect } from "reactflow"
import type { SchemaNodeData } from "./schema-behaviors";
import type { NodeData, GraphicalSchemaEditorProps } from './types';
import { nodeTypes, edgeTypes, initialNodes, initialEdges } from './schema-node-types';
import { printGraphSection } from '../utils/print-graph';
import "reactflow/dist/style.css";
import styles from "./graphical-schema-editor.module.css";

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
  const pendingTimeoutsRef = React.useRef<number[]>([]);
  const isMountedRef = React.useRef(true);
  // Only render ReactFlow when the wrapper has a measured non-zero height.
  // This avoids React Flow error #004 when the parent container has no height
  // at initial render (e.g. due to CSS/layout timing).
  const [canRenderFlow, setCanRenderFlow] = React.useState<boolean>(() => false);
  const [explicitHeight, setExplicitHeight] = React.useState<number | undefined>(undefined);
  const failedChecksRef = React.useRef<number>(0);

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
    const xmlSchemaProps = ['targetNamespace', 'elementFormDefault', 'attributeFormDefault', 'blockDefault', 'finalDefault', 'version', 'id', 'xmlns', 'xmlns:xs'];
    xmlSchemaProps.forEach(prop => {
      if (Object.prototype.hasOwnProperty.call(node, prop)) {
        directProps[prop] = (node as any)[prop];
      }
    });
    // Merge: direct properties override @attributes
    const merged = { ...fromAttrs, ...directProps };
    if (Object.keys(merged).length > 0) {
      console.log('[getXmlAttrs] @attributes:', fromAttrs, 'directProps:', directProps, 'merged:', merged);
    }
    return merged;
  }, []);

  const xmlSchemaToGraph = React.useCallback((xmlDoc: Record<string, unknown>): { nodes: Node<SchemaNodeData>[]; edges: Edge[] } => {
    const nodes: Node<SchemaNodeData>[] = [];
    const edges: Edge[] = [];

    const schemaRoot = ((xmlDoc as any)?.['xs:schema'] && typeof (xmlDoc as any)['xs:schema'] === 'object')
      ? (xmlDoc as any)['xs:schema']
      : xmlDoc;

    const schemaAttrs = getXmlAttrs(schemaRoot);

    const addNode = (data: any, parentId?: string) => {
      const id = data.id as string;
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

    const XML_COMPOSITOR_TAG_KEYS = ['xs:sequence', 'xs:choice', 'xs:all'] as const;
    type XmlCompositorTagKey = typeof XML_COMPOSITOR_TAG_KEYS[number];

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

    // Adds an `element` node under `parentId`, recursing into any inline
    // (anonymous) complexType defined directly on the element (e.g. an
    // `xs:element` whose type is declared inline rather than referenced by name),
    // or, failing that, the global complexType named by the element's `type` attribute.
    // `ancestors` tracks complexType names already expanded on this branch so a type
    // that (directly or transitively) references itself is expanded once, then stopped
    // and flagged with an `isRef` badge instead of recursing forever.
    const addXmlElementNode = (elemEntry: any, parentId: string, elementPath: Array<string | number>, index: number, ancestors: Set<string> = new Set()) => {
      if (!elemEntry || typeof elemEntry !== 'object') return;
      const elemAttrs = getXmlAttrs(elemEntry);
      const elementId = `${parentId}.element_${index}`;
      const { referenced, typeName, circular } = resolveElementTypeExpansion(elemAttrs, ancestors);
      addNode({
        id: elementId,
        label: toNodeLabel('element', elemAttrs, (elemAttrs.name as string) || (elemAttrs.ref as string) || `${index + 1}`),
        type: 'property',
        parent: parentId,
        xmlNodeKind: 'element',
        xmlPath: elementPath,
        xmlName: elemAttrs.name,
        xmlElementType: elemAttrs.type,
        xmlMinOccurs: elemAttrs.minOccurs ?? '1',
        xmlMaxOccurs: elemAttrs.maxOccurs ?? '1',
        ...(circular ? { isRef: true } : {}),
      }, parentId);

      const inlineComplexType = (elemEntry as any)['xs:complexType'];
      if (inlineComplexType && typeof inlineComplexType === 'object') {
        addInlineComplexTypeChildren(inlineComplexType, elementId, [...elementPath, 'xs:complexType'], ancestors);
      } else if (referenced && typeName && !circular) {
        addInlineComplexTypeChildren(referenced.entry, elementId, ['xs:schema', 'xs:complexType', referenced.index], new Set(ancestors).add(typeName));
      }
    };

    // Adds the attribute and compositor children found on an inline (anonymous)
    // complexType, e.g. `<xs:element><xs:complexType>...</xs:complexType></xs:element>`,
    // or a named complexType being expanded inline under an element that references it by type.
    // `idSuffix` disambiguates node ids when this function is invoked more than once for the
    // same `parentId` (currently only happens for `xs:complexContent`/`xs:extension`, where the
    // base type's own children and the extension's own children are both merged in under the
    // same parent), so base-type ids don't collide with the extension's own attribute/compositor ids.
    const addInlineComplexTypeChildren = (complexTypeValue: any, parentId: string, basePath: Array<string | number>, ancestors: Set<string> = new Set(), idSuffix: string = '') => {
      if (!complexTypeValue || typeof complexTypeValue !== 'object') return;

      // `xs:complexContent` replaces the direct content model with `xs:extension`/`xs:restriction`
      // of a `base` type: expand the base type's own children first (inherited), then merge in
      // the attributes/compositor declared directly on the extension/restriction itself.
      const complexContent = (complexTypeValue as any)['xs:complexContent'];
      if (complexContent && typeof complexContent === 'object') {
        const derivationKey = (['xs:extension', 'xs:restriction'] as const).find((key) => (complexContent as any)[key] !== undefined);
        const derivation = derivationKey ? (complexContent as any)[derivationKey] : undefined;
        if (derivation && typeof derivation === 'object') {
          const derivationAttrs = getXmlAttrs(derivation);
          const rawBase = typeof derivationAttrs.base === 'string' ? derivationAttrs.base : undefined;
          const baseTypeName = rawBase ? localTypeName(rawBase) : undefined;
          const baseType = baseTypeName ? complexTypesByName.get(baseTypeName) : undefined;
          if (baseType && baseTypeName && !ancestors.has(baseTypeName)) {
            addInlineComplexTypeChildren(baseType.entry, parentId, ['xs:schema', 'xs:complexType', baseType.index], new Set(ancestors).add(baseTypeName), `${idSuffix}.base`);
          }
          addInlineComplexTypeChildren(derivation, parentId, [...basePath, 'xs:complexContent', derivationKey!], ancestors, idSuffix);
        }
        return;
      }

      const attributeValue = (complexTypeValue as any)['xs:attribute'];
      asArray(attributeValue).forEach((attributeEntry, attributeIndex) => {
        if (!attributeEntry || typeof attributeEntry !== 'object') return;
        const attributeAttrs = getXmlAttrs(attributeEntry);
        const attrPath = Array.isArray(attributeValue)
          ? [...basePath, 'xs:attribute', attributeIndex]
          : [...basePath, 'xs:attribute'];
        addNode({
          id: `${parentId}${idSuffix}.attribute_${attributeIndex}`,
          label: toNodeLabel('attribute', attributeAttrs, `${attributeIndex + 1}`),
          type: 'property',
          parent: parentId,
          xmlNodeKind: 'attribute',
          xmlPath: attrPath,
          xmlName: attributeAttrs.name,
          xmlAttributeType: attributeAttrs.type,
          xmlAttributeUse: attributeAttrs.use || 'optional',
        }, parentId);
      });

      XML_COMPOSITOR_TAG_KEYS.forEach((compositorKey) => {
        const compositorValue = (complexTypeValue as any)[compositorKey];
        if (compositorValue !== undefined && compositorValue !== null) {
          addCompositorNode(compositorValue, parentId, [...basePath, compositorKey], compositorKey, undefined, ancestors, idSuffix);
        }
      });
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
    ) => {
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
      }, parentId);

      addCompositorChildren(compositorValue, compositorId, path, ancestors);
    };

    // Processes the children living under a compositor's raw value (or a
    // top-level complexType's compositor). Supports both the flat-array
    // convention used by this editor's own context-menu "Add element"/"Add
    // sequence|choice|all" actions, and the tag-keyed shape produced by
    // parsing real XSD documents (e.g. `{ 'xs:sequence': {...}, 'xs:element': {...} }`).
    const addCompositorChildren = (containerValue: any, parentId: string, basePath: Array<string | number>, ancestors: Set<string> = new Set()) => {
      if (!containerValue || typeof containerValue !== 'object') return;

      if (Array.isArray(containerValue)) {
        containerValue.forEach((item, itemIndex) => {
          if (!item || typeof item !== 'object') return;
          const itemPath = [...basePath, itemIndex];
          const nestedCompositorKey = XML_COMPOSITOR_TAG_KEYS.find((key) => (item as any)[key] !== undefined);
          if (nestedCompositorKey) {
            addCompositorNode((item as any)[nestedCompositorKey], parentId, [...itemPath, nestedCompositorKey], nestedCompositorKey, undefined, ancestors);
            return;
          }
          const itemAttrs = getXmlAttrs(item);
          if (itemAttrs.name || itemAttrs.ref) {
            addXmlElementNode(item, parentId, itemPath, itemIndex, ancestors);
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
          addXmlElementNode(elemEntry, parentId, elementPath, elemIndex, ancestors);
        });
      }

      XML_COMPOSITOR_TAG_KEYS.forEach((nestedKey) => {
        const nestedValue = (containerValue as any)[nestedKey];
        if (nestedValue !== undefined && nestedValue !== null) {
          addCompositorNode(nestedValue, parentId, [...basePath, nestedKey], nestedKey, undefined, ancestors);
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

    addNode(xmlSchemaNodeData);

    const simpleTypes = asArray((schemaRoot as any)?.['xs:simpleType']);
    const complexTypes = asArray((schemaRoot as any)?.['xs:complexType']);
    const elements = asArray((schemaRoot as any)?.['xs:element']);

    // Name -> definition/index lookup so element `type` attributes can be resolved and
    // expanded inline (with circular-reference protection via resolveElementTypeExpansion).
    const complexTypesByName = new Map<string, { entry: any; index: number }>();
    complexTypes.forEach((ct: any, idx: number) => {
      if (!ct || typeof ct !== 'object') return;
      const ctAttrs = getXmlAttrs(ct);
      if (typeof ctAttrs.name === 'string' && ctAttrs.name) complexTypesByName.set(ctAttrs.name, { entry: ct, index: idx });
    });

    simpleTypes.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') return;
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
      const simpleTypeAttributes = asArray((entry as any)?.['xs:attribute']).map((attrEntry: any) => {
        const attrAttrs = getXmlAttrs(attrEntry);
        return { name: attrAttrs.name, type: attrAttrs.type, use: attrAttrs.use || 'optional' };
      });
      
      // Check if this simpleType is marked as a global reference
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
        xmlItemType: listAttrs.itemType,
        xmlAttributes: simpleTypeAttributes,
        xmlIsRef: isGlobalRef,
      }, '1');
    });

    // complexTypes and elements already extracted above
    complexTypes.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') return;
      const attrs = getXmlAttrs(entry);
      const complexId = `1.complexType_${index}`;
      const complexTypeAttributes = asArray((entry as any)?.['xs:attribute']).map((attrEntry: any) => {
        const attrAttrs = getXmlAttrs(attrEntry);
        return { name: attrAttrs.name, type: attrAttrs.type, use: attrAttrs.use || 'optional' };
      });
      
      // Check if this complexType is marked as a global reference
      const isGlobalRef = Boolean(attrs.ref);
      const nodeType = isGlobalRef ? 'globalType' : 'property';
      
      addNode({
        id: complexId,
        label: toNodeLabel('complexType', attrs, `${index + 1}`),
        type: nodeType,
        parent: '1',
        xmlNodeKind: 'complexType',
        xmlPath: ['xs:schema', 'xs:complexType', index],
        xmlName: attrs.name,
        xmlAttributes: complexTypeAttributes,
        xmlIsRef: isGlobalRef,
      }, '1');

      // Seed the ancestor set with this type's own name so a child element that
      // references the SAME complexType (a self-reference) is immediately flagged
      // circular (isRef) rather than expanding one unwanted extra level first. This also
      // covers `xs:complexContent`/`xs:extension` (e.g. `arrayOfType extends modelType`),
      // routed through the shared helper so base-type attributes/compositors merge in too.
      const ownTypeAncestors = typeof attrs.name === 'string' && attrs.name ? new Set([attrs.name]) : new Set<string>();
      addInlineComplexTypeChildren(entry, complexId, ['xs:schema', 'xs:complexType', index], ownTypeAncestors);
    });

    // elements already extracted above; routed through addXmlElementNode so a global
    // element's `type` attribute can be expanded inline (with circular-ref protection).
    elements.forEach((entry, index) => {
      addXmlElementNode(entry, '1', ['xs:schema', 'xs:element', index], index);
    });

    // Add top-level attributes to the schema
    const attributes = asArray((schemaRoot as any)?.['xs:attribute']);
    attributes.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') return;
      const attrs = getXmlAttrs(entry);
      addNode({
        id: `1.attribute_${index}`,
        label: toNodeLabel('attribute', attrs, `${index + 1}`),
        type: 'property',
        parent: '1',
        xmlNodeKind: 'attribute',
        xmlPath: ['xs:schema', 'xs:attribute', index],
        xmlName: attrs.name,
        xmlAttributeType: attrs.type,
        xmlAttributeUse: attrs.use || 'optional',
      }, '1');
    });

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

    console.log('[updateXmlNodeAtPath] sourceSchema keys:', Object.keys(sourceSchema || {}));
    const cloned = JSON.parse(JSON.stringify(sourceSchema || {})) as any;
    const getAtPath = (root: any, path: Array<string | number>) => {
      let current = root;
      for (const segment of path) {
        if (current == null) return null;
        if (typeof segment === 'number') {
          if (!Array.isArray(current)) return null;
          current = current[segment];
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
    const kind = String((node?.data as any)?.xmlNodeKind || '');

    if (kind === 'simpleType') {
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
    }

    if (kind === 'element') {
      const attrs = getOrCreateAttrs(target);
      if (!attrs) return null;
      if (Object.prototype.hasOwnProperty.call(patch, 'xmlName')) {
        const value = (patch as any).xmlName;
        if (value) attrs.name = value;
        else delete attrs.name;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'xmlElementType')) {
        const value = (patch as any).xmlElementType;
        if (value) attrs.type = value;
        else delete attrs.type;
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
    }

    // Handle attribute operations on simpleType or complexType
    if ((kind === 'simpleType' || kind === 'complexType') && target && typeof target === 'object') {
      if (Object.prototype.hasOwnProperty.call(patch, 'xmlAddAttribute')) {
        const newAttr = (patch as any).xmlAddAttribute;
        if (!Array.isArray(target['xs:attribute'])) target['xs:attribute'] = [];
        const attrObj: any = { '@attributes': {} };
        if (newAttr.name) attrObj['@attributes'].name = newAttr.name;
        if (newAttr.type) attrObj['@attributes'].type = newAttr.type;
        if (newAttr.use && newAttr.use !== 'optional') attrObj['@attributes'].use = newAttr.use;
        (target['xs:attribute'] as any[]).push(attrObj);
      }

      if (Object.prototype.hasOwnProperty.call(patch, 'xmlRemoveAttributeIndex')) {
        const index = (patch as any).xmlRemoveAttributeIndex;
        if (Array.isArray(target['xs:attribute']) && index >= 0 && index < target['xs:attribute'].length) {
          (target['xs:attribute'] as any[]).splice(index, 1);
        }
      }

      if (Object.prototype.hasOwnProperty.call(patch, 'xmlUpdateAttributeIndex')) {
        const update = (patch as any).xmlUpdateAttributeIndex;
        const index = update.index;
        if (Array.isArray(target['xs:attribute']) && index >= 0 && index < target['xs:attribute'].length) {
          const attrEntry = target['xs:attribute'][index];
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
  const relayoutNodes = React.useCallback((inputNodes: Node<SchemaNodeData>[], inputEdges: Edge[]) => {
    if (!Array.isArray(inputNodes) || inputNodes.length === 0) return inputNodes;

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

    const getSortLabel = (n: Node<SchemaNodeData>) => (((n.data as any)?.label as string) || '').toString();
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

      const byLabel = getSortLabel(a).localeCompare(getSortLabel(b), undefined, { numeric: true, sensitivity: 'base' });
      if (byLabel !== 0) return byLabel;
      return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' });
    };

    const orderedVisibleNodes = [...visibleNodes].sort(compareLayoutSiblings);
    const visibleNodeById = new Map(orderedVisibleNodes.map((n) => [n.id, n]));

    // Try dagre
    if (dagreLib) {
      try {
        const g = new dagreLib.graphlib.Graph();
        g.setGraph({ rankdir: 'LR', nodesep: 32, ranksep: 35 });
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

        // Layout mode toggle for experimentation and debugging.
        // Current default keeps Dagre positions for combiner + variant nodes.
        const COMBINER_VARIANT_LAYOUT_MODE: 'manual' | 'dagre-variants' | 'dagre-all' = 'dagre-all';
        if (COMBINER_VARIANT_LAYOUT_MODE === 'dagre-all') {
          return [...finalLaid, ...hiddenNodes];
        }

        const useDagreVariantLayout = COMBINER_VARIANT_LAYOUT_MODE === 'dagre-variants';
        return applySnappedDagreLayout({
          finalLaid,
          hiddenNodes,
          dagreNodeFor: (id) => g.node(id),
          estimateWidth,
          estimateHeight,
          compareLayoutSiblings,
          useDagreVariantLayout,
          nodeGap: 16,
          ranksep: 35,
          additionalPropertiesGap: 60,
        });
      } catch (err) {
        // If Dagre fails, keep current positions.
      }
    }

    // No heuristic fallback: preserve current positions when Dagre isn't available.
    return inputNodes;
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
        setEdges(() => newEdges);

        return applyRelayout([
          ...prev.map((n: Node<SchemaNodeData>) =>
            n.id === variantId
              ? { ...variantNode, data: { ...vData, variantExpanded: true, variantResolved: true, isResolving: false } as any }
              : n
          ),
          ...injectHandlers(repairedSubNodes),
        ], newEdges);
      }

      if (willExpand) {
        const willExpand_edges = edgesRef.current.map((e: Edge) =>
          e.source === variantId || e.target === variantId ? { ...e, hidden: false } : e
        );
        setEdges(() => willExpand_edges);
        return applyRelayout(prev.map((n: Node<SchemaNodeData>) => {
          if (n.id === variantId) return { ...n, data: { ...n.data, variantExpanded: true } as any };
          if ((n.data as any)?.parent === variantId) return { ...n, hidden: false };
          return n;
        }), willExpand_edges);
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
      return applyRelayout(prev.map((n: Node<SchemaNodeData>) => {
        if (n.id === variantId) return { ...n, data: { ...n.data, variantExpanded: false } as any };
        if (toHide.has(n.id)) return { ...n, hidden: true };
        return n;
      }), collapseEdges);
    });
  }, [edgesRef, injectHandlers, nodeHandlersRef, resolveRefInSchema, schemaToGraph, relayoutNodes, preserveAnchorY, setEdges, setNodes, setVariantExpandedPersisted, setCombinerExpandedPersisted]);

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
      setEdges(() => toggledEdges);
      const next = prev.map((n: Node<SchemaNodeData>) => {
        if (n.id === combinerId)
          return { ...n, data: { ...n.data, variantsExpanded: willExpand } as any };
        if (variantIds.has(n.id))
          return { ...n, hidden: !willExpand };
        return n;
      });
      const laid = relayoutNodes(next, toggledEdges);
      const anchored = preserveAnchorY(laid, prev, combinerId);
      return anchored.map(n =>
        (n.type === 'combiner' || n.type === 'variant')
          ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } }
          : n
      );
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
      
      // Rebuild the entire graph from the updated schema to ensure all changes are reflected
      const rawRebuilt = schemaToGraph(updated as Record<string, unknown>);
      const laidOutNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges).map(n =>
        (n.type === 'combiner' || n.type === 'variant') ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } } : n
      );
      setNodes(laidOutNodes);
      setEdges(applyEdgePositioning(rawRebuilt.edges, laidOutNodes) as Edge[]);
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

  // Context menu state
  const [contextMenu, setContextMenu] = React.useState<{ visible: boolean; position: { x: number; y: number }; nodeId: string | null } | null>(null);
  const [showSchemaDetails, setShowSchemaDetails] = React.useState(false);

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
    const rawGraph = schemaToGraph(schemaForGraph);
    console.log('[Schema effect] rawGraph nodes:', rawGraph.nodes.length, 'edges:', rawGraph.edges.length, 'isXmlGraphMode:', isXmlGraphMode);
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

    const nodes = relayoutNodes(nodesWithRestoredExpansion, edgesWithRestoredExpansion).map(n =>
      (n.type === 'combiner' || n.type === 'variant')
        ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } }
        : n
    );
    const edges = applyEdgePositioning(edgesWithRestoredExpansion, nodes);
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
  }, [schema, setNodes, setEdges, useTestData, schemaToGraph, fingerprintSchema, relayoutNodes, restoreExpandedStateRecursively, scheduleTask]);

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

  // Re-centre the graph after a variant collapse — but only when the remaining
  // visible graph has drifted outside the current viewport (user is "lost in space").
  React.useEffect(() => {
    if (!pendingCenterRef.current) return;
    pendingCenterRef.current = false;
    const rf = reactFlowInstanceRef.current;
    if (!rf) return;
    const allNodes = (rf.getNodes() as any[]).filter((n: any) => !n.hidden);
    if (allNodes.length === 0) return;

    const wrapper = flowWrapperRef.current;
    const containerW = wrapper?.offsetWidth ?? 800;
    const containerH = wrapper?.offsetHeight ?? 600;

    // Bounding box of remaining visible nodes (add rough node size)
    const xs = allNodes.map((n: any) => n.position.x);
    const ys = allNodes.map((n: any) => n.position.y);
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

    // If the graph bbox still overlaps the viewport, the user can see it — no need to move
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
    const rebuiltEdges = applyEdgePositioning(rawRebuilt.edges, rebuiltNodes) as Edge[];
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
    const rebuiltEdges = applyEdgePositioning(rawRebuilt.edges, rebuiltNodes) as Edge[];
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
    const rebuiltEdges = applyEdgePositioning(rawRebuilt.edges, rebuiltNodes) as Edge[];
    setNodes(rebuiltNodes);
    setEdges(rebuiltEdges);

    const newId = makeId(parentNode.id, 'username');
    const newNode = rebuiltNodes.find(n => n.id === newId || (n.data && n.data.label === 'username'));
    if (newNode) setSelectedNodeId(newNode.id);

    setContextMenu(null);
  };

  // Delete Property action (with confirmation)
  const handleDeleteProperty = () => {
    if (isXmlGraphMode) {
      setContextMenu(null);
      return;
    }
    if (!contextMenu?.nodeId) return;
    const node = nodes.find(n => n.id === contextMenu.nodeId);
    if (!node) return;
    if (window.confirm('Are you sure you want to delete this property?')) {
      // Remove node from graph and update parent if needed
      setNodes((nds: Node<SchemaNodeData>[]) =>
        nds
          .filter((n: Node<SchemaNodeData>) => n.id !== contextMenu.nodeId)
          .map((n: Node<SchemaNodeData>) => {
            // If this node is a parent, remove property from its properties
            interface NodeWithProperties extends Node<SchemaNodeData> {
              data: SchemaNodeData & { properties?: Record<string, unknown> };
            }
            if (
              n.data.type === 'object' &&
              (n as NodeWithProperties).data.properties &&
              contextMenu.nodeId !== null &&
              (n as NodeWithProperties).data.properties?.[contextMenu.nodeId]
            ) {
              const updatedData: Record<string, unknown> = removePropertyFromSchema(
                n.data as unknown as Record<string, unknown>,
                contextMenu.nodeId
              );
              // Merge updatedData into n.data, preserving SchemaNodeData shape
              return {
                ...n,
                data: {
                  ...n.data,
                  ...updatedData,
                  id: n.data.id,
                  label: n.data.label,
                  type: n.data.type,
                } as SchemaNodeData,
              };
            }
            return n;
          })
      );
      setEdges((eds: Edge[]) => eds.filter((e: Edge) => e.target !== contextMenu.nodeId && e.source !== contextMenu.nodeId));
    }
    setContextMenu(null);
  };

  // Context menu items; only include override when node is imported
  const addXmlCompositorToComplexType = (compositorKind: 'sequence' | 'choice' | 'all') => {
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
    setEdges(applyEdgePositioning(rawRebuilt.edges, rebuiltNodes) as Edge[]);

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
    setEdges(applyEdgePositioning(rawRebuilt.edges, rebuiltNodes) as Edge[]);

    setContextMenu(null);
  };

  // Add an element inside a compositor
  const addXmlElementToCompositor = () => {
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

    // Add an element to the compositor array
    const elementIndex = target.length;
    target.push({
      '@attributes': {
        name: `element${elementIndex + 1}`,
        type: 'xs:string',
        minOccurs: '1',
        maxOccurs: '1',
      },
    });

    emitLocalSchemaUpdate(cloned as Record<string, unknown>);

    const rawRebuilt = schemaToGraph(cloned as Record<string, unknown>);
    const laidOutNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges).map(n =>
      (n.type === 'combiner' || n.type === 'variant') ? { ...n, data: { ...n.data, id: n.id, ...nodeHandlersRef.current } } : n
    );
    const rebuiltNodes = preserveAnchorY(laidOutNodes, nodes, ctxNode.id);
    setNodes(rebuiltNodes);
    setEdges(applyEdgePositioning(rawRebuilt.edges, rebuiltNodes) as Edge[]);

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
      setEdges(applyEdgePositioning(rawRebuilt.edges, rebuiltNodes) as Edge[]);
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
      setEdges(applyEdgePositioning(rawRebuilt.edges, rebuiltNodes) as Edge[]);
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
      setEdges(applyEdgePositioning(rawRebuilt.edges, rebuiltNodes) as Edge[]);
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
      setEdges(applyEdgePositioning(rawRebuilt.edges, rebuiltNodes) as Edge[]);
    } catch (err) {
      console.error('Failed to add simpleType to schema:', err);
    }
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

    items.push({
      label: ctxNode?.type === 'variant' ? 'Delete Variant' : 'Delete Property',
      onClick: () => {
        if (ctxNode?.type === 'variant') {
          handleDeleteVariant(ctxNode.id);
          setContextMenu(null);
          return;
        }
        handleDeleteProperty();
      },
      disabled: false,
    });

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

  return (
    <>
    <HorizontalSplitPane className={styles.graphicalEditorContainer} defaultRightWidth={320} minRightWidth={280} minLeftWidth={360}>
      <div className={styles.flowPanel}>
        <TooltipProvider>
          <ReactFlowProvider>
            <div ref={flowWrapperRef} className={styles.flowWrapper} style={{ width: '100%', height: explicitHeight ? `${explicitHeight}px` : '100%', minHeight: 360 }}>
              {canRenderFlow ? (
                <ReactFlow
                  style={{ width: '100%', height: explicitHeight ? `${explicitHeight}px` : '100%' }}
                  nodes={nodes}
                  edges={edges.map(e => ({ ...e, style: { stroke: '#00e676', strokeWidth: 3 } }))}
                  minZoom={0.16}
                  onNodesChange={handleNodesChange}
                  onEdgesChange={handleEdgesChange}
                  onConnect={onConnect}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  onInit={(instance) => {
                    reactFlowInstanceRef.current = instance;
                  }}
                  onNodeClick={handleNodeClick}
                  onNodeContextMenu={handleNodeContextMenu}
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
          onPrintGraph={handlePrintGraph}
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


