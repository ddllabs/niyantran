import { afterEach, describe, expect, it, vi } from 'vitest';
import bills from '../../public/data/embedded_csv/national_bill_tracker.json';
import billsMeta from '../../public/data/embedded_csv/national_bill_tracker.meta.json';
import tenders from '../../public/data/embedded_csv/national_tender_aggregator.json';
import registryWire from '../../public/data/embedded_csv/climate_registry_wire.json';
import leadersPack from '../data/leaders.json';
import { countryPosition } from '../shell/record/geoLookup.js';
import { registryRows } from './carbonPack.js';
import { constitutionCountryName, leadersFromPack } from './globalResources.js';
import { applyOpenTenderFilterToFeed, tenderStatus } from './shapeTenders.js';

// Audit cause 7 (docs/research/2026-10-15-module-quality-audit.md, C8): data defects in shipped packs.
// Inventory of every change: docs/research/2026-10-15-data-file-fixes.md.

describe('Bill register dates are the Sansad calendar date (IST)', () => {
  const day = (r) => String(r.source_date_raw).slice(0, 10);

  it('date_introduced is the date in source_date_raw, with no made-up time', () => {
    const wrong = bills.filter((r) => r.date_introduced !== day(r));
    expect(wrong.length, wrong.slice(0, 3).map((r) => `${r.id}: ${r.date_introduced} vs ${r.source_date_raw}`).join('; ')).toBe(0);
  });

  it('occurred_at is midnight IST of that date, so it reads the same day in India', () => {
    const wrong = bills.filter((r) => r.occurred_at !== `${day(r)}T00:00:00+05:30`);
    expect(wrong.length, wrong.slice(0, 3).map((r) => `${r.id}: ${r.occurred_at}`).join('; ')).toBe(0);
    for (const r of bills.slice(0, 50)) {
      const ist = new Date(Date.parse(r.occurred_at) + 5.5 * 3600e3).toISOString().slice(0, 10);
      expect(ist).toBe(day(r));
    }
  });

  it('the pack meta names the newest record by the same rule', () => {
    const newest = bills.map(day).sort().pop();
    expect(billsMeta.newest_record).toBe(`${newest}T00:00:00+05:30`);
  });

  it('keeps every row, and the ids as they were (ids are pin and desk_rows keys, so the date inside them stays)', () => {
    expect(bills).toHaveLength(9819);
    expect(bills[0].id).toBe('156-Lok Sabha-2026-08-09-THE NATIONAL CO-OPERATIVE DEVELOPMENT CO');
    expect(bills[0].date_introduced).toBe('2026-08-10');
  });
});

describe('Heads of State names a holder for every office', () => {
  const FILLED = ['us', 'gb', 'de', 'jp', 'kr', 'pk', 'bd', 'lk', 'af', 'ca', 'pl', 'nl', 'au', 'vn', 'th', 'qa', 'ae', 'sg', 'cu'];

  it('no row is "Not verified"', () => {
    const rows = leadersFromPack(leadersPack);
    expect(rows.filter((r) => r.name === 'Not verified').map((r) => r.id)).toEqual([]);
  });

  it('each filled row cites its Wikidata item and the date it was checked', () => {
    const byId = new Map(leadersPack.leaders.map((p) => [p.id, p]));
    for (const id of FILLED) {
      const p = byId.get(id);
      expect(p?.source_url, id).toMatch(/^https:\/\/www\.wikidata\.org\/wiki\/Q\d+$/);
      expect(p?.as_of, id).toBe('2026-10-15');
    }
  });
});

describe('Central tenders past their deadline read Closed', () => {
  const NOW = Date.parse('2026-10-15T12:00:00+05:30');

  it('derives Closed from a passed deadline and keeps a future one Open', () => {
    expect(tenderStatus({ status: 'Open', deadline: '13-Jul-2026 03:00 PM' }, NOW)).toBe('Closed');
    expect(tenderStatus({ status: '', deadline: '10-Jul-2026 12:00 PM' }, NOW)).toBe('Closed');
    expect(tenderStatus({ status: 'Open', deadline: '13-Nov-2026 03:00 PM' }, NOW)).toBe('Open');
    expect(tenderStatus({ status: 'Open', deadline: '' }, NOW)).toBe('Open');
    expect(tenderStatus({ status: 'Cancelled', deadline: '13-Jul-2026 03:00 PM' }, NOW)).toBe('Cancelled');
  });

  it('marks every stored Central tender Closed on a board that keeps expired rows', () => {
    const feed = { feature: 'Central Tender Aggregator + Constituency Filter', rows: tenders, meta: { backup: true } };
    const out = applyOpenTenderFilterToFeed(feed, NOW);
    expect(out.rows).toHaveLength(tenders.length);
    expect(out.rows.map((r) => r.status)).toEqual(tenders.map(() => 'Closed'));
  });
});

