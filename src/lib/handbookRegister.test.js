// F196: the RBI Handbook of Statistics on Indian States as stored State registers (owner, 2026-10-15:
// "use the RBI handbook as a yearly stored register"). One store variant per table, loaded by
// scripts/load-feed-register.mjs from scripts/fetch-rbi-handbook.mjs's JSON, served from the feed store
// whatever its age, with one table page read live when the store has nothing. The Cross-State
// Comparison Engine ranks the states of any of those tables. Fixtures: trimmed real table pages
// (src/lib/__fixtures__/rbi), so no test reaches RBI.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { FEED_REGISTERS, FEED_SCHEDULE, OFF_TIMER, isStoreServed, registerRunsForDb } from '../../server/feedSchedule.mjs';
import { STORE_PAGE_ROWS, serveFromStore, storeVariant } from '../../server/feedServe.mjs';
import { LATE_LIVE_MAX, LATE_LIVE_MS, keepLateLive, resetFeedCache, scheduledModuleId, serveFeatureFeed, serveFeatureFeedStoredFirst, serveFeatureFeedWithinLimit } from '../../server/featureFeed.mjs';
import {
  REGISTERS, buildRegisterItems, groupByVariant, handbookItemKey, main, mapHandbookRecord, readRegisterJson, registerMeta,
} from '../../scripts/load-feed-register.mjs';
import { buildRegister, compareListing, main as fetchMain, moduleCounts, refusal } from '../../scripts/fetch-rbi-handbook.mjs';
import { parseHandbookTable } from './rbiHandbook.js';
import { HANDBOOK, HANDBOOK_MODULES, HANDBOOK_STATES, HANDBOOK_TABLES, handbookModuleFor } from './rbiHandbookTables.js';
import { compareStates, comparisonYears, rankedWithin, wholeYearsOf } from './stateComparison.js';
import { modulePicker } from './modulePicker.js';
import { featureMenuLabel } from './national.js';
import { asOfLabel } from './plainSourceNote.js';
import { STATE_PRESENTATION } from '../desks/landing/statePresentation.js';
import ModulePicker from '../desks/ModulePicker.jsx';

const fixture = (name) => readFileSync(new URL(`./__fixtures__/rbi/${name}`, import.meta.url), 'utf8');
const ECON = 'state:State Economic Data (GSDP, sectors)';
const FISCAL = 'state:State Fiscal Deep-Dive';
const T21 = parseHandbookTable(fixture('handbook-t21-gsdp.html'), { tableNo: 21 });
const T164 = parseHandbookTable(fixture('handbook-t164-gfd.html'), { tableNo: 164 });
const T1 = parseHandbookTable(fixture('handbook-t1-ger.html'), { tableNo: 1 });
const REGISTER_FILE = buildRegister([
  { meta: HANDBOOK_TABLES.get(21), out: T21 },
  { meta: HANDBOOK_TABLES.get(164), out: T164 },
  { meta: HANDBOOK_TABLES.get(1), out: T1 },
], { fetchedAt: '2026-10-15T12:00:00.000Z' });
const fileMeta = { ...REGISTER_FILE, tables: new Map(REGISTER_FILE.tables.map((t) => [t.no, t])) };

describe('the handbook modules: registers, not planned, labelled as state level', () => {
  it('eight register modules, one variant per table, each run a 30-day reference run', () => {
    expect(Object.keys(HANDBOOK_MODULES)).toHaveLength(8);
    for (const [id, spec] of Object.entries(HANDBOOK_MODULES)) {
      expect(FEED_REGISTERS[id], id).toMatchObject({ param: 'table', values: spec.tables.map(String), defaultVariant: String(spec.tables[0]) });
      expect(Object.hasOwn(FEED_SCHEDULE, id), id).toBe(false);
      expect(isStoreServed(id), id).toBe(true);
      const runs = registerRunsForDb(id);
      expect(runs.map((r) => r.variant)).toEqual(spec.tables.map(String));
      expect(runs.every((r) => r.kind === 'reference' && r.class === 'register' && r.interval_minutes === 43200)).toBe(true);
    }
    expect(FEED_SCHEDULE['state:SDL Auction & Borrowing Tracker']).toBe('official');
    expect(OFF_TIMER['state:Cross-State Comparison Engine']).toMatch(/F196/);
  });

  it('the five "District" themes keep their keys and show "State" names wherever the page names them', () => {
    const modules = STATE_PRESENTATION.groups.flatMap((g) => g.modules);
    for (const [id, spec] of Object.entries(HANDBOOK_MODULES)) {
      const feature = id.split(/:(.*)/s)[1];
      const shown = modules.find((m) => m.feature === feature);
      expect(shown, feature).toBeTruthy();
      expect(shown.configured, feature).toBe(true);
      if (!spec.label) continue;
      expect(feature).toMatch(/^District /);
      expect(shown.title).toBe(spec.label);
      expect(featureMenuLabel({ htmlFeature: feature })).toBe(spec.label);
      expect(spec.label).toMatch(/^State /);
    }
  });

  it('a request names its table; none (or one the module lacks) is the module\'s first table, never a page across tables', () => {
    const q = (table) => new URLSearchParams({ tier: 'state', feature: 'State Economic Data (GSDP, sectors)', ...(table ? { table } : {}) });
    expect(storeVariant(ECON, q('22'))).toBe('22');
    expect(storeVariant(ECON, q())).toBe('21');
    expect(storeVariant(ECON, q('164'))).toBe('21');
    expect(scheduledModuleId(q())).toBe(ECON);
    expect(scheduledModuleId(new URLSearchParams({ tier: 'state', feature: 'District Health & Nutrition Indicators' }))).toBe('state:District Health & Nutrition Indicators');
  });
});

