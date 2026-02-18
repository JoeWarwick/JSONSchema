import { useState, useEffect } from "react";
import { validateValueAgainstSchema } from "../utils/validation";
import {
  addPropertyToSchema,
  removePropertyFromSchema,
  updateNestedPropertyInSchema,
  addPatternPropertyToSchema,
  removePatternPropertyFromSchema,
  updatePatternPropertyInSchema,
  renamePatternPropertyInSchema
} from "./schema-behaviors";
import { validateSchema } from "../utils/schema-generator";
import styles from "./schema-editor-form.module.css";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "./ui/tooltip/tooltip";
import { Badge } from "./ui/badge/badge";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover/popover";
import { renderTooltipContentChildren } from './tooltip-utils';
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";

import Select from "react-select";
import CreatableSelect from "react-select/creatable";

interface SchemaEditorFormProps {
  schema: Record<string, unknown>;
  onChange: (schema: Record<string, unknown>) => void;
  isSchemaImported?: (schema: Record<string, unknown>, path?: string[]) => boolean;
  instanceData?: unknown;
  path?: string[];
  onViewSource?: () => void;
  onPropertyRename?: (oldName: string, newName: string, path?: string[]) => void;
  onResolve?: (path: string[]) => Promise<void>;
}

import { generateSchema } from "../utils/schema-generator";
import { getVariantLabel } from "../utils/labels";
import { RegexInput } from "./RegexInput";

