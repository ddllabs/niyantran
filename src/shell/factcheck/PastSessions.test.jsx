// F360 T3: the "Past sessions" section as a function of the hook's state (no network, no browser).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, accessToken: async () => null, functionsUrl: () => '' }));
const { PastSessions, PastSessionsView } = await import('./PastSessions.jsx');
const { PAST_TEXT } = await import('./factCheckText.js');

const session = (n, over = {}) => ({
  id: `s${n}`, video_id: 'v', channel_id: 'dd-news', video_kind: 'live', started_at: '2026-11-18T10:00:00Z',
  minutes_used: 5, credits_charged: 2500, status: 'settled', ...over,
});
const claim = (id, over = {}) => ({
  id, session_id: 's1', spoken_at: '2026-11-18T10:00:00Z', checked_at: '2026-11-18T10:01:00Z', position_s: 120, quote: 'q',
  claim_en: `Claim ${id}`, claimant: null, reported_by: null, kind: 'claim', status: 'checked', verdict: 'supported',
  reason: `Reason ${id}`, sources: [{ url: 'https://a.test/x', title: 'Source' }], supersedes: null, hidden_at: null, ...over,
});
const noop = () => {};
const past = (over = {}) => ({
  phase: 'ready', rows: [session(1)], hasMore: false, moreBusy: false, moreFailed: false, openId: null, details: {}, removal: null, notice: '',
  retry: noop, showMore: noop, toggle: noop, retryDetail: noop, askDelete: noop, cancelDelete: noop, confirmDelete: noop, ...over,
});
const channels = [{ id: 'dd-news', name: 'DD News' }];
const view = (over = {}, extra = {}) => renderToStaticMarkup(<PastSessionsView past={past(over)} channels={channels} {...extra} />);
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('the gate (D3)', () => {
  it('renders nothing when the fact-check flag is off', () => {
    expect(renderToStaticMarkup(<PastSessions enabled={false} sessionStatus="idle" channels={channels} />)).toBe('');
  });
  it('renders the section when the flag is on', () => {
    const html = renderToStaticMarkup(<PastSessions enabled sessionStatus="idle" channels={channels} />);
    expect(html).toContain(PAST_TEXT.heading);
  });
});

describe('structure and accessibility', () => {
  it('is a labelled section with a heading, the one-time transcript note and a polite status region', () => {
    const html = view();
    expect(html).toMatch(/<section[^>]*class="pst"[^>]*aria-labelledby="pst-heading"/);
    expect(html).toMatch(/<h3[^>]*id="pst-heading"[^>]*tabindex="-1"[^>]*>Past sessions<\/h3>/);
    expect(text(html)).toContain('no transcript is stored');
    expect(html.match(/no transcript is stored/g)).toHaveLength(1);
    expect(html).toMatch(/role="status"[^>]*aria-live="polite"|aria-live="polite"[^>]*role="status"/);
  });
  it('rows are buttons with aria-expanded that control their detail', () => {
    const html = view();
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls="pst-detail-s1"|<button[^>]*aria-controls="pst-detail-s1"[^>]*aria-expanded="false"/);
    const open = view({ openId: 's1', details: { s1: { phase: 'ready', claims: [], capped: false } } });
    expect(open).toMatch(/aria-expanded="true"/);
    expect(open).toContain('id="pst-detail-s1"');
  });
});

describe('rows (D4)', () => {
  it('show the start time, channel name, kind, minutes and credits', () => {
    const t = text(view());
    expect(t).toContain('DD News');
    expect(t).toContain('Live');
    expect(t).toContain('5 minutes');
    expect(t).toContain('2,500 credits');
    expect(view()).toMatch(/<time[^>]*datetime="2026-11-18T10:00:00Z"/i);
  });
  it('fall back to the channel id when the page does not know the channel', () => {
    expect(text(view({}, { channels: [] }))).toContain('dd-news');
  });
  it('say Recorded for a recorded session', () => {
    expect(text(view({ rows: [session(2, { video_kind: 'recorded' })] }))).toContain('Recorded');
  });
  it('show Show more only when there is more, and a quiet note when it failed', () => {
    expect(view()).not.toContain('Show more');
    expect(view({ hasMore: true })).toContain('Show more');
    expect(text(view({ hasMore: true, moreFailed: true }))).toContain(PAST_TEXT.moreError);
  });
});

