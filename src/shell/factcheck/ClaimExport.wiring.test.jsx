// B1: where Copy and Export appear.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, accessToken: async () => null, functionsUrl: () => '' }));
import { FactCheckPanel } from './FactCheckPanel.jsx';
import { PastSessionsView } from './PastSessions.jsx';

const noop = () => {};
const claim = (id, over = {}) => ({ id, claim_en: `Claim ${id}`, kind: 'claim', status: 'checked', verdict: 'supported', reason: 'r', sources: [], checked_at: null, ...over });
const base = {
  status: 'ended', endReason: 'time', sessionId: 's', minutesBought: 1, creditsPerMinute: 500, creditsHeld: 500, secondsLeft: 0, transcript: [],
  claims: [claim('1'), claim('2', { status: 'pending', verdict: null }), claim('3', { status: 'not_checkable', verdict: null })],
  silentFor: 0, skippedPieces: 0, droppedTurns: 0, budgetReached: false, final: null, error: null,
};
const view = (session = {}, flagExtra = {}) => ({
  flag: { available: true, creditsPerMinute: 500, recheckCredits: null, userId: 'u', ...flagExtra }, supported: true, ready: true,
  session: { ...base, ...session }, announcement: '', balance: 1000, rechecks: {},
});
const render = (v) => renderToStaticMarkup(<FactCheckPanel view={v} isMuted={false} onUnmute={noop} onConfirm={noop} onCancel={noop} onStop={noop} onRetry={noop} onDismiss={noop} />);

describe('Copy on the claim card', () => {
  it('only a card with a verdict has it', () => {
    const html = render(view());
    expect(html.match(/data-fc="copy-claim"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Copy this claim: Claim 1"');
  });
  it('the card keeps its own controls: a priced, checked card still has Check again', () => {
    const html = render(view({}, { recheckCredits: 100 }));
    expect(html).toContain('data-fc="recheck"');
    expect(html).toContain('data-fc="copy-claim"');
  });
});

describe('Export in the ended panel', () => {
  it('is there once the session ended with claims', () => {
    expect(render(view()).match(/data-fc="export"/g)).toHaveLength(1);
  });
  it('Download PDF sits beside it, once', () => {
    const html = render(view());
    expect(html.match(/data-fc="pdf"/g)).toHaveLength(1);
    expect(html).toContain('Download PDF');
  });
  it('and is absent while running or with no claims', () => {
    expect(render(view({ status: 'running' }))).not.toContain('data-fc="pdf"');
    expect(render(view({ claims: [] }))).not.toContain('data-fc="pdf"');
  });
  it('is not there while running, or with no claims', () => {
    expect(render(view({ status: 'running' }))).not.toContain('data-fc="export"');
    expect(render(view({ claims: [] }))).not.toContain('data-fc="export"');
  });
});

describe('Export in an opened past session', () => {
  const past = (claims) => ({
    phase: 'ready', rows: [{ id: 's1', channel_id: 'dd-news', video_kind: 'live', started_at: '2026-11-18T10:00:00Z', minutes_used: 5, credits_charged: 2500, status: 'settled' }],
    hasMore: false, moreBusy: false, moreFailed: false, openId: 's1', removal: null, notice: '', retry: noop, showMore: noop, toggle: noop, retryDetail: noop, askDelete: noop, cancelDelete: noop, confirmDelete: noop,
    details: { s1: { phase: 'ready', capped: false, claims } },
  });
  const html = (claims) => renderToStaticMarkup(<PastSessionsView past={past(claims)} channels={[{ id: 'dd-news', name: 'DD News' }]} />);
  it('has Export and a Copy on each verdict card, using data-pst and no data-fc', () => {
    const out = html([claim('1'), claim('2', { verdict: 'contradicted' })]);
    expect(out.match(/data-pst="export"/g)).toHaveLength(1);
    expect(out.match(/data-pst="copy-claim"/g)).toHaveLength(2);
    expect(out).not.toContain('data-fc=');
  });
  it('has Download PDF beside Export, using data-pst', () => {
    const out = html([claim('1')]);
    expect(out.match(/data-pst="pdf"/g)).toHaveLength(1);
    expect(out).not.toContain('data-fc=');
  });
  it('has none when no verdicts were saved', () => {
    expect(html([])).not.toContain('pdf');
    expect(html([])).not.toContain('export');
  });
});
