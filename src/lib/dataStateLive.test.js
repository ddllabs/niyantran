// Module data-quality audit 2026-10-15, cause C1: 28 modules serving stored registers, packs and
// dossiers showed the green LIVE badge, because LIVE was the default for any answer not recognised as
// stored and the word "live" anywhere in a note ("no live price feed", "not the live table") counted
// as live. LIVE is now given only to an answer that is positively live: fetched by a live adapter for
// this request, not a fallback, not an archive, not a pack or register.
// The answers are production's own (src/lib/__fixtures__/dataStateAudit.json), trimmed.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveDataState } from './dataState.js';
import { feedKindLabel } from './normalise.js';
import { asOfLabel, isStoreAnswer, isStoredAnswer } from './plainSourceNote.js';

const { answers } = JSON.parse(readFileSync(new URL('./__fixtures__/dataStateAudit.json', import.meta.url), 'utf8'));
const group = (g) => answers.filter((a) => a.group === g);
const byNumber = (i) => answers.find((a) => a.i === i).feed;
// What DeskView.jsx shows beside the title: the label, unless the state hides its badge.
const badge = (feed) => {
  const s = resolveDataState(feed);
  return s.label && !s.hideBadge ? s.label : '';
};
// The header's freshness part, as DeskView.jsx builds it for a stored or store answer.
const headerFreshness = (feed, now) =>
  isStoredAnswer(feed) ? `stored copy · ${asOfLabel(feed, now)}` : isStoreAnswer(feed) ? asOfLabel(feed, now) : '';
const AUDIT_NOW = Date.parse('2026-10-15T15:50:00Z');

describe('the 28 audited modules that showed LIVE on stored data', () => {
  const shown = group('stored-shown-live');

  it('are all in the fixture', () => {
    expect(shown.map((a) => a.i)).toEqual([0, 1, 2, 5, 8, 13, 17, 18, 21, 22, 23, 24, 26, 27, 28, 31, 79, 80, 81, 82, 83, 84, 85, 86, 87, 89, 99, 108]);
  });

  for (const { i, module, feed } of shown) {
    it(`#${i} ${module} (${feed.served}/${feed.source.adapter}/${feed.source.kind || '-'}) shows no LIVE badge`, () => {
      const state = resolveDataState(feed);
      expect(state.id).not.toBe('live');
      expect(badge(feed)).toBe('');
      expect(feedKindLabel(feed)).not.toBe('LIVE');
      // It keeps the stored-copy header the app already gives it, and is not a fault state.
      expect(headerFreshness(feed, AUDIT_NOW)).toMatch(/^stored copy · (as of \d{2} \w{3} \d{4}|date not recorded)$/);
      expect(['planned', 'offline', 'error']).not.toContain(state.id);
    });
  }

  it('the registers say how current their records are', () => {
    expect(headerFreshness(byNumber(87), AUDIT_NOW)).toBe('stored copy · as of 19 Aug 2026'); // Party Organisation Map
    expect(headerFreshness(byNumber(108), AUDIT_NOW)).toBe('stored copy · as of 11 Dec 2025'); // Cross-State Comparison
    expect(headerFreshness(byNumber(0), AUDIT_NOW)).toMatch(/^stored copy · as of /); // Bill Passage register
  });
});

describe('a note that says the data is not live does not make it live', () => {
  it('Global Commodities ("illustrative … no live price feed is connected")', () => {
    const feed = byNumber(31);
    expect(feed.source.note).toMatch(/no live price feed/i);
    expect(resolveDataState(feed).id).not.toBe('live');
  });

  it('Energy ("No live price feed"), Heads of State ("not a live Wikidata table"), Goa ("not the live table")', () => {
    for (const i of [28, 22, 79]) expect(resolveDataState(byNumber(i)).id, String(i)).not.toBe('live');
  });

  it('whatever the pack kind or note', () => {
    const base = { ok: true, served: 'live', fallback: false, rows: [{ title: 'A' }], coverage: {} };
    for (const kind of ['', 'dossier', 'geo-pack', 'law-pack', 'finance-pack', 'carbon-pack', 'table', 'cards', 'graph']) {
      for (const note of ['Illustrative levels. No live price feed is connected.', 'Live request returned rows.', 'LIVE']) {
        const feed = { ...base, source: { adapter: 'embedded', kind, note } };
        expect(resolveDataState(feed).id, `${kind} · ${note}`).not.toBe('live');
      }
    }
  });
});

