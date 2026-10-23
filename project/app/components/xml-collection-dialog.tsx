import { useContext, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { AddWorkbenchContext } from '../state/workbench-context';
import { createWorkbench, type WorkbenchDocument } from '../state/workspace';
import { parseMarkup } from '../utils/markup';
import { parseTransformXml } from '../utils/transform';
import { schemaRoots } from '../utils/transform-datasource';
import { createXmlCollection } from '../utils/xml-collection';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog/dialog';

export interface CollectionInput { xml: string; schema: string; rootElement?: string }

export function XmlCollectionDialog({ input, onClose, onCreated, targetInput, onPairCreated }: {
  input: CollectionInput;
  onClose: () => void;
  onCreated?: (bench: WorkbenchDocument) => void;
  targetInput?: CollectionInput;
  onPairCreated?: (source: WorkbenchDocument, target: WorkbenchDocument) => void;
}) {
  const t = useT();
  const add = useContext(AddWorkbenchContext);
  const details = useMemo(() => {
    try {
      const roots = input.schema ? schemaRoots(input.schema) : [];
      const record = input.rootElement || (input.xml.trim() ? parseTransformXml(input.xml).documentElement.localName : roots[0]) || '';
      return { roots, record, error: null };
    } catch (failure) {
      return { roots: [], record: '', error: failure instanceof Error ? failure.message : t('collection.failed') };
    }
  }, [input, t]);
  const [record, setRecord] = useState(details.record);
  const [name, setName] = useState(details.record ? `${details.record}s` : '');
  const [targetName, setTargetName] = useState(() =>
    targetInput ? `${parseTransformXml(targetInput.xml).documentElement.localName}s` : '');
  const [error, setError] = useState<string | null>(details.error);

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{t(targetInput ? 'collection.pairTitle' : 'collection.title')}</DialogTitle></DialogHeader>
      <DialogDescription>{t(targetInput ? 'collection.pairHint' : 'collection.hint')}</DialogDescription>
      <form onSubmit={event => {
        event.preventDefault();
        try {
          if (!add) throw new Error(t('collection.workspaceRequired'));
          const build = (input: CollectionInput, record: string, name: string) => {
            const result = createXmlCollection(input.xml, input.schema, record, name.trim());
            const bench = createWorkbench('xml', crypto.randomUUID(), name.trim());
            if (result.schema) bench.entries['schema-sculptor-schema-xml'] = JSON.stringify(parseMarkup(result.schema, 'xml'));
            if (result.xml) bench.entries['schema-sculptor-instance-xml'] = result.xml;
            return bench;
          };
          const bench = build(input, record, name);
          if (targetInput) {
            const target = build(targetInput, parseTransformXml(targetInput.xml).documentElement.localName, targetName);
            onPairCreated?.(bench, target);
            add([bench, target], false);
          } else {
            onCreated?.(bench);
            add(bench, !onCreated);
          }
          onClose();
        } catch (failure) {
          console.error('Failed to create XML collection:', failure);
          setError(failure instanceof Error ? failure.message : t('collection.failed'));
        }
      }}>
        <label>{t('collection.record')}
          <select value={record} disabled={!!input.xml.trim()} onChange={event => setRecord(event.target.value)}>
            {[...new Set([record, ...details.roots])].filter(Boolean).map(root => <option key={root} value={root}>{root}</option>)}
          </select>
        </label>
        <label>{t(targetInput ? 'collection.sourceName' : 'collection.name')}
          <input autoFocus value={name} onChange={event => setName(event.target.value)} />
        </label>
        {targetInput && <label>{t('collection.targetName')}
          <input value={targetName} onChange={event => setTargetName(event.target.value)} />
        </label>}
        {error && <p role="alert">{error}</p>}
        <DialogFooter>
          <button type="button" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" disabled={!add || !record || !name.trim() || (!!targetInput && !targetName.trim()) || !!details.error}>
            {t(targetInput ? 'collection.createPair' : 'collection.create')}
          </button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
