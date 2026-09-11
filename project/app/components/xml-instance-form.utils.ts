import type { ValidationFacets } from '../utils/schema-compiler';

export function generateChoiceStorageKey(instanceXml: any, path: string[], optionName: string): string {
  const normalizedPath = path.length > 0 ? path.join('/') : 'root';
  const normalizedOptionName = String(optionName || 'unknown');

  return `choice_${normalizedPath}_${normalizedOptionName}`;
}

export function saveChoiceDataToStorage(instanceXml: any, path: string[], optionName: string, data: any): void {
  try {
    const key = generateChoiceStorageKey(instanceXml, path, optionName);
    localStorage.setItem(key, JSON.stringify(data));
    console.log(`[ChoiceStorage] Saved ${optionName} to ${key}`);
  } catch (error) {
    console.warn('[ChoiceStorage] Failed to save choice data:', error);
  }
}

export function restoreChoiceDataFromStorage(instanceXml: any, path: string[], optionName: string): any {
  try {
    const key = generateChoiceStorageKey(instanceXml, path, optionName);
    const stored = localStorage.getItem(key);
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

export const toArray = <T,>(value: T | T[] | null | undefined): T[] => (
  Array.isArray(value) ? value : (value == null ? [] : [value])
);

export function getSchemaRootNode(root: any): any {
  if (!root || typeof root !== 'object') return null;
  return root['xs:schema'] || root['schema'] || root;
}
