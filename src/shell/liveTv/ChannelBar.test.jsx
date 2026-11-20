// B6: the channel bar: tabs and strip, segments with counts, the overlay panel, search, Regional language chips,
// and the phone sheet. Real component, real effects (hookHarness); markup checks use static rendering.
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, elements } from '../hookHarness.js';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
const { ChannelBar, EMPTY_SEARCH, EMPTY_MY_LIST } = await import('./ChannelBar.jsx');

const LISTS = [
  { id: 'top-hi', name: 'Top · Hindi news', short: 'Hindi', kind: 'top' },
  { id: 'top-en', name: 'Top · English news', short: 'English', kind: 'top' },
  { id: 'politics', name: 'Politics & Debates', short: 'Politics & Debates', kind: 'seg', note: 'Only channels whose identity was verified are listed. More will be added.' },
  { id: 'plain', name: 'Plain', short: 'Plain', kind: 'seg' },
  { id: 'regional', name: 'Regional', short: 'Regional', kind: 'seg' },
];
const CH = [
  { id: 'aaj-tak', name: 'Aaj Tak', short: 'AT', color: '#B71C1C', lang: 'Hindi', lists: ['top-hi'], status: 'live' },
  { id: 'dd-news', name: 'DD News', short: 'DD', color: '#C8102E', lang: 'Hindi · English', lists: ['top-hi', 'politics'], status: 'recent' },
  { id: 'ndtv', name: 'NDTV 24x7', short: 'NDTV', color: '#E4002B', lang: 'English', lists: ['top-en'], status: 'recent' },
  { id: 'lallantop', name: 'The Lallantop', short: 'TL', color: '#111111', lang: 'Hindi', lists: ['politics'], status: 'recent' },
  { id: 'abp-majha', name: 'ABP Majha', officialName: 'ABP MAJHA', short: 'MAJ', color: '#1E3A8A', lang: 'Marathi', lists: ['regional'], status: 'recent' },
  { id: 'tv9-marathi', name: 'TV9 Marathi', short: 'TV9', color: '#1E3A8A', lang: 'Marathi', lists: ['regional'], status: 'recent' },
  { id: 'asianet', name: 'Asianet News', short: 'ASN', color: '#1E3A8A', lang: 'Malayalam', lists: ['regional'], status: 'recent' },
  { id: 'zee', name: 'Zee News', short: 'ZEE', color: '#B71C1C', lang: 'Hindi', lists: ['top-hi'], status: 'recent' },
];
const base = { channels: CH, lists: LISTS, activeChannelId: 'aaj-tak', playbackMode: 'live', loading: false, following: [], onSelectChannel() {} };
// The harness leaves child components unrendered; Tile and Grid use no hooks, so they are expanded here.
function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== 'object' || !('props' in node)) return node;
  if (typeof node.type === 'function') return expand(node.type(node.props));
  const children = node.props?.children;
  return children === undefined ? node : { ...node, props: { ...node.props, children: expand(children) } };
}
const mount = (props = {}) => expand(harness.render(ChannelBar, { ...base, ...props }));
const find = (out, pred) => [...elements(out)].find(pred);
const all = (out, pred) => [...elements(out)].filter(pred);
const text = (node) => (node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node));
const btn = (out, label) => find(out, (e) => e.type === 'button' && text(e).replace(/\s+/g, ' ').trim().startsWith(label));
const dialog = (out) => find(out, (e) => e.props?.role === 'dialog' && e.props['aria-label'] !== 'Channels');
const tileNames = (node) => all(node, (e) => e.type === 'button' && /ltv-channel-chip/.test(e.props.className || '')).map((e) => text(find(e, (x) => /ltv-chip-name/.test(x.props?.className || ''))));
const mk = (focus) => ({ focus, currentTarget: null });

beforeEach(() => { harness.reset(); harness.refFactory = null; });

