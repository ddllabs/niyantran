// F134: dragging a result out of the search opens AI research and gets the modal window out of the
// way without unmounting the dragged element; the end of the drag closes the search. The node test
// environment has no DOM, so the component renders with stubbed hooks and a fake dialog.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let overrides = {};
const setters = [];
const refs = [];
vi.mock('react', async (importOriginal) => {
  const real = await importOriginal();
  let call = 0, refCall = 0;
  return {
    ...real,
    useState: (init) => {
      const i = call++;
      const value = i in overrides ? overrides[i] : typeof init === 'function' ? init() : init;
      setters[i] = vi.fn();
      return [value, setters[i]];
    },
    useEffect: () => {},
    useId: () => 'id',
    useMemo: (fn) => fn(),
    useRef: (v = null) => { const r = { current: v }; refs[refCall++] = r; return r; },
    __reset: () => { call = 0; refCall = 0; },
  };
});
const React = await import('react');
const { default: DeskCatalogueSearch, createSearchDrag, openSearch, SEARCH_DRAGGING } = await import('./DeskCatalogueSearch.jsx');

const draggableTarget = { closest: (selector) => (selector === '[draggable="true"]' ? {} : null) };
const textTarget = { closest: () => null };
function fakeDialog() {
  const classes = new Set();
  return { open: true, classList: { add: (c) => classes.add(c), has: (c) => classes.has(c) }, close: vi.fn(function () { this.open = false; }), show: vi.fn(function () { this.open = true; }) };
}
function findDialog(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const f = findDialog(n); if (f) return f; } return null; }
  if (node.type === 'dialog') return node;
  return findDialog(node.props?.children);
}

let win, opened;
beforeEach(() => {
  vi.useFakeTimers();
  win = new EventTarget();
  vi.stubGlobal('window', win);
  opened = vi.fn();
  win.addEventListener('niy-ai-open', opened);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('createSearchDrag', () => {
  function setup() {
    const dialog = fakeDialog();
    const onEnd = vi.fn();
    const drag = createSearchDrag({ getDialog: () => dialog, onEnd });
    return { dialog, onEnd, drag };
  }
  it('opens AI research on drag start and, once the browser has the drag image, hides the dialog without unmounting it', () => {
    const { dialog, drag } = setup();
    drag.start({ target: draggableTarget });
    expect(opened).toHaveBeenCalledTimes(1);
    expect(dialog.close).not.toHaveBeenCalled(); // not before the browser captured the drag image
    vi.runAllTimers();
    expect(dialog.close).toHaveBeenCalledTimes(1); // no longer modal: the page behind can take the drop
    expect(dialog.show).toHaveBeenCalledTimes(1); // still rendered, so the drag source stays in the document
    expect(dialog.classList.has(SEARCH_DRAGGING)).toBe(true);
  });
  it('ignores a drag that is not a result, such as selected text in the search field', () => {
    const { dialog, onEnd, drag } = setup();
    drag.start({ target: textTarget });
    vi.runAllTimers();
    expect(opened).not.toHaveBeenCalled();
    expect(dialog.close).not.toHaveBeenCalled();
    drag.end();
    expect(onEnd).not.toHaveBeenCalled();
  });
  it('closes the search when the drag ends on the source', () => {
    const { onEnd, drag } = setup();
    drag.start({ target: draggableTarget });
    vi.runAllTimers();
    drag.end();
    expect(onEnd).toHaveBeenCalledTimes(1);
    drag.end();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
  it('closes the search on a window drop or dragend too, in case the source gets no dragend', () => {
    for (const type of ['drop', 'dragend']) {
      const { onEnd, drag } = setup();
      drag.start({ target: draggableTarget });
      win.dispatchEvent(new Event(type));
      expect(onEnd).toHaveBeenCalledTimes(1);
      win.dispatchEvent(new Event(type));
      expect(onEnd).toHaveBeenCalledTimes(1); // listeners are removed
    }
  });
  it('does not touch the dialog if the drag ended before the deferred hide ran', () => {
    const { dialog, drag } = setup();
    drag.start({ target: draggableTarget });
    drag.end();
    vi.runAllTimers();
    expect(dialog.close).not.toHaveBeenCalled();
  });
  it('does not hide a dialog that is already closed', () => {
    const { dialog, drag } = setup();
    dialog.open = false;
    drag.start({ target: draggableTarget });
    vi.runAllTimers();
    expect(dialog.close).not.toHaveBeenCalled();
    expect(dialog.show).not.toHaveBeenCalled();
  });
  it('dispose removes the window listeners without closing the search', () => {
    const { onEnd, drag } = setup();
    drag.start({ target: draggableTarget });
    drag.dispose();
    win.dispatchEvent(new Event('drop'));
    expect(onEnd).not.toHaveBeenCalled();
  });
});

describe('DeskCatalogueSearch dialog wiring', () => {
  function renderOpen() {
    React.__reset();
    // useState order: open, mode, query, selected, detail, coverage, attempt.
    overrides = { 0: true };
    const tree = DeskCatalogueSearch({ tabs: [], recordTabs: [], lockedIds: [], identity: 'u', onOpen: () => {} });
    return findDialog(tree);
  }
  it('opens AI research and hides the dialog when a result inside it starts a drag, then closes the search at dragend', () => {
    const dialog = renderOpen();
    const el = fakeDialog();
    refs[1].current = el; // useRef order: trigger, dialog, input, drag controller
    dialog.props.onDragStartCapture({ target: draggableTarget });
    expect(opened).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(el.close).toHaveBeenCalledTimes(1);
    expect(el.show).toHaveBeenCalledTimes(1);
    expect(setters[0]).not.toHaveBeenCalled(); // still open: the dragged element stays mounted
    dialog.props.onDragEndCapture({});
    expect(setters[0]).toHaveBeenCalledWith(false);
  });
});

// Review (2026-10-13): if a drag's end never arrives, the search is left mounted but invisible. The
// next ⌘K or click on the trigger resets it and opens it again, instead of doing nothing.
describe('opening the search after a drag that never ended', () => {
  const dialogWith = (dragging) => ({ classList: { contains: (c) => dragging && c === SEARCH_DRAGGING } });
  it('resets the stuck search, then opens it on the next tick', () => {
    const calls = [];
    const drag = { dispose: () => calls.push('dispose') };
    let later;
    openSearch({ dialog: dialogWith(true), drag, setOpen: (v) => calls.push(v), schedule: (fn) => { later = fn; } });
    expect(calls).toEqual(['dispose', false]);
    later();
    expect(calls).toEqual(['dispose', false, true]);
  });
  it('just opens it otherwise', () => {
    const calls = [];
    openSearch({ dialog: dialogWith(false), drag: { dispose: () => calls.push('dispose') }, setOpen: (v) => calls.push(v), schedule: () => calls.push('scheduled') });
    openSearch({ dialog: null, drag: null, setOpen: (v) => calls.push(v) });
    expect(calls).toEqual([true, true]);
  });
});
