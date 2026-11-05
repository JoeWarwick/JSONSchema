import { useState } from 'react';
import { useT } from '../i18n';
import { suggestedWorkbenchFilename, supportsLocalSave, workbenchFilename } from '../utils/workbench-storage';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog/dialog';
import styles from './save-workbench-dialog.module.css';

export function SaveWorkbenchDialog({ name, destination, busy, error, notice, onSave, onDownload, onClose }: {
  name: string;
  destination?: string;
  busy: boolean;
  error: string | null;
  notice: string | null;
  onSave: (filename: string) => void;
  onDownload: (filename: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [filename, setFilename] = useState(() => destination ?? suggestedWorkbenchFilename(name));
  const [filenameError, setFilenameError] = useState<string | null>(null);
  const nativeSave = supportsLocalSave();

  const validate = (action: (filename: string) => void) => {
    try {
      const value = workbenchFilename(filename);
      setFilenameError(null);
      action(value);
    } catch (failure) {
      setFilenameError(failure instanceof Error ? failure.message : t('saveDialog.invalidFilename'));
    }
  };

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}
      onInteractOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>{t('saveDialog.title')}</DialogTitle></DialogHeader>
      <DialogDescription>{t('saveDialog.description')}</DialogDescription>
      <form noValidate className={styles.form} onSubmit={event => {
        event.preventDefault();
        validate(nativeSave ? onSave : onDownload);
      }}>
        <label>{t('saveDialog.location')}<select disabled={busy} defaultValue="local">
          <option value="local">{t('saveDialog.thisDevice')}</option>
        </select></label>
        <p>{t(nativeSave ? 'saveDialog.chooseFolder' : 'saveDialog.unsupported')}</p>
        {destination && <p>{t('saveDialog.currentDestination', { name: destination })}</p>}
        <label>{t('saveDialog.filename')}
          <input autoFocus name="filename" required maxLength={255} value={filename} disabled={busy}
            onChange={event => { setFilename(event.target.value); setFilenameError(null); }} />
        </label>
        <p>{t('saveDialog.format')}</p>
        {(filenameError || error) && <p role="alert">{filenameError || error}</p>}
        {notice && <p role="status">{notice}</p>}
        {busy && <p role="status">{t('saveDialog.saving')}</p>}
        <p>{t('saveDialog.downloadHint')}</p>
        <DialogFooter>
          <button type="button" disabled={busy} onClick={onClose}>{t('common.cancel')}</button>
          {nativeSave && <button type="button" disabled={busy} onClick={() => validate(onDownload)}>
            {t('saveDialog.download')}
          </button>}
          <button type="submit" disabled={busy}>
            {t(nativeSave ? 'saveDialog.chooseFile' : 'saveDialog.download')}
          </button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
