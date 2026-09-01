import React from 'react';
import type { InlineSimpleTypeData, SimpleTypeFacets, XmlNodeRhsEditorProps } from './types';
import { XSD_BUILTIN_SIMPLE_TYPES } from '~/utils/xsd-types';

export function ReferencedEnumerationList({ values, typeName }: { values: string[]; typeName?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12 }}>
        Enumeration values {typeName ? <>(from <code>{typeName}</code>, read-only)</> : '(read-only)'}
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {values.map((value, index) => (
          <span
            key={index}
            aria-label={`Referenced enumeration value ${index + 1}`}
            style={{
              padding: '2px 8px',
              fontSize: 11,
              borderRadius: 3,
              border: '1px solid var(--color-neutral-6)',
              background: 'var(--color-neutral-3)',
              color: 'var(--color-neutral-12)',
            }}
          >
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}

const SIMPLE_TYPE_FACET_FIELDS: Array<[keyof SimpleTypeFacets, string]> = [
  ['pattern', 'Pattern'],
  ['minInclusive', 'Min Inclusive'],
  ['maxInclusive', 'Max Inclusive'],
  ['minLength', 'Min Length'],
  ['maxLength', 'Max Length'],
  ['totalDigits', 'Total Digits'],
  ['fractionDigits', 'Fraction Digits'],
  ['whiteSpace', 'White Space'],
];

export function FacetsEditor({
  facets,
  onChange,
  ariaPrefix,
}: {
  facets: SimpleTypeFacets | undefined;
  onChange: (next: SimpleTypeFacets) => void;
  ariaPrefix: string;
}) {
  const [expandedFacets, setExpandedFacets] = React.useState<Set<keyof SimpleTypeFacets>>(
    new Set(Object.keys(facets || {}) as Array<keyof SimpleTypeFacets>)
  );

  React.useEffect(() => {
    setExpandedFacets(new Set(Object.keys(facets || {}) as Array<keyof SimpleTypeFacets>));
  }, [facets]);

  const handleFieldChange = (key: keyof SimpleTypeFacets, value: string) => {
    const next = { ...(facets || {}) };
    if (value) next[key] = value;
    else delete next[key];
    onChange(next);
  };

  const toggleFacet = (key: keyof SimpleTypeFacets) => {
    const newExpanded = new Set(expandedFacets);
    if (newExpanded.has(key)) newExpanded.delete(key);
    else newExpanded.add(key);
    setExpandedFacets(newExpanded);
  };

  const deleteFacet = (key: keyof SimpleTypeFacets) => {
    handleFieldChange(key, '');
    const newExpanded = new Set(expandedFacets);
    newExpanded.delete(key);
    setExpandedFacets(newExpanded);
  };

  const definedFacets = Object.keys(facets || {}) as Array<keyof SimpleTypeFacets>;
  const undefinedFacets = SIMPLE_TYPE_FACET_FIELDS.filter(([key]) => !definedFacets.includes(key) && !expandedFacets.has(key)).map(([key]) => key);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 500 }}>Facets</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {SIMPLE_TYPE_FACET_FIELDS.map(([key, label]) => {
          const isDefined = key in (facets || {});
          const isExpanded = expandedFacets.has(key);
          if (!isDefined && !isExpanded) return null;

          return (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 11, minWidth: 80 }}>{label}</span>
              </div>
              <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                <input
                  type="text"
                  aria-label={`${ariaPrefix} ${label}`}
                  value={facets?.[key] ?? ''}
                  onChange={(e) => handleFieldChange(key, e.target.value)}
                  placeholder={isDefined ? undefined : 'Enter value...'}
                  style={{ padding: 4, borderRadius: 3, border: '1px solid #ddd', fontSize: 11, flex: 1 }}
                />
                {isDefined && (
                  <button
                    type="button"
                    onClick={() => deleteFacet(key)}
                    title="Delete facet"
                    style={{
                      padding: '2px 6px',
                      borderRadius: 3,
                      border: '1px solid #ccc',
                      backgroundColor: '#f5f5f5',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 500,
                      color: '#666',
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {undefinedFacets.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {undefinedFacets.map((key) => {
            const label = SIMPLE_TYPE_FACET_FIELDS.find(([k]) => k === key)?.[1] || '';
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleFacet(key)}
                title={`Add ${label} facet`}
                style={{ padding: '3px 8px', borderRadius: 12, border: '1px solid #ddd', backgroundColor: '#f9f9f9', cursor: 'pointer', fontSize: 11, fontWeight: 500, color: '#666', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
              >
                <span>+</span>
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function EnumerationListEditor({
  values,
  onChange,
  ariaPrefix,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  ariaPrefix: string;
}) {
  const [newValue, setNewValue] = React.useState('');

  const handleAdd = () => {
    if (!newValue.trim()) return;
    onChange([...values, newValue]);
    setNewValue('');
  };
  const handleUpdate = (index: number, value: string) => {
    const next = [...values];
    next[index] = value;
    onChange(next);
  };
  const handleRemove = (index: number) => onChange(values.filter((_, i) => i !== index));
  const handleMove = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= values.length) return;
    const next = [...values];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 500 }}>Enumeration values</span>
      {values.length === 0 && <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>No values yet.</div>}
      {values.map((value, index) => (
        <div key={index} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="text" aria-label={`${ariaPrefix} value ${index + 1}`} value={value} onChange={(e) => handleUpdate(index, e.target.value)} style={{ flex: 1, padding: 4, borderRadius: 3, border: '1px solid #ddd', fontSize: 11 }} />
          <button type="button" aria-label={`${ariaPrefix} move up ${index + 1}`} disabled={index === 0} onClick={() => handleMove(index, -1)} style={{ padding: '2px 6px', fontSize: 11, cursor: index === 0 ? 'not-allowed' : 'pointer' }}>↑</button>
          <button type="button" aria-label={`${ariaPrefix} move down ${index + 1}`} disabled={index === values.length - 1} onClick={() => handleMove(index, 1)} style={{ padding: '2px 6px', fontSize: 11, cursor: index === values.length - 1 ? 'not-allowed' : 'pointer' }}>↓</button>
          <button type="button" aria-label={`${ariaPrefix} remove ${index + 1}`} onClick={() => handleRemove(index)} style={{ padding: '2px 8px', fontSize: 11, backgroundColor: '#fee', color: '#c33', border: '1px solid #fcc', borderRadius: 3, cursor: 'pointer' }}>Remove</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 4 }}>
        <input type="text" aria-label={`${ariaPrefix} new value`} value={newValue} onChange={(e) => setNewValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAdd()} placeholder="New enumeration value" style={{ flex: 1, padding: 4, borderRadius: 3, border: '1px solid #ddd', fontSize: 11 }} />
        <button type="button" onClick={handleAdd} disabled={!newValue.trim()} style={{ padding: '2px 8px', fontSize: 11, backgroundColor: newValue.trim() ? '#e8f5e9' : '#f0f0f0', color: newValue.trim() ? '#2e7d32' : '#999', border: '1px solid #c8e6c9', borderRadius: 3, cursor: newValue.trim() ? 'pointer' : 'not-allowed' }}>Add</button>
      </div>
    </div>
  );
}

export function ListValuesEditor({
  values,
  onChange,
  ariaPrefix,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  ariaPrefix: string;
}) {
  const [newValue, setNewValue] = React.useState('');

  const handleAdd = () => {
    if (!newValue.trim()) return;
    onChange([...values, newValue]);
    setNewValue('');
  };
  const handleUpdate = (index: number, value: string) => {
    const next = [...values];
    next[index] = value;
    onChange(next);
  };
  const handleRemove = (index: number) => onChange(values.filter((_, i) => i !== index));
  const handleMove = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= values.length) return;
    const next = [...values];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 500 }}>List values</span>
      {values.length === 0 && <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>No values yet.</div>}
      {values.map((value, index) => (
        <div key={index} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="text" aria-label={`${ariaPrefix} value ${index + 1}`} value={value} onChange={(e) => handleUpdate(index, e.target.value)} style={{ flex: 1, padding: 4, borderRadius: 3, border: '1px solid #ddd', fontSize: 11 }} />
          <button type="button" aria-label={`${ariaPrefix} move up ${index + 1}`} disabled={index === 0} onClick={() => handleMove(index, -1)} style={{ padding: '2px 6px', fontSize: 11, cursor: index === 0 ? 'not-allowed' : 'pointer' }}>↑</button>
          <button type="button" aria-label={`${ariaPrefix} move down ${index + 1}`} disabled={index === values.length - 1} onClick={() => handleMove(index, 1)} style={{ padding: '2px 6px', fontSize: 11, cursor: index === values.length - 1 ? 'not-allowed' : 'pointer' }}>↓</button>
          <button type="button" aria-label={`${ariaPrefix} remove ${index + 1}`} onClick={() => handleRemove(index)} style={{ padding: '2px 8px', fontSize: 11, backgroundColor: '#fee', color: '#c33', border: '1px solid #fcc', borderRadius: 3, cursor: 'pointer' }}>Remove</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 4 }}>
        <input type="text" aria-label={`${ariaPrefix} new value`} value={newValue} onChange={(e) => setNewValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAdd()} placeholder="New list value" style={{ flex: 1, padding: 4, borderRadius: 3, border: '1px solid #ddd', fontSize: 11 }} />
        <button type="button" onClick={handleAdd} disabled={!newValue.trim()} style={{ padding: '2px 8px', fontSize: 11, backgroundColor: newValue.trim() ? '#e8f5e9' : '#f0f0f0', color: newValue.trim() ? '#2e7d32' : '#999', border: '1px solid #c8e6c9', borderRadius: 3, cursor: newValue.trim() ? 'pointer' : 'not-allowed' }}>Add</button>
      </div>
    </div>
  );
}

export function InlineSimpleTypeEditor({
  value,
  onChange,
  depth = 0,
  pathLabel = 'SimpleType',
}: {
  value: InlineSimpleTypeData;
  onChange: (next: InlineSimpleTypeData) => void;
  depth?: number;
  pathLabel?: string;
}) {
  const mode = value.mode;

  const handleModeChange = (nextMode: 'restriction' | 'union' | 'list') => {
    if (nextMode === mode) return;
    if (nextMode === 'restriction') onChange({ mode: 'restriction', base: value.base || 'xs:string', enumerations: value.enumerations || [] });
    else if (nextMode === 'union') onChange({ mode: 'union', memberTypes: value.memberTypes || '', memberSimpleTypes: value.memberSimpleTypes || [] });
    else onChange({ mode: 'list', itemType: value.itemType || 'xs:string', itemSimpleType: value.itemSimpleType });
  };

  const handleAddMember = () => {
    const members = value.memberSimpleTypes || [];
    onChange({ ...value, memberSimpleTypes: [...members, { mode: 'restriction', base: 'xs:string', enumerations: [] }] });
  };
  const handleRemoveMember = (index: number) => {
    const members = value.memberSimpleTypes || [];
    onChange({ ...value, memberSimpleTypes: members.filter((_, i) => i !== index) });
  };
  const handleUpdateMember = (index: number, next: InlineSimpleTypeData) => {
    const members = [...(value.memberSimpleTypes || [])];
    members[index] = next;
    onChange({ ...value, memberSimpleTypes: members });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8, marginLeft: depth * 10, border: '1px solid var(--color-neutral-6)', borderRadius: 6, background: depth % 2 === 1 ? 'var(--color-neutral-3)' : 'var(--color-neutral-2)', color: 'var(--color-neutral-12)' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>{pathLabel} Mode</span>
        <select aria-label={`${pathLabel} Mode`} value={mode} onChange={(e) => handleModeChange(e.target.value as 'restriction' | 'union' | 'list')} style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}>
          <option value="restriction">restriction</option>
          <option value="union">union</option>
          <option value="list">list</option>
        </select>
      </label>

      {mode === 'restriction' && (
        <>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12 }}>Base</span>
            <input aria-label={`${pathLabel} Restriction Base`} value={value.base || ''} onChange={(e) => onChange({ ...value, base: e.target.value })} style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }} placeholder="xs:string" />
          </label>
          <EnumerationListEditor values={value.enumerations || []} onChange={(next) => onChange({ ...value, enumerations: next })} ariaPrefix={`${pathLabel} enumeration`} />
          <FacetsEditor facets={value.facets} onChange={(next) => onChange({ ...value, facets: next })} ariaPrefix={`${pathLabel} facet`} />
        </>
      )}

      {mode === 'union' && (
        <>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12 }}>memberTypes (named types)</span>
            <input aria-label={`${pathLabel} Union Member Types`} value={value.memberTypes || ''} onChange={(e) => onChange({ ...value, memberTypes: e.target.value })} style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }} placeholder="xs:string tns:OtherType" />
          </label>
          {Array.isArray(value.unionReferencedEnumerations) && value.unionReferencedEnumerations.length > 0 && <ReferencedEnumerationList values={value.unionReferencedEnumerations} />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 500 }}>Anonymous member simpleTypes</span>
            {(value.memberSimpleTypes || []).map((member, index) => (
              <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="button" aria-label={`${pathLabel} remove member ${index + 1}`} onClick={() => handleRemoveMember(index)} style={{ padding: '2px 8px', fontSize: 11, backgroundColor: '#fee', color: '#c33', border: '1px solid #fcc', borderRadius: 3, cursor: 'pointer' }}>Remove member</button>
                </div>
                <InlineSimpleTypeEditor value={member} onChange={(next) => handleUpdateMember(index, next)} depth={depth + 1} pathLabel={`${pathLabel} member ${index + 1}`} />
              </div>
            ))}
            <button type="button" onClick={handleAddMember} style={{ padding: '4px 8px', fontSize: 11, backgroundColor: '#e8f5e9', color: '#2e7d32', border: '1px solid #c8e6c9', borderRadius: 3, cursor: 'pointer', alignSelf: 'flex-start' }}>Add member simpleType</button>
          </div>
        </>
      )}

      {mode === 'list' && (
        <>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12 }}>itemType (named type)</span>
            <input aria-label={`${pathLabel} List Item Type`} value={value.itemType || ''} onChange={(e) => onChange({ ...value, itemType: e.target.value })} style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }} placeholder="xs:string" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" aria-label={`${pathLabel} has nested simpleType`} checked={Boolean(value.itemSimpleType)} onChange={(e) => { if (e.target.checked) onChange({ ...value, itemSimpleType: { mode: 'restriction', base: 'xs:string', enumerations: [] } }); else onChange({ ...value, itemSimpleType: undefined }); }} />
            <span style={{ fontSize: 12 }}>Anonymous item simpleType (instead of itemType)</span>
          </label>
          {value.itemSimpleType && <InlineSimpleTypeEditor value={value.itemSimpleType} onChange={(next) => onChange({ ...value, itemSimpleType: next })} depth={depth + 1} pathLabel={`${pathLabel} item`} />}
        </>
      )}
    </div>
  );
}

