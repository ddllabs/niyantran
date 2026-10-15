// F169 phase 4 (C6): scripts/load-feed-register.mjs loads a module's stored register into the feed
// store. The fixture is five real rows of backup/NATIONAL/F25_Cabinet_Decisions.xlsx, as
// server/backupFeed.mjs reads them (the sheet's columns), copied here so no test reads backup/.
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { itemsFromRows } from '../../server/feedStore.mjs';
import { HANDBOOK, HANDBOOK_STATES, HANDBOOK_TABLES } from './rbiHandbookTables.js';
import {
  EXIT_BLOCKS_PENDING,
  KEPT_KINDS,
  REGISTERS,
  buildRegisterItems,
  cleanOutlay,
  ROOT,
  checkOptions,
  compareWithLive,
  displayFile,
  main,
  registerMeta,
  dollarQuote,
  finishCommand,
  liveLink,
  loadRegister,
  localRpc,
  mapCabinetRegisterRow,
  planTable,
  registerLink,
  rpcSql,
  runFor,
  serveSql,
  shrinkReason,
  storedBlocks,
} from '../../scripts/load-feed-register.mjs';

const TITLE_NH22 =
  'Cabinet approves Upgradation of the Muzaffarpur-Sitamarhi-Sonbarsa Section of NH-22 to 4-Lane Standard in Bihar on Hybrid Annuity Mode (HAM) at total Capital Cost of Rs.3590.73 crore';
const sheet = {
  status: 'Approved',
  decision_type: 'Union Cabinet',
  record_completeness_pct: '100.00',
  source_retrieved_at: '46275.47261',
};
// Two PIB releases of one decision on one day (a ministry's and the CCEA's), as the register holds them.
const MINISTRY_RELEASE = {
  ...sheet,
  record_id: 'NYT-25-3d400f6385ad32fa',
  record_title: TITLE_NH22,
  record_date: '2026-08-19',
  title: TITLE_NH22,
  date: '2026-08-19',
  sector: 'transport; agriculture',
  ministry: 'Ministry of Road Transport & Highways',
  official_document_url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2301145&lang=1&reg=3',
  source_url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2301145&lang=1&reg=3',
  posted_at_raw: 'Posted On: 19 AUG 2026 3:25PM by PIB Delhi',
  prid: '2301145',
  financial_outlay_text: 'Rs.3590.73 crore; rs,',
  states_ut: 'Bihar',
  record_age_days: '22',
};
const CCEA_RELEASE = {
  ...MINISTRY_RELEASE,
  record_id: 'NYT-25-0c7fdd6726e53ad3',
  ministry: 'Cabinet Committee on Economic Affairs (CCEA)',
  decision_type: 'Cabinet Committee on Economic Affairs',
  official_document_url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2301144&lang=1&reg=3',
  source_url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2301144&lang=1&reg=3',
  posted_at_raw: 'Posted On: 19 AUG 2026 3:22PM by PIB Delhi',
  prid: '2301144',
};
// The sheet's 16 placeholder rows: a source-coverage title, no date, a PRID from the 2010s.
const PLACEHOLDER = {
  ...sheet,
  record_id: 'NYT-25-5a03e5b1f98dede2',
  record_title: 'Cabinet Decisions source coverage',
  record_date: '',
  title: 'Cabinet Decisions source coverage',
  date: '',
  sector: '',
  ministry: 'Cabinet',
  official_document_url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=216033&lang=1&reg=3',
  source_url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=216033&lang=1&reg=3',
  posted_at_raw: 'Posted On:',
  prid: '216033',
  financial_outlay_text: '',
  states_ut: '',
  record_age_days: '',
};
// A dated row that is not a Cabinet decision: the live loader's filter (isCabinetDecision) drops it too.
const NOT_CABINET = {
  ...sheet,
  record_id: 'NYT-25-b107df11ab140920',
  record_title: 'Common Yoga Protocol Session Organised at National Institute of Sowa Rigpa under Mission LiFE Initiative',
  record_date: '2026-06-03',
  title: 'Common Yoga Protocol Session Organised at National Institute of Sowa Rigpa under Mission LiFE Initiative',
  date: '2026-06-03',
  sector: 'social',
  ministry: 'AYUSH',
  official_document_url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2268334&lang=1&reg=3',
  source_url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2268334&lang=1&reg=3',
  posted_at_raw: 'Posted On: 03 JUN 2026 3:06PM by PIB Delhi',
  prid: '2268334',
  financial_outlay_text: '',
  states_ut: '',
  record_age_days: '99',
};
const PMGSY = {
  ...sheet,
  record_id: 'NYT-25-15156ded1dfd8fc5',
  record_title: 'Cabinet approves Continuation of Pradhan Mantri Gram Sadak Yojana-III (PMGSY-III) beyond March 2025 upto March 2028',
  record_date: '2026-04-18',
  title: 'Cabinet approves Continuation of Pradhan Mantri Gram Sadak Yojana-III (PMGSY-III) beyond March 2025 upto March 2028',
  date: '2026-04-18',
  sector: 'transport; social; industry',
  ministry: 'Cabinet',
  official_document_url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2253247&lang=1&reg=3',
  source_url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2253247&lang=1&reg=3',
  posted_at_raw: 'Posted On: 18 APR 2026 3:15PM by PIB Delhi',
  prid: '2253247',
  financial_outlay_text: 'Rs.83,977 crore',
  states_ut: '',
  record_age_days: '145',
};
const FIXTURE = [PMGSY, PLACEHOLDER, MINISTRY_RELEASE, NOT_CABINET, CCEA_RELEASE];
const REGISTER = REGISTERS['national:Cabinet Decisions'];

