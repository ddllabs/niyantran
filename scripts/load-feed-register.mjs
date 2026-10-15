#!/usr/bin/env node
/**
 * Load a stored register into the feed store (F169 phase 4, C6; ADR 0012).
 *
 * A scheduled module is served from public.feed_items, and a module of kind `official` keeps every
 * item forever and never prunes the ones a refresh does not list. This script records a module's
 * stored register (a backup workbook) as that module's first items, so the module shows the register
 * with each live refresh's new decisions on top.
 *
 * ORDER: run the production load BEFORE the 5-minute refresh job is switched on (go-live, step 4 of
 * docs/plans/2026-10-15-next-work.md). A load records the module as just fetched, so its first
 * refresh is an interval (60 min) later; once the job has run, a load usually reports NOT DUE, and a
 * load made after a refresh puts the register's copy back over the live row of any release both hold
 * (the register's fields come back and the live row's come off until the next refresh).
 *
 *   node scripts/load-feed-register.mjs                       # dry run for Cabinet Decisions (default)
 *   node scripts/load-feed-register.mjs --module "state:MLA Directory"   # dry run for the MLA register
 *   node scripts/load-feed-register.mjs --live-sample         # also fetch today's live answer and compare keys
 *   node scripts/load-feed-register.mjs --apply --target local --db niyantran_feed_register_load_test
 *   node scripts/load-feed-register.mjs --apply --target local --db <db> --force   # local test: make it due first
 *   SUPABASE_URL=… SUPABASE_SECRET_KEY=… node scripts/load-feed-register.mjs --apply --target prod --confirm-prod
 *
 * Options: --module <tier:Feature> (default national:Cabinet Decisions), --file <workbook, relative to
 * the repository> (default: the module's register; the stored note names it relative to the
 * repository, or by file name only when it is outside), --dry-run (the default), --apply, --target
 * local|prod, --db <name> and --container <name> (local; the container defaults to
 * niyantran-corpus-test-db and the database must be named niyantran_*_test), --confirm-prod,
 * --force (local only), --live-sample.
 *
 * What it does, in order:
 *  1. Reads the workbook with the rules of server/backupFeed.mjs (the header block above the real
 *     header row, formula and chart cells skipped) and maps every register row to the module's live
 *     row shape (REGISTERS below; only Cabinet Decisions has a mapping).
 *  2. Keeps one row per decision (see "Release pairs"), builds the items exactly as a refresh does
 *     (server/feedStore.mjs itemsFromRows), then sets each item's key to the key the live refresh
 *     gives the same release (see "Item keys").
 *  3. --apply: claims only this module (public.feed_claim_due with just its run from
 *     server/feedSchedule.mjs feedRunsForDb) and records the items with the lease token
 *     (public.feed_record). Nothing else is written. Run it again and the second load is `unchanged`.
 *
 * Register modules (MLA Directory; server/feedSchedule.mjs FEED_REGISTERS, owner decision C6 option 1)
 * are not scheduled: the timer never refreshes them. Their register is loaded as one store variant per
 * value (MLA Directory: one per state, 31), each claimed and recorded on its own with the run
 * registerRunsForDb gives it (class `register`, kind `official`, a 30-day interval). feed_claim_due adds
 * a variant it has not seen as due now and leases it; the refresh route never lists a register, so
 * nothing else ever claims it. A repeat load within 30 days of the last is NOT DUE (use --force on a
 * local test database); the production gate is the same as for Cabinet Decisions.
 *
 * A register is loaded only for a module of kind `official` (kept forever, never pruned). Every other
 * kind is refused: a module that replaces its list on each run (latest, reference, measurement) would
 * lose the register at the next refresh (why MLA Directory became a register module), and a news
 * register is not built yet.
 *
 * Release pairs. PIB often publishes one decision twice on one day, as the ministry's release and as
 * the Cabinet's or the CCEA's (the register marks them is_language_or_release_variant). One row per
 * decision is loaded: the release whose issuing body is the Cabinet or a Cabinet committee
 * (isCabinetBody), else the lower PRID. The report counts the releases left out. The live loader shows
 * both releases of a pair when both are in the RSS window (isCabinetDecision accepts a ministry
 * release whose title starts "Cabinet approves"), so a decision published after the register can
 * appear twice.
 *
 * Item keys. A live Cabinet row links to https://pib.gov.in/PressReleaseIframePage.aspx?PRID=N (PIB's
 * RSS), the register to https://www.pib.gov.in/PressReleasePage.aspx?PRID=N&lang=1&reg=3. itemKeyFor
 * (linkKey, server/feedSchedule.mjs) keys a pib.gov.in release by its PRID whichever page links it, so
 * both get url:pib.gov.in/PressRelease?PRID=N and a refresh updates the register's item instead of
 * adding a copy. The register item's key is still taken from itemKeyFor of the link PIB's RSS gives
 * for the PRID (cabinetLiveKey), so it stays the live key if linkKey changes; the row keeps the
 * register's own link.
 *
 * Not due. A claim returns nothing when the module is not due (its next refresh is in the future) or
 * another run holds it. A module the store has not seen is added due now, so the first load always
 * claims. A later load inside the module's interval cannot: no database function makes a module due
 * (service_role may change only feed_state.serve). On --target local, --force sets next_due_at as the
 * database owner, for tests. On prod there is no such path; the script says when the module is next
 * due and stops.
 *
 * Secrets: SUPABASE_URL and SUPABASE_SECRET_KEY come from the environment only (no file is read), and
 * only the host name is ever printed.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { readBackupRows } from '../server/backupFeed.mjs';
import { FEED_REGISTERS, feedRunsForDb, itemKeyFor, mlaStateVariant, registerRunsForDb } from '../server/feedSchedule.mjs';
import { itemsFromRows, metaFor, supabaseRpc } from '../server/feedStore.mjs';
import { isCabinetBody, isCabinetDecision } from '../src/lib/parliament.js';

export const ROOT = resolve(fileURLToPath(import.meta.url), '../..');

/** The workbook as the stored note names it: relative to the repository, or its file name when it lies outside (never a local path). */
export function displayFile(file) {
  const rel = relative(ROOT, resolve(ROOT, file));
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : basename(file);
}
export const DEFAULT_MODULE = 'national:Cabinet Decisions';
export const DEFAULT_CONTAINER = 'niyantran-corpus-test-db';
/** Kinds a register may be loaded into: items kept forever and never pruned by a refresh. */
export const KEPT_KINDS = Object.freeze(['official']);
// A lease long enough for one load; it ends by itself if the script dies.
const LEASE_SECONDS = 120;
const MAX_ITEMS = 2000;

