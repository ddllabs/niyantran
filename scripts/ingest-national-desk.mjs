// #!/usr/bin/env node
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
//   --pdf-text <dir> --doc-type <type>
//                       the same snapshot's 01_original_corpus/documents.jsonl.gz, streamed: records with
//                       extraction pdf_text and the given doc_type, keyed through the same link map, carrying
//                       the corpus fields the OCR sidecars lack. --from-year/--to-year (bill year, from the
//                       link map) and --keyed-only narrow it. Plan: docs/plans/2026-09-29-corpus-ingestion.md
// Options: --dry-run (writes nothing), --batch N (documents per request, default 10),
//          --max-chars N (skip and list larger documents, default 2,000,000), --limit N (first N only).
//          --only <source_key> (repeatable; --corpus mode only) selects exact source IDs instead of
//          walking the whole feature, so a reconciled retry does not re-post every unaffected document.
//          It filters OCR_FILES.csv rows after the in_current_corpus and feature filters, still honours
//          --max-chars for the selected document(s), and exits non-zero naming any key that matches no
//          eligible row. Mutually exclusive with --shard and --limit; accepted only with --corpus or --pdf-text.
// Environment: SUPABASE_URL, SUPABASE_SECRET_KEY (sb_secret_…; never in a browser, never committed).
// A .env.local beside package.json is loaded when present.

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import readline from 'node:readline';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Above this size a document travels alone in its request. */
const SOLO_CHARS = 200_000;

export function parseArgs(argv) {
  const out = { dryRun: false, manifest: null, export: null, corpus: null, feature: null, links: 'ingest/national-desk/links.json', batch: 10, maxChars: 2_000_000, limit: 0, only: [],
    pdfText: null, docType: null, fromYear: null, toYear: null, keyedOnly: false };
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
    else if (a === '--only') out.only.push(argv[++i]);
    else if (a === '--pdf-text') out.pdfText = argv[++i];
    else if (a === '--doc-type') out.docType = argv[++i];
    else if (a === '--from-year') out.fromYear = Number(argv[++i]);
    else if (a === '--to-year') out.toYear = Number(argv[++i]);
    else if (a === '--keyed-only') out.keyedOnly = true;
    else if (a === '--shard') {
      // "i/n": take every n-th document starting at i (1-based); run n processes side by side
      const m = /^(\d+)\/(\d+)$/.exec(argv[++i] || '');
      if (!m || Number(m[1]) < 1 || Number(m[1]) > Number(m[2])) throw new Error('--shard expects i/n with 1 <= i <= n');
      out.shard = { index: Number(m[1]) - 1, count: Number(m[2]) };
    }
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  // --shard and --limit subdivide a full pass; --only is an explicit selection, so the combination
  // is meaningless and rejected rather than silently reconciled (e.g. by ignoring the shard).
  if (out.only.length && out.shard) throw new Error('--only cannot be combined with --shard: --shard subdivides a full pass, --only is an explicit selection');
  if (out.only.length && out.limit) throw new Error('--only cannot be combined with --limit: --limit subdivides a full pass, --only is an explicit selection');
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

/** The archive hashes exact UTF-8 and counts Python Unicode code points.
 * Operational request limits still use JS UTF-16 length; no normalization. */
function validateSourceText(ocrText, metadata, required = false) {
  const count = metadata.n_chars;
  if (required || (count !== undefined && count !== null && count !== '')) {
    if ((typeof count !== 'string' && typeof count !== 'number') || !/^[0-9]+$/.test(String(count)) || !Number.isSafeInteger(Number(count))) throw new Error('invalid n_chars');
    let actual = 0;
    for (const _ of ocrText) actual++;
    if (Number(count) !== actual) throw new Error(`n_chars mismatch: declared ${count}, actual ${actual} Unicode code points`);
  }
  const sha = metadata.text_sha256;
  if (required || (sha !== undefined && sha !== null && sha !== '')) {
    if (typeof sha !== 'string' || !/^[a-f0-9]{64}$/i.test(sha)) throw new Error('invalid text_sha256');
    if (createHash('sha256').update(ocrText, 'utf8').digest('hex') !== sha.toLowerCase()) throw new Error('text_sha256 mismatch');
  }
}

async function readOcr(file) {
  // Fatal decoding catches damaged input; ignoreBOM preserves an actual BOM
  // character because the archive checksum includes its UTF-8 bytes.
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await readFile(file));
}