describe('Carbon Registry Wire rows are dated', () => {
  it('every Isometric row carries its publication date', () => {
    const iso = registryWire.filter((r) => r.registry === 'Isometric');
    expect(iso).toHaveLength(14);
    for (const r of iso) expect(r.date, r.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(registryRows(registryWire).filter((r) => !r.date)).toEqual([]);
  });
});

describe('World Constitutions show country names, not Constitute ids', () => {
  // Every in-force Constitute Project country_id that is not already a plain name (46, fetched 2026-10-15).
  const SLUGS = [
    'Antigua_and_Barbuda', 'Bahamas_the', 'Bosnia_and_Herzegovina', 'Brunei_Darussalam', 'Cape_Verde', 'Comoros_the',
    'Congo_the', 'Costa_Rica', 'Cote_d_Ivoire', 'Czech_Republic_the', 'Democratic_Republic_of_the_Congo',
    'Dominican_Republic_the', 'El_Salvador', 'Equatorial_Guinea', 'Gambia__the', 'Iran_Islamic_Rep_of_',
    'Lao_People_s_Democratic_Republic__the', 'The_former_Yugoslav_Republic_of_Macedonia', 'Marshall_Islands__the',
    'Micronesia__Fed_States_of_', 'Republic_of_Moldova', 'Netherlands_the', 'New_Zealand', 'Niger_the', 'Papua_New_Guinea',
    'Democratic_People_s_Republic_of_Korea_the', 'Philippines__the', 'Republic_of_Korea__the', 'Russian_Federation__the',
    'Sao_Tome_and_Principe', 'Saudi_Arabia', 'Sierra_Leone', 'Viet_Nam', 'Solomon_Islands', 'South_Africa', 'South_Sudan',
    'Sri_Lanka', 'Saint_Kitts_and_Nevis', 'Saint_Lucia', 'Saint_Vincent_and_the_Grenadines', 'Sudan_the',
    'United_Republic_of_Tanzania__the', 'Trinidad_and_Tobago', 'United_Arab_Emirates__the',
    'United_Kingdom_of_Great_Britain_and_Northern_Ireland__the', 'United_States_of_America',
  ];

  it('formats all 46 ids without underscores, and places each on the map', () => {
    expect(SLUGS).toHaveLength(46);
    for (const id of SLUGS) {
      const name = constitutionCountryName(id);
      expect(name, id).not.toMatch(/_|\s{2}|\bthe$/);
      expect(countryPosition(name), `${id} -> ${name}`).toMatchObject({ approximate: true });
    }
  });

  it('names the irregular ones as people know them', () => {
    expect(constitutionCountryName('Bahamas_the')).toBe('Bahamas');
    expect(constitutionCountryName('Cape_Verde')).toBe('Cape Verde');
    expect(constitutionCountryName('Cote_d_Ivoire')).toBe("Côte d'Ivoire");
    expect(constitutionCountryName('Lao_People_s_Democratic_Republic__the')).toBe('Laos');
    expect(constitutionCountryName('Democratic_People_s_Republic_of_Korea_the')).toBe('North Korea');
    expect(constitutionCountryName('Republic_of_Korea__the')).toBe('South Korea');
    expect(constitutionCountryName('Congo_the')).toBe('Republic of the Congo');
    expect(constitutionCountryName('Democratic_Republic_of_the_Congo')).toBe('Democratic Republic of the Congo');
    expect(constitutionCountryName('The_former_Yugoslav_Republic_of_Macedonia')).toBe('North Macedonia');
    expect(constitutionCountryName('United_Kingdom_of_Great_Britain_and_Northern_Ireland__the')).toBe('United Kingdom');
    expect(constitutionCountryName('Swaziland')).toBe('Eswatini');
    expect(constitutionCountryName('India')).toBe('India');
    expect(constitutionCountryName('')).toBe('');
  });
});

describe('the /api/constitutions loader uses the formatter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns country_id into a display name and keeps the Constitute id', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => [
        { country_id: 'Bahamas_the', id: 'Bahamas_1973', in_force: true, year_enacted: '1973' },
        { country_id: 'India', id: 'India_2016', in_force: true, year_enacted: '1949' },
        { country_id: 'Chile', id: 'Chile_1980', in_force: false, year_enacted: '1980' },
      ],
    }));
    const { loadConstitutions } = await import('../../server/resourcesApi.mjs');
    const out = await loadConstitutions();
    expect(out.rows.map((r) => [r.title, r.country, r.constitution_id])).toEqual([
      ['Bahamas', 'Bahamas', 'Bahamas_1973'],
      ['India', 'India', 'India_2016'],
    ]);
  });
});
