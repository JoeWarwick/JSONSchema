import { useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode, type SetStateAction } from 'react';
import { useT } from '../i18n';
import { AddWorkbenchContext, useWorkbenchStorage, useWorkspaceDocuments } from '../state/workbench-context';
import {
  emptyTransform, flattenTransformNodes, generateXslt, parseTransform, parseTransformXml,
  TRANSFORM_STORAGE_KEY, TRANSFORM_TAB_KEY, xmlStructure,
  MAX_TRANSFORM_OUTPUTS, PRIMARY_OUTPUT_ID, readTransformResults, transformOutputs,
  type MappingRule, type TransformDefinition, type TransformNode, type TransformResultDocument,
} from '../utils/transform';
import {
  datasourceRevision, datasourceSchema, isXmlDatasource, readApiResponse, schemaRoots, snapshotDatasource,
} from '../utils/transform-datasource';
import { Menubar, MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem } from './ui/menubar/menubar';
import styles from './transform-workbench.module.css';
import { XmlCollectionDialog } from './xml-collection-dialog';
import type { WorkbenchDocument } from '../state/workspace';
import { TransformResultsDialog } from './transform-results-dialog';
import { HelpTip } from './help-tip';

const tabNames = ['mapping', 'xslt', 'preview'] as const;
type TransformTab = typeof tabNames[number];

function nodeLabel(node: TransformNode): string {
  return `${'  '.repeat(node.steps.length - 1)}${node.label}${node.repeated ? ' []' : ''}`;
}

function withCollection(definition: TransformDefinition, role: 'source' | 'target', bench: WorkbenchDocument): TransformDefinition {
  const previousSnapshot = definition[role]!;
  const xml = bench.entries['schema-sculptor-instance-xml'];
  const root = xmlStructure(xml);
  const replacements = new Map(flattenTransformNodes(xmlStructure(previousSnapshot.xml))
    .map(node => [node.id, JSON.stringify([...root.steps, ...node.steps])]));
  return {
    ...definition,
    [role]: {
      workbenchId: bench.id, name: bench.name, revision: datasourceRevision(bench), xml,
      schema: datasourceSchema(bench), rootElement: root.steps[0].name,
    },
    input: role === 'source' && definition.input === previousSnapshot.xml ? xml : definition.input,
    mappings: definition.mappings.map(rule => ({
      ...rule, [role]: replacements.get(rule[role]) ?? rule[role],
    })),
  };
}