export function NamedSimpleTypeNestedMembersEditor({
  memberSimpleTypes,
  onChange,
}: {
  memberSimpleTypes: InlineSimpleTypeData[];
  onChange: (next: InlineSimpleTypeData[]) => void;
}) {
  const handleAddMember = () => {
    onChange([...memberSimpleTypes, { mode: 'restriction', base: 'xs:string', enumerations: [] }]);
  };

  const handleRemoveMember = (index: number) => {
    onChange(memberSimpleTypes.filter((_, i) => i !== index));
  };

  const handleUpdateMember = (index: number, next: InlineSimpleTypeData) => {
    const updated = [...memberSimpleTypes];
    updated[index] = next;
    onChange(updated);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 500 }}>Anonymous member simpleTypes</span>
      {memberSimpleTypes.map((member, index) => (
        <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              aria-label={`SimpleType remove member ${index + 1}`}
              onClick={() => handleRemoveMember(index)}
              style={{ padding: '2px 8px', fontSize: 11, backgroundColor: '#fee', color: '#c33', border: '1px solid #fcc', borderRadius: 3, cursor: 'pointer' }}
            >
              Remove member
            </button>
          </div>
          <InlineSimpleTypeEditor
            value={member}
            onChange={(next) => handleUpdateMember(index, next)}
            depth={0}
            pathLabel={`SimpleType member ${index + 1}`}
          />
        </div>
      ))}
      <button
        type="button"
        onClick={handleAddMember}
        style={{ padding: '4px 8px', fontSize: 11, backgroundColor: '#e8f5e9', color: '#2e7d32', border: '1px solid #c8e6c9', borderRadius: 3, cursor: 'pointer', alignSelf: 'flex-start' }}
      >
        Add member simpleType
      </button>
    </div>
  );
}

