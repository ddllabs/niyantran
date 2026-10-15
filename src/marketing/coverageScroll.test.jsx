import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// F140: "Data coverage" from another page used to scroll after an 80 ms timer, a guess at when the
// home page would be on screen. It now scrolls once the home page has rendered, with no timer.
// The hooks are stood in for (there is no DOM here): state and refs persist across renders, and an
// effect runs after a render only when its dependencies changed, as React runs them.
const hooks = vi.hoisted(() => ({ states: [], refs: [], deps: [], index: 0, refIndex: 0, effectIndex: 0, pending: [] }));
vi.mock('react', async (original) => ({
  ...await original(),
  useState(initial) {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.states[index], (value) => { hooks.states[index] = typeof value === 'function' ? value(hooks.states[index]) : value; }];
  },
  useRef(value) {
    const index = hooks.refIndex++;
    if (!(index in hooks.refs)) hooks.refs[index] = { current: value };
    return hooks.refs[index];
  },
  useEffect(fn, deps) {
    const index = hooks.effectIndex++;
    const previous = hooks.deps[index];
    if (!deps || !previous || deps.some((d, i) => !Object.is(d, previous[i]))) hooks.pending.push(fn);
    hooks.deps[index] = deps;
  },
}));
vi.mock('../lib/supabaseClient.js', () => ({ supabase: { auth: {} } }));
vi.mock('./HomePage.jsx', () => ({ default: () => null }));

function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
const text = (node) => [node.props?.children].flat().filter((c) => typeof c === 'string').join('').trim();

let MarketingSite;
let events;
let order;
let listeners;
function render() {
  hooks.index = 0; hooks.refIndex = 0; hooks.effectIndex = 0; hooks.pending = [];
  const tree = MarketingSite({ onAuthed() {} });
  hooks.pending.forEach((fn) => fn());
  return tree;
}
const coverageButton = (tree) => nodes(tree, (n) => n.type === 'button' && text(n) === 'Data coverage')[0];

beforeEach(async () => {
  hooks.states = []; hooks.refs = []; hooks.deps = [];
  order = [];
  listeners = {};
  const classList = { add() {}, remove() {} };
  vi.stubGlobal('location', { pathname: '/', hash: '#/pricing', search: '' });
  vi.stubGlobal('history', { pushState() {} });
  vi.stubGlobal('window', {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener() {},
    dispatchEvent() {},
    scrollTo: (x, y) => order.push(`scrollTo ${x},${y}`),
  });
  vi.stubGlobal('document', {
    title: '',
    documentElement: { classList },
    body: { classList },
    getElementById: (id) => (id === 'coverage' ? { scrollIntoView: (options) => order.push(`coverage ${options?.behavior}`) } : null),
  });
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem() {} });
  vi.useFakeTimers();
  ({ default: MarketingSite } = await import('./MarketingSite.jsx'));
  events = listeners;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Data coverage from another page', () => {
  it('scrolls to the coverage section once the home page has rendered, with no timer', () => {
    const tree = render();
    expect(hooks.states[0]).toBe('pricing');
    const timers = vi.getTimerCount();
    coverageButton(tree).props.onClick();
    // Nothing is scrolled, and nothing is scheduled, before the home page is on screen.
    expect(order).toEqual([]);
    expect(vi.getTimerCount()).toBe(timers);
    // The hash change arrives: the page becomes home and the window goes to the top.
    location.hash = '#/';
    events.hashchange();
    render();
    expect(order).toEqual(['scrollTo 0,0', 'coverage smooth']);
    // Later renders of the home page do not scroll again.
    render();
    expect(order).toEqual(['scrollTo 0,0', 'coverage smooth']);
  });

  it('on the home page, scrolls at once and leaves nothing pending', () => {
    location.hash = '#/';
    const tree = render();
    expect(hooks.states[0]).toBe('home');
    const timers = vi.getTimerCount();
    coverageButton(tree).props.onClick();
    expect(order).toEqual(['coverage smooth']);
    expect(vi.getTimerCount()).toBe(timers);
    render();
    expect(order).toEqual(['coverage smooth']);
  });
});
