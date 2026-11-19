// F344 R3: the "Check again" control on a verdict card, in every state. With no re-check price the
// panel is byte for byte what it was before (fixtures rendered from the code before this change).
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, accessToken: async () => null, functionsUrl: () => '' }));
import { FactCheckPanel } from './FactCheckPanel.jsx';
import { liveNodes } from './liveNodes.js';
import { PIN_VIEWS } from './pinViews.js';

const base = {
  status: 'running', sessionId: 's', minutesBought: 5, creditsPerMinute: 500, creditsHeld: 2500, secondsLeft: 100,
  transcript: [], claims: [], silentFor: 0, skippedPieces: 0, droppedTurns: 0, budgetReached: false, final: null, endReason: null, error: null,
};
const claim = (over = {}) => ({
  id: 'c1', claim_en: 'The rate is 18 percent', claimant: null, reported_by: null, kind: 'claim', status: 'checked', verdict: 'supported',
  reason: 'The schedule agrees.', sources: [{ url: 'https://a.test/x', title: 'Schedule' }], checked_at: '2026-11-16T09:00:00.000Z', ...over,
});
const result = (id, over = {}) => ({
  id, supersedes: 'c1', status: 'checked', verdict: 'contradicted', reason: `reason ${id}`,
  sources: [{ url: `https://b.test/${id}`, title: `Source ${id}` }], checked_at: '2026-11-16T10:00:00.000Z', ...over,
});
const view = (session = {}, extra = {}, price = 100) => ({
  flag: { available: true, creditsPerMinute: 500, recheckCredits: price, userId: 'u' }, supported: true, ready: true,
  session: { ...base, ...session }, announcement: '', balance: 1000, rechecks: {}, ...extra,
});
const handlers = { onUnmute() {}, onConfirm() {}, onCancel() {}, onStop() {}, onRetry() {}, onDismiss() {}, onRecheckAsk() {}, onRecheckConfirm() {}, onRecheckCancel() {} };
const render = (v, props = {}) => renderToStaticMarkup(<FactCheckPanel view={v} isMuted={false} {...handlers} {...props} />);
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const withClaim = (c, extra, price) => view({ claims: [c] }, extra, price);

describe('nothing changes when the price is unknown', () => {
  const pinned = (name) => readFileSync(new URL(`./fixtures/panel-${name}.html`, import.meta.url), 'utf8').trimEnd();
  for (const price of [null, undefined]) {
    it(`running view is identical (price ${price})`, () => {
      const v = PIN_VIEWS().running;
      expect(render({ ...v, flag: { ...v.flag, recheckCredits: price }, rechecks: {} })).toBe(pinned('running'));
    });
    it(`ended view is identical (price ${price})`, () => {
      const v = PIN_VIEWS().ended;
      expect(render({ ...v, flag: { ...v.flag, recheckCredits: price }, rechecks: {} })).toBe(pinned('ended'));
    });
  }
  it('stale re-check state is ignored when the price is unknown', () => {
    const v = PIN_VIEWS().running;
    const html = render({ ...v, flag: { ...v.flag, recheckCredits: null }, rechecks: { a: { phase: 'confirming', results: [result('n1')], error: 'x', notice: 'y' } } });
    expect(html).toBe(pinned('running'));
  });
  it('the pinned fixtures themselves have no re-check markup', () => {
    expect(pinned('running')).not.toMatch(/fc-recheck|Check again/);
  });
});

describe('the button', () => {
  it('shows "Check again · 100 credits" on a checked card and on a failed one', () => {
    for (const status of ['checked', 'error']) {
      const html = render(withClaim(claim({ status, verdict: status === 'error' ? null : 'supported' })));
      expect(text(html)).toContain('Check again · 100 credits');
      expect(html).toMatch(/<button[^>]*id="fc-recheck-c1"[^>]*data-fc="recheck"/);
    }
  });
  it('is absent on pending, needs_context, not_checkable and unchecked cards', () => {
    for (const status of ['pending', 'needs_context', 'not_checkable', 'unchecked']) {
      expect(render(withClaim(claim({ status, verdict: null, checked_at: null })))).not.toMatch(/data-fc="recheck"/);
    }
  });
  it('is in the running and the ended view', () => {
    expect(render(withClaim(claim()))).toMatch(/data-fc="recheck"/);
    expect(render(view({ status: 'ended', endReason: 'time', claims: [claim()] }))).toMatch(/data-fc="recheck"/);
  });
  it('uses the price formatter', () => {
    expect(text(render(withClaim(claim(), {}, 1000)))).toContain('Check again · 1,000 credits');
    expect(text(render(withClaim(claim(), {}, 1)))).toContain('Check again · 1 credit');
  });
});

