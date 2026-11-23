import { useCallback, useEffect, useRef, useState } from 'react';

// Loads data for a screen: { data, error, loading, reload }. A newer load cancels an older one.
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const ctrl = useRef(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const run = useCallback(() => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve()
      .then(() => fnRef.current(c.signal))
      .then((data) => { if (!c.signal.aborted) setState({ data, error: null, loading: false }); })
      .catch((error) => { if (!c.signal.aborted && error?.name !== 'AbortError') setState((s) => ({ ...s, error, loading: false })); });
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(); return () => ctrl.current?.abort(); }, deps);
  return { ...state, reload: run };
}
