import { describe, expect, it } from 'vitest';
import { feedOverview } from './analytics.js';

// F165 (owner, 2026-10-14): the side panel's overview tiles said "GDELT", "outlet RSS",
// "extracted pack", "exhaustive archive" and showed internal adapter ids. (The overview's note is
// cleaned where it is shown, in RailContent, with plainSourceNote; see railPlainNotes.test.jsx.)
const DEVELOPER = /GDELT|\bRSS\b|\bpack\b|archive|adapter|backup|embedded|\bapi\b|host|backend/i;

function onScreen(overview) {
  if (!overview) return [];
  const tiles = (overview.kpis || []).flatMap((k) => [k.label, k.value, k.sub]);
  return [overview.title, ...tiles].filter((t) => t != null).map(String);
}

const row = (extra = {}) => ({ title: 'A headline', outlet: 'The Hindu', court: 'NCLT Mumbai', date: '2026-10-14', ...extra });
const CASES = [
  { tier: 'sports', feature: 'Cricket Wire', source: { adapter: 'rss', note: 'Live outlet RSS (ESPNcricinfo). Not a GDELT search.', links: ['https://www.espncricinfo.com/rss/content/story/feeds/0.xml'] } },
  { tier: 'entertainment', feature: 'TV Tonight', source: { adapter: 'tvmaze', note: 'TVmaze schedule API via backend /api/ent.', links: ['https://api.tvmaze.com/schedule'] } },
  { tier: 'law', feature: 'NCLT / NCLAT', source: { adapter: 'embedded', note: 'Extracted pack.', links: [] } },
  { tier: 'national', feature: 'Some Register', source: { adapter: 'backup-pack', note: 'Exhaustive shipped backup · 38 rows.', links: ['https://sansad.in/ls'] }, fallback: true },
];

describe('side-panel overview tiles in plain words (F165)', () => {
  it.each(CASES)('$feature', (feed) => {
    const overview = feedOverview({ ok: true, rows: [row(), row({ outlet: 'Reuters' })], coverage: {}, ...feed });
    const words = onScreen(overview);
    expect(words.length).toBeGreaterThan(0);
    expect(words.filter((t) => DEVELOPER.test(t))).toEqual([]);
  });
});
