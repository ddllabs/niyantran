import { afterAll, describe, expect, it, vi } from 'vitest';
import { loadConstitutions } from '../../../../server/resourcesApi.mjs';
import { countryPosition } from '../geoLookup.js';
import { contractProblems } from '../modelContract.js';
import constitutions, { readableCountry } from './constitutions.js';

/**
 * F121 batch 2, T9: World Constitutions (Constitute Project).
 *
 * The fixtures are real `loadConstitutions` output (server/resourcesApi.mjs lines 59-81): the loader
 * runs here against a stubbed Constitute response, so the rows have exactly the shape the feed
 * serves ({ title, country, enacted, constitution_id, source_url }, sorted by country). The
 * stubbed records use the real country_id and id spellings and year_enacted values read from
 * https://www.constituteproject.org/service/constitutions?lang=en on 2026-10-13. Only the fields
 * the loader reads are included. Two records are not real: Kosovo with an empty year_enacted
 * (the loader allows '', Constitute currently supplies a year for every in-force record) and a
 * historic record that is not in force.
 */
const record = (country_id, id, year_enacted, extra = {}) => ({ id, country_id, in_force: true, is_historic: false, year_enacted, ...extra });
const feed = [
  record('India', 'India_2023', '1949', { year_updated: '2023' }),
  record('Italy', 'Italy_2020', '1947', { year_updated: '2020' }),
  record('Japan', 'Japan_1946', '1946'),
  record('Republic_of_Korea__the', 'Republic_of_Korea_1987', '1948', { year_updated: '1987' }),
  record('Cote_d_Ivoire', 'Cote_DIvoire_2020', '2016', { year_updated: '2020' }),
  record('Gambia__the', 'Gambia_2018', '1996', { year_updated: '2018' }),
  record('Iran_Islamic_Rep_of_', 'Iran_1989', '1979', { year_updated: '1989' }),
  record('Bosnia_and_Herzegovina', 'Bosnia_Herzegovina_2009', '1995', { year_updated: '2009' }),
  record('Congo_the', 'Congo_2015', '2015'),
  record('Micronesia__Fed_States_of_', 'Micronesia_1990', '1978', { year_updated: '1990' }),
  record('Lao_People_s_Democratic_Republic__the', 'Laos_2025', '1991', { year_updated: '2025' }),
  record('United_Kingdom_of_Great_Britain_and_Northern_Ireland__the', 'United_Kingdom_2013', '1215', { year_updated: '2013' }),
  record('Niger_the', 'Niger_2017', '2010', { year_updated: '2017' }),
  record('Timor-Leste', 'East_Timor_2002', '2002'),
  record('The_former_Yugoslav_Republic_of_Macedonia', 'Macedonia_2019', '1991', { year_updated: '2019' }),
  record('Democratic_Republic_of_the_Congo', 'Democratic_Republic_of_the_Congo_2011', '2005', { year_updated: '2011' }),
  record('Kuwait', 'Kuwait_1992', '1962', { year_reinstated: '1992' }), // the id year is not the enactment year
  record('Kosovo', 'Kosovo_2008', '', { year_updated: '2016' }), // synthetic: no year_enacted
  record('Afghanistan', 'Afghanistan_1964', '1964', { in_force: false, is_historic: true }), // synthetic: not in force, so the loader drops it
];

vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => feed }));
const live = await loadConstitutions();
vi.unstubAllGlobals();
afterAll(() => vi.unstubAllGlobals());

const rows = live.rows;
const ctx = (list = rows) => ({ rows: list, feed: { rows: list } });
/**
 * A fixture row by its Constitute country_id, or by the name the loader shows. Since F202 (2026-10-15) the
 * loader turns country_id into a display name (`constitutionCountryName`), so `country` is no longer the id.
 */
const pick = (key, list = rows) => {
  const id = feed.find((f) => f.country_id === key)?.id;
  return list.find((r) => (id && r.constitution_id === id) || r.country === key);
};
const model = (country, list = rows) => constitutions(pick(country, list), ctx(list));

/** Every string anywhere in a model. */
function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

/**
 * What a reader sees as prose: everything except the header source link (an address) and the
 * "Constitute id" About row, which shows Constitute's own key exactly as recorded (it has underscores).
 */
function readable(m) {
  return strings({ ...m, links: [], about: { ...m.about, rows: (m.about.rows || []).filter(([k]) => k !== 'Constitute id') } });
}

