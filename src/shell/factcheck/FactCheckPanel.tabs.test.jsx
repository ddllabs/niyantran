// F366 slice B: the panel header, the block line, the Claims and Transcript tabs, the verdict tiles and the
// restyled cards, from fake views (static markup; the clicks are in FactCheckPanel.tabs.interaction.test.jsx).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, accessToken: async () => null, functionsUrl: () => '' }));
import { FactCheckPanel, Claims } from './FactCheckPanel.jsx';

const sessionBase = {
  status: 'idle', sessionId: null, minutesBought: 0, creditsPerMinute: null, creditsHeld: null, secondsLeft: 0,
  transcript: [], claims: [], silentFor: 0, skippedPieces: 0, droppedTurns: 0, budgetReached: false, final: null, endReason: null, error: null,
};
const view = (session = {}, extra = {}) => ({
  flag: { available: true, creditsPerMinute: 500, recheckCredits: null, userId: 'u1' }, supported: true, ready: true,
  session: { ...sessionBase, ...session }, announcement: '', balance: 10000, rechecks: {}, ...extra,
});
const claim = (id, verdict, over = {}) => ({
  id, quote: 'q', claim_en: `Claim ${id}`, claimant: null, reported_by: null, kind: 'claim', status: 'checked', verdict,
  reason: `Reason ${id}`, sources: [{ url: 'https://example.org/a', title: 'Source A' }], checked_at: '2026-11-15T10:20:00.000Z', ...over,
});
const render = (v, props = {}) => renderToStaticMarkup(
  <FactCheckPanel view={v} persistent channelName="Aaj Tak" playable isMuted={false} onUnmute={() => {}} onConfirm={() => {}}
    onCancel={() => {}} onStop={() => {}} onRetry={() => {}} onDismiss={() => {}} onChoose={() => {}} {...props} />,
);
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
const running = (over = {}, extra = {}) => view({
  status: 'running', minutesBought: 5, secondsLeft: 200, creditsHeld: 2500, creditsPerMinute: 500,
  transcript: [{ seq: 0, text: 'Good evening', startMs: 0 }],
  claims: [claim('1', 'supported'), claim('2', 'contradicted'), claim('3', 'supported'), { id: '4', claim_en: 'Claim 4', status: 'pending', quote: 'q', kind: 'claim' }],
  ...over,
}, extra);

describe('header, status line and Stop', () => {
  it('has the title, a status line with a dot, and exactly one Stop while running', () => {
    const html = render(running());
    expect(html).toMatch(/<h3[^>]*id="fc-title"[^>]*>Fact-check<\/h3>/);
    expect(html).toMatch(/class="fc-status fc-status--on"/);
    expect(html).toMatch(/class="fc-dot"/);
    expect(text(html)).toContain('Checking · 1:40 elapsed');
    expect(html.match(/data-fc="stop"/g)).toHaveLength(1);
    expect(html).not.toMatch(/Pause/);
  });
  it('says Off in the idle panel and has no Stop', () => {
    const html = render(view());
    expect(html).toMatch(/class="fc-status fc-status--off"/);
    expect(text(html)).toContain('Off');
    expect(html).not.toMatch(/data-fc="stop"/);
  });
  it('says what the start screen is waiting for', () => {
    expect(text(render(view({ status: 'choosing' })))).toContain('Choose a length');
    expect(text(render(view({ status: 'sharing' })))).toContain('Waiting for sharing');
  });
  it('keeps the clock text beside Stop', () => {
    expect(text(render(running()))).toContain('3:20 left');
  });
});

describe('block line', () => {
  it('has a thin bar and the time used of the minutes bought, with the credits held', () => {
    const html = render(running());
    expect(html).toMatch(/role="progressbar"[^>]*aria-valuenow="33"/);
    expect(text(html)).toContain('1:40 of 5 minutes used · 2,500 credits held');
  });
  it('says one minute left when a minute or less remains', () => {
    const t = text(render(running({ secondsLeft: 45 })));
    expect(t).toContain('1 minute left in this block');
    expect(t).not.toContain('of 5 minutes used');
  });
  it('is absent where there is no block', () => {
    expect(render(view())).not.toMatch(/progressbar/);
    expect(render(view({ status: 'choosing' }))).not.toMatch(/progressbar/);
  });
});

