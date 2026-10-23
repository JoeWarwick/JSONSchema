import { useContext, useState } from 'react';
import { useT } from '../i18n';
import { AddWorkbenchContext } from '../state/workbench-context';
import { createWorkbench } from '../state/workspace';
import { parseMarkup } from '../utils/markup';
import { parseTransformXml, type TransformResultDocument } from '../utils/transform';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog/dialog';
import styles from './transform-workbench.module.css';

export function TransformResultsDialog({ results, onClose }: {
  results: TransformResultDocument[];
  onClose: () => void;
}) {
  const t = useT();
  const add = useContext(AddWorkbenchContext);
  const [choices, setChoices] = useState(() => results.map(result => ({ ...result, selected: true })));
  const [error, setError] = useState<string | null>(null);
  const selected = choices.filter(choice => choice.selected);

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{t('transform.outputs.importTitle')}</DialogTitle></DialogHeader>
      <DialogDescription>{t('transform.outputs.importHint')}</DialogDescription>
      <form onSubmit={event => {
        event.preventDefault();
        setError(null);
        try {
          if (!add) throw new Error(t('collection.workspaceRequired'));
          if (!selected.length || selected.some(choice => !choice.name.trim())) throw new Error(t('transform.outputs.chooseResults'));
          const workbenches = selected.map(choice => {
            parseTransformXml(choice.xml);
            const bench = createWorkbench('xml', crypto.randomUUID(), choice.name.trim());
            bench.entries['schema-sculptor-instance-xml'] = choice.xml;
            if (choice.schema) {
              parseTransformXml(choice.schema);
              bench.entries['schema-sculptor-schema-xml'] = JSON.stringify(parseMarkup(choice.schema, 'xml'));
            }
            return bench;
          });
          add(workbenches, false);
          onClose();
        } catch (failure) {
          console.error('Failed to open Transform outputs:', failure);
          setError(failure instanceof Error ? failure.message : t('transform.invalidResult'));
        }
      }}>
        <div className={styles.resultChoices}>{choices.map((choice, index) => <fieldset key={choice.id}>
          <legend>{results[index].name}</legend>
          <label><input type="checkbox" checked={choice.selected}
            onChange={event => setChoices(previous => previous.map(item => item.id === choice.id ? { ...item, selected: event.target.checked } : item))} />
            {t('transform.outputs.include', { number: index + 1 })}</label>
          <label>{t('transform.outputs.workbenchName', { number: index + 1 })}
            <input value={choice.name} disabled={!choice.selected}
              onChange={event => setChoices(previous => previous.map(item => item.id === choice.id ? { ...item, name: event.target.value } : item))} />
          </label>
        </fieldset>)}</div>
        {error && <p role="alert">{error}</p>}
        <DialogFooter>
          <button type="button" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" disabled={!add || !selected.length || selected.some(choice => !choice.name.trim())}>
            {t('transform.outputs.open')}
          </button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
