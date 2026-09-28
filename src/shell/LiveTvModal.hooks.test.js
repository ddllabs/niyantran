// React requires the same hooks in the same order on every render. LiveTvModal
// stays mounted with open=false and returned early before two useMemo calls,
// so opening Live TV threw "Rendered more hooks than during the previous
// render" and blanked the terminal. Count the hook calls in both states.
import { describe, expect, it, vi } from 'vitest';

const calls = { n: 0 };
vi.mock('react', async (importOriginal) => {
  const real = await importOriginal();
  const count = (fn) => (...args) => { calls.n += 1; return fn(...args); };
  return {
    ...real,
    useState: count((init) => [typeof init === 'function' ? init() : init, () => {}]),
    useEffect: count(() => {}),
    useLayoutEffect: count(() => {}),
    useMemo: count((fn) => fn()),
    useCallback: count((fn) => fn),
    useRef: count((v = null) => ({ current: v })),
  };
});

const { default: LiveTvModal } = await import('./LiveTvModal.jsx');

function hookCount(props) {
  calls.n = 0;
  LiveTvModal(props);
  return calls.n;
}

describe('LiveTvModal hook order', () => {
  it('calls the same hooks whether it is closed or open', () => {
    const closed = hookCount({ open: false, onClose: () => {} });
    const open = hookCount({ open: true, onClose: () => {} });
    expect(closed).toBeGreaterThan(0);
    expect(open).toBe(closed);
  });
});
