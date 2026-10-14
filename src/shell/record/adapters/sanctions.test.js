import { describe, expect, it } from 'vitest';
import pack from '../../../data/sanctions.json';
import { flattenSanction, hydrateSanction, issuerTokens } from '../../../lib/sanctions.js';
import { countryPosition } from '../geoLookup.js';
import { contractProblems } from '../modelContract.js';
import sanctions from './sanctions.js';

/**
 * F121 batch 3, T17: Sanctions. Fixtures are the real programme register (src/data/sanctions.json,
 * 18 programmes) through the real flattenSanction, exactly as the feed serves them
 * (server/featureFeed.mjs). The register holds a programme, its issuing authorities as one text,
 * a map anchor, sectors, measures and sources. It holds no per-authority measure, no list date and
 * no listed party, and the panel must not imply any of them.
 */
const rows = pack.programs.map(flattenSanction);
const ctx = (extra = {}) => ({ rows, feed: { feature: 'Sanctions', meta: { asOf: pack.asOf, stats: pack.stats } }, ...extra });
const model = (row, c = ctx()) => sanctions(row, c);
const byId = (id) => rows.find((r) => r.id === id);

const ru = byId('ru');
const kp = byId('kp');
const cu = byId('cu');
const cyber = byId('cyber');
const magnitsky = byId('magnitsky');

/** A programme with every field set, as a future register edit might write it. */
const full = (extra = {}) => ({ ...ru, id: 'zz', title: 'Test programme', name: 'Test programme', ...extra });

function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

/** Every string of a model except a touch link's `row` (a record, not text) and register programme names (the title, and the title of a link that opens another programme). */
function shown(m) {
  const copy = { ...m, title: '', touches: m.touches && { ...m.touches, links: m.touches.links.map(({ row: _row, title: _title, ...l }) => l) } };
  return strings(copy);
}

const mapOf = (m) => m.glance.visual;
const targetPoint = (m) => mapOf(m)?.points.find((p) => p.main);
const issuerPoints = (m) => (mapOf(m)?.points || []).filter((p) => !p.main);

describe('fixtures are real flattenSanction output', () => {
  it('has 18 programmes with numeric map anchors, joined issuers and parsed sources', () => {
    expect(rows).toHaveLength(18);
    expect(ru).toMatchObject({ title: 'Russia — Ukraine-related', issuer: 'US OFAC · EU · UK · Canada · Japan · Australia', lat: 55.7, lon: 37.6, programme_status: 'active' });
    expect(JSON.parse(ru.sources_json)).toHaveLength(2);
    expect(ru.source_url).toBe('https://sanctionssearch.ofac.treas.gov/');
  });
});