describe('the loader: the fetched JSON as store items', () => {
  const ECON_REGISTER = REGISTERS[ECON];

  it('keeps a module\'s own tables only, every figure with a key of its table, state, indicator and year', () => {
    const { items, report } = buildRegisterItems(REGISTER_FILE.records, ECON_REGISTER, 'reference');
    expect(report.kept).toBe(T21.records.length);
    expect(report.dropped).toEqual({ not_module: T164.records.length + T1.records.length, bad_record: 0 });
    expect(items[0].item_key).toBe('hb:t21:Andhra Pradesh|Gross State Domestic Product|2024-25');
    expect(new Set(items.map((i) => i.item_key)).size).toBe(items.length);
    // The table's order: newest year first.
    expect(items[0].row.year).toBe('2024-25');
    expect(items.at(-1).row.year).toBe('2011-12');
  });

  it('refuses a record without a number, a year or an RBI link', () => {
    const spec = HANDBOOK_MODULES[ECON];
    const good = T21.records[0];
    expect(mapHandbookRecord(good, spec).row).toMatchObject({ state: good.state, value: good.value, table_no: 21 });
    for (const bad of [{ ...good, value: '12' }, { ...good, year: '' }, { ...good, source_url: 'https://example.com/x' }]) {
      expect(mapHandbookRecord(bad, spec)).toEqual({ drop: 'bad_record' });
    }
    expect(handbookItemKey({ table_no: 1, state: 'Bihar', indicator: 'GER', year: '2024-25' })).toBe('hb:t1:Bihar|GER|2024-25');
  });

  it('one variant per table, its note naming the edition, the table, the unit and the source, never a local path', () => {
    const { items } = buildRegisterItems(REGISTER_FILE.records, REGISTERS[FISCAL], 'reference');
    const [group] = groupByVariant(items, REGISTERS[FISCAL]);
    expect(group.variant).toBe('164');
    const meta = registerMeta(REGISTERS[FISCAL], group.report, 'tmp/rbi-handbook/handbook-2024-25.json', '2026-10-15T12:00:00.000Z', fileMeta);
    expect(meta.note).toMatch(/^RBI Handbook of Statistics on Indian States, 2024-25 edition \(published 11 Dec 2025\); state level\. Table 164: State-wise Gross Fiscal Deficit \(₹ Crore\)/);
    expect(meta.note).toMatch(/Source: 'Handbook of Statistics on State Government Finances-2010'/);
    expect(meta.note).toMatch(/a reload replaces this table/);
    expect(meta.note).not.toMatch(/\/Users|Downloads/);
    expect(meta.links).toEqual([HANDBOOK.listingUrl, HANDBOOK_TABLES.get(164).url]);
    expect(meta.coverage).toEqual({ from: '2025-12-11', through: '2025-12-11', exhaustive: false });
  });

  it('main: a dry run of a handbook module reads the JSON and never makes a database client', async () => {
    const out = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
    const deps = { env: {}, readJson: vi.fn(() => ({ rows: REGISTER_FILE.records, meta: fileMeta })), readRows: vi.fn(), makeLocalRpc: vi.fn(), makeProdRpc: vi.fn(), forceDue: vi.fn() };
    await expect(main(['--module', FISCAL], deps)).resolves.toBe(0);
    expect(deps.readJson).toHaveBeenCalledTimes(1);
    expect(deps.readRows).not.toHaveBeenCalled();
    expect(deps.makeLocalRpc).not.toHaveBeenCalled();
    expect(deps.makeProdRpc).not.toHaveBeenCalled();
    expect(out.join('\n')).toMatch(/DRY RUN: state:State Fiscal Deep-Dive \(register: reference, one store variant per table/);
    expect(out.join('\n')).toMatch(/1 store variants, \d+ items/);
    vi.restoreAllMocks();
  });

  it('main: the production gate refuses before the JSON is read', async () => {
    const deps = { env: {}, readJson: vi.fn(), makeProdRpc: vi.fn() };
    await expect(main(['--module', ECON, '--apply', '--target', 'prod'], deps)).rejects.toThrow(/needs SUPABASE_URL and SUPABASE_SECRET_KEY/);
    await expect(main(['--module', ECON, '--apply', '--target', 'prod'], { ...deps, env: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'k' } })).rejects.toThrow(/add --confirm-prod/);
    expect(deps.readJson).not.toHaveBeenCalled();
    expect(deps.makeProdRpc).not.toHaveBeenCalled();
  });

  it('readRegisterJson takes the fetcher\'s file as it writes it', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'hb-')), 'handbook.json');
    writeFileSync(path, JSON.stringify(REGISTER_FILE));
    const { rows, meta } = readRegisterJson(path);
    expect(rows).toHaveLength(REGISTER_FILE.records.length);
    expect(meta.tables.get(21).unit).toBe('₹ Lakh');
    writeFileSync(path, '{"tables":[]}');
    expect(() => readRegisterJson(path)).toThrow(/no records list/);
  });
});

