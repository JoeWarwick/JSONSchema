import type { ValidationFacets } from '../utils/schema-compiler';
import { browserStorage } from '../state/workbench-context';

export function generateChoiceStorageKey(instanceXml: any, path: string[], optionName: string): string {
  const normalizedPath = path.length > 0 ? path.join('/') : 'root';
  const normalizedOptionName = String(optionName || 'unknown');

  return `choice_${normalizedPath}_${normalizedOptionName}`;
}

export function saveChoiceDataToStorage(instanceXml: any, path: string[], optionName: string, data: any, storage: Storage = browserStorage): void {
  try {
    const key = generateChoiceStorageKey(instanceXml, path, optionName);
    storage.setItem(key, JSON.stringify(data));
    console.log(`[ChoiceStorage] Saved ${optionName} to ${key}`);
  } catch (error) {
    console.warn('[ChoiceStorage] Failed to save choice data:', error);
  }
}

export function restoreChoiceDataFromStorage(instanceXml: any, path: string[], optionName: string, storage: Storage = browserStorage): any {
  try {
    const key = generateChoiceStorageKey(instanceXml, path, optionName);
    const stored = storage.getItem(key);
    if (stored) {
      console.log(`[ChoiceStorage] Restored ${optionName} from ${key}`);
      return JSON.parse(stored);
    }
  } catch (error) {
    console.warn('[ChoiceStorage] Failed to restore choice data:', error);
  }
  return null;
}

export function getXmlInstanceExpansionStorageKey(schema: any, path: string[], expansionStateKey: string): string {
  const payload = JSON.stringify(schema ?? {});
  let hash = 0;
  for (let index = 0; index < payload.length; index += 1) {
    hash = (hash * 31 + payload.charCodeAt(index)) >>> 0;
  }
  return `${expansionStateKey}:${path.join('.')}:${hash}`;
}

export function facetsToInputAttrs(facets: ValidationFacets | undefined): Record<string, string | number> {
  const attrs: Record<string, string | number> = {};
  if (!facets) return attrs;

  if (facets.minLength !== undefined) attrs.minLength = facets.minLength;
  if (facets.maxLength !== undefined) attrs.maxLength = facets.maxLength;
  if (facets.length !== undefined) attrs.maxLength = facets.length;
  if (facets.pattern) attrs.pattern = facets.pattern;
  if (facets.minInclusive !== undefined) attrs.min = facets.minInclusive;
  if (facets.maxInclusive !== undefined) attrs.max = facets.maxInclusive;

  return attrs;
}

export function facetsToHint(facets: ValidationFacets | undefined): string | null {
  if (!facets) return null;

  const hints: string[] = [];
  if (facets.minLength !== undefined && facets.maxLength !== undefined) {
    hints.push(`${facets.minLength}-${facets.maxLength} characters`);
  } else if (facets.minLength !== undefined) {
    hints.push(`min ${facets.minLength} characters`);
  } else if (facets.maxLength !== undefined) {
    hints.push(`max ${facets.maxLength} characters`);
  }

  if (facets.length !== undefined) hints.push(`exactly ${facets.length} characters`);
  if (facets.pattern) hints.push(`matches: ${facets.pattern}`);

  if (facets.minInclusive !== undefined && facets.maxInclusive !== undefined) {
    hints.push(`${facets.minInclusive} to ${facets.maxInclusive}`);
  } else if (facets.minInclusive !== undefined) {
    hints.push(`≥ ${facets.minInclusive}`);
  } else if (facets.maxInclusive !== undefined) {
    hints.push(`≤ ${facets.maxInclusive}`);
  }

  if (facets.fractionDigits !== undefined) hints.push(`${facets.fractionDigits} decimal places`);
  if (facets.totalDigits !== undefined) hints.push(`max ${facets.totalDigits} digits`);

  return hints.length > 0 ? hints.join(', ') : null;
}

export const normalizeXmlName = (name: unknown): string => String(name ?? '').replace(/^.*:/, '');