function known(value) { return value !== undefined && value !== null && !(typeof value === 'string' && !value.trim()); }

/**
 * Link-map resolution owns the URL and bill-key fields as a unit. The boolean
 * marker tells the handler to replace/clear this unit, rather than merge a
 * sparse patch. Shared by the OCR (--corpus) and pdf_text paths so the two
 * resolve keys identically. Returns the usable link, or null.
 */
function applyLink(metadata, link) {
  const usable = link && !link.ambiguous ? link : null;
  if (link?.ambiguous || usable) {
    for (const key of ['document_key', 'bill_number', 'bill_year', 'house', 'status', 'file_url_source']) delete metadata[key];
  }
  if (link?.ambiguous) metadata.file_url_ambiguous = true;
  if (usable) {
    metadata.file_url_ambiguous = false;
    metadata.file_url_source = `corpus ${usable.doc_type} record`;
    if (usable.bill_number && usable.bill_year) {
      metadata.document_key = `bill:${usable.bill_year}:${usable.bill_number}`;
      metadata.bill_number = usable.bill_number;
      metadata.bill_year = usable.bill_year;
      if (usable.house) metadata.house = usable.house;
      if (usable.status) metadata.status = usable.status;
    }
  }
  return usable;
}

/** Sidecar supplies provenance; nonblank index fields own the current revision. */
export function fromCorpusRow(row, link, ocrText, sidecar = {}) {
  validateSourceText(ocrText, row, true);
  if (!sidecar || typeof sidecar !== 'object' || Array.isArray(sidecar)) throw new Error('metadata must be an object');
  if (sidecar.id && sidecar.id !== row.id) throw new Error('sidecar id does not match index id');
  const stem = row.title || row.document_name.replace(/\.pdf$/i, '');
  const usable = link && !link.ambiguous ? link : null;
  const indexMetadata = Object.fromEntries(Object.entries(row).filter(([, value]) => known(value)));
  for (const key of ['n_pages', 'n_chars', 'file_bytes', 'representative_metadata_line']) {
    if (known(indexMetadata[key])) indexMetadata[key] = Number(indexMetadata[key]);
  }
  for (const key of ['retrieval_excluded', 'in_current_corpus']) {
    if (indexMetadata[key] === 'True') indexMetadata[key] = true;
    else if (indexMetadata[key] === 'False') indexMetadata[key] = false;
  }
  const conflicts = Object.keys(indexMetadata).filter((key) => known(sidecar[key]) && sidecar[key] !== indexMetadata[key]);
  const metadata = { ...sidecar, ...indexMetadata, title_stem: stem };
  if (conflicts.length) metadata.index_metadata_conflicts = conflicts;
  applyLink(metadata, link);
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

/** `only`, when given, is a Set of source keys (the `id` column). It filters after the
 * in_current_corpus and feature filters below, and throws naming every requested key that
 * matched no eligible row here — a silent no-op selection is exactly the failure this guards
 * against. Rows that do match still go through every existing per-row check (size cap,
 * duplicates, exclusion), so an oversized selected document is still skipped, not dispatched. */
export async function readCorpus(dir, feature, linksFile, maxChars, limit, shard, only) {
  const index = parseCsv(await readFile(path.join(dir, '04_indexes', 'OCR_FILES.csv'), 'utf8'));
  const { links } = JSON.parse(await readFile(linksFile, 'utf8'));
  let rows = index.filter((r) => r.in_current_corpus === 'True' && (r.source_path.split('/')[1] || '') === feature);
  const counts = new Map();
  for (const row of rows) counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
  if (only && only.size) {
    const missing = [...only].filter((key) => !counts.has(key));
    if (missing.length) throw new Error(`--only source key(s) not found among eligible rows for feature "${feature}": ${missing.join(', ')}`);
    rows = rows.filter((r) => only.has(r.id));
  }
  if (shard) rows = rows.filter((_, i) => i % shard.count === shard.index);
  const skipped = [], failed = [], warnings = [], docs = [];
  for (const row of rows) {
    try {
      if (!row.id) throw new Error('source id is required');
      if (counts.get(row.id) > 1) throw new Error('duplicate current source id');
      if (row.retrieval_excluded === 'True') {
        skipped.push({ id: row.id, file: row.document_name, reason: 'retrieval_excluded' });
        continue;
      }
      if (!/^[0-9]+$/.test(row.n_chars) || !Number.isSafeInteger(Number(row.n_chars))) throw new Error('invalid n_chars');
      if (Number(row.n_chars) > maxChars) {
        skipped.push({ id: row.id, file: row.document_name, n_chars: Number(row.n_chars), reason: 'too_large' });
        continue;
      }
      const ocrText = await readOcr(path.join(dir, row.markdown_path));
      const sidecar = JSON.parse(await readFile(path.join(dir, row.metadata_path), 'utf8'));
      const doc = fromCorpusRow(row, links[row.document_name], ocrText, sidecar);
      if (ocrText.length > maxChars) {
        skipped.push({ id: row.id, file: row.document_name, n_chars: Number(row.n_chars), utf16_chars: ocrText.length, reason: 'too_large' });
        continue;
      }
      if (doc.metadata.retrieval_excluded === true || doc.metadata.retrieval_excluded === 'True') {
        skipped.push({ id: row.id, file: row.document_name, reason: 'retrieval_excluded' });
        continue;
      }
      if (doc.metadata.index_metadata_conflicts) warnings.push({ source_key: row.id, fields: doc.metadata.index_metadata_conflicts });
      docs.push(doc);
      if (limit && docs.length >= limit) break;
    } catch (err) {
      failed.push({ source_key: row.id, file: row.document_name, error: err.message });
    }
  }
  return { docs, skipped, failed, warnings, indexed: rows.length };
}

/** Corpus record fields kept in documents.metadata. The last seven are the ones the
 * OCR sidecars never had (docs/plans/2026-09-22-corpus-expansion.md, "What has to be built"). */
const PDF_TEXT_FIELDS = ['extraction', 'doc_type', 'source_path', 'source_host', 'licence_class', 'section', 'feature',
  'n_pages', 'n_chars', 'as_of', 'file_bytes',
  'dataset_key', 'row_ref', 'integrity', 'licence_basis', 'prid', 'posted_on', 'profile_ref'];

/** One documents.jsonl.gz pdf_text record → the ingest function's document shape. */
export function fromPdfTextRecord(record, link) {
  const text = typeof record?.text === 'string' ? record.text : '';
  if (!record?.id) throw new Error('source id is required');
  if (!text.trim()) throw new Error('record has no text');
  // Every corpus record declares n_chars (Python code points); a text hash is checked only when present.
  if (!known(record.n_chars)) throw new Error('invalid n_chars');
  validateSourceText(text, { n_chars: record.n_chars, text_sha256: record.text_sha256 });
  const fileName = path.posix.basename(String(record.source_path || ''));
  const stem = String(record.title || fileName.replace(/\.pdf$/i, '') || record.id);
  const metadata = Object.fromEntries(PDF_TEXT_FIELDS.filter((key) => known(record[key])).map((key) => [key, record[key]]));
  metadata.title_stem = stem;
  const usable = applyLink(metadata, link);
  return {
    source_key: record.id,
    title: (usable?.title || stem).replace(/\s+/g, ' ').trim(),
    file_name: fileName || null,
    file_url: usable?.url ?? null,
    desk_tier: 'national',
    desk_feature: record.feature || String(record.source_path || '').split('/')[1] || null,
    ocr_text: text,
    metadata,
  };
}

/**
 * Stream documents.jsonl.gz and build the pdf_text documents to ingest. The archive is
 * 747 MB compressed, so it is read line by line and only selected records are kept.
 * Order: pdf_text + doc_type → --only → key and bill-year range → --shard → validation
 * and --max-chars → --limit. A bill year comes from the link map (its bill_record), so a
 * year range implies a keyed document.
 */
export async function readPdfText(dir, opts) {
  const { docType, links: linksFile, fromYear = null, toYear = null, keyedOnly = false, maxChars = 2_000_000, limit = 0, shard = null, only = null } = opts;
  const { links } = JSON.parse(await readFile(linksFile, 'utf8'));
  const file = path.join(dir, '01_original_corpus', 'documents.jsonl.gz');
  const rl = readline.createInterface({ input: createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  const eligible = [];
  const seen = new Map();
  let malformed = 0;
  for await (const line of rl) {
    if (!line.includes('"pdf_text"')) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      malformed += 1;
      continue;
    }
    if (record.extraction !== 'pdf_text' || record.doc_type !== docType) continue;
    seen.set(record.id, (seen.get(record.id) ?? 0) + 1);
    eligible.push(record);
  }
  if (only && only.size) {
    const missing = [...only].filter((key) => !seen.has(key));
    if (missing.length) throw new Error(`--only source key(s) not found among pdf_text "${docType}" records: ${missing.join(', ')}`);
  }
  const ranged = fromYear !== null || toYear !== null;
  let rows = eligible.filter((r) => {
    if (only && only.size && !only.has(r.id)) return false;
    const link = links[path.posix.basename(String(r.source_path || ''))];
    const year = link && !link.ambiguous && link.bill_number && link.bill_year ? Number(link.bill_year) : null;
    if ((keyedOnly || ranged) && year === null) return false;
    if (fromYear !== null && year < fromYear) return false;
    if (toYear !== null && year > toYear) return false;
    return true;
  });
  if (shard) rows = rows.filter((_, i) => i % shard.count === shard.index);
  const docs = [], skipped = [], failed = [];
  for (const record of rows) {
    const fileName = path.posix.basename(String(record.source_path || ''));
    try {
      if (seen.get(record.id) > 1) throw new Error('duplicate source id');
      const text = typeof record.text === 'string' ? record.text : '';
      if (text.length > maxChars) {
        skipped.push({ id: record.id, file: fileName, utf16_chars: text.length, reason: 'too_large' });
        continue;
      }
      docs.push(fromPdfTextRecord(record, links[fileName]));
      if (limit && docs.length >= limit) break;
    } catch (err) {
      failed.push({ source_key: record.id, file: fileName, error: err.message });
    }
  }
  return { docs, skipped, failed, malformed, eligible: eligible.length, selected: rows.length };
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
      ocr_text: await readOcr(path.join(dir, d.ocr_file)),
      metadata: d.metadata ?? {},
    });
  }
  for (const doc of docs) validateSourceText(doc.ocr_text, doc.metadata);
  return docs;
}

