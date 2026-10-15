#!/usr/bin/env node
/**
 * F196: fetch the RBI Handbook of Statistics on Indian States (yearly) and write it as one long-form
 * JSON register for scripts/load-feed-register.mjs.
 *
 *   node scripts/fetch-rbi-handbook.mjs                 # fetch every table the modules use, write the JSON
 *   node scripts/fetch-rbi-handbook.mjs --check         # the listing only: compare it with src/lib/rbiHandbookTables.js
 *   node scripts/fetch-rbi-handbook.mjs --offline       # parse the saved pages again, no request
 *   node scripts/fetch-rbi-handbook.mjs --tables 21,164 # some tables only
 *
 * Options: --out <file> (default tmp/rbi-handbook/handbook-<edition>.json), --html-dir <dir> (default
 * tmp/rbi-handbook/html; each page is saved there and read from there on the next run unless
 * --refetch), --tables <n,n,…>, --delay-ms <ms> (default 1100), --offline, --refetch, --check.
 * tmp/ is not committed; the output is not shipped with the site (it goes to the feed store).
 *
 * What it reads: the publication listing (HANDBOOK.listingUrl), then each table's plain HTML page
 * (PublicationsView.aspx?id=…), one request at a time with a pause between them, as
 * NiyantranTerminal's user agent. The spreadsheet downloads are behind a captcha and are never
 * requested. A page that is not the expected table page (an error, a challenge or block page) stops the
 * run: nothing is retried and nothing tries to get past it.
 *
 * Size: a table keeps at most MAX_PER_TABLE figures (one store page), its newest whole years; a table
 * whose newest year alone is larger keeps that year's whole indicators (2024-25 edition: Tables 95 and
 * 176). The register's table summary records what was left out (`cut`), and the stored note says it.
 *
 * Left out by design: Tables 1, 12 and 151 (2024-25 edition) each carry one block whose heading names no
 * year (the run reports its figures as "without a year"). A figure with no year cannot be keyed, ranked
 * or compared, and src/lib/rbiHandbook.js never guesses one, so the block is dropped; the rest of each
 * table is kept.
 *
 * Checks: every table's title on the listing and on its page against src/lib/rbiHandbookTables.js, and
 * each page's date against the edition's (HANDBOOK.published). A mismatch is reported; --check exits 1
 * on one, a fetch writes the JSON but exits 1 so the load is not run unseen.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { newestYearsWithin, parseHandbookListing, parseHandbookTable } from '../src/lib/rbiHandbook.js';
import { HANDBOOK, HANDBOOK_MODULES, HANDBOOK_TABLE_NUMBERS, HANDBOOK_TABLES } from '../src/lib/rbiHandbookTables.js';
import { STORE_PAGE_ROWS } from '../server/feedServe.mjs';

export const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
/** The repository's crawler user agent (server/featureFeed.mjs USER_AGENT_BOT). */
export const USER_AGENT = 'Mozilla/5.0 (compatible; NiyantranTerminal/1.0; +https://localhost) AppleWebKit/537.36';
export const DEFAULT_OUT = `tmp/rbi-handbook/handbook-${HANDBOOK.edition}.json`;
export const DEFAULT_HTML_DIR = 'tmp/rbi-handbook/html';
const FETCH_TIMEOUT_MS = 30_000;
/**
 * One store variant (one table) holds at most this many figures: one store page (server/feedServe.mjs
 * STORE_PAGE_ROWS, the most public.feed_page returns), so the page and the Cross-State Comparison Engine
 * always read a table whole. A larger table keeps its newest whole years (src/lib/rbiHandbook.js
 * newestYearsWithin).
 */
export const MAX_PER_TABLE = STORE_PAGE_ROWS;

