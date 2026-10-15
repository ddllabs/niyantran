// Task B follow-up (2026-10-16): the store path's row rule for a module (server/feedRows.mjs) must keep
// every row the module's live branch shows, or the two have drifted apart (the store would be stricter
// than live, or apply another module's rule). Each scheduled module with a rule is asked live with every
// source stubbed by one RSS feed whose stories suit most modules' guards, and its live rows are passed
// through the rule. It tests server/featureFeed.mjs and lives here because Vitest collects tests from
// src/ only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORE_ROW_RULES, storeRowsFor } from '../../server/feedRows.mjs';
import { STATEMENT_LEADERS } from '../data/nationalCurated.js';

const DAY = 86_400_000;
const STORIES = [
  'Kerala Assembly passes bill as Governor gives assent to 12 bills',
  'Pune Municipal Corporation mayor election held for corporators',
  'Gram panchayat sarpanch polls held across Bihar zilla parishad seats',
  'CAG report flags losses in Maharashtra power utilities',
  'Karnataka cabinet approves new industrial policy for investors',
  'District court sentences accused in Lucknow murder case',
  'Collegium recommends judges for Bombay High Court elevation',
  'International Court of Justice hears genocide case against Israel',
  'Sports ministry suspends wrestling federation over election row',
  "Governor and state government row over Raj Bhavan address in Tamil Nadu",
  'Two MLAs face disqualification petition under Tenth Schedule after defection',
  'District collector reviews water supply in Nashik district villages',
  'Ceasefire talks resume as UN Security Council meets on Gaza',
  'Heat wave and coal power demand rise across India this month',
  'IndiaAI mission opens GPU compute portal for startups',
  'Allahabad High Court grants bail to accused in Prayagraj land case',
  'National Green Tribunal orders action on Yamuna pollution in Delhi',
  'NCDRC orders insurer to pay claim to consumer with interest',
  'ITAT deletes addition in tax case of Mumbai trader',
  'International Criminal Court issues warrant in war crimes case',
  'Uttar Pradesh transfers 12 IAS officers in major reshuffle',
  'Draft rules notified for public consultation on drone operations',
  'RBI keeps repo rate unchanged as rupee steadies against dollar',
  'Parliament panel meets on data protection rules for platforms',
  'India beat Pakistan in hockey Asia Cup final in Chennai',
];
const OLD_STORY = 'Tamil Nadu chief minister launches breakfast scheme for schools';

function rssBody(now) {
  const date = (ms) => new Date(ms).toUTCString();
  const items = [
    ...STORIES.map((t, i) => [t, now - (i + 1) * 3_600_000]),
    [OLD_STORY, now - 20 * DAY],
  ];
  const xml = items.map(([title, at]) => `<item><title>${title} - Example News</title><link>https://news.example/${encodeURIComponent(title)}</link><pubDate>${date(at)}</pubDate><description>${title}</description><source url="https://news.example">Example News</source></item>`);
  return `<?xml version="1.0"?><rss><channel>${xml.join('')}</channel></rss>`;
}

function stubSources(body) {
  vi.stubGlobal('fetch', vi.fn(async (url) => ({
    ok: true, status: 200, url: String(url), headers: new Headers({ 'content-type': 'application/rss+xml' }),
    text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  })));
}

const real = (body) => (Array.isArray(body?.rows) ? body.rows : []).filter((r) => r && r.status !== 'source_status');
const keyOf = (r) => `${r.title}|${r.source_url || ''}`;

describe("the store path's row rule keeps every row the module's live branch shows", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('for every scheduled module with a rule', async () => {
    const now = Date.now();
    stubSources(rssBody(now));
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    const checked = [];
    for (const id of Object.keys(STORE_ROW_RULES)) {
      const [tier, feature] = id.split(/:(.*)/s);
      const person = id.startsWith('national:Statement') ? STATEMENT_LEADERS[1] : '';
      const body = await serveFeatureFeed(new URLSearchParams({ tier, feature, ...(person ? { person } : {}) }));
      const rows = real(body);
      if (!rows.length) continue;
      const kept = storeRowsFor(id, rows, { now: Date.now(), variant: person });
      expect(kept.map(keyOf).sort(), id).toEqual(rows.map(keyOf).sort());
      checked.push(id);
    }
    // The stub suits every module with a rule, so none is skipped: the check is not vacuous.
    expect(checked).toEqual(Object.keys(STORE_ROW_RULES));
  }, 60_000);
});
