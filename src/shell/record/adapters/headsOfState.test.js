import { describe, expect, it } from 'vitest';
import leadersPack from '../../../data/leaders.json';
import { flattenLeader } from '../../../lib/globalResources.js';
import { countryPosition } from '../geoLookup.js';
import { contractProblems } from '../modelContract.js';
import headsOfState from './headsOfState.js';

/**
 * F121 batch 2, T13: Heads of State (the embedded world-leaders register).
 *
 * Fixtures are the real pack (src/data/leaders.json, 44 profiles) through the real flattenLeader, so
 * the rows have exactly the shape the feed serves. flattenLeader fills defaults that are not data:
 * status 'Tracked' (or 'Not verified'), next_transition 'Not reported', authority 'De jure (as
 * listed)', source_url the Wikidata home page, and name 'Not verified' for placeholder names. The
 * raw profiles in the pack hold none of those fields, so the panel must treat every one of them as
 * "not on record" and show it only when a profile really sets it.
 */
const rows = leadersPack.leaders.map(flattenLeader);
const ctx = (extra = {}) => ({ rows, feed: { feature: 'Heads of State', meta: { asOf: leadersPack.asOf, stats: leadersPack.stats } }, ...extra });
const model = (row, c = ctx()) => headsOfState(row, c);
const byId = (id) => rows.find((r) => r.id === id);

const modi = byId('in');
// Since F202 (2026-10-15) every profile names its holder, sourced to Wikidata. The placeholder cases use the
// US profile as it stood before: named by its office, with no as-of or source of its own.
const us = flattenLeader({ ...leadersPack.leaders.find((p) => p.id === 'us'), name: 'US President', as_of: undefined, source_url: undefined }); // placeholder name, party and ideology "—", no age
const SOURCED = ['us', 'gb', 'de', 'jp', 'kr', 'pk', 'bd', 'lk', 'af', 'ca', 'pl', 'nl', 'au', 'vn', 'th', 'qa', 'ae', 'sg', 'cu'];
const xi = byId('cn');
const ua2 = byId('ua2'); // duplicate reference row

/** A profile with every optional field set, as a future pack edit might write it. */
const full = (extra = {}) => flattenLeader({ id: 'zz', name: 'Test Person', country: 'France', flag: '', role: 'President', party: 'Test Party', ideology: 'Centrist', since: '2020-05', age: 61, latest: 'A test note.', ...extra });

const DEFAULTS = /not reported|\btracked\b|de jure \(as listed\)/i;

function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

/** Every string of a model except the register's own prose in the "Latest" card (it may contain a dash). */
function modelStrings(m) {
  const copy = { ...m, about: { ...m.about, cards: (m.about.cards || []).filter((c) => c.heading !== 'Latest') } };
  return strings(copy);
}

describe('fixtures are real flattenLeader output', () => {
  it('has 44 profiles and shows the defaults flattenLeader fills', () => {
    expect(rows).toHaveLength(44);
    expect(us).toMatchObject({ name: 'Not verified', status: 'Not verified', next_transition: 'Not reported', authority: 'De jure (as listed)', source_url: 'https://www.wikidata.org/', party: '—', ideology: '—', age: '' });
    expect(modi).toMatchObject({ name: 'Narendra Modi', status: 'Tracked', next_transition: 'Not reported', authority: 'De jure (as listed)', last_verified: '', term_start: '2014', age: 75 });
    expect(byId('us')).toMatchObject({ name: 'Donald Trump', status: 'Tracked', last_verified: '2026-10-15', source_url: 'https://www.wikidata.org/wiki/Q22686' });
  });

  it('holds none of the defaulted fields in the raw profiles', () => {
    for (const p of leadersPack.leaders) {
      for (const k of ['status', 'next_transition', 'next_election', 'authority', 'acting', 'last_verified', 'term_start']) expect(p, `${p.id}.${k}`).not.toHaveProperty(k);
    }
  });

  it('holds an as-of date and a Wikidata item only on the 19 profiles filled from Wikidata (F202)', () => {
    expect(leadersPack.leaders.filter((p) => 'as_of' in p || 'source_url' in p).map((p) => p.id)).toEqual(SOURCED);
    for (const id of SOURCED) expect(byId(id).source_url, id).toMatch(/^https:\/\/www\.wikidata\.org\/wiki\/Q\d+$/);
  });
});