const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const sameTitle = (a, b) => squash(a).toLowerCase().replace(/[^a-z0-9]+/g, '') === squash(b).toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Why a fetched page is not the page asked for ('' when it is). Never answered by retrying. */
export function refusal(status, html, kind) {
  if (status !== 200) return `HTTP ${status}`;
  const text = String(html ?? '');
  if (/captcha|are you a robot|access denied|request unsuccessful|cf-challenge|bot verification/i.test(text)) return 'a challenge or block page';
  if (kind === 'listing' && !/PublicationsView\.aspx\?id=/i.test(text)) return 'not the publication listing';
  if (kind === 'table' && !/class=["']?tableheader/i.test(text)) return 'not a table page';
  return '';
}

/** The listing compared with src/lib/rbiHandbookTables.js: a list of mismatches (empty when they agree). */
export function compareListing(listing, { tables = HANDBOOK_TABLES, edition = HANDBOOK } = {}) {
  const problems = [];
  if (listing.published && listing.published !== edition.published) {
    problems.push(`the listing's latest edition is dated ${listing.published}, src/lib/rbiHandbookTables.js has ${edition.published}`);
  }
  const byNo = new Map(listing.tables.map((t) => [t.no, t]));
  for (const t of tables.values()) {
    const l = byNo.get(t.no);
    if (!l) problems.push(`Table ${t.no} is not on the listing`);
    else {
      if (l.id !== t.id) problems.push(`Table ${t.no}: page id ${l.id} on the listing, ${t.id} here`);
      if (!sameTitle(l.title, t.title)) problems.push(`Table ${t.no}: "${l.title}" on the listing, "${t.title}" here`);
    }
  }
  return problems;
}

async function fetchPage(url, fetchImpl) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }, signal: ac.signal, redirect: 'follow' });
    return { status: res.status, html: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The register from the parsed tables: { source, edition, published, …, tables: [...], records }.
 * Each table's summary keeps its unit, source, legend, counts and anything left out.
 */
export function buildRegister(parsed, { fetchedAt = new Date().toISOString() } = {}) {
  const tables = parsed.map(({ meta, out }) => ({
    no: meta.no,
    id: meta.id,
    title: out.table.title || meta.title,
    url: meta.url,
    published: out.table.published,
    unit: out.table.unit,
    source: out.table.source,
    notes: out.table.notes,
    records: out.records.length,
    dropped: out.dropped,
    unmapped: out.unmapped,
    ...(out.cut ? { cut: out.cut } : {}),
    ...(out.error ? { error: out.error } : {}),
  }));
  return {
    source: `${HANDBOOK.publisher}, ${HANDBOOK.title}`,
    edition: HANDBOOK.edition,
    published: HANDBOOK.published,
    listing_url: HANDBOOK.listingUrl,
    fetched_at: fetchedAt,
    tables,
    records: parsed.flatMap(({ out }) => out.records),
  };
}

/** Per module: tables, records, and the largest table (one store variant, at most MAX_PER_TABLE figures). */
export function moduleCounts(register, modules = HANDBOOK_MODULES) {
  const byTable = new Map();
  for (const r of register.records) byTable.set(r.table_no, (byTable.get(r.table_no) || 0) + 1);
  return Object.entries(modules).map(([id, spec]) => {
    const counts = spec.tables.map((no) => [no, byTable.get(no) || 0]);
    const [largestNo, largest] = counts.reduce((a, b) => (b[1] > a[1] ? b : a), [0, 0]);
    return { id, tables: spec.tables.length, records: counts.reduce((s, [, n]) => s + n, 0), empty: counts.filter(([, n]) => !n).map(([no]) => no), largest, largestNo };
  });
}

const OPTIONS = {
  out: { type: 'string', default: DEFAULT_OUT },
  'html-dir': { type: 'string', default: DEFAULT_HTML_DIR },
  tables: { type: 'string' },
  'delay-ms': { type: 'string', default: '1100' },
  offline: { type: 'boolean', default: false },
  refetch: { type: 'boolean', default: false },
  check: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
};

export async function main(argv = process.argv.slice(2), { fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const { values: o } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false });
  if (o.help) {
    log('Usage: node scripts/fetch-rbi-handbook.mjs [--check] [--offline] [--refetch] [--tables 21,164] [--out file] [--html-dir dir] [--delay-ms 1100]');
    return 0;
  }
  if (o.offline && (o.check || o.refetch)) throw new Error('--offline cannot be used with --check or --refetch');
  const delay = Math.max(1000, Number(o['delay-ms']) || 1100);
  const wanted = o.tables ? o.tables.split(',').map((s) => Number(s.trim())).filter(Boolean) : [...HANDBOOK_TABLE_NUMBERS];
  for (const no of wanted) if (!HANDBOOK_TABLES.has(no)) throw new Error(`Table ${no} is not one the modules use (src/lib/rbiHandbookTables.js)`);
  const htmlDir = resolve(ROOT, o['html-dir']);
  mkdirSync(htmlDir, { recursive: true });
  let requests = 0;
  const get = async (url, kind, file) => {
    const path = resolve(htmlDir, file);
    if (!o.refetch && existsSync(path)) return readFileSync(path, 'utf8');
    if (o.offline) throw new Error(`--offline: ${file} is not saved in ${o['html-dir']}`);
    if (requests) await sleep(delay);
    requests += 1;
    const { status, html } = await fetchPage(url, fetchImpl);
    const why = refusal(status, html, kind);
    if (why) throw new Error(`${url} answered ${why}; stopping (nothing is retried)`);
    writeFileSync(path, html);
    return html;
  };

  let problems = [];
  if (!o.offline) {
    const listing = parseHandbookListing(await get(HANDBOOK.listingUrl, 'listing', 'listing.html'));
    problems = compareListing(listing);
    log(`Listing: ${listing.tables.length} tables, latest edition dated ${listing.published || '(not found)'}`);
    for (const p of problems) log(`  MISMATCH ${p}`);
    if (o.check) {
      log(problems.length ? `${problems.length} mismatches: update src/lib/rbiHandbookTables.js before loading.` : 'The listing agrees with src/lib/rbiHandbookTables.js.');
      return problems.length ? 1 : 0;
    }
  }

  const parsed = [];
  for (const no of wanted) {
    const meta = HANDBOOK_TABLES.get(no);
    const out = parseHandbookTable(await get(meta.url, 'table', `${meta.id}.html`), { tableNo: no, url: meta.url });
    // A table larger than one store variant keeps its newest whole years (or, when its newest year alone
    // is larger, that year's whole indicators); the register's table summary says what was left out.
    const capped = newestYearsWithin(out.records, MAX_PER_TABLE);
    out.records = capped.records;
    out.dropped.older_years = capped.left;
    if (capped.left) out.cut = { left: capped.left, years: capped.years.length, from: capped.years.at(-1) || '', through: capped.years[0] || '', ...(capped.partial ? { partial: capped.partial } : {}) };
    if (!sameTitle(out.table.title, meta.title)) problems.push(`Table ${no}: the page is titled "${out.table.title}", "${meta.title}" here`);
    if (out.table.published && out.table.published !== HANDBOOK.published) problems.push(`Table ${no}: the page is dated ${out.table.published}, the edition ${HANDBOOK.published}`);
    if (out.error) problems.push(`Table ${no}: ${out.error}`);
    parsed.push({ meta, out });
    const d = out.dropped;
    log(`Table ${String(no).padStart(3)}: ${String(out.records.length).padStart(5)} records${d.no_year ? `, ${d.no_year} without a year` : ''}${d.missing ? `, ${d.missing} not available` : ''}${d.invalid ? `, ${d.invalid} not numbers` : ''}${d.unmapped_state ? `, ${d.unmapped_state} in rows not a state (${out.unmapped.join('; ').slice(0, 120)})` : ''}${d.duplicate ? `, ${d.duplicate} duplicates` : ''}${d.older_years ? `, ${d.older_years} left out over the ${MAX_PER_TABLE} a table holds (${capped.partial ? `${capped.partial.indicators} of the ${capped.partial.of} indicators of ${capped.partial.year}` : `kept ${capped.years.at(-1)} onwards`})` : ''}`);
  }
  const register = buildRegister(parsed);
  const outPath = resolve(ROOT, o.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(register)}\n`);
  log(`Wrote ${register.records.length} records from ${parsed.length} tables to ${o.out} (${requests} requests)`);
  for (const m of moduleCounts(register)) {
    log(`  ${m.id.padEnd(52)} ${String(m.tables).padStart(3)} tables ${String(m.records).padStart(6)} records, largest table ${m.largestNo} (${m.largest})${m.empty.length ? `, empty: ${m.empty.join(', ')}` : ''}`);
  }
  for (const p of problems) log(`  MISMATCH ${p}`);
  return problems.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`fetch-rbi-handbook: ${err?.message || err}`);
      process.exitCode = 2;
    },
  );
}
