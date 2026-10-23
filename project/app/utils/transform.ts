export const TRANSFORM_STORAGE_KEY = 'schema-sculptor-transform';
export const TRANSFORM_TAB_KEY = 'schema-sculptor-transform-tab';
export const MAX_XML_LENGTH = 1_000_000;

export interface XmlStep {
  name: string;
  namespace: string;
  attribute: boolean;
}

export interface TransformNode {
  id: string;
  label: string;
  steps: XmlStep[];
  repeated: boolean;
  children: TransformNode[];
}

export interface TransformDatasource {
  workbenchId: string;
  name: string;
  revision: string;
  xml: string;
  schema: string;
  rootElement: string;
}

export interface MappingRule {
  id: string;
  target: string;
  mode: 'value' | 'constant' | 'repeat';
  source: string;
  constant: string;
  templateMode?: string;
}

export interface TransformDefinition {
  version: 1;
  source: TransformDatasource | null;
  target: TransformDatasource | null;
  mappings: MappingRule[];
  input: string;
  outputs?: TransformOutput[];
}

export interface TransformOutput {
  id: string;
  name: string;
  target: TransformDatasource | null;
  mappings: MappingRule[];
}

export const OUTPUT_BUNDLE_NAMESPACE = 'urn:schema-sculptor:transform:outputs:1';
export const PRIMARY_OUTPUT_ID = 'primary';
export const MAX_TRANSFORM_OUTPUTS = 16;

export function transformOutputs(definition: TransformDefinition): TransformOutput[] {
  return [
    { id: PRIMARY_OUTPUT_ID, name: definition.target?.name || 'Output 1', target: definition.target, mappings: definition.mappings },
    ...(definition.outputs ?? []),
  ];
}

export function emptyTransform(): TransformDefinition {
  return { version: 1, source: null, target: null, mappings: [], input: '' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isDatasource(value: unknown): value is TransformDatasource | null {
  return value === null || (isRecord(value)
    && ['workbenchId', 'name', 'revision', 'xml', 'schema', 'rootElement'].every(key => typeof value[key] === 'string'));
}

function isMappingRule(value: unknown): value is MappingRule {
  return isRecord(value) && ['id', 'target', 'source', 'constant'].every(key => typeof value[key] === 'string')
    && (value.templateMode === undefined || typeof value.templateMode === 'string')
    && ['value', 'constant', 'repeat'].includes(String(value.mode));
}

function isTransformOutput(value: unknown): value is TransformOutput {
  return isRecord(value) && typeof value.id === 'string' && /^[A-Za-z0-9_.-]+$/.test(value.id)
    && value.id !== PRIMARY_OUTPUT_ID && typeof value.name === 'string' && isDatasource(value.target)
    && Array.isArray(value.mappings) && value.mappings.every(isMappingRule);
}

export function parseTransform(text: string): TransformDefinition {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || value.version !== 1 || !isDatasource(value.source) || !isDatasource(value.target)
    || typeof value.input !== 'string' || !Array.isArray(value.mappings)
    || !value.mappings.every(isMappingRule)
    || (value.outputs !== undefined && (!Array.isArray(value.outputs) || !value.outputs.every(isTransformOutput)))) {
    throw new Error('Invalid or unsupported Transform definition.');
  }
  const outputs = value.outputs;
  if (outputs && (outputs.length >= MAX_TRANSFORM_OUTPUTS || new Set(outputs.map(output => output.id)).size !== outputs.length)) {
    throw new Error('Transform output IDs must be unique; at most 16 outputs are supported.');
  }
  return {
    version: 1, source: value.source, target: value.target,
    mappings: value.mappings, input: value.input,
    ...(outputs ? { outputs } : {}),
  };
}

export function parseTransformXml(text: string): XMLDocument {
  if (!text.trim()) throw new Error('XML content is required.');
  if (text.length > MAX_XML_LENGTH) throw new Error('XML exceeds the 1,000,000 character preview limit.');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('DTD and entity declarations are not supported.');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || !doc.documentElement) {
    throw new Error('Invalid XML. Correct the XML in its workbench before using it as a datasource.');
  }
  return doc;
}

