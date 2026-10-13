import { describe, expect, it } from 'vitest';
import pack from '../../../data/alliances.json';
import { flattenAlliance } from '../../../lib/alliances.js';
import { countryPosition } from '../geoLookup.js';
import { contractProblems } from '../modelContract.js';
import alliances from './alliances.js';

/**
 * F121 batch 3, T16: Alliances (the embedded alliance and bloc register).
 *
 * Fixtures are the real pack (src/data/alliances.json, 46 blocs) through the real flattenAlliance,
 * exactly as server/featureFeed.mjs serves them, with the feed envelope's meta ({ verified,
 * memberFlags }). The rows hold a roster, a seat, milestones as a flat [date, text, date, text...]
 * list and a verified date; they hold no coordinates, no Open Fronts links and no pending
 * applications, so the panel shows none of those.
 */
const rows = pack.alliances.map((p) => flattenAlliance(p, pack.memberFlags));
const feed = { ok: true, feature: 'Alliances', meta: { verified: pack.verified, memberFlags: pack.memberFlags } };
const ctx = (extra = {}) => ({ rows, feed, ...extra });
const model = (row, c = ctx()) => alliances(row, c);
const byId = (id) => rows.find((r) => r.id === id);
const members = (row) => JSON.parse(row.members_json);

const nato = byId('nato');
const csto = byId('csto');
const au = byId('au');
const g20 = byId('g20');
const pif = byId('pif');
const eu = byId('eu');
const quad = byId('quad');
const caricom = byId('caricom');
const brics = byId('brics');
const anzus = byId('anzus');

/** A row as the feed would serve it, for a bloc the pack does not hold. */
const synthetic = (extra = {}) => flattenAlliance({
  id: 'zz', name: 'Test Accord', short: 'TA', category: 'Security cooperation', region: 'Test Region', status: 'Active', formed: '2001', seat: 'Paris, France',
  legalBasis: 'Test Treaty', decision: 'Consensus', obligation: 'Security cooperation', scope: 'Testing', latestDate: '01 Jan 2025', latest: 'A test happened.', next: 'Watch the test.',
  members: ['France', 'Germany', 'India'], agenda: ['One'], instruments: ['A council'], milestones: ['2001', 'Founded', '2005', 'Germany joined'],
  source: 'https://example.org/ta', sourceLabel: 'Test source', verified: '22 Aug 2026', ...extra,
}, {});

const bare = flattenAlliance({ id: 'bare' }, {});
const ALL = [...rows, synthetic(), bare];

function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => { if (k !== 'row') strings(v, out); });
  return out;
}

const mapOf = (row, c) => model(row, c).glance.visual;
const timelineOf = (row, c) => model(row, c).glance.visual2;