const BANNED = /—|\[|_|undefined|NaN/;

describe('loadConstitutions fixtures', () => {
  it('has the loader row shape, sorted by country, and only the in-force records', () => {
    expect(rows.length).toBe(feed.length - 1);
    expect(rows.map((r) => r.country)).not.toContain('Afghanistan'); // in_force !== true is filtered (resourcesApi.mjs line 63)
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(['constitution_id', 'country', 'enacted', 'source_url', 'title']);
    expect(pick('India')).toMatchObject({ title: 'India', enacted: '1949', constitution_id: 'India_2023', source_url: 'https://www.constituteproject.org/constitution/India_2023' });
    expect(pick('Kosovo').enacted).toBe('');
  });
});

describe('World Constitutions adapter', () => {
  it('honours the panel contract for every fixture row, with and without context', () => {
    for (const row of rows) {
      expect(contractProblems(constitutions(row, ctx())), row.country).toEqual([]);
      expect(contractProblems(constitutions(row)), row.country).toEqual([]);
    }
  });

  it.each([
    ['India', 'India'],
    ['Cote_d_Ivoire', "Côte d'Ivoire"],
    ['Gambia__the', 'Gambia'],
    ['Iran_Islamic_Rep_of_', 'Iran'],
    ['Bosnia_and_Herzegovina', 'Bosnia and Herzegovina'],
    ['Congo_the', 'Republic of the Congo'],
    ['Democratic_Republic_of_the_Congo', 'Democratic Republic of the Congo'],
    ['Micronesia__Fed_States_of_', 'Micronesia'],
    ['Lao_People_s_Democratic_Republic__the', 'Laos'],
    ['United_Kingdom_of_Great_Britain_and_Northern_Ireland__the', 'United Kingdom'],
    ['Republic_of_Korea__the', 'South Korea'],
    ['Niger_the', 'Niger'],
    ['Timor-Leste', 'Timor-Leste'],
    ['The_former_Yugoslav_Republic_of_Macedonia', 'North Macedonia'],
  ])('writes %s as a readable country name', (id, name) => {
    const m = model(id);
    expect(m.title).toBe(name);
    expect(m.about.rows).toContainEqual(['Country', name]);
  });

  it('keeps "The" only where English uses it in the short name', () => {
    expect(readableCountry('Bahamas__the')).toBe('The Bahamas');
    expect(readableCountry('Sudan_the')).toBe('Sudan');
  });

  it('shows no dash, bracket, underscore, undefined or NaN anywhere a reader sees it', () => {
    for (const row of rows) expect(readable(constitutions(row, ctx())).filter((s) => BANNED.test(s)), row.country).toEqual([]);
    expect(readable(constitutions(rows[0])).filter((s) => BANNED.test(s))).toEqual([]);
  });

  it('says every record is in force because the loader keeps only in-force records', () => {
    const m = model('Japan');
    expect(m.meta).toEqual(['Constitution in force']);
    expect(m.badge).toEqual({ text: 'In force', tone: 'green' });
    expect(m.glance.tiles).toContainEqual({ label: 'In force', value: 'Yes', sub: 'per Constitute Project', tone: 'green' });
  });

  it('leads with the enactment year and its decade', () => {
    const m = model('India');
    expect(m.glance.tiles.map((t) => t.label)).toEqual(['Enacted', 'In force', 'Decade']);
    expect(m.glance.tiles[0]).toMatchObject({ label: 'Enacted', value: '1949' });
    expect(m.glance.tiles[2]).toMatchObject({ label: 'Decade', value: '1940s' });
    expect(model('Japan').glance.tiles[2].value).toBe('1940s'); // 1946
    expect(model('Niger_the').glance.tiles[2].value).toBe('2010s');
    expect(model('United_Kingdom_of_Great_Britain_and_Northern_Ireland__the').glance.tiles[2].value).toBe('1210s'); // 1215
    expect(model('Timor-Leste').glance.tiles[2].value).toBe('2000s'); // 2002
  });

  it('writes "Not on record" for a missing enactment year and links no decade', () => {
    const m = model('Kosovo');
    expect(contractProblems(m)).toEqual([]);
    expect(m.glance.tiles[0]).toMatchObject({ label: 'Enacted', value: 'Not on record' });
    expect(m.glance.tiles[2]).toMatchObject({ label: 'Decade', value: 'Not on record' });
    expect(m.about.rows.map(([k]) => k)).toContain('Enacted');
    expect(m.about.rows.find(([k]) => k === 'Enacted')[1]).toBe('Not on record');
    expect(m.touches.links).toEqual([]);
  });

  it('does not read a year out of a malformed enacted value', () => {
    for (const enacted of ['19xx', '1949-50', 'circa 1949', '49', ' ']) {
      const m = constitutions({ ...pick('India'), enacted }, ctx());
      expect(contractProblems(m), enacted).toEqual([]);
      expect(m.glance.tiles[0].value, enacted).toBe('Not on record');
      expect(m.glance.tiles[2].value, enacted).toBe('Not on record');
    }
  });

  it('counts the other in-force constitutions of the same decade, never the selection', () => {
    const india = pick('India');
    const m = constitutions(india, ctx());
    // Italy 1947, Japan 1946 and Korea 1948 share the 1940s with India (1949).
    expect(m.touches.links).toEqual([{ title: 'Other constitutions from the 1940s', detail: '3 more in force on this list' }]);
    // The selection can be a copy of its feed row: it still must not count itself.
    expect(constitutions({ ...india }, ctx()).touches.links[0].detail).toBe('3 more in force on this list');
    // Rows of other decades are not counted: the 1210s hold only the United Kingdom (1215) here, and the 2010s hold three.
    expect(model('United_Kingdom_of_Great_Britain_and_Northern_Ireland__the').touches.links).toEqual([]);
    expect(model('Niger_the').touches.links[0].detail).toBe('2 more in force on this list');
    const two = rows.filter((r) => ['India', 'Japan'].includes(r.country));
    expect(constitutions(pick('India', two), ctx(two)).touches.links[0].detail).toBe('1 more in force on this list');
  });

  it('keeps the related links as static text', () => {
    const m = model('India');
    for (const link of m.touches.links) expect(link.to, link.title).toBeUndefined(); // static text only
  });

  it('draws an approximate country map exactly when the lookup knows the country', () => {
    for (const row of rows) {
      const m = constitutions(row, ctx());
      const where = countryPosition(row.country);
      expect(where, `lookup for ${row.country}`).not.toBeNull();
      expect(m.glance.visual, row.country).toMatchObject({ type: 'map', points: [{ lat: where.lat, lon: where.lon, approximate: true, main: true, label: m.title }] });
      expect(m.glance.visual.caption).toMatch(/country level/i);
      expect(m.glance.visual.caption).toMatch(/approximate/i);
      expect(m.glance.visual2).toBeUndefined();
    }
    expect(model('Cote_d_Ivoire').glance.visual.points[0]).toMatchObject({ label: "Côte d'Ivoire", approximate: true });
    const unknown = { ...pick('India'), country: 'Narnia', title: 'Narnia' };
    const m = constitutions(unknown, ctx());
    expect(m.glance.visual).toBeUndefined();
    expect(contractProblems(m)).toEqual([]);
  });

  it('shows the Constitute id plainly, only when present, without reading a year into it', () => {
    const m = model('India');
    expect(m.about.rows).toEqual([['Country', 'India'], ['Enacted', '1949'], ['Constitute id', 'India_2023']]);
    expect(m.links).toEqual([{ label: 'Constitute Project', href: 'https://www.constituteproject.org/constitution/India_2023' }]);
    const bare = constitutions({ ...pick('India'), constitution_id: '', source_url: 'https://www.constituteproject.org/' }, ctx());
    expect(bare.about.rows.map(([k]) => k)).not.toContain('Constitute id');
    expect(contractProblems(bare)).toEqual([]);
    // Kuwait's id ends 1992 and it was enacted 1962: no tile, node or caption may present 1992 as a date.
    const kuwait = model('Kuwait');
    expect(kuwait.glance.tiles.map((t) => t.value)).toEqual(['1962', 'Yes', '1960s']);
    expect(readable(kuwait).some((s) => /1992/.test(s))).toBe(false);
    expect(kuwait.about.rows).toContainEqual(['Constitute id', 'Kuwait_1992']);
  });

  it('describes the record without characterising what the constitution says', () => {
    const [card] = model('India').about.cards;
    expect(card.body).toMatch(/currently in force/);
    expect(card.body).toMatch(/Constitute Project/);
    expect(card.body).toMatch(/no text, topics or amendments/);
    expect(model('India').about.cards).toHaveLength(1);
  });

  it('names Constitute Project, has no fetch time, and says the list is fetched live and cached up to 7 days', () => {
    const f = model('India').footer;
    expect(f.ask).toBe('Ask AI about this constitution');
    expect(f.provenance.source).toBe('Constitute Project (constitutions in force)');
    expect(f.provenance.asOf).toBeFalsy();
    expect(f.provenance.flags).toEqual(['as-of not on record']);
    expect(f.note).toMatch(/fetched live/);
    expect(f.note).toMatch(/cached for up to 7 days/);
  });
});
