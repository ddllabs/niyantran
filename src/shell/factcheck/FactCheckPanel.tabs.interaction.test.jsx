// F366 slice B: the panel's tab and filter state, and "See why" (a focus request from the page), run with
// real effects (hookHarness.js). The children are not rendered; the elements the panel returns are read.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, elements } from '../hookHarness.js';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, accessToken: async () => null, functionsUrl: () => '' }));
const { PanelBody, Claims, RunningControls } = await import('./FactCheckPanel.jsx');
const { RovingTabs } = await import('./FactCheckTabs.jsx');

const noop = () => {};
const claim = (id, verdict) => ({ id, quote: 'q', claim_en: `Claim ${id}`, kind: 'claim', status: 'checked', verdict, reason: 'r', sources: [], checked_at: null });
const view = {
  flag: { available: true, creditsPerMinute: 500, recheckCredits: null, userId: 'u' }, supported: true, ready: true, announcement: '', balance: 1000, rechecks: {},
  session: { status: 'running', minutesBought: 5, secondsLeft: 200, creditsHeld: 2500, creditsPerMinute: 500, transcript: [], claims: [claim('1', 'supported'), claim('2', 'contradicted')], silentFor: 0, skippedPieces: 0, droppedTurns: 0, budgetReached: false, final: null, endReason: null, error: null },
};
const props = (extra = {}) => ({ view, isMuted: false, onUnmute: noop, onConfirm: noop, onCancel: noop, onStop: noop, onRetry: noop, onDismiss: noop, ...extra });
const find = (out, type) => [...elements(out)].find((e) => e.type === type);

const card = { focus: vi.fn(), scrollIntoView: vi.fn() };
beforeEach(() => {
  harness.reset();
  card.focus.mockClear(); card.scrollIntoView.mockClear();
  globalThis.document = { getElementById: (id) => (id === 'fc-claim-2' ? card : null), activeElement: null };
  globalThis.window = { matchMedia: () => ({ matches: false }) };
});

afterEach(() => { delete globalThis.document; delete globalThis.window; }); // the stubs must not reach other test files

describe('tabs', () => {
  it('start on Claims and move when asked', () => {
    let out = harness.render(PanelBody, props());
    expect(find(out, RovingTabs).props.active).toBe('claims');
    find(out, RovingTabs).props.onChange('transcript');
    out = harness.render(PanelBody, props());
    expect(find(out, RovingTabs).props.active).toBe('transcript');
    expect(find(out, RovingTabs).props.tabs.map((t) => t.label)).toEqual(['Claims · 2', 'Transcript', 'Summary']);
  });
});

describe('filters', () => {
  it('toggle on and off, several at once, and clear', () => {
    let out = harness.render(PanelBody, props());
    expect(find(out, Claims).props.filters).toEqual([]);
    find(out, Claims).props.onToggle('supported');
    out = harness.render(PanelBody, props());
    find(out, Claims).props.onToggle('opinion');
    out = harness.render(PanelBody, props());
    expect(find(out, Claims).props.filters).toEqual(['supported', 'opinion']);
    find(out, Claims).props.onToggle('supported');
    out = harness.render(PanelBody, props());
    expect(find(out, Claims).props.filters).toEqual(['opinion']);
    find(out, Claims).props.onClear();
    out = harness.render(PanelBody, props());
    expect(find(out, Claims).props.filters).toEqual([]);
  });
});