export function TransformWorkbench({ fileMenu }: { fileMenu: ReactNode }) {
  const t = useT();
  const storage = useWorkbenchStorage();
  const documents = useWorkspaceDocuments();
  const add = useContext(AddWorkbenchContext);
  const id = useId();
  const [storedDefinition, setStoredDefinition] = useState<TransformDefinition>(() => {
    const saved = storage.getItem(TRANSFORM_STORAGE_KEY);
    return saved ? parseTransform(saved) : emptyTransform();
  });
  const [activeOutput, setActiveOutput] = useState(PRIMARY_OUTPUT_ID);
  const outputs = transformOutputs(storedDefinition);
  const selectedOutput = outputs.find(output => output.id === activeOutput) ?? outputs[0];
  const definition: TransformDefinition = {
    ...storedDefinition, target: selectedOutput.target, mappings: selectedOutput.mappings, outputs: undefined,
  };
  const setDefinition = (update: SetStateAction<TransformDefinition>) => {
    setStoredDefinition(previous => {
      const output = transformOutputs(previous).find(output => output.id === activeOutput)!;
      const current = { ...previous, target: output.target, mappings: output.mappings, outputs: undefined };
      const next = typeof update === 'function' ? update(current) : update;
      return activeOutput === PRIMARY_OUTPUT_ID
        ? { ...next, outputs: previous.outputs }
        : {
          ...previous, source: next.source, input: next.input,
          outputs: previous.outputs?.map(output => output.id === activeOutput
            ? { ...output, target: next.target, mappings: next.mappings } : output),
        };
    });
  };
  const [tab, setTab] = useState<TransformTab>(() => {
    const saved = storage.getItem(TRANSFORM_TAB_KEY);
    return saved === 'xslt' || saved === 'preview' ? saved : 'mapping';
  });
  const [sourceField, setSourceField] = useState('');
  const [targetField, setTargetField] = useState('');
  const [mode, setMode] = useState<MappingRule['mode']>('value');
  const [constant, setConstant] = useState('');
  const [templateMode, setTemplateMode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<'source' | 'target' | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState('');
  const [results, setResults] = useState<TransformResultDocument[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [collectionRole, setCollectionRole] = useState<'source' | 'target' | 'both' | null>(null);
  const request = useRef<AbortController | null>(null);

  const rebaseOtherSourceMappings = (bench: WorkbenchDocument) => {
    setStoredDefinition(previous => {
      const rebase = (mappings: MappingRule[]) => withCollection({ ...storedDefinition, mappings }, 'source', bench).mappings;
      return {
        ...previous,
        mappings: activeOutput === PRIMARY_OUTPUT_ID ? previous.mappings : rebase(previous.mappings),
        outputs: previous.outputs?.map(output => output.id === activeOutput ? output : { ...output, mappings: rebase(output.mappings) }),
      };
    });
  };

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    storage.setItem(TRANSFORM_STORAGE_KEY, JSON.stringify(storedDefinition));
  }, [storedDefinition, storage]);
  useEffect(() => { storage.setItem(TRANSFORM_TAB_KEY, tab); }, [tab, storage]);
  useEffect(() => { setResult(''); setResults([]); setShowResults(false); }, [storedDefinition]);

  const structures = useMemo(() => {
    try {
      return {
        source: definition.source ? flattenTransformNodes(xmlStructure(definition.source.xml)) : [],
        target: definition.target ? flattenTransformNodes(xmlStructure(definition.target.xml)) : [],
        error: null,
      };
    } catch (failure) {
      return { source: [], target: [], error: failure instanceof Error ? failure.message : t('transform.invalidStructure') };
    }
  }, [definition.source, definition.target, t]);
  const generated = useMemo(() => {
    try {
      return { xslt: generateXslt(storedDefinition), error: null };
    } catch (failure) {
      return { xslt: '', error: failure instanceof Error ? failure.message : t('transform.generationError') };
    }
  }, [storedDefinition, t]);

  const selectDatasource = async (role: 'source' | 'target', workbenchId: string, root?: string) => {
    const bench = documents.find(item => item.id === workbenchId);
    if (!bench) { setError(t('transform.datasourceMissing')); return; }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(role);
    setError(null);
    try {
      const snapshot = await snapshotDatasource(bench, root, controller.signal);
      if (controller.signal.aborted) return;
      setDefinition(previous => ({
        ...previous, [role]: snapshot,
        input: role === 'source' && (!previous.source || previous.source.workbenchId !== snapshot.workbenchId
          || previous.input === previous.source.xml) ? snapshot.xml : previous.input,
      }));
      setSourceField('');
      setTargetField('');
    } catch (failure) {
      if (!controller.signal.aborted) {
        console.error('Failed to select Transform datasource:', failure);
        setError(failure instanceof Error ? failure.message : t('transform.datasourceError'));
      }
    } finally {
      if (!controller.signal.aborted) setLoading(null);
    }
  };

  const exportXslt = () => {
    setError(null);
    try {
      if (!generated.xslt) throw new Error(generated.error ?? t('transform.generationError'));
      const url = URL.createObjectURL(new Blob([generated.xslt], { type: 'application/xslt+xml' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'transform.xslt';
      document.body.appendChild(anchor);
      try { anchor.click(); } finally { anchor.remove(); URL.revokeObjectURL(url); }
    } catch (failure) {
      console.error('Failed to export XSLT:', failure);
      setError(failure instanceof Error ? failure.message : t('transform.exportError'));
    }
  };

  const run = async () => {
    setError(null);
    setResult('');
    setResults([]);
    setShowResults(false);
    try {
      if (!generated.xslt) throw new Error(generated.error ?? t('transform.generationError'));
      parseTransformXml(definition.input);
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setRunning(true);
      const response = await fetch('/api/transform/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: definition.input, stylesheet: generated.xslt }), signal: controller.signal,
      });
      const body = await readApiResponse(response);
      if (typeof body.xml !== 'string') throw new Error(t('transform.invalidResult'));
      if (!controller.signal.aborted) {
        const documents = readTransformResults(body.xml, storedDefinition);
        setResult(body.xml);
        setResults(documents);
        if (storedDefinition.outputs?.length) setShowResults(true);
      }
    } catch (failure) {
      if (!request.current?.signal.aborted) {
        console.error('Transform preview failed:', failure);
        setError(failure instanceof Error ? failure.message : t('transform.previewError'));
      }
    } finally {
      setRunning(false);
    }
  };

  const datasourceControl = (role: 'source' | 'target') => {
    const snapshot = definition[role];
    const live = documents.find(bench => bench.id === snapshot?.workbenchId);
    const stale = !!snapshot && !!live && snapshot.revision !== datasourceRevision(live);
    let roots: string[] = [];
    let schemaError: string | null = null;
    if (snapshot?.schema) {
      // Snapshot XML/schema errors are also displayed in the structure diagnostics.
      try { roots = schemaRoots(snapshot.schema); } catch (failure) {
        console.error('Invalid Transform schema snapshot:', failure);
        schemaError = failure instanceof Error ? failure.message : t('transform.invalidStructure');
      }
    }
    return <section className={styles.datasource}>
      <label>{t(`transform.${role}`)}
        <select value={snapshot?.workbenchId ?? ''} disabled={loading !== null || running}
          onChange={event => { if (event.target.value) void selectDatasource(role, event.target.value); }}>
          <option value="">{t('transform.chooseDatasource')}</option>
          {documents.filter(bench => bench.kind !== 'transform' && bench.kind !== 'openapi').map(bench =>
            <option key={bench.id} value={bench.id} disabled={!isXmlDatasource(bench)}>{bench.name} ({bench.kind.toUpperCase()})</option>)}
          {snapshot && !live && <option value={snapshot.workbenchId}>{snapshot.name} ({t('transform.snapshotOnly')})</option>}
        </select>
      </label>
      {roots.length > 1 && <label>{t('transform.rootElement')}
        <select value={snapshot?.rootElement ?? ''} disabled={loading !== null || running || !live}
          onChange={event => { if (snapshot) void selectDatasource(role, snapshot.workbenchId, event.target.value); }}>
          {!roots.includes(snapshot?.rootElement ?? '') && <option value="">{snapshot?.rootElement}</option>}
          {roots.map(root => <option key={root} value={root}>{root}</option>)}
        </select>
      </label>}
      {snapshot && <button disabled={!live || !isXmlDatasource(live) || loading !== null || running}
        onClick={() => void selectDatasource(role, snapshot.workbenchId,
          live?.entries['schema-sculptor-instance-xml']?.trim() ? undefined : snapshot.rootElement || undefined)}>{t('transform.refresh')}</button>}
      {snapshot && <button disabled={loading !== null || running} onClick={() => setCollectionRole(role)}>
        {t('collection.title')}
      </button>}
      {stale && <p role="status">{t('transform.sourceChanged')}</p>}
      {snapshot && !live && <p role="status">{t('transform.closedSource')}</p>}
      {schemaError && <p role="alert">{schemaError}</p>}
    </section>;
  };

  const sourceMap = new Map(structures.source.map(node => [node.id, node]));
  const targetMap = new Map(structures.target.map(node => [node.id, node]));
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  return <div className={styles.container}>
    <header className={styles.menu}>
      <strong>{t('transform.title')}</strong>
      <Menubar>
        {fileMenu}
        <MenubarMenu>
          <MenubarTrigger>{t('transform.title')}</MenubarTrigger>
          <MenubarContent>
            <MenubarItem disabled={!generated.xslt} onSelect={exportXslt}>{t('transform.export')}</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
    </header>
    <div className={styles.tabs} role="tablist" aria-label={t('transform.views')}>
      {tabNames.map((name, index) => <button key={name} ref={node => { tabs.current[index] = node; }}
        id={`${id}-${name}-tab`} role="tab" aria-controls={`${id}-${name}-panel`} aria-selected={tab === name}
        tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)}
        onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % tabNames.length
            : event.key === 'ArrowLeft' ? (index + tabNames.length - 1) % tabNames.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? tabNames.length - 1 : -1;
          if (next < 0) return;
          event.preventDefault();
          setTab(tabNames[next]);
          tabs.current[next]?.focus();
        }}>{t(`transform.tabs.${name}`)}</button>)}
    </div>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {loading && <p role="status">{t('transform.loadingDatasource')}</p>}
    {showResults && <TransformResultsDialog results={results} onClose={() => setShowResults(false)} />}
    {collectionRole === 'both' && definition.source && definition.target && <XmlCollectionDialog
      input={definition.source} targetInput={definition.target} onClose={() => setCollectionRole(null)}
      onPairCreated={(source, target) => {
        const next = withCollection(withCollection(definition, 'source', source), 'target', target);
        const sourceRecord = xmlStructure(next.source!.xml).children.find(node => !node.steps.at(-1)?.attribute)!;
        const targetRecord = xmlStructure(next.target!.xml).children.find(node => !node.steps.at(-1)?.attribute)!;
        if (!next.mappings.some(rule => rule.target === targetRecord.id)) {
          next.mappings.unshift({
            id: crypto.randomUUID(), mode: 'repeat', source: sourceRecord.id,
            target: targetRecord.id, constant: '',
          });
        }
        setDefinition(next);
        rebaseOtherSourceMappings(source);
        setSourceField('');
        setTargetField('');
      }} />}
    {collectionRole && collectionRole !== 'both' && definition[collectionRole] && <XmlCollectionDialog
      input={definition[collectionRole]!} onClose={() => setCollectionRole(null)}
      onCreated={bench => {
        setDefinition(withCollection(definition, collectionRole, bench));
        if (collectionRole === 'source') rebaseOtherSourceMappings(bench);
        setSourceField('');
        setTargetField('');
      }} />}
    <main className={styles.panel} role="tabpanel" id={`${id}-${tab}-panel`} aria-labelledby={`${id}-${tab}-tab`}>
      <div className={styles.toolbar}>
        <label>{t('transform.outputs.active')}
          <select value={selectedOutput.id} disabled={running || loading !== null || !!collectionRole}
            onChange={event => { setActiveOutput(event.target.value); setSourceField(''); setTargetField(''); setError(null); }}>
            {outputs.map(output => <option key={output.id} value={output.id}>{output.name}</option>)}
          </select>
        </label>
        {tab === 'mapping' && <>
          <button disabled={running || loading !== null || outputs.length >= MAX_TRANSFORM_OUTPUTS} onClick={() => {
            const id = crypto.randomUUID();
            setStoredDefinition(previous => ({
              ...previous, outputs: [...(previous.outputs ?? []), { id, name: t('transform.outputs.defaultName', { number: outputs.length + 1 }), target: null, mappings: [] }],
            }));
            setActiveOutput(id);
            setSourceField('');
            setTargetField('');
          }}>{t('transform.outputs.add')}</button>
          {selectedOutput.id !== PRIMARY_OUTPUT_ID && <>
            <label>{t('transform.outputs.name')}<input value={selectedOutput.name} disabled={running || loading !== null}
              onChange={event => setStoredDefinition(previous => ({
                ...previous, outputs: previous.outputs?.map(output => output.id === activeOutput ? { ...output, name: event.target.value } : output),
              }))} /></label>
            <button disabled={running || loading !== null} onClick={() => {
              setStoredDefinition(previous => ({ ...previous, outputs: previous.outputs?.filter(output => output.id !== activeOutput) }));
              setActiveOutput(PRIMARY_OUTPUT_ID);
              setSourceField('');
              setTargetField('');
            }}>{t('transform.outputs.remove')}</button>
          </>}
        </>}
      </div>
      {tab === 'mapping' && <>
        <HelpTip label={t('transform.source')}>{t('transform.datasourceHint')}</HelpTip>
        <div className={styles.sources}>{datasourceControl('source')}{datasourceControl('target')}</div>
        <button disabled={!definition.source || !definition.target || !!structures.error || loading !== null || running}
          onClick={() => setCollectionRole('both')}>{t('collection.pairTitle')}</button>
        <HelpTip label={t('transform.mappingRules')}>{t('transform.scopeHint')}</HelpTip>
        <form className={styles.mappingForm} onSubmit={event => {
          event.preventDefault();
          setError(null);
          if (!targetField || (mode !== 'constant' && !sourceField)) {
            setError(t('transform.chooseFields'));
            return;
          }
          if (definition.mappings.some(rule => rule.target === targetField)) {
            setError(t('transform.duplicateTarget'));
            return;
          }
          setDefinition(previous => ({
            ...previous, mappings: [...previous.mappings, {
              id: crypto.randomUUID(), target: targetField, mode, source: sourceField, constant,
              ...(mode === 'repeat' ? { templateMode: templateMode.trim() } : {}),
            }],
          }));
          setTemplateMode('');
        }}>
          <label>{t('transform.sourceField')}
            <select value={sourceField} onChange={event => setSourceField(event.target.value)} disabled={mode === 'constant' || running}>
              <option value="">{t('transform.chooseField')}</option>
              {structures.source.map(node => <option key={node.id} value={node.id}>{nodeLabel(node)}</option>)}
            </select>
          </label>
          <label>{t('transform.operation')}
            <select value={mode} disabled={running} onChange={event => {
              if (event.target.value === 'value' || event.target.value === 'constant' || event.target.value === 'repeat') setMode(event.target.value);
            }}>
              <option value="value">{t('transform.modes.value')}</option>
              <option value="constant">{t('transform.modes.constant')}</option>
              <option value="repeat">{t('transform.modes.repeat')}</option>
            </select>
          </label>
          {mode === 'constant' && <label>{t('transform.constant')}
            <input value={constant} disabled={running} onChange={event => setConstant(event.target.value)} />
          </label>}
          {mode === 'repeat' && <label>{t('transform.templateMode')}
            <input value={templateMode} disabled={running} placeholder={t('transform.automaticMode')}
              spellCheck={false}
              onChange={event => setTemplateMode(event.target.value)} />
          </label>}
          <label>{t('transform.targetField')}
            <select value={targetField} disabled={running} onChange={event => setTargetField(event.target.value)}>
              <option value="">{t('transform.chooseField')}</option>
              {structures.target.map(node => <option key={node.id} value={node.id}>{nodeLabel(node)}</option>)}
            </select>
          </label>
          <button type="submit" disabled={running || !definition.source || !definition.target}>{t('transform.addMapping')}</button>
        </form>
        {(mode === 'repeat' || definition.mappings.some(rule => rule.mode === 'repeat')) &&
          <HelpTip label={t('transform.templateMode')}>{t('transform.templateModeHint')}</HelpTip>}
        <table className={styles.mappings}>
          <caption>{t('transform.mappingRules')}</caption>
          <thead><tr><th>{t('transform.sourceField')}</th><th>{t('transform.operation')}</th><th>{t('transform.targetField')}</th><th>{t('transform.templateMode')}</th><th>{t('transform.actions')}</th></tr></thead>
          <tbody>{definition.mappings.map(rule => <tr key={rule.id}>
            <td>{rule.mode === 'constant' ? rule.constant : sourceMap.get(rule.source)?.steps.map(step => `${step.attribute ? '@' : ''}${step.name}`).join('/') ?? t('transform.missingField')}</td>
            <td>{t(`transform.modes.${rule.mode}`)}</td>
            <td>{targetMap.get(rule.target)?.steps.map(step => `${step.attribute ? '@' : ''}${step.name}`).join('/') ?? t('transform.missingField')}</td>
            <td>{rule.mode === 'repeat' ? <input value={rule.templateMode ?? ''} disabled={running}
              aria-label={t('transform.mappingTemplateMode', { number: definition.mappings.indexOf(rule) + 1 })}
              placeholder={t('transform.automaticMode')} spellCheck={false}
              onChange={event => {
                const templateMode = event.target.value;
                setDefinition(previous => ({
                  ...previous, mappings: previous.mappings.map(item => item.id === rule.id ? { ...item, templateMode } : item),
                }));
              }} /> : '-'}</td>
            <td><button disabled={running} aria-label={t('transform.removeMapping', { number: definition.mappings.indexOf(rule) + 1 })}
              onClick={() => setDefinition(previous => ({ ...previous, mappings: previous.mappings.filter(item => item.id !== rule.id) }))}>{t('transform.remove')}</button></td>
          </tr>)}</tbody>
        </table>
        {structures.error && <p role="alert">{structures.error}</p>}
        {generated.error && <p role="status">{generated.error}</p>}
      </>}
      {tab === 'xslt' && <>
        <HelpTip label={t('transform.stylesheet')}>{t('transform.generatedHint')}</HelpTip>
        <button onClick={exportXslt} disabled={!generated.xslt}>{t('transform.export')}</button>
        {generated.error && <p role="alert">{generated.error}</p>}
        <label className={styles.editor}>{t('transform.stylesheet')}
          <textarea spellCheck={false} readOnly value={generated.xslt} />
        </label>
      </>}
      {tab === 'preview' && <>
        <HelpTip label={t('transform.tabs.preview')}>{t('transform.previewHint')}</HelpTip>
        <div className={styles.toolbar}>
          <button disabled={!definition.source || running} onClick={() => {
            if (definition.source) { setError(null); setDefinition(previous => ({ ...previous, input: previous.source!.xml })); }
          }}>{t('transform.resetInput')}</button>
          <button disabled={!generated.xslt || running || loading !== null} onClick={() => void run()}>
            {t(running ? 'transform.running' : 'transform.run')}
          </button>
          <button disabled={!add || !results.length || running} onClick={() => setShowResults(true)}>
            {t('transform.outputs.importTitle')}
          </button>
        </div>
        {generated.error && <p role="status">{generated.error}</p>}
        <div className={styles.preview}>
          <label className={styles.editor}>{t('transform.input')}
            <textarea value={definition.input} disabled={running} spellCheck={false}
              onChange={event => { setError(null); setDefinition(previous => ({ ...previous, input: event.target.value })); }} />
          </label>
          <label className={styles.editor}>{t('transform.result')}
            <textarea readOnly spellCheck={false} value={results.find(output => output.id === selectedOutput.id)?.xml ?? result} />
          </label>
        </div>
      </>}
    </main>
  </div>;
}
