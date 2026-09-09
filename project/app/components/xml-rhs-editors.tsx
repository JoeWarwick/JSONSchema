import type { XmlNodeKind, XmlNodeRhsEditorProps } from './types';
import { useT } from '~/i18n';
import { XmlCompositorEditor } from './xml-compositor-editor';
import { XmlAnyEditor } from './xml-any-editor';
import { XmlSchemaEditor } from './xml-schema-editor';
import { XmlAttributeEditor, XmlAttributeSimpleTypeEditor } from './xml-attribute-editors';
import { XmlElementEditor } from './xml-element-editor';
import { XmlSimpleTypeEditor } from './xml-simple-type-editor';
import { XmlComplexTypeEditor } from './xml-complex-type-editor';
import { XmlAttributeGroupEditor } from './xml-attribute-group-editor';
import { XmlAttributesManager } from './xml-attributes-manager';

/**
 * Editor for xs:import nodes - displays namespace and schemaLocation attributes
 */
function XmlImportEditor({ node, onChange }: { node: any; onChange: (patch: any) => void }) {
  const data = (node.data || {}) as any;
  const namespace = data.xmlImportNamespace || '';
  const schemaLocation = data.xmlImportSchemaLocation || '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h4 style={{ margin: 0 }}>xs:import</h4>
      <div>
        <label style={{ fontSize: 12, display: 'block', marginBottom: 4, fontWeight: 600 }}>
          namespace
        </label>
        <input
          type="text"
          value={namespace}
          onChange={(e) => onChange({ id: node.id, xmlImportNamespace: e.target.value })}
          placeholder="namespace URI"
          style={{
            width: '100%',
            padding: '6px 8px',
            border: '1px solid #ddd',
            borderRadius: 3,
            fontSize: 12,
          }}
        />
      </div>
      <div>
        <label style={{ fontSize: 12, display: 'block', marginBottom: 4, fontWeight: 600 }}>
          schemaLocation
        </label>
        <input
          type="text"
          value={schemaLocation}
          onChange={(e) => onChange({ id: node.id, xmlImportSchemaLocation: e.target.value })}
          placeholder="path to schema file"
          style={{
            width: '100%',
            padding: '6px 8px',
            border: '1px solid #ddd',
            borderRadius: 3,
            fontSize: 12,
          }}
        />
      </div>
    </div>
  );
}

/**
 * Editor for xs:annotation nodes - displays and edits documentation text
 */
function XmlAnnotationEditor({ node, onChange }: { node: any; onChange: (patch: any) => void }) {
  const data = (node.data || {}) as any;
  const annotation = data.xmlAnnotationText || '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h4 style={{ margin: 0 }}>xs:annotation/xs:documentation</h4>
      <div>
        <label style={{ fontSize: 12, display: 'block', marginBottom: 4, fontWeight: 600 }}>
          Documentation
        </label>
        <textarea
          value={annotation}
          onChange={(e) => onChange({ id: node.id, xmlAnnotationText: e.target.value })}
          placeholder="Annotation text"
          rows={4}
          style={{
            width: '100%',
            padding: '6px 8px',
            border: '1px solid #ddd',
            borderRadius: 3,
            fontSize: 12,
            resize: 'vertical',
          }}
        />
      </div>
    </div>
  );
}

export function XmlNodeRhsEditor({ node, onChange, onToggleShowAnnotations, xmlShowAnnotations, onToggleShowImports, xmlShowImports, getNodeByName }: XmlNodeRhsEditorProps) {
  const t = useT();

  if (!node) return <div style={{ color: '#888', fontStyle: 'italic' }}>{t('workbench.xmlRhsEditor.selectNode')}</div>;
  const data = (node.data || {}) as any;
  const kind = (data.xmlNodeKind || '') as XmlNodeKind;
  const readOnlySource = typeof data.xmlReadOnlySource === 'string' && data.xmlReadOnlySource ? data.xmlReadOnlySource : undefined;

  if (kind === 'schema') 
    return <XmlSchemaEditor node={node} onChange={onChange} onToggleShowAnnotations={onToggleShowAnnotations} xmlShowAnnotations={xmlShowAnnotations} onToggleShowImports={onToggleShowImports} xmlShowImports={xmlShowImports} readOnlySource={readOnlySource} getNodeByName={getNodeByName} />;
  if (kind === 'simpleType' && data.xmlIsAnonymous) 
    return <XmlAttributeSimpleTypeEditor node={node} onChange={onChange} readOnlySource={readOnlySource} getNodeByName={getNodeByName} />;
  if (kind === 'simpleType') 
    return <XmlSimpleTypeEditor node={node} onChange={onChange} readOnlySource={readOnlySource} getNodeByName={getNodeByName} />;
  if (kind === 'sequence' || kind === 'choice' || kind === 'all') 
    return <XmlCompositorEditor node={node} onChange={onChange} readOnlySource={readOnlySource} getNodeByName={getNodeByName} />;
  if (kind === 'any') 
    return <XmlAnyEditor node={node} onChange={onChange} getNodeByName={getNodeByName} />;
  if (kind === 'import')
    return <XmlImportEditor node={node} onChange={onChange} />;
  if (kind === 'annotation')
    return <XmlAnnotationEditor node={node} onChange={onChange} />;
  if (kind === 'complexType') return (
    <XmlComplexTypeEditor
      node={node}
      onChange={onChange}
      readOnlySource={readOnlySource}
      getNodeByName={getNodeByName}
      renderAttributesManager={(editorNode, editorOnChange) => (
        <XmlAttributesManager node={editorNode} onChange={editorOnChange} />
      )}
    />
  );
  if (kind === 'attributeGroup') return (
    <XmlAttributeGroupEditor
      node={node}
      onChange={onChange}
      readOnlySource={readOnlySource}
      getNodeByName={getNodeByName}
      renderAttributesManager={(editorNode, editorOnChange) => (
        <XmlAttributesManager node={editorNode} onChange={editorOnChange} />
      )}
    />
  );
  if (kind === 'attribute') 
    return <XmlAttributeEditor node={node} onChange={onChange} readOnlySource={readOnlySource} getNodeByName={getNodeByName} />;
  if (kind === 'element') return (
    <XmlElementEditor
      node={node}
      onChange={onChange}
      readOnlySource={readOnlySource}
      getNodeByName={getNodeByName}
      renderAttributesManager={(editorNode, editorOnChange) => (
        <XmlAttributesManager node={editorNode} onChange={editorOnChange} />
      )}
    />
  );

  return <div style={{ color: '#888', fontStyle: 'italic' }}>{t('workbench.xmlRhsEditor.selectEditorNode')}</div>;
}