export function SchemaEditorForm({ 
  schema, 
  onChange, 
  path = [], 
  onPropertyRename, 
  isSchemaImported, 
  instanceData,
  onViewSource,
  onResolve
}: SchemaEditorFormProps) {
  const [validationError, setValidationError] = useState<string | null>(null);
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const [editingDefault, setEditingDefault] = useState<string>(String(schema?.default ?? ""));

  // Popover state for editing additionalProperties out-of-flow
  const [apPopoverOpen, setApPopoverOpen] = useState(false);
  // Guard to ensure the floating popover is only mounted after an explicit user action
  const [apPopoverAllowed, setApPopoverAllowed] = useState(false);
  const [localAdditionalSchema, setLocalAdditionalSchema] = useState<Record<string, unknown> | null>(schema.additionalProperties && typeof schema.additionalProperties === 'object' ? (schema.additionalProperties as Record<string, unknown>) : null);
  const [isResolving, setIsResolving] = useState(false);

  // Inferences for UI state
  const checkImported = (s: any, p?: string[]) => {
    if (isSchemaImported) return !!isSchemaImported(s, p);
    return !!(s.$ref || s.__from || (Array.isArray(s.allOf) && s.allOf.some((e: any) => e && (e.$ref || e.__from))));
  };

  const isImported = checkImported(schema, path);
  const isRoot = path.length === 0;

  const itemsSchema = (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items))
    ? (schema.items as Record<string, unknown>)
    : null;
  
  const isItemsImported = itemsSchema ? checkImported(itemsSchema, [...path, 'items']) : false;
  const [itemsExpanded, setItemsExpanded] = useState(!isItemsImported);
  const [isResolvingItems, setIsResolvingItems] = useState(false);

  // Initialize local draft when the popover is opened programmatically
  useEffect(() => {
    if (apPopoverOpen) {
      setLocalAdditionalSchema(schema.additionalProperties && typeof schema.additionalProperties === 'object' ? (schema.additionalProperties as Record<string, unknown>) : {});
    }
  }, [apPopoverOpen, schema.additionalProperties]);

  // When a user action has allowed the popover, open it only after the parent schema contains an additionalProperties object
  useEffect(() => {
    if (apPopoverAllowed && schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      setApPopoverOpen(true);
    }
  }, [apPopoverAllowed, schema.additionalProperties]);

  // Extra guard: never allow the popover to remain open unless the user explicitly allowed it
  useEffect(() => {
    if (apPopoverOpen && !apPopoverAllowed) {
      setApPopoverOpen(false);
    }
  }, [apPopoverOpen, apPopoverAllowed]);

  useEffect(() => {
    setEditingDefault(String(schema?.default ?? ""));
  }, [schema?.default]);

  // Keep localAdditionalSchema in sync when parent schema changes externally
  useEffect(() => {
    setLocalAdditionalSchema(schema.additionalProperties && typeof schema.additionalProperties === 'object' ? (schema.additionalProperties as Record<string, unknown>) : null);
  }, [schema.additionalProperties]);

  if (!schema) return null;

  const variants = (schema.oneOf || schema.anyOf || schema.allOf) as Record<string, unknown>[] | undefined;
  const logicType = schema.oneOf ? 'oneOf' : (schema.anyOf ? 'anyOf' : (schema.allOf ? 'allOf' : undefined));

  const updateSchema = (updates: Partial<Record<string, unknown>>) => {
    let nextSchema: Record<string, unknown>;

    // 1. Logic Transition Cleanup:
    // If we're adding a logic type (oneOf/anyOf/allOf), we must clear any conflicting primary type
    const isAddingLogic = !!(updates.oneOf || updates.anyOf || updates.allOf || updates.oneOnly);
    
    // 2. Swapping between array and object (existing logic)
    if (updates.type === "array" && schema.type === "object") {
      const rest = { ...schema };
      delete (rest as any).type;
      nextSchema = { type: "array", items: { type: "object", ...rest } };
    }
    else if (updates.type === "object" && schema.type === "array" && schema.items) {
      const items = schema.items as Record<string, unknown>;
      if (Array.isArray(items)) {
        const properties: Record<string, unknown> = {};
        items.forEach((item, index) => {
          properties[`property${index}`] = item;
        });
        nextSchema = { type: "object", properties };
      } else {
        nextSchema = { ...items, type: "object" };
      }
    }
    else {
      // General merge
      nextSchema = { ...schema, ...updates };
      
      // If we now have logic choices, the root 'type' is usually invalid/redundant
      if (isAddingLogic) {
        delete (nextSchema as any).type;
      }
      
      // Conversely, if we explicitly set a 'type', we should usually clear logic choices
      // (switching FROM polymorphic TO simple)
      if (updates.type && !isAddingLogic) {
        delete (nextSchema as any).oneOf;
        delete (nextSchema as any).anyOf;
        delete (nextSchema as any).allOf;
        delete (nextSchema as any).oneOnly;
      }
    }

    const error = validateSchema(nextSchema);
    setValidationError(error);
    if (!error && JSON.stringify(nextSchema) !== JSON.stringify(schema)) {
      onChange(nextSchema);
    }
  };

  const toggleEnum = (enabled: boolean) => {
    if (enabled) {
      // Pick up values to reuse from default or existing enum
      let existing: any[] | null = null;
      if (Array.isArray(schema.enum)) existing = schema.enum;
      else if (schema.items && typeof schema.items === 'object' && Array.isArray((schema.items as any).enum)) existing = (schema.items as any).enum;
      else if (Array.isArray(schema.default)) existing = schema.default;

      if (renderType === "array") {
        const currentItems = schema.items && typeof schema.items === "object" ? (schema.items as any) : {};
        const items = { 
          type: currentItems.type || "string",
          ...currentItems
        };
        items.enum = existing || ["option1", "option2", "option3"];
        updateSchema({ items });
      } else {
        const type = schema.type as string || "string";
        const defaultValues = existing || (type === "number" ? [1, 2, 3] : ["option1", "option2", "option3"]);
        updateSchema({ enum: defaultValues });
      }
    } else {
      // Disable enum
      const newSchema = { ...schema };
      delete newSchema.enum;
      if (newSchema.items && typeof newSchema.items === "object") {
        const newItems = { ...(newSchema.items as any) };
        delete newItems.enum;
        newSchema.items = newItems;
      }
      onChange(newSchema);
    }
  };

  const updateNestedProperty = (propertyName: string, newValue: Record<string, unknown>) => {
    const nextSchema = updateNestedPropertyInSchema(schema, propertyName, newValue);
    updateSchema(nextSchema as any);
  };

  // Infer root type for display when loading schemas that use $ref/$defs
  const inferredRootType = (() => {
    if (schema.type) return (Array.isArray(schema.type) ? schema.type[0] : schema.type) as string;
    
    // If it has enum, it's more likely a primitive with constraints than a structural container
    if (schema.enum) {
      const first = Array.isArray(schema.enum) ? schema.enum[0] : null;
      if (typeof first === 'number') return 'number';
      if (typeof first === 'boolean') return 'boolean';
      return 'string';
    }

    if (schema.properties) return 'object';
    if (schema.items) return 'array';
    if (schema.oneOf || schema.anyOf || schema.allOf || schema.oneOnly) return 'object'; // logical container
    
    if (schema.$ref && (schema.$defs || schema.definitions) && typeof schema.$ref === 'string') {
      const defsKey = schema.$defs ? '$defs' : 'definitions';
      const defs = (schema.$defs || schema.definitions) as any;
      const key = (schema.$ref as string).replace(`#/${defsKey}/`, '');
      const def = defs[key];
      if (def) {
        if (def.type) return (Array.isArray(def.type) ? def.type[0] : def.type) as string;
        if (def.properties) return 'object';
        if (def.items) return 'array';
      }
    }
    // If schema only contains $defs (no top-level $ref/type/properties), hoist the first def for display
    const defsKey = schema.$defs ? '$defs' : (schema.definitions ? 'definitions' : null);
    if (!schema.type && !schema.properties && defsKey) {
      const defs = (schema as any)[defsKey];
      const keys = Object.keys(defs);
      if (keys.length > 0) {
        const def = defs[keys[0]];
        if (def) {
          if (def.type) return (Array.isArray(def.type) ? def.type[0] : def.type) as string;
          if (def.properties) return 'object';
          if (def.items) return 'array';
        }
      }
    }
    return null;
  })();
  const renderType = (schema.type as string) ?? inferredRootType ?? (path.length === 0 ? 'object' : null);
  const activeType = (() => {
    if (schema.format === 'data-url' || (schema.contentMediaType && String(schema.contentMediaType).startsWith('image'))) return 'image';
    if (renderType === 'array' && (schema.items as any)?.enum) return 'string';
    const isArrayItem = path[path.length - 1] === 'items';
    return renderType || (path.length === 0 ? 'object' : (isImported || isArrayItem ? null : 'string'));
  })();
  
  const addProperty = () => {
    const nextSchema = addPropertyToSchema(schema);
    updateSchema(nextSchema as any);
  };

  const toggleRequired = (propertyName: string) => {
    const required = (schema.required as string[]) || [];
    const isRequired = required.includes(propertyName);

    const newRequired = isRequired ? required.filter((r) => r !== propertyName) : [...required, propertyName];

    updateSchema({
      required: newRequired.length > 0 ? newRequired : undefined,
    });
  };

  const updatePropertyName = (oldName: string, newName: string) => {
    if (oldName === newName) return;

    const properties = { ...(schema.properties as Record<string, unknown>) };
    const propertyValue = properties[oldName];
    delete properties[oldName];
    properties[newName] = propertyValue;

    const required = (schema.required as string[]) || [];
    const newRequired = required.map((r) => (r === oldName ? newName : r));

    updateSchema({
      properties,
      required: newRequired.length > 0 ? newRequired : undefined,
    });
    if (onPropertyRename) {
      onPropertyRename(oldName, newName, path);
    }
  };

  const handleDeleteProperty = (propertyName: string) => {
    const nextSchema = removePropertyFromSchema(schema, propertyName);
    updateSchema(nextSchema as any);
  };

  const patternProperties = schema.patternProperties as Record<string, unknown> | undefined;

  return (
    <>
      {validationError && (
        <div style={{ color: 'red', marginBottom: 8 }}>{validationError}</div>
      )}
      <div className={styles.container}>
        {isRoot && !renderType && !variants && (
          <div style={{ marginBottom: 16, padding: '12px 16px', background: 'var(--color-primary-1)', border: '1px solid var(--color-primary-6)', borderRadius: 8, color: 'var(--color-primary-11)', fontSize: 13, fontWeight: 500 }}>
            Root node is unconfigured. Please select <strong>Object</strong> or <strong>Array</strong> to begin.
          </div>
        )}
        
        {isImported && !renderType && (
          <div style={{ marginBottom: 16, padding: '12px 16px', background: 'var(--color-accent-2)', border: '1px solid var(--color-accent-6)', borderRadius: 8, color: 'var(--color-accent-12)', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
              <button
                type="button"
                className={styles.toggleButton}
                onClick={async () => {
                  setIsResolving(true);
                  try { if (onResolve) await onResolve(path); } finally { setIsResolving(false); }
                }}
                style={{ background: 'var(--color-accent-9)', color: 'white', border: 'none', flexShrink: 0 }}
                title="Resolve Reference"
              >
                {isResolving ? <Loader2 className={styles.loadingSpinner} size={14} /> : <ChevronRight size={14} />}
              </button>
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ fontWeight: 800, fontSize: '10px', textTransform: 'uppercase', marginRight: 8, opacity: 0.8 }}>Imported Ref:</span>
                <code>{String((schema as any).$ref || (schema as any).allOf?.find((e: any) => e.$ref)?.$ref || 'External')}</code>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {isImported && !activeType && !variants && (
                <button
                  type="button"
                  data-testid="resolve-import-button"
                  onClick={async () => {
                    setIsResolving(true);
                    try { if (onResolve) await onResolve(path); } finally { setIsResolving(false); }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 12px',
                    fontSize: '11px',
                    borderRadius: '16px',
                    border: '1px solid var(--color-accent-7)',
                    background: 'var(--color-accent-9)',
                    color: 'white',
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
                  }}
                  title="Resolve imported reference"
                >
                  {isResolving ? <Loader2 size={12} className={styles.loadingSpinner} /> : <ChevronRight size={14} />}
                  IMPORT
                </button>
              )}
              {['string', 'number', 'boolean', 'object', 'array', 'null', 'image']
                .filter(t => path.length > 0 || t === 'object' || t === 'array')
                .map((t) => {
              const targetType = t === 'image' ? 'string' : t;
              const targetFormat = t === 'image' ? 'data-url' : undefined;
              
              const isSelected = variants ? (variants.some(v => v.type === targetType && (targetFormat ? v.format === targetFormat : true))) : (activeType === t);
              // In building mode, we don't have a single "active" variant if showing all, 
              // but we can highlight the pill if this type is present in the choices.
              const isActive = !variants && (activeType === t);
              
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    if (activeType === t) return; // already this type, no-op
                    if (t === 'image') {
                      updateSchema({ type: 'string', format: 'data-url' });
                    } else {
                      updateSchema({ type: t });
                    }
                  }}
                  style={{
                    padding: '4px 12px',
                    fontSize: '11px',
                    borderRadius: '16px',
                    border: isActive ? '2px solid var(--color-primary-10)' : (isSelected ? '1px dashed var(--color-primary-6)' : '1px solid var(--color-neutral-6)'),
                    background: isActive ? 'var(--color-primary-4)' : (isSelected ? 'var(--color-neutral-3)' : 'var(--color-neutral-1)'),
                    color: isActive ? 'var(--color-primary-11)' : (isSelected ? 'var(--color-neutral-11)' : 'var(--color-neutral-12)'),
                    fontWeight: (isActive || isSelected) ? 700 : 400,
                    cursor: 'pointer'
                  }}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              );
            })}
            {!variants && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={styles.addSmall}
                    style={{ marginLeft: '4px', borderStyle: 'dashed' }}
                    onClick={() => {
                      const { title, description, ...constraints } = schema;
                      const branch1 = Object.keys(constraints).length > 0 ? constraints : { type: renderType || 'string' };
                      onChange({
                        ...(title ? { title } : {}),
                        ...(description ? { description } : {}),
                        oneOf: [branch1, { type: 'string' }]
                      });
                    }}
                  >
                    + poly
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  Convert this field into a polymorphic choice. This wraps the current schema in a <code>oneOf</code>, <code>anyOf</code>, or <code>allOf</code> combiner, allowing you to define multiple valid structures for this property.
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
        <div style={{ fontSize: (schema.title ? 11 : 10), fontWeight: (schema.title ? 700 : 900), textTransform: (schema.title ? 'none' : 'uppercase'), color: (schema.title ? 'inherit' : 'var(--color-neutral-10)') }}>
          {(schema.title as string) || ''}
          {isImported && (
            <Badge 
              variant="outline" 
              style={{ 
                fontSize: '9px', 
                padding: '0 6px', 
                height: '16px', 
                marginLeft: 6, 
                color: 'var(--color-accent-10)', 
                borderColor: 'var(--color-accent-6)', 
                background: 'var(--color-accent-2)' 
              }}
              title={`Imported from ${(schema as any).$ref || (Array.isArray(schema.allOf) && (schema.allOf as any[]).find((e: any) => e.$ref)?.$ref) || 'source'}`}
            >
              {(() => {
                const ref = (schema as any).$ref || (Array.isArray(schema.allOf) && (schema.allOf as any[]).find((e: any) => e.$ref)?.$ref);
                if (typeof ref === 'string') return ref.split('/').pop() || 'REF';
                return 'REF';
              })()}
            </Badge>
          )}
        </div>
        <div style={{ flex: 1 }} />
        {isImported && renderType === 'object' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => {
                  // build a local allOf override referencing the original $ref when available
                  let refStr: string | null = null;
                  try {
                    if (typeof (schema as any).$ref === 'string') refStr = (schema as any).$ref;
                    else if (Array.isArray((schema as any).allOf)) {
                      const m = ((schema as any).allOf as any[]).find((e: any) => e && typeof e.$ref === 'string');
                      if (m) refStr = m.$ref;
                    }
                  } catch (e) {
                    // ignore
                  }
                  if (!refStr) return;

                  // If instance data is available, attempt to use instance keys at the current path
                  // to pre-populate property schemas so we don't add arbitrary fields like "username".
                  const localProperties: Record<string, unknown> = {};
                  try {
                    if (instanceData && typeof instanceData === 'object') {
                      // Traverse instanceData according to the editor path to find the relevant object
                      let node: any = instanceData as any;
                      for (const p of path) {
                        if (!node || typeof node !== 'object') { node = null; break; }
                        node = node[p];
                      }
                      if (node && typeof node === 'object' && !Array.isArray(node)) {
                        for (const [k, v] of Object.entries(node)) {
                          try {
                            // generate a schema for the instance value to make the override valid
                            const gen = generateSchema(v as any);
                            localProperties[k] = gen;
                          } catch (_) {
                            // fallback: mark as string
                            localProperties[k] = { type: 'string' };
                          }
                        }
                      }
                    }
                  } catch (_) { /* ignore */ }

                  const overrideObj: Record<string, unknown> = { type: 'object', properties: localProperties };
                  const next: Record<string, unknown> = { allOf: [{ $ref: refStr }, overrideObj] };
                  if (schema.title) next.title = schema.title as string;
                  onChange(next);
                }}
                className={styles.addSmall}
              >
                Override
              </button>
            </TooltipTrigger>
            <TooltipContent>
              Create a local <code>allOf</code> extension. This keeps the original <code>$ref</code> definition as a base but allows you to add specific constraints (like pattern, minLength, or extra properties) to just this instance.
            </TooltipContent>
          </Tooltip>
        )}
      </div>

        {variants && variants.length > 0 && (
          <div className={styles.variantsWrapper}>
            <div className={styles.variantsLabel}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 800, opacity: 0.9 }}>COMBINER:</span>
                <select 
                  value={logicType || 'oneOf'} 
                  onChange={(e) => {
                    const nextType = e.target.value;
                    const rest = { ...schema } as any;
                    delete rest.oneOf; delete rest.anyOf; delete rest.allOf;
                    onChange({ ...rest, [nextType]: variants });
                  }}
                  className={styles.combinerSelect}
                >
                  <option value="oneOf" style={{ color: 'black' }}>oneOf (Choice)</option>
                  <option value="anyOf" style={{ color: 'black' }}>anyOf (Optional Mix)</option>
                  <option value="allOf" style={{ color: 'black' }}>allOf (Composition/Merge)</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <button
                  type="button"
                  className={styles.addVariantButton}
                  onClick={() => {
                    updateSchema({ [logicType!]: [...variants, { type: 'string' }] });
                  }}
                >
                  + ADD VARIANT
                </button>
                <span className={styles.variantsCountBadge}>{variants.length} OPTIONS DEFINED</span>
              </div>
            </div>
            {variants.map((v, i) => {
              if (!v) return <div key={i} style={{ color: 'red', padding: 10 }}>Error: Variant {i} is null</div>;
              
              const labelData = getVariantLabel(v, i, variants);
              const variantPath = [...path, logicType!, String(i)];
              const isImportedVariant = !!isSchemaImported?.(v, variantPath);

              return (
              <VariantItem
                key={i}
                index={i}
                variant={v}
                variants={variants}
                logicType={logicType!}
                path={path}
                isImported={isImportedVariant}
                labelData={labelData}
                schema={schema}
                onChange={onChange}
                updateSchema={updateSchema}
                isSchemaImported={isSchemaImported}
                instanceData={instanceData}
                onPropertyRename={onPropertyRename}
                onResolve={onResolve}
              />
            );})}
          </div>
        )}

        {variants || (renderType === "boolean" || renderType === "object" || renderType === "null") ? null : (
          <div className={styles.fieldGroup}>
            {/* Facet controls: hide for boolean/object/null */}
            <>
            {/* Addable string-specific properties: format / pattern / default */}

            {/* Master "+ add" flow — all facet add-buttons for the current node live here (above the Enum field) */}
            <div className={styles.inlineAdd} data-testid="facet-add-flow" style={{ marginBottom: 4, padding: '6px 12px' }}>
              {(renderType === 'string' && !schema.enum) && (
                <>
                  {!('format' in schema) && (<button type="button" className={styles.addSmall} onClick={() => updateSchema({ format: 'date-time' })}>+ format</button>)}
                  {!('pattern' in schema) && (<button type="button" className={styles.addSmall} onClick={() => updateSchema({ pattern: '^.*$' })}>+ pattern</button>)}
                </>
              )}

              {(renderType === 'number' && !schema.enum) && (
                <>
                  {!('minimum' in schema) && (<button type="button" className={styles.addSmall} onClick={() => updateSchema({ minimum: 0 })}>+ minimum</button>)}
                  {!('maximum' in schema) && (<button type="button" className={styles.addSmall} onClick={() => updateSchema({ maximum: 0 })}>+ maximum</button>)}
                  {!('multipleOf' in schema) && (<button type="button" className={styles.addSmall} onClick={() => updateSchema({ multipleOf: 1 })}>+ multipleOf</button>)}
                  {!('examples' in schema) && (<button type="button" className={styles.addSmall} onClick={() => { const example = renderType === 'number' ? [0] : ['example']; updateSchema({ examples: example }); }}>+ examples</button>)}
                </>
              )}

              {(renderType === 'array') && (
                <>
                  {!('uniqueItems' in schema) && (<button type="button" className={styles.addSmall} onClick={() => updateSchema({ uniqueItems: true })}>+ uniqueItems</button>)}
                  {!('minItems' in schema) && (<button type="button" className={styles.addSmall} onClick={() => updateSchema({ minItems: 0 })}>+ minItems</button>)}
                  {!('maxItems' in schema) && (<button type="button" className={styles.addSmall} onClick={() => updateSchema({ maxItems: 0 })}>+ maxItems</button>)}
                </>
              )}

              {/* Unified +default for all node types that support defaults (now lives in the master flow above Enum) */}
              {!('default' in schema) && (renderType === 'string' || renderType === 'number' || renderType === 'array' || !schema.type) && (
                <button type="button" className={styles.addSmall} onClick={() => { setDefaultError(null); const initialDefault = (renderType === 'array') ? [] : ''; setEditingDefault(String(initialDefault)); updateSchema({ default: initialDefault }); }}>+ default</button>
              )}
            </div>

            {(renderType === "string" && !schema.enum && ('format' in schema || 'pattern' in schema)) && (
            <div className={styles.inlineAdd}>
              {'format' in schema ? (
                <div className={styles.fieldRow}>
                  <label className={styles.label}>Format</label>
                  <select
                    className={styles.select}
                    value={(schema.format as string) || ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "") {
                        const next = { ...schema } as Record<string, unknown>;
                        delete next.format;
                        onChange(next);
                      } else {
                        updateSchema({ format: v });
                      }
                    }}
                  >
                    <option value="">— Select format —</option>
                    <option value="date-time">date-time</option>
                    <option value="date">date</option>
                    <option value="time">time</option>
                    <option value="email">email</option>
                    <option value="uri">uri</option>
                    <option value="hostname">hostname</option>
                    <option value="ipv4">ipv4</option>
                    <option value="ipv6">ipv6</option>
                    <option value="uuid">uuid</option>
                    <option value="data-url">data-url (binary/data URI)</option>
                  </select>
                  <button
                    type="button"
                    className={styles.infoSmall}
                    title={
                      'Common formats: date-time (ISO 8601), date (YYYY-MM-DD), time (HH:MM:SS), email, uri, hostname, ipv4, ipv6, uuid'
                    }
                  >
                    ⓘ
                  </button>
                </div>
              ) : null}

              {'pattern' in schema ? (
                <div className={styles.fieldRow}>
                  <label className={styles.label}>Pattern</label>
                  <RegexInput
                    value={String((schema.pattern as string) || '')}
                    onChange={(val) => updateSchema({ pattern: val })}
                    placeholder="Regex pattern"
                  />
                  <button
                    type="button"
                    className={styles.removeSmall}
                    onClick={() => {
                      const next = { ...schema } as Record<string, unknown>;
                      delete next.pattern;
                      onChange(next);
                    }}
                  >
                    Remove
                  </button>
                </div>
              ) : null}

            </div>
            )}

            {/* Show enum checkbox for string, number, and array types */}
            {(renderType === "string" || renderType === "number" || renderType === "array" || !schema.type) && (
              <>
                <div className={styles.checkboxContainer}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    id={`enum-${path.join("-") || "root"}`}
                    checked={!!schema.enum || !!(schema.items && typeof schema.items === 'object' && (schema.items as any).enum)}
                    onChange={(e) => toggleEnum(e.target.checked)}
                  />
                  <label className={styles.checkboxLabel} htmlFor={`enum-${path.join("-") || "root"}`}>
                    Enum (constrained values)
                  </label>
                </div>
                {(!!schema.enum || (renderType === 'array' && schema.items && typeof schema.items === 'object' && !!(schema.items as any).enum)) && (
                  <div className={styles.fieldRow} style={{ marginTop: '4px', marginBottom: '12px' }}>
                   <label className={styles.label} style={{ fontSize: '10px', color: 'var(--color-neutral-10)' }}>
                      Allowed Values {renderType === 'array' ? `(${(((schema.items as any)?.type || 'string') as string).toUpperCase()} ITEMS)` : ''}
                    </label>
                    <CustomMultiSelect
                      creatable
                      options={[]} 
                      values={(Array.isArray(schema.enum) ? schema.enum : (schema.items as any)?.enum) || []}
                      onChange={(newEnum) => {
                        if (renderType === 'array') {
                          const items = schema.items && typeof schema.items === 'object' ? { ...(schema.items as any) } : { type: 'string' };
                          items.enum = newEnum;
                          updateSchema({ items });
                        } else {
                          updateSchema({ enum: newEnum });
                        }
                      }}
                      placeholder="Add allowed values..."
                    />
                  </div>
                )}

                {/* Default Values Editor */}
                {!('default' in schema) ? null : (
                  <div className={styles.fieldRow} style={{ marginTop: '8px' }}>
                    <label className={styles.label}>Default Value</label>
                    {renderType === 'array' || Array.isArray(schema.enum) || (schema.items && typeof schema.items === 'object' && Array.isArray((schema.items as any).enum)) ? (
                      <CustomMultiSelect
                        isMulti={renderType === 'array' || Array.isArray(schema.default)}
                        creatable={renderType === 'array' && !Array.isArray(schema.enum) && !(schema.items && typeof schema.items === 'object' && Array.isArray((schema.items as any).enum))}
                        options={((Array.isArray(schema.enum) ? schema.enum : (schema.items as any)?.enum) || []).map((v: any) => ({
                          label: String(v),
                          value: v
                        }))}
                        values={Array.isArray(schema.default) ? (schema.default as any[]) : (schema.default !== undefined ? [schema.default] : [])}
                        onChange={(selectedValues) => {
                          if (renderType === 'array' || Array.isArray(schema.default)) {
                            updateSchema({ default: selectedValues });
                          } else {
                            updateSchema({ default: selectedValues[0] });
                          }
                        }}
                        placeholder={renderType === 'array' ? "Select or add default values..." : "Select default..."}
                      />
                    ) : (
                      <input
                        className={styles.input}
                        value={editingDefault}
                        onChange={(e) => setEditingDefault(e.target.value)}
                        onBlur={() => {
                          const raw = editingDefault;
                          const parsed = (String(renderType) === 'number') ? (raw === '' ? '' : parseFloat(raw)) : raw;
                          const error = validateValueAgainstSchema(parsed, schema);
                          if (error) {
                            setDefaultError(error);
                          } else {
                            setDefaultError(null);
                            updateSchema({ default: parsed as any });
                          }
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        placeholder="Default value"
                      />
                    )}
                    <button type="button" className={styles.removeSmall} onClick={() => { const next = { ...schema } as Record<string, unknown>; delete next.default; onChange(next); }}>Remove</button>
                  </div>
                )}
                {defaultError && <div style={{ color: 'red', marginTop: 6, fontSize: '11px' }}>{defaultError}</div>}

                {(schema.format === 'data-url' || (typeof schema.contentMediaType === 'string' && String(schema.contentMediaType).startsWith('image'))) && (
                  <div className={styles.fieldRow} style={{ alignItems: 'center', gap: 12, marginTop: '8px' }}>
                    <label className={styles.label}>Image Preview</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {typeof schema.default === 'string' && /^data:image\//i.test(schema.default as string) && (
                        <img src={schema.default as string} alt="preview" style={{ maxWidth: 240, maxHeight: 160, border: '1px solid #ddd', borderRadius: 6 }} />
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const f = e.target.files && e.target.files[0];
                          if (!f) return;
                          const reader = new FileReader();
                          reader.onload = () => {
                            const result = reader.result as string | ArrayBuffer | null;
                            if (typeof result === 'string') {
                              updateSchema({ default: result });
                            }
                          };
                          reader.readAsDataURL(f);
                        }}
                      />
                      <button type="button" className={styles.removeSmall} onClick={() => { const next = { ...schema } as Record<string, unknown>; delete next.default; onChange(next); }}>Remove image</button>
                    </div>
                  </div>
                )}
              </>
            )}

          {/* Number-specific facets: minimum / maximum / multipleOf / examples */}
          {(renderType === "number" && !schema.enum && ('minimum' in schema || 'maximum' in schema || 'multipleOf' in schema || 'examples' in schema)) && (
            <div className={styles.inlineAdd}>
              {'minimum' in schema ? (
                <div className={styles.fieldRow}>
                  <label className={styles.label}>Minimum</label>
                  <input
                    className={styles.input}
                    type="number"
                    value={schema.minimum === undefined ? '' : String(schema.minimum)}
                    onWheel={(e) => {
                      e.preventDefault();
                      const dir = (e.deltaY > 0) ? -1 : 1;
                      const mult = e.shiftKey ? 10 : 1;
                      const cur = typeof schema.minimum === 'number' ? (schema.minimum as number) : 0;
                      const newVal = cur + dir * 1 * mult;
                      updateSchema({ minimum: newVal });
                    }}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') {
                        const next = { ...schema } as Record<string, unknown>;
                        delete next.minimum;
                        onChange(next);
                      } else {
                        updateSchema({ minimum: parseFloat(raw) });
                      }
                    }}
                    placeholder="Minimum"
                  />
                  <button type="button" className={styles.removeSmall} onClick={() => { const next = { ...schema } as Record<string, unknown>; delete next.minimum; onChange(next); }}>Remove</button>
                </div>
              ) : null}

              {'maximum' in schema ? (
                <div className={styles.fieldRow}>
                  <label className={styles.label}>Maximum</label>
                  <input
                    className={styles.input}
                    type="number"
                    value={schema.maximum === undefined ? '' : String(schema.maximum)}
                    onWheel={(e) => {
                      e.preventDefault();
                      const dir = (e.deltaY > 0) ? -1 : 1;
                      const mult = e.shiftKey ? 10 : 1;
                      const cur = typeof schema.maximum === 'number' ? (schema.maximum as number) : 0;
                      const newVal = cur + dir * 1 * mult;
                      updateSchema({ maximum: newVal });
                    }}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') {
                        const next = { ...schema } as Record<string, unknown>;
                        delete next.maximum;
                        onChange(next);
                      } else {
                        updateSchema({ maximum: parseFloat(raw) });
                      }
                    }}
                    placeholder="Maximum"
                  />
                  <button type="button" className={styles.removeSmall} onClick={() => { const next = { ...schema } as Record<string, unknown>; delete next.maximum; onChange(next); }}>Remove</button>
                </div>
              ) : null}

              {'multipleOf' in schema ? (
                <div className={styles.fieldRow}>
                  <label className={styles.label}>multipleOf</label>
                  <input
                    className={styles.input}
                    type="number"
                    step="any"
                    value={schema.multipleOf === undefined ? '' : String(schema.multipleOf)}
                    onWheel={(e) => {
                      e.preventDefault();
                      const dir = (e.deltaY > 0) ? -1 : 1;
                      const mult = e.shiftKey ? 10 : 1;
                      const cur = typeof schema.multipleOf === 'number' ? (schema.multipleOf as number) : 1;
                      const newVal = parseFloat((cur + dir * 1 * mult).toString());
                      updateSchema({ multipleOf: newVal });
                    }}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') {
                        const next = { ...schema } as Record<string, unknown>;
                        delete next.multipleOf;
                        onChange(next);
                      } else {
                        updateSchema({ multipleOf: parseFloat(raw) });
                      }
                    }}
                    placeholder="multipleOf"
                  />
                  <button type="button" className={styles.removeSmall} onClick={() => { const next = { ...schema } as Record<string, unknown>; delete next.multipleOf; onChange(next); }}>Remove</button>
                </div>
              ) : null}

              {'examples' in schema ? (
                <div className={styles.fieldRow}>
                  <label className={styles.label}>Examples</label>
                  <input
                    className={styles.input}
                    value={Array.isArray(schema.examples) ? (schema.examples as any[]).join(', ') : ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const arr = raw.split(',').map(s => s.trim()).filter(Boolean).map(v => renderType === 'number' ? parseFloat(v) : v);
                      updateSchema({ examples: arr });
                    }}
                    placeholder="Comma-separated examples"
                  />
                  <button type="button" className={styles.removeSmall} onClick={() => { const next = { ...schema } as Record<string, unknown>; delete next.examples; onChange(next); }}>Remove</button>
                </div>
              ) : null}
            </div>
          )}

          {/* Array-specific facets: uniqueItems / minItems / maxItems */}
          {renderType === "array" && (
            <div className={styles.inlineAdd}>
              {'uniqueItems' in schema ? (
                <div className={styles.fieldRow}>
                  <label className={styles.label}>uniqueItems</label>
                  <input
                    type="checkbox"
                    checked={!!schema.uniqueItems}
                    onChange={(e) => updateSchema({ uniqueItems: e.target.checked })}
                  />
                  <button type="button" className={styles.removeSmall} onClick={() => { const next = { ...schema } as Record<string, unknown>; delete next.uniqueItems; onChange(next); }}>Remove</button>
                </div>
              ) : null}

              {'minItems' in schema ? (
                <div className={styles.fieldRow}>
                  <label className={styles.label}>minItems</label>
                  <input
                    className={styles.input}
                    type="number"
                    value={schema.minItems === undefined ? '' : String(schema.minItems)}
                    onWheel={(e) => {
                      e.preventDefault();
                      const dir = (e.deltaY > 0) ? -1 : 1;
                      const mult = e.shiftKey ? 10 : 1;
                      const cur = typeof schema.minItems === 'number' ? (schema.minItems as number) : 0;
                      const newVal = Math.max(0, cur + dir * 1 * mult);
                      updateSchema({ minItems: newVal });
                    }}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') {
                        const next = { ...schema } as Record<string, unknown>;
                        delete next.minItems;
                        onChange(next);
                      } else {
                        updateSchema({ minItems: parseInt(raw, 10) });
                      }
                    }}
                    placeholder="minItems"
                  />
                  <button type="button" className={styles.removeSmall} onClick={() => { const next = { ...schema } as Record<string, unknown>; delete next.minItems; onChange(next); }}>Remove</button>
                </div>
              ) : null}

              {'maxItems' in schema ? (
                <div className={styles.fieldRow}>
                  <label className={styles.label}>maxItems</label>
                  <input
                    className={styles.input}
                    type="number"
                    value={schema.maxItems === undefined ? '' : String(schema.maxItems)}
                    onWheel={(e) => {
                      e.preventDefault();
                      const dir = (e.deltaY > 0) ? -1 : 1;
                      const mult = e.shiftKey ? 10 : 1;
                      const cur = typeof schema.maxItems === 'number' ? (schema.maxItems as number) : 0;
                      const newVal = Math.max(0, cur + dir * 1 * mult);
                      updateSchema({ maxItems: newVal });
                    }}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') {
                        const next = { ...schema } as Record<string, unknown>;
                        delete next.maxItems;
                        onChange(next);
                      } else {
                        updateSchema({ maxItems: parseInt(raw, 10) });
                      }
                    }}
                    placeholder="maxItems"
                  />
                  <button type="button" className={styles.removeSmall} onClick={() => { const next = { ...schema } as Record<string, unknown>; delete next.maxItems; onChange(next); }}>Remove</button>
                </div>
              ) : null}
            </div>
          )}
            </>
          </div>
        )}

        {renderType === "object" && (
          <div className={styles.nestedContainer}>
            <div className={styles.propertiesHeader}>
              <h3 className={styles.propertyTitle}>Properties</h3>
              <div style={{ position: 'relative' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingLeft: "0.25rem", color: 'var(--color-neutral-11)' }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                      <input
                        aria-label={`additional-allow-${path.join('-') || 'root'}`}
                        type="radio"
                        name={`additional-${path.join('-') || 'root'}`}
                        checked={!(schema.additionalProperties === false) && !(schema.additionalProperties && typeof schema.additionalProperties === 'object')}
                        onChange={() => {
                          const next = { ...schema } as Record<string, unknown>;
                          // explicit 'allow' state represented as true
                          next.additionalProperties = true;
                          onChange(next);
                          setApPopoverOpen(false);
                          setApPopoverAllowed(false);
                        }}
                      />
                      <span>Allow Extras</span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                      <input
                        aria-label={`additional-block-${path.join('-') || 'root'}`}
                        type="radio"
                        name={`additional-${path.join('-') || 'root'}`}
                        checked={schema.additionalProperties === false}
                        onChange={() => {
                          const next = { ...schema } as Record<string, unknown>;
                          next.additionalProperties = false;
                          onChange(next);
                          setApPopoverOpen(false);
                          setApPopoverAllowed(false);
                        }}
                      />
                      <span>Strict</span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                      <input
                        aria-label={`additional-schema-${path.join('-') || 'root'}`}
                        type="radio"
                        name={`additional-${path.join('-') || 'root'}`}
                        checked={!!(schema.additionalProperties && typeof schema.additionalProperties === 'object')}
                        onChange={() => {
                          const next = { ...schema } as Record<string, unknown>;
                          // default schema for extras is a simple string constraint for discoverability
                          next.additionalProperties = { type: 'string' };
                          // notify parent first — we don't open the floating editor automatically anymore
                          onChange(next);
                          // prepare local draft (popover may be opened via the Edit button)
                          setLocalAdditionalSchema(next.additionalProperties as Record<string, unknown>);
                          setApPopoverOpen(false);
                          setApPopoverAllowed(false);
                        }}
                      />
                      <span>Schema Extras</span>
                    </label>

                    {schema.additionalProperties && typeof schema.additionalProperties === 'object' && (
                      <Popover open={apPopoverOpen && apPopoverAllowed} onOpenChange={(open) => {
                        if (!open) {
                          const next = { ...schema } as Record<string, unknown>;
                          if (!localAdditionalSchema || (Object.keys(localAdditionalSchema).length === 0)) delete next.additionalProperties;
                          else next.additionalProperties = localAdditionalSchema;
                          updateSchema(next as any);
                        } else {
                          setLocalAdditionalSchema(schema.additionalProperties && typeof schema.additionalProperties === 'object' ? (schema.additionalProperties as Record<string, unknown>) : {});
                        }
                        setApPopoverOpen(open);
                        setApPopoverAllowed(open);
                      }}>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            aria-label={`edit-additional-properties-${path.join('-') || 'root'}`}
                            className={styles.addSmall}
                            style={{ 
                              background: 'var(--color-primary-9)', 
                              color: 'white', 
                              fontWeight: 900, 
                              marginLeft: 8,
                              border: '1px solid var(--color-primary-10)',
                              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                            }}
                            onClick={() => {
                              setLocalAdditionalSchema(schema.additionalProperties as Record<string, unknown>);
                              setApPopoverAllowed(true);
                              setApPopoverOpen(true);
                            }}
                          >
                            Edit extras
                          </button>
                        </PopoverTrigger>

                        <PopoverContent simple style={{ width: 'min(90vw, 500px)', zIndex: 'var(--z-index-popover)' as any }}>
                          <div data-testid="ap-popover-content" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ fontWeight: 800 }}>Schema for extra properties</div>
                            <div style={{ background: 'var(--color-neutral-1)', padding: 12, borderRadius: 6, border: '1px solid var(--color-neutral-4)' }}>
                              <SchemaEditorForm
                                schema={localAdditionalSchema || {}}
                                onChange={(newSub) => setLocalAdditionalSchema(newSub as Record<string, unknown> || null)}
                                path={[...path, 'additionalProperties']}
                                isSchemaImported={isSchemaImported}
                                instanceData={instanceData}
                                onPropertyRename={onPropertyRename}
                                onResolve={onResolve}
                              />
                            </div>
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                className={styles.addSmall}
                                onClick={() => {
                                  const next = { ...schema } as Record<string, unknown>;
                                  if (!localAdditionalSchema || (Object.keys(localAdditionalSchema).length === 0)) delete next.additionalProperties;
                                  else next.additionalProperties = localAdditionalSchema;
                                  updateSchema(next as any);
                                  setApPopoverOpen(false);
                                  setApPopoverAllowed(false);
                                }}                            >Close</button>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    ) as any} 
                  </div>

                  {(schema.additionalProperties === false) && (!patternProperties || Object.keys(patternProperties).length === 0) && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span style={{ color: '#b71c1c', cursor: 'help', fontWeight: 'bold', marginLeft: 4 }} title="Blocked">ⓘ</span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Named properties cannot be added while <code>additionalProperties: false</code>. You can still add <code>patternProperties</code> (use the <strong>+ pattern property</strong> button) to allow regex-keyed properties, or define an <code>additionalProperties</code> schema to constrain extra keys.
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {!(schema.additionalProperties === false) ? (
                  <button className={styles.addButton} onClick={addProperty}>
                    Add Property
                  </button>
                ) : null}
                <button
                  className={styles.addButton}
                  onClick={() => {
                    const next = addPatternPropertyToSchema(schema);
                    updateSchema(next);
                  }}
                  title="Add a patternProperties entry (allowed even in Strict mode)"
                >
                  + pattern property
                </button>
              </div>
            </div>

            {/* Pattern Properties list */}
            {patternProperties && (
              <div style={{ marginTop: 12 }}>
                <div className={styles.propertyTitle} style={{ marginBottom: 8, color: 'var(--color-neutral-11)' }}>Pattern properties</div>
                {Object.entries(patternProperties).map(([pat, subschema]) => (
                  <PatternPropertyRow 
                    key={pat} 
                    patternKey={pat} 
                    subschema={subschema as Record<string, unknown>}
                    schema={schema}
                    updateSchema={updateSchema}
                    path={path}
                    isSchemaImported={isSchemaImported}
                    instanceData={instanceData}
                    onPropertyRename={onPropertyRename}
                    onResolve={onResolve}
                  />
                ))}
              </div>
            )}

            {Object.entries((schema.properties as Record<string, unknown>) || {})
              .filter(([propertyName]) => !propertyName.startsWith('__'))
              .sort(([nameA], [nameB]) => {
                const required = (schema.required as string[]) || [];
                const aReq = required.includes(nameA);
                const bReq = required.includes(nameB);
                if (aReq && !bReq) return -1;
                if (!aReq && bReq) return 1;
                return 0; // preserve original order
              })
              .map(([propertyName, propertySchema]) => (
                <PropertyEditor
                  key={propertyName}
                  propertyName={propertyName}
                  propertySchema={propertySchema as Record<string, unknown>}
                  isRequired={((schema.required as string[]) || []).includes(propertyName)}
                  onUpdate={(newValue) => updateNestedProperty(propertyName, newValue)}
                  onToggleRequired={() => toggleRequired(propertyName)}
                  onRename={(newName) => updatePropertyName(propertyName, newName)}
                  onDelete={() => handleDeleteProperty(propertyName)}
                  path={[...path, 'properties', propertyName]}
                  isImported={isSchemaImported?.(propertySchema as Record<string, unknown>, [...path, 'properties', propertyName])}
                  isSchemaImported={isSchemaImported}
                  onResolve={onResolve}
                />
              ))}
          </div>
        )}

        {/* Show array item controls if not handled by a root-level enum filter */}
        {renderType === "array" && !((schema.items as any)?.enum) && (() => {
          const itemsSchemaNode = itemsSchema || {};
          return (
            <div className={styles.nestedContainer}>
              <div 
                style={{ 
                  fontSize: '10px', 
                  fontWeight: 900, 
                  textTransform: 'uppercase', 
                  color: 'var(--color-accent-10)', 
                  marginBottom: '8px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '8px' 
                }}
              >
                <button
                  type="button"
                  className={styles.toggleButton}
                  onClick={async () => {
                    const nextExpanded = !itemsExpanded;
                    if (nextExpanded && onResolve && itemsSchema && isItemsImported) {
                      const s = itemsSchema as any;
                      const hasContent = s.properties || s.items || s.type || s.oneOf || s.anyOf || s.allOf;
                      if (!hasContent && (s.$ref || s.allOf?.some((e: any) => e.$ref))) {
                        setIsResolvingItems(true);
                        try {
                          await onResolve([...path, 'items']);
                        } catch (e) {
                          console.error("Failed to resolve array items:", e);
                        } finally {
                          setIsResolvingItems(false);
                        }
                      }
                    }
                    setItemsExpanded(nextExpanded);
                  }}
                  title={itemsExpanded ? "Collapse Items" : "Expand Items"}
                >
                  {isResolvingItems ? (
                    <Loader2 className={styles.loadingSpinner} size={14} />
                  ) : itemsExpanded ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                </button>
                Array Items {isItemsImported && <span style={{ color: 'var(--color-accent-9)', marginLeft: 4 }} title="Imported items">*</span>}
              </div>
              {itemsExpanded && (
                <SchemaEditorForm
                  schema={itemsSchemaNode}
                  onChange={(newItems) => updateSchema({ items: newItems })}
                  path={[...path, "items"]}
                  isSchemaImported={isSchemaImported}
                  instanceData={instanceData}
                  onResolve={onResolve}
                />
              )}
            </div>
          );
        })()}
      </div>
    </>
  );
}