describe('contract and hygiene', () => {
  it('honours the panel contract for all 18 programmes', () => {
    for (const row of rows) expect(contractProblems(model(row)), row.id).toEqual([]);
  });

  it('honours the contract when the context is missing or empty', () => {
    for (const row of rows) {
      expect(contractProblems(sanctions(row)), row.id).toEqual([]);
      expect(contractProblems(sanctions(row, { rows: [], feed: {} })), row.id).toEqual([]);
    }
  });

  it('honours the contract for a bare row', () => {
    expect(contractProblems(sanctions({}))).toEqual([]);
    expect(contractProblems(sanctions({ id: 'x' }, ctx()))).toEqual([]);
  });

  it('never renders a dash, bracket, undefined, NaN or null (the register\'s own programme name aside)', () => {
    for (const row of [...rows, {}, full({ lat: null, lon: null, sectors_json: '', trail_json: '' })]) {
      for (const s of shown(model(row))) expect(s, `${row.id} → ${s}`).not.toMatch(/—|\[|undefined|NaN|\bnull\b/);
    }
  });

  it('keeps the register\'s own programme name as the title, dash and all', () => {
    for (const row of rows) expect(model(row).title, row.id).toBe(row.title);
    expect(model(ru).title).toBe('Russia — Ukraine-related');
  });

  it('titles each related-programme link with that programme\'s register name', () => {
    for (const row of rows) for (const l of model(row).touches.links) expect(l.title, row.id).toBe(l.row.title);
  });

  it('does not mutate its input', () => {
    const before = JSON.stringify(rows);
    for (const row of rows) model(row);
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe('header, badge and links', () => {
  it('describes the programme by issuer and regime type', () => {
    expect(model(ru).meta).toEqual(['US OFAC · EU · UK · Canada · Japan · Australia', 'Multi-jurisdictional sectoral']);
    expect(model({}).meta).toEqual([]);
  });

  it('badges only a real status: active and escalating red, under review amber, anything else grey, none no badge', () => {
    expect(model(ru).badge).toEqual({ text: 'Active', tone: 'red' });
    expect(model(byId('houthi')).badge).toEqual({ text: 'Escalating', tone: 'red' });
    expect(model(byId('syria2')).badge).toEqual({ text: 'Under review', tone: 'amber' });
    expect(model(full({ programme_status: 'suspended', status: 'suspended' })).badge).toEqual({ text: 'Suspended', tone: 'grey' });
    expect(model(full({ programme_status: '', status: '' })).badge).toBeUndefined();
    expect(model({}).badge).toBeUndefined();
  });

  it('links every https source the row holds, under the label the row gives it', () => {
    expect(model(ru).links).toEqual([
      { label: 'OFAC SDN', href: 'https://sanctionssearch.ofac.treas.gov/' },
      { label: 'EU sanctions map', href: 'https://www.sanctionsmap.eu/' },
    ]);
    expect(model(cu).links).toHaveLength(1);
    for (const row of rows) for (const l of model(row).links) expect(l.href, row.id).toMatch(/^https:\/\//);
  });

  it('never links a source that is not https, and falls back to the row\'s source_url', () => {
    const http = full({ sources_json: JSON.stringify([['Plain', 'http://example.org/'], ['Secure', 'https://example.org/list']]), source_url: 'http://example.org/' });
    expect(model(http).links).toEqual([{ label: 'Secure', href: 'https://example.org/list' }]);
    const bare = full({ sources_json: '[]', source_url: 'https://example.org/only' });
    expect(model(bare).links).toEqual([{ label: 'Source record', href: 'https://example.org/only' }]);
    expect(model(full({ sources_json: '[]', source_url: 'javascript:alert(1)' })).links).toEqual([]);
  });
});

describe('01 at a glance: tiles', () => {
  it('carries the dossier KPIs: authorities, target, listed scope and sectors', () => {
    const t = model(ru).glance.tiles;
    expect(t.map((x) => x.label)).toEqual(['Authorities', 'Target', 'Listed scope', 'Sectors']);
    expect(t.map((x) => x.value)).toEqual(['6', 'Russian Federation', '6,300+ individuals & entities', '4']);
    expect(t[3].sub).toBe('Energy & oil price cap · Finance (SWIFT cutoff)');
  });

  it('counts the same issuers as the dossier did (issuerTokens) for every programme', () => {
    for (const row of rows) {
      const proven = issuerTokens(hydrateSanction(row)).length;
      expect(model(row).glance.tiles[0].value, row.id).toBe(String(proven));
    }
  });

  it('counts sectors as the dossier did, for every programme', () => {
    for (const row of rows) expect(model(row).glance.tiles.find((t) => t.label === 'Sectors').value, row.id).toBe(String(JSON.parse(row.sectors_json).length));
  });

  it('always has 2–4 tiles, and reads a bare row as Not on record', () => {
    for (const row of rows) expect(model(row).glance.tiles.length, row.id).toBeGreaterThanOrEqual(2);
    const bare = model({}).glance.tiles;
    expect(bare.map((t) => [t.label, t.value])).toEqual([['Authorities', 'Not on record'], ['Target', 'Not on record']]);
  });

  it('omits listed scope and sectors when the row holds none', () => {
    const t = model(full({ entities: '', listed_scope: '', sectors_json: '[]' })).glance.tiles;
    expect(t.map((x) => x.label)).toEqual(['Authorities', 'Target']);
  });
});

describe('Who listed whom (map)', () => {
  it('places the target at the register\'s anchor position, as the main marker, marked approximate', () => {
    for (const row of rows) {
      const p = targetPoint(model(row));
      expect(p, row.id).toBeDefined();
      expect(p.lat, row.id).toBe(row.lat);
      expect(p.lon, row.id).toBe(row.lon);
      expect(p.approximate, row.id).toBe(true); // register anchors, not surveyed locations
      expect(p.tone).toBe('red');
    }
    expect(targetPoint(model(ru)).label).toBe('Target: Russian Federation');
  });

  it('places the issuing states at approximate country centres, labelled as the register names them', () => {
    const pts = issuerPoints(model(ru));
    expect(pts.map((p) => p.label)).toEqual(['US OFAC', 'UK', 'Canada', 'Japan', 'Australia']);
    expect(pts[0]).toMatchObject({ ...countryPosition('United States'), approximate: true, tone: 'blue' });
    expect(pts[1]).toMatchObject({ ...countryPosition('United Kingdom'), approximate: true });
    expect(pts.every((p) => p.approximate && !p.main)).toBe(true);
    expect(issuerPoints(model(kp)).map((p) => p.label)).toEqual(['US', 'Japan', 'S. Korea']);
    expect(issuerPoints(model(kp))[2]).toMatchObject(countryPosition('South Korea'));
  });

  it('leaves the EU and the UN off the map and says so in the caption, never guessing a position', () => {
    const m = model(ru);
    expect(mapOf(m).points.map((p) => p.label)).not.toContain('EU');
    expect(mapOf(m).caption).toMatch(/not placed on the map/i);
    expect(mapOf(m).caption).toContain('EU');
    const k = model(kp);
    expect(k.glance.visual.points.map((p) => p.label).join()).not.toMatch(/UN|EU/);
    expect(k.glance.visual.caption).toContain('UN Security Council, EU');
  });

  it('does not read "AUS" as the United States: it places Australia, once, beside the real US', () => {
    const pts = issuerPoints(model(cyber));
    expect(pts.map((p) => p.label)).toEqual(['US', 'UK', 'AUS']);
    expect(pts[2]).toMatchObject(countryPosition('Australia'));
    expect(pts[0]).toMatchObject(countryPosition('United States'));
  });

  it('never puts two markers on one country', () => {
    const m = model(full({ issuer: 'US OFAC · US (FTO/SDGT) · UK' }));
    expect(issuerPoints(m).map((p) => p.label)).toEqual(['US OFAC', 'UK']);
  });

  it('draws a target only for two finite, in-range coordinates; (0, 0) is not a position', () => {
    for (const [lat, lon] of [[null, null], [undefined, undefined], ['', ''], [0, 0], ['0', '0'], [NaN, 10], [91, 10], [10, 181], [-91, 0], ['abc', '10'], [10, null], [null, 10], [true, false], ['1e2', '1']]) {
      expect(targetPoint(model(full({ lat, lon }))), JSON.stringify([lat, lon])).toBeUndefined();
    }
    expect(targetPoint(model(full({ lat: '55.7', lon: '37.6' })))).toMatchObject({ lat: 55.7, lon: 37.6, main: true });
    expect(targetPoint(model(full({ lat: 0, lon: 37.6 })))).toMatchObject({ lat: 0, lon: 37.6 });
    expect(targetPoint(model(full({ lat: -90, lon: -180 })))).toMatchObject({ lat: -90, lon: -180 });
  });

  it('keeps the issuers and says the register holds no target position when it holds none', () => {
    const m = model(full({ lat: null, lon: null }));
    expect(targetPoint(m)).toBeUndefined();
    expect(issuerPoints(m)).toHaveLength(5);
    expect(m.glance.visual.caption).toMatch(/no position for the target/i);
    expect(contractProblems(m)).toEqual([]);
  });

  it('has no map when nothing can be placed', () => {
    expect(model({}).glance.visual).toBeUndefined();
    expect(model(full({ lat: null, lon: null, issuer: 'EU · UN' })).glance.visual).toBeUndefined();
  });

  it('says a thematic or network programme\'s marker is an anchor, not the target\'s location', () => {
    expect(mapOf(model(magnitsky)).caption).toMatch(/anchor, not a location/i);
    expect(mapOf(model(cyber)).caption).toMatch(/anchor, not a location/i);
    expect(mapOf(model(ru)).caption).not.toMatch(/anchor/i);
    expect(mapOf(model(cu)).caption).not.toMatch(/anchor/i);
  });

  it('counts authorities and targets in the header of the map', () => {
    expect(mapOf(model(ru)).right).toBe('6 authorities · 1 target');
    expect(mapOf(model(cu)).right).toBe('1 authority · 1 target');
    expect(mapOf(model(full({ lat: null, lon: null }))).right).toBe('6 authorities');
  });

  it('states no arc, no effectiveness and no sanctioned-party claim', () => {
    for (const row of rows) for (const s of strings(mapOf(model(row)))) expect(s, row.id).not.toMatch(/effective|arc\b|has listed|is listed/i);
  });
});

describe('Issuing authorities (board)', () => {
  it('has one row per named authority, labelled as the register names it, with unique labels', () => {
    for (const row of rows) {
      const b = model(row).glance.visual2;
      expect(b.type, row.id).toBe('board');
      const labels = b.rows.map((r) => r.label);
      expect(new Set(labels).size, row.id).toBe(labels.length);
      expect(labels, row.id).toEqual(row.issuer.split('·').map((s) => s.trim()));
    }
    expect(model(ru).glance.visual2.right).toBe('6 authorities');
  });

  it('shows only what is held: each authority is a named issuer, and none is given a measure, status or date', () => {
    for (const row of rows) {
      for (const r of model(row).glance.visual2.rows) {
        expect(r.value, `${row.id} ${r.label}`).toBe('Named issuer');
        expect(r.tone).toBeUndefined();
      }
    }
  });

  it('marks the authorities the map cannot place', () => {
    const rowsOf = model(ru).glance.visual2.rows;
    expect(rowsOf.find((r) => r.label === 'EU').note).toBe('not on the map');
    expect(rowsOf.find((r) => r.label === 'US OFAC').note).toBeUndefined();
  });

  it('explains that the measures belong to the programme, not to any one authority', () => {
    expect(model(ru).glance.visual2.caption).toMatch(/does not say which authority/i);
  });

  it('merges a repeated authority into one row', () => {
    const rowsOf = model(full({ issuer: 'US · EU · US' })).glance.visual2.rows;
    expect(rowsOf.map((r) => r.label)).toEqual(['US', 'EU']);
    expect(model(full({ issuer: 'US · EU · US' })).glance.tiles[0].value).toBe('2');
  });

  it('has no board and no authorities tile value when the row names no issuer', () => {
    expect(model(full({ issuer: '' })).glance.visual2).toBeUndefined();
    expect(model(full({ issuer: '' })).glance.tiles[0]).toMatchObject({ label: 'Authorities', value: 'Not on record' });
  });
});

describe('callout', () => {
  it('says this is a programme record, not a screening result', () => {
    const c = model(ru).glance.callout;
    expect(c.tone).toBe('red');
    expect(c.text).toMatch(/not a screening result/i);
    expect(c.text).toMatch(/named party is listed/i);
    for (const row of rows) expect(model(row).glance.callout, row.id).toBeDefined();
  });
});

describe('02 about', () => {
  it('lists objective, legal basis, region and sectors, only where held', () => {
    const m = model(ru);
    expect(m.about.label).toBe('02 · About this programme');
    expect(m.about.rows).toEqual([
      ['Policy objective', 'Full-scale invasion of Ukraine (2022–)'],
      ['Legal basis', 'Issuer-specific laws, executive orders and EU regulations'],
      ['Region', 'Eastern Europe'],
      ['Sectors', 'Energy & oil price cap · Finance (SWIFT cutoff) · Defence & dual-use · Shadow fleet'],
    ]);
    expect(model({}).about.rows).toEqual([]);
  });

  it('carries the measures, exceptions, monitor list and trail as cards, in the register\'s words', () => {
    const cards = model(ru).about.cards;
    expect(cards.map((c) => c.heading)).toEqual(['Measures on record', 'Licences and exceptions', 'Monitor now', 'Trail on record']);
    expect(cards[0].body).toBe('Asset freezes and transaction bans; Export controls on defence and dual-use goods; Energy services restrictions and oil price cap; Transport and shadow-fleet designations');
    expect(cards[1].body).toBe('Food, medicine and humanitarian licences; Issuer-specific wind-down and general licences');
    expect(cards[2].body).toMatch(/^Shadow-fleet shipping \(Observed\): Ownership opacity/);
    expect(cards[2].body).toMatch(/evidence categories, not a score/i);
    expect(cards[3].body).toBe('2014: Ukraine-related programmes established and expanded; 2022: Measures broadened across finance, energy, technology and transport; Current record: Enforcement concentrates on circumvention networks and maritime services');
  });

  it('has unique card headings and no card for a section the row does not hold', () => {
    for (const row of rows) {
      const heads = model(row).about.cards.map((c) => c.heading);
      expect(new Set(heads).size, row.id).toBe(heads.length);
    }
    expect(model({}).about.cards || []).toEqual([]);
    const m = model(full({ instruments_json: '[]', exemptions_json: '', watch_json: 'not json', trail_json: '[]' }));
    expect(m.about.cards || []).toEqual([]);
  });
});

describe('03 what it touches', () => {
  it('uses the four sanctions lanes, with a programme centre node coded S', () => {
    for (const row of rows) {
      const t = model(row).touches;
      expect(t.lanes, row.id).toEqual(['AUTHORITY', 'PROGRAMME', 'SECTORS', 'ENTITIES']);
      expect(t.nodes.center, row.id).toMatchObject({ code: 'S', l1: 'This programme' });
    }
    expect(model(ru).touches.nodes.center.l2).toBe('Active');
  });

  it('puts the issuer left: a count of authorities, or the one authority by name', () => {
    expect(model(ru).touches.nodes.left).toEqual({ l1: '6 issuing', l2: 'authorities' });
    expect(model(cu).touches.nodes.left).toEqual({ l1: 'US (OFAC)' });
    expect(model({}).touches.nodes.left).toBeUndefined();
  });

  it('puts the sectors right: the sector, or the count with the first', () => {
    expect(model(ru).touches.nodes.right).toEqual({ l1: '4 sectors', l2: 'Energy & oil price cap' });
    expect(model(byId('zw')).touches.nodes.right).toEqual({ l1: 'Targeted (individuals)' });
    expect(model(full({ sectors_json: '[]' })).touches.nodes.right).toBeUndefined();
  });

  it('puts the register\'s listed scope far, and omits it when the row holds none', () => {
    expect(model(ru).touches.nodes.far).toEqual({ l1: '6,300+ individuals & entities', l2: 'listed scope' });
    expect(model(full({ entities: '', listed_scope: '' })).touches.nodes.far).toBeUndefined();
    expect(model({}).touches.nodes.far).toBeUndefined();
  });

  it('opens each other programme in the same register region in place, never the selection', () => {
    const links = model(byId('ir')).touches.links;
    expect(links.map((l) => l.title)).toEqual(['Houthis (Ansar Allah)', 'Hamas / PIJ / Hezbollah', 'Syria (post-Assad review)']);
    for (const l of links) {
      expect(l.detail).toBe('Also in Middle East');
      expect(rows).toContain(l.row);
      expect(l.row.id).not.toBe('ir');
      expect(l.to).toBeUndefined();
    }
  });

  it('excludes the selection when it is a copy of its feed row, even a changed one', () => {
    const copy = { ...byId('ir') };
    expect(rows.includes(copy)).toBe(false);
    expect(model(copy).touches.links.map((l) => l.row.id)).toEqual(['houthi', 'hamas', 'syria2']);
    const edited = { ...byId('ir'), title: 'Iran (edited)', name: 'Iran (edited)' };
    expect(model(edited).touches.links.map((l) => l.row.id)).toEqual(['houthi', 'hamas', 'syria2']);
    expect(model(byId('by')).touches.links.map((l) => l.row.id)).toEqual(['ru']);
  });

  it('has no cross-link when no other programme shares the region, and none for a blank region', () => {
    expect(model(full({ id: 'solo', region: 'Atlantis' })).touches.links).toEqual([]);
    const blank = [{ ...ru, region: '' }, { ...ru, id: 'b', title: 'B', region: '' }];
    expect(model(blank[0], ctx({ rows: blank })).touches.links).toEqual([]);
    expect(model(ru, { rows: undefined }).touches.links).toEqual([]);
  });

  it('shows at most three related programmes', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ ...ru, id, title: `P ${id}`, name: `P ${id}` }));
    expect(model(many[0], ctx({ rows: many })).touches.links).toHaveLength(3);
  });

  it('lists a programme once when the register names two rows alike', () => {
    const twins = [ru, { ...byId('by') }, { ...byId('by'), id: 'by2' }];
    expect(model(ru, ctx({ rows: twins })).touches.links.map((l) => l.title)).toEqual(['Belarus']);
  });

  it('gives every link a unique title', () => {
    for (const row of rows) {
      const titles = model(row).touches.links.map((l) => l.title);
      expect(new Set(titles).size, row.id).toBe(titles.length);
    }
  });
});

describe('footer and provenance', () => {
  it('offers Ask AI about this programme', () => {
    for (const row of rows) expect(model(row).footer.ask).toBe('Ask AI about this programme');
  });

  it('names the platform\'s register as the source, with the feed\'s as-of date', () => {
    const p = model(ru).footer.provenance;
    expect(p.source).toBe('Sanctions programme register (stored on the platform)');
    expect(p.asOf).toBe('Jul 2026');
    expect(p.flags).toEqual(['issuing lists not read']);
  });

  it('flags a missing as-of rather than inventing one', () => {
    for (const c of [{ rows }, { rows, feed: {} }, { rows, feed: { meta: {} } }, { rows, feed: { meta: { asOf: 'soon' } } }, undefined]) {
      const p = sanctions(ru, c).footer.provenance;
      expect(p.asOf, JSON.stringify(c && Object.keys(c))).toBeUndefined();
      expect(p.flags).toContain('as-of not on record');
      expect(contractProblems(sanctions(ru, c))).toEqual([]);
    }
  });

  it('names the linked lists as references the panel does not read, and shows no official-list claim', () => {
    const note = model(ru).footer.note;
    expect(note).toContain('as of Jul 2026');
    expect(note).toContain('Linked for reference: OFAC SDN, EU sanctions map');
    expect(note).toMatch(/does not read any issuing authority's list/i);
    for (const row of rows) {
      for (const s of strings(model(row).footer)) expect(s, row.id).not.toMatch(/verified against|official list|confirmed by|checked against/i);
    }
  });

  it('says so when the record links no list at all', () => {
    const m = model(full({ sources_json: '[]', source_url: '' }));
    expect(m.links).toEqual([]);
    expect(m.footer.provenance.flags).toContain('no issuing list linked');
    expect(m.footer.note).not.toMatch(/Linked for reference/);
  });
});