describe('internal and simulated answers are not live', () => {
  it('Delimitation Impact Simulator (internal simulator)', () => {
    const feed = group('internal')[0].feed;
    expect(feed.source.adapter).toBe('internal');
    expect(resolveDataState(feed).id).not.toBe('live');
    expect(badge(feed)).toBe('');
  });
});

describe('answers fetched live for this request keep the LIVE badge', () => {
  for (const { i, module, feed } of group('live')) {
    it(`#${i} ${module} (${feed.source.adapter}/${feed.source.kind || '-'})`, () => {
      expect(resolveDataState(feed).id).toBe('live');
      expect(badge(feed)).toBe('LIVE');
    });
  }

  it('includes The Space Devs launches (adapter live, kind dossier), which showed no badge', () => {
    const feed = byNumber(25);
    expect(feed.source).toMatchObject({ adapter: 'live', kind: 'dossier' });
    expect(badge(feed)).toBe('LIVE');
  });

  it('includes a news search, and a live answer whose note mentions a stored register behind it', () => {
    expect(byNumber(19).source.adapter).toBe('news-search');
    expect(badge(byNumber(19))).toBe('LIVE');
    expect(byNumber(4).source.note).toMatch(/stored register/);
    expect(badge(byNumber(4))).toBe('LIVE');
  });

  it('a page built in the browser from a live call (no `served`) is live; a scrape that fetched rows is live', () => {
    const rows = [{ title: 'A' }];
    expect(resolveDataState({ ok: true, rows, fallback: false, source: { adapter: 'live', kind: 'table', note: '' } }).id).toBe('live');
    expect(resolveDataState({ ok: true, rows, served: 'live', fallback: false, source: { adapter: 'scrape', note: '' } }).id).toBe('live');
  });
});

describe('a live adapter is not enough on its own', () => {
  const rows = [{ title: 'A', date: '2026-10-15' }];
  const live = (extra = {}, source = {}) => ({ ok: true, rows, served: 'live', fallback: false, ...extra, source: { adapter: 'api', note: '', ...source } });

  it('not when the answer is a fallback or an archive', () => {
    expect(resolveDataState(live({ fallback: true })).id).not.toBe('live');
    expect(resolveDataState(live({ served: 'archive' })).id).not.toBe('live');
    expect(resolveDataState(live({ served: 'archive' }, { adapter: 'news-search' })).id).not.toBe('live');
  });

  it('not when the kind is a pack or a register', () => {
    for (const kind of ['backup-pack', 'finance-pack', 'geo-pack', 'register']) {
      expect(resolveDataState(live({}, { kind })).id, kind).not.toBe('live');
    }
  });

  it('not for a stored or unknown adapter', () => {
    for (const adapter of ['embedded', 'register', 'internal', 'source-library', 'backup-pack', 'bill-history', '', undefined]) {
      expect(resolveDataState(live({}, { adapter })).id, String(adapter)).not.toBe('live');
    }
  });
});

describe('answers from the feed store keep their own state', () => {
  it('scheduled items: no badge, "updated N min ago"', () => {
    const feed = byNumber(106); // SDL Auction & Borrowing Tracker, store/api
    const now = Date.parse(feed.fetchedAt) + 5 * 60_000;
    expect(resolveDataState(feed).id).toBe('served');
    expect(badge(feed)).toBe('');
    expect(headerFreshness(feed, now)).toBe('updated 5 min ago');
  });

  it('a register held in the store: no badge, "register · as of …"', () => {
    for (const i of [96, 104]) {
      const feed = byNumber(i);
      expect(resolveDataState(feed).id, String(i)).toBe('served');
      expect(badge(feed)).toBe('');
      expect(headerFreshness(feed, AUDIT_NOW)).toMatch(/^register · as of \d{2} \w{3} \d{4}$/);
    }
  });
});

describe('other stored answers are unchanged', () => {
  it('archives, packs and fallbacks show no badge; curated stays curated; an empty scrape stays planned', () => {
    for (const { i, feed } of group('stored')) expect(badge(feed), String(i)).toBe('');
    expect(resolveDataState(byNumber(45)).id).toBe('archived'); // NSE/BSE archive, fallback
    expect(resolveDataState(byNumber(7)).id).toBe('curated');
    expect(resolveDataState(byNumber(101)).id).toBe('planned');
  });
});
