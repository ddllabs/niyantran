// React's hooks replaced by a small harness (the PageViewer.hooks.test.jsx approach) so a component's
// own function can run in node with REAL effects and state: state lives in slots, an effect runs when
// its deps change (its cleanup first), and the component re-renders while state changes. Child components
// are not rendered; the returned element tree is.
const changed = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));

export const harness = {
  slots: [], i: 0, pending: [], dirty: false, effects: new Set(),
  /** What useRef(null) returns as `.current`, so refs behave as if attached to an element. */
  refFactory: null,
  reset() { this.slots = []; this.i = 0; this.pending = []; this.dirty = false; this.effects = new Set(); },

  /** The replacement hooks, spread over the real React module inside vi.mock('react'). */
  patch() {
    const h = this;
    const slot = (init) => { const i = h.i++; if (!(i in h.slots)) h.slots[i] = init(); return h.slots[i]; };
    const effect = (fn, deps) => {
      const s = slot(() => ({ deps: undefined, cleanup: null }));
      if (deps === undefined || changed(s.deps, deps)) h.pending.push({ s, fn, deps });
      h.effects.add(s);
    };
    return {
      useState(init) {
        const s = slot(() => ({ value: typeof init === 'function' ? init() : init }));
        s.set ??= (next) => {
          const value = typeof next === 'function' ? next(s.value) : next;
          if (!Object.is(value, s.value)) { s.value = value; h.dirty = true; }
        };
        return [s.value, s.set];
      },
      useRef: (value = null) => slot(() => ({ current: value === null && h.refFactory ? h.refFactory() : value })),
      useId: () => slot(() => ':h1:'),
      useCallback(fn, deps) { const s = slot(() => ({})); if (changed(s.deps, deps)) { s.fn = fn; s.deps = deps; } return s.fn; },
      useMemo(make, deps) { const s = slot(() => ({})); if (changed(s.deps, deps)) { s.value = make(); s.deps = deps; } return s.value; },
      useEffect: effect,
      useLayoutEffect: effect,
    };
  },

  /** Renders until no state changes; effects run after each pass. State set by an effect re-renders. */
  render(component, props) {
    let out;
    for (let pass = 0; pass < 30; pass += 1) {
      this.dirty = false; this.i = 0; this.pending = [];
      out = component(props);
      for (const { s, fn, deps } of this.pending) {
        if (typeof s.cleanup === 'function') s.cleanup();
        s.cleanup = fn() ?? null; s.fn = fn; s.deps = deps;
      }
      if (!this.dirty) return out;
    }
    throw new Error('the component kept re-rendering');
  },

  /** Runs every effect's cleanup, as unmounting does. */
  unmount() { for (const s of this.effects) if (typeof s.cleanup === 'function') { s.cleanup(); s.cleanup = null; } },
};

/** Every element in a returned tree (children that are not elements or arrays are skipped). */
export function* elements(node) {
  if (Array.isArray(node)) { for (const n of node) yield* elements(n); return; }
  if (!node || typeof node !== 'object' || !('props' in node)) return;
  yield node;
  yield* elements(node.props?.children);
}