function PatternPropertyRow({ 
  patternKey, 
  subschema, 
  schema, 
  updateSchema, 
  path, 
  isSchemaImported, 
  instanceData, 
  onPropertyRename, 
  onResolve 
}: { 
  patternKey: string; 
  subschema: Record<string, unknown>; 
  schema: Record<string, unknown>;
  updateSchema: (updates: Partial<Record<string, unknown>>) => void;
  path: string[];
  isSchemaImported?: (schema: Record<string, unknown>, path?: string[]) => boolean;
  instanceData?: unknown;
  onPropertyRename?: (oldName: string, newName: string, path?: string[]) => void;
  onResolve?: (path: string[]) => Promise<void>;
}) {
  const [keyState, setKeyState] = useState<string>(patternKey);
  const [keyError, setKeyError] = useState<string | null>(null);

  const handleKeyBlur = () => {
    const newKey = keyState;
    // Validate regex
    try {
      // eslint-disable-next-line no-new
      new RegExp(newKey);
      setKeyError(null);
    } catch (err) {
      setKeyError('Invalid regular expression');
      return;
    }
    if (newKey !== patternKey) {
      const next = renamePatternPropertyInSchema(schema, patternKey, newKey);
      updateSchema(next);
    }
  };

  return (
    <div key={patternKey} style={{ marginBottom: 24, padding: 16, background: 'var(--color-neutral-3)', borderRadius: 8, border: '1px solid var(--color-neutral-6)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16, gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 900, textTransform: 'uppercase', color: 'var(--color-neutral-11)', marginBottom: 6 }}>Regex Pattern</div>
          <RegexInput 
            aria-label={`pattern-key-${patternKey}`} 
            value={keyState} 
            onChange={(val) => setKeyState(val)} 
            onBlur={handleKeyBlur} 
            className={styles.input} 
          />
          {keyError && <div style={{ color: '#b71c1c', fontSize: 11, marginTop: 4, fontWeight: 700 }}>{keyError}</div>}
        </div>
        <button
          type="button"
          className={styles.removeSmall}
          onClick={() => {
            const next = removePatternPropertyFromSchema(schema, patternKey);
            updateSchema(next);
          }}
        >
          Remove Pattern
        </button>
      </div>
      <div style={{ background: 'var(--color-neutral-1)', padding: 16, borderRadius: 8, border: '1px solid var(--color-neutral-4)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)' }}>
        <SchemaEditorForm
          schema={subschema}
          onChange={(newSub) => {
            const updated = updatePatternPropertyInSchema(schema, patternKey, newSub);
            updateSchema(updated);
          }}
          path={[...path, "patternProperties", patternKey]}
          isSchemaImported={isSchemaImported}
          instanceData={instanceData}
          onPropertyRename={onPropertyRename}
          onResolve={onResolve}
        />
      </div>
    </div>
  );
}

interface PropertyEditorProps {
  propertyName: string;
  propertySchema: Record<string, unknown>;
  isRequired: boolean;
  onUpdate: (schema: Record<string, unknown>) => void;
  onToggleRequired: () => void;
  onRename: (newName: string) => void;
  onDelete: () => void;
  path?: string[];
  isImported?: boolean;
  isSchemaImported?: (schema: Record<string, unknown>, path?: string[]) => boolean;
  onResolve?: (path: string[]) => Promise<void>;
}

function PropertyEditor({
  propertyName,
  propertySchema,
  isRequired,
  onUpdate,
  onToggleRequired,
  onRename,
  onDelete,
  path = [],
  isImported,
  isSchemaImported,
  onResolve,
}: PropertyEditorProps) {
  const [editingName, setEditingName] = useState(propertyName);
  const [isExpanded, setIsExpanded] = useState(!isImported);
  const [isResolving, setIsResolving] = useState(false);

  if (!propertySchema) return null;

  const handleToggleExpand = async () => {
    if (!isExpanded && onResolve && isImported) {
      // Check if it's "unresolved" (has a $ref but no content)
      const hasProps = !!propertySchema.properties;
      const hasItems = !!propertySchema.items;
      const hasType = !!propertySchema.type;
      const isCombiner = !!(propertySchema.oneOf || propertySchema.anyOf || propertySchema.allOf);
      
      if (!hasProps && !hasItems && !hasType && !isCombiner && (propertySchema.$ref || (propertySchema as any).allOf?.some((e: any) => e.$ref))) {
        setIsResolving(true);
        try {
          await onResolve(path);
        } finally {
          setIsResolving(false);
        }
      }
    }
    setIsExpanded(!isExpanded);
  };

  return (
    <div className={styles.fieldGroup} data-testid={`prop-${propertyName}`}>
      <div className={styles.propertyHeader} style={{ gap: '8px' }}>
        <button
          type="button"
          className={styles.toggleButton}
          onClick={handleToggleExpand}
          title={isExpanded ? "Collapse" : "Expand"}
        >
          {isResolving ? (
            <Loader2 className={styles.loadingSpinner} size={14} />
          ) : isExpanded ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )}
        </button>
        <input
          className={styles.input}
          style={{ flex: 1 }}
          value={editingName}
          data-testid={`prop-${propertyName}-name`}
          onChange={(e) => setEditingName(e.target.value)}
          onBlur={() => onRename(editingName)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onRename(editingName);
            }
          }}
        />
        {isImported && (
          <Badge 
            variant="outline" 
            style={{ 
              fontSize: '9px', 
              padding: '0 6px', 
              height: '16px', 
              color: 'var(--color-accent-10)', 
              borderColor: 'var(--color-accent-6)', 
              background: 'var(--color-accent-2)' 
            }}
            title={`Imported property: ${(propertySchema as any).$ref || (Array.isArray((propertySchema as any).allOf) && (propertySchema as any).allOf.find((e: any) => e.$ref)?.$ref) || 'source'}`}
          >
            {(() => {
              const ref = (propertySchema as any).$ref || (Array.isArray((propertySchema as any).allOf) && (propertySchema as any).allOf.find((e: any) => e.$ref)?.$ref);
              if (typeof ref === 'string') return ref.split('/').pop() || 'REF';
              return 'REF';
            })()}
          </Badge>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--color-neutral-11)", cursor: "pointer" }}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={isRequired}
            onChange={onToggleRequired}
          />
          Required
        </label>
        <button
          type="button"
          className={styles.removeSmall}
          onClick={onDelete}
          title="Remove this property"
        >
          Remove
        </button>
      </div>

      {isExpanded && (
        <>
          <div className={styles.fieldRow}>
            <label className={styles.label} style={{ fontSize: "11px", marginBottom: "4px" }}>Description</label>
            <textarea
              className={styles.textarea}
              style={{ minHeight: "60px" }}
              value={(propertySchema.description as string) || ""}
              onChange={(e) => onUpdate({ ...propertySchema, description: e.target.value })}
              placeholder="Add a description..."
            />
          </div>

          <SchemaEditorForm 
            schema={propertySchema} 
            onChange={onUpdate} 
            path={path} 
            isSchemaImported={isSchemaImported} // child inherits imported status if it's the same ref
            onResolve={onResolve}
          />
        </>
      )}
    </div>
  );
}