export function XmlTypeSelector({
  value,
  onChange,
  myTypeNames,
  ariaLabel,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  myTypeNames: string[];
  ariaLabel: string;
  disabled?: boolean;
}) {
  const isKnownValue = (v: string) => v === '' || XSD_BUILTIN_SIMPLE_TYPES.includes(v) || myTypeNames.includes(v);
  const [isCustom, setIsCustom] = React.useState(!isKnownValue(value));
  const [customText, setCustomText] = React.useState(value);

  React.useEffect(() => {
    setIsCustom(!isKnownValue(value));
    setCustomText(value);
  }, [value, myTypeNames.join('\u0000')]);

  if (isCustom) {
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        <input aria-label={ariaLabel} value={customText} disabled={disabled} onChange={(e) => setCustomText(e.target.value)} onBlur={() => onChange(customText)} style={{ flex: 1, padding: 6, borderRadius: 6, border: '1px solid #ccc' }} placeholder="xs:string" />
        <button type="button" aria-label={`${ariaLabel} use list`} disabled={disabled} onClick={() => setIsCustom(false)} style={{ padding: '4px 8px', fontSize: 11, cursor: disabled ? 'not-allowed' : 'pointer' }}>List</button>
      </div>
    );
  }

  return (
    <select aria-label={ariaLabel} value={value} disabled={disabled} onChange={(e) => { if (e.target.value === '__custom__') { setIsCustom(true); setCustomText(''); return; } onChange(e.target.value); }} style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}>
      <option value="">(none)</option>
      <optgroup label="Simple">
        {XSD_BUILTIN_SIMPLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </optgroup>
      {myTypeNames.length > 0 && (
        <optgroup label="My Types">
          {myTypeNames.map((t) => <option key={t} value={t}>{t}</option>)}
        </optgroup>
      )}
      <option value="__custom__">Custom…</option>
    </select>
  );
}

