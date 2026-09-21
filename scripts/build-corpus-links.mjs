#!/usr/bin/env node
// Build the file-name → source-URL map from the National corpus's own dataset
// records (Digital Sansad bill records carry `billIntroducedFile:` links, and
// other records carry PDF/DOC links in their text). Output is read by
// scripts/ingest-national-desk.mjs --corpus. Plan:
// docs/plans/2026-09-21-corpus-ingest-first-pass.md Task 1.
//
//   node scripts/build-corpus-links.mjs --corpus <dir> [--out ingest/national-desk/links.json]

import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const URL_RE = /https?:\/\/[^\s"')\]]+/g;
const FILE_EXT = /\.(pdf|docx?)$/i;

function parseArgs(argv) {
  const out = { corpus: null, out: 'ingest/national-desk/links.json' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--corpus') out.corpus = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  if (!out.corpus) throw new Error('usage: build-corpus-links.mjs --corpus <dir> [--out <file>]');
  return out;
}

/** The base file name of a URL, query stripped, %20 decoded — the key the OCR index uses. */
export function baseName(url) {
  const clean = url.split('?')[0].split('#')[0];
  const raw = clean.slice(clean.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw; // a malformed escape stays as written; it will simply not match an index name
  }
}

function field(text, name) {
  const m = new RegExp(`^${name}:[^\\S\\r\\n]*([^\\r\\n]+)$`, 'm').exec(text);
  return m ? m[1].trim() || undefined : undefined;
}

function billIdentity(text) {
  const billNumber = field(text, 'billNumber');
  const billYear = field(text, 'billYear');
  // The corpus contains non-canonical Roman forms such as `XXXX` and `XXX II`.
  const validNumber = /^(?:\d+|[IVXLCDM]+(?:[^\S\r\n]+[IVXLCDM]+)*)$/i.test(billNumber || '');
  if (!validNumber || !/^\d{4}$/.test(billYear || '')) return null;
  return { bill_number: billNumber, bill_year: billYear };
}

/** Fold one record's links into the map; a bill_record wins over any other record for the same name. */
export function foldRecord(links, record) {
  const text = record.text || '';
  const urls = text.match(URL_RE) || [];
  for (const raw of urls) {
    const url = raw.replace(/[.,;:]+$/, '');
    const name = baseName(url);
    if (!FILE_EXT.test(name)) continue;
    const prev = links[name];
    if (prev && prev.url && prev.url !== url) {
      links[name] = { ambiguous: true, urls: [...new Set([prev.url, url, ...(prev.urls || [])])] };
      continue;
    }
    if (prev?.ambiguous) continue;
    const isBill = record.doc_type === 'bill_record';
    if (prev && !isBill) continue;
    const entry = { url, doc_type: record.doc_type, title: String(record.title || '').trim() || undefined };
    if (isBill) {
      const identity = billIdentity(text);
      if (identity) Object.assign(entry, identity);
      entry.house = field(text, 'billIntroducedInHouse');
      entry.status = field(text, 'status');
      entry.title = field(text, 'billName') || entry.title;
    }
    links[name] = entry;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = path.join(args.corpus, '01_original_corpus', 'documents.jsonl.gz');
  const links = {};
  let scanned = 0;
  let withHttp = 0;
  const started = Date.now();
  const rl = readline.createInterface({ input: createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) {
    scanned += 1;
    if (!line.includes('http')) continue;
    withHttp += 1;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record.extraction !== 'dataset') continue;
    foldRecord(links, record);
    if (scanned % 250000 === 0) console.error(`… ${scanned.toLocaleString()} records, ${Object.keys(links).length.toLocaleString()} names`);
  }
  const names = Object.keys(links);
  const ambiguous = names.filter((n) => links[n].ambiguous).length;
  const bills = names.filter((n) => links[n].doc_type === 'bill_record').length;
  await mkdir(path.dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify({ built_at: new Date().toISOString(), corpus: file, records_scanned: scanned, links }, null, 0));
  console.log(`scanned ${scanned.toLocaleString()} records (${withHttp.toLocaleString()} with links) in ${Math.round((Date.now() - started) / 1000)} s`);
  console.log(`names ${names.length.toLocaleString()}, from bill records ${bills.toLocaleString()}, ambiguous ${ambiguous}`);
  console.log(`wrote ${args.out}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
