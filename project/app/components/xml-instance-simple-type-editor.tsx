import React from 'react';
import type { InlineSimpleTypeData, SimpleTypeFacets, XmlNodeRhsEditorProps } from './types';
import { XmlAnnotationFieldAuto, XmlReadOnlyHint } from './xml-editor-controls';
import {
  EnumerationListEditor,
  FacetsEditor,
  InlineSimpleTypeEditor,
  ListValuesEditor,
  MemberTypesListEditor,
  NamedSimpleTypeNestedMembersEditor,
  ReferencedEnumerationList,
} from './xml-simple-type-controls';

export function XmlInstanceSimpleTypeEditor({ node, onChange, readOnlySource, getNodeByName }: XmlNodeRhsEditorProps & { readOnlySource?: string }) {
  if (!node) return null;
  const data = (node.data || {}) as any;
  const [name, setName] = React.useState<string>(String(data.xmlName || ''));
  const [mode, setMode] = React.useState<string>(String(data.xmlSimpleTypeMode || 'restriction'));
  const [base, setBase] = React.useState<string>(String(data.xmlBase || ''));
  const [memberTypes, setMemberTypes] = React.useState<string>(String(data.xmlMemberTypes || ''));
  const [itemType, setItemType] = React.useState<string>(String(data.xmlItemType || ''));
  const [enumerations, setEnumerations] = React.useState<string[]>(Array.isArray(data.xmlEnumerations) ? data.xmlEnumerations : []);
  const [listValues, setListValues] = React.useState<string[]>(Array.isArray(data.xmlListValues) ? data.xmlListValues : []);
  const readOnly = Boolean(readOnlySource);
  const [facets, setFacets] = React.useState<SimpleTypeFacets>(data.xmlFacets && typeof data.xmlFacets === 'object' ? data.xmlFacets : {});
  const [isRef, setIsRef] = React.useState<boolean>(Boolean(data.xmlIsRef));
  const hasAnnotation = (Array.isArray(data.xmlAnnotations) && data.xmlAnnotations.length > 0) || Boolean(data.xmlAnnotation);
  const [showAnnotationEditor, setShowAnnotationEditor] = React.useState<boolean>(hasAnnotation);

  const resolvedItemTypeNode = React.useMemo(() => {
    if (!itemType || itemType.startsWith('xs:') || !getNodeByName) {
      return null;
    }
    const localName = itemType.includes(':') ? itemType.split(':')[1] : itemType;
    return getNodeByName(localName);
  }, [itemType, getNodeByName]);

  React.useEffect(() => {
    setName(String(data.xmlName || ''));
    setMode(String(data.xmlSimpleTypeMode || 'restriction'));
    setBase(String(data.xmlBase || ''));
    setMemberTypes(String(data.xmlMemberTypes || ''));
    setItemType(String(data.xmlItemType || ''));
    setEnumerations(Array.isArray(data.xmlEnumerations) ? data.xmlEnumerations : []);
    setListValues(Array.isArray(data.xmlListValues) ? data.xmlListValues : []);
    setFacets(data.xmlFacets && typeof data.xmlFacets === 'object' ? data.xmlFacets : {});
    setIsRef(Boolean(data.xmlIsRef));
  }, [node?.id, data.xmlName, data.xmlSimpleTypeMode, data.xmlBase, data.xmlMemberTypes, data.xmlItemType, data.xmlEnumerations, data.xmlListValues, data.xmlFacets, data.xmlIsRef]);

  React.useEffect(() => {
    if (hasAnnotation) setShowAnnotationEditor(true);
  }, [hasAnnotation]);

  const handleEnumerationsChange = (next: string[]) => {
    setEnumerations(next);
    onChange({ id: node.id, xmlEnumerations: next });
  };

  const handleListValuesChange = (next: string[]) => {
    setListValues(next);
    onChange({ id: node.id, xmlListValues: next });
  };

  const handleFacetsChange = (next: SimpleTypeFacets) => {
    setFacets(next);
    onChange({ id: node.id, xmlFacets: next });
  };

  const handleUpdateMemberSimpleTypes = (next: InlineSimpleTypeData[]) => {
    onChange({ id: node.id, xmlMemberSimpleTypes: next });
  };

  const handleUpdateItemSimpleType = (next: InlineSimpleTypeData | undefined) => {
    onChange({ id: node.id, xmlItemSimpleType: next });
  };

  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: 10 }} onSubmit={(e) => e.preventDefault()}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>SimpleType Editor</div>
      {readOnly && <XmlReadOnlyHint source={readOnlySource!} />}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>Name</span>
        <input
          aria-label="SimpleType Name"
          value={name}
          disabled={readOnly}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => onChange({ id: node.id, xmlName: name })}
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>Mode</span>
        <select
          aria-label="SimpleType Mode"
          value={mode}
          disabled={readOnly}
          onChange={(e) => {
            const nextMode = e.target.value;
            setMode(nextMode);
            onChange({ id: node.id, xmlSimpleTypeMode: nextMode });
          }}
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
        >
          <option value="restriction">restriction</option>
          <option value="union">union</option>
          <option value="list">list</option>
        </select>
      </label>

      {mode === 'restriction' && (
        <>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12 }}>Base</span>
            <input
              aria-label="Restriction Base"
              value={base}
              disabled={readOnly}
              onChange={(e) => setBase(e.target.value)}
              onBlur={() => onChange({ id: node.id, xmlBase: base })}
              style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
              placeholder="xs:string"
            />
          </label>
          {!readOnly ? (
            <>
              <EnumerationListEditor values={enumerations} onChange={handleEnumerationsChange} ariaPrefix="SimpleType enumeration" />
              <FacetsEditor facets={facets} onChange={handleFacetsChange} ariaPrefix="SimpleType facet" />
            </>
          ) : null}
        </>
      )}

      {mode === 'union' && (
        <>
          {!readOnly ? (
            <MemberTypesListEditor
              value={memberTypes}
              onChange={(next) => {
                setMemberTypes(next);
                onChange({ id: node.id, xmlMemberTypes: next });
              }}
              myTypeNames={Array.isArray(data.xmlMyTypeNames) ? data.xmlMyTypeNames : []}
              ariaPrefix="Union Member Types"
            />
          ) : (
            <div style={{ fontSize: 11, color: '#666' }}>Union member types are read-only in this ref expansion.</div>
          )}
          {Array.isArray(data.xmlUnionReferencedEnumerations) && data.xmlUnionReferencedEnumerations.length > 0 && (
            <ReferencedEnumerationList values={data.xmlUnionReferencedEnumerations} />
          )}
          {Array.isArray(data.xmlMemberSimpleTypes) && data.xmlMemberSimpleTypes.length > 0 && !readOnly && (
            <NamedSimpleTypeNestedMembersEditor
              memberSimpleTypes={data.xmlMemberSimpleTypes}
              onChange={handleUpdateMemberSimpleTypes}
            />
          )}
        </>
      )}

      {mode === 'list' && (
        <>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12 }}>itemType</span>
            <input
              aria-label="List Item Type"
              value={itemType}
              disabled={readOnly || Boolean(data.xmlItemSimpleType)}
              onChange={(e) => setItemType(e.target.value)}
              onBlur={() => onChange({ id: node.id, xmlItemType: itemType })}
              style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
              placeholder="xs:string"
            />
          </label>
          {!readOnly && !data.xmlItemSimpleType && (!itemType || itemType.startsWith('xs:')) && (
            <ListValuesEditor values={listValues} onChange={handleListValuesChange} ariaPrefix="SimpleType list" />
          )}
          {resolvedItemTypeNode && !readOnly && !data.xmlItemSimpleType && resolvedItemTypeNode.data?.xmlSimpleTypeMode && (
            <div style={{ background: 'var(--form-surface, #f9f5f0)', border: '1px solid var(--form-border, #e5d4c4)', borderRadius: 6, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--form-text, #5d4a3a)' }}>Referenced type: {itemType}</div>
              <InlineSimpleTypeEditor
                value={{
                  mode: resolvedItemTypeNode.data.xmlSimpleTypeMode,
                  base: resolvedItemTypeNode.data.xmlSimpleTypeBase,
                  enumerations: resolvedItemTypeNode.data.xmlEnumerationValues,
                  memberSimpleTypes: resolvedItemTypeNode.data.xmlMemberSimpleTypes,
                  itemSimpleType: resolvedItemTypeNode.data.xmlItemSimpleType,
                }}
                onChange={() => {}}
                depth={0}
                pathLabel="Referenced type structure"
              />
            </div>
          )}
          {!readOnly && (
            <label style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                aria-label="SimpleType has nested itemType"
                checked={Boolean(data.xmlItemSimpleType)}
                onChange={(e) => {
                  if (e.target.checked) handleUpdateItemSimpleType({ mode: 'restriction', base: 'xs:string', enumerations: [] });
                  else handleUpdateItemSimpleType(undefined);
                }}
              />
              <span style={{ fontSize: 12 }}>Anonymous item simpleType (instead of itemType)</span>
            </label>
          )}
          {data.xmlItemSimpleType && !readOnly && (
            <InlineSimpleTypeEditor
              value={data.xmlItemSimpleType}
              onChange={handleUpdateItemSimpleType}
              depth={0}
              pathLabel="SimpleType item"
            />
          )}
        </>
      )}
      <label style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={isRef}
          disabled={readOnly}
          onChange={(e) => {
            setIsRef(e.target.checked);
            onChange({ id: node.id, xmlIsRef: e.target.checked });
          }}
          aria-label="Global Reference"
          style={{ cursor: readOnly ? 'not-allowed' : 'pointer' }}
        />
        <span style={{ fontSize: 12 }}>Global Reference (ref)</span>
      </label>

      <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--graph-text)' }}>Elements</div>

      {showAnnotationEditor ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Annotation element</span>
            {!readOnly ? (
              <button
                type="button"
                title="Delete annotation element"
                onClick={() => {
                  onChange({ id: node.id, xmlAnnotation: undefined, xmlAnnotations: [] });
                  setShowAnnotationEditor(false);
                }}
                style={{
                  padding: '2px 6px',
                  borderRadius: 3,
                  border: '1px solid var(--graph-node-border, #4b5563)',
                  backgroundColor: 'var(--graph-node-bg-subtle, #1f2937)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'var(--graph-text, #e5e7eb)',
                }}
              >
                ✕
              </button>
            ) : null}
          </div>
          <XmlAnnotationFieldAuto nodeId={node.id} data={data} onChange={onChange} disabled={readOnly} />
        </div>
      ) : (
        !readOnly ? (
          <button
            type="button"
            onClick={() => setShowAnnotationEditor(true)}
            title="Add annotation element"
            style={{
              alignSelf: 'flex-start',
              padding: '4px 10px',
              borderRadius: 999,
              border: '1px solid var(--graph-node-border, #4b5563)',
              backgroundColor: 'var(--graph-node-bg-subtle, #1f2937)',
              color: 'var(--graph-text, #e5e7eb)',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              lineHeight: 1,
              textDecoration: 'none',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.04)',
            }}
          >
            <span>+</span>
            <span>xs:annotation</span>
          </button>
        ) : null
      )}
    </form>
  );
}
