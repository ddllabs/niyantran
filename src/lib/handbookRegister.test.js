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
import { resetFeedCache, scheduledModuleId, serveFeatureFeed, serveFeatureFeedWithinLimit } from '../../server/featureFeed.mjs';
import {
  REGISTERS, buildRegisterItems, groupByVariant, handbookItemKey, main, mapHandbookRecord, readRegisterJson, registerMeta,
} from '../../scripts/load-feed-register.mjs';
import { MAX_PER_TABLE, buildRegister, compareListing, main as fetchMain, moduleCounts, refusal } from '../../scripts/fetch-rbi-handbook.mjs';
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
  const page = (variant) => ({
    tier: 'state', feature: 'State Economic Data (GSDP, sectors)', variant, class: 'register', kind: 'reference', serve: true,
    fetched_at: LOADED, interval_minutes: 43200, total: T21.records.length,
    meta: { note: 'Table 21', links: [HANDBOOK.listingUrl], coverage: { from: '2025-12-11', through: '2025-12-11', exhaustive: false }, adapter: 'register', kind: 'register', fetched_at: LOADED },
    items: T21.records.map((row) => ({ item_key: handbookItemKey(row), row })),
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('serves the table\'s variant whatever its age, labelled as a register dated by the publication', async () => {
    const rpc = vi.fn(async (_n, args) => page(args.p_variant));
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
const BIG_YEARS = Array.from({ length: 15 }, (_, i) => `${2010 + i}-${String((11 + i) % 100).padStart(2, '0')}`);
function bigTablePage() {
  const head = `<tr class="head"><td align="center">State/Union Territory</td>${BIG_YEARS.map((y) => `<td align="center">${y}</td>`).join('')}</tr>`;
  const body = HANDBOOK_STATES.map((s, i) => `<tr><td>${s}</td>${BIG_YEARS.map((_y, j) => `<td align="right">${(i + 1) * 100 + j}</td>`).join('')}</tr>`).join('');
  return `<table class="tablebg"><tr><td align="right" class="tableheader"><b> Date : Dec 11, 2025</b></td></tr><tr><td align="center" class="tableheader"><b>Table 164: State-wise Gross Fiscal Deficit</b></td></tr><tr><td><table class="tablebg"><tr><td colspan="16" align="right">(&#8377; Crore)</td></tr>${head}${body}</table></td></tr></table>`;
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

  it('the fetcher keeps at most one store page of figures per table', () => {
    expect(MAX_PER_TABLE).toBe(STORE_PAGE_ROWS);
  });

  it('the fetcher records what it left out, and the stored note says how many figures it holds of how many', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rbi-hb-cut-'));
    const t = HANDBOOK_TABLES.get(164);
    writeFileSync(join(dir, `${t.id}.html`), bigTablePage());
    const out = join(dir, 'handbook.json');
    await fetchMain(['--html-dir', dir, '--out', out, '--tables', '164', '--offline'], { fetchImpl: vi.fn(), log: () => {} });
    const file = readRegisterJson(out);
    expect(file.rows).toHaveLength(468);
    expect(file.meta.tables.get(164).cut).toEqual({ left: 72, years: 13, from: '2012-13', through: '2024-25' });
    const { items } = buildRegisterItems(file.rows, REGISTERS[FISCAL], 'reference');
    const [group] = groupByVariant(items, REGISTERS[FISCAL]);
    const meta = registerMeta(REGISTERS[FISCAL], group.report, 'tmp/rbi-handbook/handbook-2024-25.json', '2026-10-15T12:00:00.000Z', file.meta);
    expect(meta.note).toMatch(/: the newest 468 of its 540 figures: 13 whole years, 2012-13 to 2024-25; older years are on the table's page\./);
    const partial = { ...file.meta, tables: new Map([[164, { ...file.meta.tables.get(164), cut: { left: 155, years: 1, from: '2024', through: '2024', partial: { year: '2024', indicators: 16, of: 21 } } }]]) };
    expect(registerMeta(REGISTERS[FISCAL], group.report, 'x.json', '2026-10-15T12:00:00.000Z', partial).note)
      .toMatch(/: 468 figures, 16 of the 21 indicators of 2024 \(each with all of its states\); the rest are on the table's page\./);
  });

  it('the live path shows the newest whole years within one page, every state in each, and says how many it shows', async () => {
    resetFeedCache();
    vi.stubGlobal('fetch', servePage(bigTablePage()));
    const body = await serveFeatureFeed(new URLSearchParams({ tier: 'state', feature: 'State Fiscal Deep-Dive', table: '164' }));
    expect(body.rows).toHaveLength(468);
    expect([...perYear(body.rows).values()].every((n) => n === 36)).toBe(true);
    expect(perYear(body.rows).size).toBe(13);
    expect(body.coverage).toEqual({ from: '2012-13', through: '2024-25', exhaustive: false });
    expect(body.source.note).toMatch(/Showing the newest 468 of its 540 figures: 13 whole years, 2012-13 to 2024-25\./);
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

  it('the Comparison: an unknown table is Table 21; only a real year (YYYY or YYYY-YY, 1990 to next year) is its own', async () => {
    const next = new Date().getFullYear() + 1;
    expect(await attempts('Cross-State Comparison Engine', [{}, { table: '999' }, { table: '21' }, { year: '2099' }, { year: 'junk' }, { year: '2024-26' }, { year: '1989-90' }, { year: `${next + 1}` }])).toBe(1);
    expect(await attempts('Cross-State Comparison Engine', [{}, { year: '2024-25' }, { year: '2024' }, { year: '1999-00' }, { table: '164' }])).toBe(5);
  });

  it('any other state module ignores table and year', async () => {
    expect(await attempts('SDL Auction & Borrowing Tracker', [{}, { table: '12' }, { year: '2024' }])).toBe(1);
  });
});