function VariantItem({
  index,
  variant,
  variants,
  logicType,
  path,
  isImported,
  labelData,
  schema,
  onChange,
  updateSchema,
  isSchemaImported,
  instanceData,
  onPropertyRename,
  onResolve,
}: {
  index: number;
  variant: Record<string, unknown>;
  variants: Record<string, unknown>[];
  logicType: string;
  path: string[];
  isImported: boolean;
  labelData: any;
  schema: Record<string, unknown>;
  onChange: (schema: Record<string, unknown>) => void;
  updateSchema: (updates: Partial<Record<string, unknown>>) => void;
  isSchemaImported?: (schema: Record<string, unknown>, path?: string[]) => boolean;
  instanceData?: unknown;
  onPropertyRename?: (oldName: string, newName: string, path?: string[]) => void;
  onResolve?: (path: string[]) => Promise<void>;
}) {
  const [isExpanded, setIsExpanded] = useState(!isImported);
  const [isResolving, setIsResolving] = useState(false);
  const variantPath = [...path, logicType, String(index)];

  const handleToggleExpand = async () => {
    const nextExpanded = !isExpanded;
    if (nextExpanded && onResolve && isImported) {
      const s = variant as any;
      const hasContent = s.properties || s.items || s.type || s.oneOf || s.anyOf || s.allOf;
      if (!hasContent && (s.$ref || s.allOf?.some((e: any) => e.$ref))) {
        setIsResolving(true);
        try {
          await onResolve(variantPath);
        } catch (e) {
          console.error("Failed to resolve variant:", e);
        } finally {
          setIsResolving(false);
        }
      }
    }
    setIsExpanded(nextExpanded);
  };

  return (
    <div className={styles.variantItem} style={{ border: '1px solid var(--color-accent-4)', marginBottom: 16, background: 'var(--color-neutral-1)' }}>
      <div className={styles.variantItemHeader} style={{ background: 'var(--color-accent-2)', padding: '4px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <button
          type="button"
          className={styles.toggleButton}
          onClick={handleToggleExpand}
          title={isExpanded ? "Collapse" : "Expand"}
        >
          {isResolving ? (
            <Loader2 className={styles.loadingSpinner} size={14} />
          ) : isExpanded ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )}
        </button>
        <div className={styles.variantItemTitle} style={{ color: 'var(--color-accent-11)', fontWeight: 700, flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ cursor: labelData.description ? 'help' : 'default' }}>
            {`${index + 1}. ${labelData.title}`}
          </span>
          {labelData.description && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" style={{ background: 'none', border: 'none', padding: 0, cursor: 'help', opacity: 0.6, display: 'flex' }}>
                  <Badge variant="outline" style={{ fontSize: '9px', padding: '0 4px', height: '14px', lineHeight: '14px', color: 'var(--color-neutral-10)', borderColor: 'var(--color-neutral-6)' }}>REF</Badge>
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <div style={{ maxWidth: '300px', padding: '4px' }}>
                  <div style={{ fontWeight: 800, fontSize: '9px', textTransform: 'uppercase', marginBottom: '2px', color: 'var(--color-neutral-10)' }}>IDENTIFIER / SOURCE</div>
                  <div style={{ fontSize: '11px', fontFamily: 'monospace', wordBreak: 'break-all', background: 'var(--color-neutral-3)', padding: '4px', borderRadius: '4px', color: 'var(--color-neutral-12)' }}>{renderTooltipContentChildren(labelData.description)}</div>
                </div>
              </TooltipContent>
            </Tooltip>
          )}
          {isImported && (
            <Badge 
              variant="outline" 
              style={{ 
                fontSize: '9px', 
                padding: '0 6px', 
                height: '16px', 
                marginLeft: 6, 
                color: 'var(--color-accent-10)', 
                borderColor: 'var(--color-accent-6)', 
                background: 'var(--color-accent-2)' 
              }}
              title={`Imported variant: ${(variant as any).$ref || (Array.isArray((variant as any).allOf) && (variant as any).allOf.find((e: any) => e.$ref)?.$ref) || 'source'}`}
            >
              {(() => {
                const ref = (variant as any).$ref || (Array.isArray((variant as any).allOf) && (variant as any).allOf.find((e: any) => e.$ref)?.$ref);
                if (typeof ref === 'string') return ref.split('/').pop() || 'REF';
                return 'REF';
              })()}
            </Badge>
          )}
        </div>
        <button
          type="button"
          className={styles.removeSmall}
          style={{ marginLeft: '12px' }}
          title="Remove this branch"
          onClick={() => {
            const next = variants.filter((_, idx) => idx !== index);
            if (next.length === 0) {
              const rest = { ...schema } as any;
              delete rest.oneOf; delete rest.anyOf; delete rest.allOf; delete rest.oneOnly;
              onChange({ ...rest, type: 'string' });
            } else if (next.length === 1) {
              const { title, description } = schema as any;
              const flattened = {
                ...(title ? { title } : {}),
                ...(description ? { description } : {}),
                ...next[0]
              };
              onChange(flattened);
            } else {
              updateSchema({ [logicType]: next });
            }
          }}
        >
          Remove
        </button>
      </div>
      {isExpanded && (
        <div style={{ padding: '8px 12px' }}>
          <SchemaEditorForm
            schema={variant}
            onChange={(newSub) => {
              const newVariants = [...variants];
              newVariants[index] = newSub;
              updateSchema({ [logicType]: newVariants });
            }}
            path={variantPath}
            isSchemaImported={isSchemaImported}
            instanceData={instanceData}
            onPropertyRename={onPropertyRename}
            onResolve={onResolve}
          />
        </div>
      )}
    </div>
  );
}