describe('serving: the stored table, else the table\'s page', () => {
  const LOADED = '2026-01-10T00:00:00.000Z';
  const NOW = { now: () => Date.parse('2026-10-15T10:00:00.000Z') };
  // F201: feed_page pages a variant by offset (the store reads a handbook variant whole, four pages at once).
  const page = (variant, offset = 0, limit = STORE_PAGE_ROWS) => ({
    tier: 'state', feature: 'State Economic Data (GSDP, sectors)', variant, class: 'register', kind: 'reference', serve: true,
    fetched_at: LOADED, interval_minutes: 43200, total: T21.records.length,
    meta: { note: 'Table 21', links: [HANDBOOK.listingUrl], coverage: { from: '2025-12-11', through: '2025-12-11', exhaustive: false }, adapter: 'register', kind: 'register', fetched_at: LOADED },
    items: T21.records.slice(offset, offset + limit).map((row) => ({ item_key: handbookItemKey(row), row })),
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('serves the table\'s variant whatever its age, labelled as a register dated by the publication', async () => {
    const rpc = vi.fn(async (_n, args) => page(args.p_variant, args.p_offset, args.p_limit));
    const body = await serveFromStore(ECON, new URLSearchParams({ tier: 'state', feature: 'State Economic Data (GSDP, sectors)' }), { rpc, ...NOW });
    expect(rpc).toHaveBeenCalledWith('feed_page', { p_tier: 'state', p_feature: 'State Economic Data (GSDP, sectors)', p_variant: '21', p_limit: STORE_PAGE_ROWS, p_offset: 0 });
    expect(body).toMatchObject({ served: 'store', register: true, fallback: false });
    expect(asOfLabel(body)).toBe('register · as of 11 Dec 2025');
  });

  it('the live path reads only the table asked for, from its page, and says what it is', async () => {
    resetFeedCache();
    const fetch = vi.fn(async (u) => ({ ok: true, status: 200, url: String(u), headers: new Headers({ 'content-type': 'text/html' }), arrayBuffer: async () => new TextEncoder().encode(fixture('handbook-t164-gfd.html')).buffer }));
    vi.stubGlobal('fetch', fetch);
    const body = await serveFeatureFeed(new URLSearchParams({ tier: 'state', feature: 'State Fiscal Deep-Dive', table: '164' }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toBe(HANDBOOK_TABLES.get(164).url);
    expect(body.source.adapter).toBe('api');
    expect(body.rows.length).toBe(T164.records.length);
    expect(body.source.note).toMatch(/^RBI Handbook of Statistics on Indian States, 2024-25 edition \(published 11 Dec 2025\); state level\. Table 164/);
    expect(body.meta).toMatchObject({ table: 164, as_of: '2025-12-11' });
    expect(asOfLabel(body)).toBe('as of 11 Dec 2025');
  });

  it('two tables asked for at once get their own answers (the live attempt is shared per table, not per module)', async () => {
    resetFeedCache();
    const byUrl = { [HANDBOOK_TABLES.get(164).url]: fixture('handbook-t164-gfd.html'), [HANDBOOK_TABLES.get(178).url]: fixture('handbook-t178-borrowings.html') };
    vi.stubGlobal('fetch', vi.fn(async (u) => {
      await new Promise((r) => setTimeout(r, 20));
      return { ok: true, status: 200, url: String(u), headers: new Headers(), arrayBuffer: async () => new TextEncoder().encode(byUrl[String(u)] || '').buffer };
    }));
    const ask = (table) => serveFeatureFeedWithinLimit(new URLSearchParams({ tier: 'state', feature: 'State Fiscal Deep-Dive', table }), { limitMs: 3000 });
    const [a, b] = await Promise.all([ask('164'), ask('178')]);
    expect([a.meta?.table, b.meta?.table]).toEqual([164, 178]);
  });

  it('a page that is not the table (an error or a block page) is a plain status row, never other figures', async () => {
    resetFeedCache();
    vi.stubGlobal('fetch', vi.fn(async (u) => ({ ok: true, status: 200, url: String(u), headers: new Headers(), arrayBuffer: async () => new TextEncoder().encode('<html>Please verify you are human</html>').buffer })));
    const body = await serveFeatureFeed(new URLSearchParams({ tier: 'state', feature: 'NITI Aayog State Indices' }));
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].status).toBe('source_status');
    expect(body.source.note).toMatch(/Table 106: State-wise Sustainable Development Goals \(SDGs\) Score could not be read right now\. No figures were invented\./);
  });
});

describe('Cross-State Comparison Engine', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('ranks the states of each indicator for its latest year, highest first, All India unranked, with the year before', () => {
    const rows = compareStates(T164.records);
    expect(rows.map((r) => [r.rank ?? '-', r.state, r.year, r.value])).toEqual([
      [1, 'Delhi', '2024-25', 6565],
      [2, 'Arunachal Pradesh', '2024-25', 2993],
      [3, 'Puducherry', '2024-25', 1113],
      ['-', 'All India', '2024-25', 1039138],
    ]);
    const delhi = rows.find((r) => r.state === 'Delhi');
    expect(delhi).toMatchObject({ rank: 1, of: 3, previous_year: '2023-24', previous_value: 7878, change_pct: -16.7, estimate: 'Budget Estimates', unit: '₹ Crore' });
    expect(rows.find((r) => r.state === 'All India')).toMatchObject({ aggregate: true, value: 1039138 });
    expect(rows.find((r) => r.state === 'All India').rank).toBeUndefined();
  });

  it('a year asked for is used where the indicator has it; ties share a rank', () => {
    const rows = compareStates(T164.records, { year: '2006-07' });
    expect(rows.find((r) => r.state === 'Arunachal Pradesh')).toMatchObject({ year: '2006-07', value: -106, rank: 3 });
    const tie = compareStates([
      { state: 'Goa', indicator: 'X', year: '2024', value: 5 }, { state: 'Bihar', indicator: 'X', year: '2024', value: 5 }, { state: 'Assam', indicator: 'X', year: '2024', value: 1 },
    ]);
    expect(tie.map((r) => [r.state, r.rank])).toEqual([['Bihar', 1], ['Goa', 1], ['Assam', 3]]);
  });

  it('reads the table from its page when the store is not configured, and offers every handbook table', async () => {
    // Not configured on purpose: another file in the shared test process can leave these set.
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SECRET_KEY', '');
    resetFeedCache();
    const fetch = vi.fn(async (u) => ({ ok: true, status: 200, url: String(u), headers: new Headers(), arrayBuffer: async () => new TextEncoder().encode(fixture('handbook-t21-gsdp.html')).buffer }));
    vi.stubGlobal('fetch', fetch);
    const body = await serveFeatureFeed(new URLSearchParams({ tier: 'state', feature: 'Cross-State Comparison Engine' }));
    expect(String(fetch.mock.calls[0][0])).toBe(HANDBOOK_TABLES.get(21).url);
    expect(body.rows[0]).toMatchObject({ rank: 1, state: 'Andhra Pradesh', year: '2024-25', value: 159306198 });
    expect(body.source.note).toMatch(/rank 1 is the largest figure, not the best/);
    const picker = modulePicker('state', 'Cross-State Comparison Engine');
    expect(picker).toMatchObject({ param: 'table', defaultValue: '21' });
    const offered = new Set(picker.options.map((o) => Number(o.value)));
    for (const spec of Object.values(HANDBOOK_MODULES)) for (const no of spec.tables) expect(offered.has(no), String(no)).toBe(true);
    expect(picker.options.length).toBe(offered.size);
  });
});

describe('the Table control', () => {
  it('lists a module\'s tables by number and title; nothing on other modules; MLA Directory keeps its own control', () => {
    const picker = modulePicker('state', 'District Education Indicators');
    expect(picker.options.map((o) => o.label)).toEqual([
      'Table 1: State-wise Gross Enrolment Ratio',
      'Table 12: State-wise Gender Parity Index of Gross Enrolment Ratio by Level of School Education',
      'Table 151: State-wise Number of Schools by Management and Availability of Functional Computer Facility',
    ]);
    expect(modulePicker('state', 'Cabinet Decisions')).toBeNull();
    expect(modulePicker('state', 'MLA Directory')).toBeNull();
    expect(handbookModuleFor('national', 'State Fiscal Deep-Dive')).toBeNull();
    const html = renderToStaticMarkup(createElement(ModulePicker, { picker: modulePicker('state', 'Cross-State Comparison Engine'), value: '', onChange: () => {} }));
    expect(html).toMatch(/<label for="comparison-table">Table<\/label>/);
    expect(html).toMatch(/<optgroup label="State Economic Data \(GSDP, sectors\)">/);
    expect(html).toMatch(/<optgroup label="State Health &amp; Nutrition Indicators">/);
    expect(html).toMatch(/<option value="21" selected="">Table 21: Gross State Domestic Product \(Current Prices\)<\/option>/);
  });
});

describe('scripts/fetch-rbi-handbook.mjs', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rbi-hb-'));
  });

  it('a challenge, an error or a page of another kind stops the run; nothing is retried', async () => {
    expect(refusal(200, '<html>Please complete the CAPTCHA</html>', 'table')).toBe('a challenge or block page');
    expect(refusal(403, '', 'table')).toBe('HTTP 403');
    expect(refusal(200, '<html>no table</html>', 'table')).toBe('not a table page');
    const fetchImpl = vi.fn(async () => ({ status: 200, text: async () => '<html>captcha</html>' }));
    await expect(fetchMain(['--html-dir', dir, '--out', join(dir, 'o.json'), '--tables', '21'], { fetchImpl, log: () => {} })).rejects.toThrow(/challenge or block page; stopping \(nothing is retried\)/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('compares the listing with the edition the modules expect', () => {
    const tables = [...HANDBOOK_TABLES.values()].map((t) => ({ no: t.no, id: t.id, title: t.title }));
    expect(compareListing({ published: HANDBOOK.published, tables })).toEqual([]);
    const moved = tables.map((t) => (t.no === 21 ? { ...t, id: 99999, title: 'GSDP' } : t));
    expect(compareListing({ published: '2026-12-10', tables: moved })).toEqual([
      'the listing\'s latest edition is dated 2026-12-10, src/lib/rbiHandbookTables.js has 2025-12-11',
      'Table 21: page id 99999 on the listing, 23470 here',
      'Table 21: "GSDP" on the listing, "Gross State Domestic Product (Current Prices)" here',
    ]);
  });

  it('fetches the listing and the tables one at a time, as NiyantranTerminal, and writes the register', async () => {
    const listing = `<td class="tableheader"><b>Dec 11, 2025<b></td>${[...HANDBOOK_TABLES.values()].map((t) => `<a href=PublicationsView.aspx?id=${t.id}>Table ${t.no}: ${t.title}</a>`).join('')}`;
    const pages = { [HANDBOOK.listingUrl]: listing, [HANDBOOK_TABLES.get(21).url]: fixture('handbook-t21-gsdp.html'), [HANDBOOK_TABLES.get(164).url]: fixture('handbook-t164-gfd.html') };
    const fetchImpl = vi.fn(async (url) => ({ status: 200, text: async () => pages[url] }));
    const out = join(dir, 'handbook.json');
    const lines = [];
    await expect(fetchMain(['--html-dir', dir, '--out', out, '--tables', '21,164', '--delay-ms', '1000'], { fetchImpl, log: (l) => lines.push(l) })).resolves.toBe(0);
    expect(fetchImpl.mock.calls.map(([u]) => u)).toEqual([HANDBOOK.listingUrl, HANDBOOK_TABLES.get(21).url, HANDBOOK_TABLES.get(164).url]);
    expect(fetchImpl.mock.calls.every(([, init]) => /NiyantranTerminal/.test(init.headers['User-Agent']))).toBe(true);
    const written = JSON.parse(readFileSync(out, 'utf8'));
    expect(written).toMatchObject({ edition: '2024-25', published: '2025-12-11' });
    expect(written.records).toHaveLength(T21.records.length + T164.records.length);
    expect(moduleCounts(written).find((m) => m.id === ECON)).toMatchObject({ records: T21.records.length, largestNo: 21 });
    // A second run reads the saved pages and asks RBI nothing.
    fetchImpl.mockClear();
    await expect(fetchMain(['--html-dir', dir, '--out', out, '--tables', '21,164', '--offline'], { fetchImpl, log: () => {} })).resolves.toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  }, 20_000);
});

// F196 review R1: one stored variant is one store page (500 figures), so a table larger than that keeps
// its newest whole years and every year shown has every state; the Comparison never ranks a cut year.
// A synthetic Table 164 page: the 36 states and union territories over 15 years is 540 figures, so a cut
// at 500 lands inside the 14th year (500 = 13 x 36 + 32).
const fiscalYear = (y) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
const BIG_YEARS = Array.from({ length: 15 }, (_, i) => fiscalYear(2010 + i));
// F201: 60 years (1965-66 to 2024-25) of 36 states is 2,160 figures, more than one store variant holds.
const HUGE_YEARS = Array.from({ length: 60 }, (_, i) => fiscalYear(1965 + i));
function bigTablePage(years = BIG_YEARS) {
  const head = `<tr class="head"><td align="center">State/Union Territory</td>${years.map((y) => `<td align="center">${y}</td>`).join('')}</tr>`;
  const body = HANDBOOK_STATES.map((s, i) => `<tr><td>${s}</td>${years.map((_y, j) => `<td align="right">${(i + 1) * 100 + j}</td>`).join('')}</tr>`).join('');
  return `<table class="tablebg"><tr><td align="right" class="tableheader"><b> Date : Dec 11, 2025</b></td></tr><tr><td align="center" class="tableheader"><b>Table 164: State-wise Gross Fiscal Deficit</b></td></tr><tr><td><table class="tablebg"><tr><td colspan="${years.length + 1}" align="right">(&#8377; Crore)</td></tr>${head}${body}</table></td></tr></table>`;
}
// F201: one year of 56 categories for 36 states is 2,016 figures in a single year.
function hugeYearPage() {
  const cats = Array.from({ length: 56 }, (_, i) => `Category ${i + 1}`);
  const head = `<tr class="head"><td align="center" rowspan="2">State/Union Territory</td>${cats.map((c) => `<td align="center">${c}</td>`).join('')}</tr><tr class="head">${cats.map(() => '<td align="center">2024-25</td>').join('')}</tr>`;
  const body = HANDBOOK_STATES.map((s, i) => `<tr><td>${s}</td>${cats.map((_c, j) => `<td align="right">${(i + 1) * 100 + j}</td>`).join('')}</tr>`).join('');
  return `<table class="tablebg"><tr><td align="right" class="tableheader"><b> Date : Dec 11, 2025</b></td></tr><tr><td align="center" class="tableheader"><b>Table 164: State-wise Gross Fiscal Deficit</b></td></tr><tr><td><table class="tablebg"><tr><td colspan="57" align="right">(&#8377; Crore)</td></tr>${head}${body}</table></td></tr></table>`;
}
async function fetchOffline(html) {
  const dir = mkdtempSync(join(tmpdir(), 'rbi-hb-f201-'));
  writeFileSync(join(dir, `${HANDBOOK_TABLES.get(164).id}.html`), html);
  const out = join(dir, 'handbook.json');
  const lines = [];
  const code = await fetchMain(['--html-dir', dir, '--out', out, '--tables', '164', '--offline'], { fetchImpl: vi.fn(), log: (l) => lines.push(l) });
  return { code, lines, out };
}
const perYear = (rows) => rows.reduce((m, r) => m.set(r.year, (m.get(r.year) || 0) + 1), new Map());
const servePage = (html) => vi.fn(async (u) => ({ ok: true, status: 200, url: String(u), headers: new Headers(), arrayBuffer: async () => new TextEncoder().encode(html).buffer }));

describe('F196 review R1: a table larger than one store page', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const BIG = parseHandbookTable(bigTablePage(), { tableNo: 164 });

  it('the fixture would be cut inside a year at one page', () => {
    expect(BIG.records).toHaveLength(540);
    expect(perYear(BIG.records.slice(0, STORE_PAGE_ROWS)).get('2011-12')).toBe(32);
  });

  // F201 (replaces the F196 review R1 cap): the fetcher writes every figure; the blocks a table is
  // stored in are whole years, so no year is ever partly kept.
  it('the fetcher writes every figure of a table, with no cut, and lists the table\'s blocks', async () => {
    const { code, out, lines } = await fetchOffline(bigTablePage());
    expect(code).toBe(0);
    const file = readRegisterJson(out);
    expect(file.rows).toHaveLength(540);
    const summary = file.meta.tables.get(164);
    expect(summary.cut).toBeUndefined();
    expect(summary.dropped.older_years).toBeUndefined();
    expect(summary.blocks).toEqual([{ value: '', variant: '164', from: '2010-11', through: '2024-25', count: 540 }]);
    expect(lines.join('\n')).toMatch(/Table 164:\s+540 records, 1 block \(2010-11 to 2024-25\)/);
  });

  it('a table over 2,000 figures is listed as whole-year blocks, every figure kept', async () => {
    const { code, out, lines } = await fetchOffline(bigTablePage(HUGE_YEARS));
    expect(code).toBe(0);
    const file = readRegisterJson(out);
    expect(file.rows).toHaveLength(2160);
    expect(file.meta.tables.get(164).blocks).toEqual([
      { value: '', variant: '164', from: '1970-71', through: '2024-25', count: 1980 },
      { value: '1965-66', variant: '164@1965-66', from: '1965-66', through: '1969-70', count: 180 },
    ]);
    expect(lines.join('\n')).toMatch(/2160 records, 2 blocks \(1970-71 to 2024-25: 1980; 1965-66 to 1969-70: 180\)/);
  });

  it('one year over 2,000 figures is reported and the run exits 1; nothing is cut', async () => {
    const { code, out, lines } = await fetchOffline(hugeYearPage());
    expect(code).toBe(1);
    const file = readRegisterJson(out);
    expect(file.rows).toHaveLength(2016);
    expect(file.meta.tables.get(164).blocks).toBeUndefined();
    expect(lines.join('\n')).toMatch(/MISMATCH Table 164: 2024-25: 2016 figures in one year, over the 2000 one block holds/);
  });

  // F201: the live path shows the table's whole history when it fits one block (2,000 figures).
  it('the live path shows every figure of a table in one block, and says so', async () => {
    resetFeedCache();
    vi.stubGlobal('fetch', servePage(bigTablePage()));
    const body = await serveFeatureFeed(new URLSearchParams({ tier: 'state', feature: 'State Fiscal Deep-Dive', table: '164' }));
    expect(body.rows).toHaveLength(540);
    expect([...perYear(body.rows).values()].every((n) => n === 36)).toBe(true);
    expect(body.coverage).toEqual({ from: '2010-11', through: '2024-25', exhaustive: false });
    expect(body.source.note).toMatch(/Table 164: State-wise Gross Fiscal Deficit \(₹ Crore\): all 540 figures, 2010-11 to 2024-25\./);
    expect(body.meta).toMatchObject({ table: 164, block: { from: '2010-11', through: '2024-25' }, years: [...BIG_YEARS].reverse() });
    expect(body.meta.blocks).toHaveLength(1);
  });

  it('F201: the live path of a table over 2,000 figures serves the block asked for (`years`), else the newest', async () => {
    resetFeedCache();
    vi.stubGlobal('fetch', servePage(bigTablePage(HUGE_YEARS)));
    const ask = (extra) => serveFeatureFeed(new URLSearchParams({ tier: 'state', feature: 'State Fiscal Deep-Dive', table: '164', ...extra }));
    const newest = await ask({});
    expect(newest.rows).toHaveLength(1980);
    expect(newest.meta.block).toEqual({ from: '1970-71', through: '2024-25' });
    expect(newest.meta.blocks.map((b) => b.value)).toEqual(['', '1965-66']);
    expect(newest.meta.years).toEqual([...HUGE_YEARS].reverse());
    expect(newest.source.note).toMatch(/years 1970-71 to 2024-25, 1,980 of the table's 2,160 figures; older years are under the Years control\./);
    const older = await ask({ years: '1965-66' });
    expect(older.rows).toHaveLength(180);
    expect(new Set(older.rows.map((r) => r.year)).size).toBe(5);
    expect(older.meta.block).toEqual({ from: '1965-66', through: '1969-70' });
    expect(older.coverage).toEqual({ from: '1965-66', through: '1969-70', exhaustive: false });
    // A years value that is not a block's is the newest block.
    expect((await ask({ years: 'junk' })).rows).toHaveLength(1980);
    expect((await ask({ years: '1990-91' })).meta.block.from).toBe('1970-71');
  });

  it('F201: the store\'s blocks reach the page\'s answer', async () => {
    const view = { heading: 'Table 176', table: 176, block: { from: '2023', through: '2025' }, blocks: [{ value: '', variant: '176' }, { value: '2005', variant: '176@2005' }], years: ['2025'] };
    const rpc = vi.fn(async (_n, a) => ({ tier: 'state', feature: 'State Fiscal Deep-Dive', variant: a.p_variant, serve: true, fetched_at: '2026-01-10T00:00:00.000Z', interval_minutes: 43200, total: 1, meta: { view }, items: a.p_offset ? [] : [{ item_key: 'k', row: { state: 'Goa', year: '2025', value: 1 } }] }));
    const body = await serveFeatureFeedStoredFirst(new URLSearchParams({ tier: 'state', feature: 'State Fiscal Deep-Dive', table: '176', years: '2005' }), { store: (id, sp) => serveFromStore(id, sp, { rpc }) });
    expect(rpc.mock.calls[0][1].p_variant).toBe('176@2005');
    expect(body.meta.blocks).toEqual(view.blocks);
  });

  it('the Comparison drops the year a short stored page may have cut, and lists only whole years', () => {
    const page = BIG.records.slice(0, STORE_PAGE_ROWS);
    const whole = wholeYearsOf(page, BIG.records.length);
    expect(whole).toHaveLength(468);
    expect(comparisonYears(whole)).toEqual(BIG_YEARS.slice(2).reverse());
    // A page that holds the whole table is kept as it is.
    expect(wholeYearsOf(BIG.records, BIG.records.length)).toHaveLength(540);
  });

  it('the Comparison shows whole indicators within one page, never part of one indicator\'s ranking', () => {
    const recs = ['A', 'B', 'C'].flatMap((indicator) => ['Goa', 'Bihar', 'Assam'].map((state, i) => ({ state, indicator, year: '2024', value: i })));
    const ranked = compareStates(recs);
    expect(ranked).toHaveLength(9);
    const shown = rankedWithin(ranked, 7);
    expect(shown.rows.map((r) => r.indicator)).toEqual(['A', 'A', 'A', 'B', 'B', 'B']);
    expect(shown).toMatchObject({ indicators: 2, of: 3 });
  });

  it('the Comparison note names no control the page lacks: the latest year is ranked', async () => {
    resetFeedCache();
    vi.stubGlobal('fetch', servePage(bigTablePage()));
    const body = await serveFeatureFeed(new URLSearchParams({ tier: 'state', feature: 'Cross-State Comparison Engine', table: '164' }));
    expect(body.source.note).not.toMatch(/\?year=/);
    expect(body.source.note).toMatch(/each indicator’s latest year is ranked/);
    expect(body.meta.years).toEqual([...BIG_YEARS].reverse());
  });
});

// F196 review R3: the live attempt is shared by requests that get the same answer, so a request cannot
// grow the per-instance maps with tables no module holds or years that are not years.
describe('F196 review R3: the live-attempt key', () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const answer = { ok: true, rows: [], source: { adapter: 'api', links: [], note: '' }, coverage: {}, fallback: false };
  async function attempts(feature, asks) {
    resetFeedCache();
    const live = vi.fn(async () => {
      await sleep(25);
      return answer;
    });
    await Promise.all(asks.map((extra) => serveFeatureFeedWithinLimit(new URLSearchParams({ tier: 'state', feature, ...extra }), { limitMs: 2000, live })));
    return live.mock.calls.length;
  }

  it('a handbook module: a table it does not hold, or a spelling of its first, shares the first table\'s attempt', async () => {
    expect(await attempts('State Fiscal Deep-Dive', [{}, { table: '999' }, { table: '164' }, { table: 'T164' }, { table: '21' }])).toBe(1);
    expect(await attempts('State Fiscal Deep-Dive', [{}, { table: '176' }])).toBe(2);
    // A year is the Comparison's alone.
    expect(await attempts('State Fiscal Deep-Dive', [{}, { year: '2024-25' }])).toBe(1);
  });

  it('F201: a block (`years`) is its own attempt only when it is a real year; anything else shares the newest block\'s', async () => {
    const next = new Date().getFullYear() + 1;
    expect(await attempts('State Fiscal Deep-Dive', [{ table: '176' }, { table: '176', years: 'junk' }, { table: '176', years: '2005; x' }, { table: '176', years: '1899' }, { table: '176', years: '2005-20' }, { table: '176', years: `${next + 1}` }, { table: '176', years: '' }])).toBe(1);
    expect(await attempts('State Fiscal Deep-Dive', [{ table: '176' }, { table: '176', years: '2005' }, { table: '176', years: '2008' }, { table: '176', years: '2019-20' }])).toBe(4);
  });

  it('the Comparison: an unknown table is Table 21; only a real year (YYYY or YYYY-YY, 1990 to next year) is its own', async () => {
    const next = new Date().getFullYear() + 1;
    expect(await attempts('Cross-State Comparison Engine', [{}, { table: '999' }, { table: '21' }, { year: '2099' }, { year: 'junk' }, { year: '2024-26' }, { year: '1989-90' }, { year: `${next + 1}` }])).toBe(1);
    expect(await attempts('Cross-State Comparison Engine', [{}, { year: '2024-25' }, { year: '2024' }, { year: '1999-00' }, { table: '164' }])).toBe(5);
  });

  it('any other state module ignores table and year', async () => {
    expect(await attempts('SDL Auction & Borrowing Tracker', [{}, { table: '12' }, { year: '2024' }])).toBe(1);
  });
});

