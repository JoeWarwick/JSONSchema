import React from 'react';
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
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
} from "reactflow";
import { TooltipProvider } from "./ui/tooltip/tooltip";
import type { Connection, Edge, Node, OnConnect } from "reactflow"
import type { SchemaNodeData } from "./schema-behaviors";
import type { NodeData, GraphicalSchemaEditorProps } from './types';
import { nodeTypes, initialNodes, initialEdges } from './schema-node-types';
import "reactflow/dist/style.css";
import styles from "./graphical-schema-editor.module.css";

export function GraphicalSchemaEditor({ schema, onChange, useTestData }: GraphicalSchemaEditorProps) {

  // Ref to store label of selected node before graph rebuild
  const selectedNodeLabelRef = React.useRef<string | null>(null);
  const [resolvedSchema, setResolvedSchema] = React.useState<Record<string, unknown> | null>(null);
  const initialLoadRef = React.useRef(true);
  const flowWrapperRef = React.useRef<HTMLDivElement | null>(null);
  // Only render ReactFlow when the wrapper has a measured non-zero height.
  // This avoids React Flow error #004 when the parent container has no height
  // at initial render (e.g. due to CSS/layout timing).
  const [canRenderFlow, setCanRenderFlow] = React.useState<boolean>(() => false);
  const [explicitHeight, setExplicitHeight] = React.useState<number | undefined>(undefined);
  const failedChecksRef = React.useRef<number>(0);

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
        setTimeout(() => setCanRenderFlow(true), 0);
        return;
      }

      // Layout may settle after a tick; schedule a short re-check.
      setTimeout(() => {
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
      setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
    }
  }, [canRenderFlow]);

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

    function walkSchema(obj: any, parentId?: string, label?: string, x = 0, y = 0, parentRequired?: string[]): string {
      const id = makeId(parentId, label);
      // Resolve local $ref and oneOf refs that reference definitions within the schema so we can traverse referenced definitions
      const resolveLocalRef = (candidate: any): any => {
        if (!candidate || typeof candidate !== 'object') return candidate;
        // Direct $ref to local definition
        if (typeof candidate.$ref === 'string' && candidate.$ref.startsWith('#/')) {
          const path = candidate.$ref.replace(/^#\//, '').split('/');
          let target: any = schema;
          for (const p of path) {
            if (target && typeof target === 'object') target = target[p];
            else { target = null; break; }
          }
          if (target && typeof target === 'object') {
            const { $ref, ...rest } = candidate;
            return { ...JSON.parse(JSON.stringify(target)), ...rest };
          }
          return candidate;
        }
        // Handle oneOf: prefer the first resolvable entry (either a $ref or inline object)
        if (Array.isArray(candidate.oneOf) && candidate.oneOf.length > 0) {
          for (const e of candidate.oneOf) {
            if (!e) continue;
            if (typeof e.$ref === 'string' && e.$ref.startsWith('#/')) {
              const path = e.$ref.replace(/^#\//, '').split('/');
              let target: any = schema;
              for (const p of path) {
                if (target && typeof target === 'object') target = target[p];
                else { target = null; break; }
              }
              if (target && typeof target === 'object') {
                const clone = JSON.parse(JSON.stringify({ ...target }));
                for (const [k, v] of Object.entries(candidate)) {
                  if (k === 'oneOf') continue;
                  (clone as any)[k] = v;
                }
                return clone;
              }
            } else if (typeof e === 'object') {
              const clone = JSON.parse(JSON.stringify({ ...e }));
              for (const [k, v] of Object.entries(candidate)) {
                if (k === 'oneOf') continue;
                (clone as any)[k] = v;
              }
              return clone;
            }
          }
        }
        return candidate;
      };
      obj = resolveLocalRef(obj);

      // Normalize type values so we can handle arrays like ['object','null'] and implicit objects/arrays
      let rawType = obj.type;
      let type = Array.isArray(rawType) ? rawType[0] : rawType; // prefer first declared type for display
      if (!type) {
        // If no explicit type, infer type from schema shape
        if (obj.properties) type = 'object';
        else if (obj.items) type = 'array';
        else type = 'object';
      }
      let ofType = undefined;
      let nodeType = 'property';
      let isRequired = false;
      // If not root, check if required
      if (parentId && parentRequired && label) {
        isRequired = parentRequired.includes(label);
      }
      // Include common annotations so editors stay in sync (default, format, pattern, description, enum)
      let nodeData: any = { id, label: label || obj.title || (parentId ? type : 'Root'), type, parent: parentId };
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
        ofType = Array.isArray(items.type) ? items.type[0] : items.type || (items.properties ? 'object' : 'object');
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
      }
      // If array of objects, walk into properties of items, but do not create a subnode for 'items'
      if (type === 'array' && obj.items && ((Array.isArray(obj.items.type) && obj.items.type.includes('object')) || obj.items.type === 'object' || obj.items.properties)) {
        let propY = y - 80;
        for (const [key, propSchema] of Object.entries(obj.items.properties || {}).filter(([k]) => !k.startsWith('__'))) {
          walkSchema(propSchema, id, key, x + 250, propY, obj.items.required || []);
          propY += 140;
        }
      }
      return id;
    }
    walkSchema(schema, undefined, 'Root', 0, 200);
    return { nodes, edges };
  }, []);

  // Relayout nodes into a vertical tree. Use `dagre` when available to compute
  // positions using measured node widths from the DOM. If `dagre` is not
  // available, fall back to a heuristic layout that estimates widths.
  const relayoutNodes = React.useCallback((inputNodes: Node<SchemaNodeData>[], inputEdges: Edge[]) => {
    if (!Array.isArray(inputNodes) || inputNodes.length === 0) return inputNodes;

    const nodeMap = new Map<string, Node<SchemaNodeData>>();
    for (const n of inputNodes) if (n && n.id) nodeMap.set(n.id, n);

    // Build children map by parent id (prefer data.parent)
    const children = new Map<string, string[]>();
    for (const n of inputNodes) {
      const pid = n.data && (n.data.parent as string | undefined);
      if (pid) {
        const arr = children.get(pid) || [];
        arr.push(n.id);
        children.set(pid, arr);
      }
    }

    const NODE_HEIGHT = 84;
    const V_SPACING = 20;
    const START_Y = 60;

    // Estimate widths as fallback
    const CHAR_WIDTH = 8;
    const MIN_WIDTH = 120;
    const H_PADDING = 40;
    const H_SPACING = 40;
    const estimateWidth = (n: Node<SchemaNodeData>) => {
      const lbl = (n.data && (n.data.label as string)) || '';
      return Math.max(MIN_WIDTH, lbl.length * CHAR_WIDTH + H_PADDING);
    };

    // Try to load dagre dynamically (allow optional dependency)
    let dagreLib: any = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      // @ts-ignore
      dagreLib = require('dagre');
    } catch (e) {
      // try window global (if loaded externally)
      // @ts-ignore
      if (typeof window !== 'undefined' && (window as any).dagre) dagreLib = (window as any).dagre;
    }

    if (dagreLib) {
      try {
        const g = new dagreLib.graphlib.Graph();
        g.setGraph({ rankdir: 'LR', nodesep: 20, ranksep: 40 });
        g.setDefaultEdgeLabel(() => ({}));

        // Add nodes with measured or estimated sizes
        for (const n of inputNodes) {
          let w = estimateWidth(n);
          let h = NODE_HEIGHT;
          try {
            // Try to measure DOM node if present
            if (typeof document !== 'undefined') {
              const el = document.querySelector(`.react-flow__node[data-id="${n.id}"]`) as HTMLElement | null
                || document.querySelector(`[data-id="${n.id}"]`) as HTMLElement | null;
              if (el) {
                const r = el.getBoundingClientRect();
                if (r.width > 0) w = Math.max(w, r.width);
                if (r.height > 0) h = r.height;
              }
            }
          } catch (m) {
            // ignore measurement errors
          }
          g.setNode(n.id, { width: w, height: h });
        }

        // Add edges from inputEdges (use source->target)
        for (const e of inputEdges || []) {
          if (e && (e as any).source && (e as any).target) g.setEdge((e as any).source, (e as any).target);
        }

        dagreLib.layout(g);

        const positions = new Map<string, { x: number; y: number }>();
        g.nodes().forEach((id: string) => {
          const n = g.node(id);
          // dagre gives center x,y; convert to top-left for React Flow
          positions.set(id, { x: n.x - n.width / 2, y: n.y - n.height / 2 });
        });

        // Ensure root is far left and leaves are far right: compute min/max x and
        // scale so leaves reach container width from root.
        const containerWidth = flowWrapperRef.current?.getBoundingClientRect().width || 1400;
        const TARGET_WIDTH = containerWidth - 40; // leave some margin
        const LEFT_MARGIN = 20;
        const rootPos = positions.get('1');
        const xs: number[] = [];
        const leafIds: string[] = [];
        for (const n of inputNodes) {
          const pos = positions.get(n.id);
          if (pos) xs.push(pos.x);
          // leaf: has no children (or no outgoing edges)
          const ch = children.get(n.id) || [];
          if (!ch || ch.length === 0) leafIds.push(n.id);
        }
        if (!rootPos || xs.length === 0) {
          return inputNodes.map(n => {
            const pos = positions.get(n.id);
            if (!pos) return n;
            return { ...n, position: { x: pos.x, y: pos.y } };
          });
        }
        const minX = Math.min(...xs);
        const maxLeafX = Math.max(...leafIds.map(id => positions.get(id)?.x ?? minX));
        const rootX = rootPos.x;
        const span = maxLeafX - rootX || 1;
        const scale = TARGET_WIDTH / span;

        return inputNodes.map(n => {
          const pos = positions.get(n.id);
          if (!pos) return n;
          const newX = LEFT_MARGIN + (pos.x - rootX) * scale;
          return { ...n, position: { x: newX, y: pos.y } };
        });
      } catch (err) {
        // fall through to heuristic if dagre fails
      }
    }

    // Fallback heuristic layout (estimates widths and stacks children)
    const widthMap = new Map<string, number>();
    for (const n of inputNodes) widthMap.set(n.id, estimateWidth(n));

    const heightMemo = new Map<string, number>();
    const computeHeight = (id: string): number => {
      if (heightMemo.has(id)) return heightMemo.get(id)!;
      const ch = children.get(id) || [];
      if (ch.length === 0) {
        heightMemo.set(id, NODE_HEIGHT);
        return NODE_HEIGHT;
      }
      let total = 0;
      for (let i = 0; i < ch.length; i++) {
        total += computeHeight(ch[i]);
        if (i < ch.length - 1) total += V_SPACING;
      }
      heightMemo.set(id, total);
      return total;
    };

    const positions = new Map<string, { x: number; y: number }>();
    const assign = (id: string, centerX: number, yTop: number) => {
      const ch = children.get(id) || [];
      if (ch.length === 0) {
        positions.set(id, { x: centerX, y: yTop + NODE_HEIGHT / 2 });
        return computeHeight(id);
      }
      const heights = ch.map(cid => computeHeight(cid));
      let curY = yTop;
      const parentWidth = widthMap.get(id) || MIN_WIDTH;
      for (let i = 0; i < ch.length; i++) {
        const cid = ch[i];
        const childWidth = widthMap.get(cid) || MIN_WIDTH;
        const childCenterX = centerX + (parentWidth / 2) + H_SPACING + (childWidth / 2);
        assign(cid, childCenterX, curY);
        curY += heights[i] + V_SPACING;
      }
      const first = positions.get(ch[0])!;
      const last = positions.get(ch[ch.length - 1])!;
      const parentY = (first.y + last.y) / 2;
      positions.set(id, { x: centerX, y: parentY });
      return heights.reduce((s, h) => s + h, 0) + V_SPACING * (ch.length - 1);
    };

    const rootId = '1';
    if (!nodeMap.has(rootId)) return inputNodes;
    computeHeight(rootId);
    assign(rootId, 0, START_Y);

    // Normalize fallback layout similarly: scale so leaves are pushed right
    const containerWidth = flowWrapperRef.current?.getBoundingClientRect().width || 1400;
    const TARGET_WIDTH = containerWidth - 40;
    const LEFT_MARGIN = 20;
    const xs: number[] = [];
    const leafIds: string[] = [];
    for (const n of inputNodes) {
      const p = positions.get(n.id);
      if (p) xs.push(p.x);
      const ch = children.get(n.id) || [];
      if (!ch || ch.length === 0) leafIds.push(n.id);
    }
    const rootPos = positions.get('1');
    if (!rootPos || xs.length === 0) {
      return inputNodes.map(n => {
        const pos = positions.get(n.id);
        if (!pos) return n;
        return { ...n, position: { x: pos.x, y: pos.y - NODE_HEIGHT / 2 } };
      });
    }
    const rootX = rootPos.x;
    const maxLeafX = Math.max(...leafIds.map(id => positions.get(id)?.x ?? rootX));
    const span = maxLeafX - rootX || 1;
    const scale = TARGET_WIDTH / span;

    return inputNodes.map(n => {
      const pos = positions.get(n.id);
      if (!pos) return n;
      const newX = LEFT_MARGIN + (pos.x - rootX) * scale;
      return { ...n, position: { x: newX, y: pos.y - NODE_HEIGHT / 2 } };
    });
  }, []);

  // Build a JSON Schema from the current nodes collection (authoritative)
  const buildSchemaFromNodes = (allNodes: Node<SchemaNodeData>[]) => {
    const root = allNodes.find(n => n.type === 'root') || allNodes.find(n => n.data && n.data.label === 'Root') || allNodes.find(n => n.id === '1');
    if (!root) return {} as Record<string, unknown>;

    // Recursive builder: assemble schema for a node by finding its children
    const buildNodeSchema = (node: Node<SchemaNodeData>): Record<string, unknown> => {
      const base = schemaNodeDataToSchema(node.data as SchemaNodeData) as any;
      if (node.data.type === 'object') {
        const props: Record<string, unknown> = {};
        const patternProps: Record<string, unknown> = {};
        const requiredList: string[] = [];
        allNodes.forEach(child => {
          if (child.data && child.data.parent === node.id) {
            const key = child.data.label;
            const patternKey = (child.data as any).patternKey;
            if (patternKey) {
              patternProps[patternKey] = buildNodeSchema(child);
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

    const schema: Record<string, unknown> = { type: root.data.type, title: root.data.label };
    // Preserve root annotation fields (description and $comment)
    if (root.data && root.data.description !== undefined) schema.description = root.data.description as string;
    if (root.data && (root.data as any).$comment !== undefined) schema.$comment = (root.data as any).$comment;
    const props: Record<string, unknown> = {};
    allNodes.forEach(n => {
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
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  // When we emit a schema update originating from this component, skip
  // syncing back from the `schema` prop for that single change to avoid
  // tearing down and rebuilding nodes (which causes selection loss).
  const skipSchemaSyncRef = React.useRef(false);

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
      const updatedNodes = prevNodes.map((node: Node<SchemaNodeData>) => {
        // Update the node being patched
        if (node.id === oldId) {
          const newData = { ...node.data, ...patch } as SchemaNodeData;
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

      // After node patching (rename or other edits), derive the authoritative
      // schema from the updated graph state (using nodes collection) and emit it once.
      const newSchema = buildSchemaFromNodes(updatedNodes);
      if (newSchema) {
        skipSchemaSyncRef.current = true;
        onChange(newSchema);
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
  React.useMemo(() => {
    // If we recently emitted a schema update from inside this component,
    // skip syncing back from the `schema` prop for this change to avoid
    // tearing down and rebuilding nodes (which causes selection loss).
    if (skipSchemaSyncRef.current) {
      skipSchemaSyncRef.current = false;
      return;
    }
    if (useTestData) return;
    // If deref is in progress for a schema that contains $ref/$defs, wait
    const containsRefs = (s: any): boolean => {
      if (!s || typeof s !== 'object') return false;
      if (s.$ref !== undefined) return true;
      if (s.$defs !== undefined) return true;
      for (const v of Object.values(s)) {
        if (containsRefs(v)) return true;
      }
      return false;
    };
    const activeSchema = resolvedSchema || schema;
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
            for (const [k, v] of Object.entries(root.$defs || {})) {
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
    const nodes = relayoutNodes(rawGraph.nodes, rawGraph.edges);
    const edges = rawGraph.edges;
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
    } else {
      // Only update nodes/edges data if the structure is the same (property edit)
      setNodes(prevNodes => nodes.map(n => {
        const prev = prevNodes.find(pn => pn.id === n.id);
        return prev ? { ...n, position: prev.position } : n;
      }));
      setEdges(edges);
    }
    // Otherwise, do not reset selection (preserve selection and form)
  }, [schema, resolvedSchema, setNodes, setEdges, useTestData, schemaToGraph]);

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
    const rebuiltNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges);
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
    const rebuiltNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges);
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
    skipSchemaSyncRef.current = true;
    onChange(baseSchema);

    // Rebuild graph from emitted schema and select the new node if present
    const rawRebuilt = schemaToGraph(baseSchema as Record<string, unknown>);
    const rebuiltNodes = relayoutNodes(rawRebuilt.nodes, rawRebuilt.edges);
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

    items.push({
      label: 'Delete Property',
      onClick: handleDeleteProperty,
      disabled: false,
    });
    return items;
  })();

  return (
    <div className={styles.graphicalEditorContainer}>
      <TooltipProvider>
        <ReactFlowProvider>
          <div ref={flowWrapperRef} style={{ width: '100%', height: explicitHeight ? `${explicitHeight}px` : '100%', minHeight: 360 }}>
            {canRenderFlow ? (
              <ReactFlow
                style={{ width: '100%', height: explicitHeight ? `${explicitHeight}px` : '100%' }}
                nodes={nodes}
                edges={edges.map(e => ({ ...e, style: { stroke: '#00e676', strokeWidth: 3 } }))}
                onNodesChange={handleNodesChange}
                onEdgesChange={handleEdgesChange}
                onConnect={onConnect}
                nodeTypes={nodeTypes}
                fitView={true}
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
      <div className={styles.editorSidebar}>
        {/* Always show NodePropertyEditor for selected node, including enum node */}
        <MemoizedNodePropertyEditor node={selectedNode} onChange={handleNodePropertyChange} />
      </div>
      {contextMenu?.visible && (
        <ContextMenu
          items={contextMenuItems}
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}