describe('See why (a focus request from the page)', () => {
  it('opens Claims, clears a filter that hides the claim, then scrolls to the card and focuses it', () => {
    let out = harness.render(PanelBody, props());
    find(out, RovingTabs).props.onChange('transcript');
    out = harness.render(PanelBody, props());
    find(out, Claims).props.onToggle('supported'); // hides claim 2
    out = harness.render(PanelBody, props());
    out = harness.render(PanelBody, props({ focusRequest: { claimId: '2', token: 1 } }));
    expect(find(out, RovingTabs).props.active).toBe('claims');
    expect(find(out, Claims).props.filters).toEqual([]);
    expect(card.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(card.focus).toHaveBeenCalledTimes(1);
  });
  it('keeps a filter that already shows the claim', () => {
    let out = harness.render(PanelBody, props());
    find(out, Claims).props.onToggle('contradicted');
    out = harness.render(PanelBody, props());
    out = harness.render(PanelBody, props({ focusRequest: { claimId: '2', token: 1 } }));
    expect(find(out, Claims).props.filters).toEqual(['contradicted']);
    expect(card.focus).toHaveBeenCalledTimes(1);
  });
  it('acts once for a token, not on every render, and again for a new one', () => {
    harness.render(PanelBody, props({ focusRequest: { claimId: '2', token: 1 } }));
    harness.render(PanelBody, props({ focusRequest: { claimId: '2', token: 1 } }));
    expect(card.focus).toHaveBeenCalledTimes(1);
    harness.render(PanelBody, props({ focusRequest: { claimId: '2', token: 2 } }));
    expect(card.focus).toHaveBeenCalledTimes(2);
  });
  it('does nothing without a request', () => {
    harness.render(PanelBody, props());
    expect(card.focus).not.toHaveBeenCalled();
  });
});

describe('Summary tab (B3)', () => {
  it('opens from the tab list, and its Show card button opens Claims, clears a hiding filter and focuses the card', async () => {
    const { SummaryTab: Summary } = await import('./SummaryTab.jsx');
    let out = harness.render(PanelBody, props());
    find(out, RovingTabs).props.onChange('summary');
    out = harness.render(PanelBody, props());
    expect(find(out, RovingTabs).props.active).toBe('summary');
    find(out, Claims).props.onToggle('supported'); // hides claim 2
    out = harness.render(PanelBody, props());
    find(out, Summary).props.onSee('2');
    out = harness.render(PanelBody, props());
    expect(find(out, RovingTabs).props.active).toBe('claims');
    expect(find(out, Claims).props.filters).toEqual([]);
    expect(card.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(card.focus).toHaveBeenCalledTimes(1);
  });
  it('the three tabs keep one tab stop and arrow order Claims, Transcript, Summary', async () => {
    const { nextTab } = await import('./FactCheckTabs.jsx');
    const ids = ['claims', 'transcript', 'summary'];
    expect(nextTab(ids, 'transcript', 'ArrowRight')).toBe('summary');
    expect(nextTab(ids, 'summary', 'ArrowRight')).toBe('claims');
    expect(nextTab(ids, 'claims', 'ArrowLeft')).toBe('summary');
    expect(nextTab(ids, 'claims', 'End')).toBe('summary');
  });
});


describe('F416 the paste-a-link button and slot (running)', () => {
  const form = { type: 'form', props: { className: 'ltv-paste' } };
  const slot = (out) => [...elements(out)].find((e) => e.props?.id === 'fc-linkslot');
  const head = (out) => find(out, RunningControls);
  const linkButton = (out) => [...elements(harness.render(RunningControls, head(out).props))].find((e) => e.props?.['data-fc'] === 'link');
  const focused = [];
  beforeEach(() => {
    focused.length = 0;
    harness.refFactory = () => ({ focus: () => focused.push('ref') });
  });
  afterEach(() => { harness.refFactory = null; });

  it('passes the open state to the button and renders no slot while it is closed', () => {
    const toggle = vi.fn();
    const out = harness.render(PanelBody, props({ linkForm: form, linkOpen: false, onToggleLink: toggle }));
    expect(slot(out)).toBeUndefined();
    const b = linkButton(out);
    expect(b.props['aria-expanded']).toBe(false);
    expect(b.props['aria-label']).toBe('Paste a video link');
    expect(b.props['aria-controls']).toBe('fc-linkslot');
    b.props.onClick();
    expect(toggle).toHaveBeenCalledTimes(1);
  });
  it('renders the slot with the form when open, and the button says expanded', () => {
    const out = harness.render(PanelBody, props({ linkForm: form, linkOpen: true, onToggleLink: noop }));
    expect(slot(out)).toBeTruthy();
    expect(linkButton(out).props['aria-expanded']).toBe(true);
  });
  it('Escape inside the open slot closes it through onToggleLink, stops there, and returns focus to the link button', () => {
    const toggle = vi.fn();
    const out = harness.render(PanelBody, props({ linkForm: form, linkOpen: true, onToggleLink: toggle }));
    // A dedicated spy on the link button's own ref: every other ref (the heading, the panel) keeps the factory's focus.
    const buttonFocus = vi.fn();
    head(out).props.linkButton.current = { focus: buttonFocus };
    focused.length = 0;
    const other = { key: 'a', stopPropagation: vi.fn() };
    slot(out).props.onKeyDown(other);
    expect(toggle).not.toHaveBeenCalled();
    expect(other.stopPropagation).not.toHaveBeenCalled();
    const esc = { key: 'Escape', stopPropagation: vi.fn() };
    slot(out).props.onKeyDown(esc);
    expect(esc.stopPropagation).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(buttonFocus).toHaveBeenCalledTimes(1);
    expect(focused).toEqual([]); // and nothing else was focused
  });
  it('Escape on the link button itself closes an open slot and stops there; a closed slot lets it through', () => {
    const toggle = vi.fn();
    const open = linkButton(harness.render(PanelBody, props({ linkForm: form, linkOpen: true, onToggleLink: toggle })));
    const esc = { key: 'Escape', stopPropagation: vi.fn() };
    open.props.onKeyDown(esc);
    expect(esc.stopPropagation).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledTimes(1);
    open.props.onKeyDown({ key: 'a', stopPropagation: vi.fn() });
    expect(toggle).toHaveBeenCalledTimes(1);
    harness.reset();
    const closed = linkButton(harness.render(PanelBody, props({ linkForm: form, linkOpen: false, onToggleLink: toggle })));
    const through = { key: 'Escape', stopPropagation: vi.fn() };
    closed.props.onKeyDown(through);
    expect(through.stopPropagation).not.toHaveBeenCalled();
    expect(toggle).toHaveBeenCalledTimes(1);
  });
  it('names the icon button for sighted users too (title)', () => {
    expect(linkButton(harness.render(PanelBody, props({ linkForm: form, linkOpen: false, onToggleLink: noop }))).props.title).toBe('Paste a video link');
  });
});

// F416 review: React keeps an element (and the focus inside it) only while its place in the tree is the same:
// the same chain of (index, type, key) from the root. The tabs, the heading and the paste slot must keep that
// place when a session goes from running or ending to ended or error, or focus drops to the page body.
describe('F416 the tree keeps its shape when the session ends', () => {
  const pathTo = (root, pred) => {
    const walk = (node, path) => {
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i += 1) { const r = walk(node[i], [...path, `[${i}]`]); if (r) return r; }
        return null;
      }
      if (!node || typeof node !== 'object' || !('props' in node)) return null;
      const here = [...path, `${typeof node.type === 'string' ? node.type : node.type.name}#${node.key ?? ''}`];
      if (pred(node)) return here.join('/');
      return walk(node.props?.children, here);
    };
    return walk(root, []);
  };
  const places = (out) => ({
    tabs: pathTo(out, (e) => e.type === RovingTabs),
    heading: pathTo(out, (e) => e.type === 'h3' && e.props.id === 'fc-title'),
    slot: pathTo(out, (e) => e.type === 'div' && /fc-linkslot/.test(e.props.className || '')),
  });
  const form = { type: 'form', props: { className: 'ltv-paste' } };
  const withStatus = (status) => ({ ...view, session: { ...view.session, status, final: status === 'ended' ? { minutes_used: 2, credits_charged: 1000, balance: 4000 } : null, error: status === 'error' ? { reason: 'capture_failed' } : null } });
  it.each([['running', 'ended'], ['ending', 'ended'], ['running', 'error'], ['ending', 'error']])('%s -> %s: tabs, heading and the open paste slot stay in place', (from, to) => {
    const before = places(harness.render(PanelBody, props({ view: withStatus(from), linkForm: form, linkOpen: true })));
    harness.reset();
    const after = places(harness.render(PanelBody, props({ view: withStatus(to), linkForm: form, linkOpen: true })));
    for (const k of ['tabs', 'heading', 'slot']) expect(before[k], `${from} ${k}`).toBeTruthy();
    expect(after).toEqual(before);
  });
});
