// F165: Home said "nter.news feed not configured on this build", showed the latest-news note as the
// server wrote it ("Waiting for nter.news article.published pushes to POST /api/news/ingest…"), and
// labelled badges "waiting for ingest", "live path" and "GDELT · LIVE". It now shows plain words; a
// technical note stays as the line's title.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const cache = vi.hoisted(() => ({ boot: null }));
vi.mock('../lib/homeCache.js', () => ({
  loadHomeCache: () => cache.boot,
  homeCacheHasRows: (c) => Boolean(c?.markets?.rows?.length || c?.latest?.rows?.length || c?.pulse?.rows?.length),
  isHomeCacheFresh: () => true,
  kickHomeRefreshIfDue: () => {},
  saveHomeCache: () => {},
}));
vi.mock('../lib/supabaseClient.js', () => ({ supabase: null }));
import HomeDesk, { latestNewsNote, SnapshotBadge } from './HomeDesk.jsx';

const FORBIDDEN = /GDELT|\bRSS\b|adapter|archive|\bhosts?\b|backend|\bAPI\b|endpoint|\bpacks?\b|fallback|\/api\/|\bsync\b|ingest|configured on this build|live path|POST\b/i;
const INGEST_NOTE = 'Waiting for nter.news article.published pushes to POST /api/news/ingest. No headlines were invented.';
const shown = (html) => html.replace(/<[^>]+>/g, '\n').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').split('\n').map((t) => t.trim()).filter(Boolean);
const quote = { name: 'NIFTY 50', last: 25000, chg: 0.4 };

function home(boot) {
  cache.boot = boot;
  return renderToStaticMarkup(<HomeDesk onOpen={() => {}} onFeed={() => {}} onSelect={() => {}} onLoading={() => {}} />);
}

describe('Home in plain words (F165)', () => {
  it('no headlines yet, with the server\'s ingest note: a plain line, the note kept as its title', () => {
    const html = home({ markets: { rows: [quote] }, latest: { rows: [], note: INGEST_NOTE, waiting: true, source: 'nter.news' }, pulse: { rows: [] } });
    const text = shown(html);
    expect(text).toContain('No nter.news headlines yet. No headlines were invented.');
    expect(text).toContain('waiting for stories');
    expect(text).not.toContain('NEWS SEARCH · LIVE');
    expect(text).toContain('No time stamp on these quotes, so treat them as a stored snapshot.');
    expect(text.filter((t) => FORBIDDEN.test(t))).toEqual([]);
    expect(html).toContain(`title="${INGEST_NOTE}"`);
  });

  it('Feed health shows "register" for the stored Open Fronts register, which has no age (F182)', () => {
    const html = home({ markets: { rows: [quote] }, latest: { rows: [] }, pulse: { rows: [{ title: 'Front A', link: '' }], archive: true, meta: { window: 'embedded Open Fronts snapshot' } } });
    expect(html).toMatch(/Conflict pulse<\/span><b>\s*register\s*<\/b>/);
  });

  it('no headlines and no note: says so plainly', () => {
    const text = shown(home({ markets: { rows: [quote] }, latest: { rows: [] }, pulse: { rows: [] } }));
    expect(text).toContain('nter.news headlines aren’t available right now. No headlines were invented.');
    expect(text).toContain('Waiting for nter.news stories.');
    expect(text.filter((t) => FORBIDDEN.test(t))).toEqual([]);
  });

  it('a plain note is shown as written', () => {
    expect(latestNewsNote('Waiting for nter.news articles.', 'x')).toBe('Waiting for nter.news articles.');
    expect(latestNewsNote('nter.news feed waiting for the first article.published ingest.', 'x')).toBe('No nter.news headlines yet.');
    expect(latestNewsNote('', 'Fallback words.')).toBe('Fallback words.');
  });

  it('the source badge has no ingest or path wording, on screen or in its title', () => {
    for (const props of [{ waiting: true, source: 'nter.news' }, { source: 'nter.news' }, { ageH: 3, source: 'nter.news' }, { archive: true }, { ageH: 0.5 }]) {
      const html = renderToStaticMarkup(<SnapshotBadge {...props} />);
      expect(html.match(FORBIDDEN)?.[0] ?? null, JSON.stringify(props)).toBeNull();
    }
  });
});
