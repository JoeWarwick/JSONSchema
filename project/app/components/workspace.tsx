import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '../i18n';
import { parseMarkup, detectMarkupLanguageFromPath } from '../utils/markup';
import { parseDbContextFiles } from '../utils/csharp-dbcontext-parser';
import {
  contentFingerprint, createWorkbench, createWorkbenchStorage, exportWorkbench, importWorkbench,
  migrateLegacyWorkspace, parseWorkspace, WORKSPACE_STORAGE_KEY,
  type WorkbenchDocument, type WorkbenchKind, type WorkspaceDocument,
} from '../state/workspace';
import { AddWorkbenchContext, WorkbenchContext, WorkspaceDocumentsContext, type WorkbenchEnvironment } from '../state/workbench-context';
import {
  Menubar, MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem,
  MenubarSeparator, MenubarSub, MenubarSubTrigger, MenubarSubContent,
} from './ui/menubar/menubar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog/dialog';
import styles from './workspace.module.css';

const kinds: WorkbenchKind[] = ['json', 'yaml', 'xml', 'erd', 'transform', 'openapi'];

function downloadWorkbench(bench: WorkbenchDocument) {
  const url = URL.createObjectURL(new Blob([exportWorkbench(bench)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${bench.name.replace(/[<>:"/\\|?*]/g, '_')}.workbench.json`;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}

export function Workspace({ renderWorkbench }: { renderWorkbench: (fileMenu: ReactNode, kind: WorkbenchKind) => ReactNode }) {
  const t = useT();
  const translate = useRef(t);
  translate.current = t;
  const [workspace, setWorkspace] = useState<WorkspaceDocument | null>(null);
  const [, setRevision] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [closeId, setCloseId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [pendingFile, setPendingFile] = useState<{ name: string; text: string } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const current = useRef<WorkspaceDocument | null>(null);
  const environments = useRef(new Map<string, WorkbenchEnvironment>());
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const tabs = useRef(new Map<string, HTMLButtonElement>());
  const focusAfterClose = useRef<string | null>(null);

  const persist = useCallback(() => {
    if (!current.current) return;
    try {
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(current.current));
      setStorageError(null);
    } catch (error) {
      console.error('Failed to save workspace:', error);
      setStorageError(translate.current('workspace.storageError'));
    }
  }, []);

  const changed = useCallback(() => {
    if (changeTimer.current !== null) clearTimeout(changeTimer.current);
    changeTimer.current = setTimeout(() => {
      changeTimer.current = null;
      setRevision(revision => revision + 1);
      persist();
    }, 50);
  }, [persist]);

  const updateWorkspace = (next: WorkspaceDocument) => {
    current.current = next;
    setWorkspace(next);
    persist();
  };

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
      const loaded = saved ? parseWorkspace(saved) : migrateLegacyWorkspace(window.localStorage);
      current.current = loaded;
      setWorkspace(loaded);
      persist();
    } catch (error) {
      console.error('Failed to load workspace:', error);
      setLoadError(error instanceof Error ? error.message : translate.current('workspace.loadError'));
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      persist();
      if (current.current?.workbenches.some(bench => contentFingerprint(bench) !== bench.savedContent)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      if (changeTimer.current !== null) clearTimeout(changeTimer.current);
      // Flush pending editor writes on navigation as well as browser refresh.
      if (current.current) {
        try {
          window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(current.current));
        } catch (error) {
          console.error('Failed to save workspace on navigation:', error);
          toast.error(translate.current('workspace.storageError'));
        }
      }
    };
  }, [persist]);

  useEffect(() => {
    if (workspace?.activeId) {
      tabs.current.get(workspace.activeId)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
    if (focusAfterClose.current) {
      tabs.current.get(focusAfterClose.current)?.focus();
      focusAfterClose.current = null;
    }
  }, [workspace]);

  const add = (bench: WorkbenchDocument | WorkbenchDocument[], activate = true) => {
    if (!current.current) return;
    const benches = Array.isArray(bench) ? bench : [bench];
    if (!benches.length) throw new Error('At least one workbench is required.');
    updateWorkspace({
      ...current.current, activeId: activate ? benches[0].id : current.current.activeId,
      workbenches: [...current.current.workbenches, ...benches],
    });
  };

  const newWorkbench = (kind: WorkbenchKind) => {
    const existing = current.current?.workbenches ?? [];
    const label = t(`workspace.kinds.${kind}`);
    let number = 1;
    while (existing.some(bench => bench.name === `${label} ${number}`)) number += 1;
    add(createWorkbench(kind, crypto.randomUUID(), `${label} ${number}`));
  };

  const activate = (id: string) => {
    if (current.current) updateWorkspace({ ...current.current, activeId: id });
  };

  const save = (bench: WorkbenchDocument): boolean => {
    try {
      downloadWorkbench(bench);
      bench.savedContent = contentFingerprint(bench);
      changed();
      return true;
    } catch (error) {
      console.error('Failed to export workbench:', error);
      toast.error(t('workspace.saveError'));
      return false;
    }
  };

  const remove = (id: string) => {
    const value = current.current;
    if (!value) return;
    const index = value.workbenches.findIndex(bench => bench.id === id);
    const remaining = value.workbenches.filter(bench => bench.id !== id);
    environments.current.delete(id);
    const activeId = value.activeId === id ? remaining[Math.min(index, remaining.length - 1)]?.id ?? null : value.activeId;
    focusAfterClose.current = activeId;
    updateWorkspace({
      ...value, workbenches: remaining, activeId,
    });
    setCloseId(null);
  };

  const requestClose = (bench: WorkbenchDocument) => {
    if (contentFingerprint(bench) !== bench.savedContent) setCloseId(bench.id);
    else remove(bench.id);
  };

  const openSource = (file: { name: string; text: string }, role: 'schema' | 'instance') => {
    const language = detectMarkupLanguageFromPath(file.name);
    const parsed = parseMarkup(file.text, language);
    if (role === 'schema' && (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))) {
      throw new Error(t('workspace.schemaObjectRequired'));
    }
    const bench = createWorkbench(language, crypto.randomUUID(), file.name);
    if (role === 'schema') {
      bench.entries[language === 'xml' ? 'schema-sculptor-schema-xml' : 'schema-sculptor-schema'] = JSON.stringify(parsed);
      bench.entries['schema-sculptor-active-tab'] = 'xmlschema';
    } else {
      bench.entries[`schema-sculptor-instance-${language}`] = file.text;
    }
    bench.savedContent = contentFingerprint(bench);
    add(bench);
    setPendingFile(null);
    setImportError(null);
  };

  const openFiles = async (files: File[]) => {
    try {
      if (files.every(file => file.name.toLowerCase().endsWith('.cs'))) {
        const sourceFiles = await Promise.all(files.map(async file => ({ name: file.name, content: await file.text() })));
        const model = parseDbContextFiles(sourceFiles);
        const bench = createWorkbench('erd', crypto.randomUUID(), files[0].name);
        bench.entries['schema-sculptor-erd'] = JSON.stringify(model);
        bench.savedContent = contentFingerprint(bench);
        add(bench);
        return;
      }
      if (files.length !== 1) throw new Error(t('workspace.oneFileRequired'));
      const file = { name: files[0].name, text: await files[0].text() };
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.workbench.json')) add(importWorkbench(file.text, crypto.randomUUID()));
      else if (lower.endsWith('.xsd')) openSource(file, 'schema');
      else if (/\.(json|ya?ml|xml)$/.test(lower)) {
        setImportError(null);
        setPendingFile(file);
      } else throw new Error(t('workspace.unsupportedFile'));
    } catch (error) {
      console.error('Failed to open workbench:', error);
      toast.error(error instanceof Error ? error.message : t('workspace.openError'));
    }
  };

  if (loadError) {
    return <div className={styles.message} role="alert">
      <h1>{t('workspace.loadError')}</h1><p>{loadError}</p>
      <p>{t('workspace.recoveryHint')}</p>
    </div>;
  }
  if (!workspace) return <div className={styles.message}>{t('common.loading')}</div>;

  const active = workspace.workbenches.find(bench => bench.id === workspace.activeId);
  const closing = workspace.workbenches.find(bench => bench.id === closeId);
  const fileMenu = (
    <MenubarMenu>
      <MenubarTrigger>{t('workspace.file')}</MenubarTrigger>
      <MenubarContent>
        <MenubarSub>
          <MenubarSubTrigger>{t('workspace.new')}</MenubarSubTrigger>
          <MenubarSubContent>
            {kinds.map(kind => <MenubarItem key={kind} onSelect={() => newWorkbench(kind)}>
              {t('workspace.newWorkbench', { kind: t(`workspace.kinds.${kind}`) })}
            </MenubarItem>)}
          </MenubarSubContent>
        </MenubarSub>
        <MenubarItem onSelect={() => fileInput.current?.click()}>{t('workspace.open')}</MenubarItem>
        <MenubarSeparator />
        <MenubarItem disabled={!active} onSelect={() => { if (active) save(active); }}>{t('workspace.save')}</MenubarItem>
        <MenubarItem disabled={!active} onSelect={() => {
          if (active) { setRenameId(active.id); setName(active.name); }
        }}>{t('workspace.rename')}</MenubarItem>
        <MenubarItem disabled={!active} onSelect={() => { if (active) requestClose(active); }}>{t('workspace.close')}</MenubarItem>
      </MenubarContent>
    </MenubarMenu>
  );

  return <div className={styles.workspace}>
    <input ref={fileInput} type="file" aria-label={t('workspace.open')} hidden multiple
      accept=".workbench.json,.json,.yaml,.yml,.xml,.xsd,.cs"
      onChange={event => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        if (files.length > 0) void openFiles(files);
      }} />
    {storageError && <div className={styles.storageError} role="alert">{storageError}</div>}
    <div className={styles.editors}>
      {workspace.workbenches.map(bench => {
        let environment = environments.current.get(bench.id);
        if (!environment) {
          environment = { documentId: bench.id, storage: createWorkbenchStorage(bench.entries, changed), runtime: {} };
          environments.current.set(bench.id, environment);
        }
        return <div key={bench.id} className={styles.workbench} role="tabpanel"
          ref={node => { if (node) node.inert = bench.id !== workspace.activeId; }}
          id={`panel-${bench.id}`} aria-labelledby={`tab-${bench.id}`} hidden={bench.id !== workspace.activeId}>
          <WorkspaceDocumentsContext.Provider value={[...workspace.workbenches]}>
            <AddWorkbenchContext.Provider value={add}>
              <WorkbenchContext.Provider value={environment}>{renderWorkbench(fileMenu, bench.kind)}</WorkbenchContext.Provider>
            </AddWorkbenchContext.Provider>
          </WorkspaceDocumentsContext.Provider>
        </div>;
      })}
      {workspace.workbenches.length === 0 && <>
        <Menubar>{fileMenu}</Menubar>
        <div className={styles.message}>{t('workspace.empty')}</div>
      </>}
    </div>
    <div className={styles.bottomBar}>
      <div className={styles.tabs} role="tablist" aria-label={t('workspace.workbenches')}>
        {workspace.workbenches.map(bench => {
          const dirty = contentFingerprint(bench) !== bench.savedContent;
          return <div key={bench.id} className={styles.tabGroup}>
            <button ref={node => { if (node) tabs.current.set(bench.id, node); else tabs.current.delete(bench.id); }}
              id={`tab-${bench.id}`} role="tab" aria-selected={workspace.activeId === bench.id}
              aria-controls={`panel-${bench.id}`} tabIndex={workspace.activeId === bench.id ? 0 : -1}
              title={bench.name} className={styles.tab} onClick={() => activate(bench.id)}
              onKeyDown={event => {
                const index = workspace.workbenches.findIndex(item => item.id === bench.id);
                let next: number;
                if (event.key === 'ArrowRight') next = (index + 1) % workspace.workbenches.length;
                else if (event.key === 'ArrowLeft') next = (index - 1 + workspace.workbenches.length) % workspace.workbenches.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = workspace.workbenches.length - 1;
                else if (event.key === 'Delete') { event.preventDefault(); requestClose(bench); return; }
                else return;
                event.preventDefault();
                const nextId = workspace.workbenches[next].id;
                activate(nextId);
                tabs.current.get(nextId)?.focus();
              }}>
              <span className={styles.kind}>{bench.kind.toUpperCase()}</span>
              {bench.name}{dirty && <span aria-label={t('workspace.modified')}> *</span>}
            </button>
            <button className={styles.close} aria-label={t('workspace.closeNamed', { name: bench.name })}
              onClick={() => requestClose(bench)}><X size={12} /></button>
          </div>;
        })}
      </div>
      <button className={styles.add} aria-label={t('workspace.add')} onClick={() => newWorkbench('json')}>
        <Plus size={14} />
      </button>
    </div>
    <Dialog open={!!closing} onOpenChange={open => { if (!open) setCloseId(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('workspace.unsavedTitle')}</DialogTitle></DialogHeader>
        <p>{t('workspace.unsavedDescription', { name: closing?.name ?? '' })}</p>
        <DialogFooter>
          <button onClick={() => setCloseId(null)}>{t('common.cancel')}</button>
          <button onClick={() => { if (closing) remove(closing.id); }}>{t('workspace.discard')}</button>
          <button onClick={() => { if (closing && save(closing)) remove(closing.id); }}>{t('workspace.saveAndClose')}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={renameId !== null} onOpenChange={open => { if (!open) setRenameId(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('workspace.rename')}</DialogTitle></DialogHeader>
        <form onSubmit={event => {
          event.preventDefault();
          const bench = workspace.workbenches.find(item => item.id === renameId);
          if (bench && name.trim()) {
            bench.name = name.trim();
            changed();
            setRenameId(null);
          }
        }}>
          <label>{t('workspace.name')}<input autoFocus value={name} onChange={event => setName(event.target.value)} /></label>
          <DialogFooter>
            <button type="button" onClick={() => setRenameId(null)}>{t('common.cancel')}</button>
            <button type="submit" disabled={!name.trim()}>{t('common.save')}</button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <Dialog open={pendingFile !== null} onOpenChange={open => { if (!open) setPendingFile(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('workspace.openAs')}</DialogTitle></DialogHeader>
        <p>{pendingFile?.name}</p>
        <p>{t('workspace.openAsDescription')}</p>
        {importError && <p role="alert">{importError}</p>}
        <DialogFooter>
          <button onClick={() => setPendingFile(null)}>{t('common.cancel')}</button>
          {(['schema', 'instance'] as const).map(role => <button key={role} onClick={() => {
            if (!pendingFile) return;
            try {
              openSource(pendingFile, role);
            } catch (error) {
              console.error('Failed to import source:', error);
              setImportError(error instanceof Error ? error.message : t('workspace.openError'));
            }
          }}>{t(`workspace.openRoles.${role}`)}</button>)}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
