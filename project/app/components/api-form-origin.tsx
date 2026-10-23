import { useT } from '../i18n';
import { useWorkbenchStorage, useWorkspaceDocuments } from '../state/workbench-context';
import { API_FORM_ORIGIN_KEY, apiFormStatus, parseApiFormOrigin } from '../utils/openapi-form';
import { HelpTip } from './help-tip';

export function ApiFormOriginNotice() {
  const t = useT();
  const storage = useWorkbenchStorage();
  const documents = useWorkspaceDocuments();
  const raw = storage.getItem(API_FORM_ORIGIN_KEY);
  if (!raw) return null;
  try {
    const origin = parseApiFormOrigin(raw);
    let status: string;
    try { status = apiFormStatus(origin, documents); } catch (failure) {
      return <aside role="alert">{t('openapi.formOrigin', { name: origin.workbenchName, method: origin.method.toUpperCase(), path: origin.path })}
        {' '}{t('openapi.formInvalid')}: {failure instanceof Error ? failure.message : t('openapi.failed')}</aside>;
    }
    const message = <>
      {t('openapi.formOrigin', { name: origin.workbenchName, method: origin.method.toUpperCase(), path: origin.path })}
      {' '}{t(`openapi.formStatus.${status}`)}
    </>;
    return status === 'current' ? <HelpTip>{message}</HelpTip> : <aside role="status">{message}</aside>;
  } catch (failure) {
    return <aside role="alert">{failure instanceof Error ? failure.message : t('openapi.failed')}</aside>;
  }
}
