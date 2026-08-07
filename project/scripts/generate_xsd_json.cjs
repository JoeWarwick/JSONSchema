const { DOMParser } = require('xmldom');
const fs = require('fs');
const path = require('path');

const xsdPath = path.join(__dirname, '..', 'public', 'schemas', 'XMLSchema.xsd');
const outPath = path.join(__dirname, '..', 'public', 'schemas', 'XMLSchema.generated.json');

if (!fs.existsSync(xsdPath)) {
  console.error('XSD file not found:', xsdPath);
  process.exit(2);
}

const xml = fs.readFileSync(xsdPath, 'utf8');
const doc = new DOMParser().parseFromString(xml, 'application/xml');

function convertElement(el) {
  const obj = {};
  if (!el) return obj;

  if (el.attributes && el.attributes.length) {
    for (let i = 0; i < el.attributes.length; i++) {
      const a = el.attributes.item(i);
      obj['@' + a.name] = a.value;
    }
  }

  const childElems = [];
  const textParts = [];
  for (let node = el.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1) childElems.push(node);
    else if (node.nodeType === 3 || node.nodeType === 4) {
      const txt = node.nodeValue;
      if (txt && txt.trim()) textParts.push(txt);
    }
  }

  for (const child of childElems) {
    const tag = child.tagName;
    const childObj = convertElement(child);
    if (obj[tag] === undefined) obj[tag] = childObj;
    else if (Array.isArray(obj[tag])) obj[tag].push(childObj);
    else obj[tag] = [obj[tag], childObj];
  }

  if (textParts.length) obj['_text'] = textParts.join('').trim();
  return obj;
}

const root = doc.documentElement;
const result = {};
result[root.tagName] = convertElement(root);

fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
console.log('Written generated JSON to', outPath);
