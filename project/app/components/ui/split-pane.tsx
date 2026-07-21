import React from 'react';

export interface HorizontalSplitPaneProps {
  children: [React.ReactNode, React.ReactNode];
  className?: string;
  defaultRightWidth?: number;
  minRightWidth?: number;
  minLeftWidth?: number;
  handleWidth?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function HorizontalSplitPane({
  children,
  className,
  defaultRightWidth = 320,
  minRightWidth = 280,
  minLeftWidth = 360,
  handleWidth = 8,
}: HorizontalSplitPaneProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const draggingRef = React.useRef(false);
  const [rightWidth, setRightWidth] = React.useState(defaultRightWidth);

  const updateFromClientX = React.useCallback((clientX: number) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) return;
    const maxRightWidth = Math.max(minRightWidth, rect.width - minLeftWidth);
    setRightWidth(clamp(rect.right - clientX, minRightWidth, maxRightWidth));
  }, [minLeftWidth, minRightWidth]);

  const endDrag = React.useCallback(() => {
    draggingRef.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const startDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, []);

  const moveDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    updateFromClientX(event.clientX);
  }, [updateFromClientX]);

  React.useEffect(() => () => endDrag(), [endDrag]);

  React.useEffect(() => {
    const handleWindowResize = () => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      const maxRightWidth = Math.max(minRightWidth, rect.width - minLeftWidth);
      setRightWidth((current) => clamp(current, minRightWidth, maxRightWidth));
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [minLeftWidth, minRightWidth]);

  return (
    <div ref={containerRef} className={className} style={{ display: 'flex', width: '100%', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ flex: '1 1 auto', minWidth: 0, height: '100%' }}>{children[0]}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize right panel"
        tabIndex={0}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') setRightWidth((current) => Math.max(minRightWidth, current + 24));
          if (event.key === 'ArrowRight') setRightWidth((current) => Math.min(current - 24, 10000));
          if (event.key === 'Escape') endDrag();
        }}
        style={{ width: handleWidth, cursor: 'col-resize', flex: '0 0 auto', background: 'var(--color-neutral-4)', touchAction: 'none' }}
      />
      <div style={{ flex: `0 0 ${rightWidth}px`, minWidth: minRightWidth, height: '100%' }}>{children[1]}</div>
    </div>
  );
}