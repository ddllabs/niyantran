// F184: the header pill's popover closes on a press outside, on Escape (focus back to the pill) and
// when focus leaves it; the pill's words for each state; days left as renewal or expiry.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {} }));
import { BalanceRing, balanceState, ringArc } from './BalanceRing.jsx';
import { daysLeftText, watchPopover } from './BalancePill.jsx';

// Listener targets whose events carry any target (a DOM Event's target is read-only).
function fakeTarget(children = []) {
  const on = new Map();
  return {
    contains: (n) => children.includes(n),
    addEventListener: (type, fn) => on.set(type, [...(on.get(type) || []), fn]),
    removeEventListener: (type, fn) => on.set(type, (on.get(type) || []).filter((f) => f !== fn)),
    emit: (type, event) => (on.get(type) || []).forEach((fn) => fn(event)),
  };
}
const fakeNode = fakeTarget;
const fire = (target, type, event) => target.emit(type, event);

describe('the glance popover', () => {
  it('closes on a press outside, not inside', () => {
    const inner = {};
    const root = fakeNode([inner]);
    const doc = fakeTarget();
    const onClose = vi.fn();
    const stop = watchPopover({ doc, root, onClose, focusPill: vi.fn() });
    fire(doc, 'mousedown', { target: inner });
    expect(onClose).not.toHaveBeenCalled();
    fire(doc, 'mousedown', { target: {} });
    expect(onClose).toHaveBeenCalledOnce();
    stop();
    fire(doc, 'mousedown', { target: {} });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on Escape and hands focus back to the pill; other keys do nothing', () => {
    const doc = fakeTarget();
    const onClose = vi.fn();
    const focusPill = vi.fn();
    watchPopover({ doc, root: fakeNode(), onClose, focusPill });
    fire(doc, 'keydown', { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
    fire(doc, 'keydown', { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(focusPill).toHaveBeenCalledOnce();
  });

  it('closes when focus moves out of it, not when it moves within it', () => {
    const inner = {};
    const root = fakeNode([inner]);
    const onClose = vi.fn();
    watchPopover({ doc: fakeTarget(), root, onClose, focusPill: vi.fn() });
    fire(root, 'focusout', { relatedTarget: inner });
    expect(onClose).not.toHaveBeenCalled();
    fire(root, 'focusout', { relatedTarget: {} });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('the pill and ring', () => {
  const CREDITS = { balance: 880, held: 20, plan: 'plus', allowance: 2000, usedThisCycle: 1240, lots: [{ kind: 'monthly', remaining: 880 }] };

  it('names the state the ring shows', () => {
    expect(balanceState(null)).toBe('loading');
    expect(balanceState(null, true)).toBe('unchecked');
    expect(balanceState(CREDITS)).toBe('ok');
    expect(balanceState({ ...CREDITS, balance: 150, held: 0 })).toBe('low');
    expect(balanceState({ ...CREDITS, balance: 50, held: 50 })).toBe('empty');
    expect(balanceState({ ...CREDITS, balance: -10, held: 0 })).toBe('empty');
  });

  it('fills the ring by the share left, and shows a dash when the balance is unknown', () => {
    const ok = renderToStaticMarkup(<BalanceRing credits={CREDITS} />);
    expect(ok).toContain('class="cp-ring cp-ring-ok"');
    // 860 left of 2,120 is 40.6% of the ring, drawn clockwise from the top as a path (no transform).
    expect(ok).toContain('<path class="cp-ring-fill" d="M 20 4 A 16 16 0 0 1 28.94 33.27"></path>');
    expect(ok).not.toContain('transform');
    expect(renderToStaticMarkup(<BalanceRing credits={CREDITS} size={44} />)).toContain('class="cp-ring-spark"');
    expect(ringArc(0)).toBeNull();
    expect(ringArc(0.75)).toBe('M 20 4 A 16 16 0 1 1 4.00 20.00');
    expect(renderToStaticMarkup(<BalanceRing credits={null} failed />)).toContain('class="cp-ring-dash"');
  });

  it('counts days to renewal, or to expiry for sign-up credits', () => {
    const now = Date.parse('2026-10-24T12:00:00Z');
    const ends = { cycleEndsAt: '2026-11-11T18:30:00Z' };
    expect(daysLeftText({ ...ends, plan: 'plus' }, now)).toBe('19 days to renewal');
    expect(daysLeftText({ ...ends, plan: 'free' }, now)).toBe('19 days until they expire');
    expect(daysLeftText({ cycleEndsAt: null, plan: 'plus' }, now)).toBe('');
  });
});
