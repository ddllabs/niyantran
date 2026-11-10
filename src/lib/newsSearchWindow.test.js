import { describe, expect, it } from 'vitest';
import { CURATED_NEWS, newsDays } from './curatedNews.js';
import { newsRssUrlForFeature } from '../../server/featureFeed.mjs';

/**
 * F319: a curated news module searched Google News for 7 days (the non-curated default) unless its
 * spec set `when`, while its rows and note use newsDays(spec) (30 by default). The search window now
 * follows the module's own window. Nothing here fetches: the URL is built, not asked.
 */
const searchWindow = (tier, feature) => {
  const q = new URL(newsRssUrlForFeature(feature, tier)).searchParams.get('q');
  return q.match(/\bwhen:(\w+)/)?.[1];
};
const split = (id) => {
  const i = id.indexOf(':');
  return [id.slice(0, i), id.slice(i + 1)];
};

describe('F319: a curated module searches the window it reports', () => {
  it.each(Object.keys(CURATED_NEWS))('%s: the search window equals its row window', (id) => {
    const [tier, feature] = split(id);
    expect(searchWindow(tier, feature)).toBe(`${newsDays(CURATED_NEWS[id])}d`);
  });

  it('keeps an explicit `when` (and it agrees with the row window for every module that sets one)', () => {
    for (const [id, spec] of Object.entries(CURATED_NEWS)) {
      if (!spec.when) continue;
      const [tier, feature] = split(id);
      expect(searchWindow(tier, feature)).toBe(spec.when);
      expect(spec.when).toBe(`${newsDays(spec)}d`);
    }
  });

  it('asks for a window the rows can fill: a module with no `when` and the default window searches 30 days', () => {
    const noWhen = Object.entries(CURATED_NEWS).filter(([, s]) => !s.when && !s.days);
    expect(noWhen.length).toBeGreaterThan(0);
    for (const [id] of noWhen) {
      const [tier, feature] = split(id);
      expect(searchWindow(tier, feature)).toBe('30d');
    }
  });

  it('a feature with no curated spec keeps the 7 day search', () => {
    expect(searchWindow('state', 'Some Uncurated Feature')).toBe('7d');
    expect(searchWindow('', 'Governor Assent Tracker')).toBe('7d');
  });
});
