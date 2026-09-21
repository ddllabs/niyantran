#!/usr/bin/env node
// Push Niyantran's OCR documents through the ingest-documents edge function.
// RAG spec §A. Two inputs:
//   --manifest <file>   the spec's manifest: { documents: [{ source_key, title, file_name, file_url,
//                       desk_tier, desk_feature, ocr_file }] }, ocr_file relative to the manifest
//   --export <dir>      Niyantran's OCR export: manifest.json (rank, filename, markdown, metadata, id)
//                       with one .md and one .metadata.json per document
// Environment: SUPABASE_URL, SUPABASE_SECRET_KEY (sb_secret_…; never in a browser, never committed).
// A .env.local beside package.json is loaded when present. --dry-run writes nothing.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BATCH = 20;

function parseArgs(argv) {
  const out = { dryRun: false, manifest: null, export: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--manifest') out.manifest = argv[++i];
    else if (a === '--export') out.export = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
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
  if (args.help || (!args.manifest && !args.export)) {
    console.log('usage: node scripts/ingest-national-desk.mjs (--manifest <file> | --export <dir>) [--dry-run]');
    process.exit(args.help ? 0 : 2);
  }
  await loadDotEnv(path.resolve('.env.local'));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set (environment or .env.local)');
  if (!key.startsWith('sb_secret_')) throw new Error('SUPABASE_SECRET_KEY must be an sb_secret_… key');

  const docs = args.manifest ? await readSpecManifest(args.manifest) : await readExport(args.export);
  console.log(`${docs.length} document(s) from ${args.manifest ?? args.export}${args.dryRun ? ' (dry run)' : ''}`);

  const endpoint = `${url.replace(/\/$/, '')}/functions/v1/ingest-documents`;
  const totals = { documents: 0, indexed: 0, unchanged: 0, errors: 0, embedded_tokens: 0, cost_usd: 0 };
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    const { results, totals: t } = await post(endpoint, key, { documents: batch, dry_run: args.dryRun });
    for (const r of results) {
      const line = `${r.status.padEnd(9)} ${r.source_key.slice(0, 12)}  chunks=${r.chunks} +${r.inserted} =${r.kept} -${r.deleted}  tokens=${r.embedded_tokens} usd=${r.cost_usd.toFixed(6)}`;
      console.log(r.error ? `${line}  ERROR ${r.error}` : line);
    }
    for (const k of Object.keys(totals)) totals[k] += t[k];
  }
  console.log('totals', totals);
  if (totals.errors) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
