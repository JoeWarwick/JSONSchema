// Quick test to verify XML parsing with multiple xs:import elements
const fs = require('fs');
const path = require('path');

// Read the actual schema file
const schemaPath = path.join(__dirname, 'public/schemas/schema-for-xslt20.xsd');
const xmlText = fs.readFileSync(schemaPath, 'utf-8');

// Parse with DOMParser (simulating browser parsing)
const { DOMParser } = require('@xmldom/xmldom');
const parser = new DOMParser();
const doc = parser.parseFromString(xmlText, 'application/xml');

// Find all xs:import elements
const imports = doc.getElementsByTagName('import');
console.log('Total xs:import elements in DOM:', imports.length);

for (let i = 0; i < imports.length; i++) {
  const imp = imports[i];
  const ns = imp.getAttribute('namespace');
  const loc = imp.getAttribute('schemaLocation');
  console.log(`  Import ${i}: namespace="${ns}" schemaLocation="${loc}"`);
}

// Now test the parseXmlElement logic
const parseXmlElement = (element) => {
  const out = {};
  const childrenInOrder = [];

  // Handle attributes
  if (element.attributes && element.attributes.length > 0) {
    const attributes = {};
    for (const attr of element.attributes) {
      attributes[attr.name] = attr.value;
    }
    if (Object.keys(attributes).length > 0) {
      out['@attributes'] = attributes;
    }
  }

  // Handle child nodes
  const textParts = [];
  for (const child of element.childNodes) {
    // Skip text nodes
    if (child.nodeType === 3) { // TEXT_NODE
      const value = child.nodeValue || '';
      if (value.trim().length > 0) textParts.push(value);
      continue;
    }

    // Skip other non-element nodes
    if (child.nodeType !== 1) continue; // ELEMENT_NODE

    const childValue = parseXmlElement(child);
    childrenInOrder.push({ tagName: child.nodeName, value: childValue });
  }

  if (textParts.length > 0) {
    const text = textParts.join('').trim();
    if (text.length > 0) {
      if (childrenInOrder.length === 0) {
        return { '#text': text };
      }
      out['#text'] = text;
    }
  }

  // Build final structure: group by tag name
  for (const { tagName, value } of childrenInOrder) {
    const existing = out[tagName];
    if (typeof existing === 'undefined') {
      out[tagName] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      out[tagName] = [existing, value];
    }
  }

  // Store the document-order list
  if (childrenInOrder.length > 0) {
    out['__childrenInOrder'] = childrenInOrder;
  }

  return out;
};

const root = doc.documentElement;
const parsed = parseXmlElement(root);

const childrenInOrder = parsed['__childrenInOrder'];
console.log('\n__childrenInOrder keys:');
if (childrenInOrder) {
  childrenInOrder.forEach((entry, idx) => {
    console.log(`  [${idx}] tagName="${entry.tagName}"`);
  });
  
  // Count xs:import entries
  const importEntries = childrenInOrder.filter(e => e.tagName === 'xs:import');
  console.log(`\nTotal xs:import entries in __childrenInOrder: ${importEntries.length}`);
  importEntries.forEach((entry, idx) => {
    const attrs = entry.value['@attributes'] || {};
    console.log(`  Import ${idx}: ns="${attrs.namespace}" location="${attrs.schemaLocation}"`);
  });
} else {
  console.log('  ERROR: __childrenInOrder not found!');
}

// Also check the aggregated xs:import
const importsAggregate = parsed['xs:import'];
console.log(`\nAggregated parsed['xs:import']:`, Array.isArray(importsAggregate) ? `Array with ${importsAggregate.length} items` : 'Single object');
