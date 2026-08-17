import type {
  CanonicalBuilderResult,
  CanonicalChoiceSelection,
  CanonicalCompositorKind,
  CanonicalDependencyGraph,
  CanonicalDocument,
  CanonicalNode,
  CanonicalOccurrence,
  CanonicalPathSegment,
  CanonicalProjectionState,
  CanonicalStructuralGroup,
  CanonicalValidationState,
  CanonicalValueType,
} from '~/types/canonical-model';

type XmlNodeValue = Record<string, unknown> | string | Array<Record<string, unknown> | string>;

interface BuilderState {
  document: CanonicalDocument;
  warnings: string[];
  nextOrdinal: number;
}

interface VisitContext {
  parentId: string | null;
  pathSegments: CanonicalPathSegment[];
  parentGroupId?: string;
  occurrenceId?: string;
  choiceGroupId?: string;
  branchKey?: string;
}

const XML_ATTRIBUTES_KEY = '@attributes';
const XML_TEXT_KEY = '#text';

function createEmptyValidationState(): CanonicalValidationState {
  return {
    constraints: {},
    triggers: {},
    diagnostics: {},
  };
}

function createEmptyDependencyGraph(): CanonicalDependencyGraph {
  return {
    nodes: [],
    edges: [],
    topologicalOrder: [],
    cycles: [],
  };
}

function createEmptyProjection(): CanonicalProjectionState {
  return {
    rowOrder: [],
    expandedRowIds: [],
  };
}

function createDocument(schemaSource: unknown, instanceSource?: unknown): CanonicalDocument {
  return {
    id: 'canonical:xml:1',
    schemaLanguage: 'xml',
    schemaSource,
    instanceSource,
    nodes: {},
    order: [],
    occurrences: {},
    groups: {},
    selections: {},
    validation: createEmptyValidationState(),
    dependencyGraph: createEmptyDependencyGraph(),
    projection: createEmptyProjection(),
    revision: 1,
    updatedAt: new Date().toISOString(),
  };
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function getAttributes(node: Record<string, unknown> | undefined | null): Record<string, string> {
  const raw = node?.[XML_ATTRIBUTES_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, String(value)])
  );
}

function localName(name: string): string {
  return name.includes(':') ? name.split(':').pop() || name : name;
}

function valueTypeOf(value: unknown): CanonicalValueType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string': return 'string';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'object': return 'object';
    default: return 'unknown';
  }
}

function compositorKindFor(tagName: string): CanonicalCompositorKind {
  const name = localName(tagName);
  if (name === 'sequence' || name === 'choice' || name === 'all') return name;
  return 'none';
}

function canonicalPath(segments: CanonicalPathSegment[]): string {
  if (segments.length === 0) return '/';
  return `/${segments.map((segment) => String(segment)).join('/')}`;
}

function registerGroup(document: CanonicalDocument, group: CanonicalStructuralGroup): void {
  if (document.groups[group.id]) return;
  document.groups[group.id] = group;
  if (group.parentGroupId) {
    const parentGroup = document.groups[group.parentGroupId];
    if (parentGroup && !parentGroup.childGroupIds.includes(group.id)) {
      parentGroup.childGroupIds.push(group.id);
    }
  }
}

function registerOccurrence(document: CanonicalDocument, occurrence: CanonicalOccurrence): void {
  if (document.occurrences[occurrence.id]) return;
  document.occurrences[occurrence.id] = occurrence;
  const group = document.groups[occurrence.groupId];
  if (group && !group.occurrenceIds.includes(occurrence.id)) {
    group.occurrenceIds.push(occurrence.id);
  }
}

function attachNodeToOccurrence(document: CanonicalDocument, occurrenceId: string | undefined, nodeId: string): void {
  if (!occurrenceId) return;
  const occurrence = document.occurrences[occurrenceId];
  if (!occurrence) return;
  if (!occurrence.nodeIds.includes(nodeId)) {
    occurrence.nodeIds.push(nodeId);
  }
}

function registerSelection(document: CanonicalDocument, selection: CanonicalChoiceSelection): void {
  document.selections[selection.id] = selection;
}

function withDerivedXjAttributes(
  document: CanonicalDocument,
  attrs: Record<string, string>,
  occurrenceId?: string,
  branchKey?: string,
): Record<string, string> {
  const next = { ...attrs };
  if (occurrenceId && next['xj:index'] === undefined) {
    const occurrence = document.occurrences[occurrenceId];
    if (occurrence) {
      next['xj:index'] = occurrence.indexToken;
    }
  }
  if (branchKey && next['xj:choice'] === undefined) {
    next['xj:choice'] = branchKey;
  }
  return next;
}

