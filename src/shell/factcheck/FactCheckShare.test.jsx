// F344 S3: "Checked parts of this video" in the panel, from a fake view. With sharing off, or on a
// live stream, the panel is byte for byte what it was (fixtures rendered before this change).
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, accessToken: async () => null, functionsUrl: () => '' }));
import { FactCheckPanel } from './FactCheckPanel.jsx';
import { PIN_VIEWS } from './pinViews.js';

const base = {
  status: 'choosing', sessionId: null, minutesBought: 0, creditsPerMinute: null, creditsHeld: null, secondsLeft: 0,
  transcript: [], claims: [], silentFor: 0, skippedPieces: 0, droppedTurns: 0, budgetReached: false, final: null, endReason: null, error: null,
};
const claim = (id, over = {}) => ({
  id, position_s: 140, quote: 'q', claim_en: `Claim ${id}`, claimant: null, reported_by: null, kind: 'claim', status: 'checked',
  verdict: 'supported', reason: `Reason ${id}`, sources: [{ url: 'https://a.test/x', title: 'Source' }],
  checked_at: '2026-11-16T10:00:00.000Z', reported: false, ...over,
});
const stretch = (id, over = {}) => ({
  stretch_id: id, from_s: 130, to_s: 460, minutes: 6, checked_on: '2026-11-16', claims_count: 2, access: 'locked', price: 600, ...over,
});
const lines = [{ pos_start_s: 130, text: 'first words heard' }, { pos_start_s: 3725, text: 'late words' }];
const shared = (stretches, extra = {}) => ({ phase: 'ready', error: null, unlockCreditsPerMinute: 100, stretches, unlocks: {}, reports: {}, covering: null, ...extra });
const view = (sessionOver = {}, sh = shared([stretch('s1')]), extra = {}) => ({
  flag: { available: true, creditsPerMinute: 500, recheckCredits: null, sharing: { unlockCreditsPerMinute: 100 }, userId: 'u' },
  supported: true, ready: true, session: { ...base, ...sessionOver }, announcement: '', balance: 1000, rechecks: {}, shared: sh, ...extra,
});
const noop = () => {};
const actions = { unlockAsk: noop, unlockCancel: noop, unlockConfirm: noop, reportAsk: noop, reportCancel: noop, reportSend: noop };
const render = (v) => renderToStaticMarkup(
  <FactCheckPanel view={{ shareActions: actions, ...v }} isMuted={false} onUnmute={noop} onConfirm={noop} onCancel={noop} onStop={noop} onRetry={noop} onDismiss={noop} />,
);
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('nothing changes without sharing', () => {
  const pinned = (name) => readFileSync(new URL(`./fixtures/panel-${name}.html`, import.meta.url), 'utf8').trimEnd();
  const populated = shared([stretch('s1', { access: 'own', lines, claims: [claim('k1')] })]);
  for (const name of ['choosing', 'running', 'ended']) {
    it(`${name}: no shared state at all`, () => {
      expect(render({ ...PIN_VIEWS()[name], shared: null })).toBe(pinned(name));
      expect(render(PIN_VIEWS()[name])).toBe(pinned(name));
    });
    it(`${name}: sharing off in the flag, stale parts present`, () => {
      const v = PIN_VIEWS()[name];
      expect(render({ ...v, flag: { ...v.flag, sharing: null }, shared: populated })).toBe(pinned(name));
    });
    it(`${name}: a live stream has no shared state`, () => {
      const v = PIN_VIEWS()[name];
      expect(render({ ...v, flag: { ...v.flag, sharing: { unlockCreditsPerMinute: 100 } }, shared: null })).toBe(pinned(name));
    });
  }
  it('the pinned fixtures carry no parts markup', () => {
    expect(pinned('choosing')).not.toMatch(/fc-part|Checked parts/);
  });
});

