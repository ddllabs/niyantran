#!/usr/bin/env node
// Push Niyantran's OCR documents through the ingest-documents edge function.
// RAG spec §A. Two inputs:
//   --manifest <file>   the spec's manifest: { documents: [{ source_key, title, file_name, file_url,
//                       desk_tier, desk_feature, ocr_file }] }, ocr_file relative to the manifest
//   --export <dir>      Niyantran's OCR export: manifest.json (rank, filename, markdown, metadata, id)
//                       with one .md and one .metadata.json per document
//   --corpus <dir> --feature "<feature>"
//                       the complete processed snapshot: 04_indexes/OCR_FILES.csv filtered to one
//                       feature and in_current_corpus, each markdown_path as ocr_text, joined to the
//                       link map from scripts/build-corpus-links.mjs (--links, default
//                       ingest/national-desk/links.json). Plan: docs/plans/2026-09-21-corpus-ingest-first-pass.md
// Options: --dry-run (writes nothing), --batch N (documents per request, default 10),
//          --max-chars N (skip and list larger documents, default 2,000,000), --limit N (first N only).
// Environment: SUPABASE_URL, SUPABASE_SECRET_KEY (sb_secret_…; never in a browser, never committed).
// A .env.local beside package.json is loaded when present.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Above this size a document travels alone in its request. */
const SOLO_CHARS = 200_000;