// F201: every figure stored, a table over 2,000 figures as whole-year blocks (one store variant each).
// Synthetic records shaped like Table 176 (2024-25 edition): 21 years, 2005 to 2025, of 19 indicators x
// 32 states = 608 figures each, 12,768 in all.
const T176_YEARS = Array.from({ length: 21 }, (_, i) => String(2025 - i));
const T176_STATES = HANDBOOK_STATES.slice(0, 32);
const T176_URL = HANDBOOK_TABLES.get(176).url;
const t176Records = () => T176_YEARS.flatMap((year) => Array.from({ length: 19 }, (_, k) => k).flatMap((k) => T176_STATES.map((state, s) => ({
  state, indicator: k === 0 ? 'Outstanding Liabilities' : `Indicator ${k}`, year, value: 1000 * k + s + Number(year), unit: 'Per cent', table_no: 176,
  table_title: HANDBOOK_TABLES.get(176).title, source_url: T176_URL, as_of: '2025-12-11', edition: '2024-25', title: `${state} · ${k} · ${year}`,
}))));
const T176_RECORDS = t176Records();
const BLOCKED_FILE = { records: [...T164.records, ...T176_RECORDS], tables: [...REGISTER_FILE.tables, { no: 176, title: HANDBOOK_TABLES.get(176).title, unit: 'Per cent', source: 'Finances of State Governments', records: T176_RECORDS.length }] };
const blockedMeta = { tables: new Map(BLOCKED_FILE.tables.map((t) => [t.no, t])) };