// ---------------------------------------------------------------------------------------------
// Mapping: register row -> live row.

const MONTH_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The register's date as an ISO day, '' for none, or null for something that is not a date. */
function isoDay(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  const m = MONTH_DAY.exec(s);
  if (!m) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().startsWith(s) ? s : null;
}

const squash = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * The register's outlay text without its empty fragments: it is extracted from the release text
 * ("rs, ; Rs. 9,450 crore"), so a fragment that is only "rs" or "Rs." is left out. Kept as
 * financial_outlay_text, not as the Cabinet table's `financial_outlay`, because the amounts listed are
 * not always the decision's outlay.
 */
export function cleanOutlay(text) {
  const parts = squash(text)
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p && !/^(?:rs|₹)\W*$/i.test(p));
  return parts.join('; ');
}

/** PIB's release page for a PRID, in the form the register uses. */
export const registerLink = (prid) => `https://www.pib.gov.in/PressReleasePage.aspx?PRID=${prid}&lang=1&reg=3`;
/** PIB's release page for a PRID, in the form its RSS (the live feed) links to. */
export const liveLink = (prid) => `https://pib.gov.in/PressReleaseIframePage.aspx?PRID=${prid}`;

function pridOf(raw) {
  const own = String(raw?.prid ?? '').trim();
  if (/^\d+$/.test(own)) return own;
  return /PRID=(\d+)/i.exec(String(raw?.source_url || raw?.official_document_url || ''))?.[1] || '';
}

/**
 * One row of backup/NATIONAL/F25_Cabinet_Decisions.xlsx (the "COMPLETE_PIB_CABINET_EVENT_REGISTER",
 * columns as the sheet names them) as a live Cabinet Decisions row (server/nationalFeed.mjs):
 *
 *   register column                          live field        note
 *   title (record_title)                     title, topic      whitespace squashed
 *   date (record_date, an ISO day)           date              rows with none are left out
 *   source_url, else official_document_url,  source_url        the register's own PIB link (with PRID);
 *     else a link built from prid                                one built from prid when the cells are empty
 *   ministry                                 ministry          the issuing body PIB names on the release
 *   (none)                                   summary           ''  (the live row has none either)
 *   (none)                                   stage, source     'PIB release', 'Press Information Bureau'
 *   language 'English'                       language          'en'
 *   prid                                     id, prid          id 'pib-<PRID>' (the live row's id is the same since C6)
 *   record_id                                register_id
 *   sector, states_ut, decision_type         same names        kept when not empty
 *   financial_outlay_text                    same name         cleaned (cleanOutlay)
 *
 * Left out on purpose: status ('Approved' on every row; the table would show it as "Implementation"),
 * and the sheet's formula columns (record_age_days, record_completeness_pct, source_retrieved_at):
 * they change with the day and would make a repeat load look like an update.
 *
 * Returns { row } or { drop: reason }. Rows that are the second release of a decision are dropped later
 * (buildRegisterItems). Reasons: no_title, no_date (the 16 placeholder rows titled
 * "Cabinet Decisions source coverage" have none), bad_date, not_module (the live loader's own filter,
 * isCabinetDecision, would not show it).
 */
