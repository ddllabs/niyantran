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
    const inner = {};
    const doc = Object.assign(fakeTarget(), { activeElement: inner });
    const onClose = vi.fn();
    const focusPill = vi.fn();
    watchPopover({ doc, root: fakeNode([inner]), onClose, focusPill });
    fire(doc, 'keydown', { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
    fire(doc, 'keydown', { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(focusPill).toHaveBeenCalledOnce();
  });

  // F193 review: a popover opened for a refusal leaves focus in the chat box; Escape typed there
  // closes it and keeps focus where it is.
  it('closes on Escape without taking focus when focus was outside it', () => {
    const doc = Object.assign(fakeTarget(), { activeElement: { tagName: 'TEXTAREA' } });
    const onClose = vi.fn();
    const focusPill = vi.fn();
    watchPopover({ doc, root: fakeNode([{}]), onClose, focusPill });
    fire(doc, 'keydown', { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(focusPill).not.toHaveBeenCalled();
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

// F193: every credit message lives at the pill; the chat's refusal opens the popover by itself.
describe('the messages at the pill', () => {
  const wallet = (patch = {}) => ({ userId: 'u1', balance: 0, held: 0, available: 0, debt: 0, plan: 'plus', allowance: 2000, cycleEndsAt: null, lots: [], ...patch });

  it('leads with the refusal and does not repeat it as the empty message', async () => {
    const { GlanceMessages } = await import('./BalancePill.jsx');
    const html = renderToStaticMarkup(<GlanceMessages credits={wallet()} notice={{ block: 'credits_exhausted' }} />);
    expect(html.match(/You have no AI credits left to start an answer\./g)).toHaveLength(1);
    expect(html).toContain('role="alert"');
    expect(html).toContain('>Upgrade</button>');
    expect(html).toContain('>Buy credits</button>');
  });

  it('offers no way to buy when the credits are in use by a running answer', async () => {
    const { GlanceMessages } = await import('./BalancePill.jsx');
    const html = renderToStaticMarkup(<GlanceMessages credits={wallet({ balance: 30, held: 30 })} notice={{ block: 'credits_exhausted', held: true }} />);
    expect(html).toContain('in use by an answer that is still running');
    expect(html).not.toContain('Buy credits');
    expect(html).not.toContain('Upgrade');
  });

  it('offers Try again, which replays the turn, when the balance could not be checked', async () => {
    const { GlanceMessages } = await import('./BalancePill.jsx');
    const retry = vi.fn();
    const onDone = vi.fn();
    const tree = GlanceMessages({ credits: null, failed: true, notice: { block: 'credits_unavailable', retry }, onDone });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('so your answer did not start');
    expect(html).not.toContain('AI credits could not be checked right now');
    const find = (node) => {
      if (!node || typeof node !== 'object') return null;
      if (node.type === 'button' && node.props.children === 'Try again') return node;
      for (const child of [node.props?.children].flat()) { const hit = find(child); if (hit) return hit; }
      return null;
    };
    find(tree).props.onClick();
    expect(retry).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('shows the low warning without a refusal, and nothing when all is well', async () => {
    const { GlanceMessages } = await import('./BalancePill.jsx');
    expect(renderToStaticMarkup(<GlanceMessages credits={wallet({ balance: 120, available: 120 })} notice={null} />)).toContain('Running low: 120 credits left this cycle.');
    expect(renderToStaticMarkup(<GlanceMessages credits={wallet({ balance: 1500, available: 1500 })} notice={null} />)).toBe('');
  });

  it('leaves held credits to the popover\'s own line', async () => {
    const { GlanceMessages } = await import('./BalancePill.jsx');
    expect(renderToStaticMarkup(<GlanceMessages credits={wallet({ balance: 1500, available: 1400, held: 100 })} notice={null} />)).toBe('');
  });

  it('opens by itself for a new refusal, not for the same one again or for none', async () => {
    const { opensFor } = await import('./BalancePill.jsx');
    const out = { block: 'credits_exhausted', held: false };
    expect(opensFor(null, out)).toBe(true);
    expect(opensFor(out, { ...out })).toBe(false);
    expect(opensFor(out, { block: 'credits_unavailable', held: false })).toBe(true);
    expect(opensFor(out, null)).toBe(false);
  });

  it('opens quietly only when it was closed, so a refusal while it is open leaves the next opening normal', async () => {
    const { noticeStep } = await import('./BalancePill.jsx');
    const out = { block: 'credits_exhausted', held: false };
    expect(noticeStep(null, out, false)).toEqual({ open: true, quiet: true });
    expect(noticeStep(null, out, true)).toEqual({ open: false, quiet: false });
    expect(noticeStep(out, { ...out }, false)).toEqual({ open: false, quiet: false });
    expect(noticeStep(out, null, false)).toEqual({ open: false, quiet: false });
  });

  it('marks the pill while a refusal or a warning stands, red for danger and amber for a warning', async () => {
    const { attentionTone } = await import('./BalancePill.jsx');
    expect(attentionTone(wallet({ balance: 1500, available: 1500 }), false, null)).toBeNull();
    expect(attentionTone(wallet({ balance: 1500, available: 1500 }), false, { block: 'credits_unavailable' })).toBe('warn');
    expect(attentionTone(wallet({ balance: 120, available: 120 }), false, null)).toBe('warn');
    expect(attentionTone(wallet(), false, null)).toBe('danger');
    expect(attentionTone(wallet(), false, { block: 'credits_exhausted' })).toBe('danger');
    expect(attentionTone(null, true, null)).toBe('warn');
  });
});
