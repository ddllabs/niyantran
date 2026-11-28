// F366 slice B: the panel header, the block line, the Claims and Transcript tabs, the verdict tiles and the
// restyled cards, from fake views (static markup; the clicks are in FactCheckPanel.tabs.interaction.test.jsx).
import { readFileSync } from 'node:fs';
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
    expect(html).toMatch(/class="fc-livedot fc-status--on"/);
    expect(html).toMatch(/class="fc-dot"/);
    expect(text(html)).not.toContain('elapsed'); // F416: no elapsed time while running
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
  it('has a thin bar and the time used of the minutes bought (as its value text), without repeating the credits held', () => {
    const html = render(running());
    expect(html).toMatch(/role="progressbar"[^>]*aria-valuenow="33"[^>]*aria-valuetext="1:40 of 5 minutes used"/);
    expect(text(html)).not.toContain('of 5 minutes used'); // F416: not shown as text while running
    expect(html.match(/2,500 credits held/g)).toHaveLength(1); // only the rate line
  });
  it('says one minute left when a minute or less remains', () => {
    const html = render(running({ secondsLeft: 45 }));
    expect(html).toMatch(/aria-valuetext="1 minute left in this block"/);
    expect(text(html)).not.toContain('left in this block'); // F416: the words are the bar's value text only
    expect(html).not.toMatch(/aria-valuetext="[^"]*of 5 minutes used/);
  });
  it('is absent where there is no block', () => {
    expect(render(view())).not.toMatch(/progressbar/);
    expect(render(view({ status: 'choosing' }))).not.toMatch(/progressbar/);
  });
});

