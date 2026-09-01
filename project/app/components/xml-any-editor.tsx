import React from 'react';
import type { XmlNodeRhsEditorProps } from './types';

/**
 * Read-only display for an `xs:any` wildcard content particle.
 */
export function XmlAnyEditor({ node }: XmlNodeRhsEditorProps) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>xs:any (wildcard content)</div>
      <div style={{ fontSize: 12, color: '#888', fontStyle: 'italic' }}>
        Matches any element from the given namespace; not individually editable.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>namespace</span>
        <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{String(data.xmlAnyNamespace ?? '##any')}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>processContents</span>
        <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{String(data.xmlAnyProcessContents ?? 'strict')}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>minOccurs / maxOccurs</span>
        <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{String(data.xmlMinOccurs ?? '1')} / {String(data.xmlMaxOccurs ?? '1')}</span>
      </div>
    </div>
  );
}
