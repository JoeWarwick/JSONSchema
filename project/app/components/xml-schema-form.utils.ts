import type { NamedTypeRef } from './xml-schema-form.types';

export const displayValue = (value: unknown, fallback: string): string => (
  typeof value === 'string' || typeof value === 'number' ? String(value) : fallback
);

export const asArray = <T,>(value: T | T[] | null | undefined): T[] => {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
};

export const readAnnotationDocs = (node: Record<string, unknown>): string[] => {
  const annotations = asArray((node as any)['xs:annotation']);
  return annotations
    .map((annotation: any) => {
      if (!annotation || typeof annotation !== 'object') return '';
      const documentation = Array.isArray(annotation['xs:documentation'])
        ? annotation['xs:documentation'][0]
        : annotation['xs:documentation'];
      if (typeof documentation === 'string') return documentation;
      if (documentation && typeof documentation === 'object') {
        const text = documentation['#text'];
        if (typeof text === 'string') return text;
      }
      return '';
    })
    .filter((text: string) => text.trim().length > 0);
};

export const upsertElementAnnotation = (
  element: Record<string, unknown>,
  value: string,
): Record<string, unknown> => {
  const trimmed = value.trim();
  const nextElement: Record<string, unknown> = { ...element };

  if (trimmed.length === 0) {
    delete (nextElement as any)['xs:annotation'];
    return nextElement;
  }

  const existingAnnotations = asArray((nextElement as any)['xs:annotation']);
  const annotations = existingAnnotations.length > 0
    ? existingAnnotations.map((annotation: any) => (
      annotation && typeof annotation === 'object' ? { ...annotation } : annotation
    ))
    : [{}];

  const first = annotations[0];
  if (first && typeof first === 'object') {
    const annotation = { ...(first as Record<string, unknown>) };
    const existingDocumentation = annotation['xs:documentation'];
    if (Array.isArray(existingDocumentation) && existingDocumentation.length > 0) {
      const documentation = [...existingDocumentation];
      const firstDocumentation = documentation[0];
      documentation[0] = firstDocumentation && typeof firstDocumentation === 'object'
        ? { ...firstDocumentation, '#text': value }
        : value;
      annotation['xs:documentation'] = documentation;
    } else if (existingDocumentation && typeof existingDocumentation === 'object') {
      annotation['xs:documentation'] = { ...existingDocumentation, '#text': value };
    } else {
      annotation['xs:documentation'] = value;
    }
    annotations[0] = annotation;
  } else {
    annotations[0] = { 'xs:documentation': value };
  }

  (nextElement as any)['xs:annotation'] = annotations;
  return nextElement;
};

export const getXmlAttrs = (node: Record<string, unknown> | null | undefined) => {
  if (!node || typeof node !== 'object') return {};
  return Object.fromEntries(
    Object.entries(node).filter(([key]) => key.startsWith('@'))
  );
};

export const detectNamedTypeRef = (schema: Record<string, unknown>): NamedTypeRef | null => {
  const type = schema['@type'];
  if (type && typeof type === 'string') {
    const typeName = type.replace(/^xs:/, '');
    return {
      refName: typeName,
      refPath: ['xs:schema', `xs:complexType[@name='${typeName}']`]
    };
  }

  const ref = schema['@ref'];
  if (ref && typeof ref === 'string') {
    const refName = ref.replace(/^xs:/, '');
    return {
      refName,
      refPath: ['xs:schema', `xs:element[@name='${refName}']`]
    };
  }

  return null;
};

export const getSchemaIdentity = (schema: Record<string, unknown> | undefined): string => {
  if (!schema) return 'unknown';
  if (schema.$ref && typeof schema.$ref === 'string') return `$ref:${schema.$ref}`;
  if (schema.$id && typeof schema.$id === 'string') return `$id:${schema.$id}`;
  if (schema.name && typeof schema.name === 'string') return `named:${schema.name}`;
  try {
    const hash = JSON.stringify(schema).substring(0, 32);
    return `hash:${hash}`;
  } catch {
    return 'unknown';
  }
};