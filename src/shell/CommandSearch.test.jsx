// F134: Records results drag into AI research. The node test environment has no DOM, so the
// payloads are checked through the pure helper and the markup through a hook-stubbed render.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_DND } from '../lib/aiDrop.js';
import { resultDragProps } from './commandSearch.js';

let overrides = {};
const setters = [];
vi.mock('react', async (importOriginal) => {
  const real = await importOriginal();
  let call = 0;
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
    useRef: (v = null) => ({ current: v }),
    __reset: () => { call = 0; },
  };
});
const React = await import('react');
const { default: CommandSearch } = await import('./CommandSearch.jsx');

function startDrag(props) {
  const store = {};
  const event = { stopPropagation: vi.fn(), dataTransfer: { setData: (type, value) => { store[type] = value; }, effectAllowed: '' } };
  props.onDragStart(event);
  return { store, event, payload: store[AI_DND] ? JSON.parse(store[AI_DND]) : null };
}
const row = { bill_name: 'Anti-Doping', status: 'Passed' };
const record = { kind: 'record', id: 'record:national:Bills:b', title: 'Anti-Doping', tab: 'national', tier: 'national', feature: 'Bills', row_key: 'b', row, detail: 'National · Bills' };
const module = { kind: 'module', id: 'module:national:Bills', title: 'Bills', tab: 'national', tier: 'national', feature: 'Bills', detail: 'National · Legislation' };
const desk = { kind: 'desk', id: 'desk:national', title: 'National', tab: 'national', feature: '', detail: 'National desk' };

describe('search result drag payloads', () => {
  it('drags a record result as a row payload carrying the row the search returned', () => {
    const props = resultDragProps(record);
    expect(props.draggable).toBe(true);
    const { payload, store, event } = startDrag(props);
    expect(payload).toMatchObject({ v: 1, kind: 'row', title: 'Anti-Doping', feature: 'Bills', tab: 'national', row });
    expect(store['text/plain']).toBe('Anti-Doping');
    expect(event.stopPropagation).toHaveBeenCalled();
  });
  it('drags a module result as a feature payload', () => {
    expect(startDrag(resultDragProps(module)).payload).toMatchObject({ kind: 'feature', tab: 'national', tier: 'national', feature: 'Bills', title: 'Bills' });
  });
  it('drags a desk result as a tab payload', () => {
    expect(startDrag(resultDragProps(desk)).payload).toMatchObject({ kind: 'tab', tab: 'national', title: 'National' });
  });
  it('falls back to a feature payload for a record hit that has no row', () => {
    const { row: _row, ...bare } = record;
    expect(startDrag(resultDragProps(bare)).payload).toMatchObject({ kind: 'feature', tab: 'national', feature: 'Bills' });
  });
});

describe('CommandSearch result buttons', () => {
  let win;
  beforeEach(() => { win = new EventTarget(); vi.stubGlobal('window', win); });
  afterEach(() => { vi.unstubAllGlobals(); });
  function render(hits) {
    React.__reset();
    // useState order in CommandSearch: q, open, selected, remote, retry.
    overrides = { 0: 'bill', 1: true, 3: { query: 'bill', hits, loading: false, error: '' } };
    return CommandSearch({ tabs: [], onOpen: () => {}, identity: 'u', searchRecords: async () => [] });
  }
  function optionsIn(tree) {
    const found = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node.props?.role === 'option') found.push(node);
      walk(node.props?.children);
    };
    walk(tree);
    return found;
  }
  const options = (hits) => optionsIn(render(hits));
  const buttonOf = (option) => [].concat(option.props.children).find((c) => c?.type === 'button');

  it('makes a record result draggable and no longer cancels the mousedown that starts the drag', () => {
    const [option] = options([record]);
    const button = buttonOf(option);
    expect(button.props.draggable).toBe(true);
    const mousedown = { preventDefault: vi.fn() };
    button.props.onMouseDown?.(mousedown);
    expect(mousedown.preventDefault).not.toHaveBeenCalled();
    expect(startDrag(button.props).payload).toMatchObject({ kind: 'row', row });
  });

  it('keeps the list open while a result is held, so focus leaving the input cannot unmount the item being dragged', () => {
    const tree = render([record]);
    const blur = () => tree.props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null });
    blur();
    expect(setters[1]).toHaveBeenCalledWith(false); // nothing held: leaving closes the list, as before
    setters[1].mockClear();
    const button = buttonOf(optionsIn(tree)[0]);
    button.props.onMouseDown({});
    blur();
    expect(setters[1]).not.toHaveBeenCalled(); // held: the dragged result stays mounted
    win.dispatchEvent(new Event('dragend'));
    blur();
    expect(setters[1]).toHaveBeenCalledWith(false); // released by dragend
  });
});
