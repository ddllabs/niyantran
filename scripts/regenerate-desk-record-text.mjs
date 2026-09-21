#!/usr/bin/env node
/**
 * Rewrite public.desk_rows.record_text so it no longer carries the row's own
 * identifier (R1, docs/plans/2026-09-22-research-turn-findings.md).
 *
 *   node scripts/regenerate-desk-record-text.mjs              # dry run, writes nothing
 *   node scripts/regenerate-desk-record-text.mjs --apply      # writes
 *
 * Environment: SUPABASE_SECRET_KEY (sb_secret_…) and the project URL, read from
 * the environment or .env.local. The URL may be SUPABASE_URL or the equivalent
 * VITE_SUPABASE_URL, which is the one .env.local normally carries.
 *
 * Why a script and not SQL. The new text must equal deskRecordText(row) exactly,
 * because the search_desk_rows tool serves this stored column while browser
 * attachments compute the same text fresh. A regexp in SQL would be a second,
 * drifting implementation of the same rule. This calls the real function.
 *
 * Row identity is not touched. Every row_key in this table is pin-derived from
 * the row's own id field; none is a hash of record_text. The script proves that
 * per row before writing and aborts if any key would move.
 */
import { readFileSync } from 'node:fs';
import { deskRecordText, deskRowKey } from '../src/lib/deskRows.js';

const APPLY = process.argv.includes('--apply');
const PAGE = 500;

for (const line of (() => { try { return readFileSync('.env.local', 'utf8').split('\n'); } catch { return []; } })()) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
// VITE_SUPABASE_URL is the same public project URL and is what .env.local
// actually carries; only the secret key must come from SUPABASE_SECRET_KEY.
const URL_ = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
if (!URL_ || !KEY) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set (environment or .env.local)');
if (!KEY.startsWith('sb_secret_')) throw new Error('SUPABASE_SECRET_KEY must be an sb_secret_… key');

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

// Order by the whole primary key, not row_key alone. row_key is unique only
// within (tier, feature) - 34,184 rows share 22,998 distinct keys - so ordering
// by it leaves ties in an arbitrary order that offset paging can reshuffle
// between requests, silently skipping rows. Five rows were missed that way.
async function page(offset) {
  const url = `${URL_}/rest/v1/desk_rows?select=tier,feature,row_key,row,record_text,document_key,snapshot_at&order=tier.asc,feature.asc,row_key.asc&offset=${offset}&limit=${PAGE}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`read ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** One request per batch, not per row: 34,184 sequential PATCHes took hours and
 * held a connection open against a small instance for all of it. PostgREST
 * merges on the primary key when the payload carries all of it. */
async function writeBatch(updates) {
  if (!updates.length) return;
  const res = await fetch(`${URL_}/rest/v1/desk_rows?on_conflict=tier,feature,row_key`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`write batch of ${updates.length} ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

let scanned = 0, changed = 0, written = 0, keyMoves = 0, stillLeaking = 0;
const pending = [];
const samples = [];

for (let offset = 0;; offset += PAGE) {
  const rows = await page(offset);
  if (!rows.length) break;
  for (const r of rows) {
    scanned++;
    const next = deskRecordText(r.row);

    // Identity must not move. Abort loudly rather than write a single row.
    if (deskRowKey(r.row) !== r.row_key) {
      keyMoves++;
      console.error(`ROW KEY WOULD MOVE: ${r.row_key} -> ${deskRowKey(r.row)}`);
      continue;
    }
    // A leak is the key presented as a labelled value - `<field>: <key>` - which
    // is what the model reads as a citable token. The same slug inside a real
    // source_url is not a leak: four alliance rows legitimately have their key
    // in the URL path, and rejecting those would block the migration on prose.
    if (next.split('\n').some((l) => /^[A-Za-z_][\w]*: (.*)$/.exec(l)?.[1] === r.row_key)) stillLeaking++;
    if (next === r.record_text) continue;

    changed++;
    if (samples.length < 3) {
      const gone = r.record_text.split('\n').filter((l) => !next.includes(l));
      samples.push({ row_key: r.row_key, removed: gone });
    }
    // Carry every column the table needs. An upsert that conflicts updates only
    // the payload's columns, but sending the full row means an unexpected insert
    // could not write a half row either.
    if (APPLY) {
      pending.push({
        tier: r.tier, feature: r.feature, row_key: r.row_key, row: r.row,
        record_text: next, document_key: r.document_key, snapshot_at: r.snapshot_at,
      });
    }
  }
  if (APPLY && pending.length) { await writeBatch(pending); written += pending.length; pending.length = 0; }
  process.stdout.write(`\r  scanned ${scanned}  changed ${changed}${APPLY ? `  written ${written}` : ''}`);
}

console.log('');
for (const s of samples) console.log(`  ${s.row_key}\n    removed: ${s.removed.join(' | ')}`);
console.log({ scanned, changed, written, key_moves: keyMoves, still_leaking_after: stillLeaking, applied: APPLY });

if (keyMoves) { console.error('ABORTED SEMANTICS: at least one row key would move; nothing further should be written'); process.exit(1); }
if (stillLeaking) { console.error('a regenerated record still contains its own row key'); process.exit(1); }
if (!APPLY) console.log('  dry run — nothing was written. Re-run with --apply to write.');
