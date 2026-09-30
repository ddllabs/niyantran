/**
 * Register one PDF with the page-aware pipeline (docs/specs/2026-10-01-rag-v2-ingestion-v2.md,
 * "Registration script"; plan task I5).
 *
 *   node scripts/ingest-register.mjs --target local|nter --file <pdf> --source-key <key> --title <title> \
 *     [--desk-tier <tier>] [--desk-feature <feature>] [--file-url <url>] [--metadata '<json>'] [--dry-run]
 *
 * It counts the pages with pdfjs-dist, hashes the file, refuses anything over Mistral's per-file limits
 * (splitting belongs to R7 and R8), uploads to corpus/files/<sha256>.pdf (resumable above 6 MB; an
 * object already there counts as uploaded, since the key is the content hash), then calls
 * ingest_register. --dry-run stops after hashing and counting, with no network call.
 *
 * --target is required, so NTER is never reached by default:
 *   local  SUPABASE_URL / SUPABASE_SECRET_KEY from the environment (e.g. `supabase status -o env`);
 *          the URL must be a localhost address.
 *   nter   the same variables from .env.local (SUPABASE_URL or VITE_SUPABASE_URL); the URL must NOT be
 *          localhost. A registration on NTER needs the owner's go-ahead (spec, "Ask first").
 * Node fetch needs to run outside the Claude Code sandbox.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const BUCKET = 'corpus';
/** Decimal, the stricter reading of Mistral's 50 MB (spec decision 2). */
const MAX_BYTES = 50_000_000;
const MAX_PAGES = 1000;
/** Supabase's resumable uploads take 6 MiB chunks; the standard upload is used below this size. */
const TUS_CHUNK = 6 * 1024 * 1024;

function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const v = m[2].replace(/^(["'])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

function parseArgs(argv) {
  const out = { target: null, file: null, sourceKey: null, title: null, deskTier: null, deskFeature: null, fileUrl: null, metadata: {}, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--file') out.file = argv[++i];
    else if (a === '--source-key') out.sourceKey = argv[++i];
    else if (a === '--title') out.title = argv[++i];
    else if (a === '--desk-tier') out.deskTier = argv[++i];
    else if (a === '--desk-feature') out.deskFeature = argv[++i];
    else if (a === '--file-url') out.fileUrl = argv[++i];
    else if (a === '--metadata') out.metadata = JSON.parse(argv[++i]);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a !== '--') throw new Error(`unknown argument ${a}`);
  }
  if (!['local', 'nter'].includes(out.target)) throw new Error('--target local|nter is required');
  for (const [k, v] of [['--file', out.file], ['--source-key', out.sourceKey], ['--title', out.title]]) {
    if (!v) throw new Error(`${k} is required`);
  }
  return out;
}

const isLocalhost = (url) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) || new URL(url).hostname.endsWith('.localhost');

function connection(target) {
  if (target === 'nter') loadDotEnv(resolve(ROOT, '.env.local'));
  const url = process.env.SUPABASE_URL || (target === 'nter' ? process.env.VITE_SUPABASE_URL : undefined);
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required');
  if (target === 'local' && !isLocalhost(url)) throw new Error(`--target local but SUPABASE_URL is ${new URL(url).host}`);
  if (target === 'nter' && isLocalhost(url)) throw new Error('--target nter but SUPABASE_URL is localhost');
  return { url: url.replace(/\/$/, ''), key };
}

async function countPages(bytes) {
  const doc = await getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false }).promise;
  try {
    return doc.numPages;
  } finally {
    await doc.destroy();
  }
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

/** Supabase's TUS endpoint: create, then PATCH 6 MiB chunks. Returns 'uploaded' or 'exists'. */
async function uploadResumable({ url, key }, path, bytes) {
  const headers = { apikey: key, authorization: `Bearer ${key}`, 'tus-resumable': '1.0.0' };
  const created = await fetch(`${url}/storage/v1/upload/resumable`, {
    method: 'POST',
    headers: {
      ...headers,
      'upload-length': String(bytes.length),
      'upload-metadata': `bucketName ${b64(BUCKET)},objectName ${b64(path)},contentType ${b64('application/pdf')},cacheControl ${b64('3600')}`,
      'x-upsert': 'false',
    },
  });
  if (created.status === 409) return 'exists';
  if (created.status !== 201) throw new Error(`resumable create: HTTP ${created.status} ${(await created.text()).slice(0, 200)}`);
  const location = created.headers.get('location');
  if (!location) throw new Error('resumable create: no Location header');
  for (let offset = 0; offset < bytes.length; offset += TUS_CHUNK) {
    const chunk = bytes.subarray(offset, Math.min(offset + TUS_CHUNK, bytes.length));
    const res = await fetch(location, {
      method: 'PATCH',
      headers: { ...headers, 'upload-offset': String(offset), 'content-type': 'application/offset+octet-stream' },
      body: chunk,
    });
    if (res.status !== 204) throw new Error(`resumable patch at ${offset}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return 'uploaded';
}

async function upload(conn, client, path, bytes) {
  if (bytes.length > TUS_CHUNK) return uploadResumable(conn, path, bytes);
  const { error } = await client.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false });
  if (!error) return 'uploaded';
  if (String(error.statusCode) === '409' || /exists|duplicate/i.test(error.message)) return 'exists';
  throw new Error(`upload: ${error.message}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bytes = readFileSync(resolve(args.file));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const pageCount = await countPages(bytes);
  const path = `files/${sha256}.pdf`;
  console.log(JSON.stringify({ file: args.file, bytes: bytes.length, pages: pageCount, sha256, path }));

  if (bytes.length > MAX_BYTES || pageCount > MAX_PAGES) {
    throw new Error(`over the per-file limits (${MAX_BYTES} bytes, ${MAX_PAGES} pages); splitting belongs to R7/R8`);
  }
  if (pageCount < 1) throw new Error('no pages');
  if (args.dryRun) return;

  const conn = connection(args.target);
  console.log(`target: ${new URL(conn.url).host}`);
  const client = createClient(conn.url, conn.key, { auth: { persistSession: false, autoRefreshToken: false } });

  console.log(`upload: ${await upload(conn, client, path, bytes)}`);

  const { data, error } = await client.rpc('ingest_register', {
    p: {
      source_key: args.sourceKey,
      title: args.title,
      desk_tier: args.deskTier,
      desk_feature: args.deskFeature,
      file_url: args.fileUrl,
      metadata: args.metadata,
      file_sha256: sha256,
      page_count: pageCount,
      files: [{ part_index: 0, page_offset: 0, page_count: pageCount, sha256, byte_size: bytes.length, storage_path: path }],
    },
  });
  if (error) throw new Error(`ingest_register: ${error.message}`);
  console.log(JSON.stringify(data));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
