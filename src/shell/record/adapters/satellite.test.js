import { describe, expect, it } from 'vitest';
import { flattenLaunch } from '../../../../server/assetsApi.mjs';
import { contractProblems } from '../modelContract.js';
import satellite from './satellite.js';

/**
 * Fixtures are real `flattenLaunch` output (server/assetsApi.mjs) for launch objects shaped like
 * The Space Devs Launch Library 2.2.0 `launch/upcoming` results, so the rows have exactly the
 * shape the live feed serves. The library sends pad coordinates as strings; a pad it does not know
 * can arrive with no coordinates at all.
 */
let seq = 0;
function launch({ name, provider, status = 'Go for Launch', net = '2026-10-20T14:30:00Z', pad = 'Space Launch Complex 40', site = 'Cape Canaveral SFS, FL, USA', country = 'USA', lat, lon, noPad = false } = {}) {
  seq += 1;
  return flattenLaunch({
    id: `00000000-0000-0000-0000-${String(seq).padStart(12, '0')}`,
    url: `https://ll.thespacedevs.com/2.2.0/launch/${seq}/`,
    name,
    status: { name: status },
    net,
    launch_service_provider: provider ? { name: provider } : undefined,
    pad: noPad ? undefined : { name: pad, latitude: lat, longitude: lon, location: { name: site, country_code: country } },
  });
}

const falcon1 = launch({ name: 'Falcon 9 Block 5 | Starlink Group 10-5', provider: 'SpaceX', lat: '28.56194122', lon: '-80.57735736' });
const falcon2 = launch({ name: 'Falcon 9 Block 5 | Transporter-16', provider: 'SpaceX', status: 'To Be Confirmed', net: '2026-11-02T09:15:00Z', pad: 'Space Launch Complex 4E', site: 'Vandenberg SFB, CA, USA', lat: '34.632093', lon: '-120.610829' });
const falcon3 = launch({ name: 'Falcon 9 Block 5 | Bandwagon-5', provider: 'SpaceX', status: 'To Be Determined', net: '2026-11-15T00:00:00Z', lat: '28.56194122', lon: '-80.57735736' });
const electron = launch({ name: 'Electron | Eye in the Sky', provider: 'Rocket Lab USA', status: 'Launch Successful', net: '2026-10-05T03:05:00Z', pad: 'Launch Complex 1', site: 'Mahia Peninsula, New Zealand', country: 'NZL', lat: -39.26, lon: 177.865 });
const gslv = launch({ name: 'GSLV Mk II | NISAR follow-on', provider: 'Indian Space Research Organization', status: 'On Hold', net: '2026-12-01T10:00:00Z', pad: 'Second Launch Pad', site: 'Satish Dhawan Space Centre, India', country: 'IND', lat: '13.72', lon: '80.23' });
const noCoords = launch({ name: 'Unknown Rocket | Demo Flight', provider: 'Example Launch Co', pad: 'Unsurveyed Pad', site: 'Somewhere, Earth', country: 'FRA' });
const nullCoords = launch({ name: 'Null Rocket | Demo Flight', provider: 'Example Launch Co', lat: null, lon: null });
const noProvider = launch({ name: 'Vega-C | Failed Demo', status: 'Launch Failure', net: '2026-09-30T21:00:00Z', pad: 'Ariane Launch Area 4', site: 'Kourou, French Guiana', country: 'GUF', lat: '5.239', lon: '-52.768' });
const partial = launch({ name: 'Zhuque-2 | Test', provider: 'LandSpace', status: 'Launch was a Partial Failure', pad: 'Launch Area 95', site: 'Jiuquan, China', country: 'CHN', lat: '40.96', lon: '100.28' });
const bare = flattenLaunch({});

const FIXTURES = [falcon1, falcon2, falcon3, electron, gslv, noCoords, nullCoords, noProvider, partial, bare];
const rows = FIXTURES;
const ctx = (extra = {}) => ({ rows, feed: { ok: true, feature: 'Satellite Infrastructure', meta: { source: 'spacedevs' } }, ...extra });
const model = (row, c = ctx()) => satellite(row, c);

function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

