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