export function xmlStructure(text: string): TransformNode {
  const doc = parseTransformXml(text);
  let count = 0;
  const build = (elements: Element[], parents: XmlStep[], depth: number): TransformNode => {
    if (++count > 2000 || depth > 40) throw new Error('XML structure exceeds the mapping limit (2,000 nodes / 40 levels).');
    const element = elements[0];
    const steps = [...parents, { name: element.localName, namespace: element.namespaceURI ?? '', attribute: false }];
    const children: TransformNode[] = [];
    const attributes = new Map<string, Attr>();
    const groups = new Map<string, Element[]>();
    elements.forEach(item => {
      Array.from(item.attributes).filter(attr => attr.namespaceURI !== 'http://www.w3.org/2000/xmlns/').forEach(attr => {
        attributes.set(JSON.stringify([attr.namespaceURI, attr.localName]), attr);
      });
      Array.from(item.children).forEach(child => {
        const key = JSON.stringify([child.namespaceURI, child.localName]);
        const group = groups.get(key) ?? [];
        group.push(child);
        groups.set(key, group);
      });
    });
    attributes.forEach(attr => {
      const attrSteps = [...steps, { name: attr.localName, namespace: attr.namespaceURI ?? '', attribute: true }];
      children.push({ id: JSON.stringify(attrSteps), label: `@${attr.name}`, steps: attrSteps, repeated: false, children: [] });
    });
    groups.forEach(group => children.push(build(group, steps, depth + 1)));
    const repeated = elements.length > 1 && elements.some((item, index) => index > 0 && item.parentElement === elements[index - 1].parentElement);
    return { id: JSON.stringify(steps), label: element.tagName, steps, repeated, children };
  };
  return build([doc.documentElement], [], 0);
}