function parseArgs(argv) {
  const out = { dryRun: false, manifest: null, export: null, corpus: null, feature: null, links: 'ingest/national-desk/links.json', batch: 10, maxChars: 2_000_000, limit: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--manifest') out.manifest = argv[++i];
    else if (a === '--export') out.export = argv[++i];
    else if (a === '--corpus') out.corpus = argv[++i];
    else if (a === '--feature') out.feature = argv[++i];
    else if (a === '--links') out.links = argv[++i];
    else if (a === '--batch') out.batch = Math.max(1, Number(argv[++i]) || 10);
    else if (a === '--max-chars') out.maxChars = Math.max(1, Number(argv[++i]) || 2_000_000);
    else if (a === '--limit') out.limit = Math.max(0, Number(argv[++i]) || 0);
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

/** Minimal CSV reader: quoted fields, embedded commas and newlines, BOM stripped. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') (row.push(cell), (cell = ''));
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell.length || row.length) (row.push(cell), rows.push(row));
  const [header, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

/** One OCR index row + its link → the function's document shape. */
export function fromCorpusRow(row, link, ocrText) {
  const stem = row.title || row.document_name.replace(/\.pdf$/i, '');
  const usable = link && !link.ambiguous ? link : null;
  const metadata = {
    source_path: row.source_path,
    doc_type: row.doc_type,
    ocr_lang: row.ocr_lang,
    n_pages: row.n_pages ? Number(row.n_pages) : null,
    n_chars: row.n_chars ? Number(row.n_chars) : null,
    integrity: row.integrity || null,
    text_sha256: row.text_sha256,
    title_stem: stem,
  };
  if (usable) {
    metadata.file_url_source = `corpus ${usable.doc_type} record`;
    if (usable.bill_number && usable.bill_year) {
      metadata.document_key = `bill:${usable.bill_year}:${usable.bill_number}`;
      metadata.bill_number = usable.bill_number;
      metadata.bill_year = usable.bill_year;
      if (usable.house) metadata.house = usable.house;
      if (usable.status) metadata.status = usable.status;
    }
  }
  return {
    source_key: row.id,
    title: (usable?.title || stem).replace(/\s+/g, ' ').trim(),
    file_name: row.document_name,
    file_url: usable?.url ?? null,
    desk_tier: 'national',
    desk_feature: row.source_path.split('/')[1] || null,
    ocr_text: ocrText,
    metadata,
  };
}

async function readCorpus(dir, feature, linksFile, maxChars, limit) {
  const index = parseCsv(await readFile(path.join(dir, '04_indexes', 'OCR_FILES.csv'), 'utf8'));
  const { links } = JSON.parse(await readFile(linksFile, 'utf8'));
  const rows = index.filter((r) => r.in_current_corpus === 'True' && (r.source_path.split('/')[1] || '') === feature);
  const skipped = [];
  const docs = [];
  for (const row of rows) {
    if (Number(row.n_chars || 0) > maxChars) {
      skipped.push({ id: row.id, file: row.document_name, n_chars: Number(row.n_chars) });
      continue;
    }
    const ocrText = await readFile(path.join(dir, row.markdown_path), 'utf8');
    docs.push(fromCorpusRow(row, links[row.document_name], ocrText));
    if (limit && docs.length >= limit) break;
  }
  return { docs, skipped, indexed: rows.length };
}

/** Group documents into requests: `batch` per request, but a large document travels alone. */
export function planRequests(docs, batch) {
  const out = [];
  let cur = [];
  for (const d of docs) {
    if (d.ocr_text.length > SOLO_CHARS) {
      if (cur.length) (out.push(cur), (cur = []));
      out.push([d]);
      continue;
    }
    cur.push(d);
    if (cur.length >= batch) (out.push(cur), (cur = []));
  }
  if (cur.length) out.push(cur);
  return out;
}

async function loadDotEnv(file) {
  if (!existsSync(file)) return;
  const text = await readFile(file, 'utf8');
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
}

async function readSpecManifest(file) {
  const dir = path.dirname(file);
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  const docs = [];
  for (const d of manifest.documents ?? []) {
    docs.push({
      source_key: d.source_key,
      title: d.title,
      file_name: d.file_name ?? null,
      file_url: d.file_url ?? null,
      desk_tier: d.desk_tier ?? null,
      desk_feature: d.desk_feature ?? null,
      ocr_text: await readFile(path.join(dir, d.ocr_file), 'utf8'),
      metadata: d.metadata ?? {},
    });
  }
  return docs;
}

/** Niyantran's export → the function's document shape. Provenance fields ride along in metadata. */
export function fromExportRecord(entry, metadata, ocrText) {
  const { id, source_path, doc_type, source_host, licence_class, section, ocr_lang, ocr_quality, n_pages, n_chars, extraction, as_of, file_bytes, file_mtime } = metadata;
  return {
    source_key: entry.id ?? id,
    title: metadata.title ?? entry.filename.replace(/\.pdf$/i, ''),
    file_name: entry.filename,
    file_url: null, // not supplied by the export; the reader omits the link until Niyantran provides URLs
    desk_tier: 'national',
    desk_feature: metadata.feature ?? null,
    ocr_text: ocrText,
    metadata: { source_path, doc_type, source_host, licence_class, section, ocr_lang, ocr_quality, n_pages, n_chars, extraction, as_of, file_bytes, file_mtime, export_rank: entry.rank },
  };
}

async function readExport(dir) {
  const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
  const docs = [];
  for (const entry of manifest.files ?? []) {
    const metadata = JSON.parse(await readFile(path.join(dir, entry.metadata), 'utf8'));
    const ocrText = await readFile(path.join(dir, entry.markdown), 'utf8');
    docs.push(fromExportRecord(entry, metadata, ocrText));
  }
  return docs;
}

async function post(url, key, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${json.error ?? text.slice(0, 200)}`);
  return json;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.manifest ? 'manifest' : args.export ? 'export' : args.corpus ? 'corpus' : null;
  if (args.help || !mode || (mode === 'corpus' && !args.feature)) {
    console.log('usage: node scripts/ingest-national-desk.mjs (--manifest <file> | --export <dir> | --corpus <dir> --feature "<feature>") [--dry-run] [--batch N] [--max-chars N] [--limit N]');
    process.exit(args.help ? 0 : 2);
  }
  await loadDotEnv(path.resolve('.env.local'));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set (environment or .env.local)');
  if (!key.startsWith('sb_secret_')) throw new Error('SUPABASE_SECRET_KEY must be an sb_secret_… key');

  let docs;
  let skipped = [];
  if (mode === 'manifest') docs = await readSpecManifest(args.manifest);
  else if (mode === 'export') docs = await readExport(args.export);
  else {
    const r = await readCorpus(args.corpus, args.feature, args.links, args.maxChars, args.limit);
    docs = r.docs;
    skipped = r.skipped;
    console.log(`${r.indexed} document(s) in the index for "${args.feature}"; ${skipped.length} skipped above ${args.maxChars.toLocaleString()} chars`);
  }
  const source = args.manifest ?? args.export ?? args.corpus;
  console.log(`${docs.length} document(s) from ${source}${args.dryRun ? ' (dry run)' : ''}`);
  const linked = docs.filter((d) => d.file_url).length;
  const keyed = docs.filter((d) => d.metadata?.document_key).length;
  if (mode === 'corpus') console.log(`with file_url ${linked}, with document_key ${keyed}`);

  const endpoint = `${url.replace(/\/$/, '')}/functions/v1/ingest-documents`;
  const totals = { documents: 0, indexed: 0, unchanged: 0, errors: 0, embedded_tokens: 0, cost_usd: 0 };
  const failed = [];
  const requests = planRequests(docs, mode === 'corpus' ? args.batch : 20);
  for (let i = 0; i < requests.length; i++) {
    const batch = requests[i];
    let results;
    let t;
    try {
      ({ results, totals: t } = await post(endpoint, key, { documents: batch, dry_run: args.dryRun }));
    } catch (err) {
      for (const d of batch) failed.push({ source_key: d.source_key, file: d.file_name, error: err.message });
      console.log(`request ${i + 1}/${requests.length} FAILED for ${batch.length} document(s): ${err.message}`);
      totals.documents += batch.length;
      totals.errors += batch.length;
      continue;
    }
    for (const r of results) {
      const line = `${r.status.padEnd(9)} ${r.source_key.slice(0, 12)}  chunks=${r.chunks} +${r.inserted} =${r.kept} -${r.deleted}  tokens=${r.embedded_tokens} usd=${r.cost_usd.toFixed(6)}`;
      console.log(r.error ? `${line}  ERROR ${r.error}` : line);
      if (r.error) failed.push({ source_key: r.source_key, error: r.error });
    }
    for (const k of Object.keys(totals)) totals[k] += t[k];
    if (mode === 'corpus' && (i + 1) % 10 === 0) console.log(`… ${i + 1}/${requests.length} requests, ${totals.documents} documents, usd ${totals.cost_usd.toFixed(4)}`);
  }
  console.log('totals', totals);
  if (skipped.length) console.log('skipped (too large):', skipped);
  if (failed.length) console.log('failed:', failed);
  if (totals.errors) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