describe('mapCabinetRegisterRow', () => {
  it('maps a register row to the live Cabinet row shape, with the register\'s own PIB link', () => {
    const { row } = mapCabinetRegisterRow(MINISTRY_RELEASE);
    expect(row).toMatchObject({
      date: '2026-08-19',
      title: TITLE_NH22,
      topic: TITLE_NH22,
      source_url: registerLink('2301145'),
      summary: '',
      id: 'pib-2301145',
      stage: 'PIB release',
      source: 'Press Information Bureau',
      language: 'en',
      ministry: 'Ministry of Road Transport & Highways',
    });
    expect(row.source_url).toBe('https://www.pib.gov.in/PressReleasePage.aspx?PRID=2301145&lang=1&reg=3');
    expect(row).toMatchObject({ prid: '2301145', register_id: 'NYT-25-3d400f6385ad32fa', sector: 'transport; agriculture', states_ut: 'Bihar', decision_type: 'Union Cabinet' });
  });

  it('leaves out the sheet\'s day-dependent formula columns and the constant status', () => {
    const { row } = mapCabinetRegisterRow(MINISTRY_RELEASE);
    for (const key of ['record_age_days', 'record_completeness_pct', 'source_retrieved_at', 'status', 'posted_at_raw']) expect(row).not.toHaveProperty(key);
  });

  it('cleans the outlay text of its empty fragments and keeps it out of the table\'s Outlay column', () => {
    expect(mapCabinetRegisterRow(MINISTRY_RELEASE).row).toMatchObject({ financial_outlay_text: 'Rs.3590.73 crore' });
    expect(mapCabinetRegisterRow(MINISTRY_RELEASE).row).not.toHaveProperty('financial_outlay');
    expect(cleanOutlay('rs, ; rs. ; ₹1,299.08 crore')).toBe('₹1,299.08 crore');
    expect(cleanOutlay('rs.')).toBe('');
  });

  it('builds the PIB link from the PRID when the link cells are empty', () => {
    const { row } = mapCabinetRegisterRow({ ...PMGSY, source_url: '', official_document_url: '' });
    expect(row.source_url).toBe(registerLink('2253247'));
  });

  it('drops a row with no date (the placeholder rows), a bad date, no title, or that is not a Cabinet decision', () => {
    expect(mapCabinetRegisterRow(PLACEHOLDER)).toEqual({ drop: 'no_date' });
    expect(mapCabinetRegisterRow({ ...PMGSY, date: '19/08/2026', record_date: '19/08/2026' })).toEqual({ drop: 'bad_date' });
    expect(mapCabinetRegisterRow({ ...PMGSY, date: '2026-02-30' })).toEqual({ drop: 'bad_date' });
    expect(mapCabinetRegisterRow({ ...PMGSY, title: '  ', record_title: '' })).toEqual({ drop: 'no_title' });
    expect(mapCabinetRegisterRow(NOT_CABINET)).toEqual({ drop: 'not_module' });
  });
});

describe('buildRegisterItems', () => {
  const built = buildRegisterItems(FIXTURE, REGISTER, 'official');

  it('counts every row read and every row left out, with the reason', () => {
    expect(built.report).toMatchObject({
      read: 5,
      kept: 2,
      dropped: { no_title: 0, no_date: 1, bad_date: 0, not_module: 1 },
      release_variants: 1,
      key_duplicates: 0,
      oldest: '2026-04-18',
      newest: '2026-08-19',
    });
    expect(built.items).toHaveLength(2);
  });

  it('puts the items newest first (date, then PRID), whatever order the sheet was in', () => {
    expect(built.items.map((i) => i.row.prid)).toEqual(['2301144', '2253247']);
    const reversed = buildRegisterItems([...FIXTURE].reverse(), REGISTER, 'official');
    expect(reversed.items).toEqual(built.items);
  });

  it('gives a register item the key a live refresh gives the same release', () => {
    // The live feed links a release as PIB's RSS does (PressReleaseIframePage, no www, no lang/reg).
    const liveRow = { date: '2026-08-19', title: TITLE_NH22, source_url: liveLink('2301144'), summary: '', id: 'pib-2301144', stage: 'PIB release', source: 'Press Information Bureau', topic: TITLE_NH22, language: 'en', ministry: 'Cabinet' };
    const [liveItem] = itemsFromRows([liveRow], 'official').items;
    const registerItem = built.items.find((i) => i.row.prid === '2301144');
    expect(registerItem.item_key).toBe(liveItem.item_key);
    expect(new Set(built.items.map((i) => i.item_key)).size).toBe(2);
  });

  it('keeps the register\'s own link in the row, not the live one', () => {
    expect(built.items[0].url).toBe(registerLink('2301144'));
    expect(built.items[0].row.source_url).toBe(registerLink('2301144'));
  });

  it('is the same on every load: same keys and hashes, and a changed formula column changes nothing', () => {
    const again = buildRegisterItems(FIXTURE.map((r) => ({ ...r, record_age_days: String(Number(r.record_age_days || 0) + 7), source_retrieved_at: '99999' })), REGISTER, 'official');
    expect(again.items.map((i) => [i.item_key, i.content_hash])).toEqual(built.items.map((i) => [i.item_key, i.content_hash]));
  });

  it('keeps the first of two rows for one release', () => {
    const other = { ...MINISTRY_RELEASE, record_id: 'other', sector: 'x', title: 'Cabinet approves another title', record_title: 'Cabinet approves another title' };
    const twice = buildRegisterItems([MINISTRY_RELEASE, other], REGISTER, 'official');
    expect(twice.items).toHaveLength(1);
    expect(twice.report.release_variants).toBe(0);
    expect(twice.report.key_duplicates + twice.report.store_dropped.duplicate).toBe(1);
  });

  describe('release pairs: one row per decision', () => {
    const ministry = (prid) => ({ ...MINISTRY_RELEASE, prid: String(prid), source_url: registerLink(prid), official_document_url: registerLink(prid) });
    const cabinet = (prid, name = 'Cabinet') => ({ ...ministry(prid), ministry: name });
    const prids = (rows) => buildRegisterItems(rows, REGISTER, 'official').items.map((i) => i.row.prid);

    it('keeps the Cabinet\'s or a committee\'s release, whichever PRID it has, and counts the other', () => {
      expect(prids([ministry(100), cabinet(200)])).toEqual(['200']);
      expect(prids([cabinet(200), ministry(100)])).toEqual(['200']);
      expect(prids([ministry(100), cabinet(300, 'Cabinet Committee on Economic Affairs (CCEA)')])).toEqual(['300']);
      expect(buildRegisterItems([ministry(100), cabinet(200)], REGISTER, 'official').report.release_variants).toBe(1);
    });

    it('otherwise keeps the lower PRID, also when both are the Cabinet\'s', () => {
      expect(prids([ministry(300), ministry(100)])).toEqual(['100']);
      expect(prids([cabinet(300), cabinet(100, 'Cabinet Committee on Economic Affairs (CCEA)')])).toEqual(['100']);
    });

    it('leaves decisions with different titles or days alone', () => {
      const otherDay = { ...cabinet(200), date: '2026-08-18', record_date: '2026-08-18' };
      expect(prids([ministry(100), otherDay])).toEqual(['100', '200']);
    });
  });

});