describe('states (D8)', () => {
  it('loading', () => expect(text(view({ phase: 'loading', rows: [] }))).toContain(PAST_TEXT.loading));
  it('empty', () => expect(text(view({ rows: [] }))).toContain('No past sessions yet.'));
  it('load error offers Try again and shows only the fixed sentence', () => {
    const html = view({ phase: 'error', rows: [] });
    expect(text(html)).toContain(PAST_TEXT.loadError);
    expect(html).toContain('Try again');
  });
  it('the detail has loading, error and empty states', () => {
    const d = (state) => text(view({ openId: 's1', details: { s1: state } }));
    expect(d({ phase: 'loading', claims: [], capped: false })).toContain(PAST_TEXT.detailLoading);
    expect(d({ phase: 'error', claims: [], capped: false })).toContain(PAST_TEXT.detailError);
    expect(d({ phase: 'ready', claims: [], capped: false })).toContain(PAST_TEXT.detailEmpty);
  });
  it('says so when the cap cut the verdicts', () => {
    expect(text(view({ openId: 's1', details: { s1: { phase: 'ready', claims: [claim('a')], capped: true } } }))).toContain('first 500 results');
  });
  it('announces a deleted session in the status region', () => {
    const html = view({ notice: 'deleted' });
    expect(html.slice(html.indexOf('role="status"'))).toContain('Session deleted.');
  });
});