describe('Alliances adapter: fixtures', () => {
  it('are the real pack rows, with member flags in the feed meta', () => {
    expect(rows).toHaveLength(46);
    expect(nato).toMatchObject({ title: 'North Atlantic Treaty Organization', short: 'NATO', memberCount: 32, formed: '1949', seat: 'Brussels, Belgium', verified: '22 Aug 2026' });
    expect(Object.keys(feed.meta.memberFlags).length).toBeGreaterThan(10);
  });

  it('honours the panel contract for every row, with and without the feed context', () => {
    for (const row of ALL) {
      expect(contractProblems(model(row)), row.title || '(bare)').toEqual([]);
      expect(contractProblems(alliances(row)), `${row.title || '(bare)'} without ctx`).toEqual([]);
      expect(contractProblems(alliances(row, { rows })), `${row.title || '(bare)'} without feed`).toEqual([]);
    }
  });

  it('never renders a dash placeholder, a bracket, undefined, NaN or null', () => {
    for (const row of ALL) {
      for (const s of strings(model(row))) expect(s, `${row.title} → ${s}`).not.toMatch(/—|\[|undefined|NaN|^\s*null\s*$/);
    }
  });

  it('is a pure function of the row and context', () => {
    expect(model(nato)).toEqual(model(nato));
    expect(model(nato)).toEqual(model({ ...nato }));
  });
});

describe('header, badge and links', () => {
  it('names the bloc, its short name, structure and region', () => {
    const m = model(nato);
    expect(m.title).toBe('North Atlantic Treaty Organization');
    expect(m.meta).toEqual(['NATO', 'Collective defence', 'Transatlantic']);
    expect(model(bare).title).toBe('Alliance');
    expect(model(bare).meta).toEqual([]);
  });

  it('shows a badge only for a real status: green for plain Active, amber when the status is qualified', () => {
    expect(model(nato).badge).toEqual({ text: 'Active', tone: 'green' });
    expect(model(csto).badge).toEqual({ text: 'Active', tone: 'amber' });
    expect(model(anzus).badge).toEqual({ text: 'Treaty active', tone: 'amber' });
    expect(model(byId('saarc')).badge).toEqual({ text: 'Institutional activity continues', tone: 'amber' });
    expect(model(synthetic({ status: 'Dormant' })).badge).toEqual({ text: 'Dormant', tone: 'grey' });
    expect(model(synthetic({ status: '' })).badge).toBeUndefined();
    expect(model(bare).badge).toBeUndefined();
  });

  it('links the row source over https only, labelled by the register', () => {
    expect(model(nato).links).toEqual([{ label: 'NATO', href: 'https://www.nato.int/en/what-is-nato' }]);
    expect(model({ ...nato, source_url: 'http://insecure.example/x' }).links).toEqual([]);
    expect(model(bare).links).toEqual([]);
    for (const row of rows) for (const l of model(row).links) expect(l.href).toMatch(/^https:\/\//);
  });
});

describe('01 at a glance: tiles', () => {
  it('leads with members, formed, obligation class and latest record', () => {
    for (const row of ALL) expect(model(row).glance.tiles.map((t) => t.label), row.title).toEqual(['Members', 'Formed', 'Obligation', 'Latest record']);
    const t = model(nato).glance.tiles;
    expect(t[0]).toMatchObject({ value: '32' });
    expect(t[1]).toMatchObject({ value: '1949' });
    expect(t[2]).toMatchObject({ value: 'Mutual / collective' });
    expect(t[3]).toMatchObject({ value: '07 Mar 2024' });
  });

  it('counts active or full members from the feed member flags, excluding exceptions and reviews', () => {
    expect(model(nato).glance.tiles[0].sub).toBe('32 active or full');
    expect(model(au).glance.tiles[0]).toMatchObject({ value: '55', sub: '51 active or full' });
    expect(model(csto).glance.tiles[0]).toMatchObject({ value: '6', sub: '5 active or full' });
    expect(model(brics).glance.tiles[0]).toMatchObject({ value: '11', sub: '10 active or full' });
  });

  it('claims no active or full count when the feed carries no member flags', () => {
    for (const c of [{ rows }, { rows, feed: { meta: { verified: pack.verified } } }, { rows, feed: { meta: { memberFlags: null } } }]) {
      expect(model(au, c).glance.tiles[0]).toMatchObject({ value: '55', sub: 'roster entries' });
      expect(strings(model(au, c)).join('|')).not.toMatch(/active or full/);
    }
  });

  it('reads an absent value as Not on record, never a dash', () => {
    expect(model(bare).glance.tiles.map((t) => t.value)).toEqual(['Not on record', 'Not on record', 'Not on record', 'Not on record']);
  });
});

describe('callout', () => {
  it('names the roster exceptions and reviews the register flags, with their standing', () => {
    expect(model(csto).glance.callout.text).toContain('Armenia (Member; participation suspended)');
    const t = model(au).glance.callout.text;
    for (const c of ['Sudan', 'Mali', 'Burkina Faso', 'Niger']) expect(t).toContain(c);
    expect(t).not.toContain('Guinea');
    expect(t).not.toContain('Gabon');
  });

  it('repeats a qualified status as written', () => {
    expect(model(csto).glance.callout).toMatchObject({ tone: 'amber' });
    expect(model(csto).glance.callout.text).toContain('Active; Armenia participation frozen');
    expect(model(byId('saarc')).glance.callout.text).toContain('Institutional activity continues; summit process stalled');
  });

  it('is absent for a plain Active bloc with no flagged member', () => {
    expect(model(nato).glance.callout).toBeUndefined();
    expect(model(eu).glance.callout).toBeUndefined(); // Denmark and Ireland are differentiated, not exceptions
    expect(model(csto, { rows }).glance.callout.text).not.toMatch(/Armenia \(/); // no flags: only the status text
  });
});

describe('01 at a glance: member map', () => {
  it('places only members the lookup knows, every point approximate and blue-toned by standing', () => {
    for (const row of rows) {
      const v = mapOf(row);
      expect(v.type).toBe('map');
      expect(v.title).toBe('Member states');
      const names = members(row);
      for (const p of v.points) {
        expect(names, `${row.id}: ${p.label}`).toContain(p.label);
        expect(p.approximate, `${row.id}: ${p.label}`).toBe(true);
        expect(p).toMatchObject({ lat: countryPosition(p.label).lat, lon: countryPosition(p.label).lon });
      }
      expect(new Set(v.points.map((p) => p.label)).size).toBe(v.points.length);
    }
  });

  it('leaves unplaceable members off, and the caption says how many are shown of how many', () => {
    for (const row of rows) {
      const v = mapOf(row);
      const placed = members(row).filter((m) => countryPosition(m));
      expect(v.points.length, row.id).toBe(placed.length);
      expect(v.caption, row.id).toContain(`Showing ${placed.length} of ${members(row).length} members`);
      expect(v.right).toBe(`${members(row).length} members`);
    }
    expect(mapOf(nato).caption).toContain('Showing 32 of 32 members');
    expect(mapOf(au).caption).toContain('Showing 54 of 55 members');
    expect(mapOf(au).caption).toContain('Sahrawi Arab Democratic Republic');
    expect(mapOf(g20).caption).toContain('Showing 19 of 21 members');
    expect(mapOf(g20).caption).toMatch(/European Union.*African Union|African Union.*European Union/);
    expect(mapOf(pif).points).toHaveLength(14);
    expect(mapOf(pif).caption).toContain('Showing 14 of 18 members');
    expect(mapOf(caricom).caption).toContain('Showing 14 of 15 members');
  });

  it('says it is approximate and schematic: country centres, not capitals or borders', () => {
    expect(mapOf(nato).caption).toMatch(/approximate country centres/i);
    expect(mapOf(nato).caption).not.toMatch(/capital/i);
  });

  it('marks a main point only when the seat names a country on the roster, and never more than one', () => {
    const main = (row) => mapOf(row).points.filter((p) => p.main).map((p) => p.label);
    expect(main(nato)).toEqual(['Belgium']);
    expect(main(au)).toEqual(['Ethiopia']);
    expect(main(byId('sco'))).toEqual(['China']);
    expect(main(byId('oecd'))).toEqual(['France']);
    expect(main(byId('norad'))).toEqual(['United States']); // Colorado Springs, United States
    expect(main(byId('oas'))).toEqual(['United States']); // Washington, D.C., United States
    // A seat that is a list of cities, a rotating presidency, a framework nation or a depositary is not a country.
    for (const id of ['eu', 'brics', 'g7', 'quad', 'us-japan', 'jef', 'cptpp', 'v4', 'five-eyes']) expect(main(byId(id)), id).toEqual([]);
    for (const row of rows) expect(main(row).length, row.id).toBeLessThanOrEqual(1);
    expect(mapOf(nato).caption).toContain('Belgium');
    expect(mapOf(nato).caption).toMatch(/seat/i);
    expect(mapOf(eu).caption).not.toMatch(/seat/i);
  });

  it('never marks a seat country that is not a member', () => {
    const v = mapOf(synthetic({ seat: 'Tokyo, Japan' }));
    expect(v.points.some((p) => p.main)).toBe(false);
    expect(v.points.some((p) => p.label === 'Japan')).toBe(false);
    expect(v.caption).not.toMatch(/Japan|seat/);
  });

  it('tones points by the register flag and explains only the colours it uses', () => {
    const tone = (v, name) => v.points.find((p) => p.label === name).tone;
    expect(tone(mapOf(csto), 'Armenia')).toBe('red');
    expect(tone(mapOf(csto), 'Russia')).toBe('blue');
    expect(tone(mapOf(au), 'Sudan')).toBe('red');
    expect(tone(mapOf(au), 'Niger')).toBe('red');
    expect(tone(mapOf(au), 'Guinea')).toBe('green');
    expect(tone(mapOf(eu), 'Denmark')).toBe('amber');
    expect(mapOf(csto).caption).toMatch(/red/i);
    expect(mapOf(nato).caption).not.toMatch(/\bred\b|\bamber\b|\bgreen\b/i);
    for (const p of mapOf(au, { rows }).points) expect(p.tone, 'no flags known').toBe('blue');
  });

  it('omits the map when no member can be placed', () => {
    expect(mapOf(synthetic({ members: ['Atlantis'] }))).toBeUndefined();
    expect(mapOf(bare)).toBeUndefined();
  });
});

describe('01 at a glance: roster history', () => {
  it('is built from the milestones, date as detail and event as label, in the order held', () => {
    const v = timelineOf(nato);
    expect(v).toMatchObject({ type: 'timeline', title: 'Roster history', right: '32 members' });
    expect(v.steps.map((s) => [s.label, s.detail])).toEqual([
      ['Treaty signed by 12 founding allies', '1949'],
      ['Finland joined', '2023'],
      ['Sweden joined', '2024'],
    ]);
    for (const row of rows) {
      const raw = JSON.parse(row.milestones_json);
      expect(timelineOf(row).steps.map((s) => [s.detail, s.label]), row.id).toEqual(raw.reduce((acc, v2, i) => (i % 2 ? acc : [...acc, [v2, raw[i + 1]]]), []));
    }
  });

  it('marks the latest milestone as the one current step, and never more than one', () => {
    const steps = timelineOf(nato).steps;
    expect(steps.map((s) => !!s.now)).toEqual([false, false, true]);
    expect(steps.map((s) => !!s.done)).toEqual([true, true, false]);
    for (const row of rows) expect(timelineOf(row).steps.filter((s) => s.now).length, row.id).toBeLessThanOrEqual(1);
  });

  it('marks no current step when the milestones are not in date order', () => {
    const v = timelineOf(synthetic({ milestones: ['2010', 'Later thing', '2001', 'Earlier thing'] }));
    expect(v.steps.filter((s) => s.now)).toHaveLength(0);
    expect(v.steps).toHaveLength(2);
  });

  it('drops an unpaired trailing milestone rather than guess whether it is a date or an event', () => {
    const v = timelineOf(synthetic({ milestones: ['2001', 'Founded', '2005'] }));
    expect(v.steps.map((s) => s.label)).toEqual(['Founded']);
  });

  it('keeps steps with repeated wording distinct', () => {
    const v = timelineOf(synthetic({ milestones: ['2001', 'Summit held', '2005', 'Summit held'] }));
    expect(new Set(v.steps.map((s) => s.label)).size).toBe(2);
  });

  it('is omitted when the row holds no milestones', () => {
    expect(timelineOf(synthetic({ milestones: [] }))).toBeUndefined();
    expect(timelineOf(bare)).toBeUndefined();
  });

  it('says the dates are as listed and claims no pending accession', () => {
    const cap = timelineOf(nato).caption;
    expect(cap).toMatch(/as listed|as held/i);
    expect(cap).not.toMatch(/pending|forthcoming|expected/i);
  });
});

describe('02 about this bloc', () => {
  it('lists legal basis, structure, seat, formed and the institutional core, only when held', () => {
    const rowsOf = Object.fromEntries(model(nato).about.rows);
    expect(rowsOf).toMatchObject({
      'Legal basis': 'North Atlantic Treaty',
      Structure: 'Collective defence',
      Seat: 'Brussels, Belgium',
      Formed: '1949',
      'Decision rule': 'Consensus',
      Obligation: 'Article 5 collective defence',
      'Core purpose': 'Deterrence, defence, crisis management and cooperative security',
      Chair: 'Secretary General',
    });
    expect(model(nato).about.label).toMatch(/^02 · /);
    expect(model(bare).about.rows).toEqual([]);
    expect(Object.keys(Object.fromEntries(model(synthetic({ seat: '', chair: '' })).about.rows))).not.toContain('Seat');
  });

  it('carries the binding form only when the legal basis says what it is', () => {
    expect(Object.fromEntries(model(nato).about.rows)['Binding form']).toBe('Treaty / protocol');
    expect(Object.fromEntries(model(byId('sco')).about.rows)['Binding form']).toBe('Charter-based');
    // "Political declaration" is the library's fallback when nothing matches (the African Union's Constitutive Act, the G7's communiqués), not a finding.
    expect(Object.fromEntries(model(au).about.rows)).not.toHaveProperty('Binding form');
    expect(Object.fromEntries(model(byId('g7')).about.rows)).not.toHaveProperty('Binding form');
    expect(Object.fromEntries(model(bare).about.rows)).not.toHaveProperty('Binding form');
  });

  it('carries the agenda and the operating bodies', () => {
    const r = Object.fromEntries(model(nato).about.rows);
    expect(r.Agenda).toBe('Article 5 readiness · Eastern-flank force posture · Ukraine support and interoperability');
    expect(r['Bodies and instruments']).toBe('North Atlantic Council · Integrated Military Command Structure · Allied Command Operations');
  });

  it('lists every member as a chip', () => {
    for (const row of rows) expect(model(row).about.chips, row.id).toEqual(members(row));
    expect(model(bare).about.chips).toEqual([]);
  });

  it('adds the latest verified development and the next monitor item as cards', () => {
    const cards = model(nato).about.cards;
    expect(cards.map((c) => c.heading)).toEqual(['Latest verified development · 07 Mar 2024', 'Monitor next']);
    expect(cards[0].body).toBe("Sweden became NATO's 32nd member, completing the latest enlargement round.");
    expect(cards[1].body).toMatch(/^Track force-model/);
    expect(model(bare).about.cards).toEqual([]);
    expect(model(synthetic({ latestDate: '' })).about.cards[0].heading).toBe('Latest verified development');
  });
});

describe('03 bloc and what it touches', () => {
  it('uses the reference lanes, region on the left, the bloc, its member count, and no far node', () => {
    for (const row of ALL) {
      const t = model(row).touches;
      expect(t.lanes, row.title).toEqual(['REGION', 'BLOC', 'MEMBERS', 'FRONTS']);
      expect(t.nodes.far, `${row.title} holds no Open Fronts link`).toBeUndefined();
    }
    const t = model(nato).touches;
    expect(t.label).toMatch(/^03 · /);
    expect(t.nodes.left).toEqual({ l1: 'Transatlantic' });
    expect(t.nodes.center).toMatchObject({ code: 'A', l1: 'This bloc', l2: 'NATO' });
    expect(t.nodes.right).toEqual({ l1: '32 members', l2: 'on the roster' });
  });

  it('falls back to the seat for the left lane, and leaves a lane empty when the row holds nothing', () => {
    expect(model(synthetic({ region: '' })).touches.nodes.left).toEqual({ l1: 'Paris, France' });
    const b = model(bare).touches.nodes;
    expect(b.left).toBeUndefined();
    expect(b.right).toBeUndefined();
    expect(b.center).toBeTruthy();
  });

  it('links up to three blocs sharing the most members, as records that open in place', () => {
    const links = model(nato).touches.links;
    expect(links.length).toBeGreaterThan(0);
    expect(links.length).toBeLessThanOrEqual(3);
    const natoMembers = new Set(members(nato));
    let last = Infinity;
    for (const l of links) {
      expect(rows, l.title).toContain(l.row);
      expect(l.row.id).not.toBe('nato');
      const common = members(l.row).filter((m) => natoMembers.has(m)).length;
      expect(l.detail).toContain(`${common} common member`);
      expect(common).toBeLessThanOrEqual(last);
      last = common;
    }
    // The three largest overlaps, computed independently of the helper.
    const expected = rows
      .filter((r) => r.id !== 'nato')
      .map((r) => ({ id: r.id, n: members(r).filter((m) => natoMembers.has(m)).length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 3);
    expect(links.map((l) => l.row.id).sort()).toEqual(expected.map((x) => x.id).sort());
    expect(links.map((l) => Number(/^(\d+)/.exec(l.detail)[1]))).toEqual(expected.map((x) => x.n));
  });

  it('titles the link by the short name and gives the share of this roster', () => {
    const l = model(nato).touches.links.find((x) => x.row.id === 'eu');
    expect(l.title).toBe('EU');
    const n = members(eu).filter((m) => members(nato).includes(m)).length;
    expect(l.detail).toBe(`${n} common members · ${Math.round((n / 32) * 100)}% of this roster`);
    expect(model(quad).touches.links.every((x) => /^\d+ common members? · \d+% of this roster$/.test(x.detail))).toBe(true);
  });

  it('never links the selection to itself, nor to a copy of it', () => {
    const baseline = model(nato).touches.links.map((l) => [l.row.id, l.detail]);
    const copy = { ...nato };
    const noId = { ...nato, id: undefined, __alId: undefined };
    const renamed = { ...nato, id: 'nato-copy' }; // same name, different id
    for (const sel of [copy, noId, renamed]) {
      const links = model(sel).touches.links;
      expect(links.map((l) => [l.row.id, l.detail])).toEqual(baseline);
      for (const l of links) expect(l.row.name).not.toBe(nato.name);
    }
    // A context that holds the selection twice (the original and a copy) still counts it once, and never against itself.
    const dup = model(nato, ctx({ rows: [...rows, copy] })).touches.links;
    expect(dup.map((l) => [l.row.id, l.detail])).toEqual(baseline);
    // A lone bloc in the context has nothing in common with anything.
    expect(model(nato, ctx({ rows: [nato] })).touches.links).toEqual([]);
    expect(model(nato, ctx({ rows: [copy] })).touches.links).toEqual([]);
    expect(model(nato, { feed }).touches.links).toEqual([]);
  });

  it('titles are unique so each link keeps its own button', () => {
    for (const row of rows) {
      const titles = model(row).touches.links.map((l) => l.title);
      expect(new Set(titles).size, row.id).toBe(titles.length);
    }
  });
});

describe('footer and provenance', () => {
  it('asks about the alliance and names the register source with the verified date', () => {
    const f = model(nato).footer;
    expect(f.ask).toBe('Ask AI about this alliance');
    expect(f.provenance.source).toContain('NATO');
    expect(f.provenance.asOf).toBe('22 Aug 2026');
    expect(f.provenance.flags || []).not.toContain('as-of not on record');
  });

  it('falls back to the feed as-of, then to the explicit flag', () => {
    const noVerified = { ...nato, verified: '' };
    expect(model(noVerified).footer.provenance.asOf).toBe('22 Aug 2026'); // feed.meta.verified
    const viaCoverage = model(noVerified, { rows, feed: { coverage: { through: '2026-08-20' }, meta: {} } }).footer.provenance;
    expect(viaCoverage.asOf).toBe('20 Aug 2026');
    const none = model(noVerified, { rows, feed: { meta: {} } }).footer.provenance;
    expect(none.asOf).toBeFalsy();
    expect(none.flags).toContain('as-of not on record');
    expect(alliances(bare).footer.provenance.flags).toContain('as-of not on record');
    expect(model(bare).footer.provenance.asOf).toBe('22 Aug 2026'); // the feed's verified date covers a row with none
    expect(contractProblems(model(noVerified, { rows, feed: { meta: {} } }))).toEqual([]);
  });

  it('names a source even when the row has no source label', () => {
    expect(model(bare).footer.provenance.source).toMatch(/alliance/i);
    expect(model(synthetic({ sourceLabel: '' })).footer.provenance.source).toMatch(/alliance/i);
  });

  it('says this is an embedded register, not a live feed, and that standing is not a score', () => {
    const note = model(nato).footer.note;
    expect(note).toMatch(/not a live feed/i);
    expect(note).toMatch(/not a score|no score|not inferred/i);
  });
});