function registerNode(state: BuilderState, node: CanonicalNode): void {
  state.document.nodes[node.id] = node;
  state.document.order.push(node.id);
  state.document.projection.rowOrder.push(node.id);
  attachNodeToOccurrence(state.document, node.occurrenceId, node.id);
  state.nextOrdinal += 1;
}

function createNodeId(path: CanonicalPathSegment[]): string {
  return `node:${path.map((segment) => String(segment)).join(':')}`;
}

function parseOccursNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseMaxOccurs(raw: string | undefined): number | 'unbounded' | undefined {
  if (!raw) return undefined;
  if (raw === 'unbounded') return 'unbounded';
  return parseOccursNumber(raw);
}

function isRepeatDeclaration(attrs: Record<string, string>): boolean {
  const maxOccurs = parseMaxOccurs(attrs.maxOccurs);
  return maxOccurs === 'unbounded' || (typeof maxOccurs === 'number' && maxOccurs > 1);
}

function createOccurrenceId(groupId: string, indexToken: string): string {
  return `occ:${groupId}:${indexToken}`;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    if (seen.has(value)) return;
    seen.add(value);
    result.push(value);
  });
  return result;
}

function appendTextNode(
  state: BuilderState,
  parentId: string,
  text: string,
  pathSegments: CanonicalPathSegment[],
  occurrenceId?: string,
  choiceGroupId?: string,
  branchKey?: string,
): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const id = createNodeId(pathSegments);
  registerNode(state, {
    id,
    parentId,
    kind: 'text',
    name: '#text',
    path: canonicalPath(pathSegments),
    valueType: 'string',
    value: trimmed,
    ordinal: state.nextOrdinal,
    occurrenceId,
    choiceGroupId,
    branchKey,
    constraints: [],
    triggers: [],
    diagnostics: [],
    metadata: {
      sourcePath: pathSegments,
      projectionPath: pathSegments,
    },
  });
}

