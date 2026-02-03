
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
    if (name && !noise.has(name.toLowerCase()) && !/^\d+$/.test(name)) return capitalize(name);
  }
  return null;
};

const getBestName = (s: any): string | null => {
  if (!s || typeof s !== 'object') return null;
  const name = getFromRef(s.$ref) || getFromRef(s.$comment) || getFromRef(s.__from);
  if (name) return name;
  if (s.title && typeof s.title === 'string' && !noise.has(s.title.toLowerCase())) return capitalize(s.title);
  if (Array.isArray(s.allOf)) {
    for (const branch of s.allOf) {
      const sub = getBestName(branch);
      if (sub) return sub;
    }
  }
  return null;
};

export function getVariantLabel(vs: Record<string, unknown>, index: number): LabelData {
  const refName = getBestName(vs);
  if (refName) return { title: refName, description: (vs.$ref || vs.$comment || vs.__from) as string };

  if (vs.type === 'array' && vs.items && !Array.isArray(vs.items)) {
    const itemLabel = getVariantLabel(vs.items as Record<string, unknown>, 0);
    if (itemLabel.title && !itemLabel.title.toLowerCase().startsWith('option ')) {
      return { title: `Array<${itemLabel.title}>`, description: itemLabel.description };
    }
  }

  if (vs.type) {
    const t = Array.isArray(vs.type) ? vs.type[0] : vs.type;
    return { title: capitalize(String(t)), description: null };
  }
  return { title: `Option ${index + 1}`, description: null };
}