interface CustomMultiSelectProps {
  options: { label: string; value: any }[];
  values: any[];
  onChange: (values: any[]) => void;
  placeholder?: string;
  creatable?: boolean;
  isMulti?: boolean;
}

const reactSelectStyles = {
  // ... (keeping existing styles)
  control: (base: any) => ({
    ...base,
    background: 'var(--color-neutral-1)',
    borderColor: 'var(--color-neutral-6)',
    '&:hover': {
      borderColor: 'var(--color-neutral-7)',
    },
    minHeight: '38px',
    borderRadius: '6px',
    boxShadow: 'none',
  }),
  menu: (base: any) => ({
    ...base,
    background: 'var(--color-neutral-1)',
    border: '1px solid var(--color-neutral-6)',
    zIndex: 'var(--z-index-menu)' as any,
  }),
  option: (base: any, state: { isFocused: boolean; isSelected: boolean }) => ({
    ...base,
    background: state.isSelected 
      ? 'var(--color-accent-9)' 
      : state.isFocused 
        ? 'var(--color-neutral-3)' 
        : 'transparent',
    color: 'var(--color-neutral-12)',
    cursor: 'pointer',
    '&:active': {
      background: 'var(--color-accent-10)',
    },
  }),
  multiValue: (base: any) => ({
    ...base,
    background: 'var(--color-neutral-3)',
    borderRadius: '4px',
    border: '1px solid var(--color-neutral-6)',
  }),
  multiValueLabel: (base: any) => ({
    ...base,
    color: 'var(--color-neutral-12)',
  }),
  multiValueRemove: (base: any) => ({
    ...base,
    color: 'var(--color-neutral-11)',
    '&:hover': {
      background: 'var(--color-accent-3)',
      color: 'var(--color-accent-11)',
    },
  }),
  input: (base: any) => ({
    ...base,
    color: 'var(--color-neutral-12)',
  }),
  placeholder: (base: any) => ({
    ...base,
    color: 'var(--color-neutral-8)',
  }),
  singleValue: (base: any) => ({
    ...base,
    color: 'var(--color-neutral-12)',
  }),
  menuPortal: (base: any) => ({
    ...base,
    zIndex: 'var(--z-index-dropdown)' as any,
  }),
};

