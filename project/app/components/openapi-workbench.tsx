import { lazy, Suspense, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useT } from '../i18n';
import { AddWorkbenchContext, WorkbenchContext, useWorkbenchStorage, useWorkspaceDocuments } from '../state/workbench-context';
import { createRequestForm } from '../utils/openapi-form';
import { collectApiSchemas, emptyOpenApi, generateOpenApi, httpMethods, newApiEndpoint, OPENAPI_STORAGE_KEY, OPENAPI_TAB_KEY, parseOpenApi, type ApiEndpoint, type ApiSchema, type OpenApiDefinition } from '../utils/openapi';
import { apiSourceRevision, snapshotApiSource } from '../utils/openapi-source';
import { serializeMarkup } from '../utils/markup';
import { Menubar, MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem } from './ui/menubar/menubar';
import styles from './openapi-workbench.module.css';
import { HelpTip } from './help-tip';

const SwaggerPreview = lazy(() => import('./openapi-preview'));
const tabs = ['design', 'schemas', 'json', 'yaml', 'preview'] as const;
type Tab = typeof tabs[number];

export function OpenApiWorkbench({ fileMenu }: { fileMenu: ReactNode }) {
  const t = useT();
  const storage = useWorkbenchStorage();
  const documents = useWorkspaceDocuments();
  const add = useContext(AddWorkbenchContext);
  const { documentId } = useContext(WorkbenchContext);
  const id = useId();
  const [definition, setDefinition] = useState<OpenApiDefinition>(() => {
    const saved = storage.getItem(OPENAPI_STORAGE_KEY);
    return saved ? parseOpenApi(saved) : emptyOpenApi();
  });
  const [tab, setTab] = useState<Tab>(() => {
    const saved = storage.getItem(OPENAPI_TAB_KEY);
    return tabs.find(tab => tab === saved) ?? 'design';
  });
  const [sourceId, setSourceId] = useState('');
  const [format, setFormat] = useState<'schema' | 'instance' | 'xml'>('schema');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => storage.setItem(OPENAPI_STORAGE_KEY, JSON.stringify(definition)), [definition, storage]);
  useEffect(() => storage.setItem(OPENAPI_TAB_KEY, tab), [tab, storage]);
  const generated = useMemo(() => {
    try {
      const document = generateOpenApi(definition);
      return { document, json: JSON.stringify(document, null, 2), yaml: serializeMarkup(document, 'yaml'), error: null };
    } catch (failure) {
      return { document: null, json: '', yaml: '', error: failure instanceof Error ? failure.message : t('openapi.failed') };
    }
  }, [definition, t]);
  const schemaNames = [...new Set(definition.sources.flatMap(source => Object.keys(source.schemas)))];
  const addSource = async (refreshId?: string) => {
    setError(null);
    const existing = definition.sources.find(source => source.id === refreshId);
    const bench = documents.find(bench => bench.id === (existing?.workbenchId ?? sourceId));
    if (!bench) { setError(t('openapi.chooseSource')); return; }
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setLoading(true);
    try {
      const snapshot = await snapshotApiSource(bench, existing?.format ?? format, controller.signal);
      if (controller.signal.aborted) return;
      collectApiSchemas([...definition.sources.filter(source => source.id !== refreshId), snapshot]);
      setDefinition(previous => ({
        ...previous,
        sources: existing ? previous.sources.map(source => source.id === refreshId ? { ...snapshot, id: source.id } : source)
          : [...previous.sources, snapshot],
        endpoints: existing ? previous.endpoints : [...previous.endpoints, ...snapshot.proposals],
      }));
    } catch (failure) {
      if (!controller.signal.aborted) {
        console.error('Failed to add OpenAPI source:', failure);
        setError(failure instanceof Error ? failure.message : t('openapi.failed'));
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };
  const updateEndpoint = (id: string, update: Partial<ApiEndpoint>) => setDefinition(previous => ({
    ...previous, endpoints: previous.endpoints.map(endpoint => endpoint.id === id ? { ...endpoint, ...update } : endpoint),
  }));
  const exportDocument = (format: 'json' | 'yaml') => {
    setError(null);
    try {
      if (!generated.document) throw new Error(generated.error ?? t('openapi.failed'));
      const url = URL.createObjectURL(new Blob([generated[format]], { type: format === 'json' ? 'application/json' : 'text/yaml' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `openapi.${format}`;
      document.body.appendChild(anchor);
      try { anchor.click(); } finally { anchor.remove(); URL.revokeObjectURL(url); }
    } catch (failure) {
      console.error('Failed to export OpenAPI:', failure);
      setError(failure instanceof Error ? failure.message : t('openapi.failed'));
    }
  };

  return <div className={styles.container}>
    <header className={styles.menu}>
      <strong>OpenAPI 3.1</strong>
      <Menubar>{fileMenu}<MenubarMenu>
        <MenubarTrigger>{t('openapi.title')}</MenubarTrigger>
        <MenubarContent>
          <MenubarItem disabled={!generated.document} onSelect={() => exportDocument('json')}>{t('openapi.exportJson')}</MenubarItem>
          <MenubarItem disabled={!generated.document} onSelect={() => exportDocument('yaml')}>{t('openapi.exportYaml')}</MenubarItem>
        </MenubarContent>
      </MenubarMenu></Menubar>
    </header>
    <div className={styles.tabs} role="tablist" aria-label={t('openapi.views')}>
      {tabs.map((name, index) => <button key={name} role="tab" id={`${id}-${name}-tab`}
        ref={node => { buttons.current[index] = node; }} aria-controls={`${id}-${name}-panel`}
        aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)}
        onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
            : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
          if (next < 0) return;
          event.preventDefault(); setTab(tabs[next]); buttons.current[next]?.focus();
        }}>{t(`openapi.tabs.${name}`)}</button>)}
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {generated.error && <p className={styles.error} role="alert">{generated.error}</p>}
    <main className={styles.panel} role="tabpanel" id={`${id}-${tab}-panel`} aria-labelledby={`${id}-${tab}-tab`}>
      {tab === 'design' && <>
        <HelpTip label={t('openapi.tabs.design')}>{t('openapi.hint')}</HelpTip>
        <div className={styles.fields}>
          {(['title', 'apiVersion', 'description', 'server'] as const).map(field => <label key={field}>
            {t(field === 'title' ? 'openapi.titleField' : `openapi.${field}`)}<input value={definition[field]} onChange={event => {
              const value = event.target.value;
              setDefinition(previous => ({ ...previous, [field]: value }));
            }} />
          </label>)}
        </div>
        <h2>{t('openapi.sources')}</h2>
        <div className={styles.fields}>
          <label>{t('openapi.source')}<select value={sourceId} disabled={loading} onChange={event => {
            const id = event.target.value;
            setSourceId(id);
            setFormat(documents.find(bench => bench.id === id)?.kind === 'xml' ? 'xml' : 'schema');
          }}>
            <option value="">{t('openapi.chooseSource')}</option>
            {documents.filter(bench => !['openapi', 'transform'].includes(bench.kind)).map(bench =>
              <option key={bench.id} value={bench.id}>{bench.name} ({bench.kind.toUpperCase()})</option>)}
          </select></label>
          {documents.find(bench => bench.id === sourceId)?.kind !== 'erd' && <label>{t('openapi.sourceFormat')}
            <select value={format} disabled={loading} onChange={event => {
              const value = event.target.value;
              if (value === 'schema' || value === 'instance' || value === 'xml') setFormat(value);
            }}>
              <option value="schema">{t('openapi.formats.schema')}</option>
              <option value="instance">{t('openapi.formats.instance')}</option>
              <option value="xml">{t('openapi.formats.xml')}</option>
            </select>
          </label>}
          <button disabled={!sourceId || loading} onClick={() => void addSource()}>{t(loading ? 'openapi.loading' : 'openapi.addSource')}</button>
        </div>
        <ul>{definition.sources.map(source => {
          const live = documents.find(bench => bench.id === source.workbenchId);
          return <li key={source.id}>
            <strong>{source.name}</strong> ({Object.keys(source.schemas).join(', ')})
            <button disabled={!live || loading} onClick={() => void addSource(source.id)}>{t('openapi.refresh')}</button>
            <button aria-label={t('openapi.removeSource', { name: source.name })} onClick={() => setDefinition(previous => ({
              ...previous, sources: previous.sources.filter(item => item.id !== source.id),
            }))}>{t('openapi.remove')}</button>
            {!live && <p role="status">{t('openapi.closedSource')}</p>}
            {live && source.revision !== apiSourceRevision(live) && <p role="status">{t('openapi.staleSource')}</p>}
            {source.diagnostics.map((message, index) => <p className={styles.warning} key={index}>{message}</p>)}
          </li>;
        })}</ul>
        <h2>{t('openapi.endpoints')}</h2>
        <HelpTip label={t('openapi.endpoints')}>{t('openapi.endpointHint')}</HelpTip>
        <button onClick={() => setDefinition(previous => ({ ...previous, endpoints: [...previous.endpoints, newApiEndpoint()] }))}>{t('openapi.addEndpoint')}</button>
        {definition.endpoints.map((endpoint, index) => <fieldset key={endpoint.id} className={styles.endpoint}>
          <legend>{t('openapi.endpoint', { number: index + 1 })}</legend>
          <div className={styles.fields}>
            <label className={styles.checkbox}><input type="checkbox" checked={endpoint.enabled}
              onChange={event => updateEndpoint(endpoint.id, { enabled: event.target.checked })} />{t('openapi.enabled')}</label>
            <label>{t('openapi.method')}<select value={endpoint.method} onChange={event => {
              const method = httpMethods.find(method => method === event.target.value)!;
              updateEndpoint(endpoint.id, { method, ...(['get', 'delete'].includes(method) ? { requestSchema: '' } : {}) });
            }}>{httpMethods.map(method => <option key={method} value={method}>{method.toUpperCase()}</option>)}</select></label>
            {(['path', 'operationId', 'summary'] as const).map(field => <label key={field}>{t(`openapi.${field}`)}
              <input value={endpoint[field]} onChange={event => updateEndpoint(endpoint.id, { [field]: event.target.value })} />
            </label>)}
            <label>{t('openapi.status')}<select value={endpoint.status} onChange={event => {
              const status = event.target.value;
              if (status === '200' || status === '201' || status === '204') updateEndpoint(endpoint.id, { status, ...(status === '204' ? { responseSchema: '' } : {}) });
            }}>{['200', '201', '204'].map(status => <option key={status}>{status}</option>)}</select></label>
            {(['requestSchema', 'responseSchema'] as const).map(field => <label key={field}>{t(`openapi.${field}`)}
              <select value={endpoint[field]} disabled={field === 'requestSchema' ? ['get', 'delete'].includes(endpoint.method) : endpoint.status === '204'}
                onChange={event => updateEndpoint(endpoint.id, { [field]: event.target.value })}>
                <option value="">{t('openapi.none')}</option>
                {endpoint[field] && !schemaNames.includes(endpoint[field]) && <option value={endpoint[field]}>{t('openapi.missing', { name: endpoint[field] })}</option>}
                {schemaNames.map(name => <option key={name}>{name}</option>)}
              </select>
            </label>)}
            <label className={styles.checkbox}><input type="checkbox" checked={endpoint.responseArray}
              onChange={event => updateEndpoint(endpoint.id, { responseArray: event.target.checked })} />{t('openapi.responseArray')}</label>
            <button onClick={() => setDefinition(previous => ({ ...previous, endpoints: previous.endpoints.filter(item => item.id !== endpoint.id) }))}>{t('openapi.remove')}</button>
            <button disabled={!add || !documentId || !generated.document || !endpoint.enabled || !endpoint.requestSchema || !['post', 'put', 'patch'].includes(endpoint.method)}
              onClick={() => {
                setError(null);
                try {
                  const source = documents.find(document => document.id === documentId);
                  if (!add || !source) throw new Error(t('collection.workspaceRequired'));
                  add(createRequestForm(definition, endpoint.id, source), true);
                } catch (failure) {
                  console.error('Failed to generate endpoint form:', failure);
                  setError(failure instanceof Error ? failure.message : t('openapi.failed'));
                }
              }}>{t('openapi.generateForm')}</button>
          </div>
        </fieldset>)}
      </>}
      {tab === 'schemas' && <>
        <HelpTip label={t('openapi.tabs.schemas')}>{t('openapi.schemaHint')}</HelpTip>
        {definition.sources.flatMap(source => Object.entries(source.schemas).map(([name, schema]) =>
          <SchemaEditor key={`${source.id}-${name}`} name={name} schema={schema} onSave={schema => {
            setDefinition(previous => ({
              ...previous, sources: previous.sources.map(item => item.id === source.id
                ? { ...item, schemas: { ...item.schemas, [name]: schema } } : item),
            }));
          }} />))}
      </>}
      {(tab === 'json' || tab === 'yaml') && <>
        <button disabled={!generated.document} onClick={() => exportDocument(tab)}>{t(tab === 'json' ? 'openapi.exportJson' : 'openapi.exportYaml')}</button>
        <label className={styles.editor}>{t('openapi.document')}<textarea spellCheck={false} readOnly value={generated[tab]} /></label>
      </>}
      {tab === 'preview' && <>
        <HelpTip label={t('openapi.tabs.preview')}>{t('openapi.previewHint')}</HelpTip>
        {generated.document && <Suspense fallback={<p role="status">{t('common.loading')}</p>}>
          <SwaggerPreview document={generated.document} />
        </Suspense>}
      </>}
    </main>
  </div>;
}

function SchemaEditor({ name, schema, onSave }: { name: string; schema: ApiSchema; onSave: (schema: ApiSchema) => void }) {
  const t = useT();
  const [text, setText] = useState(() => JSON.stringify(schema, null, 2));
  const [error, setError] = useState<string | null>(null);
  return <section>
    <label className={styles.editor}>{name}<textarea value={text} spellCheck={false} onChange={event => setText(event.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    <button onClick={() => {
      try {
        const value: unknown = JSON.parse(text);
        if (!(typeof value === 'boolean' || value && typeof value === 'object' && !Array.isArray(value))) throw new Error(t('openapi.schemaRequired'));
        onSave(value as ApiSchema); setError(null);
      } catch (failure) {
        console.error('Failed to update OpenAPI schema:', failure);
        setError(failure instanceof Error ? failure.message : t('openapi.failed'));
      }
    }}>{t('openapi.applySchema', { name })}</button>
  </section>;
}