export function flattenTransformNodes(root: TransformNode): TransformNode[] {
  return [root, ...root.children.flatMap(flattenTransformNodes)];
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value.split("'").map(part => `'${part}'`).join(`, "'", `)})`;
}

function xpath(steps: XmlStep[], context: XmlStep[]): string {
  const isChild = context.length > 0 && context.every((step, index) => JSON.stringify(step) === JSON.stringify(steps[index]));
  const relative = isChild ? steps.slice(context.length) : steps;
  if (isChild && relative.length === 0) return '.';
  return `${isChild ? '' : '/'}${relative.map(step =>
    `${step.attribute ? '@' : ''}*[local-name()=${xpathLiteral(step.name)} and namespace-uri()=${xpathLiteral(step.namespace)}]`,
  ).join('/')}`;
}

export function generateXslt(definition: TransformDefinition): string {
  if (definition.outputs?.length) return generateBundleXslt(definition);
  if (!definition.source || !definition.target) throw new Error('Select source and target XML datasources.');
  if (definition.mappings.length === 0) throw new Error('Add at least one mapping.');
  if (definition.mappings.length > 200) throw new Error('A Transform supports up to 200 mapping rules.');
  const source = xmlStructure(definition.source.xml);
  const target = xmlStructure(definition.target.xml);
  const sources = new Map(flattenTransformNodes(source).map(node => [node.id, node]));
  const targets = new Map(flattenTransformNodes(target).map(node => [node.id, node]));
  const rules = new Map<string, MappingRule>();
  definition.mappings.forEach(rule => {
    const targetNode = targets.get(rule.target);
    const sourceNode = sources.get(rule.source);
    if (!targetNode) throw new Error('A mapped target field no longer exists. Remove or repair the mapping.');
    if (rules.has(rule.target)) throw new Error(`Multiple mappings for ${targetNode.label}.`);
    if (rule.mode !== 'constant' && !sourceNode) throw new Error('A mapped source field no longer exists. Remove or repair the mapping.');
    if (rule.mode === 'repeat' && (targetNode.steps.at(-1)?.attribute || sourceNode?.steps.at(-1)?.attribute)) {
      throw new Error('Repeating groups must map elements, not attributes.');
    }

    if (rule.mode === 'repeat' && targetNode.steps.length === 1) {
      throw new Error('A repeating group cannot target the document root. Select a child collection.');
    }
    if (rule.mode !== 'repeat' && targetNode.children.some(child => !child.steps.at(-1)?.attribute)) {
      throw new Error(`Map leaf fields individually; use a repeating group for ${targetNode.label}.`);
    }
    rules.set(rule.target, rule);
  });
  const repeatingTargets = [...targets.values()].filter(node => rules.get(node.id)?.mode === 'repeat');
  const templateModes = new Map<string, string>();
  const usedModes = new Set<string>();
  repeatingTargets.forEach(node => {
    const mode = rules.get(node.id)!.templateMode?.trim();
    if (!mode) return;
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(mode)) {
      throw new Error(`Invalid template mode "${mode}". Start with a letter or underscore; use letters, digits, underscores, hyphens or dots (no namespace prefixes).`);
    }
    if (usedModes.has(mode)) throw new Error(`Template mode "${mode}" is already used. Choose a unique mode for each repeating group.`);
    usedModes.add(mode);
    templateModes.set(node.id, mode);
  });
  repeatingTargets.forEach((node, index) => {
    if (templateModes.has(node.id)) return;
    let number = index + 1;
    while (usedModes.has(`mapping-${number}`)) number++;
    const mode = `mapping-${number}`;
    usedModes.add(mode);
    templateModes.set(node.id, mode);
  });
  const templates: string[][] = [];
  const hasMapping = (node: TransformNode): boolean => rules.has(node.id) || node.children.some(hasMapping);
  const render = (node: TransformNode, context: XmlStep[], depth: number, inGroupTemplate = false): string[] => {
    if (!hasMapping(node) && depth > 2) return [];
    const rule = rules.get(node.id);
    if (node.repeated && hasMapping(node) && rule?.mode !== 'repeat') {
      throw new Error(`Add a repeating group mapping for ${node.label} before mapping its fields.`);
    }
    const step = node.steps[node.steps.length - 1];
    const pad = '  '.repeat(depth);
    if (rule?.mode === 'repeat' && !inGroupTemplate) {
      const sourceNode = sources.get(rule.source)!;
      const mode = templateModes.get(node.id)!;
      templates.push([
        `  <xsl:template match="*" mode="${mode}">`,
        ...render(node, sourceNode.steps, 2, true),
        '  </xsl:template>',
      ]);
      return [`${pad}<xsl:apply-templates select="${xmlEscape(xpath(sourceNode.steps, context))}" mode="${mode}"/>`];
    }
    const lines: string[] = [];
    const indent = pad;
    const instruction = step.attribute ? 'attribute' : 'element';
    lines.push(`${indent}<xsl:${instruction} name="${xmlEscape(step.name)}" namespace="${xmlEscape(step.namespace)}">`);
    const childDepth = depth + 1;
    node.children.filter(child => child.steps.at(-1)?.attribute)
      .forEach(child => lines.push(...render(child, context, childDepth)));
    if (rule?.mode === 'constant') lines.push(`${indent}  <xsl:text>${xmlEscape(rule.constant)}</xsl:text>`);
    else if (rule?.mode === 'value') {
      lines.push(`${indent}  <xsl:value-of select="${xmlEscape(xpath(sources.get(rule.source)!.steps, context))}"/>`);
    }
    node.children.filter(child => !child.steps.at(-1)?.attribute)
      .forEach(child => lines.push(...render(child, context, childDepth)));
    lines.push(`${indent}</xsl:${instruction}>`);
    return lines;
  };
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">',
    '  <xsl:output method="xml" indent="yes" encoding="UTF-8"/>',
    '  <xsl:template match="/">',
    ...render(target, [], 2),
    '  </xsl:template>',
    ...templates.flat(),
    '</xsl:stylesheet>',
  ].join('\n');
}

function generateBundleXslt(definition: TransformDefinition): string {
  const outputs = transformOutputs(definition);
  if (!definition.outputs?.every(isTransformOutput)
    || outputs.length > MAX_TRANSFORM_OUTPUTS || new Set(outputs.map(output => output.id)).size !== outputs.length) {
    throw new Error('Transform output IDs must be unique; at most 16 outputs are supported.');
  }
  const templates: string[] = [];
  const calls = outputs.map((output, index) => {
    if (!output.name.trim()) throw new Error('Give every output document a name.');
    let stylesheet: string;
    try {
      stylesheet = generateXslt({ ...definition, target: output.target, mappings: output.mappings, outputs: undefined });
    } catch (failure) {
      throw new Error(`${output.name}: ${failure instanceof Error ? failure.message : 'Failed to generate output.'}`);
    }
    const entry = `output-${index + 1}`;
    const document = parseTransformXml(stylesheet);
    const serializer = new XMLSerializer();
    Array.from(document.documentElement.children)
      .filter(element => element.localName === 'template')
      .forEach(template => {
        if (template.getAttribute('match') === '/') {
          template.removeAttribute('match');
          template.setAttribute('name', entry);
        }
        [template, ...Array.from(template.getElementsByTagNameNS('http://www.w3.org/1999/XSL/Transform', '*'))]
          .forEach(element => {
            const mode = element.getAttribute('mode');
            if (mode) element.setAttribute('mode', `${entry}-${mode}`);
          });
        templates.push(serializer.serializeToString(template));
      });
    return `      <bundle:document id="${xmlEscape(output.id)}"><xsl:call-template name="${entry}"/></bundle:document>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:bundle="${OUTPUT_BUNDLE_NAMESPACE}" exclude-result-prefixes="bundle">`,
    '  <xsl:output method="xml" indent="yes" encoding="UTF-8"/>',
    '  <xsl:template match="/">',
    '    <bundle:outputs>',
    ...calls,
    '    </bundle:outputs>',
    '  </xsl:template>',
    ...templates,
    '</xsl:stylesheet>',
  ].join('\n');
}

export interface TransformResultDocument {
  id: string;
  name: string;
  xml: string;
  schema: string;
}

export function readTransformResults(xml: string, definition: TransformDefinition): TransformResultDocument[] {
  const outputs = transformOutputs(definition);
  const document = parseTransformXml(xml);
  const serialize = (element: Element) => new XMLSerializer().serializeToString(element);
  if (!definition.outputs?.length) {
    return [{ id: PRIMARY_OUTPUT_ID, name: outputs[0].name, xml, schema: definition.target?.schema ?? '' }];
  }
  const root = document.documentElement;
  const hasNonWhitespaceText = (element: Element) => Array.from(element.childNodes)
    .some(node => (node.nodeType === 3 || node.nodeType === 4) && node.textContent?.trim());
  if (root.namespaceURI !== OUTPUT_BUNDLE_NAMESPACE || root.localName !== 'outputs'
    || root.children.length !== outputs.length || hasNonWhitespaceText(root)) {
    throw new Error('Invalid Transform output bundle.');
  }
  const seen = new Set<string>();
  const results = Array.from(root.children).map(wrapper => {
    const output = outputs.find(output => output.id === wrapper.getAttribute('id'));
    if (wrapper.namespaceURI !== OUTPUT_BUNDLE_NAMESPACE || wrapper.localName !== 'document'
      || !output || seen.has(output.id) || wrapper.children.length !== 1
      || hasNonWhitespaceText(wrapper)) {
      throw new Error('Each Transform output must have a unique expected ID and exactly one XML root.');
    }
    seen.add(output.id);
    const xml = serialize(wrapper.children[0]);
    parseTransformXml(xml);
    return { id: output.id, name: output.name, xml, schema: output.target?.schema ?? '' };
  });
  return outputs.map(output => results.find(result => result.id === output.id)!);
}