describe('confirming', () => {
  const confirming = (extra = {}, balance = 1000) => withClaim(claim(), { balance, rechecks: { c1: { phase: 'confirming', results: [], error: null, notice: '', ...extra } } });
  it('shows the price and the balance with Confirm and Cancel', () => {
    const html = render(confirming());
    const t = text(html);
    expect(t).toContain('Check this claim again for 100 credits?');
    expect(t).toContain('Your balance is 1,000 credits.');
    expect(html).toMatch(/<div[^>]*class="fc-confirm"[^>]*role="group"/);
    expect(html).toMatch(/<button[^>]*data-fc="recheck-confirm"(?![^>]*disabled)[^>]*>/);
    expect(html).toMatch(/<button[^>]*data-fc="recheck-cancel"/);
  });
  it('disables Confirm with the reason when the balance cannot cover it', () => {
    const html = render(confirming({}, 40));
    expect(html).toMatch(/<button[^>]*data-fc="recheck-confirm"[^>]*disabled/);
    expect(text(html)).toContain('Needs 100 credits; you have 40 credits.');
  });
  it('says so when the balance could not be read, and leaves the decision to the server', () => {
    const html = render(confirming({}, null));
    expect(text(html)).toContain('Your balance could not be read.');
    expect(html).not.toMatch(/data-fc="recheck-confirm"[^>]*disabled/);
  });
  it('shows a price-changed message above the confirmation', () => {
    const html = render(confirming({ error: 'The price changed to 150 credits. Check again to confirm.' }));
    expect(text(html)).toContain('The price changed to 150 credits. Check again to confirm.');
  });
  it('every control is a real button', () => {
    const html = render(confirming());
    for (const b of html.match(/<button[^>]*>/g)) expect(b).toMatch(/type="button"/);
    // F366: the roving tab buttons and a claim card (a target for "See why") may carry tabindex="-1"; no control does.
    for (const b of html.match(/<button[^>]*role="tab"[^>]*aria-selected="true"[^>]*>/g) || []) expect(b).toMatch(/tabindex="0"/);
    expect(html.replace(/<h3[^>]*>/g, '').replace(/<button[^>]*role="tab"[^>]*aria-selected="false"[^>]*>/g, '').replace(/<li[^>]*id="fc-claim-[^"]*"[^>]*>/g, '')).not.toMatch(/tabindex="-1"/);
  });
});

describe('running', () => {
  it('shows "Checking again…" and keeps the button focusable but inert', () => {
    const html = render(withClaim(claim(), { rechecks: { c1: { phase: 'running', results: [], error: null, notice: '' } } }));
    expect(text(html)).toContain('Checking again…');
    expect(html).toMatch(/<button[^>]*data-fc="recheck"[^>]*aria-disabled="true"/);
    expect(html).not.toMatch(/data-fc="recheck"[^>]*\sdisabled/);
  });
  it('does not add a second live region', () => {
    const html = render(withClaim(claim(), { rechecks: { c1: { phase: 'running', results: [], error: null, notice: '' } } }));
    // the verdict announcer and the one shared status node for copy and export; a re-check adds none
    expect(liveNodes(html)).toHaveLength(2);
  });
});

describe('the result', () => {
  const done = (results, extra = {}) => withClaim(claim(), { rechecks: { c1: { phase: 'idle', results, error: null, notice: 'Charged 100 credits', ...extra } } });
  it('replaces the main verdict, with its date, and says what was charged', () => {
    const html = render(done([result('n1')]));
    const main = html.slice(html.indexOf('<li class="fc-card'), html.indexOf('fc-earlier-toggle'));
    expect(main).toMatch(/fc-badge--contradicted/);
    expect(main).not.toMatch(/fc-badge--supported/);
    expect(text(main)).toContain('reason n1');
    expect(main).toMatch(/dateTime="2026-11-16T10:00:00.000Z"|datetime="2026-11-16T10:00:00.000Z"/i);
    expect(text(html)).toContain('Charged 100 credits');
    expect(text(html)).toContain('The rate is 18 percent');
  });
  it('keeps the previous result under a collapsed "Earlier result" disclosure', () => {
    const html = render(done([result('n1')]));
    expect(html).toMatch(/<button[^>]*class="fc-earlier-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="fc-earlier-c1"[^>]*>Earlier result</);
    const list = html.match(/<ol[^>]*id="fc-earlier-c1"[^>]*>[\s\S]*?<\/ol>/)[0];
    expect(list).toMatch(/\shidden/);
    expect(list).toMatch(/fc-badge--supported/);
    expect(text(list)).toContain('The schedule agrees.');
    expect(list).toMatch(/href="https:\/\/a.test\/x"/);
    expect(list).toMatch(/datetime="2026-11-16T09:00:00.000Z"/i);
  });
  it('a chain keeps every earlier result, newest first', () => {
    const html = render(done([result('n2', { verdict: 'partly_true' }), result('n1')]));
    const list = html.match(/<ol[^>]*id="fc-earlier-c1"[^>]*>[\s\S]*?<\/ol>/)[0];
    const order = [...list.matchAll(/fc-badge--(\w+)/g)].map((m) => m[1]);
    expect(order).toEqual(['contradicted', 'supported']);
    expect(html).toMatch(/fc-badge--partly_true/);
    expect(text(html)).toContain('Earlier results (2)');
  });
  it('has no disclosure when there is no earlier result', () => {
    expect(render(withClaim(claim()))).not.toMatch(/fc-earlier/);
  });
  it('source links keep the safe attributes', () => {
    const html = render(done([result('n1')]));
    for (const a of html.match(/<a [^>]*>/g)) {
      expect(a).toMatch(/target="_blank"/);
      expect(a).toMatch(/rel="noopener noreferrer"/);
    }
  });
});

describe('failures on the card', () => {
  it('shows the failure and keeps the previous verdict', () => {
    const html = render(withClaim(claim(), { rechecks: { c1: { phase: 'idle', results: [], error: 'The new check failed. Nothing was charged.', notice: '' } } }));
    expect(text(html)).toContain('The new check failed. Nothing was charged.');
    expect(html).toMatch(/fc-badge--supported/);
    expect(html).toMatch(/data-fc="recheck"/);
  });
  it('escapes provider text in an earlier result', () => {
    const html = render(withClaim(claim({ reason: '<script>x</script>' }), { rechecks: { c1: { phase: 'idle', results: [result('n1')], error: null, notice: '' } } }));
    expect(html).not.toMatch(/<script>/);
  });
});

describe('accessibility', () => {
  it('the new verdict is announced through the one existing live region', () => {
    const html = render(withClaim(claim(), { announcement: 'Contradicted: X (checked again)' }));
    expect(liveNodes(html)).toHaveLength(2);
    expect(html).toMatch(/aria-live="polite"[^>]*>Contradicted: X \(checked again\)</);
  });
  it('dir="auto" stays on the card text', () => {
    expect(render(withClaim(claim()))).toMatch(/class="fc-claim" dir="auto"/);
  });
});

describe('review fixes', () => {
  const state = (over) => ({ phase: 'idle', results: [], error: null, notice: '', ...over });
  it('a locked card shows why and has no button', () => {
    const html = render(withClaim(claim(), { rechecks: { c1: state({ locked: true, error: 'Checking again is unavailable for now after repeated failures.' }) } }));
    expect(text(html)).toContain('Checking again is unavailable for now after repeated failures.');
    expect(html).not.toMatch(/data-fc="recheck"/);
  });
  it('other cards keep their button when one is locked', () => {
    const v = view({ claims: [claim(), claim({ id: 'c2', claim_en: 'Other' })] }, { rechecks: { c1: state({ locked: true }) } });
    expect(render(v).match(/data-fc="recheck"/g)).toHaveLength(1);
  });
  it('panel-level notices show even when the session is idle, with a Close that clears them', () => {
    const html = render(view({ status: 'idle' }, { recheckNotices: ['A re-check finished after you left: Contradicted. Charged 100 credits.'] }));
    expect(text(html)).toContain('A re-check finished after you left: Contradicted. Charged 100 credits.');
    expect(html).toMatch(/data-fc="notices-dismiss"/);
    expect(html).toMatch(/aria-label="Fact-check"/);
  });
  it('notices also show above a running session', () => {
    const html = render(view({ status: 'running' }, { recheckNotices: ['Checking again is switched off.'] }));
    expect(text(html)).toContain('Checking again is switched off.');
  });
  it('an idle panel with no notices renders nothing', () => {
    expect(render(view({ status: 'idle' }, { recheckNotices: [] }))).toBe('');
    expect(render(view({ status: 'idle' }))).toBe('');
  });
  it('a re-checked result and the earlier ones show the date as well as the time', () => {
    const html = render(withClaim(claim(), { rechecks: { c1: state({ results: [result('n1')] }) } }));
    const main = html.slice(html.indexOf('<li class="fc-card'), html.indexOf('fc-earlier-toggle'));
    expect(text(main)).toMatch(/Checked .*Nov/);
    const earlier = html.match(/<ol[^>]*id="fc-earlier-c1"[^>]*>[\s\S]*?<\/ol>/)[0];
    expect(text(earlier)).toMatch(/Checked .*Nov/);
  });
  it('an unchanged card still shows just the time', () => {
    expect(text(render(withClaim(claim())))).not.toMatch(/Checked .*Nov/);
  });
});
