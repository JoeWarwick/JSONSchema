import type { BadgeDef } from "./types";

export const BADGE_DEFS: Record<string, BadgeDef> = {
  typeUnion: {
    key: 'typeUnion',
    condition: (d: any) => Array.isArray(d.typeUnion) && d.typeUnion.length > 0,
    label: () => 'union',
    tooltip: (d: any) => String((d.typeUnion || []).join(' | ')),
    variant: 'union',
    bg: '#e8f0ff',
    color: '#2b6cb0',
    badgeVisible: true,
  },
  type: {
    key: 'type',
    condition: (d: any) => !!d.type,
    label: (d: any) => (d.ofType ? `${d.type}<${d.ofType}>` : String(d.type)),
    variant: 'type',
    bg: '#f5f5f5',
    color: '#2b6cb0',
    badgeVisible: true,
  },
  enum: {
    key: 'enum',
    condition: (d: any) => Array.isArray(d.enum) && d.enum.length > 0,
    label: (d: any) => `enum<${d.ofType || d.type || 'string'}>`,
    variant: 'enum',
    bg: '#fffbe6',
    color: '#2b6cb0',
    badgeVisible: true,
  },
  minimum: {
    key: 'minimum',
    condition: (d: any) => d.minimum !== undefined,
    label: (d: any) => `min: ${String(d.minimum)}`,
    variant: 'constraint',
    bg: '#eef7ff',
    color: '#2176c7',
  },
  maximum: {
    key: 'maximum',
    condition: (d: any) => d.maximum !== undefined,
    label: (d: any) => `max: ${String(d.maximum)}`,
    variant: 'constraint',
    bg: '#fff4e6',
    color: '#d9822b',
  },
  format: {
    key: 'format',
    condition: (d: any) => d.format !== undefined,
    label: (d: any) => String(d.format),
    variant: 'format',
    bg: '#fff7f0',
    color: '#fb8c00',
    badgeVisible: true,
  },
  imported: {
    key: 'imported',
    condition: (d: any) => !!d.imported,
    label: () => 'imported',
    tooltip: (d: any) => (d.$ref ? `Imported from ${d.$ref}` : 'Imported definition (create local override to change)'),
    variant: 'imported',
    bg: '#f3e8ff',
    color: '#7b4397',
    badgeVisible: true,
  },
  isRef: {
    key: 'isRef',
    condition: (d: any) => !!d.isRef || !!d.xmlIsRef,
    label: () => 'Ref',
    tooltip: (d: any) => {
      if (d.xmlAttributeGroupRef) {
        return `From attributeGroup "${d.xmlAttributeGroupRef}" \u2014 reference, read-only here`;
      }
      const ref = d.$ref || d.xmlElementType || d.xmlName;
      return ref ? `Reference to ${ref}` : 'Reference';
    },
    variant: 'isRef',
    bg: '#fdecea',
    color: '#c0392b',
    badgeVisible: true,
  },
  minLength: {
    key: 'minLength',
    condition: (d: any) => d.minLength !== undefined,
    label: (d: any) => `min: ${String(d.minLength)}`,
    variant: 'constraint',
    bg: '#eef7ff',
    color: '#2176c7',
  },
  maxLength: {
    key: 'maxLength',
    condition: (d: any) => d.maxLength !== undefined,
    label: (d: any) => `max: ${String(d.maxLength)}`,
    variant: 'constraint',
    bg: '#fff4e6',
    color: '#d9822b',
  },
  minItems: {
    key: 'minItems',
    condition: (d: any) => d.minItems !== undefined,
    label: (d: any) => `min: ${String(d.minItems)}`,
    variant: 'constraint',
    bg: '#eef7ff',
    color: '#2176c7',
    badgeVisible: true,
  },
  maxItems: {
    key: 'maxItems',
    condition: (d: any) => d.maxItems !== undefined,
    label: (d: any) => `max: ${String(d.maxItems)}`,
    variant: 'constraint',
    bg: '#fff4e6',
    color: '#d9822b',
    badgeVisible: true,
  },
  // Hidden/non-badge properties
  description: { key: 'description', condition: () => false, label: () => '', variant: 'meta', badgeVisible: false },
  $comment: { key: '$comment', condition: () => false, label: () => '', variant: 'meta', badgeVisible: false },
  patternKey: { key: 'patternKey', condition: () => false, label: () => '', variant: 'meta', badgeVisible: false },
  label: { key: 'label', condition: () => false, label: () => '', variant: 'meta', badgeVisible: false },
  id: { key: 'id', condition: () => false, label: () => '', variant: 'meta', badgeVisible: false },
  parent: { key: 'parent', condition: () => false, label: () => '', variant: 'meta', badgeVisible: false },
  items: { key: 'items', condition: () => false, label: () => '', variant: 'meta', badgeVisible: false },
  default: { key: 'default', condition: () => false, label: () => '', variant: 'meta', badgeVisible: false },
  title: { key: 'title', condition: () => false, label: () => '', variant: 'meta', badgeVisible: false },
};