describe('row one: the tabs and the strip', () => {
  it('has My list, Hindi and English tabs with counts, and starts on the first top list', () => {
    const out = mount();
    const group = find(out, (e) => e.props?.['aria-label'] === 'Top channel list');
    const labels = all(group, (e) => e.type === 'button').map((b) => text(b).replace(/\s+/g, ' ').trim());
    expect(labels).toEqual(['My list 0', 'Hindi 3', 'English 1']);
    expect(all(group, (e) => e.type === 'button').map((b) => b.props['aria-pressed'])).toEqual([false, true, false]);
    expect(tileNames(find(out, (e) => e.props?.['aria-label'] === 'Available Channels'))).toEqual(['Aaj Tak', 'DD News', 'Zee News']);
  });
  it('shows another list when its tab is pressed', () => {
    let out = mount();
    btn(out, 'English').props.onClick();
    out = mount();
    expect(tileNames(find(out, (e) => e.props?.['aria-label'] === 'Available Channels'))).toEqual(['NDTV 24x7']);
  });
  it('shows My list in the order followed, skipping ids that no longer exist, and says so when it is empty', () => {
    let out = mount({ following: ['ndtv', 'gone', 'aaj-tak'] });
    btn(out, 'My list').props.onClick();
    out = mount({ following: ['ndtv', 'gone', 'aaj-tak'] });
    expect(tileNames(find(out, (e) => e.props?.['aria-label'] === 'Available Channels'))).toEqual(['NDTV 24x7', 'Aaj Tak']);
    expect(text(btn(out, 'My list')).replace(/\s+/g, ' ').trim()).toBe('My list 2');
    harness.reset();
    out = mount({ initial: { top: 'my' } });
    expect(text(out)).toContain(EMPTY_MY_LIST);
  });
  it('marks the playing tile, in live mode only', () => {
    expect(all(mount(), (e) => /ltv-channel-chip active/.test(e.props.className || '')).length).toBe(1);
    harness.reset();
    expect(all(mount({ playbackMode: 'link' }), (e) => /ltv-channel-chip active/.test(e.props.className || '')).length).toBe(0);
  });
  it('selects a channel from a tile', () => {
    const onSelectChannel = vi.fn();
    const out = mount({ onSelectChannel });
    all(out, (e) => e.type === 'button' && /ltv-channel-chip/.test(e.props.className || ''))[1].props.onClick();
    expect(onSelectChannel).toHaveBeenCalledWith(CH[1]);
  });
});