describe('compareWithLive', () => {
  const { items } = buildRegisterItems(FIXTURE, REGISTER, 'official');
  const liveRow = (prid, date) => ({ date, title: `Cabinet approves ${prid}`, source_url: liveLink(prid), id: 'pib-0', ministry: 'Cabinet' });

  it('counts the live rows that are register releases, by key and by PRID', () => {
    const r = compareWithLive(items, [liveRow('2301144', '2026-08-19'), liveRow('2323468', '2026-10-14')]);
    expect(r).toMatchObject({ live_rows: 2, live_newest: '2026-10-14', same_release: 1, key_collisions_with_live_keys: 1 });
    // itemKeyFor keys a PIB release by its PRID, so the register's own link matches as well.
    expect(r.key_collisions_if_register_keyed_by_its_own_link).toBe(1);
  });
});

describe('loadRegister', () => {
  const run = runFor('national:Cabinet Decisions');
  const { items } = buildRegisterItems(FIXTURE, REGISTER, 'official');
  const TOKEN = '11111111-1111-4111-8111-111111111111';

  it('claims only this module and records the items with the lease token', async () => {
    const rpc = vi.fn(async (name) => (name === 'feed_claim_due' ? [{ ...run, lease_token: TOKEN }] : { status: 'ok', new_items: 3 }));
    const out = await loadRegister({ rpc, run, items, meta: { note: 'n' } });
    expect(out.state).toBe('recorded');
    const [claimName, claimArgs] = rpc.mock.calls[0];
    expect(claimName).toBe('feed_claim_due');
    expect(claimArgs.p_runs).toHaveLength(1);
    expect(claimArgs.p_runs[0]).toMatchObject({ tier: 'national', feature: 'Cabinet Decisions', kind: 'official', class: 'official' });
    expect(claimArgs.p_limit).toBe(1);
    const [recordName, recordArgs] = rpc.mock.calls[1];
    expect(recordName).toBe('feed_record');
    expect(recordArgs.p).toMatchObject({ tier: 'national', feature: 'Cabinet Decisions', variant: '', lease_token: TOKEN, status: 'ok', items, meta: { note: 'n' } });
  });

  it('stops without recording when the claim returns nothing (not due, or held by another run)', async () => {
    const rpc = vi.fn(async (name) => (name === 'feed_claim_due' ? [] : { total: 141, checked_at: 'x', interval_minutes: 60 }));
    const out = await loadRegister({ rpc, run, items, meta: {} });
    expect(out.state).toBe('not_due');
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(['feed_claim_due', 'feed_page']);
  });

  it('refuses a module whose refresh replaces its list, and a module that is not scheduled', () => {
    expect(() => runFor('state:Centre-State Fund Flow Tracker')).toThrow(/reference.*pruned/s);
    expect(() => runFor('national:No Such Module')).toThrow(/not a scheduled module/);
    expect(KEPT_KINDS).toEqual(['official']);
    // A news module keeps its items too, but a news register is not built: only official is loaded.
    expect(() => runFor('state:Cabinet Decisions')).toThrow(/"news"/);
  });
});