describe('Satellite Infrastructure adapter: fixtures', () => {
  it('are real flattenLaunch rows (string and numeric coordinates, missing and null ones)', () => {
    expect(falcon1).toMatchObject({ provider: 'SpaceX', lat: '28.56194122', net: '2026-10-20 14:30', source_label: 'The Space Devs' });
    expect(electron.lat).toBe(-39.26);
    expect(noCoords.lat).toBeUndefined();
    expect(nullCoords.lat).toBeNull();
    expect(noProvider.provider).toBe('');
  });

  it('honours the panel contract for every row', () => {
    for (const row of FIXTURES) expect(contractProblems(model(row)), row.title || '(bare)').toEqual([]);
  });

  it('honours the contract when the feed context is missing', () => {
    for (const row of FIXTURES) expect(contractProblems(satellite(row)), row.title || '(bare)').toEqual([]);
  });

  it('never renders a dash placeholder, a bracket, undefined, NaN or null', () => {
    for (const row of FIXTURES) {
      for (const s of strings(model(row))) {
        expect(s, `${row.title} → ${s}`).not.toMatch(/—|\[|undefined|NaN|^\s*null\s*$/);
      }
    }
  });

  it('never claims orbital data, satellite counts or constellation facts', () => {
    for (const row of FIXTURES) {
      for (const s of strings(model(row))) expect(s, s).not.toMatch(/orbit|constellation|satellites? (in|on)|apogee|inclination/i);
    }
  });
});

describe('header, badge and links', () => {
  it('names the launch, the kind and the provider', () => {
    const m = model(falcon1);
    expect(m.title).toBe('Falcon 9 Block 5 | Starlink Group 10-5');
    expect(m.meta).toEqual(['Launch', 'SpaceX']);
    expect(model(noProvider).meta).toEqual(['Launch']);
    expect(model(bare).title).toBe('Launch');
  });

  it('tones the status badge: green go or success, amber TBC, TBD, hold and partial failure, red failure, grey otherwise', () => {
    expect(model(falcon1).badge).toEqual({ text: 'Go for Launch', tone: 'green' });
    expect(model(electron).badge).toEqual({ text: 'Launch Successful', tone: 'green' });
    expect(model(falcon2).badge).toEqual({ text: 'To Be Confirmed', tone: 'amber' });
    expect(model(falcon3).badge).toEqual({ text: 'To Be Determined', tone: 'amber' });
    expect(model(gslv).badge).toEqual({ text: 'On Hold', tone: 'amber' });
    expect(model(partial).badge).toEqual({ text: 'Launch was a Partial Failure', tone: 'amber' });
    expect(model(noProvider).badge).toEqual({ text: 'Launch Failure', tone: 'red' });
    expect(model(launch({ name: 'X', provider: 'Y', status: 'Launch in Flight' })).badge).toEqual({ text: 'Launch in Flight', tone: 'grey' });
    expect(model(bare).badge).toBeUndefined();
  });

  it('links the launch record over https only', () => {
    expect(model(falcon1).links).toEqual([{ label: 'The Space Devs', href: falcon1.source_url }]);
    expect(model({ ...falcon1, source_url: 'http://insecure.example/launch' }).links).toEqual([]);
  });
});

describe('01 at a glance', () => {
  it('leads with status, scheduled, provider and country, in that order', () => {
    for (const row of FIXTURES) expect(model(row).glance.tiles.map((t) => t.label), row.title).toEqual(['Status', 'Scheduled', 'Provider', 'Country']);
  });

  it('colours the status tile like the badge and states provider and country', () => {
    const t = model(falcon1).glance.tiles;
    expect(t[0]).toMatchObject({ value: 'Go for Launch', tone: 'green' });
    expect(t[2].value).toBe('SpaceX');
    expect(t[3].value).toBe('United States');
    expect(model(noProvider).glance.tiles[0]).toMatchObject({ value: 'Launch Failure', tone: 'red' });
    expect(model(launch({ name: 'X', provider: 'Y', status: 'Launch in Flight' })).glance.tiles[0].tone).toBeUndefined();
  });

  it('writes the scheduled time as UTC, no earlier than, without converting it to a local zone', () => {
    const t = model(falcon1).glance.tiles[1];
    expect(t.value).toBe('20 Oct 2026, 14:30 UTC');
    expect(t.sub).toMatch(/no earlier than/i);
    expect(model(electron).glance.tiles[1].value).toBe('05 Oct 2026, 03:05 UTC');
    expect(model(falcon3).glance.tiles[1].value).toBe('15 Nov 2026, 00:00 UTC');
  });

  it('keeps a date-only NET at date precision and reads an unusable one as Not on record', () => {
    expect(model({ ...falcon1, net: '2026-10-20' }).glance.tiles[1].value).toBe('20 Oct 2026');
    for (const net of ['', 'soon', '2026-13-40 99:99', '2026-02-30 10:00', '2026-13-01 10:00', '2026-10-20 24:00', '2026-10-20 10:60', undefined, null]) expect(model({ ...falcon1, net }).glance.tiles[1].value, String(net)).toBe('Not on record');
  });

  it('reads an absent value as Not on record, never a dash', () => {
    const t = model(bare).glance.tiles;
    expect(t.map((x) => x.value)).toEqual(['Not on record', 'Not on record', 'Not on record', 'Not on record']);
    expect(model(noProvider).glance.tiles[2].value).toBe('Not on record');
  });
});

describe('launch-site map', () => {
  it('places string coordinates at the pad, exactly, as numbers, not approximate', () => {
    const v = model(falcon1).glance.visual;
    expect(v.type).toBe('map');
    expect(v.points).toHaveLength(1);
    expect(v.points[0]).toMatchObject({ lat: 28.56194122, lon: -80.57735736, main: true });
    expect(typeof v.points[0].lat).toBe('number');
    expect(v.points[0].approximate).toBeFalsy();
    expect('approximate' in v.points[0]).toBe(false);
  });

  it('places numeric coordinates exactly too, including a southern and an eastern one', () => {
    expect(model(electron).glance.visual.points[0]).toMatchObject({ lat: -39.26, lon: 177.865, main: true });
    expect(model(electron).glance.visual.points[0].approximate).toBeFalsy();
  });

  it('names the pad in the label and the caption, and never calls the position approximate', () => {
    const v = model(falcon1).glance.visual;
    expect(v.points[0].label).toBe('Cape Canaveral SFS, FL, USA');
    expect(v.caption).toContain('Cape Canaveral SFS, FL, USA');
    expect(v.caption).not.toMatch(/approximate|centre|center/i);
  });

  it('draws a map for an equator or meridian pad (zero is a coordinate, not a missing one)', () => {
    expect(model({ ...falcon1, lat: 0, lon: -50 }).glance.visual.points[0]).toMatchObject({ lat: 0, lon: -50 });
    expect(model({ ...falcon1, lat: '-2.37', lon: '0' }).glance.visual.points[0]).toMatchObject({ lat: -2.37, lon: 0 });
  });

  it('has no map when the coordinates are missing, null, blank, partial, non-numeric or out of range', () => {
    expect(model(noCoords).glance.visual).toBeUndefined();
    expect(model(nullCoords).glance.visual).toBeUndefined();
    const bad = [
      [undefined, undefined], [null, null], ['', ''], ['  ', ' '], ['28.5', undefined], [undefined, '-80.5'], ['28.5', null],
      ['north', 'west'], ['NaN', 'NaN'], [Infinity, 10], [91, 10], [-91, 10], [10, 181], [10, -181], ['28.5N', '80.5W'], [true, false], [[], {}],
    ];
    for (const [lat, lon] of bad) expect(model({ ...falcon1, lat, lon }).glance.visual, `${String(lat)}, ${String(lon)}`).toBeUndefined();
  });

  it('treats a pad at exactly 0, 0 as unknown rather than a launch site in the Gulf of Guinea', () => {
    expect(model({ ...falcon1, lat: '0', lon: '0' }).glance.visual).toBeUndefined();
    expect(model({ ...falcon1, lat: 0, lon: 0 }).glance.visual).toBeUndefined();
  });

  it('still draws the map when only the pad name is missing, and says so', () => {
    const v = model({ ...falcon1, pad: '', region: '' }).glance.visual;
    expect(v.points[0].label).toBe('Launch pad');
    expect(v.caption).toMatch(/^Launch pad/);
  });

  it('carries no second visual, orbit or board', () => {
    for (const row of FIXTURES) expect(model(row).glance.visual2).toBeUndefined();
  });
});

describe('02 about', () => {
  it('lists launch site, provider, country and status, only where present', () => {
    expect(model(falcon1).about.label).toBe('02 · About this launch');
    expect(model(falcon1).about.rows).toEqual([
      ['Launch site', 'Cape Canaveral SFS, FL, USA'],
      ['Provider', 'SpaceX'],
      ['Country', 'United States'],
      ['Status', 'Go for Launch'],
    ]);
    expect(model(noProvider).about.rows.map(([k]) => k)).toEqual(['Launch site', 'Country', 'Status']);
    expect(model(bare).about.rows).toEqual([]);
  });
});

describe('03 what it touches', () => {
  it('uses the four satellite lanes, with a launch centre node', () => {
    for (const row of FIXTURES) {
      const t = model(row).touches;
      expect(t.lanes, row.title).toEqual(['PROVIDER', 'LAUNCH', 'LAUNCH SITE', 'SAME PROVIDER']);
      expect(t.nodes.center).toMatchObject({ code: 'L' });
    }
  });

  it('puts the provider left, the launch site right and the other launches by that provider far', () => {
    const n = model(falcon1).touches.nodes;
    expect(n.left).toEqual({ l1: 'SpaceX' });
    expect(n.center.l2).toBe('Go for Launch');
    expect(n.right).toEqual({ l1: 'Cape Canaveral SFS, FL, USA' });
    expect(n.far).toMatchObject({ l1: '2 other launches' });
  });

  it('counts only the other launches of the same provider, case-insensitively, never the row itself', () => {
    expect(model(falcon1).touches.nodes.far.l1).toBe('2 other launches');
    expect(model(falcon2).touches.nodes.far.l1).toBe('2 other launches');
    expect(model(electron).touches.nodes.far).toBeUndefined();
    expect(model(noCoords).touches.nodes.far.l1).toBe('1 other launch');
    const shouty = { ...falcon3, id: 'x-shout', title: 'Shout', name: 'Shout', provider: 'SPACEX' };
    expect(model(falcon1, ctx({ rows: [...rows, shouty] })).touches.nodes.far.l1).toBe('3 other launches');
  });

  it('does not count the selection when it is a copy of its feed row', () => {
    expect(model({ ...falcon1 }).touches.nodes.far.l1).toBe('2 other launches');
    expect(model({ ...falcon1 }).touches.links.map((l) => l.detail).join(' ')).toMatch(/2 more/);
  });

  it('omits a missing node so the renderer can say None on record', () => {
    const none = model(noProvider).touches.nodes;
    expect(none.left).toBeUndefined();
    expect(none.far).toBeUndefined();
    expect(none.right.l1).toBe('Kourou, French Guiana');
    const n = model(bare).touches.nodes;
    expect(n.left).toBeUndefined();
    expect(n.right).toBeUndefined();
    expect(n.far).toBeUndefined();
    expect(model(falcon1, { rows: undefined, feed: undefined }).touches.nodes.far).toBeUndefined();
    expect(model(falcon1, { rows: [], feed: {} }).touches.nodes.far).toBeUndefined();
  });

  it('writes its cross-links as static text, with no destination, and says the count is of this list', () => {
    const links = model(falcon1).touches.links;
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({ title: 'Other SpaceX launches', detail: '2 more in this list' });
    for (const row of FIXTURES) for (const l of model(row).touches.links) expect(l.to, `${row.title}: ${l.title}`).toBeUndefined();
    expect(model(electron).touches.links).toEqual([]);
  });
});

describe('footer and provenance', () => {
  const m = model(falcon1);

  it('offers Ask AI about this launch', () => {
    expect(m.footer.ask).toBe('Ask AI about this launch');
  });

  it('names The Space Devs Launch Library as the source', () => {
    expect(m.footer.provenance.source).toMatch(/Space Devs Launch Library/);
    expect(m.footer.provenance.source).not.toMatch(/celestrak|nasa|esa/i);
  });

  it('has no as-of date, because the feed envelope carries no fetch time, and says so with the flag', () => {
    for (const row of FIXTURES) {
      const p = model(row).footer.provenance;
      expect(p.asOf || '', row.title).toBe('');
      expect(p.flags).toContain('as-of not on record');
    }
  });

  it('does not borrow an as-of from the feed metadata or the launch time', () => {
    const p = model(falcon1, ctx({ feed: { meta: { asOf: '2026-10-13', source: 'spacedevs' } } })).footer.provenance;
    expect(p.asOf || '').toBe('');
    expect(p.flags).toContain('as-of not on record');
  });

  it('says the list is fetched live and cached, and that NET means no earlier than', () => {
    expect(m.footer.note).toMatch(/fetched live/i);
    expect(m.footer.note).toMatch(/cached for 30 minutes/i);
    expect(m.footer.note).toMatch(/NET/);
    expect(m.footer.note).toMatch(/no earlier than/i);
    expect(m.footer.note).toMatch(/move/i);
  });
});