function CustomMultiSelect({ options, values, onChange, placeholder, creatable, isMulti = true }: CustomMultiSelectProps) {
  const selectOptions = (options || []).map(opt => ({ 
    label: String(opt.label), 
    value: opt.value 
  }));
  
  // Handle both single and multi values correctly
  const normalizedValues = Array.isArray(values) ? values : (values !== undefined ? [values] : []);

  const selectedValues = selectOptions.filter(opt => normalizedValues.includes(opt.value));
  
  if (creatable) {
    normalizedValues.forEach(val => {
      if (!selectedValues.find(opt => opt.value === val)) {
        selectedValues.push({ label: String(val), value: val });
      }
    });
  }

  const SelectComponent = creatable ? CreatableSelect : Select;

  return (
    <div style={{ flex: 1, minWidth: 200 }}>
      <SelectComponent
        isMulti={isMulti}
        options={creatable ? [] : selectOptions}
        value={isMulti ? selectedValues : selectedValues[0]}
        onChange={(selected: any) => {
          if (isMulti) {
            const newValues = selected ? selected.map((s: any) => s.value) : [];
            onChange(newValues);
          } else {
            onChange(selected ? [selected.value] : []);
          }
        }}
        placeholder={placeholder || (creatable ? "Type and press enter to add..." : "Select...")}
        styles={reactSelectStyles as any}
        menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
      />
    </div>
  );
}