describe('tabs', () => {
  it('Claims · N and Transcript while running, Claims selected, one tab stop', () => {
    const html = render(running());
    const tabs = html.match(/<button[^>]*role="tab"[^>]*>[^<]*/g);
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toContain('Claims · 4');
    expect(tabs[0]).toMatch(/aria-selected="true"/);
    expect(tabs[0]).toMatch(/tabindex="0"/);
    expect(tabs[1]).toContain('Transcript');
    expect(tabs[1]).toMatch(/aria-selected="false"/);
    expect(tabs[1]).toMatch(/tabindex="-1"/);
    expect(html).toMatch(/role="tablist"[^>]*aria-label="Fact-check results"/);
  });
  it('keeps both panels in the page, the unselected one hidden, so the transcript keeps its place', () => {
    const html = render(running());
    expect(html).toMatch(/<div[^>]*id="fc-panel-claims"[^>]*role="tabpanel"[^>]*aria-labelledby="fc-tab-claims"(?![^>]*hidden)[^>]*>/);
    expect(html).toMatch(/<div[^>]*id="fc-panel-transcript"[^>]*role="tabpanel"[^>]*aria-labelledby="fc-tab-transcript"[^>]*hidden/);
    expect(html.indexOf('Good evening')).toBeGreaterThan(html.indexOf('id="fc-panel-transcript"'));
    expect(html.indexOf('Claim 1')).toBeGreaterThan(html.indexOf('id="fc-panel-claims"'));
    expect(html.indexOf('Claim 1')).toBeLessThan(html.indexOf('id="fc-panel-transcript"'));
  });
  it('also on an ended session', () => {
    const html = render(view({ status: 'ended', endReason: 'time', claims: [claim('1', 'opinion')], final: { minutes_used: 1, credits_charged: 500, balance: 4500 } }));
    expect(html).toMatch(/role="tablist"/);
    expect(text(html)).toContain('Claims · 1');
  });
  it('not in the idle, start, waiting or unavailable states', () => {
    for (const status of ['idle', 'choosing', 'sharing', 'starting']) expect(render(view({ status }))).not.toMatch(/role="tablist"/);
    expect(render(view({ status: 'error', error: { reason: 'capture_failed' } }))).not.toMatch(/role="tablist"/);
  });
  it('the transcript panel carries the transcript and the claims panel does not', () => {
    const html = render(running());
    const claims = html.slice(html.indexOf('id="fc-panel-claims"'), html.indexOf('id="fc-panel-transcript"'));
    expect(claims).not.toContain('Good evening');
    expect(claims).not.toMatch(/fc-transcript/);
  });
});

describe('verdict tiles', () => {
  it('are five toggle buttons in order, each with its glyph, label and count', () => {
    const html = render(running());
    const tiles = html.match(/<button[^>]*class="fc-tile[^"]*"[^>]*>[\s\S]*?<\/button>/g);
    expect(tiles).toHaveLength(5);
    const names = tiles.map((t) => text(t).trim());
    expect(names).toEqual(['✓ Supported 2', '✕ Contradicted 1', '◐ Partly true 0', '? No evidence found 0', '“ Opinion 0']);
    for (const t of tiles) expect(t).toMatch(/aria-pressed="false"/);
    expect(tiles[0]).toMatch(/data-verdict="supported"/);
  });
  it('shows Clear only while a filter is on', () => {
    expect(render(running())).not.toMatch(/data-fc="filter-clear"/);
    const html = renderToStaticMarkup(<Claims claims={[claim('1', 'supported')]} emptyText="none" recheck={{ price: null, states: {} }} filters={['supported']} onToggle={() => {}} onClear={() => {}} />);
    expect(html).toMatch(/data-fc="filter-clear"/);
    expect(html).toMatch(/data-verdict="supported"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-verdict="supported"/);
  });
});