describe('F201: the registers and the loader by block', () => {
  afterEach(() => vi.restoreAllMocks());

  it('each handbook register reads a whole variant, takes a block of a table it holds, and names its runs', () => {
    const fiscal = FEED_REGISTERS[FISCAL];
    expect(fiscal.wholeVariant).toBe(true);
    expect(fiscal.variantOf('176@2005')).toBe('176@2005');
    expect(fiscal.variantOf('176')).toBe('176');
    expect(fiscal.variantOf('21@2005')).toBe('');
    expect(fiscal.variantOf('176@junk')).toBe('');
    const q = (o) => new URLSearchParams(o);
    expect(fiscal.variantFrom(q({ table: '176', years: '2005' }))).toBe('176@2005');
    expect(fiscal.variantFrom(q({ table: '176', years: 'junk' }))).toBe('176');
    expect(fiscal.variantFrom(q({ table: '21', years: '2005' }))).toBe('164');
    expect(fiscal.variantFrom(q({}))).toBe('164');
    expect(registerRunsForDb(FISCAL, ['176', '176@2005']).map((r) => [r.variant, r.kind, r.class])).toEqual([['176', 'reference', 'register'], ['176@2005', 'reference', 'register']]);
    expect(registerRunsForDb(FISCAL)).toHaveLength(15);
    // MLA Directory is not a handbook register: no whole-variant reads.
    expect(FEED_REGISTERS['state:MLA Directory'].wholeVariant).toBeUndefined();
  });

  it('a table over 2,000 figures loads as whole-year blocks, the newest named by the table, each at most 2,000', () => {
    const { items } = buildRegisterItems(BLOCKED_FILE.records, REGISTERS[FISCAL], 'reference');
    const groups = groupByVariant(items, REGISTERS[FISCAL]);
    expect(groups.map((g) => [g.variant, g.items.length])).toEqual([
      ['164', T164.records.length],
      ['176', 1824], ['176@2020', 1824], ['176@2017', 1824], ['176@2014', 1824], ['176@2011', 1824], ['176@2008', 1824], ['176@2005', 1824],
    ]);
    const newest = groups[1];
    expect(new Set(newest.items.map((i) => i.row.year))).toEqual(new Set(['2025', '2024', '2023']));
    expect(new Set(newest.items.map((i) => i.row.indicator)).size).toBe(19);
    // The stored view: the table, its own block, the table's blocks and all of its years.
    const view = newest.report.view;
    expect(view).toMatchObject({ heading: 'Table 176: State-wise Composition of Outstanding Liabilities', table: 176, block: { from: '2023', through: '2025' }, as_of: '2025-12-11', status: 'RBI HANDBOOK · STATE LEVEL' });
    expect(view.blocks.map((b) => b.variant)).toEqual(['176', '176@2020', '176@2017', '176@2014', '176@2011', '176@2008', '176@2005']);
    expect(view.years).toEqual(T176_YEARS);
    expect(groups[7].report.view.block).toEqual({ from: '2005', through: '2007' });
    const meta = registerMeta(REGISTERS[FISCAL], newest.report, 'tmp/rbi-handbook/handbook-2024-25.json', '2026-10-15T12:00:00.000Z', blockedMeta);
    expect(meta.view).toEqual(view);
    expect(JSON.stringify(meta.view).length).toBeLessThan(4096);
    expect(meta.note).toMatch(/Table 176: State-wise Composition of Outstanding Liabilities \(Per cent\): years 2023 to 2025, 1,824 of the table's 12,768 figures; older years are under the Years control\./);
    const oldest = registerMeta(REGISTERS[FISCAL], groups[7].report, 'x.json', '2026-10-15T12:00:00.000Z', blockedMeta);
    expect(oldest.note).toMatch(/years 2005 to 2007, 1,824 of the table's 12,768 figures; other years are under the Years control\./);
    // A table in one block: all of its figures.
    const one = registerMeta(REGISTERS[FISCAL], groups[0].report, 'x.json', '2026-10-15T12:00:00.000Z', blockedMeta);
    expect(one.view.blocks).toHaveLength(1);
    expect(one.note).toMatch(new RegExp(`Table 164: State-wise Gross Fiscal Deficit \\(₹ Crore\\): all ${T164.records.length} figures, ${one.view.years.at(-1)} to ${one.view.years[0]}\\.`));
  });

  it('a dry run counts the blocks as variants and never makes a database client', async () => {
    const out = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
    const deps = { env: {}, readJson: vi.fn(() => ({ rows: BLOCKED_FILE.records, meta: blockedMeta })), makeLocalRpc: vi.fn(), makeProdRpc: vi.fn(), forceDue: vi.fn() };
    await expect(main(['--module', FISCAL], deps)).resolves.toBe(0);
    expect(deps.makeProdRpc).not.toHaveBeenCalled();
    expect(out.join('\n')).toMatch(new RegExp(`8 store variants, ${T164.records.length + 12768} items`));
    expect(out.join('\n')).toMatch(/176@2005\s+1824/);
  });

  describe('a load', () => {
    const ENV = { SUPABASE_URL: 'https://example-project.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_TESTKEY' };
    const TOKEN = '44444444-4444-4444-8444-444444444444';
    function setup({ stored = {}, makeDue = () => true } = {}) {
      const calls = [];
      const rpc = vi.fn(async (name, args) => {
        calls.push([name, args]);
        if (name === 'feed_claim_due') return [{ ...args.p_runs[0], lease_token: TOKEN }];
        if (name === 'feed_record') return { status: 'ok', items: args.p.items.length, new_items: args.p.items.length };
        if (name === 'feed_page') return stored[args.p_variant] ? { total: 1, serve: true, meta: { view: { blocks: stored[args.p_variant].map((variant) => ({ variant })) } }, items: [] } : null;
        if (name === 'feed_make_due') return makeDue(args.p_variant);
        return null;
      });
      const deps = { env: ENV, readJson: vi.fn(() => ({ rows: BLOCKED_FILE.records, meta: blockedMeta })), makeLocalRpc: vi.fn(() => rpc), makeProdRpc: vi.fn(() => rpc), forceDue: vi.fn(async () => {}) };
      return { deps, calls };
    }
    let out;
    beforeEach(() => {
      out = [];
      vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
    });

    it('records each block on its own run; blocks the store holds that this load does not produce are reported with the SQL to stop serving them, and nothing is written for them', async () => {
      const { deps, calls } = setup({ stored: { 176: ['176', '176@2020', '176@2002', "176@1999'; drop table x; --"] } });
      await expect(main(['--module', FISCAL, '--apply', '--target', 'prod', '--confirm-prod'], deps)).resolves.toBe(4);
      const recorded = calls.filter(([n]) => n === 'feed_record').map(([, a]) => [a.p.variant, a.p.items.length]);
      expect(recorded).toHaveLength(8);
      expect(recorded.every(([, n]) => n <= 2000)).toBe(true);
      expect(calls.some(([n, a]) => /176@2002/.test(JSON.stringify(a)) && n !== 'feed_page')).toBe(false);
      // F201 lifecycle (Task D, 2026-10-16): a block a stored view names but the store does not hold
      // is not obsolete; the fake store holds none of this load's blocks afterwards, so the run ends
      // with exit 4 (blocks not yet consistent) and plans no serve switch. Hostile names never reach
      // the output. Orphans the store does hold: feedRegister.test.js.
      const text = out.join('\n');
      expect(text).toMatch(/Obsolete blocks: none/);
      expect(text).toMatch(/Blocks are NOT consistent: exit 4/);
      expect(text).not.toContain('drop table');
    });

    it('nothing obsolete: says so', async () => {
      const { deps } = setup({ stored: { 176: ['176', '176@2020'] } });
      await expect(main(['--module', FISCAL, '--apply', '--target', 'prod', '--confirm-prod'], deps)).resolves.toBe(4);
      expect(out.join('\n')).toMatch(/Obsolete blocks: none/);
    });

    it('--force on prod: a block the store has never seen cannot be made due, and is still claimed and recorded', async () => {
      const { deps, calls } = setup({ makeDue: (v) => !v.includes('@') });
      await expect(main(['--module', FISCAL, '--apply', '--target', 'prod', '--confirm-prod', '--force'], deps)).resolves.toBe(4);
      expect(out.join('\n')).toMatch(/176@2005\s+not made due/);
      expect(calls.filter(([n]) => n === 'feed_record').map(([, a]) => a.p.variant)).toContain('176@2005');
      const claims = calls.filter(([n]) => n === 'feed_claim_due').map(([, a]) => a.p_runs[0].variant);
      expect(claims).toEqual(['164', '176', '176@2020', '176@2017', '176@2014', '176@2011', '176@2008', '176@2005']);
    });
  });
});

// F201: the Comparison ranks any year of a table, reading the block that holds it (and the block before
// when the year before is there). The fake store holds what the loader would record for State Fiscal
// Deep-Dive (Table 164 whole, Table 176 in 7 blocks), served by feed_page windows as the database does.
describe('F201: the Comparison ranks any year', () => {
  const LOADED = '2026-01-10T00:00:00.000Z';
  function fakeStore(file = BLOCKED_FILE, fileMetaOf = blockedMeta) {
    const { items } = buildRegisterItems(file.records, REGISTERS[FISCAL], 'reference');
    const byVariant = new Map(groupByVariant(items, REGISTERS[FISCAL]).map((g) => [g.variant, { g, meta: registerMeta(REGISTERS[FISCAL], g.report, 'x.json', LOADED, fileMetaOf) }]));
    const rpc = vi.fn(async (_n, a) => {
      const hit = byVariant.get(a.p_variant);
      if (!hit) return null;
      return {
        tier: 'state', feature: 'State Fiscal Deep-Dive', variant: a.p_variant, class: 'register', kind: 'reference', serve: true, fetched_at: LOADED, interval_minutes: 43200,
        total: hit.g.items.length, meta: hit.meta, items: hit.g.items.slice(a.p_offset, a.p_offset + a.p_limit).map((i) => ({ item_key: i.item_key, row: i.row })),
      };
    });
    return { rpc, store: (id, sp) => serveFromStore(id, sp, { rpc, now: () => Date.parse('2026-10-15T00:00:00.000Z') }) };
  }
  const compare = (params, store) => serveFeatureFeed(new URLSearchParams({ tier: 'state', feature: 'Cross-State Comparison Engine', table: '176', ...params }), { store });
  const variantsRead = (rpc) => [...new Set(rpc.mock.calls.map(([, a]) => a.p_variant))];
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('2023 (its block\'s oldest year): all 19 indicators ranked, the year before (2022) read from the older block', async () => {
    const { rpc, store } = fakeStore();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no live read'); }));
    const body = await compare({ year: '2023' }, store);
    expect(variantsRead(rpc)).toEqual(['176', '176@2020']);
    expect(body.source.adapter).toBe('register');
    expect(body.rows).toHaveLength(19 * 32);
    expect(new Set(body.rows.map((r) => r.indicator)).size).toBe(19);
    expect(body.rows.some((r) => r.indicator === 'Outstanding Liabilities')).toBe(true);
    expect(body.rows.every((r) => r.year === '2023' && r.previous_year === '2022')).toBe(true);
    expect(body.meta.years).toEqual(T176_YEARS);
    expect(body.source.note).toMatch(/2023 where an indicator has it/);
    expect(body.source.note).toMatch(/the Year control/);
  });

  it('2015 is ranked from block 176@2014 alone; no year ranks each indicator\'s latest from the newest block', async () => {
    let { rpc, store } = fakeStore();
    const body = await compare({ year: '2015' }, store);
    expect(variantsRead(rpc)).toEqual(['176', '176@2014']);
    expect(body.rows.every((r) => r.year === '2015' && r.previous_year === '2014')).toBe(true);
    ({ rpc, store } = fakeStore());
    const latest = await compare({}, store);
    expect(variantsRead(rpc)).toEqual(['176']);
    expect(latest.rows).toHaveLength(19 * 32);
    expect(latest.rows.every((r) => r.year === '2025' && r.previous_year === '2024')).toBe(true);
    expect(latest.source.note).toMatch(/each indicator’s latest year is ranked/);
  });

  it('a table in one block reads one variant for any year', async () => {
    const { rpc, store } = fakeStore();
    const body = await compare({ table: '164', year: '2006-07' }, store);
    expect(variantsRead(rpc)).toEqual(['164']);
    expect(body.rows.find((r) => r.state === 'Arunachal Pradesh')).toMatchObject({ year: '2006-07', value: -106 });
  });

  it('today\'s capped data (one variant of 480 figures, no other blocks) still ranks what it holds', async () => {
    // F196's cap kept 15 of Table 176's indicators of its newest year.
    const capped = { records: T176_RECORDS.filter((r) => r.year === '2025').slice(0, 480), tables: BLOCKED_FILE.tables };
    const { rpc, store } = fakeStore(capped);
    const body = await compare({}, store);
    expect(variantsRead(rpc)).toEqual(['176']);
    expect(body.source.adapter).toBe('register');
    expect(body.rows).toHaveLength(480);
    expect(body.meta.years).toEqual(['2025']);
  });

  it('a short stored page (loaded before F196 cut tables to whole years) still loses its cut year (wholeYearsOf)', async () => {
    const rows = T176_RECORDS.filter((r) => r.year >= '2024').slice(0, 1000);
    const store = vi.fn(async () => ({ ok: true, rows, storeTotal: 1216, meta: null, served: 'store', register: true }));
    const body = await compare({}, store);
    expect(store).toHaveBeenCalledTimes(1);
    expect(new Set(body.rows.map((r) => r.year))).toEqual(new Set(['2025']));
  });
});

// F201 review (2026-10-15): a `years` value is not a reason to fetch a table's page again, and the
// answers kept for late callers are bounded.
describe('F201 review: one page fetch per table, bounded kept answers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('any number of `years` values for one table read its RBI page once', async () => {
    resetFeedCache();
    const fetch = vi.fn(async (u) => ({ ok: true, status: 200, url: String(u), headers: new Headers({ 'content-type': 'text/html' }), arrayBuffer: async () => new TextEncoder().encode(fixture('handbook-t164-gfd.html')).buffer }));
    vi.stubGlobal('fetch', fetch);
    for (const years of ['', '2005', '2008', '2019-20', '2019-2020', '1993-97']) {
      await serveFeatureFeed(new URLSearchParams({ tier: 'state', feature: 'State Fiscal Deep-Dive', table: '164', years }));
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    resetFeedCache();
    await serveFeatureFeed(new URLSearchParams({ tier: 'state', feature: 'State Fiscal Deep-Dive', table: '164' }));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a page that failed is asked again on the next request', async () => {
    resetFeedCache();
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (u) => {
      calls += 1;
      if (calls === 1) throw new Error('network down');
      return { ok: true, status: 200, url: String(u), headers: new Headers(), arrayBuffer: async () => new TextEncoder().encode(fixture('handbook-t164-gfd.html')).buffer };
    }));
    const ask = () => serveFeatureFeed(new URLSearchParams({ tier: 'state', feature: 'State Fiscal Deep-Dive', table: '164' }));
    await ask().catch(() => {});
    const body = await ask();
    expect(body.rows.length).toBe(T164.records.length);
  });

  it('kept late answers expire and never exceed their cap, oldest dropped first', () => {
    const kept = new Map();
    keepLateLive(kept, 'old', { rows: [1] }, 0);
    keepLateLive(kept, 'a', { rows: [1] }, LATE_LIVE_MS + 1);
    expect([...kept.keys()]).toEqual(['a']);
    for (let i = 0; i < LATE_LIVE_MAX + 5; i += 1) keepLateLive(kept, `k${i}`, { rows: [1] }, LATE_LIVE_MS + 2);
    expect(kept.size).toBe(LATE_LIVE_MAX);
    expect(kept.has('a')).toBe(false);
    expect(kept.has(`k${LATE_LIVE_MAX + 4}`)).toBe(true);
  });
});