describe('tabs', () => {
  it('Claims · N, Transcript and Summary while running, Claims selected, one tab stop', () => {
    const html = render(running());
    const tabs = html.match(/<button[^>]*role="tab"[^>]*>[^<]*/g);
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toContain('Claims · 4');
    expect(tabs[0]).toMatch(/aria-selected="true"/);
    expect(tabs[0]).toMatch(/tabindex="0"/);
    expect(tabs[1]).toContain('Transcript');
    expect(tabs[1]).toMatch(/aria-selected="false"/);
    expect(tabs[1]).toMatch(/tabindex="-1"/);
    expect(tabs[2]).toContain('Summary');
    expect(tabs[2]).toMatch(/aria-selected="false"/);
    expect(tabs[2]).toMatch(/tabindex="-1"/);
    expect(html.match(/tabindex="0"[^>]*class="fc-tab|role="tab"[^>]*tabindex="0"/g)).toHaveLength(1);
    expect(html).toMatch(/role="tablist"[^>]*aria-label="Fact-check results"/);
  });
  it('keeps both panels in the page, the unselected one hidden, so the transcript keeps its place', () => {
    const html = render(running());
    expect(html).toMatch(/<div[^>]*id="fc-panel-claims"[^>]*role="tabpanel"[^>]*aria-labelledby="fc-tab-claims"(?![^>]*hidden)[^>]*>/);
    expect(html).toMatch(/<div[^>]*id="fc-panel-transcript"[^>]*role="tabpanel"[^>]*aria-labelledby="fc-tab-transcript"[^>]*hidden/);
    expect(html.lastIndexOf('Good evening')).toBeGreaterThan(html.indexOf('id="fc-panel-transcript"')); // the strip above also holds the text
    expect(html.indexOf('Claim 1')).toBeGreaterThan(html.indexOf('id="fc-panel-claims"'));
    expect(html.indexOf('Claim 1')).toBeLessThan(html.indexOf('id="fc-panel-transcript"'));
  });
  it('the Summary panel is in the page, hidden, after the transcript panel, and holds no transcript', () => {
    const html = render(running());
    expect(html).toMatch(/<div[^>]*id="fc-panel-summary"[^>]*role="tabpanel"[^>]*aria-labelledby="fc-tab-summary"[^>]*hidden/);
    expect(html.indexOf('id="fc-panel-summary"')).toBeGreaterThan(html.indexOf('id="fc-panel-transcript"'));
    expect(html.slice(html.indexOf('id="fc-panel-summary"'))).not.toContain('Good evening');
    expect(html.slice(html.indexOf('id="fc-panel-summary"'))).toContain('4 claims in this session');
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

describe('one scroll area', () => {
  it('keeps the header block first, scrolls everything between in one body, and keeps the notice last', () => {
    const html = render(running());
    const head = html.indexOf('class="fc-head');
    const block = html.indexOf('class="fc-block');
    const body = html.indexOf('class="fc-body"');
    const tabs = html.indexOf('role="tablist"');
    const foot = html.indexOf('class="fc-foot"');
    const notice = html.indexOf('class="fc-disclaimer"');
    expect(head).toBeLessThan(block);
    expect(block).toBeLessThan(body);
    expect(body).toBeLessThan(html.indexOf('class="fc-rate"'));
    expect(tabs).toBeLessThan(body); // the tablist is pinned above the scroll area, not inside it
    expect(body).toBeLessThan(foot);
    expect(foot).toBeLessThan(notice);
    const bodyChunk = html.slice(body, foot);
    expect(bodyChunk.match(/<div/g).length - bodyChunk.match(/<\/div>/g).length).toBe(0); // the body closes before the foot opens
  });
  it('keeps the tablist outside .fc-body and before it, with the three tabpanels still inside', () => {
    const html = render(running());
    const body = html.indexOf('class="fc-body"');
    const foot = html.indexOf('class="fc-foot"');
    const tabs = html.indexOf('role="tablist"');
    expect(tabs).toBeGreaterThan(-1);
    expect(tabs).toBeLessThan(body);
    expect(html.slice(body, foot)).not.toContain('role="tablist"');
    for (const id of ['claims', 'transcript', 'summary']) {
      const panel = html.indexOf(`id="fc-panel-${id}"`);
      expect(panel, id).toBeGreaterThan(body);
      expect(panel, id).toBeLessThan(foot);
    }
  });
  it('puts the end-of-session buttons in the footer, not in the body', () => {
    const html = render(view({ status: 'ended', endReason: 'time', final: { minutes_used: 1, credits_charged: 500, balance: 4500 } }));
    expect(html.indexOf('data-fc="dismiss"')).toBeGreaterThan(html.indexOf('class="fc-foot"'));
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
  it('the shared parts, with Unlock and Re-analyze, are below the claims and not hidden by the default tab', () => {
    const shared = {
      phase: 'ready', error: null, unlockCreditsPerMinute: 100, unlocks: {}, reports: {}, covering: null,
      stretches: [{ stretch_id: 's1', from_s: 130, to_s: 460, minutes: 6, checked_on: '2026-11-16', claims_count: 1, access: 'own', price: 600, lines: [{ pos_start_s: 130, text: 'first words heard' }], claims: [claim('k1', 'supported')] }],
    };
    const v = view({ status: 'ended', endReason: 'time', final: { minutes_used: 1, credits_charged: 500, balance: 4500 } },
      { flag: { available: true, creditsPerMinute: 500, recheckCredits: null, sharing: { unlockCreditsPerMinute: 100 }, userId: 'u1' }, shared, shareActions: { reanalyze() {}, unlockAsk() {} } });
    const html = render(v);
    // The Transcript panel is the hidden one by default: the parts must come after it has closed.
    const open = html.lastIndexOf('<div', html.indexOf('id="fc-panel-transcript"'));
    const between = html.slice(open, html.indexOf('class="fc-parts"'));
    expect(between.match(/<div/g).length - between.match(/<\/div>/g).length).toBe(0);
    expect(html).toMatch(/id="fc-panel-transcript"[^>]*hidden/);
    expect(html.indexOf('class="fc-parts"')).toBeGreaterThan(html.indexOf('id="fc-panel-claims"'));
    const parts = html.slice(html.indexOf('class="fc-parts"'));
    expect(parts).toContain('Re-analyze this block');
    expect(parts).toMatch(/data-fc="reanalyze"/);
  });
  it('the shared parts of an error with nothing to show sit in the same place, outside the tabs', () => {
    const shared = { phase: 'ready', error: null, unlockCreditsPerMinute: 100, unlocks: {}, reports: {}, covering: null, stretches: [{ stretch_id: 's1', from_s: 130, to_s: 460, minutes: 6, checked_on: '2026-11-16', claims_count: 1, access: 'locked', price: 600 }] };
    const html = render(view({ status: 'error', error: { reason: 'capture_failed' } }, { flag: { available: true, creditsPerMinute: 500, recheckCredits: null, sharing: { unlockCreditsPerMinute: 100 }, userId: 'u1' }, shared, shareActions: { unlockAsk() {} } }));
    expect(html).not.toMatch(/role="tablist"/);
    expect(html).toContain('Checked parts of this video');
  });
});

describe('F416 the running top row', () => {
  const lines = [{ seq: 0, text: 'Good evening', startMs: 0 }, { seq: 1, text: 'and welcome', startMs: 2000 }];
  const row = (html) => html.slice(html.indexOf('class="fc-toprow"'), html.indexOf('class="fc-block'));
  it('is one row: the tabs, then the time left and Stop, then the link button, with the progress line right under it', () => {
    const html = render(running({ transcript: lines }));
    const r = row(html);
    const at = (needle) => r.indexOf(needle);
    expect(at('role="tablist"')).toBeGreaterThan(-1);
    expect(at('role="tablist"')).toBeLessThan(at('class="fc-clock"'));
    expect(at('class="fc-clock"')).toBeLessThan(at('data-fc="stop"'));
    expect(at('data-fc="stop"')).toBeLessThan(at('data-fc="link"'));
    expect(text(r)).toContain('Claims · 4');
    expect(text(r)).toContain('3:20 left');
    expect(r).toMatch(/<button[^>]*data-fc="link"[^>]*aria-label="Paste a video link"/);
    expect(html.indexOf('class="fc-block')).toBeGreaterThan(html.indexOf('data-fc="link"'));
    expect(html.indexOf('class="fc-block')).toBeLessThan(html.indexOf('class="fc-body"'));
  });
  it('has no elapsed time, no block text, no transcript strip and no separate visible title line', () => {
    const html = render(running({ transcript: lines }));
    const chrome = html.slice(0, html.indexOf('class="fc-body"'));
    expect(text(chrome)).not.toMatch(/elapsed|left in this block|of 5 minutes used|Full transcript/);
    expect(html).not.toMatch(/Latest transcript|fc-tstrip|fc-headtext/);
    expect(html).toMatch(/<h3[^>]*id="fc-title"[^>]*class="fc-title fc-sr"|<h3 id="fc-title" class="fc-title fc-sr" tabindex="-1">Fact-check<\/h3>/);
  });
  it('shows only the dot for the normal checking state; its words are visually hidden', () => {
    const html = render(running());
    const chrome = html.slice(0, html.indexOf('class="fc-body"'));
    expect(chrome).not.toMatch(/fc-status-line/);
    expect(chrome).toMatch(/<p class="fc-sr">Checking<\/p>/);
  });
  it('keeps the words of any other state visible (dot and words under the row)', () => {
    const html = render(running({ status: 'ending' }));
    const chrome = html.slice(0, html.indexOf('class="fc-body"'));
    expect(chrome).toMatch(/<p class="fc-status fc-status--wait fc-status-line"><span class="fc-dot" aria-hidden="true"><\/span>Finishing…<\/p>/);
    expect(chrome).not.toMatch(/<p class="fc-sr">Finishing/);
  });
  it('is what the other states do not get: the idle and ended panels keep the title, the status line and the block text', () => {
    const idle = render(view());
    expect(idle).not.toMatch(/fc-toprow|data-fc="link"/);
    expect(idle).toMatch(/class="fc-title"/);
    const ended = render(view({ status: 'ended', endReason: 'time', minutesBought: 5, final: { minutes_used: 2, credits_charged: 1000, balance: 4000 } }));
    expect(ended).not.toMatch(/fc-toprow|data-fc="link"/);
    expect(ended).toMatch(/class="fc-status fc-status--off"/);
    expect(text(ended)).toContain('2 of 5 minutes used');
  });
});

describe('F416 the paste-a-link slot while running', () => {
  const form = <form className="ltv-paste"><input aria-label="Video link" /></form>;
  const chromeOf = (html) => html.slice(0, html.indexOf('class="fc-body"'));
  it('renders nothing for the form while linkOpen is false, and the button says so', () => {
    const html = render(running(), { linkForm: form, linkOpen: false, onToggleLink: () => {} });
    expect(html).not.toMatch(/ltv-paste|class="fc-linkslot"/);
    expect(html).toMatch(/data-fc="link"[^>]*aria-expanded="false"[^>]*aria-controls="fc-linkslot"/);
  });
  it('renders the form under the top row and the progress line while linkOpen is true', () => {
    const html = render(running(), { linkForm: form, linkOpen: true, onToggleLink: () => {} });
    expect(html).toMatch(/data-fc="link"[^>]*aria-expanded="true"/);
    expect(html.match(/<form class="ltv-paste/g)).toHaveLength(1);
    expect(html.indexOf('id="fc-linkslot"')).toBeGreaterThan(html.indexOf('class="fc-block'));
    expect(html.indexOf('id="fc-linkslot"')).toBeLessThan(html.indexOf('class="fc-body"'));
    expect(chromeOf(html)).toContain('<form class="ltv-paste');
  });
  it('ignores linkOpen outside a session: the form stays at the top as before', () => {
    for (const linkOpen of [false, true]) {
      const html = render(view(), { linkForm: form, linkOpen, onToggleLink: () => {} });
      expect(html.match(/<form class="ltv-paste/g)).toHaveLength(1);
      expect(html.indexOf('class="fc-linkslot"')).toBeLessThan(html.indexOf('class="fc-head"'));
      expect(html).not.toMatch(/data-fc="link"/);
    }
  });
});

describe('F416 the claim card', () => {
  const priced = (extra = {}) => running({}, { flag: { available: true, creditsPerMinute: 500, recheckCredits: 40, userId: 'u1' }, ...extra });
  const card = (html, id = '1') => {
    const from = html.indexOf(`id="fc-claim-${id}"`);
    const next = html.indexOf('<li class="fc-card', from);
    return html.slice(from, next === -1 ? undefined : next);
  };
  it('puts Copy, Check again and the time checked in one row', () => {
    const c = card(render(priced()));
    const start = c.indexOf('class="fc-card-actions"');
    const at = (needle) => c.indexOf(needle, start);
    expect(c.match(/class="fc-card-actions"/g)).toHaveLength(1);
    expect(start).toBeGreaterThan(-1);
    expect(c.indexOf('class="fc-time"')).toBeGreaterThan(start); // the time is no longer a line of its own above the row
    expect(at('data-fc="copy-claim"')).toBeGreaterThan(-1);
    expect(at('data-fc="copy-claim"')).toBeLessThan(at('data-fc="recheck"'));
    expect(at('data-fc="recheck"')).toBeLessThan(at('class="fc-time"'));
    expect(c.match(/data-fc="recheck"/g)).toHaveLength(1);
  });
  it('has the sources behind a "N sources" button, closed until pressed, that controls the pills', () => {
    const c = card(render(running()));
    expect(c).toMatch(/<button[^>]*class="fc-sources-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="([^"]+)"[^>]*>1 source</);
    const id = c.match(/class="fc-sources-toggle"[^>]*aria-controls="([^"]+)"/)[1];
    expect(c).toMatch(new RegExp(`<ul[^>]*class="fc-sources fc-sources--pills"[^>]*id="${id.replace(/[:]/g, '\\$&')}"[^>]*hidden`));
  });
  it('says "2 sources" for two, and shows no button on a card with none', () => {
    const two = running({ claims: [claim('1', 'supported', { sources: [{ url: 'https://example.org/a', title: 'A' }, { url: 'https://example.org/b', title: 'B' }] })] });
    expect(text(card(render(two)))).toContain('2 sources');
    const none = running({ claims: [claim('1', 'supported', { sources: [] })] });
    expect(card(render(none))).not.toMatch(/fc-sources/);
  });
});

describe('F416 the stylesheet', () => {
  const css = readFileSync(new URL('./factCheck.css', import.meta.url), 'utf8');
  it('has no transcript-strip rules left', () => {
    expect(css).not.toMatch(/fc-tstrip/);
  });
  it('wraps the running row on phones only: the tabs take the first line (one row hid the Summary tab at 375px)', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 600px) {'));
    expect(phone).toMatch(/\.fc-toprow \{ flex-wrap: wrap;/);
    expect(phone).toMatch(/\.fc-toprow > \[role="tablist"\] \{ flex: 1 0 100%; \}/);
  });
  it('does not wrap the running row above 600px, and gives its buttons 36px only above 1080px on a fine pointer (the page rule owns 40px)', () => {
    expect(css).toMatch(/\.fc-toprow \{[^}]*flex-wrap:\s*nowrap/);
    const floor = css.match(/@media \(min-width: 1081px\) and \(not \(pointer: coarse\)\) \{[^}]*\.fc-toprow \.fc-btn \{ min-height: 36px; \}/);
    expect(floor).not.toBeNull();
    expect(css.replace(floor[0], '')).not.toMatch(/\.fc-toprow \.fc-btn[^{]*\{[^}]*min-height/);
  });
});
