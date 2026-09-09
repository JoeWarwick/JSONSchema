import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip/tooltip';
import { renderTooltipContentChildren } from './tooltip-utils';
import type { XmlSchemaElementEditorProps } from './xml-schema-form.types';
import {
  displayValue,
  readAnnotationDocs,
  upsertElementAnnotation,
} from './xml-schema-form.utils';

export function XmlSchemaElementEditor({
  elements,
  rootSchema,
  expandedPaths,
  togglePathExpansion,
  onChange,
}: XmlSchemaElementEditorProps) {
  return (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #eee' }}>
      <h4 style={{ margin: '0 0 12px 0', fontSize: 13 }}>Element Children</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {elements.map((element, index) => {
          const elementName = displayValue(element['@name'], `Element ${index}`);
          const elementType = displayValue(element['@type'], '');
          const inlineComplexType = element['xs:complexType'];
          const hasInlineComplexType = Array.isArray(inlineComplexType)
            ? inlineComplexType.length > 0
            : Boolean(inlineComplexType && typeof inlineComplexType === 'object');
          const minOccurs = displayValue(element['@minOccurs'], '1');
          const maxOccurs = displayValue(element['@maxOccurs'], '1');
          const elementPath = `element-${index}`;
          const annotationPath = `${elementPath}-annotation`;
          const isExpanded = expandedPaths.has(elementPath);
          const annotationDocs = readAnnotationDocs(element);
          const annotationText = annotationDocs.join('\n\n');
          const hasAnnotation = annotationDocs.length > 0;
          const annotationExpanded = expandedPaths.has(annotationPath);

          return (
            <div key={index} style={{ border: '1px solid #e0e0e0', borderRadius: 4, overflow: 'hidden' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', backgroundColor: '#f9f9f9', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => togglePathExpansion(elementPath)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                  <span style={{ fontSize: 14 }}>{isExpanded ? '▼' : '▶'}</span>
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>{elementName}</span>
                    {elementType && <span style={{ fontSize: 11, color: '#666', marginLeft: 8 }}>{elementType}</span>}
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!isExpanded) togglePathExpansion(elementPath);
                          togglePathExpansion(annotationPath);
                        }}
                        style={{ border: hasAnnotation ? '1px solid #c5cae9' : '1px dashed #d6d6d6', backgroundColor: hasAnnotation ? '#e8eaf6' : '#f5f5f5', color: hasAnnotation ? '#283593' : '#666', borderRadius: 10, padding: '2px 8px', fontSize: 10, fontWeight: hasAnnotation ? 700 : 600, cursor: 'pointer' }}
                        aria-label="Toggle annotation"
                      >
                        {annotationDocs.length > 1 ? `annotation (${annotationDocs.length})` : 'annotation'}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {hasAnnotation ? renderTooltipContentChildren(annotationText) : 'No annotation. Click to add.'}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div style={{ fontSize: 11, color: '#999', whiteSpace: 'nowrap' }}>{minOccurs}..{maxOccurs}</div>
              </div>

              {isExpanded && (
                <div style={{ padding: '12px', backgroundColor: 'white', borderTop: '1px solid #eee' }}>
                  {hasInlineComplexType && !elementType ? (
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 11, display: 'block', marginBottom: 4, fontWeight: 600 }}>Element Type</label>
                      <div style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 3, fontSize: 12, backgroundColor: '#f8f9fa', color: '#495057', fontWeight: 600 }}>inline xs:complexType</div>
                    </div>
                  ) : (
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 11, display: 'block', marginBottom: 4, fontWeight: 600 }}>Element Type</label>
                      <input
                        type="text"
                        value={elementType || ''}
                        onChange={(event) => {
                          const updated = [...elements];
                          updated[index] = { ...updated[index], '@type': event.target.value };
                          onChange(updated);
                        }}
                        placeholder="e.g., xs:string"
                        style={{ width: '100%', padding: '4px 8px', border: '1px solid #ddd', borderRadius: 3, fontSize: 12 }}
                      />
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                    <div>
                      <label style={{ fontSize: 11, display: 'block', marginBottom: 4, fontWeight: 600 }}>minOccurs</label>
                      <input
                        type="number"
                        min="0"
                        value={minOccurs}
                        onChange={(event) => {
                          const updated = [...elements];
                          updated[index] = { ...updated[index], '@minOccurs': event.target.value };
                          onChange(updated);
                        }}
                        placeholder="1"
                        style={{ width: '100%', padding: '4px 8px', border: '1px solid #ddd', borderRadius: 3, fontSize: 12 }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, display: 'block', marginBottom: 4, fontWeight: 600 }}>maxOccurs</label>
                      <input
                        type="text"
                        value={maxOccurs}
                        onChange={(event) => {
                          const updated = [...elements];
                          updated[index] = { ...updated[index], '@maxOccurs': event.target.value };
                          onChange(updated);
                        }}
                        placeholder="1 or unbounded"
                        style={{ width: '100%', padding: '4px 8px', border: '1px solid #ddd', borderRadius: 3, fontSize: 12 }}
                      />
                    </div>
                  </div>

                  {annotationExpanded && (
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 11, display: 'block', marginBottom: 4, fontWeight: 600 }}>xs:annotation/xs:documentation</label>
                      <textarea
                        value={annotationText}
                        onChange={(event) => {
                          const updated = [...elements];
                          updated[index] = upsertElementAnnotation(updated[index], event.target.value);
                          onChange(updated);
                        }}
                        placeholder="Add annotation text"
                        rows={3}
                        style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 3, fontSize: 12, resize: 'vertical' }}
                      />
                    </div>
                  )}

                  {elementType && elementType.startsWith('xs:') === false && rootSchema && (
                    <div style={{ fontSize: 11, color: '#666', padding: '8px', backgroundColor: '#f0f0f0', borderRadius: 3 }}>
                      Custom type "{elementType}" can be edited in its definition
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}