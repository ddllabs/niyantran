/**
 * Collect the WTO dispute settlement register (F129; docs/specs/2026-10-13-wto-register.md).
 * Fetches the two data files the WTO's case pages load, once each, parses them as text (never
 * executing them) and writes public/data/embedded_csv/judiciary_wto_disputes.json.
 *
 *   node scripts/collect-wto-disputes.mjs
 *
 * Run by hand; it needs network access to www.wto.org.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseWtoRegister } from '../src/lib/wtoRegister.js';

const BASE = 'https://www.wto.org/library/disputes/';
const HEADERS = { 'User-Agent': 'Niyantran Terminal register collector (one-off; credits World Trade Organization)' };
const OUT = resolve(import.meta.dirname, '../public/data/embedded_csv/judiciary_wto_disputes.json');

async function text(name) {
  const res = await fetch(BASE + name, { headers: HEADERS });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return new TextDecoder('windows-1252').decode(await res.arrayBuffer());
}

const [cases, arrays] = [await text('dispute_case_arrays_e.js'), await text('dispute_arrays_e.js')];
const rows = parseWtoRegister(cases, arrays, { asOf: new Date().toISOString() });
if (rows.length < 600) throw new Error(`only ${rows.length} disputes parsed; the source format may have changed`);
writeFileSync(OUT, `${JSON.stringify(rows, null, 1)}\n`);
const blank = (k) => rows.filter((r) => (Array.isArray(r[k]) ? !r[k].length : !r[k])).length;
console.log(`${rows.length} disputes (DS${rows[0].ds}–DS${rows.at(-1).ds}) → ${OUT}`);
console.log(`blank: title ${blank('title')}, respondent ${blank('respondent')}, status ${blank('status')}, status "Not stated" ${rows.filter((r) => r.status === 'Not stated').length}, agreements ${blank('agreements')}`);
