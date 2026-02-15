/* global console */
// Simple test script to verify getRefKey extraction logic
const getRefKey = (refOrSchema) => {
  if (!refOrSchema) return null;
  let refStr;
  if (typeof refOrSchema === 'string') refStr = refOrSchema;
  else if (typeof refOrSchema === 'object') refStr = (refOrSchema.$ref || refOrSchema.$comment || refOrSchema.__from);
  if (!refStr || typeof refStr !== 'string') return null;
  const [, fragment] = refStr.split('#');
  const target = fragment || refStr;
  if (!target) return null;
  const parts = target.split('/').filter(p => p && p !== '#');
  console.log('  Parts:', parts);
  for (let i = parts.length - 1; i >= 0; i--) {
    let name = decodeURIComponent(parts[i]);
    name = name.replace(/\.(json|schema|yaml|yml)$/i, '');
    console.log(`    [${i}]: "${name}"`);
    const noise = new Set(['schema', 'root', 'item', 'items', 'object', 'string', 'number', 'boolean', 'array', 'null', 'any']);
    if (!name || noise.has(name.toLowerCase()) || /^\d+$/.test(name)) continue;
    return name;
  }
  return null;
};

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Test with the $comment from the failing test
const comment = 'https://help.github.com/...#self-hosted-runners';
console.log('Testing $comment:', comment);
const key = getRefKey(comment);
console.log('Extracted key:', key);
console.log('Capitalized:', key ? capitalize(key) : null);

// Test with first variant
const variant1 = { $comment: 'https://help.github.com/...#self-hosted-runners', type: 'string' };
const key1 = getRefKey(variant1.$comment);
console.log('\nVariant 1 - Extracted key:', key1);

// Test with second variant  
const variant2 = { $comment: 'https://help.github.com/...#self-hosted-runners', anyOf: [{ items: [{ type: 'string' }], minItems: 1 }], type: 'array' };
const key2 = getRefKey(variant2.$comment);
console.log('Variant 2 - Extracted key:', key2);
