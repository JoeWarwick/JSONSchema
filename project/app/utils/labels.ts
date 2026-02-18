
export interface LabelData {
  title: string;
  description: string | null;
}

const noise = new Set([
  'schema', 'root', 'item', 'items', 'object', 'string', 'number', 'boolean', 'array', 'null', 'any', 
  'property', 'properties', 'definitions', '$defs', 'components', 'schemas', 'type', 'types', 'oneof', 'anyof', 'allof',
  'variant', 'variants', 'choice', 'choices'
]);

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const isLikelyRefStr = (s: string): boolean => {
  if (!s) return false;
  // Local $ref or $defs pointer
  if (s.startsWith('#')) return true;
  // Remote URL
  if (/^https?:\/\//i.test(s)) return true;
  return false;
};

const getFromRef = (ref?: any): string | null => {
  if (!ref || typeof ref !== 'string' || !isLikelyRefStr(ref)) return null;
  
  const [baseUrl, fragment] = ref.split('#');
  const target = fragment || baseUrl;
  if (!target) return null;

  const parts = target.split('/').filter(p => p && p !== '#');
  for (let i = parts.length - 1; i >= 0; i--) {
    let name = decodeURIComponent(parts[i]);
    if (name.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(name) || name.toLowerCase().startsWith('localhost')) continue;
    name = name.replace(/\.(json|schema|yaml|yml)$/i, '');
    
    // GHA-specific cleanups: if the documentation anchor contains the parent key 'jobs' or 'steps'
    // but isn't JUST that key, try to strip the prefix (e.g. jobsjob_id -> job_id)
    if (name.toLowerCase().startsWith('jobsjob_id')) name = name.replace(/jobsjob_id/i, 'job_id');
    if (name.toLowerCase().startsWith('jobs.')) name = name.replace(/jobs\./i, '');
    if (name.toLowerCase().startsWith('steps.')) name = name.replace(/steps\./i, '');
    if (name.toLowerCase().startsWith('on.')) name = name.replace(/on\./i, '');
    if (name.toLowerCase().startsWith('runs-on_')) name = name.replace(/runs-on_/i, '');
    if (!name) continue;

    if (!noise.has(name.toLowerCase()) && !/^\d+$/.test(name)) return capitalize(name);
  }
  return null;
};

// Return the raw fragment/key from a $ref/$comment/__from without capitalizing
export const getRefKey = (refOrSchema?: any): string | null => {
  if (!refOrSchema) return null;
  let refStr: string | undefined;
  if (typeof refOrSchema === 'string') refStr = refOrSchema;
  else if (typeof refOrSchema === 'object') {
    // Only use $comment if it looks like a URL/Ref
    if (refOrSchema.$ref) refStr = refOrSchema.$ref;
    else if (refOrSchema.__from) refStr = refOrSchema.__from;
    else if (refOrSchema.$comment && isLikelyRefStr(refOrSchema.$comment)) refStr = refOrSchema.$comment;
  }
  if (!refStr || typeof refStr !== 'string' || !isLikelyRefStr(refStr)) return null;
  const [, fragment] = refStr.split('#');
  const target = fragment || refStr;
  if (!target) return null;
  const parts = target.split('/').filter(p => p && p !== '#');
  for (let i = parts.length - 1; i >= 0; i--) {
    let name = decodeURIComponent(parts[i]);
    name = name.replace(/\.(json|schema|yaml|yml)$/i, '');
    
    // Cleanup GHA anchors
    if (name.toLowerCase().startsWith('jobsjob_id')) name = name.replace(/jobsjob_id/i, 'job_id');
    if (name.toLowerCase().startsWith('jobs.')) name = name.replace(/jobs\./i, '');
    if (name.toLowerCase().startsWith('steps.')) name = name.replace(/steps\./i, '');
    if (name.toLowerCase().startsWith('on.')) name = name.replace(/on\./i, '');
    if (name.toLowerCase().startsWith('runs-on_')) name = name.replace(/runs-on_/i, '');
    if (!name) continue;

    if (noise.has(name.toLowerCase()) || /^\d+$/.test(name)) continue;
    return name;
  }
  return null;
};

const getBestName = (s: any): string | null => {
  if (!s || typeof s !== 'object') return null;
  // 1. Prefer an explicit title when present. Titles are high-quality signals from schema authors.
  if (s.title && typeof s.title === 'string' && !noise.has(s.title.toLowerCase())) return capitalize(s.title);
  // 2. Next, try to extract a compact fragment/key from $ref/$comment/__from without returning the whole URL
  const rawKey = getRefKey(s.$ref) || getRefKey(s.$comment) || getRefKey(s.__from);
  if (rawKey) return capitalize(rawKey);
  // 3. Fallback to the older heuristic that extracts a readable name from the ref/fragment
  const name = getFromRef(s.$ref) || getFromRef(s.$comment) || getFromRef(s.__from);
  if (name) return name;
  if (Array.isArray(s.allOf)) {
    for (const branch of s.allOf) {
      const sub = getBestName(branch);
      if (sub) return sub;
    }
  }
  return null;
};

function getBaseVariantTitle(vs: Record<string, unknown>, index: number): string {
  const refName = getBestName(vs);
  if (refName) return refName;

  if (vs.type === 'array' && vs.items && !Array.isArray(vs.items)) {
    const itemLabel = getVariantLabel(vs.items as Record<string, unknown>, 0);
    if (itemLabel.title && !itemLabel.title.toLowerCase().startsWith('option ')) {
      return `Array<${itemLabel.title}>`;
    }
  }

  if (vs.type) {
    const t = Array.isArray(vs.type) ? vs.type[0] : vs.type;
    return capitalize(String(t));
  }
  return `Option ${index + 1}`;
}

export function getVariantLabel(vs: Record<string, unknown>, index: number, allVariants?: Record<string, unknown>[]): LabelData {
  const base = getBaseVariantTitle(vs, index);
  const desc = (vs.$ref || vs.$comment || vs.__from) as string || null;

  // If context provided, always try to append a type discriminator if there are multiple choices
  if (Array.isArray(allVariants) && allVariants.length > 1) {
    const counts: Record<string, number> = {};
    for (let i = 0; i < allVariants.length; i++) {
      const t = getBaseVariantTitle(allVariants[i] as Record<string, unknown>, i);
      counts[t] = (counts[t] || 0) + 1;
    }

    // append a simple type qualifier, prefer explicit vs.type or 'array' etc.
    let typeQualifier = '';
    if (vs.type) typeQualifier = Array.isArray(vs.type) ? String(vs.type[0]) : String(vs.type);
    else if ((vs as any).items) typeQualifier = 'array';
    else if ((vs as any).properties) typeQualifier = 'object';
    
    typeQualifier = typeQualifier.toLowerCase();

    // conditions for adding the qualifier:
    // 1. There is a title clash (multiple variants have the same base name)
    // 2. AND we actually have a type to show
    if (typeQualifier && (counts[base] || 0) > 1) {
      return { title: `${base} <${typeQualifier}>`, description: desc };
    }
  }

  return { title: base, description: desc };
}
