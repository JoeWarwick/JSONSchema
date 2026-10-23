import type { ReactNode } from 'react';
import { useT } from '../i18n';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip/tooltip';
import styles from './help-tip.module.css';

export function HelpTip({ children, label }: { children: ReactNode; label?: string }) {
  const t = useT();
  return <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className={styles.trigger} aria-label={label ? t('common.helpFor', { name: label }) : t('common.help')}>
          <span aria-hidden="true">!</span>
        </button>
      </TooltipTrigger>
      <TooltipContent className={styles.content}>{children}</TooltipContent>
    </Tooltip>
  </TooltipProvider>;
}
