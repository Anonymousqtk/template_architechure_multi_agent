import { useCallback, useEffect, useRef, useState } from 'react';
export function useSlideClose(onClosed: () => void) {
  const [closing, setClosing] = useState(false),
    timer = useRef<number | null>(null),
    pending = useRef(false),
    callback = useRef(onClosed);
  useEffect(() => {
    callback.current = onClosed;
  }, [onClosed]);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    pending.current = false;
    setClosing(false);
  }, []);
  function dismiss() {
    if (pending.current) return;
    if (!window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      callback.current();
      return;
    }
    pending.current = true;
    setClosing(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      pending.current = false;
      setClosing(false);
      callback.current();
    }, 220);
  }
  return { closing, dismiss, cancel };
}
