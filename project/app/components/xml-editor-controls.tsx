import React from 'react';
import type { NodeData, PropertyFieldConfig } from './types';

function PropertyField({
  config,
  value,
  onChange,
  onBlur,
}: {
  config: PropertyFieldConfig;
  value: string | boolean;
  onChange: (val: string | boolean) => void;
  onBlur?: () => void;
}) {
  if (config.type === 'select' && config.options) {
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12 }}>{config.label}</span>
        <select
          aria-label={config.ariaLabel}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
        >
          {config.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (config.type === 'checkbox') {
    return (
      <label style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          aria-label={config.ariaLabel}
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          onBlur={onBlur}
          style={{ width: 18, height: 18, cursor: 'pointer' }}
        />
        <span style={{ fontSize: 12 }}>{config.label}</span>
      </label>
    );
  }

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12 }}>{config.label}</span>
      <input
        type="text"
        aria-label={config.ariaLabel}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
        placeholder={config.placeholder}
      />
    </label>
  );
}

export function PropertyForm({
  title,
  configs,
  nodeData,
  nodeId,
  onChange,
}: {
  title: string;
  configs: PropertyFieldConfig[];
  nodeData: Record<string, any>;
  nodeId: string;
  onChange: (patch: Partial<NodeData>) => void;
}) {
  const [values, setValues] = React.useState<Record<string, string | boolean>>({});

  React.useEffect(() => {
    const initial: Record<string, string | boolean> = {};
    configs.forEach((config) => {
      const val = nodeData[config.dataKey];
      if (config.type === 'checkbox') {
        initial[config.dataKey] = Boolean(val);
      } else {
        initial[config.dataKey] = String(val ?? config.defaultValue ?? '');
      }
    });
    setValues(initial);
  }, [nodeId, nodeData, configs]);

  const handleChange = (key: keyof NodeData, value: string | boolean) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleBlur = (key: keyof NodeData, value?: string | boolean) => {
    const finalValue = value !== undefined ? value : values[key];
    onChange({ id: nodeId, [key]: finalValue } as Partial<NodeData>);
  };

  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: 10 }} onSubmit={(e) => e.preventDefault()}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>{title}</div>
      {configs.map((config) => (
        <PropertyField
          key={String(config.dataKey)}
          config={config}
          value={values[config.dataKey] ?? config.defaultValue ?? ''}
          onChange={(val) => {
            handleChange(config.dataKey, val);
            if (config.type === 'select') {
              handleBlur(config.dataKey, val);
            }
          }}
          onBlur={() => handleBlur(config.dataKey)}
        />
      ))}
    </form>
  );
}

export function XmlReadOnlyHint({ source }: { source: string }) {
  return (
    <div style={{ background: '#fff7ed', border: '1px solid #f5c2b7', borderRadius: 6, padding: 10, color: '#92400e' }}>
      This node is a read-only expansion from <code>{source}</code>. Edit the original referenced definition instead.
    </div>
  );
}

function XmlAnnotationField({
  nodeId,
  value,
  onChange,
  disabled = false,
}: {
  nodeId: string;
  value: string;
  onChange: (patch: Partial<NodeData>) => void;
  disabled?: boolean;
}) {
  const [text, setText] = React.useState<string>(value);

  React.useEffect(() => {
    setText(value);
  }, [nodeId, value]);

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12 }}>Annotation</span>
      <textarea
        aria-label="Annotation"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { if (text !== value) onChange({ id: nodeId, xmlAnnotation: text } as Partial<NodeData>); }}
        rows={3}
        style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc', fontFamily: 'inherit', resize: 'vertical', background: disabled ? '#f5f5f5' : undefined }}
        placeholder="Documentation for this schema item"
      />
    </label>
  );
}

function XmlAnnotationFieldWithPaging({
  nodeId,
  values,
  onChange,
  disabled = false,
}: {
  nodeId: string;
  values: string[];
  onChange: (patch: Partial<NodeData>) => void;
  disabled?: boolean;
}) {
  const [currentIndex, setCurrentIndex] = React.useState<number>(0);
  const [texts, setTexts] = React.useState<string[]>(values);

  React.useEffect(() => {
    setTexts(values);
    if (currentIndex >= values.length && values.length > 0) {
      setCurrentIndex(0);
    }
  }, [nodeId, values]);

  const currentText = texts[currentIndex] || '';
  const hasMultiple = texts.length > 1;

  const handleChange = (text: string) => {
    const newTexts = [...texts];
    newTexts[currentIndex] = text;
    setTexts(newTexts);
  };

  const handleBlur = () => {
    if (JSON.stringify(texts) !== JSON.stringify(values)) {
      onChange({ id: nodeId, xmlAnnotations: texts } as Partial<NodeData>);
    }
  };

  const goToPrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const goToNext = () => {
    if (currentIndex < texts.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12 }}>Annotation</span>
        {hasMultiple && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#666' }}>
            <button
              type="button"
              onClick={goToPrevious}
              disabled={currentIndex === 0 || disabled}
              style={{
                background: 'none',
                border: 'none',
                padding: '2px 4px',
                cursor: currentIndex === 0 || disabled ? 'default' : 'pointer',
                color: currentIndex === 0 || disabled ? '#ccc' : '#666',
                fontSize: 16,
                lineHeight: 1,
              }}
              aria-label="Previous annotation"
              title="Previous annotation"
            >
              ←
            </button>
            <span style={{ minWidth: '24px', textAlign: 'center' }}>
              {currentIndex + 1}/{texts.length}
            </span>
            <button
              type="button"
              onClick={goToNext}
              disabled={currentIndex === texts.length - 1 || disabled}
              style={{
                background: 'none',
                border: 'none',
                padding: '2px 4px',
                cursor: currentIndex === texts.length - 1 || disabled ? 'default' : 'pointer',
                color: currentIndex === texts.length - 1 || disabled ? '#ccc' : '#666',
                fontSize: 16,
                lineHeight: 1,
              }}
              aria-label="Next annotation"
              title="Next annotation"
            >
              →
            </button>
          </div>
        )}
      </div>
      <textarea
        aria-label="Annotation"
        value={currentText}
        disabled={disabled}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        rows={3}
        style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc', fontFamily: 'inherit', resize: 'vertical', background: disabled ? '#f5f5f5' : undefined }}
        placeholder="Documentation for this schema item"
      />
    </label>
  );
}

export function XmlAnnotationFieldAuto({
  nodeId,
  data,
  onChange,
  disabled = false,
}: {
  nodeId: string;
  data: Record<string, any>;
  onChange: (patch: Partial<NodeData>) => void;
  disabled?: boolean;
}) {
  const annotations = Array.isArray(data.xmlAnnotations) ? data.xmlAnnotations :
    (data.xmlAnnotation ? [data.xmlAnnotation] : []);

  if (annotations.length > 1) {
    return <XmlAnnotationFieldWithPaging nodeId={nodeId} values={annotations} onChange={onChange} disabled={disabled} />;
  }

  return <XmlAnnotationField nodeId={nodeId} value={String(annotations[0] || '')} onChange={onChange} disabled={disabled} />;
}