describe('local database adapter', () => {
  it('builds named-argument SQL, quoting every value in a dollar-quoted literal that the value cannot close', () => {
    const nasty = { note: 'cost $5$ and $q1$ and $$', items: [{ a: "it's" }] };
    const sql = rpcSql('feed_record', { p: nasty });
    const m = /p => (\$q[0-9a-f]{8}\$)(.*)\1::jsonb/s.exec(sql);
    expect(m).not.toBeNull();
    expect(JSON.parse(m[2])).toEqual(nasty);
    expect(m[2]).not.toContain(m[1]);
    expect(rpcSql('feed_claim_due', { p_runs: [], p_limit: 1, p_lease_seconds: 120 })).toMatch(/^select coalesce\(jsonb_agg\(to_jsonb\(t\)\).*public\.feed_claim_due\(p_runs => \$q[0-9a-f]{8}\$\[\]\$q[0-9a-f]{8}\$::jsonb, p_limit => 1, p_lease_seconds => 120\) as t;$/s);
  });

  it('draws a new dollar-quote tag while the text contains the tag', () => {
    const tags = ['qaaaa', 'qaaaa', 'qbbbb'];
    const text = 'x $qaaaa$ y';
    expect(dollarQuote(text, () => tags.shift())).toBe('$qbbbb$x $qaaaa$ y$qbbbb$');
    expect(tags).toEqual([]);
  });

  it('calls only the feed functions, and only a local test database', () => {
    expect(() => rpcSql('feed_purge', {})).toThrow(/not one this script calls/);
    expect(() => localRpc({ db: 'postgres' })).toThrow(/local test database/);
    expect(() => localRpc({ db: 'nter_production' })).toThrow(/local test database/);
    expect(() => localRpc({ db: 'niyantran_feed_register_load_test' })).not.toThrow();
  });

  it('runs as service_role and returns the last line psql prints as JSON; an error carries the SQLSTATE', async () => {
    const exec = vi.fn(async () => 'SET\n{"status":"ok"}');
    const rpc = localRpc({ db: 'niyantran_x_test', exec });
    await expect(rpc('feed_page', { p_tier: 'national' })).resolves.toEqual({ status: 'ok' });
    expect(exec.mock.calls[0][0].sql).toMatch(/^set role service_role;/);
    const failing = localRpc({ db: 'niyantran_x_test', exec: async () => { throw Object.assign(new Error('psql'), { stderr: 'ERROR:  22023: feed_record: 3000 items\nLINE 1' }); } });
    await expect(failing('feed_record', { p: {} })).rejects.toMatchObject({ code: '22023', message: 'feed_record: feed_record: 3000 items' });
  });
});

describe('the stored note never names a local path', () => {
  it('names the workbook relative to the repository, or by file name when it lies outside', () => {
    expect(displayFile(`${ROOT}/backup/NATIONAL/F25_Cabinet_Decisions.xlsx`)).toBe('backup/NATIONAL/F25_Cabinet_Decisions.xlsx');
    expect(displayFile('backup/NATIONAL/F25_Cabinet_Decisions.xlsx')).toBe('backup/NATIONAL/F25_Cabinet_Decisions.xlsx');
    expect(displayFile('/Users/someone/Downloads/Cabinet.xlsx')).toBe('Cabinet.xlsx');
    expect(displayFile('../../elsewhere/Cabinet.xlsx')).toBe('Cabinet.xlsx');
    const { items, report } = buildRegisterItems(FIXTURE, REGISTER, 'official');
    expect(items.length).toBeGreaterThan(0);
    expect(registerMeta(REGISTER, report, displayFile('/Users/someone/Downloads/Cabinet.xlsx'), '2026-10-15T00:00:00Z').note).not.toMatch(/\/Users|Downloads/);
  });
});

describe('main: the gate before anything is written', () => {
  const ENV = { SUPABASE_URL: 'https://example-project.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_TESTKEY' };
  const TOKEN = '22222222-2222-4222-8222-222222222222';
  let out;

  function setup({ claim = 'due' } = {}) {
    const calls = [];
    const rpc = vi.fn(async (name, args) => {
      calls.push([name, args]);
      if (name === 'feed_claim_due') return claim === 'due' ? [{ ...runFor('national:Cabinet Decisions'), lease_token: TOKEN }] : [];
      if (name === 'feed_record') return { status: 'ok', items: args.p.items.length };
      return null;
    });
    const deps = {
      env: ENV,
      readRows: vi.fn(() => FIXTURE),
      makeLocalRpc: vi.fn(() => rpc),
      makeProdRpc: vi.fn(() => rpc),
      forceDue: vi.fn(async () => {}),
      fetchLive: vi.fn(async () => ({ verdict: { status: 'ok', reason: '' }, rows: [] })),
    };
    return { deps, rpc, calls };
  }
  const noClient = (deps) => {
    expect(deps.makeLocalRpc).not.toHaveBeenCalled();
    expect(deps.makeProdRpc).not.toHaveBeenCalled();
    expect(deps.forceDue).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    out = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
  });
  afterEach(() => vi.restoreAllMocks());

  it('a dry run is the default and never makes a database client', async () => {
    const { deps } = setup();
    await expect(main([], deps)).resolves.toBe(0);
    expect(deps.readRows).toHaveBeenCalledTimes(1);
    noClient(deps);
    expect(out.join('\n')).toMatch(/DRY RUN/);
    // even with a target, its flags and the production environment present, without --apply
    const again = setup();
    await expect(main(['--dry-run', '--target', 'prod', '--confirm-prod'], again.deps)).resolves.toBe(0);
    await expect(main(['--target', 'local', '--db', 'niyantran_x_test'], again.deps)).resolves.toBe(0);
    noClient(again.deps);
  });

  it('--apply needs a target, and the target must be local or prod', async () => {
    for (const argv of [['--apply'], ['--apply', '--target', 'staging', '--confirm-prod']]) {
      const { deps } = setup();
      await expect(main(argv, deps)).rejects.toThrow(/needs --target local or --target prod/);
      expect(deps.readRows).not.toHaveBeenCalled();
      noClient(deps);
    }
  });

  it('--dry-run and --apply together are refused', async () => {
    const { deps } = setup();
    await expect(main(['--dry-run', '--apply', '--target', 'local', '--db', 'niyantran_x_test'], deps)).rejects.toThrow(/cannot be used together/);
    noClient(deps);
  });

  it('prod needs SUPABASE_URL and SUPABASE_SECRET_KEY in the environment', async () => {
    for (const env of [{}, { SUPABASE_URL: ENV.SUPABASE_URL }, { SUPABASE_SECRET_KEY: ENV.SUPABASE_SECRET_KEY }]) {
      const { deps } = setup();
      await expect(main(['--apply', '--target', 'prod', '--confirm-prod'], { ...deps, env })).rejects.toThrow(/needs SUPABASE_URL and SUPABASE_SECRET_KEY/);
      noClient(deps);
    }
  });

  it('prod needs --confirm-prod, names only the host, and never the key', async () => {
    const { deps } = setup();
    const err = await main(['--apply', '--target', 'prod'], deps).catch((e) => e);
    expect(err.message).toMatch(/add --confirm-prod/);
    expect(err.message).toContain('example-project.supabase.co');
    expect(err.message).not.toContain('sb_secret_TESTKEY');
    expect(deps.readRows).not.toHaveBeenCalled();
    noClient(deps);
  });

  it('--force is refused on prod', async () => {
    const { deps } = setup();
    await expect(main(['--apply', '--target', 'prod', '--confirm-prod', '--force'], deps)).rejects.toThrow(/--force on prod is only for a register module/);
    noClient(deps);
  });

  it('local needs a niyantran_*_test database', async () => {
    for (const db of [undefined, 'postgres', 'nter_production']) {
      const { deps } = setup();
      await expect(main(['--apply', '--target', 'local', ...(db ? ['--db', db] : [])], deps)).rejects.toThrow(/local test database/);
      noClient(deps);
    }
  });

  it('only a module of kind official is loaded', async () => {
    const registers = { 'state:Centre-State Fund Flow Tracker': REGISTER, 'state:Cabinet Decisions': REGISTER };
    for (const [module, kind] of [['state:Centre-State Fund Flow Tracker', 'reference'], ['state:Cabinet Decisions', 'news']]) {
      const { deps } = setup();
      await expect(main(['--module', module, '--apply', '--target', 'prod', '--confirm-prod'], { ...deps, registers })).rejects.toThrow(new RegExp(`"${kind}"`));
      expect(deps.readRows).not.toHaveBeenCalled();
      noClient(deps);
    }
    const { deps } = setup();
    await expect(main(['--module', 'national:No Such Register'], deps)).rejects.toThrow(/no register mapping/);
  });

  it('a prod load that passes every check makes the client once, with the environment\'s URL and key, and records the register', async () => {
    const { deps, calls } = setup();
    await expect(main(['--apply', '--target', 'prod', '--confirm-prod', '--file', '/Users/someone/Downloads/Cabinet.xlsx'], deps)).resolves.toBe(0);
    expect(deps.makeProdRpc).toHaveBeenCalledTimes(1);
    expect(deps.makeProdRpc).toHaveBeenCalledWith({ url: ENV.SUPABASE_URL, key: ENV.SUPABASE_SECRET_KEY, timeoutMs: 60_000 });
    expect(deps.makeLocalRpc).not.toHaveBeenCalled();
    const record = calls.find(([name]) => name === 'feed_record')[1].p;
    expect(record).toMatchObject({ lease_token: TOKEN, status: 'ok' });
    expect(record.meta.note).not.toMatch(/\/Users|Downloads/);
    expect(out.join('\n')).not.toContain('sb_secret_TESTKEY');
    expect(out.join('\n')).toContain('Target: example-project.supabase.co');
  });

  it('a module that is not due exits 3 and records nothing', async () => {
    const { deps, calls } = setup({ claim: 'held' });
    await expect(main(['--apply', '--target', 'prod', '--confirm-prod'], deps)).resolves.toBe(3);
    expect(calls.some(([name]) => name === 'feed_record')).toBe(false);
  });

  it('--force on a local test database makes the module due before the claim', async () => {
    const { deps, calls } = setup();
    await expect(main(['--apply', '--target', 'local', '--db', 'niyantran_x_test', '--force'], deps)).resolves.toBe(0);
    expect(deps.forceDue).toHaveBeenCalledTimes(1);
    expect(deps.makeLocalRpc).toHaveBeenCalledWith({ container: 'niyantran-corpus-test-db', db: 'niyantran_x_test' });
    expect(calls.map(([n]) => n)).toContain('feed_claim_due');
  });

  it('checkOptions is the same gate for the command line', () => {
    expect(() => checkOptions({ apply: true, target: 'prod', 'confirm-prod': true }, ENV)).not.toThrow();
    expect(checkOptions({ apply: true, target: 'prod', 'confirm-prod': true }, ENV).url).toBe(ENV.SUPABASE_URL);
    expect(checkOptions({}, {})).toEqual({ url: '' });
  });
});

