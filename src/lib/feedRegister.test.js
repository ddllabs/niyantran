// F169 phase 4 (C6): scripts/load-feed-register.mjs loads a module's stored register into the feed
// store. The fixture is five real rows of backup/NATIONAL/F25_Cabinet_Decisions.xlsx, as
// server/backupFeed.mjs reads them (the sheet's columns), copied here so no test reads backup/.
import { describe, expect, it, vi } from 'vitest';
import { itemsFromRows } from '../../server/feedStore.mjs';
import {
  KEPT_KINDS,
  REGISTERS,
  buildRegisterItems,
  cleanOutlay,
  compareWithLive,
  dollarQuote,
  liveLink,
  loadRegister,
  localRpc,
  mapCabinetRegisterRow,
  registerLink,
  rpcSql,
  runFor,
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
      kept: 3,
      dropped: { no_title: 0, no_date: 1, bad_date: 0, not_module: 1 },
      key_duplicates: 0,
      same_title_and_date: 2,
      oldest: '2026-04-18',
      newest: '2026-08-19',
    });
    expect(built.items).toHaveLength(3);
  });

  it('puts the items newest first (date, then PRID), whatever order the sheet was in', () => {
    expect(built.items.map((i) => i.row.prid)).toEqual(['2301145', '2301144', '2253247']);
    const reversed = buildRegisterItems([...FIXTURE].reverse(), REGISTER, 'official');
    expect(reversed.items).toEqual(built.items);
  });

  it('gives a register item the key a live refresh gives the same release', () => {
    // The live feed links a release as PIB's RSS does (PressReleaseIframePage, no www, no lang/reg).
    const liveRow = { date: '2026-08-19', title: TITLE_NH22, source_url: liveLink('2301145'), summary: '', id: 'pib-16', stage: 'PIB release', source: 'Press Information Bureau', topic: TITLE_NH22, language: 'en', ministry: 'Cabinet' };
    const [liveItem] = itemsFromRows([liveRow], 'official').items;
    const registerItem = built.items.find((i) => i.row.prid === '2301145');
    expect(registerItem.item_key).toBe(liveItem.item_key);
    // The two releases of one decision are separate items (separate PRIDs).
    expect(new Set(built.items.map((i) => i.item_key)).size).toBe(3);
  });

  it('keeps the register\'s own link in the row, not the live one', () => {
    expect(built.items[0].url).toBe(registerLink('2301145'));
    expect(built.items[0].row.source_url).toBe(registerLink('2301145'));
  });

  it('is the same on every load: same keys and hashes, and a changed formula column changes nothing', () => {
    const again = buildRegisterItems(FIXTURE.map((r) => ({ ...r, record_age_days: String(Number(r.record_age_days || 0) + 7), source_retrieved_at: '99999' })), REGISTER, 'official');
    expect(again.items.map((i) => [i.item_key, i.content_hash])).toEqual(built.items.map((i) => [i.item_key, i.content_hash]));
  });

  it('keeps the first of two rows for one release', () => {
    const twice = buildRegisterItems([MINISTRY_RELEASE, { ...MINISTRY_RELEASE, record_id: 'other', sector: 'x' }], REGISTER, 'official');
    expect(twice.items).toHaveLength(1);
    expect(twice.report.key_duplicates + twice.report.store_dropped.duplicate).toBe(1);
  });

});

describe('compareWithLive', () => {
  const { items } = buildRegisterItems(FIXTURE, REGISTER, 'official');
  const liveRow = (prid, date) => ({ date, title: `Cabinet approves ${prid}`, source_url: liveLink(prid), id: 'pib-0', ministry: 'Cabinet' });

  it('counts the live rows that are register releases, by key and by PRID', () => {
    const r = compareWithLive(items, [liveRow('2301145', '2026-08-19'), liveRow('2323468', '2026-10-14')]);
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
    expect(() => runFor('state:MLA Directory')).toThrow(/reference.*pruned/s);
    expect(() => runFor('national:No Such Module')).toThrow(/not a scheduled module/);
    expect(KEPT_KINDS).toEqual(['official', 'news', 'events']);
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