describe('Claims with a filter', () => {
  const props = { emptyText: 'No claims yet.', recheck: { price: null, states: {} }, onToggle: () => {}, onClear: () => {} };
  const list = [claim('1', 'supported'), claim('2', 'contradicted'), { id: '3', claim_en: 'Claim 3', status: 'pending', quote: 'q', kind: 'claim' }];
  it('lists newest first, everything when no filter is on', () => {
    const html = renderToStaticMarkup(<Claims claims={list} filters={[]} {...props} />);
    expect(html.indexOf('Claim 3')).toBeLessThan(html.indexOf('Claim 2'));
    expect(html.indexOf('Claim 2')).toBeLessThan(html.indexOf('Claim 1'));
  });
  it('shows only the chosen verdicts, hiding claims that have none', () => {
    const html = renderToStaticMarkup(<Claims claims={list} filters={['supported']} {...props} />);
    expect(html).toContain('Claim 1');
    expect(html).not.toContain('Claim 2');
    expect(html).not.toContain('Claim 3');
  });
  it('says so in words when the filter empties the list', () => {
    const html = renderToStaticMarkup(<Claims claims={list} filters={['opinion']} {...props} />);
    expect(text(html)).toContain('No claims match these filters yet.');
    expect(html).not.toMatch(/<ol[^>]*fc-claims/);
  });
  it('the empty text is unchanged when there are no claims at all', () => {
    expect(text(renderToStaticMarkup(<Claims claims={[]} filters={[]} {...props} />))).toContain('No claims yet.');
  });
  it('counts and filters by the newest result of a re-checked claim', () => {
    const rc = { price: 5, states: { 1: { phase: 'idle', results: [claim('1b', 'opinion')] } } };
    const html = renderToStaticMarkup(<Claims claims={list} filters={['opinion']} {...props} recheck={rc} />);
    expect(html).toContain('Claim 1');
    expect(html).not.toContain('Claim 2');
  });
});

describe('claim card', () => {
  it('has a badge row, the claim, the reason and the sources as pills, and an anchor for See why', () => {
    const html = render(running());
    expect(html).toMatch(/<li[^>]*id="fc-claim-1"[^>]*tabindex="-1"/);
    expect(html).toMatch(/class="fc-card-head"/);
    expect(html).toMatch(/<ul[^>]*class="fc-sources fc-sources--pills"[^>]*aria-label="Sources"/);
  });
  it('has no time button, because no seek is wired for a live claim', () => {
    expect(render(running())).not.toMatch(/fc-seek|fc-card-time/);
  });
  it('keeps Check again and the earlier results when a price is set', () => {
    const v = running({}, { flag: { available: true, creditsPerMinute: 500, recheckCredits: 40, userId: 'u1' } });
    expect(render(v)).toMatch(/data-fc="recheck"/);
  });
});

describe('where the other things stay', () => {
  it('notices, the ended summary and the automated-verdicts line stay in the panel', () => {
    const html = render(view({ status: 'ended', endReason: 'time', budgetReached: true, skippedPieces: 2, final: { minutes_used: 1, credits_charged: 500, balance: 4500 } }));
    const t = text(html);
    expect(t).toContain('The checking limit for this session was reached');
    expect(t).toContain('the transcript has gaps');
    expect(t).toContain('Charged');
    expect(t).toContain('Verdicts are automated, may be wrong');
    expect(html).toMatch(/data-fc="dismiss"/);
  });
  it('the shared parts, with their transcript stretches and Re-analyze, are in the Transcript panel', () => {
    const shared = {
      phase: 'ready', error: null, unlockCreditsPerMinute: 100, unlocks: {}, reports: {}, covering: null,
      stretches: [{ stretch_id: 's1', from_s: 130, to_s: 460, minutes: 6, checked_on: '2026-11-16', claims_count: 1, access: 'own', price: 600, lines: [{ pos_start_s: 130, text: 'first words heard' }], claims: [claim('k1', 'supported')] }],
    };
    const v = view({ status: 'ended', endReason: 'time', final: { minutes_used: 1, credits_charged: 500, balance: 4500 } },
      { flag: { available: true, creditsPerMinute: 500, recheckCredits: null, sharing: { unlockCreditsPerMinute: 100 }, userId: 'u1' }, shared, shareActions: { reanalyze() {}, unlockAsk() {} } });
    const html = render(v);
    const transcriptPanel = html.slice(html.indexOf('id="fc-panel-transcript"'));
    expect(transcriptPanel).toContain('Checked parts of this video');
    expect(transcriptPanel).toContain('Re-analyze this block');
    expect(html.slice(0, html.indexOf('id="fc-panel-transcript"'))).not.toContain('Checked parts of this video');
  });
});
