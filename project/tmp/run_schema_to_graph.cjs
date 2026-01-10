const fs = require('fs');
const schema = JSON.parse(fs.readFileSync('C:/Users/JoeNuc/Downloads/schema (3).json','utf8'));
const nodes = [];
const edges = [];
const makeId = (parentId, label) => { if(!parentId) return '1'; const safe = (label||'').toString().replace(/[^a-zA-Z0-9_-]/g,'_'); return `${parentId}.${safe}`; };
function walkSchema(obj, parentId, label, x=0,y=0, parentRequired=[]){
  const id = makeId(parentId,label);
  // obj.id = id; // avoid mutating
  let type = obj.type || 'object';
  let ofType = undefined;
  let nodeType = 'property';
  let isRequired = false;
  if (parentId && parentRequired && label) isRequired = parentRequired.includes(label);
  const nodeData = { id, label: label||obj.title|| (parentId?type:'Root'), type, parent: parentId };
  if (obj.default !== undefined) nodeData.default = obj.default;
  if (obj.format !== undefined) nodeData.format = obj.format;
  if (obj.pattern !== undefined) nodeData.pattern = obj.pattern;
  if (obj.description !== undefined) nodeData.description = obj.description;
  if (Array.isArray(obj.enum)) nodeData.enum = obj.enum;
  if (obj.examples !== undefined) nodeData.examples = obj.examples;
  if (obj.minimum !== undefined) nodeData.minimum = obj.minimum;
  if (obj.maximum !== undefined) nodeData.maximum = obj.maximum;
  if (obj.minLength !== undefined) nodeData.minLength = obj.minLength;
  if (obj.maxLength !== undefined) nodeData.maxLength = obj.maxLength;
  if (obj.multipleOf !== undefined) nodeData.multipleOf = obj.multipleOf;
  if (obj.minItems !== undefined) nodeData.minItems = obj.minItems;
  if (obj.maxItems !== undefined) nodeData.maxItems = obj.maxItems;
  if (obj.uniqueItems !== undefined) nodeData.uniqueItems = obj.uniqueItems;
  if (obj.readOnly !== undefined) nodeData.readOnly = obj.readOnly;
  if (obj.deprecated !== undefined) nodeData.deprecated = obj.deprecated;
  if (obj.title !== undefined) nodeData.title = obj.title;
  if (type === 'array' && obj.items){
    ofType = obj.items.type || 'object';
    nodeData.ofType = ofType;
    if (Array.isArray(obj.items.enum)) { nodeType='enum'; nodeData.enum = obj.items.enum; }
  }
  if (Array.isArray(obj.enum)) { nodeType='enum'; nodeData.enum = obj.enum; }
  if (parentId) nodeData.required = isRequired;
  nodes.push({id, type: nodeType, data: nodeData});
  if (parentId) edges.push({source: parentId, target: id});
  if (type === 'object' && obj.properties){
    for (const [key, propSchema] of Object.entries(obj.properties)){
      walkSchema(propSchema, id, key, x+250, y-80, obj.required || []);
    }
  }
  if (type === 'array' && obj.items && obj.items.type === 'object' && obj.items.properties){
    for (const [key, propSchema] of Object.entries(obj.items.properties)){
      walkSchema(propSchema, id, key, x+250, y-80, obj.items.required || []);
    }
  }
}
walkSchema(schema, undefined, 'Root', 0,200);
// print nodes under users array
const usersNode = nodes.find(n => n.data && n.data.label==='users');
console.log('usersNode', usersNode ? usersNode.id : 'not found');
const childNodes = nodes.filter(n => n.data.parent===usersNode.id);
console.log('children of users node:');
for (const c of childNodes){ console.log(c.data.label, 'required=', c.data.required); }
// Also print deeper children (profile props)
const profileNode = nodes.find(n => n.data && n.data.label==='profile');
if (profileNode){
  const profileChildren = nodes.filter(n => n.data.parent===profileNode.id);
  console.log('profile children:');
  for (const c of profileChildren) console.log(c.data.label, 'required=', c.data.required);
}
