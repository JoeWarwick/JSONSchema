export type PrintGraphMode = 'erd' | 'graphical';

export function printGraphSection(mode: PrintGraphMode): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const body = document.body;
  const previousMode = body.getAttribute('data-print-mode');
  body.setAttribute('data-print-mode', mode);

  const cleanup = () => {
    if (previousMode) body.setAttribute('data-print-mode', previousMode);
    else body.removeAttribute('data-print-mode');
    window.removeEventListener('afterprint', cleanup);
  };

  window.addEventListener('afterprint', cleanup);

  const printNow = () => window.print();
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(printNow);
    });
    return;
  }

  window.setTimeout(printNow, 0);
}