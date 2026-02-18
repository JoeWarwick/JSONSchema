export interface LabelData {
  title: string;
  description: string | null;
}

const noise = new Set([
  'schema', 'root', 'item', 'items', 'object', 'string', 'number', 'boolean', 'array', 'null', 'any', 
  'property', 'properties', 'definitions', '$defs', 'components', 'schemas', 'type', 'types', 'oneof', 'anyof', 'allof',
  'variant', 'variants', 'choice', 'choices', 'call', 'job'
]);

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const camelCaseToTitleLabel = (s: string): string | null => {
  if (!s) return null;
  
  // Remove "Call" as a structural word in definitions (e.g., "reusableWorkflowCallJob" -> "reusableWorkflowJob")
  const cleaned = s.replace(/Call([A-Z])/g, '$1'); // Remove "Call" before uppercase letters
  if (!cleaned) return null;
  
  // Simply capitalize the first letter for camelCase identifiers
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

const getFromRef = (ref?: any): string | null => {
  if (!ref || typeof ref !== 'string') return null;
  
  const [baseUrl, fragment] = ref.split('#');
  const target = fragment || baseUrl;
  if (!target) return null;

  const parts = target.split('/').filter(p => p && p !== '#');
  for (let i = parts.length - 1; i >= 0; i--) {
    let name = decodeURIComponent(parts[i]);
    if (name.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(name) || name.toLowerCase().startsWith('localhost')) continue;
    name = name.replace(/\.(json|schema|yaml|yml)$/i, '');
    if (name && !noise.has(name.toLowerCase()) && !/^\d+$/.test(name)) return name; // Return raw name for refs, don't capitalize
  }
  return null;
};

// Return the raw fragment/key from a $ref/$comment/__from without capitalizing
export const getRefKey = (refOrSchema?: any): string | null => {
  if (!refOrSchema) return null;
  let refStr: string | undefined;
  if (typeof refOrSchema === 'string') refStr = refOrSchema;
  else if (typeof refOrSchema === 'object') {
    if (refOrSchema.$ref) refStr = refOrSchema.$ref;
    else if (refOrSchema.__from) refStr = refOrSchema.__from;
    else if (refOrSchema.$comment) refStr = refOrSchema.$comment;
  }
  if (!refStr || typeof refStr !== 'string') return null;
  const [, fragment] = refStr.split('#');
  const target = fragment || refStr;
  if (!target) return null;
  const parts = target.split('/').filter(p => p && p !== '#');
  for (let i = parts.length - 1; i >= 0; i--) {
    let name = decodeURIComponent(parts[i]);
    name = name.replace(/\.(json|schema|yaml|yml)$/i, '');
    if (name && !noise.has(name.toLowerCase()) && !/^\d+$/.test(name)) return name;
  }
  return null;
};

const getBestName = (s: any, propName?: string): string | null => {
  if (!s || typeof s !== 'object') return null;
  
  // Priority 1: $ref endpoint (if unresolved) - extract the definition name
  const refName = getFromRef(s.$ref);
  if (refName) {
    // Try to convert camelCase identifier to Title Label (e.g., "event" -> "Event", "reusableWorkflowCallJob" -> "ReusableWorkflowJob")
    const titleFromCamelCase = camelCaseToTitleLabel(refName);
    if (titleFromCamelCase) return titleFromCamelCase;
    return capitalize(refName);
  }
  
  // Priority 2: Property name (if available)
  if (propName && !noise.has(propName.toLowerCase())) {
    // Try to convert camelCase identifier to Title Label (e.g., "reusableWorkflowCallJob" -> "ReusableWorkflowJob")
    const titleFromCamelCase = camelCaseToTitleLabel(propName);
    if (titleFromCamelCase) return titleFromCamelCase;
    return capitalize(propName);
  }
  
  // Priority 3: __from endpoint (if available) - metadata about where schema was inlined from
  if (s.__from && typeof s.__from === 'string') {
    const fromName = getFromRef(s.__from);
    if (fromName) {
      // Try to convert camelCase identifier to Title Label
      const titleFromCamelCase = camelCaseToTitleLabel(fromName);
      if (titleFromCamelCase) return titleFromCamelCase;
      return capitalize(fromName);
    }
  }
  
  // Priority 4: $comment endpoint (if available and is a URL) - extract the last segment
  if (s.$comment && typeof s.$comment === 'string' && (s.$comment.startsWith('http://') || s.$comment.startsWith('https://'))) {
    // Use same fragment extraction logic as getFromRef for consistency
    const [, fragment] = s.$comment.split('#');
    const target = fragment || s.$comment;
    
    const parts = target.split('/').filter((p: string) => p && p !== '#');
    for (let i = parts.length - 1; i >= 0; i--) {
      let name = decodeURIComponent(parts[i]);
      name = name.replace(/\.(json|schema|yaml|yml)$/i, '');
      if (!name || noise.has(name.toLowerCase()) || /^\d+$/.test(name)) continue;
      // Try to convert camelCase identifier to Title Label
      const titleFromCamelCase = camelCaseToTitleLabel(name);
      if (titleFromCamelCase) return titleFromCamelCase;
      return capitalize(name);
    }
  }
  
  // Priority 5: Infer from other sources
  // - Explicit title when present
  if (s.title && typeof s.title === 'string' && !noise.has(s.title.toLowerCase())) return capitalize(s.title);
  
  // - Try to extract from $ref key (fallback for non-hydrated schemas)
  const refKey = getRefKey(s.$ref);
  if (refKey) {
    // Try to convert camelCase identifier to Title Label (e.g., "reusableWorkflowCallJob" -> "ReusableWorkflowJob")
    const titleFromCamelCase = camelCaseToTitleLabel(refKey);
    if (titleFromCamelCase) return titleFromCamelCase;
    return capitalize(refKey);
  }
  
  // - For hydrated schemas without $ref, infer from required properties (common pattern for job types)
  if (Array.isArray(s.required)) {
    if (s.required.includes('uses')) return 'ReusableWorkflowJob';
    if (s.required.includes('runs-on')) return 'NormalJob';
  }
  
  // - Recurse through allOf
  if (Array.isArray(s.allOf)) {
    for (const branch of s.allOf) {
      const sub = getBestName(branch, propName);
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