describe('the detail (D5)', () => {
  const open = (claims) => view({ openId: 's1', details: { s1: { phase: 'ready', claims, capped: false } } });
  it('draws the claims in the order given, with verdict, claim, reason and sources', () => {
    const html = open([claim('a'), claim('b', { verdict: 'contradicted' })]);
    expect(html.indexOf('Claim a')).toBeLessThan(html.indexOf('Claim b'));
    expect(html).toContain('Supported');
    expect(html).toContain('Contradicted');
    expect(html).toContain('Reason a');
    expect(html).toContain('href="https://a.test/x"');
  });
  it('is read-only: no Check again, share or report control', () => {
    const html = open([claim('a')]);
    expect(html).not.toMatch(/Check again|data-fc="recheck"|data-fc="report|Report|Share|share/);
  });
});

describe('delete (D7): only inside an opened session', () => {
  const READY = { phase: 'ready', claims: [claim('a')], capped: false };
  const opened = (over = {}, state = READY) => view({ openId: 's1', details: { s1: state }, ...over });
  const count = (html, key) => (html.match(new RegExp(`data-pst="${key}"`, 'g')) || []).length;

  it('a collapsed live row has no Delete button, however many rows there are', () => {
    const html = view({ rows: [session(1), session(2), session(3)] });
    expect(count(html, 'delete')).toBe(0);
  });
  it('the opened row has exactly one, below its results, and not inside the row button', () => {
    const html = opened({ rows: [session(1), session(2)] });
    expect(count(html, 'delete')).toBe(1);
    expect(html.indexOf('data-pst="delete"')).toBeGreaterThan(html.indexOf('Claim a'));
    const row = html.slice(html.indexOf('data-pst="row"'), html.indexOf('</button>', html.indexOf('data-pst="row"')));
    expect(row).not.toContain('data-pst="delete"');
  });
  it('is available whatever the detail state is: loading, error, empty, loaded', () => {
    for (const state of [{ phase: 'loading', claims: [], capped: false }, { phase: 'error', claims: [], capped: false }, { phase: 'ready', claims: [], capped: false }, READY]) {
      expect(count(opened({}, state), 'delete')).toBe(1);
    }
  });
  it('a recorded session has no Delete; the kept-results note shows only when it is opened', () => {
    const rows = [session(2, { video_kind: 'recorded' })];
    const closed = view({ rows });
    expect(text(closed)).not.toContain('Results on recorded videos are kept.');
    const open = view({ rows, openId: 's2', details: { s2: READY } });
    expect(count(open, 'delete')).toBe(0);
    expect(text(open)).toContain('Results on recorded videos are kept.');
  });
  it('the first step shows only the Delete button; the second asks, with Delete and Keep', () => {
    expect(text(opened())).not.toContain('This cannot be undone');
    const html = opened({ removal: { id: 's1', phase: 'confirm' } });
    expect(text(html)).toContain('Delete this session and its verdicts? This cannot be undone.');
    expect(html).toMatch(/data-pst="confirm"/);
    expect(html).toMatch(/data-pst="keep"/);
    expect(html).not.toMatch(/data-pst="delete"/);
  });
  it('shows progress while deleting and a plain alert when it failed', () => {
    expect(text(opened({ removal: { id: 's1', phase: 'busy' } }))).toContain(PAST_TEXT.deleting);
    const failed = opened({ removal: { id: 's1', phase: 'error' } });
    expect(text(failed)).toContain(PAST_TEXT.deleteError);
    expect(failed).toMatch(/role="alert"/);
  });
});

describe('fix round (M4, M5, claim states)', () => {
  it('M5: error paragraphs are alerts', () => {
    expect(view({ phase: 'error', rows: [] })).toMatch(/<p[^>]*role="alert"[^>]*class="pst-error"|<p[^>]*class="pst-error"[^>]*role="alert"/);
    expect(view({ openId: 's1', details: { s1: { phase: 'ready', claims: [], capped: false } }, removal: { id: 's1', phase: 'error' } })).toMatch(/role="alert"/);
  });

  it('M4: the body is keyed on the signed-in user id the page already holds', () => {
    expect(PastSessions({ enabled: true, userId: 'u1', sessionStatus: 'idle', channels }).key).toBe('u1');
    expect(PastSessions({ enabled: true, userId: 'u2', sessionStatus: 'idle', channels }).key).toBe('u2');
  });

  it('draws pending, failed and needs-context results through the reused card, with no controls', () => {
    const html = view({
      openId: 's1',
      details: { s1: { phase: 'ready', capped: false, claims: [
        claim('p', { status: 'pending', verdict: null, reason: null, sources: [] }),
        claim('e', { status: 'error', verdict: null, reason: null, sources: [] }),
        claim('n', { status: 'needs_context', verdict: null, reason: null, sources: [] }),
      ] } },
    });
    expect(html).toContain('Checking…');
    expect(html).toContain('Check failed');
    expect(html).toContain('Needs context, not checked');
    expect(html).not.toMatch(/Check again|data-fc=|<input|Report|Share/);
  });

  it('A1: a claim the session ended before checking shows Not checked and the reason line, never Checking', () => {
    const html = view({
      openId: 's1',
      details: { s1: { phase: 'ready', capped: false, claims: [
        claim('u', { status: 'unchecked', ended_unchecked: true, verdict: null, reason: null, sources: [] }),
      ] } },
    });
    const t = text(html);
    expect(t).toContain('Not checked');
    expect(t).toContain(PAST_TEXT.endedUnchecked);
    expect(t).not.toContain('Checking…');
  });
});

import { liveNodes } from './liveNodes.js';
describe('live regions of the past-sessions view (review 2)', () => {
  const lots = (n) => Array.from({ length: n }, (_, i) => claim(`c${i}`, { verdict: i % 2 ? 'contradicted' : 'supported' }));
  const open = (n, rows = 1) => view({
    rows: Array.from({ length: rows }, (_, i) => session(i + 1)), openId: 's1',
    details: { s1: { phase: 'ready', capped: false, claims: lots(n) } },
  });
  it('is the deletion status line and ONE shared node for Copy and Export, however many cards and rows', () => {
    const small = open(1);
    const big = open(40, 15);
    expect(big.match(/data-pst="copy-claim"/g)).toHaveLength(40);
    expect(liveNodes(small)).toHaveLength(2);
    expect(liveNodes(big)).toHaveLength(2);
    expect(liveNodes(big).filter((n) => /class="fc-sr"/.test(n))).toHaveLength(1);
  });
  it('the shared node is empty until something is copied', () => {
    expect(open(2)).toContain('<p class="fc-sr" role="status"></p>');
  });
});

const { pastExport } = await import('./PastSessions.jsx');
const { CLAIM_CAP } = await import('./pastSessions.js');
describe('the past-session export file (review 9 and 8)', () => {
  const sess = session(1, { started_at: '2026-11-18T19:00:00Z', minutes_used: 5 });
  const state = (over = {}) => ({ phase: 'ready', capped: false, claims: [claim('a'), claim('b', { verdict: 'contradicted' })], ...over });
  it('says when the list was cut at the cap, with the same sentence the view shows', () => {
    const { text: t } = pastExport({ session: sess, source: 'DD News', state: state({ capped: true }), timeZone: 'UTC' });
    expect(t).toContain(PAST_TEXT.capped(CLAIM_CAP));
    expect(t.split('\n').findIndex((l) => l === PAST_TEXT.capped(CLAIM_CAP))).toBeLessThan(t.split('\n').findIndex((l) => l.startsWith('1. ')));
  });
  it('says nothing about a cap when the list is whole', () => {
    expect(pastExport({ session: sess, source: 'DD News', state: state(), timeZone: 'UTC' }).text).not.toContain('Showing the first');
  });
  it('names the session day in the zone of the reader and the channel, and the file likewise', () => {
    const out = pastExport({ session: sess, source: 'DD News', state: state(), timeZone: 'Asia/Kolkata' });
    expect(out.text).toContain('Date: 2026-11-19');
    expect(out.name).toBe('fact-check-DD-News-2026-11-19.txt');
    expect(out.text).toContain('Minutes used: 5');
  });
});
