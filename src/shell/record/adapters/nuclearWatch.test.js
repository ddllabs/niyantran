import { describe, expect, it } from 'vitest';
import pack from '../../../data/nuclear-watch.json';
import { flattenNuclear } from '../../../lib/strategicAssets.js';
import { contractProblems } from '../modelContract.js';
import nuclearWatch from './nuclearWatch.js';

/**
 * F121 batch 3, T19: Nuclear Watch (the embedded public-source facility register).
 *
 * Fixtures are the real pack (src/data/nuclear-watch.json, 112 records) through the real
 * flattenNuclear, which is exactly what the feed serves (server/featureFeed.mjs). The pack holds no
 * front, no coordinates of anything but the facility, and a precision label per record; the panel
 * must say only what those fields say.
 */
const rows = pack.facilities.map(flattenNuclear);
const ctx = (extra = {}) => ({ rows, feed: { ok: true, feature: 'Nuclear Watch', meta: { asOf: pack.asOf, strip: pack.strip, arsenal: pack.arsenal } }, ...extra });
const model = (row, c = ctx()) => nuclearWatch(row, c);
const byId = (id) => rows.find((r) => r.id === id);

const zap = byId('zaporizhzhia'); // exact, suspended, Ukraine (four records)
const natanz = byId('natanz'); // approximate area
const reserve = byId('kaz-reserve'); // country centroid, not a facility
const rivne = byId('rivnenska');
const navoi = byId('navoi'); // regional centroid
const APPROX = /approximate|regional|country|city-level/i;

function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => { if (k !== 'row') strings(v, out); });
  return out;
}

