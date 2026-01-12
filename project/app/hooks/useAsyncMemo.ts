import { useState, useEffect } from 'react';

export default function useAsyncMemo<T>(factory: () => Promise<T> | T, deps: any[], initial: T | null = null): T | null {
  const [value, setValue] = useState<T | null>(initial);
  useEffect(() => {
    let active = true;
    // Reset value immediately so consumers can show a resolving state
    setValue(null);
    (async () => {
      // Yield to the event loop so this runs after paint
      await Promise.resolve();
      if (!active) return;
      try {
        const res = await factory();
        if (active) setValue(res as T);
      } catch (_) {
        if (active) setValue(null);
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}