describe('contract and hygiene', () => {
  it('honours the panel contract for all 44 profiles', () => {
    for (const row of rows) expect(contractProblems(model(row)), row.id).toEqual([]);
  });

  it('honours the contract when the context is missing or empty', () => {
    for (const row of rows) {
      expect(contractProblems(headsOfState(row)), row.id).toEqual([]);
      expect(contractProblems(headsOfState(row, { rows: [], feed: {} })), row.id).toEqual([]);
    }
  });

  it('honours the contract for a bare row and a raw-shaped row', () => {
    expect(contractProblems(headsOfState({}))).toEqual([]);
    expect(contractProblems(headsOfState(leadersPack.leaders[0]))).toEqual([]);
  });

  it('never renders a dash, bracket, undefined, NaN or null (the register prose in "Latest" aside)', () => {
    for (const row of rows) {
      for (const s of modelStrings(model(row))) expect(s, `${row.id} → ${s}`).not.toMatch(/—|\[|undefined|NaN|\bnull\b/);
    }
  });

  it('keeps the only dash in the pack inside the register prose of the one duplicate-reference row', () => {
    const dashed = rows.filter((r) => strings(model(r)).some((s) => /—/.test(s))).map((r) => r.id);
    expect(dashed).toEqual(['ua2']);
    expect(model(ua2).about.cards).toEqual([{ heading: 'Latest', body: 'Duplicate reference — see primary card.' }]);
  });
});

describe('flattenLeader defaults are treated as not on record', () => {
  it('shows no default value anywhere in any of the 44 models', () => {
    for (const row of rows) {
      for (const s of strings(model(row))) expect(s, `${row.id} → ${s}`).not.toMatch(DEFAULTS);
    }
  });

  it('shows no Authority row, Next transition row or tile, and no Tracked badge for a profile that set none of them', () => {
    for (const row of rows) {
      const m = model(row);
      expect(m.about.rows.map(([k]) => k), row.id).not.toContain('Authority');
      expect(m.about.rows.map(([k]) => k), row.id).not.toContain('Next transition');
      expect(m.glance.tiles.map((t) => t.label), row.id).not.toContain('Next transition');
      expect(m.badge?.text, row.id).not.toBe('Tracked');
    }
  });

  it('badges only a verified-name problem: a row is badged exactly when its name is an office, not a holder', () => {
    // F122: rows named by an office ("UK Prime Minister", "Qatar (Emir)") are not verified, as "US President" was.
    const badged = rows.filter((r) => model(r).badge).map((r) => r.id);
    expect(badged).toEqual(rows.filter((r) => r.name === 'Not verified').map((r) => r.id));
    // F202: the 19 office-named rows now name their holders, so no row of the pack is badged.
    expect(badged).toEqual([]);
    expect(model(us).badge).toEqual({ text: 'Not verified', tone: 'amber' });
    for (const id of ['in', 'sa', 'ng2', 'kp2']) expect(badged, id).not.toContain(id);
  });

  it('shows a next transition, authority, status and last-verified date once a profile really sets them', () => {
    const row = full({ next_election: 'Nov 2026', authority: 'De facto', status: 'Caretaker', last_verified: '2026-09-15' });
    const m = model(row);
    expect(m.about.rows).toContainEqual(['Next transition', 'Nov 2026']);
    expect(m.about.rows).toContainEqual(['Authority', 'De facto']);
    expect(m.badge).toEqual({ text: 'Caretaker', tone: 'amber' });
    expect(m.footer.provenance.asOf).toBe('15 Sep 2026');
    expect(contractProblems(m)).toEqual([]);
  });

  it('reads an acting profile as Acting / interim (flattenLeader derives it from the profile\'s acting flag)', () => {
    const m = model(full({ acting: true }));
    expect(m.about.rows).toContainEqual(['Authority', 'Acting / interim']);
  });

  it('shows next_transition in place of the party tile only when there is no party', () => {
    const m = model(full({ party: '—', next_election: 'Nov 2026', age: null }));
    expect(m.glance.tiles.map((t) => t.label)).toEqual(['Office', 'In office since', 'Next transition']);
    expect(m.glance.tiles[2].value).toBe('Nov 2026');
  });

  it('gives a grey badge to a real status it does not recognise and no badge to a defaulted one', () => {
    expect(model(full({ status: 'Exiled' })).badge).toEqual({ text: 'Exiled', tone: 'grey' });
    expect(model(full()).badge).toBeUndefined();
  });

  it('never links the Wikidata home page that flattenLeader writes into every row', () => {
    for (const row of rows) {
      // A generic default is not a source record; sourced rows expose their own item.
      expect(row.source_url).toMatch(/^https:\/\/www\.wikidata\.org\/(wiki\/Q\d+)?$/);
      expect(model(row).links, row.id).toEqual(/\/wiki\/Q[1-9][0-9]*$/.test(row.source_url) ? [{label:'Wikidata source record',href:row.source_url}] : []);
    }
  });
});

describe('header, title and badge', () => {
  it('titles a verified profile with the leader and describes it by country and office', () => {
    const m = model(modi);
    expect(m.title).toBe('Narendra Modi');
    expect(m.meta).toEqual(['India', 'Prime Minister']);
    expect(m.badge).toBeUndefined();
    expect(m.links).toEqual([]);
  });

  it('titles a Not verified row by office and country, with an amber Not verified badge', () => {
    const m = model(us);
    expect(m.title).toBe('President, United States');
    expect(m.badge).toEqual({ text: 'Not verified', tone: 'amber' });
    expect(m.title).not.toMatch(/Not verified/);
    expect(m.meta.join(' ')).not.toBe(m.title);
    expect(m.glance.callout).toMatchObject({ tone: 'amber' });
    expect(m.footer.provenance.flags).toContain('name not verified');
  });

  it('falls back to the country alone, then to a generic title', () => {
    expect(model({ ...us, office: '', role: '' }).title).toBe('United States');
    expect(model({ ...us, country: '' }).title).toBe('President');
    expect(model({ ...us, country: '', office: '', role: '' }).title).toBe('Leader');
    expect(model({}).title).toBe('Leader');
  });

  it('treats every placeholder name flattenLeader recognises as unverified', () => {
    for (const [name, role] of [['President', 'President'], ['Prime Minister', 'Prime Minister'], ['', 'President'], ['Chancellor', 'Chancellor'], ['US President', 'President']]) {
      const row = flattenLeader({ id: 'x', name, country: 'Testland', role });
      expect(row.name, name).toBe('Not verified');
      expect(model(row).badge, name).toEqual({ text: 'Not verified', tone: 'amber' });
    }
  });
});

describe('01 at a glance', () => {
  it('leads with office, in office since, age and party for a profile that holds them', () => {
    const t = model(modi).glance.tiles;
    expect(t.map((x) => x.label)).toEqual(['Office', 'In office since', 'Age', 'Party']);
    expect(t.map((x) => x.value)).toEqual(['Prime Minister', '2014', '75', 'BJP']);
  });

  it('keeps a bare year as the year, never as a date (a Date would read 2014 as 01 Jan 2014)', () => {
    for (const row of rows) expect(model(row).glance.tiles[1].value, row.id).toBe(row.term_start);
    expect(model(modi).glance.tiles[1].value).not.toMatch(/Jan/);
  });

  it('writes a month or a date that the register gives in full, and anything else as given', () => {
    expect(model(full({ since: '2020-05' })).glance.tiles[1].value).toBe('May 2020');
    expect(model(full({ since: '2020-05-17' })).glance.tiles[1].value).toBe('17 May 2020');
    expect(model(full({ since: 'Mar 2021' })).glance.tiles[1].value).toBe('Mar 2021');
    expect(model(full({ since: 'since the coup' })).glance.tiles[1].value).toBe('since the coup');
  });

  it('omits Age when the profile has none, and Party when it is a dash', () => {
    const t = model(us).glance.tiles;
    expect(t.map((x) => x.label)).toEqual(['Office', 'In office since']);
    expect(model(byId('gb')).glance.tiles.map((x) => x.label)).toEqual(['Office', 'In office since']);
    expect(model(byId('sa')).glance.tiles.map((x) => x.label)).toEqual(['Office', 'In office since', 'Age']);
  });

  it('reads a missing office or start as Not on record, and still has two tiles', () => {
    const m = model({ ...modi, office: '', role: '', term_start: '', since: '' });
    expect(m.glance.tiles.map((t) => t.value).slice(0, 2)).toEqual(['Not on record', 'Not on record']);
    const bare = model({});
    expect(bare.glance.tiles).toHaveLength(2);
    expect(bare.glance.tiles.map((t) => t.value)).toEqual(['Not on record', 'Not on record']);
  });

  it('has no leader card, no second visual and no board', () => {
    for (const row of rows) {
      const g = model(row).glance;
      expect(g.visual2, row.id).toBeUndefined();
      expect(g.visual?.type, row.id).toBe('map');
    }
  });
});

describe('country map', () => {
  it('places every one of the 44 leaders at its country centre, approximate, with a main marker', () => {
    for (const row of rows) {
      const v = model(row).glance.visual;
      expect(v, row.country).toBeDefined();
      expect(v.type).toBe('map');
      expect(v.points).toHaveLength(1);
      expect(v.points[0]).toMatchObject({ ...countryPosition(row.country), label: row.country, main: true, approximate: true });
    }
  });

  it('says the position is the country, not where the leader is', () => {
    const v = model(modi).glance.visual;
    expect(v.caption).toMatch(/country/i);
    expect(v.caption).toMatch(/approximate/i);
    expect(v.caption).not.toMatch(/coordinates of/i);
  });

  it('has no map for a country the table does not know, or none', () => {
    expect(model({ ...modi, country: 'Atlantis' }).glance.visual).toBeUndefined();
    expect(model({ ...modi, country: '' }).glance.visual).toBeUndefined();
    expect(contractProblems(model({ ...modi, country: 'Atlantis' }))).toEqual([]);
  });
});

describe('02 about', () => {
  it('lists country, office, party and ideology, only where real', () => {
    const m = model(modi);
    expect(m.about.label).toBe('02 · About this leader');
    expect(m.about.rows).toEqual([['Country', 'India'], ['Office', 'Prime Minister'], ['Party', 'BJP'], ['Ideology', 'Hindu nationalist / right']]);
    expect(model(us).about.rows).toEqual([['Country', 'United States'], ['Office', 'President']]);
    expect(model({}).about.rows).toEqual([]);
  });

  it('puts the latest note in a Latest card, and omits the card when there is none', () => {
    expect(model(xi).about.cards).toEqual([{ heading: 'Latest', body: xi.latest }]);
    expect(model({ ...xi, latest: '' }).about.cards || []).toEqual([]);
    for (const row of rows) expect(model(row).about.cards?.[0]?.body, row.id).toBe(row.latest || undefined);
  });
});

describe('03 what it touches', () => {
  it('counts the other leaders of the same ideology and never the selection', () => {
    const counts = {};
    for (const r of rows) counts[r.ideology] = (counts[r.ideology] || 0) + 1;
    for (const row of rows) {
      const links = model(row).touches.links;
      if (row.ideology === '—' || counts[row.ideology] === 1) expect(links, row.id).toEqual([]);
      else expect(links[0].detail, row.id).toBe(`${counts[row.ideology] - 1} more on the register`);
    }
  });

  it('does not count the selection when it is a copy of its feed row', () => {
    const left = rows.filter((r) => r.ideology === 'Left');
    const copy = { ...left[0] };
    expect(left.includes(copy)).toBe(false);
    expect(model(copy).touches.links[0].detail).toBe(`${left.length - 1} more on the register`);
  });

  it('matches ideology case-insensitively', () => {
    const odd = { ...full({ ideology: 'LEFT' }), id: 'odd' };
    expect(model(odd, ctx({ rows: [...rows, odd] })).touches.links[0].detail).toBe('3 more on the register');
  });

  it('never computes a same-ideology group for an empty or dash ideology, though eleven rows share the dash', () => {
    expect(rows.filter((r) => r.ideology === '—')).toHaveLength(11);
    for (const row of rows.filter((r) => r.ideology === '—')) expect(model(row).touches.links, row.id).toEqual([]);
    expect(model(full({ ideology: '' }), ctx({ rows: [...rows, { ...full({ ideology: '' }), id: 'blank' }] })).touches.links).toEqual([]);
  });

  it('links nothing when the feed rows are missing', () => {
    expect(model({}).touches.links).toEqual([]);
    expect(model(modi, { rows: undefined, feed: undefined }).touches.links).toEqual([]);
    expect(model(modi, { rows: [], feed: {} }).touches.links).toEqual([]);
  });

  it('writes its cross-links as static text, with no destination', () => {
    const left = rows.filter((r) => r.ideology === 'Left');
    const links = model(left[0]).touches.links;
    expect(links).toEqual([{ title: 'Same ideology: Left', detail: `${left.length - 1} more on the register` }]);
    for (const row of rows) for (const l of model(row).touches.links) expect(l.to, `${row.id}: ${l.title}`).toBeUndefined();
    expect(model(modi).touches.links).toEqual([]);
  });
});

describe('footer and provenance', () => {
  it('offers Ask AI about this leader', () => {
    for (const row of rows) expect(model(row).footer.ask).toBe('Ask AI about this leader');
  });

  it('names the platform\'s leaders register as the source, not Wikidata or the World Factbook', () => {
    const p = model(modi).footer.provenance;
    expect(p.source).toMatch(/leaders register/i);
    expect(p.source).toMatch(/stored on the platform/i);
    expect(p.source).not.toMatch(/wikidata|factbook|cia/i);
    expect(p.flags).toEqual([]);
  });

  it('takes the as-of from the row\'s last_verified when it is a real date', () => {
    expect(model(full({ last_verified: '2026-09-15' })).footer.provenance.asOf).toBe('15 Sep 2026');
    expect(model(full({ last_verified: '2026-09' })).footer.provenance.asOf).toBe('Sep 2026');
    expect(model(full({ as_of: '2026-08-01' })).footer.provenance.asOf).toBe('01 Aug 2026');
  });

  it('falls back from the row to the feed\'s meta.asOf', () => {
    const c = ctx({ feed: { meta: { asOf: '2026-05' } } });
    expect(model(modi, c).footer.provenance.asOf).toBe('May 2026');
    expect(model(full({ last_verified: '2026-09-15' }), c).footer.provenance.asOf).toBe('15 Sep 2026');
  });

  it('falls back from the feed to the pack\'s own as-of', () => {
    expect(leadersPack.asOf).toBe('2026-07');
    for (const c of [{}, { rows }, { feed: {} }, { feed: { meta: {} } }, { feed: { meta: { asOf: '' } } }]) expect(headsOfState(modi, c).footer.provenance.asOf, JSON.stringify(Object.keys(c))).toBe('Jul 2026');
    expect(headsOfState(modi).footer.provenance.asOf).toBe('Jul 2026');
  });

  it('skips a last_verified or feed as-of that is not a date and uses the next source', () => {
    expect(model(full({ last_verified: 'recently' }), ctx({ feed: { meta: { asOf: 'soon' } } })).footer.provenance.asOf).toBe('Jul 2026');
    expect(model(full({ last_verified: 'recently' })).footer.provenance.asOf).toBe('Jul 2026');
    expect(model(full({ last_verified: '2026-13-45' })).footer.provenance.asOf).toBe('Jul 2026');
  });

  it('never carries the as-of-not-on-record flag, because the pack always has a date', () => {
    for (const row of rows) expect(model(row).footer.provenance.flags, row.id).not.toContain('as-of not on record');
  });

  it('says office-holders change and that this is a register as of that date, not a live feed', () => {
    const note = model(modi).footer.note;
    expect(note).toMatch(/office-holders change/i);
    expect(note).toMatch(/register/i);
    expect(note).toMatch(/not a live feed/i);
    expect(note).toContain('Jul 2026');
    expect(model(full({ last_verified: '2026-09-15' })).footer.note).toContain('15 Sep 2026');
  });
});

describe('does not mutate its input', () => {
  it('leaves the row and the context rows untouched', () => {
    const before = JSON.stringify(rows);
    for (const row of rows) model(row);
    expect(JSON.stringify(rows)).toBe(before);
  });
});

// A smoke test on the unrelated stat the feed also passes: meta.stats is not used as a fact about a leader.
describe('feed statistics', () => {
  it('never puts the pack-wide statistics (autocracies, tenure) in a single leader\'s panel', () => {
    for (const row of rows) for (const s of strings(model(row))) expect(s).not.toMatch(/autocrac|avg tenure|elections this year/i);
  });
});

it('rejects unsafe or generic leader sources', () => {
  for(const source_url of ['javascript:alert(1)','https://www.wikidata.org/','https://evil.example/wiki/Q123','https://www.wikidata.org/wiki/Q123?redirect=evil','']) {
    expect(model(full({source_url})).links).toEqual([]);
  }
});