describe('Nuclear Watch adapter: fixtures', () => {
  it('are the 112 real flattenNuclear rows, with no front field and a precision label each', () => {
    expect(rows).toHaveLength(112);
    expect(zap).toMatchObject({ name: 'Zaporizhzhia Nuclear Power Plant', country: 'Ukraine', status: 'Suspended operation', lat: 47.506, lon: 34.585, checked: '24 Aug 2026', source_label: 'IAEA PRIS' });
    for (const r of rows) {
      expect(r.precision, r.id).toBeTruthy();
      expect(r.front, r.id).toBeUndefined();
    }
  });

  it('honours the panel contract for every row, with and without feed context', () => {
    for (const row of rows) {
      expect(contractProblems(model(row)), row.id).toEqual([]);
      expect(contractProblems(nuclearWatch(row)), row.id).toEqual([]);
    }
    expect(contractProblems(nuclearWatch({}))).toEqual([]);
  });

  it('never shows a dash placeholder, a bracket, undefined, NaN or null', () => {
    for (const row of [...rows, {}]) {
      for (const s of strings(model(row))) expect(s, `${row.id} → ${s}`).not.toMatch(/—|\[|undefined|NaN|^\s*null\s*$/);
    }
  });

  it('writes no claim of its own about radiation, incidents or military activity (its own prose: captions, notes, headings)', () => {
    const risky = /radiation|contaminat|leak|incident|accident|attack|strike|shell(ing|ed)|military|weapon|warhead|proliferat/i;
    for (const row of rows) {
      const m = model(row);
      const own = [m.glance.visual?.caption, m.footer.note, ...m.about.cards.map((c) => c.heading), ...m.touches.links.map((l) => l.title)];
      for (const s of own.filter(Boolean)) {
        const fromRow = strings(row).some((r) => s.includes(r));
        if (!fromRow) expect(s, `${row.id} → ${s}`).not.toMatch(risky);
      }
    }
  });
});

describe('header, badge and links', () => {
  it('names the facility, its class and its country', () => {
    const m = model(zap);
    expect(m.title).toBe('Zaporizhzhia Nuclear Power Plant');
    expect(m.meta).toEqual(['Power reactor site', 'Ukraine']);
    expect(model({}).title).toBe('Facility');
    expect(model({}).meta).toEqual([]);
  });

  it('badges the recorded status, toned: suspended red, disputed amber, plain operating green, qualified operating blue, building amber, others grey', () => {
    expect(model(zap).badge).toEqual({ text: 'Suspended operation', tone: 'red' });
    expect(model(rivne).badge).toEqual({ text: 'Operating', tone: 'green' });
    expect(model(natanz).badge).toEqual({ text: 'Operating / monitored', tone: 'blue' });
    const tone = (status) => model({ ...rivne, status }).badge;
    expect(tone('Operating status disputed')).toEqual({ text: 'Operating status disputed', tone: 'amber' });
    expect(tone('Under construction')).toEqual({ text: 'Under construction', tone: 'amber' });
    expect(tone('Commissioning / licensing')).toEqual({ text: 'Commissioning / licensing', tone: 'amber' });
    expect(tone('Publicly reported')).toEqual({ text: 'Publicly reported', tone: 'grey' });
    expect(tone('Decommissioning')).toEqual({ text: 'Decommissioning', tone: 'grey' });
    expect(tone('Decommissioning / waste management').tone).toBe('grey');
    expect(model(reserve).badge).toEqual({ text: 'Resource reserve', tone: 'grey' });
    expect(model({ ...rivne, status: '' }).badge).toBeUndefined();
  });

  it('links the register source over https only, labelled with the source', () => {
    expect(model(zap).links).toEqual([{ label: 'IAEA PRIS', href: 'https://pris.iaea.org/pris/' }]);
    expect(model({ ...zap, source_url: 'http://insecure.example/x' }).links).toEqual([]);
    expect(model({ ...zap, source_label: '' }).links[0].label).toBe('Source record');
  });
});

describe('01 at a glance', () => {
  it('leads with status, class, capacity and checked, in that order, for every row', () => {
    for (const row of rows) expect(model(row).glance.tiles.map((t) => t.label), row.id).toEqual(['Status', 'Class', 'Capacity', 'Checked']);
  });

  it('states each held field and what it was checked against', () => {
    const t = model(zap).glance.tiles;
    expect(t[0]).toMatchObject({ value: 'Suspended operation', tone: 'red' });
    expect(t[1].value).toBe('Power reactor site');
    expect(t[2].value).toBe('6 × VVER-1000; 5.7 GWe net reference');
    expect(t[3]).toMatchObject({ value: '24 Aug 2026', sub: 'against IAEA PRIS' });
  });

  it('leaves the status tile untoned when the badge is grey', () => {
    expect(model(reserve).glance.tiles[0].tone).toBeUndefined();
    expect(model(rivne).glance.tiles[0].tone).toBe('green');
  });

  it('reads an absent value as Not on record', () => {
    expect(model({}).glance.tiles.map((t) => t.value)).toEqual(['Not on record', 'Not on record', 'Not on record', 'Not on record']);
  });

  it('carries the owner reference callout: status is the public record, not an assessment', () => {
    const c = model(zap).glance.callout;
    expect(c.tone).toBe('amber');
    expect(c.text).toMatch(/what the public record says/);
    expect(c.text).toMatch(/not an assessment of safety/);
  });
});

describe('facility map', () => {
  it('places an exact-precision facility at its own coordinates as a main marker, not approximate', () => {
    const v = model(zap).glance.visual;
    expect(v.type).toBe('map');
    expect(v.title).toBe('Facility on the map');
    expect(v.points).toHaveLength(1);
    expect(v.points[0]).toMatchObject({ lat: 47.506, lon: 34.585, label: 'Zaporizhzhia Nuclear Power Plant', main: true });
    expect('approximate' in v.points[0]).toBe(false);
    expect(v.caption).toContain('Exact public site centroid');
    expect(v.caption).not.toMatch(/approximate/i);
  });

  it('marks every record whose precision says approximate, regional, city-level or country as approximate, and says so', () => {
    let approx = 0;
    for (const row of rows) {
      const p = model(row).glance.visual.points[0];
      if (APPROX.test(row.precision)) {
        approx += 1;
        expect(p.approximate, row.id).toBe(true);
        expect(model(row).glance.visual.caption, row.id).toMatch(/approximate/i);
        expect(model(row).glance.visual.caption, row.id).toContain(row.precision);
      } else {
        expect('approximate' in p, row.id).toBe(false);
      }
      expect(p, row.id).toMatchObject({ lat: row.lat, lon: row.lon, main: true });
    }
    expect(approx).toBe(rows.filter((r) => APPROX.test(r.precision)).length);
    expect(approx).toBeGreaterThanOrEqual(15);
  });

  it('says a country centroid is not a facility', () => {
    const v = model(reserve).glance.visual;
    expect(v.points[0].approximate).toBe(true);
    expect(v.caption).toMatch(/country centre/i);
    expect(v.caption).toMatch(/not a facility/i);
    expect(model(natanz).glance.visual.caption).not.toMatch(/not a facility/i);
    expect(model(navoi).glance.visual.points[0].approximate).toBe(true);
  });

  it('treats a record with no precision label as approximate, because the register does not vouch for it', () => {
    const v = model({ ...zap, precision: '' }).glance.visual;
    expect(v.points[0].approximate).toBe(true);
    expect(v.caption).toMatch(/does not state/i);
  });

  it('accepts numeric-string coordinates and zero on one axis', () => {
    expect(model({ ...zap, lat: '47.5', lon: '34.5' }).glance.visual.points[0]).toMatchObject({ lat: 47.5, lon: 34.5 });
    expect(model({ ...zap, lat: 0, lon: 34.5 }).glance.visual.points[0]).toMatchObject({ lat: 0, lon: 34.5 });
  });

  it('has no map when the coordinates are missing, null, blank, partial, non-numeric, out of range, or exactly 0, 0', () => {
    const bad = [[undefined, undefined], [null, null], ['', ''], [' ', ' '], [47.5, undefined], [undefined, 34.5], ['47.5', null], ['north', 'east'], [NaN, NaN], [Infinity, 10], [91, 10], [10, 181], [0, 0], ['0', '0'], [true, false], [[], {}]];
    for (const [lat, lon] of bad) expect(model({ ...zap, lat, lon }).glance.visual, `${String(lat)}, ${String(lon)}`).toBeUndefined();
  });

  it('adds no front marker and no second visual, because no row holds a front or its position', () => {
    for (const row of rows) {
      expect(model(row).glance.visual.points, row.id).toHaveLength(1);
      expect(model(row).glance.visual2, row.id).toBeUndefined();
    }
  });
});

describe('02 about', () => {
  it('lists operator, class, scope, capacity, material, safeguards, region and the position, where present', () => {
    const m = model(zap);
    expect(m.about.label).toBe('02 · About this facility');
    expect(m.about.rows).toEqual([
      ['Operator', 'Energoatom'],
      ['Facility class', 'Power reactor site'],
      ['Scope', '6 reactor units'],
      ['Capacity', '6 × VVER-1000; 5.7 GWe net reference'],
      ['Material / activity', 'Low-enriched uranium fuel; spent fuel storage'],
      ['Safeguards / oversight', 'IAEA safeguards and continuing monitoring'],
      ['Region', 'Europe'],
      ['Position', 'Exact public site centroid · 47.5060, 34.5850'],
    ]);
    expect(model({}).about.rows).toEqual([]);
  });

  it('rounds approximate and country-level positions to two decimals, as the old site map did', () => {
    expect(model(natanz).about.rows.find(([k]) => k === 'Position')[1]).toBe('Public approximate facility area · 33.72, 51.73');
    expect(model(reserve).about.rows.find(([k]) => k === 'Position')[1]).toBe('Country centroid · not a facility · 48.02, 66.92');
  });

  it('omits the position coordinates when the record holds none, keeping the precision label', () => {
    expect(model({ ...zap, lat: null, lon: null }).about.rows.find(([k]) => k === 'Position')[1]).toBe('Exact public site centroid');
  });

  it('shows the latest public record and the role as cards, only when present', () => {
    const cards = model(zap).about.cards;
    expect(cards[0]).toEqual({ heading: 'Latest public record · checked 24 Aug 2026', body: zap.latest });
    expect(cards[1]).toEqual({ heading: 'Role in the register', body: zap.role });
    expect(model({ ...zap, latest: '', role: '' }).about.cards).toEqual([]);
    expect(model({ ...zap, checked: '' }).about.cards[0].heading).toBe('Latest public record');
  });

  it('says a country-level record is not a facility, and only for those', () => {
    const cards = model(reserve).about.cards;
    expect(cards[0].body).toMatch(/country-level uranium resource record, not a facility/i);
    for (const row of rows.filter((r) => !/country centroid/i.test(r.precision))) {
      expect(model(row).about.cards.map((c) => c.body).join(' '), row.id).not.toMatch(/not a facility\. /i);
    }
  });

  it('names a country-level record a record, not a facility', () => {
    expect(model(reserve).about.label).toBe('02 · About this record');
    expect(model(reserve).footer.ask).toBe('Ask AI about this record');
    expect(model(zap).footer.ask).toBe('Ask AI about this facility');
  });
});

describe('03 what it touches', () => {
  it('uses the four Nuclear Watch lanes with a facility centre node', () => {
    for (const row of rows) {
      const t = model(row).touches;
      expect(t.lanes, row.id).toEqual(['COUNTRY', 'FACILITY', 'FRONT', 'OPERATOR']);
      expect(t.nodes.center, row.id).toMatchObject({ code: 'N', l1: /country centroid/i.test(row.precision) ? 'This record' : 'This site' });
    }
    expect(model(zap).touches.nodes.center.l2).toBe('Suspended operation');
    expect(model(reserve).touches.nodes.center.l1).toBe('This record');
  });

  it('puts the country left and the operator far', () => {
    const n = model(zap).touches.nodes;
    expect(n.left).toEqual({ l1: 'Ukraine' });
    expect(n.far).toEqual({ l1: 'Energoatom', l2: 'operator' });
  });

  it('falls back to the capacity far when there is no operator, and omits far when neither exists', () => {
    expect(model({ ...zap, operator: '', operators: '' }).touches.nodes.far).toEqual({ l1: '6 × VVER-1000; 5.7 GWe net reference', l2: 'capacity' });
    expect(model({ ...zap, operator: '', operators: '', capacity: '' }).touches.nodes.far).toBeUndefined();
  });

  it('draws no front for any real record: none holds one, so the lane reads None on record', () => {
    for (const row of rows) expect(model(row).touches.nodes.right, row.id).toBeUndefined();
  });

  it('names a front only when the row names one', () => {
    expect(model({ ...zap, front: 'Russia–Ukraine front' }).touches.nodes.right).toEqual({ l1: 'Russia–Ukraine front' });
    expect(model({ ...zap, front: '  ' }).touches.nodes.right).toBeUndefined();
  });

  it('omits the country node when the row has no country', () => {
    expect(model({ ...zap, country: '' }).touches.nodes.left).toBeUndefined();
  });

  it('opens up to three other records in the same country, in place, never the selection', () => {
    const links = model(zap).touches.links.filter((l) => l.row);
    expect(links).toHaveLength(3);
    for (const l of links) {
      expect(l.row.country).toBe('Ukraine');
      expect(l.row.id).not.toBe('zaporizhzhia');
      expect(l.title).toBe(l.row.name);
      expect(l.detail).toBe(`${l.row.facility_kind} · ${l.row.status}`);
      expect(l.to).toBeUndefined();
    }
    expect(links.map((l) => l.row.id)).toEqual(['rivnenska', 'south-ukraine', 'chernobyl']);
  });

  it('caps the facility links at three in a country with more', () => {
    const us = rows.filter((r) => r.country === 'United States');
    expect(us.length).toBeGreaterThan(4);
    const m = model(us[0]);
    expect(m.touches.links.filter((l) => l.row)).toHaveLength(3);
    expect(m.touches.links[0].detail).toBe(`${us.length - 1} more on the register`);
  });

  it('hands over the very row objects of ctx.rows, so the panel can select them', () => {
    for (const l of model(zap).touches.links.filter((x) => x.row)) expect(rows).toContain(l.row);
  });

  it('lists real facilities before country-level records, whatever the feed order', () => {
    const reordered = [byId('ol3-reserve'), ...rows.filter((r) => r.id !== 'ol3-reserve')];
    const ids = model(byId('olympic-dam'), { rows: reordered }).touches.links.filter((l) => l.row).map((l) => l.row.id);
    expect(ids).toEqual(['ranger', 'opal', 'ol3-reserve']);
  });

  it('counts the other records in the country, excluding the selection', () => {
    const inUkraine = rows.filter((r) => r.country === 'Ukraine').length;
    expect(inUkraine).toBe(4);
    const links = model(zap).touches.links;
    expect(links[0]).toEqual({ title: 'Records in Ukraine', detail: '3 more on the register' });
    expect(links.filter((l) => l.row)).toHaveLength(3);
  });

  it('does not count or link the selection when it is a copy of its feed row', () => {
    const copy = { ...zap };
    const m = model(copy);
    expect(m.touches.links[0].detail).toBe('3 more on the register');
    expect(m.touches.links.filter((l) => l.row).map((l) => l.row.id)).not.toContain('zaporizhzhia');
    expect(m.touches.links.filter((l) => l.row)).toEqual(model(zap).touches.links.filter((l) => l.row));
  });

  it('counts the same class too, excluding the selection', () => {
    const same = rows.filter((r) => r.facility_kind === zap.facility_kind).length - 1;
    expect(model(zap).touches.links.at(-1)).toEqual({ title: `Same class: ${zap.facility_kind}`, detail: `${same} more on the register` });
    expect(model({ ...zap }).touches.links.at(-1).detail).toBe(`${same} more on the register`);
  });

  it('has no cross-links when the context is missing or empty, or the country is unique', () => {
    expect(model(zap, { rows: undefined, feed: undefined }).touches.links).toEqual([]);
    expect(model(zap, { rows: [], feed: {} }).touches.links).toEqual([]);
    expect(model(zap, { rows: [zap] }).touches.links).toEqual([]);
    expect(model({ ...zap }, { rows: [zap] }).touches.links).toEqual([]);
    const lone = rows.find((r) => rows.filter((x) => x.country === r.country).length === 1);
    expect(model(lone).touches.links.filter((l) => l.row || /^Records in/.test(l.title))).toEqual([]);
  });
});

describe('footer and provenance', () => {
  it('names the source the record was checked against and the date it was checked', () => {
    const p = model(zap).footer.provenance;
    expect(p.source).toBe('IAEA PRIS');
    expect(p.asOf).toBe('24 Aug 2026');
    expect(p.flags || []).not.toContain('as-of not on record');
    for (const row of rows) expect(model(row).footer.provenance.source, row.id).toBe(row.source_label);
  });

  it('falls back to the register as-of from the feed, then to the no-as-of flag', () => {
    const noChecked = { ...zap, checked: '' };
    expect(model(noChecked).footer.provenance.asOf).toBe('24 Aug 2026');
    const p = model(noChecked, { rows, feed: {} }).footer.provenance;
    expect(p.asOf || '').toBe('');
    expect(p.flags).toContain('as-of not on record');
    expect(model(noChecked, {}).footer.provenance.flags).toContain('as-of not on record');
  });

  it('reads an ISO checked date and ignores a checked value that is not a date', () => {
    expect(model({ ...zap, checked: '2026-08-24' }).footer.provenance.asOf).toBe('24 Aug 2026');
    expect(model({ ...zap, checked: '5 Sep 2026' }).footer.provenance.asOf).toBe('05 Sep 2026');
    expect(model({ ...zap, checked: 'soon' }, { rows, feed: {} }).footer.provenance.flags).toContain('as-of not on record');
    expect(model({ ...zap, checked: 'soon' }).glance.tiles[3].value).toBe('Not on record');
  });

  it('names the register when the row has no source label', () => {
    expect(model({ ...zap, source_label: '' }).footer.provenance.source).toMatch(/Nuclear Watch/);
  });

  it('says what the register is not: no complete list, no live count, no inference from absence', () => {
    const note = model(zap).footer.note;
    expect(note).toMatch(/public-source register/i);
    expect(note).toMatch(/not a claim to list every facility/i);
    expect(note).toMatch(/absence of a public entry is not evidence/i);
  });
});
