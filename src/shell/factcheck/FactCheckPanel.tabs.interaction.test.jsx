// F366 slice B: the panel's tab and filter state, and "See why" (a focus request from the page), run with
// real effects (hookHarness.js). The children are not rendered; the elements the panel returns are read.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, elements } from '../hookHarness.js';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, accessToken: async () => null, functionsUrl: () => '' }));
const { PanelBody, Claims } = await import('./FactCheckPanel.jsx');
const { RovingTabs } = await import('./FactCheckTabs.jsx');

const noop = () => {};
const claim = (id, verdict) => ({ id, quote: 'q', claim_en: `Claim ${id}`, kind: 'claim', status: 'checked', verdict, reason: 'r', sources: [], checked_at: null });
const view = {
  flag: { available: true, creditsPerMinute: 500, recheckCredits: null, userId: 'u' }, supported: true, ready: true, announcement: '', balance: 1000, rechecks: {},
  session: { status: 'running', minutesBought: 5, secondsLeft: 200, creditsHeld: 2500, creditsPerMinute: 500, transcript: [], claims: [claim('1', 'supported'), claim('2', 'contradicted')], silentFor: 0, skippedPieces: 0, droppedTurns: 0, budgetReached: false, final: null, endReason: null, error: null },
};
const props = (extra = {}) => ({ view, isMuted: false, onUnmute: noop, onConfirm: noop, onCancel: noop, onStop: noop, onRetry: noop, onDismiss: noop, quietOpen: true, ...extra });
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
    expect(find(out, RovingTabs).props.tabs.map((t) => t.label)).toEqual(['Claims · 2', 'Transcript']);
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