/** Niyantran's export → the function's document shape. Provenance fields ride along in metadata. */
export function fromExportRecord(entry, metadata, ocrText) {
  validateSourceText(ocrText, metadata);
  return {
    source_key: entry.id ?? metadata.id,
    title: metadata.title ?? entry.filename.replace(/\.pdf$/i, ''),
    file_name: entry.filename,
    file_url: null, // not supplied by the export; the reader omits the link until Niyantran provides URLs
    desk_tier: 'national',
    desk_feature: metadata.feature ?? null,
    ocr_text: ocrText,
    metadata: { ...metadata, export_rank: entry.rank },
  };
}

async function readExport(dir) {
  const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
  const docs = [];
  for (const entry of manifest.files ?? []) {
    const metadata = JSON.parse(await readFile(path.join(dir, entry.metadata), 'utf8'));
    const ocrText = await readOcr(path.join(dir, entry.markdown));
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
  const mode = args.manifest ? 'manifest' : args.export ? 'export' : args.corpus ? 'corpus' : args.pdfText ? 'pdf-text' : null;
  if (args.help || !mode || (mode === 'corpus' && !args.feature) || (mode === 'pdf-text' && !args.docType)) {
    console.log('usage: node scripts/ingest-national-desk.mjs (--manifest <file> | --export <dir> | --corpus <dir> --feature "<feature>" | --pdf-text <dir> --doc-type <type> [--from-year Y] [--to-year Y] [--keyed-only]) [--dry-run] [--batch N] [--max-chars N] [--limit N] [--only <source_key> ...] [--shard i/n]');
    process.exit(args.help ? 0 : 2);
  }
  // --only is a bounded retry of exact source IDs; it only has meaning against the corpus snapshot.
  if (args.only.length && mode !== 'corpus' && mode !== 'pdf-text') throw new Error('--only is only supported with --corpus or --pdf-text mode');
  await loadDotEnv(path.resolve('.env.local'));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set (environment or .env.local)');
  if (!key.startsWith('sb_secret_')) throw new Error('SUPABASE_SECRET_KEY must be an sb_secret_… key');

  let docs;
  let skipped = [];
  let sourceFailures = [];
  if (mode === 'manifest') docs = await readSpecManifest(args.manifest);
  else if (mode === 'export') docs = await readExport(args.export);
  else if (mode === 'pdf-text') {
    const only = args.only.length ? new Set(args.only) : null;
    const r = await readPdfText(args.pdfText, {
      docType: args.docType, links: args.links, fromYear: args.fromYear, toYear: args.toYear, keyedOnly: args.keyedOnly,
      maxChars: args.maxChars, limit: args.limit, shard: args.shard, only,
    });
    docs = r.docs;
    skipped = r.skipped;
    sourceFailures = r.failed;
    const shardNote = args.shard ? ` (shard ${args.shard.index + 1}/${args.shard.count})` : '';
    console.log(`${r.eligible} pdf_text "${args.docType}" record(s); ${r.selected} selected${shardNote}; ${skipped.length} explicitly skipped; ${sourceFailures.length} source validation failures; ${r.malformed} malformed pdf_text line(s)`);
  } else {
    const only = args.only.length ? new Set(args.only) : null;
    const r = await readCorpus(args.corpus, args.feature, args.links, args.maxChars, args.limit, args.shard, only);
    docs = r.docs;
    skipped = r.skipped;
    sourceFailures = r.failed;
    if (r.warnings.length) console.log('source metadata conflicts (index values retained):', r.warnings);
    const shardNote = args.shard ? ` (shard ${args.shard.index + 1}/${args.shard.count})` : '';
    console.log(`${r.indexed} document(s) in the index for "${args.feature}"${shardNote}; ${skipped.length} explicitly skipped; ${sourceFailures.length} source validation failures`);
  }
  const source = args.manifest ?? args.export ?? args.corpus ?? args.pdfText;
  console.log(`${docs.length} document(s) from ${source}${args.dryRun ? ' (dry run)' : ''}`);
  const linked = docs.filter((d) => d.file_url).length;
  const keyed = docs.filter((d) => d.metadata?.document_key).length;
  if (mode === 'corpus' || mode === 'pdf-text') console.log(`with file_url ${linked}, with document_key ${keyed}`);

  const endpoint = `${url.replace(/\/$/, '')}/functions/v1/ingest-documents`;
  const totals = { documents: sourceFailures.length, indexed: 0, unchanged: 0, errors: sourceFailures.length, embedded_tokens: 0, cost_usd: 0 };
  const failed = [...sourceFailures];
  const requests = planRequests(docs, mode === 'corpus' || mode === 'pdf-text' ? args.batch : 20);
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
    if ((mode === 'corpus' || mode === 'pdf-text') && (i + 1) % 10 === 0) console.log(`… ${i + 1}/${requests.length} requests, ${totals.documents} documents, usd ${totals.cost_usd.toFixed(4)}`);
  }
  console.log('totals', totals);
  if (skipped.length) console.log('skipped (with reasons):', skipped);
  if (failed.length) console.log('failed:', failed);
  if (totals.errors) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
