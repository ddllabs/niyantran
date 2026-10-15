#!/usr/bin/env node
/**
 * F196: the backfill for SDL Auction & Borrowing Tracker. RBI's press RSS lists only its latest ten
 * releases, so the module's history starts when it goes live; this reads the State Government
 * Securities auction releases the shipped F20 pack names (backup/NATIONAL/F20_Regulatory_Body_Watch_RBI_SEBI_TRAI_CCI.xlsx,
 * read only) from their release pages and writes them as rows for scripts/load-feed-register.mjs.
 *
 *   node scripts/fetch-rbi-sdl-releases.mjs                  # the pack's SDL releases -> tmp/rbi-sdl/sdl-releases.json
 *   node scripts/fetch-rbi-sdl-releases.mjs --prids 63087,63048
 *   node scripts/fetch-rbi-sdl-releases.mjs --offline        # parse the saved pages again
 *
 * Options: --out (default tmp/rbi-sdl/sdl-releases.json), --html-dir (default tmp/rbi-sdl/html),
 * --prids, --delay-ms (default 1100), --offline, --refetch. One request at a time with a pause, as
 * NiyantranTerminal's user agent; a page that is not a release page stops the run and nothing is retried.
 * "State Government Securities - Full Auction Result" releases are listed but not read (src/lib/rbiSdl.js).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { readBackupRows } from '../server/backupFeed.mjs';
import { rbiReleaseUrl, releasePageMeta, sdlReleaseKind, sdlRows } from '../src/lib/rbiSdl.js';
import { USER_AGENT } from './fetch-rbi-handbook.mjs';

export const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
export const F20_PACK = 'backup/NATIONAL/F20_Regulatory_Body_Watch_RBI_SEBI_TRAI_CCI.xlsx';
export const DEFAULT_OUT = 'tmp/rbi-sdl/sdl-releases.json';

/** The pack rows that are RBI State Government Securities auction releases: [{ prid, title, kind }]. */
export function packReleases(rows) {
  const out = new Map();
  for (const r of rows || []) {
    const title = String(r?.title || r?.record_title || '').trim();
    const prid = /prid=(\d+)/i.exec(String(r?.detail_url || r?.source_url || ''))?.[1];
    if (!prid || !/state government securities/i.test(title)) continue;
    out.set(prid, { prid, title, kind: sdlReleaseKind(title) });
  }
  return [...out.values()];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OPTIONS = {
  out: { type: 'string', default: DEFAULT_OUT },
  'html-dir': { type: 'string', default: 'tmp/rbi-sdl/html' },
  prids: { type: 'string' },
  'delay-ms': { type: 'string', default: '1100' },
  offline: { type: 'boolean', default: false },
  refetch: { type: 'boolean', default: false },
};

export async function main(argv = process.argv.slice(2), { fetchImpl = globalThis.fetch, log = console.log, readRows = readBackupRows } = {}) {
  const { values: o } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false });
  const listed = o.prids
    ? o.prids.split(',').map((p) => ({ prid: p.trim(), title: '', kind: '' })).filter((r) => /^\d+$/.test(r.prid))
    : packReleases(readRows(resolve(ROOT, F20_PACK), 5000));
  const htmlDir = resolve(ROOT, o['html-dir']);
  mkdirSync(htmlDir, { recursive: true });
  const delay = Math.max(1000, Number(o['delay-ms']) || 1100);
  let requests = 0;
  const releases = [];
  const records = [];
  for (const r of listed) {
    const path = resolve(htmlDir, `${r.prid}.html`);
    let html;
    if (!o.refetch && existsSync(path)) html = readFileSync(path, 'utf8');
    else if (o.offline) throw new Error(`--offline: ${r.prid}.html is not saved`);
    else {
      if (requests) await sleep(delay);
      requests += 1;
      const res = await fetchImpl(rbiReleaseUrl(r.prid), { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }, redirect: 'follow' });
      html = await res.text();
      if (res.status !== 200 || /captcha|access denied|request unsuccessful/i.test(html) || !/tableheader/i.test(html)) {
        throw new Error(`${rbiReleaseUrl(r.prid)} answered ${res.status} without a release page; stopping (nothing is retried)`);
      }
      writeFileSync(path, html);
    }
    const meta = releasePageMeta(html);
    const kind = sdlReleaseKind(meta.title || r.title);
    const rows = kind ? sdlRows({ kind, prid: r.prid, date: meta.date, title: meta.title || r.title, html }) : [];
    releases.push({ prid: r.prid, title: meta.title || r.title, date: meta.date, kind: kind || 'not read', rows: rows.length });
    records.push(...rows);
    log(`prid ${r.prid} ${meta.date} ${meta.title || r.title}: ${kind ? `${rows.length} lines` : 'not read (not a notice or a result)'}`);
  }
  const out = resolve(ROOT, o.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ source: 'Reserve Bank of India press releases', fetched_at: new Date().toISOString(), releases, records })}\n`);
  log(`Wrote ${records.length} lines from ${releases.filter((r) => r.rows).length} of ${releases.length} releases to ${o.out} (${requests} requests)`);
  return records.length ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`fetch-rbi-sdl-releases: ${err?.message || err}`);
      process.exitCode = 2;
    },
  );
}
