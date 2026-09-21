/**
 * Verify the citation reader against the live corpus, read-only.
 *
 *   npx vite-node --config vitest.config.js scripts/verify-source-reader.mjs
 *
 * Not a test, and deliberately not wired to `npm test`: AGENTS.md requires a
 * disposable local database for tests, and this reads the live project. It
 * writes nothing, calls no model and costs nothing.
 *
 * What it answers. When a reader clicks a document citation, SourceReader has to
 * find the cited passage in the stored text and prove it is the same passage -
 * `resolveSpan` hashes the slice and compares it to the citation's text_hash. A
 * unit test can only show that against a fixture. This shows it against a real
 * chunk of a real document, which is the only way to know that ingest, chunk
 * offsets, normalisation and the reader agree on the live corpus.
 *
 * Runs under vite-node because SourceReader.jsx contains JSX.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { loadSource } from '../src/ai/SourceReader.jsx';
import { normalise, sha256Hex } from '../src/lib/textNormalise.js';

for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(l.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('SUPABASE_SECRET_KEY and a project URL must be set (environment or .env.local)');

const client = createClient(url, key, { auth: { persistSession: false } });
const title = process.argv.slice(2).join(' ') || 'Finance Bill, 2014';

const { data: doc, error: docError } = await client
  .from('documents').select('id, title').ilike('title', `%${title}%`).not('indexed_at', 'is', null).limit(1).single();
if (docError || !doc) throw new Error(`no indexed document matching ${JSON.stringify(title)}`);

const { data: chunks, error: chunkError } = await client
  .from('document_chunks')
  .select('id, document_id, chunk_index, char_from, char_to, content, source_kind, page_number')
  .eq('document_id', doc.id).order('chunk_index', { ascending: true }).limit(3);
if (chunkError || !chunks?.length) throw new Error('no chunks for that document');

let failures = 0;
for (const chunk of chunks) {
  const citation = {
    id: 1,
    kind: 'text',
    chunk_id: chunk.id,
    document_id: chunk.document_id,
    char_from: chunk.char_from,
    char_to: chunk.char_to,
    text_hash: await sha256Hex(normalise(chunk.content)),
    source_kind: chunk.source_kind,
    page_number: chunk.page_number,
  };
  const { doc: loaded, span, error } = await loadSource(citation, client);
  const slice = loaded?.ocr_text?.slice(span?.from ?? 0, span?.to ?? 0) ?? '';
  const ok = !error && span?.status === 'exact' && slice === chunk.content;
  if (!ok) failures++;
  console.log(
    `  chunk ${String(chunk.chunk_index).padStart(3)}  ${chunk.char_from}-${chunk.char_to}` +
      `  -> ${span?.from}-${span?.to}  ${span?.status}  slice==content:${slice === chunk.content}` +
      `${error ? `  ERROR ${error}` : ''}`,
  );
}

// Non-vacuity: a citation whose hash no longer matches must not be called exact.
const first = chunks[0];
const drifted = {
  id: 1, kind: 'text', chunk_id: first.id, document_id: first.document_id,
  char_from: first.char_from, char_to: first.char_to,
  text_hash: 'f'.repeat(64), source_kind: first.source_kind,
};
const d = await loadSource(drifted, client);
const driftOk = d.span?.status !== 'exact';
if (!driftOk) failures++;
console.log(`  drifted text_hash -> ${d.span?.status}  (must not be "exact")`);

console.log(`\n  ${doc.title}: ${chunks.length} chunks checked, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