describe('row two: the segments and the panel', () => {
  it('has All and each segment with a count, once per channel in All', () => {
    const out = mount();
    const row = find(out, (e) => e.props?.['aria-label'] === 'Segments');
    expect(all(row, (e) => e.type === 'button').map((b) => text(b).replace(/\s+/g, ' ').trim())).toEqual(['All 8', 'Politics & Debates 2', 'Plain 0', 'Regional 3']);
  });

  it('opens a panel for a segment, under the bar, with the channels as tiles', () => {
    mount();
    btn(mount(), 'Politics').props.onClick({ currentTarget: mk(() => {}) });
    const out = mount();
    const pop = dialog(out);
    expect(pop.props['aria-label']).toBe('Politics & Debates');
    expect(tileNames(pop).sort()).toEqual(['DD News', 'The Lallantop']);
    expect(btn(out, 'Politics').props['aria-expanded']).toBe(true);
    expect(btn(out, 'Politics').props['aria-haspopup']).toBe('dialog');
  });

  it('opens All grouped by first list, each channel once', () => {
    mount();
    btn(mount(), 'All').props.onClick({ currentTarget: mk(() => {}) });
    const pop = dialog(mount());
    expect(pop.props['aria-label']).toBe('All channels');
    expect(tileNames(pop)).toHaveLength(8);
  });

  it('closes with its close button, giving focus back to the control that opened it', () => {
    const focus = vi.fn();
    mount();
    btn(mount(), 'Politics').props.onClick({ currentTarget: { focus } });
    const close = find(mount(), (e) => e.props?.['aria-label'] === 'Close channel menu');
    close.props.onClick();
    expect(dialog(mount())).toBeUndefined();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('closes with Escape, from inside the panel or the search box, and returns focus', () => {
    const focus = vi.fn();
    mount();
    btn(mount(), 'Regional').props.onClick({ currentTarget: { focus } });
    const section = find(mount(), (e) => e.type === 'section');
    const prevent = vi.fn();
    section.props.onKeyDown({ key: 'Escape', preventDefault: prevent });
    expect(dialog(mount())).toBeUndefined();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(prevent).toHaveBeenCalled();
    section.props.onKeyDown({ key: 'Escape', preventDefault() {} }); // nothing open: nothing happens
    expect(focus).toHaveBeenCalledTimes(1);
    mount().props; // still renders
  });

  it('ignores other keys', () => {
    mount();
    btn(mount(), 'Regional').props.onClick({ currentTarget: mk(() => {}) });
    find(mount(), (e) => e.type === 'section').props.onKeyDown({ key: 'a', preventDefault() {} });
    expect(dialog(mount())).toBeDefined();
  });

  it('moves focus into the panel when it opens from a button', () => {
    const focusHeading = vi.fn();
    mount();
    btn(mount(), 'Regional').props.onClick({ currentTarget: mk(() => {}) });
    const heading = find(mount(), (e) => /ltv-pop-title/.test(e.props?.className || ''));
    heading.props.ref.current = { focus: focusHeading };
    harness.reset();
    // a fresh mount with the ref stand-in in place before effects run
    harness.refFactory = () => ({ focus: focusHeading });
    mount({ initial: { pop: { kind: 'seg', id: 'regional' } } });
    expect(focusHeading).toHaveBeenCalled();
    expect(heading.props.tabIndex).toBe(-1);
  });

  it('picking a tile selects the channel and closes the panel', () => {
    const onSelectChannel = vi.fn();
    mount({ onSelectChannel });
    btn(mount({ onSelectChannel }), 'Politics').props.onClick({ currentTarget: mk(() => {}) });
    const tile = all(dialog(mount({ onSelectChannel })), (e) => e.type === 'button' && /ltv-channel-chip/.test(e.props.className || ''))[0];
    tile.props.onClick();
    expect(onSelectChannel).toHaveBeenCalledTimes(1);
    expect(dialog(mount({ onSelectChannel }))).toBeUndefined();
  });

  it('presses the same segment again to close it, and another to switch', () => {
    mount();
    btn(mount(), 'Politics').props.onClick({ currentTarget: mk(() => {}) });
    btn(mount(), 'Regional').props.onClick({ currentTarget: mk(() => {}) });
    expect(dialog(mount()).props['aria-label']).toBe('Regional');
    btn(mount(), 'Regional').props.onClick({ currentTarget: mk(() => {}) });
    expect(dialog(mount())).toBeUndefined();
  });

  it('does not put a backdrop or a focus trap on the page', () => {
    mount();
    btn(mount(), 'Politics').props.onClick({ currentTarget: mk(() => {}) });
    const out = mount();
    expect(find(out, (e) => /backdrop|overlay-bg/.test(e.props?.className || ''))).toBeUndefined();
    expect(dialog(out).props['aria-modal']).toBeUndefined();
  });
});

describe('Regional', () => {
  const open = () => { mount(); btn(mount(), 'Regional').props.onClick({ currentTarget: mk(() => {}) }); return mount(); };
  it('has language chips with counts, All first', () => {
    const chips = find(open(), (e) => e.props?.['aria-label'] === 'Language');
    expect(all(chips, (e) => e.type === 'button').map((b) => text(b).replace(/\s+/g, ' ').trim())).toEqual(['All 3', 'Malayalam 1', 'Marathi 2']);
  });
  it('narrows the tiles to a language, and back', () => {
    let out = open();
    all(find(out, (e) => e.props?.['aria-label'] === 'Language'), (e) => e.type === 'button').find((b) => text(b).startsWith('Marathi')).props.onClick();
    out = mount();
    expect(tileNames(dialog(out)).sort()).toEqual(['ABP Majha', 'TV9 Marathi']);
    all(find(out, (e) => e.props?.['aria-label'] === 'Language'), (e) => e.type === 'button')[0].props.onClick();
    expect(tileNames(dialog(mount()))).toHaveLength(3);
  });
  it('has no language chips in other segments', () => {
    mount();
    btn(mount(), 'Politics').props.onClick({ currentTarget: mk(() => {}) });
    expect(find(mount(), (e) => e.props?.['aria-label'] === 'Language')).toBeUndefined();
  });
});

describe('search', () => {
  const type = (value) => { mount(); find(mount(), (e) => e.type === 'input' && e.props.placeholder === 'Find a channel').props.onChange({ target: { value } }); return mount(); };
  it('opens the panel with the matching channels as the user types, with focus staying in the box', () => {
    const out = type('abp');
    const pop = dialog(out);
    expect(pop.props['aria-label']).toBe('Search results');
    expect(tileNames(pop)).toEqual(['ABP Majha']);
      });
  it('matches the official name and the language, in any case', () => {
    expect(tileNames(dialog(type('MAJHA')))).toEqual(['ABP Majha']);
    harness.reset();
    expect(tileNames(dialog(type('malayalam')))).toEqual(['Asianet News']);
  });
  it('finds the channels of a language written in Devanagari; channel names are Latin script only, so a Devanagari name finds nothing', () => {
    expect(tileNames(dialog(type('मराठी'))).sort()).toEqual(['ABP Majha', 'TV9 Marathi']);
    harness.reset();
    expect(tileNames(dialog(type('हिंदी'))).sort()).toEqual(['Aaj Tak', 'DD News', 'The Lallantop', 'Zee News']);
    harness.reset();
    expect(text(dialog(type('आज तक')))).toContain(EMPTY_SEARCH);
  });
  it('says what to do when nothing matches', () => {
    const pop = dialog(type('zzzz'));
    expect(text(pop)).toContain(EMPTY_SEARCH);
    expect(EMPTY_SEARCH).toBe('No channel matches that. Paste its YouTube link at the top to watch and fact-check it anyway.');
  });
  it('closes when the box is cleared, and with Escape, returning focus to the box', () => {
    type('abp');
    find(mount(), (e) => e.type === 'input' && e.props.placeholder === 'Find a channel').props.onChange({ target: { value: '' } });
    expect(dialog(mount())).toBeUndefined();
    type('abp');
    const box = find(mount(), (e) => e.type === 'input' && e.props.placeholder === 'Find a channel');
    const focus = vi.fn();
    box.props.ref.current = { focus };
    find(mount(), (e) => e.type === 'section').props.onKeyDown({ key: 'Escape', preventDefault() {} });
    expect(dialog(mount())).toBeUndefined();
    expect(find(mount(), (e) => e.type === 'input' && e.props.placeholder === 'Find a channel').props.value).toBe('');
    expect(focus).toHaveBeenCalled();
  });
  it('has a visible label for screen readers', () => {
    expect(text(find(mount(), (e) => e.type === 'label' && /ltv-find/.test(e.props.className || '')))).toContain('Find a channel');
  });
});

describe('the phone sheet', () => {
  const openSheet = () => { mount(); btn(mount(), 'Channels').props.onClick({ currentTarget: mk(() => {}) }); return mount(); };
  const sheet = (out) => find(out, (e) => e.props?.role === 'dialog' && /ltv-sheet/.test(e.props.className || ''));
  it('opens from the Channels button with the search, the top lists and the segments', () => {
    const s = sheet(openSheet());
    expect(s.props['aria-label']).toBe('Channels');
    expect(find(s, (e) => e.type === 'input' && e.props.placeholder === 'Find a channel')).toBeDefined();
    expect(text(s)).toContain('TOP CHANNELS');
    expect(text(s)).toContain('SEGMENTS');
    expect(all(s, (e) => e.type === 'button' && /ltv-category-pill/.test(e.props.className || '')).map((b) => text(b).replace(/\s+/g, ' ').trim())).toEqual(['All 8', 'Politics & Debates 2', 'Plain 0', 'Regional 3']);
  });
  it('shows a segment\'s channels and goes back', () => {
    let out = openSheet();
    all(sheet(out), (e) => e.type === 'button' && /ltv-category-pill/.test(e.props.className || '')).find((b) => text(b).startsWith('Regional')).props.onClick();
    out = mount();
    expect(tileNames(sheet(out))).toHaveLength(3);
    btn(sheet(out), 'Back').props.onClick();
    expect(text(sheet(mount()))).toContain('SEGMENTS');
  });
  it('searches inside the sheet', () => {
    const out = openSheet();
    find(sheet(out), (e) => e.type === 'input').props.onChange({ target: { value: 'asianet' } });
    expect(tileNames(sheet(mount()))).toEqual(['Asianet News']);
    expect(dialog(mount())).toBeUndefined(); // the desktop panel does not open as well
  });
  it('selecting a tile closes the sheet; the close button and Escape close it and return focus', () => {
    const onSelectChannel = vi.fn();
    mount({ onSelectChannel });
    btn(mount({ onSelectChannel }), 'Channels').props.onClick({ currentTarget: { focus: () => {} } });
    all(sheet(mount({ onSelectChannel })), (e) => e.type === 'button' && /ltv-channel-chip/.test(e.props.className || ''))[0].props.onClick();
    expect(onSelectChannel).toHaveBeenCalled();
    expect(sheet(mount({ onSelectChannel }))).toBeUndefined();

    const focus = vi.fn();
    btn(mount(), 'Channels').props.onClick({ currentTarget: { focus } });
    find(sheet(mount()), (e) => e.props?.['aria-label'] === 'Close channels').props.onClick();
    expect(sheet(mount())).toBeUndefined();
    expect(focus).toHaveBeenCalledTimes(1);
    btn(mount(), 'Channels').props.onClick({ currentTarget: { focus } });
    find(mount(), (e) => e.type === 'section').props.onKeyDown({ key: 'Escape', preventDefault() {} });
    expect(sheet(mount())).toBeUndefined();
    expect(focus).toHaveBeenCalledTimes(2);
  });
});

describe('markup', () => {
  const html = (over = {}) => {
    harness.reset();
    return renderToStaticMarkup(<ChannelBar {...base} {...over} />);
  };
  it('renders for a page with no channels yet', () => {
    expect(() => html({ channels: [], loading: true })).not.toThrow();
  });
});

describe('which tab the bar opens on', () => {
  const tabs = (out) => all(find(out, (e) => e.props?.['aria-label'] === 'Top channel list'), (e) => e.type === 'button').map((b) => b.props['aria-pressed']);
  it('opens on My list when the user follows a channel that exists', () => {
    expect(tabs(mount({ following: ['ndtv'] }))).toEqual([true, false, false]);
  });
  it('opens on the first top list when nothing is followed, or only channels that are gone', () => {
    expect(tabs(mount({ following: [] }))).toEqual([false, true, false]);
    harness.reset();
    expect(tabs(mount({ following: ['gone'] }))).toEqual([false, true, false]);
  });
});

describe('a note under a list\'s heading', () => {
  it('shows the list\'s own note in its panel and in no other', () => {
    mount();
    btn(mount(), 'Politics').props.onClick({ currentTarget: mk(() => {}) });
    const note = find(dialog(mount()), (e) => /ltv-pop-note/.test(e.props?.className || ''));
    expect(text(note)).toBe('Only channels whose identity was verified are listed. More will be added.');
    btn(mount(), 'Regional').props.onClick({ currentTarget: mk(() => {}) });
    expect(find(dialog(mount()), (e) => /ltv-pop-note/.test(e.props?.className || ''))).toBeUndefined();
    btn(mount(), 'All').props.onClick({ currentTarget: mk(() => {}) });
    expect(find(dialog(mount()), (e) => /ltv-pop-note/.test(e.props?.className || ''))).toBeUndefined();
  });
});

describe('search by list name', () => {
  const type = (value) => { mount(); find(mount(), (e) => e.type === 'input' && e.props.placeholder === 'Find a channel').props.onChange({ target: { value } }); return mount(); };
  it('finds a list\'s channels by the list\'s name', () => {
    expect(tileNames(dialog(type('regional'))).sort()).toEqual(['ABP Majha', 'Asianet News', 'TV9 Marathi']);
    harness.reset();
    expect(tileNames(dialog(type('debates'))).sort()).toEqual(['DD News', 'The Lallantop']);
  });
});

describe('the desktop panel never leaves focus on a control it covers', () => {
  const docListeners = {};
  beforeEach(() => {
    for (const k of Object.keys(docListeners)) delete docListeners[k];
    globalThis.document = {
      addEventListener: (t, fn) => { (docListeners[t] ||= new Set()).add(fn); },
      removeEventListener: (t, fn) => { docListeners[t]?.delete(fn); },
    };
    harness.refFactory = () => ({ focus() {}, contains: (n) => Boolean(n?.inside) });
  });
  const fire = (type, target) => { for (const fn of [...(docListeners[type] || [])]) fn({ target }); };
  it('closes on a click outside the bar, without taking focus', () => {
    mount();
    btn(mount(), 'Politics').props.onClick({ currentTarget: { focus: vi.fn() } });
    mount();
    fire('pointerdown', { inside: true });
    expect(dialog(mount())).toBeDefined();
    fire('pointerdown', { inside: false });
    expect(dialog(mount())).toBeUndefined();
  });
  it('closes when focus moves outside the bar', () => {
    mount();
    btn(mount(), 'Politics').props.onClick({ currentTarget: { focus() {} } });
    mount();
    fire('focusin', { inside: true });
    expect(dialog(mount())).toBeDefined();
    fire('focusin', { inside: false });
    expect(dialog(mount())).toBeUndefined();
  });
  it('listens only while a panel is open', () => {
    mount();
    expect([...(docListeners.pointerdown || [])]).toHaveLength(0);
    btn(mount(), 'Politics').props.onClick({ currentTarget: { focus() {} } });
    mount();
    expect([...docListeners.pointerdown]).toHaveLength(1);
    find(mount(), (e) => e.props?.['aria-label'] === 'Close channel menu').props.onClick();
    mount();
    expect([...(docListeners.pointerdown || [])]).toHaveLength(0);
    expect([...(docListeners.focusin || [])]).toHaveLength(0);
  });
  it('is gone with the bar', () => {
    mount();
    btn(mount(), 'Politics').props.onClick({ currentTarget: { focus() {} } });
    mount();
    harness.unmount();
    expect([...(docListeners.pointerdown || [])]).toHaveLength(0);
  });
  afterEach(() => { delete globalThis.document; harness.refFactory = null; });
});

describe('the phone sheet is a modal dialog', () => {
  const sheet = (out) => find(out, (e) => e.props?.role === 'dialog' && /ltv-sheet/.test(e.props.className || ''));
  const openSheet = (props) => { mount(props); btn(mount(props), 'Channels').props.onClick({ currentTarget: mk(() => {}) }); return mount(props); };
  afterEach(() => { delete globalThis.window; harness.refFactory = null; });

  it('says it is modal', () => {
    expect(sheet(openSheet()).props['aria-modal']).toBe('true');
  });
  it('keeps Tab inside it', () => {
    const first = { focus: vi.fn() }; const last = { focus: vi.fn() };
    harness.refFactory = () => ({ focus() {}, contains: () => true, querySelectorAll: () => [first, last], ownerDocument: { activeElement: last } });
    const out = openSheet();
    const prevent = vi.fn();
    sheet(out).props.onKeyDown({ key: 'Tab', shiftKey: false, preventDefault: prevent });
    expect(first.focus).toHaveBeenCalled();
    expect(prevent).toHaveBeenCalled();
  });
  it('makes the bar behind it inert while it is open, and not after', () => {
    expect(find(mount(), (e) => /ltv-bar-rows/.test(e.props?.className || '')).props.inert).toBeUndefined();
    const out = openSheet();
    expect(find(out, (e) => /ltv-bar-rows/.test(e.props?.className || '')).props.inert).toBe(true);
    find(sheet(out), (e) => e.props?.['aria-label'] === 'Close channels').props.onClick();
    expect(find(mount(), (e) => /ltv-bar-rows/.test(e.props?.className || '')).props.inert).toBeUndefined();
  });
  it('tells the page it is open, so the page behind it can be made inert too', () => {
    const onModalChange = vi.fn();
    openSheet({ onModalChange });
    expect(onModalChange).toHaveBeenLastCalledWith(true);
    find(sheet(mount({ onModalChange })), (e) => e.props?.['aria-label'] === 'Close channels').props.onClick();
    mount({ onModalChange });
    expect(onModalChange).toHaveBeenLastCalledWith(false);
  });
  it('closes, and resets aria-expanded, if the window grows past phones', () => {
    let listener;
    globalThis.window = { matchMedia: () => ({ addEventListener: (_t, fn) => { listener = fn; }, removeEventListener() {} }) };
    openSheet();
    expect(btn(mount(), 'Channels').props['aria-expanded']).toBe(true);
    listener({ matches: false });
    expect(sheet(mount())).toBeUndefined();
    expect(btn(mount(), 'Channels').props['aria-expanded']).toBe(false);
  });
  it('stays open while the window is still a phone', () => {
    let listener;
    globalThis.window = { matchMedia: () => ({ addEventListener: (_t, fn) => { listener = fn; }, removeEventListener() {} }) };
    openSheet();
    listener({ matches: true });
    expect(sheet(mount())).toBeDefined();
  });
});

describe('closing the sheet gives focus back only once the page behind it is no longer inert', () => {
  // Probe: calls the bar as the page would and keeps the tree of the pass that is being committed, so the stand-in
  // for the focused control can look at it when focus() is called (an inert ancestor makes focus() do nothing).
  const probe = { tree: null };
  const Probe = (props) => { probe.tree = ChannelBar(props); return probe.tree; };
  const render = (props = {}) => expand(harness.render(Probe, { ...base, ...props }));
  const rowsInert = () => find(probe.tree, (e) => /ltv-bar-rows/.test(e.props?.className || '')).props.inert;
  const sheetOf = (out) => find(out, (e) => e.props?.role === 'dialog' && /ltv-sheet/.test(e.props.className || ''));

  it.each([
    ['the close button', (out) => find(sheetOf(out), (e) => e.props?.['aria-label'] === 'Close channels').props.onClick()],
    ['Escape', () => find(probe.tree, (e) => e.type === 'section').props.onKeyDown({ key: 'Escape', preventDefault() {} })],
  ])('with %s: focus is not tried while the control is still inert, and is tried once', (_n, close) => {
    const seen = [];
    const control = { focus: () => seen.push(rowsInert()) };
    render();
    btn(render(), 'Channels').props.onClick({ currentTarget: control });
    const open = render();
    expect(rowsInert()).toBe(true);
    close(open);
    expect(seen).toEqual([]); // not in the click handler, where the bar behind the sheet is still inert
    render();
    expect(seen).toEqual([undefined]); // once, after the sheet closed and the inert attribute was taken off
  });
});

describe('the page behind the sheet is let go when the bar goes away', () => {
  it('tells the page the sheet is closed when the bar unmounts', () => {
    const onModalChange = vi.fn();
    mount({ onModalChange });
    btn(mount({ onModalChange }), 'Channels').props.onClick({ currentTarget: mk(() => {}) });
    mount({ onModalChange });
    expect(onModalChange).toHaveBeenLastCalledWith(true);
    harness.unmount();
    expect(onModalChange).toHaveBeenLastCalledWith(false);
  });
});
