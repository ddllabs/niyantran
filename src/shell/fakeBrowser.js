// A small browser for tests that run in node (vitest's environment here has no DOM): an address, a
// history with a state, listeners, and an event bus. Used by the Live TV route and shell tests.
const hashOf = (url) => (String(url).includes('#') ? String(url).slice(String(url).indexOf('#')) : '');

export function fakeBrowser(hash = '') {
  const listeners = {};
  const b = {
    _hash: hash, state: null, backCalls: 0,
    navigations: 0, // entries added by assigning location.hash
    pushed: [], replaced: [],
    addEventListener(type, fn) { (listeners[type] ||= new Set()).add(fn); },
    removeEventListener(type, fn) { listeners[type]?.delete(fn); },
    dispatchEvent(event) { for (const fn of [...(listeners[event.type] || [])]) fn(event); return true; },
    count: (type) => listeners[type]?.size || 0,
  };
  b.location = {
    pathname: '/app', search: '',
    get hash() { return b._hash; },
    set hash(next) {
      const value = String(next).startsWith('#') ? String(next) : `#${next}`;
      if (value === b._hash) return;
      b._hash = value; b.state = null; b.navigations += 1;
      b.dispatchEvent({ type: 'hashchange' });
    },
    get href() { return `https://x.test/app${b._hash}`; },
  };
  b.history = {
    get state() { return b.state; },
    pushState(state, _title, url) { b.pushed.push(url); b._hash = hashOf(url); b.state = state; },
    replaceState(state, _title, url) { b.replaced.push(url ?? null); if (url != null) b._hash = hashOf(url); b.state = state; },
    back() { b.backCalls += 1; },
  };
  b.window = b;
  return b;
}