export function getReferencedElementNames(schema: unknown): Set<string> {
  const schemaRoot = getSchemaRootNode(schema);
  const referencedNames = new Set<string>();
  const visitedNodes = new Set<object>();

  const collectReferences = (node: unknown) => {
    if (!node || typeof node !== 'object' || visitedNodes.has(node)) return;
    visitedNodes.add(node);

    if (Array.isArray(node)) {
      node.forEach(collectReferences);
      return;
    }

    const record = node as Record<string, unknown>;
    for (const key of ['xs:element', 'element']) {
      for (const declaration of toArray(record[key])) {
        if (!declaration || typeof declaration !== 'object') continue;
        const attrs = (declaration as Record<string, any>)['@attributes'] || declaration;
        const refName = normalizeXmlName(attrs?.ref ?? attrs?.['@ref']).trim();
        if (refName) referencedNames.add(refName);
      }
    }

    Object.values(record).forEach(collectReferences);
  };

  collectReferences(schemaRoot);
  return referencedNames;
}

export function sortElementsByReferenceUsage<T>(
  elements: T[],
  getName: (element: T) => string,
  referencedNames: ReadonlySet<string>,
): T[] {
  return [...elements].sort((left, right) => (
    Number(referencedNames.has(normalizeXmlName(getName(left))))
    - Number(referencedNames.has(normalizeXmlName(getName(right))))
  ));
}

export function findRootWrapperKey(value: any, rootElementName: string | undefined): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !rootElementName) return null;

  const normalizedRoot = normalizeXmlName(rootElementName);
  const candidateKeys = new Set([
    rootElementName,
    normalizedRoot,
    `xs:${normalizedRoot}`,
    `xsd:${normalizedRoot}`,
  ].filter(Boolean));

  const matches = Object.keys(value).filter((key) => (
    candidateKeys.has(key) || candidateKeys.has(normalizeXmlName(key))
  ));

  return matches.length === 1 ? matches[0] : null;
}

export function resolveInstanceChildData(
  childElementName: string,
  rootElementName: string | undefined,
  value: any,
  isRootLevel: boolean,
): any {
  const normalizedBase = normalizeXmlName(childElementName);
  const candidateNames = new Set([
    childElementName,
    normalizedBase,
    `xs:${normalizedBase}`,
    `xsd:${normalizedBase}`,
  ].filter(Boolean));

  const findMatchesInOrderedEntries = (container: any): any[] => {
    if (!container || typeof container !== 'object' || !Array.isArray(container.__childrenInOrder)) return [];

    const matches = container.__childrenInOrder.filter((entry: any) => {
      if (!entry || typeof entry !== 'object') return false;
      const tagName = typeof entry.tagName === 'string' ? entry.tagName : '';
      const tagLocal = normalizeXmlName(tagName);
      return candidateNames.has(tagName) || candidateNames.has(tagLocal) || candidateNames.has(normalizeXmlName(tagName));
    });

    return matches.map((entry: any) => entry.value);
  };

  const directValue = value && typeof value === 'object' ? value : null;
  if (directValue) {
    const orderedMatches = findMatchesInOrderedEntries(directValue);
    if (orderedMatches.length > 0) return orderedMatches.length === 1 ? orderedMatches[0] : orderedMatches;
  }

  for (const key of candidateNames) {
    const result = value?.[key];
    if (result !== undefined) return result;
  }

  if (isRootLevel && rootElementName && value && typeof value === 'object' && !Array.isArray(value)) {
    const wrapperKey = findRootWrapperKey(value, rootElementName);
    const unwrappedValue = wrapperKey ? value[wrapperKey] : value[rootElementName];

    if (typeof unwrappedValue === 'object' && unwrappedValue !== null) {
      const orderedMatches = findMatchesInOrderedEntries(unwrappedValue);
      if (orderedMatches.length > 0) return orderedMatches.length === 1 ? orderedMatches[0] : orderedMatches;

      for (const key of candidateNames) {
        const result = unwrappedValue[key];
        if (result !== undefined) return result;
      }

      for (const key of Object.keys(unwrappedValue)) {
        if (candidateNames.has(key) || candidateNames.has(normalizeXmlName(key))) {
          return unwrappedValue[key];
        }
      }
    }
  }

  return undefined;
}

export const toArray = <T,>(value: T | T[] | null | undefined): T[] => (
  Array.isArray(value) ? value : (value == null ? [] : [value])
);

export function getSchemaRootNode(root: any): any {
  if (!root || typeof root !== 'object') return null;
  return root['xs:schema'] || root['schema'] || root;
}