export function MemberTypesListEditor({
  value,
  onChange,
  myTypeNames,
  ariaPrefix,
}: {
  value: string;
  onChange: (next: string) => void;
  myTypeNames: string[];
  ariaPrefix: string;
}) {
  const members = value.trim() ? value.trim().split(/\s+/) : [];
  const emit = (next: string[]) => onChange(next.join(' '));

  const handleUpdate = (index: number, next: string) => {
    const updated = [...members];
    updated[index] = next;
    emit(updated);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 500 }}>memberTypes</span>
      {members.length === 0 && <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>No member types yet.</div>}
      {members.map((member, index) => (
        <div key={index} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <XmlTypeSelector value={member} onChange={(next) => handleUpdate(index, next)} myTypeNames={myTypeNames} ariaLabel={`${ariaPrefix} member ${index + 1}`} />
          </div>
          <button type="button" aria-label={`${ariaPrefix} remove member ${index + 1}`} onClick={() => emit(members.filter((_, i) => i !== index))} style={{ padding: '4px 8px', fontSize: 11, backgroundColor: '#fee', color: '#c33', border: '1px solid #fcc', borderRadius: 3, cursor: 'pointer' }}>Remove</button>
        </div>
      ))}
      <button type="button" aria-label={`${ariaPrefix} add member`} onClick={() => emit([...members, myTypeNames[0] || 'xs:string'])} style={{ padding: '4px 8px', fontSize: 11, backgroundColor: '#e8f5e9', color: '#2e7d32', border: '1px solid #c8e6c9', borderRadius: 3, cursor: 'pointer', alignSelf: 'flex-start' }}>+ Add</button>
    </div>
  );
}