import React from 'react';
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip/tooltip';
import styles from './graphical-schema-editor.module.css';

// Colors for the XML schema node-kind badge (element/attribute/simpleType/complexType).
const XML_KIND_STYLES: Record<string, { bg: string; color: string }> = {
  element: { bg: '#e3f2fd', color: '#1565c0' },
  attribute: { bg: '#fff3e0', color: '#e65100' },
  simpleType: { bg: '#e8f5e9', color: '#2e7d32' },
  complexType: { bg: '#f3e8ff', color: '#7b1fa2' },
  attributeGroup: { bg: '#fce4ec', color: '#ad1457' },
};

export const buildBadges = (data: any) => {
  const badges: Array<any> = [];
  if (BADGE_DEFS.isRef.condition(data)) {
    const def = BADGE_DEFS.isRef;
    badges.push({ key: def.key, label: def.label(data), tooltip: def.tooltip && def.tooltip(data), variant: def.variant, bg: def.bg, color: def.color });
  }
  const xmlKind = typeof data.xmlNodeKind === 'string' ? data.xmlNodeKind : undefined;
  if (xmlKind && XML_KIND_STYLES[xmlKind]) {
    const { bg, color } = XML_KIND_STYLES[xmlKind];
    badges.push({ key: 'xmlKind', label: xmlKind, variant: 'xmlKind', bg, color });
  }
  if (BADGE_DEFS.typeUnion.condition(data)) {
    const def = BADGE_DEFS.typeUnion;
    badges.push({ key: def.key, label: def.label(data), tooltip: def.tooltip && def.tooltip(data), variant: def.variant, bg: def.bg, color: def.color });
    return badges;
  }
  if (BADGE_DEFS.enum.condition(data)) {
    const def = BADGE_DEFS.enum;
    badges.push({ key: def.key, label: def.label(data), tooltip: def.tooltip && def.tooltip(data), variant: def.variant, bg: def.bg, color: def.color });
  } else if (BADGE_DEFS.type.condition(data)) {
    const def = BADGE_DEFS.type;
    badges.push({ key: def.key, label: def.label(data), tooltip: def.tooltip && def.tooltip(data), variant: def.variant, bg: def.bg, color: def.color });
  }
  const extraKeys = ['format']; // 'imported' is shown as an inline icon next to the label instead
  for (const k of extraKeys) {
    const def = BADGE_DEFS[k];
    if (def && def.condition(data)) {
      badges.push({ key: def.key, label: def.label(data), tooltip: def.tooltip && def.tooltip(data), variant: def.variant, bg: def.bg, color: def.color });
    }
  }
  const constraintKeys: string[] = [];
  for (const k of constraintKeys) {
    const def = BADGE_DEFS[k];
    if (def && def.condition(data)) {
      badges.push({ key: def.key, label: def.label(data), variant: def.variant, bg: def.bg, color: def.color });
    }
  }
  return badges;
};

// Helper to render badges using CSS classes and optional tooltips
export const renderBadges = (badges: any[]) => badges.map((b) => {
  const cls = `${styles.badge} ${styles['badge_' + (b.variant || 'type')]}`;
  const inlineStyle: any = {};
  if (b.bg) inlineStyle.background = b.bg;
  if (b.color) inlineStyle.color = b.color;
  const content = b.label;
  if (b.tooltip) {
    return React.createElement(
      Tooltip,
      { key: b.key },
      React.createElement(
        TooltipTrigger,
        { asChild: true },
        React.createElement('span', { className: cls, style: inlineStyle, 'aria-label': `Badge ${b.key}` }, content)
      ),
      React.createElement(TooltipContent, null, b.tooltip)
    );
  }
  return React.createElement('span', { key: b.key, className: cls, style: inlineStyle, 'aria-label': `Badge ${b.key}` }, content);
});