function visitXmlNode(
  state: BuilderState,
  tagName: string,
  value: XmlNodeValue,
  context: VisitContext,
): string {
  const { parentId, pathSegments, parentGroupId, occurrenceId, choiceGroupId, branchKey } = context;
  const nodeId = createNodeId(pathSegments);
  const nodeRecord = typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  const attrs = getAttributes(nodeRecord);
  const enrichedAttrs = withDerivedXjAttributes(state.document, attrs, occurrenceId, branchKey);
  const compositorKind = compositorKindFor(tagName);
  const isCompositor = compositorKind !== 'none';
  const compositorGroupId = isCompositor ? `group:${pathSegments.join(':')}` : undefined;
  const structuralGroupId = compositorGroupId ?? parentGroupId;

  registerNode(state, {
    id: nodeId,
    parentId,
    kind: isCompositor ? 'compositor' : 'element',
    name: localName(tagName),
    path: canonicalPath(pathSegments),
    valueType: valueTypeOf(value),
    value: Array.isArray(value) ? undefined : value,
    compositorKind: isCompositor ? compositorKind : undefined,
    minOccurs: parseOccursNumber(enrichedAttrs.minOccurs),
    maxOccurs: parseMaxOccurs(enrichedAttrs.maxOccurs),
    ordinal: state.nextOrdinal,
    occurrenceId,
    choiceGroupId,
    branchKey,
    constraints: [],
    triggers: [],
    diagnostics: [],
    metadata: {
      sourcePath: pathSegments,
      projectionPath: pathSegments,
      xml: {
        attributes: enrichedAttrs,
        namespacePrefix: tagName.includes(':') ? tagName.split(':')[0] : undefined,
      },
    },
    structuralGroupId,
  });

  if (isCompositor && compositorGroupId) {
    const groupKind = (compositorKind === 'sequence' || compositorKind === 'choice' || compositorKind === 'all')
      ? compositorKind
      : 'synthetic-row';
    registerGroup(state.document, {
      id: compositorGroupId,
      kind: groupKind,
      parentGroupId,
      ownerNodeId: nodeId,
      occurrenceIds: [],
      childGroupIds: [],
    });
  }

  if (typeof value === 'string') {
    appendTextNode(state, nodeId, value, [...pathSegments, XML_TEXT_KEY], occurrenceId, choiceGroupId, branchKey);
    return nodeId;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      const repeatGroupId = `group:repeat:${pathSegments.slice(0, -1).join(':')}:${tagName}`;
      registerGroup(state.document, {
        id: repeatGroupId,
        kind: 'repeat',
        parentGroupId,
        ownerNodeId: parentId ?? nodeId,
        occurrenceIds: [],
        childGroupIds: [],
      });
      const indexToken = String(index);
      const nextOccurrenceId = createOccurrenceId(repeatGroupId, indexToken);
      registerOccurrence(state.document, {
        id: nextOccurrenceId,
        groupId: repeatGroupId,
        parentOccurrenceId: occurrenceId,
        indexToken,
        ordinal: index,
        nodeIds: [],
      });
      visitXmlNode(state, tagName, entry as XmlNodeValue, {
        parentId,
        pathSegments: [...pathSegments.slice(0, -1), `${tagName}[${index}]`],
        parentGroupId: repeatGroupId,
        occurrenceId: nextOccurrenceId,
        choiceGroupId,
        branchKey,
      });
    });
    return nodeId;
  }

  if (!nodeRecord) return nodeId;

  const textValue = nodeRecord[XML_TEXT_KEY];
  if (typeof textValue === 'string') {
    appendTextNode(state, nodeId, textValue, [...pathSegments, XML_TEXT_KEY], occurrenceId, choiceGroupId, branchKey);
  }

  const childEntries = Object.entries(nodeRecord).filter(
    ([key]) => key !== XML_ATTRIBUTES_KEY && key !== XML_TEXT_KEY && !key.startsWith('__')
  );

  const choiceSelectionSource = attrs['xj:choice'] || attrs.choice || attrs.selectedBranch;
  if (isCompositor && compositorKind === 'choice' && compositorGroupId) {
    const availableBranchKeys = dedupeStrings(
      childEntries.flatMap(([key, childValue]) =>
        asArray(childValue as XmlNodeValue).map((_, index) =>
          asArray(childValue as XmlNodeValue).length > 1 ? `${localName(key)}[${index}]` : localName(key)
        )
      )
    );
    const selectedBranchKey = choiceSelectionSource
      ? String(choiceSelectionSource)
      : (availableBranchKeys.length === 1 ? availableBranchKeys[0] : null);
    const selectionOccurrenceId = occurrenceId;
    const selectionId = `selection:${compositorGroupId}:${selectionOccurrenceId ?? 'root'}`;
    registerSelection(state.document, {
      id: selectionId,
      choiceGroupId: compositorGroupId,
      occurrenceId: selectionOccurrenceId,
      selectedBranchKey,
      availableBranchKeys,
    });
  }

  childEntries.forEach(([key, childValue]) => {
    const childValues = asArray(childValue as XmlNodeValue);
    const childIsDeclaredRepeat = childValues.some((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
      return isRepeatDeclaration(getAttributes(entry));
    });
    const useRepeatGroup = childValues.length > 1 || childIsDeclaredRepeat;
    const repeatGroupId = useRepeatGroup ? `group:repeat:${pathSegments.join(':')}:${key}` : undefined;
    if (repeatGroupId) {
      registerGroup(state.document, {
        id: repeatGroupId,
        kind: 'repeat',
        parentGroupId: compositorGroupId ?? parentGroupId,
        ownerNodeId: nodeId,
        occurrenceIds: [],
        childGroupIds: [],
      });
    }

    childValues.forEach((entry, index) => {
      const childPath = [...pathSegments, `${key}[${index}]`];
      const indexToken = String(index);
      const nextOccurrenceId = repeatGroupId ? createOccurrenceId(repeatGroupId, indexToken) : occurrenceId;
      if (repeatGroupId) {
        registerOccurrence(state.document, {
          id: nextOccurrenceId!,
          groupId: repeatGroupId,
          parentOccurrenceId: occurrenceId,
          indexToken,
          ordinal: index,
          nodeIds: [],
        });
      }

      const branchFromChoice = compositorKind === 'choice'
        ? (childValues.length > 1 ? `${localName(key)}[${index}]` : localName(key))
        : branchKey;
      const nextChoiceGroupId = compositorKind === 'choice' ? compositorGroupId : choiceGroupId;

      visitXmlNode(state, key, entry as XmlNodeValue, {
        parentId: nodeId,
        pathSegments: childPath,
        parentGroupId: repeatGroupId ?? (compositorGroupId ?? parentGroupId),
        occurrenceId: nextOccurrenceId,
        choiceGroupId: nextChoiceGroupId,
        branchKey: branchFromChoice,
      });
    });
  });

  return nodeId;
}

export function buildCanonicalXmlDocument(schemaSource: Record<string, unknown>, instanceSource?: Record<string, unknown>): CanonicalBuilderResult {
  const state: BuilderState = {
    document: createDocument(schemaSource, instanceSource),
    warnings: [],
    nextOrdinal: 0,
  };

  const rootEntry = Object.entries(schemaSource).find(([, value]) => value && typeof value === 'object');
  if (!rootEntry) {
    state.warnings.push('XML canonical builder could not find a root element object.');
    return { document: state.document, warnings: state.warnings };
  }

  const [rootName, rootValue] = rootEntry;
  visitXmlNode(state, rootName, rootValue as XmlNodeValue, {
    parentId: null,
    pathSegments: [rootName],
  });

  return {
    document: state.document,
    warnings: state.warnings,
  };
}