// F201: one handbook store variant (a whole-year block) holds at most what feed_record takes in one record.
describe('the most items one record holds', () => {
  it('is the handbook block limit', async () => {
    const { MAX_ITEMS } = await import('../../scripts/load-feed-register.mjs');
    const { HANDBOOK_BLOCK_MAX } = await import('./rbiHandbookTables.js');
    expect(MAX_ITEMS).toBe(2000);
    expect(HANDBOOK_BLOCK_MAX).toBe(MAX_ITEMS);
  });
});

// ---------------------------------------------------------------------------------------------
// F201 review, finding 3: a table over 2,000 figures is stored as whole-year blocks named by their oldest
// year, newest first, so the next edition's extra year renames most older blocks. The load must leave the
// table consistent: its new blocks serving, the blocks it no longer produces (and orphans left by an earlier
// unfinished cleanup) not serving, nothing deleted, every write through feed_claim_due / feed_record /
// feed_make_due (no function sets `serve`, so the load prints the one statement that does and exits 4).
// The store below is a stateful fake of those functions, including feed_record's shrink guard.
describe('F201 review: the block lifecycle across editions', () => {
  const FISCAL = 'state:State Fiscal Deep-Dive';
  const ENV = { SUPABASE_URL: 'https://example-project.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_TESTKEY' };
  const T176 = HANDBOOK_TABLES.get(176);
  const STATES = HANDBOOK_STATES.slice(0, 32);
  const fileMeta = { tables: new Map([[176, { no: 176, title: T176.title, unit: 'Per cent', source: 'Finances of State Governments' }]]) };
  // One year of Table 176: 19 indicators x 32 states = 608 figures. A block of 3 years holds 1,824.
  const year176 = (year) => Array.from({ length: 19 }, (_, k) => k).flatMap((k) => STATES.map((state, s) => ({
    state, indicator: k === 0 ? 'Outstanding Liabilities' : `Indicator ${k}`, year, value: 1000 * k + s + Number(year.slice(0, 4)), unit: 'Per cent',
    table_no: 176, table_title: T176.title, source_url: T176.url, as_of: HANDBOOK.published, edition: HANDBOOK.edition, title: `${state} · ${k} · ${year}`,
  })));
  const years = (from, through) => Array.from({ length: through - from + 1 }, (_, i) => String(through - i));
  // The 2024-25 edition holds 2005..2025; the next edition adds 2026 (here: the 2025 figures copied as 2026).
  const edition = (through) => years(2005, through).flatMap(year176);
  const EDITION_2025 = edition(2025);
  const EDITION_2026 = edition(2026);
  const EDITION_2027 = edition(2027);

  const NAMES_2025 = ['176', '176@2020', '176@2017', '176@2014', '176@2011', '176@2008', '176@2005'];
  // 22 years from the newest: 2026-2024, ..., 2008-2006, then 2005 alone (one year, 608 figures).
  const NAMES_2026 = ['176', '176@2021', '176@2018', '176@2015', '176@2012', '176@2009', '176@2006', '176@2005'];
  const NAMES_2027 = ['176', '176@2022', '176@2019', '176@2016', '176@2013', '176@2010', '176@2007', '176@2005'];

  /** The functions the loader calls, over a map of variants; feed_record has the store's shrink guard. */
  function fakeStore() {
    const state = new Map();
    const calls = [];
    const rpc = vi.fn(async (name, args) => {
      calls.push(name);
      if (name === 'feed_claim_due') {
        const run = args.p_runs[0];
        if (!state.has(run.variant)) state.set(run.variant, { total: 0, serve: false, meta: {}, shrunk: 0, sig: '', due: true, leased: false });
        const s = state.get(run.variant);
        if (!s.due || s.leased) return [];
        s.leased = true;
        return [{ ...run, lease_token: `lease-${run.variant}` }];
      }
      if (name === 'feed_make_due') {
        const s = state.get(args.p_variant);
        if (!s || s.leased) return false;
        s.due = true;
        return true;
      }
      if (name === 'feed_record') {
        const s = state.get(args.p.variant);
        if (!s?.leased) return { status: 'stale' };
        s.leased = false;
        const n = args.p.items.length;
        if (s.total >= 10 && n * 2 < s.total) {
          if (s.shrunk >= 2) s.shrunk = 0;
          else {
            s.shrunk += 1;
            s.due = true;
            return { status: 'shrunk', items: n, new_items: 0, item_count: s.total };
          }
        }
        const sig = createHash('sha1').update(args.p.items.map((i) => i.item_key + i.content_hash).join('|')).digest('hex');
        const status = sig === s.sig && s.total === n ? 'unchanged' : 'ok';
        Object.assign(s, { total: n, meta: args.p.meta, sig, due: false, shrunk: 0 });
        return { status, items: n, new_items: status === 'ok' ? n : 0, changed_items: 0, item_count: n };
      }
      if (name === 'feed_page') {
        const s = state.get(args.p_variant);
        return s ? { variant: args.p_variant, serve: s.serve, total: s.total, meta: s.meta, checked_at: null, items: [] } : null;
      }
      throw new Error(`the fake store has no function ${name}`);
    });
    return {
      rpc,
      calls,
      state,
      serving: () => [...state].filter(([, s]) => s.serve).map(([v]) => v).sort(),
      held: () => [...state.keys()].sort(),
      snapshot: () => JSON.stringify([...state].map(([v, s]) => [v, s.total, s.serve, s.shrunk, s.due])),
      /** The owner running a printed statement: serve = (variant in (…)) or false, for the variants it names. */
      execute(sql) {
        const m = /^update public\.feed_state set serve = (false|\(variant in \((.*?)\)\)) where tier = '([^']*)' and feature = '((?:[^']|'')*)' and variant in \((.*)\);$/.exec(sql);
        if (!m) throw new Error(`not the statement the loader prints: ${sql}`);
        const quoted = (text) => [...text.matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'"));
        const on = new Set(m[2] ? quoted(m[2]) : []);
        for (const v of quoted(m[5])) if (state.has(v)) state.get(v).serve = on.has(v);
      },
    };
  }

  let out;
  beforeEach(() => {
    out = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
  });
  afterEach(() => vi.restoreAllMocks());

  const APPLY = ['--apply', '--target', 'prod', '--confirm-prod', '--force'];
  const FINISH = `SUPABASE_URL=… SUPABASE_SECRET_KEY=… node scripts/load-feed-register.mjs --module "${FISCAL}" --apply --target prod --confirm-prod --force`;
  async function load(store, records, argv = APPLY) {
    out.length = 0;
    const makeProdRpc = vi.fn(() => store.rpc);
    const deps = { env: ENV, readJson: vi.fn(() => ({ rows: records, meta: fileMeta })), makeProdRpc, makeLocalRpc: vi.fn(), forceDue: vi.fn() };
    const code = await main(['--module', FISCAL, ...argv], deps);
    const text = out.join('\n');
    return { code, text, sql: out.map((l) => l.trim()).filter((l) => l.startsWith('update public.feed_state')), deps };
  }
  /** A store as production holds it after an edition is loaded and its blocks are switched on. */
  async function storeAfter(records, names) {
    const store = fakeStore();
    const first = await load(store, records);
    expect(first.code).toBe(EXIT_BLOCKS_PENDING);
    expect(first.sql).toHaveLength(1);
    store.execute(first.sql[0]);
    expect(store.serving()).toEqual([...names].sort());
    return store;
  }
  /** The next edition's load until feed_record accepts the re-cut block (its third answer in a row). */
  async function loadUntilStored(store, records) {
    let last;
    for (let i = 0; i < 3; i++) {
      last = await load(store, records);
      if (last.code !== 1) break;
    }
    return last;
  }

  it('a first load prints the one statement that switches every new block on, and exits 4 until a re-run finds nothing left', async () => {
    const store = fakeStore();
    const first = await load(store, EDITION_2025);
    expect(first.code).toBe(EXIT_BLOCKS_PENDING);
    expect(store.serving()).toEqual([]);
    expect(first.sql).toEqual([serveSql(FISCAL, { enable: NAMES_2025, disable: [] })]);
    expect(first.text).toMatch(/Blocks are NOT consistent/);
    store.execute(first.sql[0]);
    const again = await load(store, EDITION_2025);
    expect(again.code).toBe(0);
    expect(again.sql).toEqual([]);
    expect(again.text).toMatch(/Blocks are consistent/);
    expect(new Set(store.calls)).toEqual(new Set(['feed_page', 'feed_claim_due', 'feed_record', 'feed_make_due']));
  }, 60_000);

  it('the next edition: no stale block serves and every new block does, after the loads and the one printed statement; nothing is deleted', async () => {
    const store = await storeAfter(EDITION_2025, NAMES_2025);
    const first = await load(store, EDITION_2026);
    // 176@2005 shrinks from 1,824 to 608 figures (2005 alone): feed_record refuses it, the run says so and plans no switch yet.
    expect(first.code).toBe(1);
    expect(first.text).toMatch(/176@2005\s+refused as shrunk: 608 items arrived and 1824 are held; the block was re-cut by the new edition \(years 2005 to 2007 held, 2005 now\)/);
    expect(first.text).toContain(FINISH);
    expect(first.text).toMatch(/guard is not bypassed/);
    expect(first.sql).toEqual([]);
    expect(store.serving()).toEqual([...NAMES_2025].sort());
    const done = await loadUntilStored(store, EDITION_2026);
    expect(done.code).toBe(EXIT_BLOCKS_PENDING);
    const enable = ['176@2021', '176@2018', '176@2015', '176@2012', '176@2009', '176@2006'];
    const disable = ['176@2020', '176@2017', '176@2014', '176@2011', '176@2008'];
    expect(done.sql).toEqual([serveSql(FISCAL, { enable, disable })]);
    expect(done.text).toMatch(/Obsolete blocks: 5 stored block variants are no longer produced \(5 serving\): 176@2020, 176@2017, 176@2014, 176@2011, 176@2008/);
    store.execute(done.sql[0]);
    expect(store.serving()).toEqual([...NAMES_2026].sort());
    // Nothing was deleted: last edition's blocks are still stored, not serving.
    expect(store.held()).toEqual([...new Set([...NAMES_2025, ...NAMES_2026])].sort());
    const final = await load(store, EDITION_2026);
    expect(final.code).toBe(0);
    expect(final.sql).toEqual([]);
  }, 60_000);

  it('a shrunk block that was not re-cut (the same years, fewer figures) is not offered the finish command', async () => {
    const store = await storeAfter(EDITION_2025, NAMES_2025);
    // The same edition, but its oldest block (2005-2007) arrives with a third of its figures: same years, same name.
    const thin = EDITION_2025.filter((r) => !['2005', '2006', '2007'].includes(r.year) || Number(r.value) % 3 === 0);
    const r = await load(store, thin);
    expect(r.code).toBe(1);
    expect(r.text).toMatch(/refused as shrunk: .* are held, for the same years \(2005 to 2007\); the register file may be incomplete/);
    expect(r.text).not.toContain(FINISH);
    expect(r.sql).toEqual([]);
  }, 60_000);

  it('an orphan from an earlier, unfinished cleanup is found and switched off, though no stored view lists it any more', async () => {
    const store = await storeAfter(EDITION_2025, NAMES_2025);
    // 2026 is loaded to the end but its statement is never run: 2025's blocks keep serving, 2026's new ones do not.
    const unfinished = await loadUntilStored(store, EDITION_2026);
    expect(unfinished.code).toBe(EXIT_BLOCKS_PENDING);
    expect(store.serving()).toEqual([...NAMES_2025].sort());
    // The newest block's stored view now lists 2026's names, not 2025's: reading only that list never reports the orphans again.
    expect(store.state.get('176').meta.view.blocks.map((b) => b.variant)).toEqual(NAMES_2026);

    const r = await load(store, EDITION_2027);
    expect(r.code).toBe(EXIT_BLOCKS_PENDING);
    const orphans = ['176@2020', '176@2017', '176@2014', '176@2011', '176@2008'];
    expect(r.text).toMatch(/Obsolete blocks: 11 stored block variants are no longer produced \(5 serving\)/);
    for (const v of orphans) expect(r.text).toContain(`${v} (serving)`);
    expect(r.sql).toEqual([serveSql(FISCAL, { enable: ['176@2022', '176@2019', '176@2016', '176@2013', '176@2010', '176@2007'], disable: orphans })]);
    // 2026's never-enabled names are reported as left alone, not switched.
    expect(r.text).toMatch(/not serving, left\s+176@2021, 176@2018, 176@2015, 176@2012, 176@2009, 176@2006/);
    store.execute(r.sql[0]);
    expect(store.serving()).toEqual([...NAMES_2027].sort());
    expect(store.held()).toEqual([...new Set([...NAMES_2025, ...NAMES_2026, ...NAMES_2027])].sort());
    expect((await load(store, EDITION_2027)).code).toBe(0);
  }, 120_000);

  it('a dry run with a target reads the store and reports what a load would switch; it writes nothing', async () => {
    const store = await storeAfter(EDITION_2025, NAMES_2025);
    const before = store.snapshot();
    store.calls.length = 0;
    const r = await load(store, EDITION_2026, ['--target', 'prod', '--confirm-prod']);
    expect(r.code).toBe(0);
    expect(store.calls.length).toBeGreaterThan(0);
    expect(new Set(store.calls)).toEqual(new Set(['feed_page']));
    expect(store.snapshot()).toBe(before);
    expect(r.text).toMatch(/DRY RUN/);
    expect(r.text).toMatch(/Obsolete blocks: 5 stored block variants are no longer produced \(5 serving\)/);
    expect(r.text).toMatch(/176@2005\s+refused as shrunk: 608 items arrived and 1824 are held; the block was re-cut/);
    expect(r.text).toMatch(/Block lifecycle: what a load would do \(nothing is written\)/);
    expect(r.text).toMatch(/nothing was written/);
    expect(r.sql).toEqual([]);
    // Without a target a dry run does not touch the database at all.
    const plain = await load(fakeStore(), EDITION_2026, []);
    expect(plain.code).toBe(0);
    expect(plain.deps.makeProdRpc).not.toHaveBeenCalled();
    expect(plain.text).toMatch(/does not read the store/);
  }, 60_000);

  it('a dry run of a table with no stored blocks lists every produced block to switch on', async () => {
    const store = fakeStore();
    const r = await load(store, EDITION_2025, ['--target', 'prod', '--confirm-prod']);
    expect(r.code).toBe(0);
    expect(r.text).toMatch(new RegExp(`table 176: switch on\\s+${NAMES_2025.join(', ')}`));
    expect(store.held()).toEqual([]);
  });

  it('storedBlocks probes only valid blocks of the table; a hostile name in a stored view is never probed, and SQL values are quoted', async () => {
    const probed = [];
    const rpc = vi.fn(async (name, args) => {
      probed.push(args.p_variant);
      if (args.p_variant === '176') {
        return { serve: true, total: 1824, meta: { view: { blocks: [{ variant: '176' }, { variant: "176@1999'; drop table x; --" }, { variant: '21@2005' }, { variant: '176@2020', from: '2020' }], years: ['2025', '2024', 'junk'] } } };
      }
      return null;
    });
    const groups = [{ variant: '176', items: [], report: { view: { years: ['2025', '2024'] } } }, { variant: '176@2024', items: [], report: { view: { years: ['2025', '2024'] } } }];
    const found = await storedBlocks(rpc, FISCAL, groups);
    expect([...found.get(176).keys()]).toEqual(['176']);
    expect(probed.some((v) => /drop|21@/.test(v))).toBe(false);
    expect(probed).toContain('176@2020');
    expect(probed.every((v) => /^176(@\d{4}(-\d{2})?)?$/.test(v))).toBe(true);
    expect(serveSql(FISCAL, { enable: ["a'b"], disable: [] })).toBe("update public.feed_state set serve = (variant in ('a''b')) where tier = 'state' and feature = 'State Fiscal Deep-Dive' and variant in ('a''b');");
  });

  it('planTable: nothing is planned for a table while one of its blocks is unfinished; consistent means nothing left to switch', () => {
    const view = { block: { from: '2005', through: '2005' }, blocks: [{ variant: '176@2005', from: '2005', through: '2005', count: 608 }] };
    const held = (serve, total = 608) => ({ serve, total, view });
    const block = (variant, o = {}) => ({ variant, count: 608, view, before: null, held: held(true), status: 'ok', ...o });
    const stale = { variant: '176@2020', serve: true, total: 1824, view: null };
    expect(planTable(176, [block('176'), block('176@2005')], [])).toMatchObject({ enable: [], disable: [], blocked: [], consistent: true });
    expect(planTable(176, [block('176'), block('176@2005', { held: held(false) })], [stale])).toMatchObject({ enable: ['176@2005'], disable: ['176@2020'], consistent: false });
    const unfinished = planTable(176, [block('176', { held: held(false) }), block('176@2005', { status: 'shrunk', before: held(true, 1824), held: held(true, 1824) })], [stale]);
    expect(unfinished).toMatchObject({ enable: [], disable: [], consistent: false });
    expect(unfinished.blocked).toEqual([expect.objectContaining({ variant: '176@2005', recut: false })]);
    expect(planTable(176, [block('176', { status: 'failed', held: null })], [])).toMatchObject({ consistent: false, blocked: [{ why: 'not recorded (failed)' }] });
    expect(planTable(176, [block('176', { held: held(true, 5) })], [])).toMatchObject({ consistent: false });
    // A block not due is stored when the store holds this load's cut, not otherwise.
    expect(planTable(176, [block('176@2005', { status: 'not_due' })], []).consistent).toBe(true);
    expect(planTable(176, [block('176@2005', { status: 'not_due', held: { serve: true, total: 608, view: { ...view, block: { from: '2005', through: '2007' } } } })], []).consistent).toBe(false);
  });

  it('shrinkReason tells a re-cut block (other years) from the same years with fewer figures', () => {
    const was = { total: 1824, view: { block: { from: '2005', through: '2007' } } };
    expect(shrinkReason(was, { block: { from: '2005', through: '2005' } }, 608).recut).toBe(true);
    expect(shrinkReason(was, { block: { from: '2005', through: '2007' } }, 400)).toMatchObject({ recut: false });
    expect(shrinkReason(null, { block: { from: '2005', through: '2005' } }, 608).recut).toBe(false);
  });

  it('finishCommand repeats the same load, forced, for prod and for a local test database', () => {
    expect(finishCommand({ module: FISCAL, target: 'prod' })).toBe(FINISH);
    expect(finishCommand({ module: FISCAL, target: 'local', db: 'niyantran_x_test', container: 'niyantran-corpus-test-db', file: 'tmp/rbi-handbook/handbook-2025-26.json' }))
      .toBe(`node scripts/load-feed-register.mjs --module "${FISCAL}" --apply --target local --db niyantran_x_test --force --file tmp/rbi-handbook/handbook-2025-26.json`);
  });
});