describe('where the section shows', () => {
  it('in the choose step, the ended summary and after an error; not while starting or running', () => {
    for (const status of ['choosing', 'ended', 'error']) expect(text(render(view({ status })))).toContain('Checked parts of this video');
    for (const status of ['sharing', 'starting', 'running', 'ending']) expect(text(render(view({ status })))).not.toContain('Checked parts of this video');
  });
  it('is a labelled section', () => {
    expect(render(view())).toMatch(/<section[^>]*class="fc-parts"[^>]*aria-labelledby="fc-parts-title"/);
  });
  it('says it is loading, failed, or empty, in words', () => {
    expect(text(render(view({}, shared([], { phase: 'loading' }))))).toContain('Loading checked parts…');
    expect(text(render(view({}, shared([], { phase: 'error', error: 'The checked parts could not be loaded. Try again later.' }))))).toContain('could not be loaded');
    expect(text(render(view({}, shared([]))))).toContain('No part of this video has been checked yet.');
  });
});

describe('a part', () => {
  it('shows the range, minutes, date checked and the number of claims', () => {
    const t = text(render(view({}, shared([stretch('s1', { from_s: 3500, to_s: 3700, minutes: 1, claims_count: 1 })]))));
    expect(t).toContain('58:20–1:01:40');
    expect(t).toContain('1 minute');
    expect(t).toMatch(/Checked .*Nov/);
    expect(t).toContain('1 claim');
  });
  it('own and unlocked parts have a disclosure to the transcript lines and verdict cards', () => {
    for (const access of ['own', 'unlocked']) {
      const html = render(view({}, shared([stretch('s1', { access, lines, claims: [claim('k1')] })])));
      expect(html).toMatch(/<button[^>]*class="fc-part-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="fc-part-s1"/);
      const body = html.match(/<div[^>]*id="fc-part-s1"[^>]*>[\s\S]*?<\/ol><\/div>/)[0];
      expect(body).toMatch(/\shidden/);
      expect(text(body)).toContain('first words heard');
      expect(text(body)).toContain('1:02:05');
      expect(text(body)).toContain('Claim k1');
      expect(body).toMatch(/dir="auto"/);
    }
    expect(text(render(view({}, shared([stretch('s1', { access: 'own', lines: [], claims: [] })]))))).toContain('Your check');
    expect(text(render(view({}, shared([stretch('s1', { access: 'unlocked', lines: [], claims: [] })]))))).toContain('Unlocked');
  });
  it('shared cards show the check date and the position', () => {
    const html = render(view({}, shared([stretch('s1', { access: 'unlocked', lines, claims: [claim('k1')] })])));
    expect(text(html)).toMatch(/Checked .*Nov/);
    expect(text(html)).toContain('At 02:20');
    expect(html).toMatch(/datetime="2026-11-16T10:00:00.000Z"/i);
  });
  it('a locked part has no text, only an Unlock button with its price', () => {
    const html = render(view({}, shared([stretch('s1', { access: 'locked', lines, claims: [claim('k1')] })])));
    expect(html).not.toMatch(/first words heard|Claim k1|fc-part-toggle/);
    expect(html).toMatch(/<button[^>]*id="fc-unlock-s1"[^>]*data-fc="unlock"[^>]*>Unlock · 600 credits</);
  });
  it('lists parts newest first, as given', () => {
    const html = render(view({}, shared([stretch('new', { from_s: 10 }), stretch('old', { from_s: 20 })])));
    expect(html.indexOf('data-part="new"')).toBeLessThan(html.indexOf('data-part="old"'));
  });
});

describe('unlocking', () => {
  const withUnlock = (u, balance = 1000) => view({}, shared([stretch('s1')], { unlocks: { s1: { phase: 'idle', error: null, notice: '', ...u } } }), { balance });
  it('asks for confirmation with the price and the balance', () => {
    const html = render(withUnlock({ phase: 'confirming' }));
    const t = text(html);
    expect(t).toContain('Unlock this part for 600 credits?');
    expect(t).toContain('Your balance is 1,000 credits.');
    expect(html).toMatch(/<div[^>]*class="fc-confirm"[^>]*role="group"[^>]*aria-label="Unlock this part"/);
    expect(html).toMatch(/data-fc="unlock-confirm"(?![^>]*disabled)/);
    expect(html).toMatch(/data-fc="unlock-cancel"/);
  });
  it('disables Confirm with the reason when the balance cannot cover it', () => {
    const html = render(withUnlock({ phase: 'confirming' }, 100));
    expect(html).toMatch(/data-fc="unlock-confirm"[^>]*disabled/);
    expect(text(html)).toContain('Needs 600 credits; you have 100 credits.');
  });
  it('an unreadable balance leaves the decision to the server', () => {
    const html = render(withUnlock({ phase: 'confirming' }, null));
    expect(text(html)).toContain('Your balance could not be read.');
    expect(html).not.toMatch(/data-fc="unlock-confirm"[^>]*disabled/);
  });
  it('shows progress and keeps the button focusable but inert', () => {
    const html = render(withUnlock({ phase: 'running' }));
    expect(text(html)).toContain('Unlocking…');
    expect(html).toMatch(/data-fc="unlock"[^>]*aria-disabled="true"/);
  });
  it('shows an error in words and the notice', () => {
    expect(text(render(withUnlock({ error: 'Not enough credits: this needs 600 credits and you have 100 credits.' })))).toContain('Not enough credits');
    expect(text(render(withUnlock({ phase: 'confirming', error: 'The price changed to 700 credits. Review it and unlock again.' })))).toContain('The price changed to 700 credits.');
  });
  it('every control is a real button with a name', () => {
    const html = render(withUnlock({ phase: 'confirming' }));
    for (const b of html.match(/<button[^>]*>[^<]*<\/button>/g)) {
      expect(b).toMatch(/type="button"/);
      expect(b.replace(/<[^>]*>/g, '').trim().length).toBeGreaterThan(0);
    }
  });
});

describe('reporting', () => {
  const part = (access, claims) => shared([stretch('s1', { access, lines: [], claims })]);
  it('each card of an unlocked part has "Report this verdict"; an own part has none', () => {
    expect(render(view({}, part('unlocked', [claim('k1')])))).toMatch(/<button[^>]*data-fc="report"[^>]*data-claim="k1"[^>]*>Report this verdict</);
    expect(render(view({}, part('own', [claim('k1')])))).not.toMatch(/data-fc="report"/);
  });
  it('a reported card says "Reported" and offers no button', () => {
    const html = render(view({}, part('unlocked', [claim('k1', { reported: true })])));
    expect(text(html)).toContain('Reported');
    expect(html).not.toMatch(/data-fc="report"/);
  });
  it('after sending, the card reads Reported', () => {
    const sh = { ...part('unlocked', [claim('k1')]), reports: { k1: { phase: 'done', error: null } } };
    const html = render(view({}, sh));
    expect(text(html)).toContain('Reported');
    expect(html).not.toMatch(/data-fc="report"/);
  });
  it('the form has an optional short reason, Send and Cancel', () => {
    const sh = { ...part('unlocked', [claim('k1')]), reports: { k1: { phase: 'asking', error: null } } };
    const html = render(view({}, sh));
    expect(html).toMatch(/<label[^>]*>Why\? \(optional\)<\/label>/);
    expect(html).toMatch(/<input[^>]*maxLength="300"|<input[^>]*maxlength="300"/);
    expect(html).toMatch(/data-fc="report-send"/);
    expect(html).toMatch(/data-fc="report-cancel"/);
  });
  it('shows a send error in words and keeps the form', () => {
    const sh = { ...part('unlocked', [claim('k1')]), reports: { k1: { phase: 'asking', error: 'You have sent many reports today. Try again tomorrow.' } } };
    const html = render(view({}, sh));
    expect(text(html)).toContain('You have sent many reports today. Try again tomorrow.');
    expect(html).toMatch(/data-fc="report-send"/);
  });
  it('shows progress while sending', () => {
    const sh = { ...part('unlocked', [claim('k1')]), reports: { k1: { phase: 'running', error: null } } };
    expect(text(render(view({}, sh)))).toContain('Sending…');
  });
});

describe('cards inside checked parts', () => {
  it('never offer "Check again", even for the user\'s own part with a re-check price', () => {
    const sh = shared([stretch('a', { access: 'own', lines: [], claims: [claim('k1')] }), stretch('b', { access: 'unlocked', lines: [], claims: [claim('k2')] })]);
    const v = view({}, sh);
    v.flag.recheckCredits = 100;
    expect(render(v)).not.toMatch(/data-fc="recheck"/);
  });
  it('the cards of the session on screen keep it', () => {
    const v = view({ status: 'ended', claims: [claim('s1')] }, shared([]));
    v.flag.recheckCredits = 100;
    expect(render(v).match(/data-fc="recheck"/g)).toHaveLength(1);
  });
});

describe('plain words about sharing', () => {
  it('the parts section says the text comes from another user’s run and can be reported', () => {
    expect(text(render(view()))).toContain('This text comes from another user’s run of this video. You can report a verdict that looks wrong.');
  });
  it('the choose step says the block will be visible to other users for a fee', () => {
    expect(text(render(view()))).toContain('The transcript and verdicts of this block will be visible to other users of this video, for a fee.');
  });
  it('neither sentence shows with sharing off', () => {
    const v = view();
    const off = text(render({ ...v, flag: { ...v.flag, sharing: null } }));
    expect(off).not.toMatch(/another user|other users/);
    const noShared = text(render({ ...v, shared: null }));
    expect(noShared).not.toMatch(/another user|other users/);
  });
  it('the dates read "Checked on"', () => {
    expect(text(render(view({}, shared([stretch('s1', { checked_on: '2026-11-16' })]))))).toMatch(/Checked on .*Nov.*2026/);
  });
});

describe('a view that failed', () => {
  it('shows the error in words with a Try again button', () => {
    const html = render(view({}, shared([], { phase: 'error', error: 'Too many lookups just now. Wait a minute and try again.' })));
    expect(text(html)).toContain('Too many lookups just now. Wait a minute and try again.');
    expect(html).toMatch(/<button[^>]*data-fc="parts-retry"[^>]*>Try again</);
  });
  it('no retry button when the list loaded', () => {
    expect(render(view())).not.toMatch(/parts-retry/);
  });
});

describe('a part already covers where you are', () => {
  const covered = (access = 'locked') => view({}, shared([stretch('s1', { access, from_s: 130, to_s: 460 })], { covering: 's1' }));
  it('offers that part first, with the choice to go on anyway, and holds back the block choices', () => {
    const html = render(covered());
    const t = text(html);
    expect(t).toContain('This part is already checked');
    expect(t).toContain('02:10–07:40');
    expect(t).toContain('It costs 600 credits to unlock.');
    expect(html).toMatch(/data-fc="part-show"/);
    expect(html).toMatch(/data-fc="part-anyway"/);
    expect(html).not.toMatch(/data-minutes=/);
    expect(html).not.toMatch(/data-fc="confirm"/);
  });
  it('an open part needs no price line', () => {
    const t = text(render(covered('own')));
    expect(t).toContain('This part is already checked');
    expect(t).not.toContain('to unlock');
  });
  it('without a covering part the choices show as usual', () => {
    const html = render(view({}, shared([stretch('s1')])));
    expect(html).toMatch(/data-minutes="5"/);
    expect(html).not.toMatch(/part-anyway/);
  });
  it('only in the choose step', () => {
    expect(render(view({ status: 'ended' }, shared([stretch('s1')], { covering: 's1' })))).not.toMatch(/part-anyway/);
  });
});

describe('layout hooks', () => {
  it('the disclosure and unlock controls use fc- classes only', () => {
    const html = render(view({}, shared([stretch('s1', { access: 'unlocked', lines, claims: [claim('k1')] }), stretch('s2')])));
    const classes = [...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(' '));
    for (const c of classes) expect(c).toMatch(/^(fc-|ltv-action-btn|primary)/);
  });
});
