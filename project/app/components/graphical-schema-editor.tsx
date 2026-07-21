import React from 'react';
import * as dagreLib from 'dagre';
import { MemoizedNodePropertyEditor } from './NodePropertyEditor';
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
} from "reactflow";
import { Printer } from "lucide-react";
import { TooltipProvider } from "./ui/tooltip/tooltip";
import { HorizontalSplitPane } from "./ui/split-pane";
import { getVariantLabel } from '../utils/labels';
import { applySnappedDagreLayout } from './graphical-schema-layout-snapped';
import type { Connection, Edge, Node, OnConnect } from "reactflow"
import type { SchemaNodeData } from "./schema-behaviors";
import type { NodeData, GraphicalSchemaEditorProps } from './types';
import { nodeTypes, initialNodes, initialEdges } from './schema-node-types';
import { printGraphSection } from '../utils/print-graph';
import "reactflow/dist/style.css";
import styles from "./graphical-schema-editor.module.css";

export function GraphicalSchemaEditor({ schema, onChange, useTestData }: GraphicalSchemaEditorProps) {
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

  // Full schemaToGraph implementation
  const schemaToGraph = React.useCallback((schema: Record<string, unknown>): { nodes: Node<SchemaNodeData>[]; edges: Edge[] } => {
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

    function walkSchema(obj: any, parentId?: string, label?: string, x = 0, y = 0, parentRequired?: string[]): string {
      const id = makeId(parentId, label);
      // Resolve local $ref and oneOf refs that reference definitions within the schema so we can traverse referenced definitions
      const resolveLocalRef = (candidate: any): any => {
        if (!candidate || typeof candidate !== 'object') return candidate;
        // Direct $ref to local definition — resolve and merge
        if (typeof candidate.$ref === 'string' && candidate.$ref.startsWith('#/')) {
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
      obj = resolveLocalRef(obj);

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
        if (obj && typeof obj === 'object') {
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
            walkSchema(propSchema, id, key, x + 250, propY, obj.required || []);
            propY += 140;
          }
        }
        // Pattern properties (render as compact nodes labeled `pattern` and store regex in data.patternKey)
        if (obj.patternProperties && typeof obj.patternProperties === 'object') {
          for (const [pat, subschema] of Object.entries(obj.patternProperties)) {
            // Use a deterministic unique label for ID generation but display a concise 'pattern' label on the node
            const patLabelForId = `pattern: ${pat}`;
            const createdId = walkSchema(subschema, id, patLabelForId, x + 250, propY, obj.required || []);
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
          const additionalId = walkSchema(additionalPropertiesSchema, id, 'additionalProperties', x + 250, propY, obj.required || []);
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
          walkSchema(propSchema, id, key, x + 250, propY, obj.items.required || []);
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
  }, []);

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
    const edges = edgesWithRestoredExpansion;
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
    if (node.id === '1') return; // Prevent root node from being selected
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
    const rebuiltEdges = rawRebuilt.edges as Edge[];
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
    const rebuiltEdges = rawRebuilt.edges as Edge[];
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
    const rebuiltEdges = rawRebuilt.edges as Edge[];
    setNodes(rebuiltNodes);
    setEdges(rebuiltEdges);

    const newId = makeId(parentNode.id, 'username');
    const newNode = rebuiltNodes.find(n => n.id === newId || (n.data && n.data.label === 'username'));
    if (newNode) setSelectedNodeId(newNode.id);

    setContextMenu(null);
  };

  // Delete Property action (with confirmation)
  const handleDeleteProperty = () => {
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
  const contextMenuItems = (() => {
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

    // Only show Create Local Override for imported nodes
    const selNode = nodes.find(n => n.id === contextMenu?.nodeId);
    const canShowOverride = !!selNode && !!selNode.data.imported && (selNode.data.type === 'object' || (selNode.data.type === 'array' && selNode.data.ofType === 'object'));
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
        <div className={styles.editorSidebar}>
          <div className={styles.editorSidebarHeader}>
            <button type="button" className={styles.printButton} onClick={handlePrintGraph} title="Print graph" aria-label="Print graph">
              <Printer size={16} />
              <span>Print graph</span>
            </button>
          </div>
          {/* Always show NodePropertyEditor for selected node, including enum node */}
          <MemoizedNodePropertyEditor node={selectedNode} onChange={handleNodePropertyChange} />
        </div>
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