export function mapCabinetRegisterRow(raw) {
  const title = squash(raw?.title || raw?.record_title);
  if (!title) return { drop: 'no_title' };
  const date = isoDay(raw?.date || raw?.record_date);
  if (date === '') return { drop: 'no_date' };
  if (date === null) return { drop: 'bad_date' };
  const prid = pridOf(raw);
  const link = [raw?.source_url, raw?.official_document_url].map((u) => String(u ?? '').trim()).find((u) => /^https?:\/\//i.test(u));
  const row = {
    date,
    title,
    source_url: link || (prid ? registerLink(prid) : ''),
    summary: '',
    id: prid ? `pib-${prid}` : `register-${squash(raw?.record_id)}`,
    stage: 'PIB release',
    source: 'Press Information Bureau',
    topic: title,
    language: 'en',
    ministry: squash(raw?.ministry),
  };
  if (prid) row.prid = prid;
  if (raw?.record_id) row.register_id = squash(raw.record_id);
  for (const key of ['sector', 'states_ut', 'decision_type']) if (squash(raw?.[key])) row[key] = squash(raw[key]);
  const outlay = cleanOutlay(raw?.financial_outlay_text);
  if (outlay) row.financial_outlay_text = outlay;
  if (!row.source_url) delete row.source_url;
  if (!isCabinetDecision(row)) return { drop: 'not_module' };
  return { row };
}

/** The key a live refresh gives the same release (itemKeyFor of the link PIB's RSS gives for the PRID). */
export const cabinetLiveKey = (row) => (row?.prid ? itemKeyFor({ source_url: liveLink(row.prid) }) : null);

/** Releases of one decision share a title and a day. */
export const cabinetReleaseGroup = (row) => `${row.title.toLowerCase()}|${row.date}`;

/** Of two releases of one decision, whether `a` is the one to keep: the Cabinet's or a committee's, else the lower PRID. */
export function cabinetPrefers(a, b) {
  const bodyA = isCabinetBody(a.ministry);
  const bodyB = isCabinetBody(b.ministry);
  if (bodyA !== bodyB) return bodyA;
  return Number(a.prid || Infinity) < Number(b.prid || Infinity);
}

/** The live loader's link for a Wikidata person (server/featureFeed.mjs wikidataRows, https). */
export const wikidataEntity = (qid) => `https://www.wikidata.org/entity/${qid}`;

// Register columns copied as they are (squashed), when not empty.
const MLA_FIELDS = ['party', 'constituency', 'constituency_id', 'districts', 'education', 'age', 'assets_total',
  'liabilities_total', 'criminal_cases_declared', 'state_code', 'politician_id'];

/**
 * One row of backup/STATE/F30_MLA_Directory.xlsx (4,104 MLAs in 31 states; columns as the sheet names
 * them) as a live MLA Directory row (server/featureFeed.mjs: a Wikidata binding through wikidataRows):
 *
 *   register column                   live field                 note
 *   name (else title, record_title)   person, personLabel, title  whitespace squashed; rows with none dropped
 *   current_position                  position, positionLabel    the register's wording ("Member of the
 *                                                                  Legislative Assembly, Kerala")
 *   state (else geography)            state, stateLabel          the variant name (mlaStateVariant); a row
 *                                                                  whose state has none is dropped
 *   (none)                            date                       '' as in the live row, so the store serves
 *                                                                  a state in register order
 *   wikidata_qid                      source_url, wikidata_qid   https://www.wikidata.org/entity/<QID>, the
 *                                                                  live row's link; else the register's citation
 *   party, constituency, constituency_id, districts, education, age, assets_total,
 *   liabilities_total, criminal_cases_declared, state_code, politician_id    same names, when not empty
 *   source_published_at (else record_date)  as_of               the register's date for the member (ISO day)
 *   record_id                         register_id
 *   source_provider, source_url       register_source, register_source_url   the register's citation
 *
 * Left out on purpose: email (contact addresses, many private, not needed to name a member), the
 * stray column headed "Mohan Singh Bisht" (a misplaced header cell whose values are other members'
 * names), the day-dependent formula columns (record_age_days, record_completeness_pct,
 * source_retrieved_at), the columns that are the same on every row (status, category, active, house,
 * constituency_type, coverage_*, universe_count, quality_status, provenance, metric_value,
 * metric_unit) and those that repeat another (record_title, primary_entity, geography, year, month).
 *
 * Returns { row } or { drop: reason }: no_title, no_state.
 */
export function mapMlaRegisterRow(raw) {
  const name = squash(raw?.name || raw?.title || raw?.record_title);
  if (!name) return { drop: 'no_title' };
  const state = mlaStateVariant(raw?.state || raw?.geography);
  if (!state) return { drop: 'no_state' };
  const qid = /^Q\d+$/.test(squash(raw?.wikidata_qid)) ? squash(raw.wikidata_qid) : '';
  const citation = [raw?.source_url].map(squash).find((u) => /^https?:\/\//i.test(u)) || '';
  const position = squash(raw?.current_position);
  const row = { person: name, personLabel: name, positionLabel: position, stateLabel: state, position, state, date: '', title: name };
  for (const key of MLA_FIELDS) if (squash(raw?.[key])) row[key] = squash(raw[key]);
  if (qid) row.wikidata_qid = qid;
  const asOf = isoDay(raw?.source_published_at || raw?.record_date);
  if (asOf) row.as_of = asOf;
  if (squash(raw?.record_id)) row.register_id = squash(raw.record_id);
  if (squash(raw?.source_provider)) row.register_source = squash(raw.source_provider);
  if (citation) row.register_source_url = citation;
  const link = qid ? wikidataEntity(qid) : citation;
  if (link) row.source_url = link;
  return { row };
}

/**
 * An MLA's item key: with a QID, itemKeyFor of the row (its Wikidata link, the key a live refresh gives
 * the same person: url:wikidata.org/entity/<QID>); without one, the register's politician_id
 * (constituency, state and name), since such rows share their state's citation page.
 */
export function mlaItemKey(row) {
  if (row?.wikidata_qid) return itemKeyFor(row);
  return row?.politician_id ? `mla:${row.politician_id}` : itemKeyFor(row);
}

const MLA_STATE_ORDER = new Map(FEED_REGISTERS['state:MLA Directory'].values.map((v, i) => [v, i]));
/** By state (the variants' order), then constituency, then name. */
const mlaOrder = (a, b) =>
  MLA_STATE_ORDER.get(a.state) - MLA_STATE_ORDER.get(b.state)
  || a.constituency.localeCompare(b.constituency, 'en') || a.title.localeCompare(b.title, 'en');

/**
 * The registers this script knows. file: the workbook, relative to the repository. map: a register
 * row to { row } or { drop }. liveKey: the key a live refresh gives the row's item (null: itemKeyFor
 * of the row, as built). releaseGroup and prefers: rows that share a group are releases of one decision,
 * and `prefers(a, b)` says whether a is the one kept. links and noun: the stored answer's links and what
 * its records are called. Optional: itemKey (each row's key, used in place of the store's own keying,
 * which would merge rows that share a link), order (the items' order, default newest first), dateOf (a
 * row's date for the report and coverage, default row.date), variantOf (a row's store variant: the
 * module is a register module, loaded one variant at a time) and note (the stored note).
 */
export const REGISTERS = Object.freeze({
  'national:Cabinet Decisions': {
    file: 'backup/NATIONAL/F25_Cabinet_Decisions.xlsx',
    map: mapCabinetRegisterRow,
    liveKey: cabinetLiveKey,
    releaseGroup: cabinetReleaseGroup,
    prefers: cabinetPrefers,
    links: ['https://www.pib.gov.in/'],
    noun: 'PIB Cabinet decisions',
  },
  'state:MLA Directory': {
    file: 'backup/STATE/F30_MLA_Directory.xlsx',
    map: mapMlaRegisterRow,
    itemKey: mlaItemKey,
    order: mlaOrder,
    dateOf: (row) => row.as_of || '',
    variantOf: (row) => row.state,
    links: ['https://www.wikidata.org/'],
    noun: 'MLAs',
    note: (report, file) =>
      `Stored register of ${report.kept} MLAs of ${report.variant}, as of ${report.newest || 'an unrecorded date'}, loaded from ${file}. It is not refreshed: it stays as loaded until the register is loaded again.`,
  },
});

// ---------------------------------------------------------------------------------------------
// Building the items.

const byNewest = (a, b) =>
  b.date.localeCompare(a.date) || Number(b.prid || 0) - Number(a.prid || 0) || a.title.localeCompare(b.title);

/**
 * The register as feed items. `rawRows` are the workbook's rows (readBackupRows); `register` is an
 * entry of REGISTERS; `kind` is the module's keeping kind. The rows are mapped, put newest first (date,
 * then PRID) so a load is the same whatever order the sheet was saved in, reduced to one release per
 * decision, built with itemsFromRows (as a refresh builds them), then keyed as the live refresh keys the
 * same release. `report` counts every row read and every row left out, with the reason.
 */
export function buildRegisterItems(rawRows, register, kind) {
  const report = {
    read: rawRows.length,
    dropped: { no_title: 0, no_date: 0, bad_date: 0, not_module: 0 },
    store_dropped: { status_rows: 0, invalid: 0, oversize: 0, duplicate: 0, over_limit: 0 },
    release_variants: 0,
    key_duplicates: 0,
    kept: 0,
    oldest: '',
    newest: '',
  };
  const mapped = [];
  for (const raw of rawRows) {
    const out = register.map(raw);
    if (out.drop) report.dropped[out.drop] = (report.dropped[out.drop] || 0) + 1;
    else mapped.push(out.row);
  }
  mapped.sort(register.order || byNewest);
  let rows = mapped;
  if (register.releaseGroup) {
    const kept = new Map();
    for (const row of mapped) {
      const group = register.releaseGroup(row);
      const held = kept.get(group);
      if (!held) {
        kept.set(group, row);
        continue;
      }
      report.release_variants += 1;
      if (register.prefers(row, held)) kept.set(group, row);
    }
    const keep = new Set(kept.values());
    rows = mapped.filter((row) => keep.has(row));
  }
  const built = register.itemKey ? itemsOneByOne(rows, kind, register.itemKey) : itemsFromRows(rows, kind);
  report.store_dropped = built.dropped;

  const seen = new Set();
  const items = [];
  for (const item of built.items) {
    const key = register.liveKey?.(item.row) || item.item_key;
    if (seen.has(key)) {
      report.key_duplicates += 1;
      continue;
    }
    seen.add(key);
    items.push({ ...item, item_key: key });
  }
  report.kept = items.length;
  const dates = items.map((i) => (register.dateOf ? register.dateOf(i.row) : i.row.date)).filter(Boolean).sort();
  report.oldest = dates[0] || '';
  report.newest = dates[dates.length - 1] || '';
  return { items, report };
}

/**
 * Rows built one at a time, as itemsFromRows builds them (status rows, invalid and oversize rows left
 * out), each keyed by `itemKey(row)`: itemsFromRows keys rows itself and keeps one per shared link.
 */
function itemsOneByOne(rows, kind, itemKey) {
  const dropped = { status_rows: 0, invalid: 0, oversize: 0, duplicate: 0, over_limit: 0 };
  const items = [];
  for (const row of rows) {
    const one = itemsFromRows([row], kind);
    for (const [reason, n] of Object.entries(one.dropped)) dropped[reason] += n;
    for (const item of one.items) items.push({ ...item, item_key: itemKey(item.row) });
  }
  return { items, dropped };
}

/**
 * A register module's items by store variant, in the register's variant order, each with its own
 * report (variant, kept, oldest and newest date) for its stored note.
 */
export function groupByVariant(items, register) {
  const groups = new Map();
  for (const item of items) {
    const variant = register.variantOf(item.row);
    if (!groups.has(variant)) groups.set(variant, []);
    groups.get(variant).push(item);
  }
  return [...groups].map(([variant, list]) => {
    const dates = list.map((i) => (register.dateOf ? register.dateOf(i.row) : i.row.date)).filter(Boolean).sort();
    // The variant's own citations (MLA Directory: its assembly's page), named in its stored links.
    const links = [...new Set(list.map((i) => i.row.register_source_url).filter(Boolean))].slice(0, 10);
    return { variant, items: list, report: { variant, kept: list.length, oldest: dates[0] || '', newest: dates[dates.length - 1] || '', links } };
  });
}

/** feed_state.meta for the register: shown until the first live refresh replaces it. */
export function registerMeta(register, report, file, fetchedAt) {
  return metaFor(
    {
      source: {
        adapter: 'register',
        kind: 'register',
        links: [...new Set([...(register.links || []), ...(report.links || [])])],
        note: register.note ? register.note(report, file) : `Stored register of ${report.kept} ${register.noun || 'records'}, ${report.oldest} to ${report.newest}, loaded from ${file}. Each refresh adds the newest releases on top.`,
      },
      coverage: { from: report.oldest, through: report.newest, exhaustive: false },
    },
    fetchedAt,
  );
}

// ---------------------------------------------------------------------------------------------
// Loading.

/**
 * The one module's run, as feed_claim_due takes it (the database ignores `params`). Throws when the
 * module is not scheduled or keeps its list by replacing it.
 */
export function runFor(moduleId, { runs = feedRunsForDb() } = {}) {
  const [tier, feature] = moduleId.split(/:(.*)/s);
  const run = runs.find((r) => r.tier === tier && r.feature === feature && !r.variant);
  if (!run) throw new Error(`${moduleId} is not a scheduled module (server/feedSchedule.mjs)`);
  if (!KEPT_KINDS.includes(run.kind)) {
    throw new Error(
      `${moduleId} is kept as "${run.kind}": each refresh replaces its list, so a register loaded now would be pruned (the C6 report lists the options)`,
    );
  }
  const { params: _params, ...pRun } = run;
  return pRun;
}

/**
 * A register module's runs, one per variant (server/feedSchedule.mjs registerRunsForDb), as
 * feed_claim_due takes them. Throws when the module is not a register module or a run is not of a kept kind.
 */
export function registerRunsFor(moduleId) {
  const runs = registerRunsForDb(moduleId);
  if (!runs.length) throw new Error(`${moduleId} is not a register module (server/feedSchedule.mjs FEED_REGISTERS)`);
  for (const run of runs) if (!KEPT_KINDS.includes(run.kind)) throw new Error(`${moduleId} / ${run.variant} is kept as "${run.kind}"`);
  return runs;
}

/**
 * Claim the module and record the items. `rpc(name, args)` is the database (localRpc, supabaseRpc, or
 * a fake). Returns { state: 'recorded', answer, claim } or { state: 'not_due', page }.
 */
export async function loadRegister({ rpc, run, items, meta, now = Date.now, leaseSeconds = LEASE_SECONDS }) {
  if (items.length > MAX_ITEMS) throw new Error(`${items.length} items; one record holds at most ${MAX_ITEMS}`);
  const started = now();
  const claimed = await rpc('feed_claim_due', { p_runs: [run], p_limit: 1, p_lease_seconds: leaseSeconds });
  const claim = Array.isArray(claimed) ? claimed.find((c) => c.tier === run.tier && c.feature === run.feature && (c.variant || '') === (run.variant || '')) : null;
  if (!claim) {
    const page = await rpc('feed_page', { p_tier: run.tier, p_feature: run.feature, p_variant: run.variant || '', p_limit: 1, p_offset: 0 });
    return { state: 'not_due', page };
  }
  const answer = await rpc('feed_record', {
    p: {
      tier: run.tier,
      feature: run.feature,
      variant: run.variant || '',
      lease_token: claim.lease_token,
      status: 'ok',
      ms: Math.max(0, Math.round(now() - started)),
      error: null,
      started_at: new Date(started).toISOString(),
      items,
      meta,
    },
  });
  return { state: 'recorded', answer, claim };
}

/** The module's stored page after a load: its item count, newest items first, state. */
export async function readBack(rpc, run, limit = 3) {
  return rpc('feed_page', { p_tier: run.tier, p_feature: run.feature, p_variant: run.variant || '', p_limit: limit, p_offset: 0 });
}

// ---------------------------------------------------------------------------------------------
// Local database adapter: docker exec psql, as service_role.

const LOCAL_DB = /^niyantran_[a-z0-9_]+_test$/;
/** Throws unless `db` names a local test database. */
export function assertLocalDb(db) {
  if (!LOCAL_DB.test(String(db || ''))) throw new Error('--db must name a local test database (niyantran_<name>_test)');
}
const RPC_FUNCTIONS = new Set(['feed_claim_due', 'feed_record', 'feed_page']);
const SET_RETURNING = new Set(['feed_claim_due']);

const randomTag = () => `q${randomBytes(4).toString('hex')}`;

/** A PostgreSQL dollar-quoted literal; the tag is drawn again while the text contains it. */
export function dollarQuote(text, nextTag = randomTag) {
  let tag;
  do tag = nextTag();
  while (text.includes(`$${tag}$`));
  return `$${tag}$${text}$${tag}$`;
}

/** The SQL for one rpc call: named arguments, as PostgREST passes them. */
export function rpcSql(name, args) {
  if (!RPC_FUNCTIONS.has(name)) throw new Error(`rpc ${name} is not one this script calls`);
  const list = Object.entries(args || {}).map(([key, value]) => {
    if (!/^[a-z_][a-z0-9_]*$/.test(key)) throw new Error(`bad argument name ${key}`);
    if (value === null || value === undefined) return `${key} => null`;
    if (typeof value === 'number') {
      if (!Number.isInteger(value)) throw new Error(`${key} must be a whole number`);
      return `${key} => ${value}`;
    }
    if (typeof value === 'string') return `${key} => ${dollarQuote(value)}::text`;
    return `${key} => ${dollarQuote(JSON.stringify(value))}::jsonb`;
  });
  const call = `public.${name}(${list.join(', ')})`;
  return SET_RETURNING.has(name)
    ? `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from ${call} as t;`
    : `select ${call};`;
}

/** Run SQL in a local Postgres container with psql; resolves with its output. */
export function dockerPsql({ container, db, sql, spawnImpl = spawn }) {
  return new Promise((resolvePromise, reject) => {
    const env = { ...process.env, PATH: `${process.env.HOME || ''}/.docker/bin:${process.env.PATH || ''}` };
    const child = spawnImpl(
      'docker',
      ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
      { env },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolvePromise(out.trim()) : reject(Object.assign(new Error(err.trim() || `psql exited ${code}`), { stderr: err }))));
    child.stdin.end(sql);
  });
}

/**
 * rpc(name, args) against a local test database, as the service_role (the role PostgREST uses with
 * the secret key). The database must be named niyantran_*_test, the guard supabase/tests/bootstrap_auth.sql
 * also applies, so this cannot be pointed at a real project.
 */
export function localRpc({ container = DEFAULT_CONTAINER, db, exec = dockerPsql } = {}) {
  assertLocalDb(db);
  if (!/^[A-Za-z0-9_.-]+$/.test(container)) throw new Error('bad container name');
  return async (name, args) => {
    let text;
    try {
      text = await exec({ container, db, sql: `set role service_role;\n${rpcSql(name, args)}\n` });
    } catch (err) {
      const m = /ERROR:\s+([0-9A-Z]{5}):\s*(.*)/.exec(err.stderr || err.message || '');
      throw Object.assign(new Error(`${name}: ${(m ? m[2] : err.message).split('\n')[0]}`), { code: m ? m[1] : 'psql' });
    }
    // psql prints "SET" for set role only without -q; the answer is the last non-empty line.
    const last = text.split('\n').filter(Boolean).pop();
    return last ? JSON.parse(last) : null;
  };
}

/** Local test only: make the module due now, as the database owner (no service_role function does). */
export async function forceDueLocal({ container = DEFAULT_CONTAINER, db, run, exec = dockerPsql }) {
  assertLocalDb(db);
  const sql = `update public.feed_state set next_due_at = now() where tier = ${dollarQuote(run.tier)} and feature = ${dollarQuote(run.feature)} and variant = ${dollarQuote(run.variant || '')};`;
  await exec({ container, db, sql });
}

// ---------------------------------------------------------------------------------------------
// Live sample: today's live answer, compared with the register's keys.

/**
 * Compare the register's items with a live answer's rows. `registerKeys` is what the load would
 * record. `rawKeys` is itemKeyFor of each register row's own link, which is what a load would record
 * without the live-key line: the difference shows whether the two PIB link forms agree.
 */
export function compareWithLive(items, liveRows, { kind = 'official', liveKeyOf = cabinetLiveKey } = {}) {
  const liveItems = itemsFromRows(liveRows, kind).items;
  const liveKeys = new Set(liveItems.map((i) => i.item_key));
  const registerKeys = new Set(items.map((i) => i.item_key));
  const rawKeys = new Set(items.map((i) => itemKeyFor(i.row)));
  const registerPrids = new Set(items.map((i) => i.row.prid).filter(Boolean));
  const livePrids = liveItems.map((i) => /PRID=(\d+)/i.exec(i.row.source_url || '')?.[1]).filter(Boolean);
  const count = (a, b) => [...a].filter((k) => b.has(k)).length;
  return {
    live_rows: liveItems.length,
    live_newest: liveItems.map((i) => i.row.date).filter(Boolean).sort().pop() || '',
    same_release: livePrids.filter((p) => registerPrids.has(p)).length,
    key_collisions_with_live_keys: count(registerKeys, liveKeys),
    key_collisions_if_register_keyed_by_its_own_link: count(rawKeys, liveKeys),
    sample_live_keys: [...liveKeys].slice(0, 2),
    sample_register_keys: items.slice(0, 2).map((i) => i.item_key),
    sample_register_own_link_keys: [...rawKeys].slice(0, 2),
    sample_live_key_for_first_register_prid: liveKeyOf(items[0]?.row) || '',
  };
}

async function fetchLiveRows(moduleId) {
  const { serveFeatureFeed } = await import('../server/featureFeed.mjs');
  const { classifyAnswer } = await import('../server/feedStore.mjs');
  const [tier, feature] = moduleId.split(/:(.*)/s);
  const body = await serveFeatureFeed(new URLSearchParams({ tier, feature }));
  const verdict = classifyAnswer(body);
  return { verdict, rows: verdict.status === 'ok' ? body.rows.filter((r) => r?.status !== 'source_status') : [] };
}

// ---------------------------------------------------------------------------------------------
// Command line.

const OPTIONS = {
  module: { type: 'string', default: DEFAULT_MODULE },
  file: { type: 'string' },
  'dry-run': { type: 'boolean', default: false },
  apply: { type: 'boolean', default: false },
  target: { type: 'string' },
  db: { type: 'string' },
  container: { type: 'string', default: DEFAULT_CONTAINER },
  'confirm-prod': { type: 'boolean', default: false },
  force: { type: 'boolean', default: false },
  'live-sample': { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
};

const line = (label, value) => console.log(`  ${label.padEnd(40)} ${value}`);

function printReport(report, { releases = true } = {}) {
  console.log('Register rows');
  line('read from the workbook', report.read);
  for (const [reason, n] of Object.entries(report.dropped)) line(`left out: ${reason}`, n);
  if (releases) line('left out: second release of a decision', report.release_variants);
  for (const [reason, n] of Object.entries(report.store_dropped)) if (n) line(`left out by the store: ${reason}`, n);
  line('duplicate keys (first kept)', report.key_duplicates);
  line('kept', report.kept);
  line('dates', `${report.oldest} to ${report.newest}`);
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '(not a URL)';
  }
}

export const USAGE = `Usage: node scripts/load-feed-register.mjs [--module "tier:Feature"] [--file path] [--live-sample]
       [--apply --target local --db niyantran_<name>_test [--force]]
       [--apply --target prod --confirm-prod]      (SUPABASE_URL and SUPABASE_SECRET_KEY in the environment)

A dry run is the default: it reads the register, prints the counts and a sample, and never calls a database.
Only a module of kind "official" can be loaded: Cabinet Decisions, and the register module MLA Directory
(--module "state:MLA Directory", one store variant per state, never refreshed by the timer).

ORDER: run the production load BEFORE the 5-minute refresh job is switched on. A load makes the module's
first refresh an interval (60 min) away; after the job has run, a load usually reports NOT DUE, and one
made after a refresh puts the register's copy over the live row of any release both hold.`;

/**
 * The refusals, all before anything is read or any database client is made. Returns the production
 * URL when the target is prod. Throws for: --dry-run with --apply; --apply without --target local|prod;
 * a local database that is not niyantran_*_test; for prod, --force, a missing SUPABASE_URL or
 * SUPABASE_SECRET_KEY, and a missing --confirm-prod.
 */
export function checkOptions(o, env = process.env) {
  if (o['dry-run'] && o.apply) throw new Error('--dry-run and --apply cannot be used together');
  if (!o.apply) return { url: '' };
  if (o.target === 'local') {
    assertLocalDb(o.db);
    return { url: '' };
  }
  if (o.target === 'prod') {
    if (o.force) throw new Error('--force is for a local test database only; no database function makes a module due');
    const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || '';
    if (!url || !env.SUPABASE_SECRET_KEY) throw new Error('--target prod needs SUPABASE_URL and SUPABASE_SECRET_KEY in the environment');
    if (!o['confirm-prod']) throw new Error(`--target prod would write to ${hostOf(url)}; add --confirm-prod`);
    return { url };
  }
  throw new Error('--apply needs --target local or --target prod');
}

/**
 * The command. `deps` is for tests: env (default process.env), registers, readRows (the workbook
 * reader), makeLocalRpc and makeProdRpc (database client factories, called only after a successful
 * --apply check, never in a dry run), forceDue, fetchLive. Returns the exit code: 0 done, 1 the store
 * did not accept the load, 3 not due. A refusal throws.
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const {
    env = process.env,
    registers = REGISTERS,
    readRows = readBackupRows,
    makeLocalRpc = localRpc,
    makeProdRpc = supabaseRpc,
    forceDue = forceDueLocal,
    fetchLive = fetchLiveRows,
  } = deps;
  const { values: o } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false });
  if (o.help) {
    console.log(USAGE);
    return 0;
  }
  const { url } = checkOptions(o, env);
  const register = registers[o.module];
  if (!register) throw new Error(`no register mapping for ${o.module}; the mapped modules are: ${Object.keys(registers).join(', ')}`);
  if (register.variantOf) return loadVariants({ o, url, env, register, readRows, makeLocalRpc, makeProdRpc, forceDue });
  const run = runFor(o.module);
  const file = o.file || register.file;
  const shownFile = displayFile(file);
  const rawRows = readRows(resolve(ROOT, file), 5000);
  const { items, report } = buildRegisterItems(rawRows, register, run.kind);
  if (!items.length) throw new Error('no item to load');
  if (items.length > MAX_ITEMS) throw new Error(`${items.length} items; one record holds at most ${MAX_ITEMS}`);
  const meta = registerMeta(register, report, shownFile, new Date().toISOString());

  console.log(`${o.apply ? 'APPLY' : 'DRY RUN'}: ${o.module} (${run.kind}, refreshed every ${run.interval_minutes} min) from ${shownFile}`);
  printReport(report);
  const bytes = Buffer.byteLength(JSON.stringify({ items, meta }));
  console.log(o.apply ? 'Recording' : 'Would record');
  line('feed_record items', `${items.length} (status ok, one record, ${(bytes / 1024).toFixed(0)} KB)`);
  line('first / last item', `${items[0].row.date} / ${items[items.length - 1].row.date}`);
  line('note', meta.note);
  console.log('Sample (3 of the mapped items)');
  for (const i of [0, Math.floor(items.length / 2), items.length - 1]) {
    console.log(JSON.stringify({ item_key: items[i].item_key, published_at: items[i].published_at, url: items[i].url, row: items[i].row }, null, 2));
  }

  if (o['live-sample']) {
    console.log("Today's live answer");
    try {
      const live = await fetchLive(o.module);
      line('verdict', `${live.verdict.status}${live.verdict.reason ? `: ${live.verdict.reason}` : ''}`);
      console.log(JSON.stringify(compareWithLive(items, live.rows, { kind: run.kind }), null, 2));
    } catch (err) {
      line('live sample failed', String(err?.message || err).slice(0, 200));
    }
  }

  if (!o.apply) {
    console.log('Dry run: the database was not called. Add --apply with --target local or --target prod.');
    return 0;
  }

  let rpc;
  if (o.target === 'local') {
    rpc = makeLocalRpc({ container: o.container, db: o.db });
    if (o.force) {
      await forceDue({ container: o.container, db: o.db, run });
      console.log(`--force: ${o.module} set due in ${o.db} (local test only)`);
    }
  } else {
    console.log(`Target: ${hostOf(url)}`);
    rpc = makeProdRpc({ url, key: env.SUPABASE_SECRET_KEY, timeoutMs: 60_000 });
  }

  const before = await readBack(rpc, run, 1);
  line('items held before', before ? before.total : '(module not in the store yet)');
  const result = await loadRegister({ rpc, run, items, meta });
  if (result.state === 'not_due') {
    const p = result.page;
    console.log('NOT DUE: the claim returned nothing. The module is not due (or another run holds it), so nothing was recorded.');
    if (p) console.log(`  last checked ${p.checked_at}, refreshed every ${p.interval_minutes} min, ${p.total} items held, last error: ${p.last_error || 'none'}`);
    console.log('  Wait for its next run, or on a local test database use --force. No production function makes a module due.');
    return 3;
  }
  console.log(`Recorded: ${JSON.stringify(result.answer)}`);
  const after = await readBack(rpc, run, 3);
  line('items held after', after?.total);
  line('serve switch', after?.serve);
  line('newest three', (after?.items || []).map((i) => `${String(i.published_at).slice(0, 10)} ${String(i.row?.title).slice(0, 50)}`).join(' | '));
  return result.answer?.status === 'ok' || result.answer?.status === 'unchanged' ? 0 : 1;
}

/**
 * A register module's load (main, after the same gate): the register's items grouped by store variant,
 * each variant claimed and recorded on its own (registerRunsFor), then each variant's stored count read
 * back. Returns 0 when every variant recorded ok or unchanged, 3 when any was not due (the others are
 * still recorded), 1 when the store did not accept one.
 */
async function loadVariants({ o, url, env, register, readRows, makeLocalRpc, makeProdRpc, forceDue }) {
  const runs = registerRunsFor(o.module);
  const file = o.file || register.file;
  const shownFile = displayFile(file);
  const rawRows = readRows(resolve(ROOT, file), 10_000);
  const { items, report } = buildRegisterItems(rawRows, register, runs[0].kind);
  if (!items.length) throw new Error('no item to load');
  const groups = groupByVariant(items, register);
  for (const g of groups) {
    if (!runs.some((r) => r.variant === g.variant)) throw new Error(`${o.module} has no store variant "${g.variant}"`);
    if (g.items.length > MAX_ITEMS) throw new Error(`${g.variant}: ${g.items.length} items; one record holds at most ${MAX_ITEMS}`);
  }
  const fetchedAt = new Date().toISOString();

  console.log(`${o.apply ? 'APPLY' : 'DRY RUN'}: ${o.module} (register: ${runs[0].kind}, one store variant per ${FEED_REGISTERS[o.module]?.param || 'value'}, never refreshed by the timer) from ${shownFile}`);
  printReport(report, { releases: Boolean(register.releaseGroup) });
  console.log(`${o.apply ? 'Recording' : 'Would record'} ${groups.length} store variants, ${items.length} items`);
  for (const g of groups) line(g.variant, `${g.items.length}`);
  line('note (first variant)', registerMeta(register, groups[0].report, shownFile, fetchedAt).note);
  console.log('Sample (3 of the mapped items)');
  for (const i of [0, Math.floor(items.length / 2), items.length - 1]) {
    console.log(JSON.stringify({ item_key: items[i].item_key, published_at: items[i].published_at, url: items[i].url, row: items[i].row }, null, 2));
  }
  if (!o.apply) {
    console.log('Dry run: the database was not called. Add --apply with --target local or --target prod.');
    return 0;
  }

  let rpc;
  if (o.target === 'local') {
    rpc = makeLocalRpc({ container: o.container, db: o.db });
  } else {
    console.log(`Target: ${hostOf(url)}`);
    rpc = makeProdRpc({ url, key: env.SUPABASE_SECRET_KEY, timeoutMs: 60_000 });
  }
  const outcomes = [];
  for (const g of groups) {
    const run = runs.find((r) => r.variant === g.variant);
    if (o.force && o.target === 'local') await forceDue({ container: o.container, db: o.db, run });
    const meta = registerMeta(register, g.report, shownFile, fetchedAt);
    const result = await loadRegister({ rpc, run, items: g.items, meta });
    if (result.state === 'not_due') {
      const p = result.page;
      line(g.variant, `NOT DUE${p ? ` (last checked ${p.checked_at}, ${p.total} items held)` : ''}`);
      outcomes.push('not_due');
      continue;
    }
    const a = result.answer || {};
    line(g.variant, `${a.status}: ${a.items} items, ${a.new_items ?? 0} new, ${a.changed_items ?? 0} changed, ${a.item_count ?? '?'} held`);
    outcomes.push(a.status);
  }
  if (o.force && o.target === 'local') console.log(`--force: each variant was set due in ${o.db} first (local test only)`);
  console.log('Held after the load');
  let held = 0;
  for (const g of groups) {
    const page = await readBack(rpc, runs.find((r) => r.variant === g.variant), 1);
    held += Number(page?.total) || 0;
    line(g.variant, `${page?.total ?? '(not in the store)'} items, serve ${page?.serve}`);
  }
  line('total held', held);
  if (outcomes.some((s) => s !== 'ok' && s !== 'unchanged' && s !== 'not_due')) return 1;
  if (outcomes.includes('not_due')) {
    console.log('NOT DUE: some variants were not recorded. Wait 30 days from their last load, or on a local test database use --force.');
    return 3;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`load-feed-register: ${err?.message || err}`);
      process.exitCode = 2;
    },
  );
}
