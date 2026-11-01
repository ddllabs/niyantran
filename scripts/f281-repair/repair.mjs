// #!/usr/bin/env node
// F281 repair tool: the broken corpus documents of docs/research/2026-11-01-f281-broken-documents.md and
// docs/research/2026-11-01-f281-triage.md (about 100 documents, see manifest.json).
// Run from the repository root:  node scripts/f281-repair/repair.mjs <step> [options]
//
// Actions in the manifest:
//   decode          the two Bills whose PDF text layer is glyph IDs (official PDF, per-font +29 decode)
//   reextract       a text-bearing official PDF whose stored text is garbage (plain re-extraction, no OCR)
//   strip_cover     a Bill whose stored text opens with another bill's cover page (stored text, marker)
//   ocr             a scanned official PDF (Regulatory: always the official PDF, never the pack text, which is
//                   truncated; Bills with a file_url and garbage OCR): Mistral OCR
//   rekey           the text is another bill's: new title and document_key, text unchanged
//   retitle_unlink  the text is a different act with no usable key: new title, the desk link removed
//                   (file_url_ambiguous = true makes ingest-documents delete document_key, bill_number,
//                   bill_year, house, status and file_url_source; see src/lib/documentRepair.js)
//
// Nothing runs by default and every step that touches a network says so below. The steps are separate
// and are run in this order, by the supervisor, each one read before the next:
//
//   1. prepare    NETWORK, READ-ONLY. GETs the documents from NTER (PostgREST, service key, no write method
//                 exists in the reader), for each re-key the desk records (desk_rows by document_key) that hold
//                 the new key, and the official PDF of each decode, reextract and ocr document with its SHA-256
//                 checked against the manifest. Writes the work directory. --rows-only / --pdfs-only run one half.
//      pin        OFFLINE. Lists the PDFs whose manifest source_sha256 is null (never fetched before prepare)
//                 with their hash and page count; --apply writes those hashes into the manifest. Trust on first
//                 use: look at the file (and at build's title guard) before relying on it. The manifest changes,
//                 so its SHA-256 (what write --confirm names) changes too.
//   2. ocr        NETWORK, PAID (Mistral OCR, mistral-ocr-4-1, USD 4 per 1,000 pages). Without --go it prints the
//                 plan (pages, cached pages, cost for the whole batch) and spends nothing. With --go it calls
//                 Mistral, refuses to pass --max-usd (default 5) and caches every response, so a rerun does not
//                 pay twice. Refuses a PDF that is not pinned.
//   3. build      OFFLINE. Produces each new text and ingest-documents payload, runs the guards and checks, and
//                 writes build/<prefix>.review.json, build/review.json and build/review.md (every document, the
//                 riskiest first: read it, and the text of every OCR document by eye, before going on). The
//                 console shows one line per document, never a text.
//   4. dry-run    NETWORK, NO WRITE. Posts each payload, one per request, to ingest-documents with dry_run:true and
//                 records status and the inserted/kept/deleted chunk counts. Resumable: a document already
//                 dry-run with the same payload is skipped (--redo repeats it).
//   5. write      NETWORK, WRITES NTER. Refuses unless --confirm <SHA-256 of the manifest> matches the manifest
//                 and the reviewed build, every manifest id is filled in, every payload was dry-run clean, and
//                 every "after" is satisfied (4530253a only after 3d51552f has moved off its key). One document
//                 per request, in dependency order, the response saved after each; rerunning resumes.
//   6. readback   NETWORK, READ-ONLY. Compares each document in NTER with the build: title, document_key (none
//                 for an unlinked document), content_sha256, n_chars, chunk count, chunker_version, indexed_at.
//
// Options: --manifest <file> (scripts/f281-repair/manifest.json), --work <dir> (scripts/f281-repair/.work,
// git-ignored), --env <file> (.env.local, read by this script and nothing else), --only <prefix> (repeat).
// ocr: --go, --max-usd N, --pages-per-call N (40), --via data|url (data: the verified bytes are sent
// inline; url: Mistral fetches the official URL). write: --confirm <sha256>. pin: --apply. dry-run: --redo.
// Environment: SUPABASE_URL or VITE_SUPABASE_URL, SUPABASE_SECRET_KEY (prepare, dry-run, write, readback);
// MISTRAL_API_KEY (ocr --go). Neither is ever printed.
//
// Stop conditions. Stop and report, do not work around:
//   prepare   a document found 0 or 2+ times; a row assertRepairable refuses (upload, storage_path,
//             extract_hash, supplied-text, section-context, file_url_ambiguous); a pinned PDF that is not HTTP
//             200 or whose SHA-256 is not the manifest's (kept as <prefix>.mismatch.pdf, never used).
//   ocr       a plan above --max-usd; a PDF that is not pinned; a page count that is not the manifest's; any
//             Mistral error (cached parts stay; the rerun buys only what is missing).
//   build     any failed check: control codes left, an unmapped glyph, a title guard failure, a shifted font in a
//             re-extract, a re-key whose new title is not in the text or whose desk record is missing, an
//             incomplete OCR page set.
//   dry-run   any status other than dry_run or unchanged (refused, error), or an HTTP error.
//   write     any gate problem (also an "after" not yet written); the first document that does not come back
//             indexed or unchanged.
//   readback  any difference from the build.
//
// Every request body and console line is free of the keys; texts are written only to the work directory.

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertNoControlCodes, assertRepairable, buildRepairPayload, chooseTitle, codePointLength, countControlCodes, decodeShiftedText,
  extractPrintedTitle, ocrChecks, ocrPagesToDocument, stripLeadingForeignCover,
} from '../../src/lib/documentRepair.js';
import { titleMatches } from '../../src/lib/titleGuard.js';
import { buildOcrRequest, callMistralOcr, checkIndexes, OCR_USD_PER_1000_PAGES, ocrCostUsd } from '../../supabase/functions/ingest-worker/mistral.ts';
import { OCR_MODEL } from '../../supabase/functions/ingest-worker/types.ts';
import { countPdfPages, extractTextRuns } from './pdfRuns.mjs';
import {
  checkSpend, clip, credentials, deskNames, deskQuery, documentQuery, loadDotEnv, loadManifest, makeReader, ocrPlan, orderForWrite, pageRuns, parseArgs,
  readbackProblems, renderReview, selectDocuments, sha256, unpinned, usesPdf, WRITABLE_DRY_STATUSES, withPins, writeGateProblems,
} from './lib.mjs';

const say = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => Number(n).toLocaleString('en-US');
const nowIso = () => new Date().toISOString();

class Stop extends Error {}
const stop = (message) => {
  throw new Stop(message);
};

// ---------------------------------------------------------------------------------------------
// Work directory
// ---------------------------------------------------------------------------------------------

function makeWork(root) {
  const at = (...p) => path.join(root, ...p);
  return {
    at,
    async ensure(...p) {
      await mkdir(at(...p), { recursive: true });
    },
    async json(...p) {
      const file = at(...p);
      return existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : null;
    },
    async save(p, data) {
      await mkdir(path.dirname(at(...p)), { recursive: true });
      await writeFile(at(...p), typeof data === 'string' || Buffer.isBuffer(data) ? data : `${JSON.stringify(data, null, 2)}\n`);
    },
  };
}

async function postIngest({ url, key }, payload, dryRun) {
  const res = await fetch(`${url}/functions/v1/ingest-documents`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ documents: [payload], dry_run: dryRun }),
    signal: AbortSignal.timeout(170_000),
  });
  const body = await res.text();
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    stop(`ingest-documents HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  if (!res.ok) stop(`ingest-documents HTTP ${res.status}: ${json.error ?? body.slice(0, 200)}`);
  const result = json.results?.[0];
  if (!result) stop('ingest-documents returned no result');
  return result;
}

// ---------------------------------------------------------------------------------------------
// 1. prepare, pin
// ---------------------------------------------------------------------------------------------

async function cmdPrepare(ctx) {
  const { args, docs, work } = ctx;
  let failures = 0;
  if (!args.pdfsOnly) {
    const get = makeReader(credentials(process.env));
    say('Reading the documents from NTER (GET only):');
    for (const [i, d] of docs.entries()) {
      const { rows } = await get(documentQuery(d));
      if (rows.length !== 1) stop(`${d.prefix}: expected exactly one document, found ${rows.length}`);
      const row = rows[0];
      if (!row.id.startsWith(d.prefix)) stop(`${d.prefix}: found ${row.id}, which does not start with the prefix`);
      if (d.id && row.id !== d.id) stop(`${d.prefix}: the manifest id ${d.id} is not ${row.id}`);
      assertRepairable(row);
      const { total } = await get(`document_chunks?select=id&document_id=eq.${row.id}`, { count: true });
      let desk;
      if (d.action === 'rekey') {
        const deskRows = (await get(deskQuery(d.new_document_key))).rows;
        desk = { key: d.new_document_key, rows: deskRows.map((r) => ({ tier: r.tier, feature: r.feature, row_key: r.row_key, bill_name: r.row?.bill_name ?? null })), names: deskNames(deskRows) };
      }
      await work.save(['current', `${d.prefix}.json`], { read_at: nowIso(), chunk_count: total, document: row, ...(desk ? { desk } : {}) });
      say(`  [${i + 1}/${docs.length}] ${d.prefix}  ${row.id}  ${d.action.padEnd(14)} chunks=${String(total).padStart(3)} chars=${fmt(codePointLength(row.ocr_text ?? ''))} v${row.chunker_version}${desk ? `  desk records for ${d.new_document_key}: ${desk.rows.length}` : ''}`);
    }
  }
  if (!args.rowsOnly) {
    const pdfDocs = docs.filter(usesPdf);
    say(`Fetching ${pdfDocs.length} official PDF(s) (public GET) and checking their SHA-256:`);
    for (const [i, d] of pdfDocs.entries()) {
      const res = await fetch(d.source_url, { redirect: 'follow', headers: { 'user-agent': 'niyantran-f281-repair (official public document)' } });
      if (!res.ok) {
        failures++;
        say(`  [${i + 1}/${pdfDocs.length}] ${d.prefix}  HTTP ${res.status} for ${new URL(d.source_url).host}  STOP`);
        continue;
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      const got = sha256(bytes);
      const isPdf = bytes.subarray(0, 5).toString('latin1') === '%PDF-';
      const pinned = d.source_sha256 !== null && d.source_sha256 !== undefined;
      const verified = isPdf && pinned && got === d.source_sha256;
      const keep = isPdf && (!pinned || verified);
      await work.save(['pdf', keep ? `${d.prefix}.pdf` : `${d.prefix}.mismatch.pdf`], bytes);
      await work.save(['pdf', `${d.prefix}.json`], { url: d.source_url, fetched_at: nowIso(), bytes: bytes.length, sha256: got, expected: d.source_sha256 ?? null, pinned, verified });
      if (!isPdf || (pinned && !verified)) failures++;
      const verdict = !isPdf ? 'NOT A PDF  STOP' : !pinned ? 'unpinned: look at it, then run pin' : verified ? 'matches the manifest' : `DOES NOT MATCH ${d.source_sha256.slice(0, 12)}  STOP`;
      say(`  [${i + 1}/${pdfDocs.length}] ${d.prefix}  ${fmt(bytes.length).padStart(10)} bytes  sha256 ${got.slice(0, 12)}  ${verdict}`);
      await sleep(1200);
    }
  }
  if (failures) stop(`${failures} PDF(s) failed; nothing downstream may use them`);
}

async function cmdPin(ctx) {
  const { args, docs, work } = ctx;
  const found = [];
  for (const d of unpinned(docs)) {
    const meta = await work.json('pdf', `${d.prefix}.json`);
    const file = work.at('pdf', `${d.prefix}.pdf`);
    if (!meta || !existsSync(file)) {
      say(`  ${d.prefix}  no downloaded PDF in the work directory (run prepare --pdfs-only)`);
      continue;
    }
    const bytes = await readFile(file);
    const got = sha256(bytes);
    const pages = await countPdfPages(bytes);
    const note = d.pages && d.pages !== pages ? `  PAGES ${pages}, THE MANIFEST SAYS ${d.pages}: NOT PINNED` : '';
    say(`  ${d.prefix}  sha256 ${got}  ${fmt(bytes.length)} bytes  ${pages} pages${note}`);
    if (!note) found.push({ prefix: d.prefix, sha: got });
  }
  if (!found.length) {
    say('Nothing to pin.');
    return;
  }
  if (!args.apply) {
    say(`${found.length} hash(es) could be pinned. Run again with --apply to write them into the manifest (trust on first use: look at the files first).`);
    return;
  }
  const raw = JSON.parse(await readFile(path.resolve(args.manifest), 'utf8'));
  await writeFile(path.resolve(args.manifest), `${JSON.stringify(withPins(raw, found), null, 2)}\n`);
  say(`Pinned ${found.length}. The manifest SHA-256 is now ${sha256(await readFile(path.resolve(args.manifest)))} (the old ${ctx.manifestSha.slice(0, 12)} no longer applies).`);
}

// ---------------------------------------------------------------------------------------------
// 2. ocr
// ---------------------------------------------------------------------------------------------

async function pdfBytes(work, d) {
  if (!d.source_sha256) stop(`${d.prefix}: the PDF is not pinned (source_sha256 is null): run prepare, look at the file, then pin --apply`);
  const file = work.at('pdf', `${d.prefix}.pdf`);
  if (!existsSync(file)) stop(`${d.prefix}: no PDF in the work directory (run prepare)`);
  const bytes = await readFile(file);
  if (sha256(bytes) !== d.source_sha256) stop(`${d.prefix}: the PDF in the work directory is not the manifest's`);
  return bytes;
}

async function cachedOcr(work, prefix) {
  const dir = work.at('ocr', prefix);
  const parts = existsSync(dir) ? (await readdir(dir)).filter((f) => /^part-\d+-\d+\.json$/.test(f)).sort() : [];
  const out = [];
  for (const f of parts) out.push(JSON.parse(await readFile(path.join(dir, f), 'utf8')));
  return out;
}

async function cmdOcr(ctx) {
  const { args, docs, work } = ctx;
  const todoDocs = docs.filter((d) => d.action === 'ocr');
  if (!todoDocs.length) stop('no OCR document selected');
  const usdPerPage = ocrCostUsd(1);

  const cached = {};
  let spentUsd = 0;
  for (const d of todoDocs) {
    const bytes = await pdfBytes(work, d);
    const pages = await countPdfPages(bytes);
    if (pages !== d.pages) stop(`${d.prefix}: the PDF has ${pages} pages, the manifest says ${d.pages}`);
    const parts = await cachedOcr(work, d.prefix);
    cached[d.prefix] = new Set(parts.flatMap((p) => p.pages.map((x) => x.index)));
    spentUsd += parts.reduce((n, p) => n + p.cost_usd, 0);
  }
  const plan = ocrPlan(todoDocs, cached, usdPerPage);
  say(`Mistral OCR ${OCR_MODEL}, USD ${OCR_USD_PER_1000_PAGES} per 1,000 pages (${usdPerPage.toFixed(4)} a page):`);
  for (const r of plan.rows) say(`  ${r.prefix}  ${String(r.pages).padStart(3)} pages  cached ${String(r.cached).padStart(3)}  to buy ${String(r.todo.length).padStart(3)}  USD ${r.usd.toFixed(3)}`);
  say(`  ${todoDocs.length} document(s), ${plan.rows.reduce((n, r) => n + r.pages, 0)} pages; to buy: ${plan.todoPages} pages, USD ${plan.usd.toFixed(3)} (cap ${args.maxUsd}; already spent on cached parts ${spentUsd.toFixed(3)})`);
  checkSpend({ spentUsd, pages: plan.todoPages, usdPerPage, maxUsd: args.maxUsd });
  if (!plan.todoPages) {
    say('Nothing to buy: every page is cached.');
    return;
  }
  if (!args.go) {
    say('Plan only. Nothing was spent. Run again with --go to call Mistral OCR.');
    return;
  }
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) stop('MISTRAL_API_KEY is not set (environment or the --env file)');

  for (const [n, row] of plan.rows.entries()) {
    if (!row.todo.length) continue;
    const d = todoDocs.find((x) => x.prefix === row.prefix);
    const bytes = args.via === 'data' ? await pdfBytes(work, d) : null;
    const documentUrl = args.via === 'data' ? `data:application/pdf;base64,${bytes.toString('base64')}` : d.source_url;
    for (const run of pageRuns(row.todo, args.pagesPerCall)) {
      checkSpend({ spentUsd, pages: run.length, usdPerPage, maxUsd: args.maxUsd });
      // The worker's own request (ingest-worker/mistral.ts), except that the page images and blocks are
      // not asked for: composeDocument uses neither, and 388 image fragments would bloat the response.
      const request = { ...buildOcrRequest(OCR_MODEL, documentUrl, run), include_image_base64: false, include_blocks: false };
      let result;
      try {
        result = await callMistralOcr({ fetch, apiKey }, request);
      } catch (e) {
        stop(`${d.prefix}: Mistral OCR failed for pages ${run[0] + 1}-${run[run.length - 1] + 1}: ${e.message}`);
      }
      checkIndexes(run, result.pages.map((p) => p.index));
      const cost = ocrCostUsd(result.pagesProcessed);
      spentUsd += cost;
      const pages = result.pages.map((p) => ({ ...p, images: (p.images ?? []).map(({ image_base64: _b64, ...rest }) => rest) }));
      await work.save(['ocr', d.prefix, `part-${run[0]}-${run[run.length - 1]}.json`], { fetched_at: nowIso(), model: result.model, requested: run, pages_processed: result.pagesProcessed, cost_usd: cost, latency_ms: result.latencyMs, pages });
      say(`  [${n + 1}/${plan.rows.length}] ${d.prefix}  pages ${run[0] + 1}-${run[run.length - 1] + 1}  processed ${result.pagesProcessed}  USD ${cost.toFixed(4)}  ${result.latencyMs} ms  (model ${result.model || 'not reported'})  spent so far ${spentUsd.toFixed(3)}`);
      await sleep(1500);
    }
  }
  say(`Done. Spent USD ${spentUsd.toFixed(4)} in total on cached parts.`);
}

// ---------------------------------------------------------------------------------------------
// 3. build
// ---------------------------------------------------------------------------------------------

function firstLastLines(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return { first: clip(lines[0] ?? '', 80), last: clip(lines[lines.length - 1] ?? '', 80), lines: lines.length };
}

const pass = (extra = {}) => ({ ok: true, ...extra });
const fail = (message, extra = {}) => ({ ok: false, message, ...extra });
function attempt(fn) {
  try {
    return pass(fn() ?? {});
  } catch (e) {
    return fail(e.message);
  }
}

/** The new text of one document, by action, with what was seen on the way. */
async function buildText(d, existing, work) {
  const notes = {};
  const oldText = existing.ocr_text ?? '';
  if (d.action === 'decode' || d.action === 'reextract') {
    const { pages, fonts } = await extractTextRuns(await pdfBytes(work, d));
    const r = decodeShiftedText(pages, { fonts });
    notes.fonts = r.fonts.map((f) => ({ font: f.font, name: f.name, verdict: f.verdict, reason: f.reason, chars: f.chars, controls: f.controls }));
    notes.unmapped = r.unmapped;
    notes.pdf_pages = pages.length;
    const extra = { unmapped: Object.keys(r.unmapped).length ? fail(`glyph codes with no mapping: ${JSON.stringify(r.unmapped)}`) : pass() };
    if (d.action === 'reextract') {
      // A text layer that reads: no font may need the glyph-ID decode, or this is a decode document.
      const shifted = r.fonts.filter((f) => f.verdict === 'shifted');
      extra.plain_fonts_only = shifted.length ? fail(`${shifted.length} font(s) look shifted (control codes): ${shifted.map((f) => f.font).join(', ')}; this is a decode document`) : pass();
      extra.ocr = { ok: true, ...ocrChecks(r.text, 'any', { pages: pages.length }) };
    }
    return { text: r.text, notes, extra };
  }
  if (d.action === 'strip_cover') {
    const r = stripLeadingForeignCover(oldText, d.cover_marker);
    notes.removed = { chars: codePointLength(r.removed), head: clip(r.removed, 60) };
    return { text: r.text, notes, extra: {} };
  }
  if (d.action === 'rekey' || d.action === 'retitle_unlink') return { text: oldText, notes, extra: { text_unchanged: oldText.trim() ? pass() : fail('the stored text is empty') } };
  // ocr
  const parts = await cachedOcr(work, d.prefix);
  if (!parts.length) stop(`${d.prefix}: no cached OCR (run ocr --go)`);
  const doc = ocrPagesToDocument(parts.flatMap((p) => p.pages), { expectedPages: d.pages });
  notes.empty_pages = doc.emptyPages;
  notes.unresolved_tables = doc.unresolvedTables;
  notes.images_removed = doc.imagesRemoved;
  notes.page_chars = doc.pages.map((p) => p.text.length);
  notes.ocr_cost_usd = parts.reduce((n, p) => n + p.cost_usd, 0);
  notes.ocr_model = [...new Set(parts.map((p) => p.model))];
  return {
    text: doc.text,
    notes,
    extra: {
      ocr_pages_complete: pass({ pages: d.pages }),
      unresolved_tables: doc.unresolvedTables.length ? fail(`${doc.unresolvedTables.length} table placeholder(s) with no table`) : pass(),
    },
  };
}

const attention = (notes, message) => {
  notes.attention = [...(notes.attention ?? []), message];
};

async function buildOne(d, ctx) {
  const { work } = ctx;
  const cur = await work.json('current', `${d.prefix}.json`);
  if (!cur) stop(`${d.prefix}: no current row in the work directory (run prepare)`);
  const existing = cur.document;
  assertRepairable(existing);
  const oldText = existing.ocr_text ?? '';
  const built = await buildText(d, existing, work);
  const { text, notes } = built;
  const checks = { ...built.extra };

  // A repair that changes the text must leave none of either. One that keeps the stored text (a re-key, an
  // unlink, a cover strip) must not add any: what was already there is not what it repairs.
  const keepsText = ['rekey', 'retitle_unlink', 'strip_cover'].includes(d.action);
  const REPLACEMENT = String.fromCharCode(0xfffd);
  const count = (t, ch) => t.split(ch).length - 1;
  const introduced = (n, o) => (keepsText ? n > o : n > 0);
  checks.control_codes = introduced(countControlCodes(text), countControlCodes(oldText)) ? attempt(() => assertNoControlCodes(text)) : pass();
  checks.replacement_characters = introduced(count(text, REPLACEMENT), count(oldText, REPLACEMENT)) ? fail('the text holds U+FFFD') : pass();
  checks.not_empty = text.trim() ? pass() : fail('the new text is empty');

  let titleChoice = null;
  let rekey = null;
  let retitle = null;
  if (d.action === 'rekey' || d.action === 'retitle_unlink') {
    const printed = extractPrintedTitle(text);
    const desk = cur.desk ?? null;
    titleChoice = chooseTitle({ desk: desk?.names ?? [], manifest: d.new_title, printed });
    if (!titleChoice) stop(`${d.prefix}: no title to use`);
    checks.title_guard = { ...titleMatches(titleChoice.title, text), title: titleChoice.title };
    if (!checks.title_guard.ok && checks.title_guard.reasons.every((r) => r === 'late_start')) {
      // The words are all there: the text is this bill's. Something stands in front of them (a cover page, OCR
      // noise): a person should look, but the title and key are right, so it is not a failure.
      checks.title_guard = { ...checks.title_guard, ok: true, softened: 'late_start' };
      attention(notes, `the title appears ${fmt(checks.title_guard.firstMatchAt)} characters into the text: a cover page or noise stands in front of it`);
    }
    notes.old_title_guard = { ...titleMatches(existing.title, text), title: existing.title };
    if (!notes.old_title_guard.ok) notes.old_title_guard.confirms_defect = true;
    if (titleChoice.agreesWithPrinted === false) attention(notes, `the title (${titleChoice.source}) differs from the title printed in the text: ${clip(titleChoice.candidates.printed, 70)}`);
    if (titleChoice.deskAmbiguous) attention(notes, `the desk holds two names for the key: ${titleChoice.candidates.desk.map((n) => clip(n, 40)).join(' / ')}`);
    if (d.action === 'rekey') {
      if (desk) {
        notes.desk = { read: true, key: desk.key, names: desk.names, rows: desk.rows.length };
        checks.desk_record = desk.rows.length ? pass({ rows: desk.rows.length }) : fail(`no desk record holds ${d.new_document_key}: the document would have no row`);
      } else {
        notes.desk = { read: false };
        attention(notes, 'the desk record of the new key was not read (prepare reads it): title not checked against it');
      }
      if (existing.metadata?.house && d.new_house && existing.metadata.house !== d.new_house) notes.house_change = `${existing.metadata.house} -> ${d.new_house}`;
      rekey = { document_key: d.new_document_key, title: titleChoice.title, house: d.new_house, status: d.new_status };
    } else {
      retitle = { title: titleChoice.title };
    }
    checks.same_text = text === oldText ? pass() : fail('a title or key repair must not change the text');
  } else if (d.action === 'decode' || d.action === 'strip_cover') {
    checks.title_guard = { ...titleMatches(existing.title, text), title: existing.title };
  } else if (d.guard_title) {
    checks.title_guard = { ...titleMatches(existing.title, text), title: existing.title };
  } else {
    checks.title_guard = { ok: true, skipped: 'regulatory document: the title is a file name' };
  }

  if (d.action === 'ocr') {
    checks.ocr = { ok: true, ...ocrChecks(text, d.ocr_kind, { pages: d.pages }) };
    if (d.ocr_kind === 'cci-order' && !checks.ocr.paragraphs.startsAtOne) attention(notes, 'numbering does not start at 1');
    if (d.ocr_kind === 'cci-order' && !checks.ocr.paragraphs.contiguous) attention(notes, 'numbering has a large gap');
    if (checks.ocr.lowDensity) attention(notes, 'under 600 characters per page');
    if (d.ocr_kind === 'bilingual-gazette' && checks.ocr.scripts.latinNoiseShare > 0.15) attention(notes, 'many Latin words do not look like English');
  }
  if (d.action === 'reextract' && checks.ocr?.lowDensity) attention(notes, 'under 600 characters per page');

  const oldChars = codePointLength(oldText);
  const newChars = codePointLength(text);
  if (d.action === 'strip_cover') checks.only_a_cover_removed = oldText.endsWith(text) && oldChars - newChars <= 500 ? pass({ removed: oldChars - newChars }) : fail('more than the cover differs');
  if (d.action === 'ocr' || d.action === 'reextract') {
    // A repair that makes a document much shorter than what it replaces is not a repair of a truncation.
    if (newChars < oldChars * 0.9) attention(notes, `the new text (${fmt(newChars)}) is shorter than the stored one (${fmt(oldChars)})`);
  }

  let payload = null;
  let payloadSha = null;
  try {
    payload = await buildRepairPayload(existing, {
      text,
      action: d.action,
      rekey,
      retitle,
      provenance: {
        ...(d.source_url ? { source_url: d.source_url } : {}),
        ...(d.source_sha256 ? { source_sha256: d.source_sha256 } : {}),
        ...(d.action === 'ocr' ? { ocr_model: OCR_MODEL } : {}),
      },
    });
    const payloadText = `${JSON.stringify(payload, null, 2)}\n`;
    payloadSha = sha256(payloadText);
    await work.save(['build', `${d.prefix}.payload.json`], payloadText);
    checks.payload = pass({ keys: Object.keys(payload), metadata_keys: Object.keys(payload.metadata).length });
  } catch (e) {
    checks.payload = fail(e.message);
  }
  await work.save(['build', `${d.prefix}.text.txt`], text);

  const failed = Object.entries(checks).filter(([, c]) => c.ok === false).map(([k]) => k);
  const entry = {
    prefix: d.prefix,
    id: existing.id,
    action: d.action,
    ok: failed.length === 0,
    failed,
    built_at: nowIso(),
    old: { chars: oldChars, control_codes: countControlCodes(oldText), chunks: cur.chunk_count, chunker_version: existing.chunker_version, ...firstLastLines(oldText), title: existing.title, document_key: existing.metadata?.document_key ?? null },
    new: { chars: newChars, control_codes: countControlCodes(text), ...firstLastLines(text), title: payload?.title ?? null, document_key: payload?.metadata?.document_key ?? null },
    title_choice: titleChoice,
    checks,
    notes,
    payload_sha256: payloadSha,
    text_sha256: payload?.metadata?.text_sha256 ?? null,
  };
  await work.save(['build', `${d.prefix}.review.json`], entry);
  return entry;
}

async function cmdBuild(ctx) {
  const { docs, work, manifestSha, manifest } = ctx;
  const prior = await work.json('build', 'review.json');
  const review = { manifest_sha256: manifestSha, built_at: nowIso(), documents: prior?.manifest_sha256 === manifestSha ? { ...prior.documents } : {} };
  let bad = 0;
  for (const [i, d] of docs.entries()) {
    let entry;
    try {
      entry = await buildOne(d, ctx);
    } catch (e) {
      // One document that cannot be built (no OCR cached yet, no row read) is a failed entry, not the end of the batch.
      entry = { prefix: d.prefix, action: d.action, ok: false, failed: ['build'], error: e.message, checks: {}, notes: {}, old: {}, new: {}, payload_sha256: null };
      await work.save(['build', `${d.prefix}.review.json`], entry);
    }
    review.documents[d.prefix] = { ok: entry.ok, payload_sha256: entry.payload_sha256, text_sha256: entry.text_sha256 ?? null, built_at: entry.built_at ?? nowIso() };
    if (!entry.ok) bad++;
    const delta = entry.old.chars ? `${(((entry.new.chars - entry.old.chars) / entry.old.chars) * 100).toFixed(0)}%` : 'n/a';
    const g = entry.checks.title_guard;
    const guard = !g ? '' : g.skipped ? '  title guard skipped' : g.ok ? '  title guard ok' : `  TITLE GUARD FAILED ${g.reasons?.join('+')}`;
    say(`[${i + 1}/${docs.length}] ${entry.ok ? 'OK  ' : 'FAIL'} ${d.prefix} ${d.action.padEnd(14)} chars ${fmt(entry.old.chars ?? 0)} -> ${fmt(entry.new.chars ?? 0)} (${delta})${guard}${(entry.notes.attention ?? []).length ? `  LOOK x${entry.notes.attention.length}` : ''}`);
    for (const f of entry.failed ?? []) say(`       FAILED CHECK ${f}: ${entry.checks[f]?.message ?? entry.error ?? ''}`);
  }
  await work.save(['build', 'review.json'], review);
  // review.md covers every document built under this manifest, not only this run's selection.
  const entries = [];
  for (const d of manifest.documents) {
    const e = await work.json('build', `${d.prefix}.review.json`);
    if (e && review.documents[d.prefix]) entries.push(e);
  }
  await work.save(['build', 'review.md'], renderReview({ manifestSha, entries, excluded: manifest.excluded ?? [] }));
  say(`Review written to ${work.at('build', 'review.md')} (${entries.length} document(s), riskiest first) and ${work.at('build', 'review.json')}; manifest SHA-256 ${manifestSha}.`);
  if (bad) stop(`${bad} document(s) failed their checks`);
}

// ---------------------------------------------------------------------------------------------
// 4. dry-run and 5. write
// ---------------------------------------------------------------------------------------------

async function loadPayload(work, prefix) {
  const file = work.at('build', `${prefix}.payload.json`);
  if (!existsSync(file)) return null;
  const text = await readFile(file, 'utf8');
  return { payload: JSON.parse(text), sha256: sha256(text) };
}

const resultLine = (prefix, r) => `${r.status.padEnd(9)} ${prefix}  chunks=${r.chunks} +${r.inserted} =${r.kept} -${r.deleted}  tokens=${r.embedded_tokens} usd=${r.cost_usd.toFixed(6)}${r.reason ? `  ${r.reason}` : ''}${r.error ? `  ERROR ${r.error}` : ''}`;

async function cmdDryRun(ctx) {
  const { args, docs, work, manifestSha } = ctx;
  const review = await work.json('build', 'review.json');
  if (!review || review.manifest_sha256 !== manifestSha) stop('no reviewed build for this manifest: run build first');
  const cred = credentials(process.env);
  let bad = 0;
  let skipped = 0;
  for (const [i, d] of docs.entries()) {
    if (review.documents[d.prefix]?.ok !== true) stop(`${d.prefix}: the reviewed build did not pass its checks`);
    const loaded = await loadPayload(work, d.prefix);
    if (!loaded || loaded.sha256 !== review.documents[d.prefix].payload_sha256) stop(`${d.prefix}: the payload file is not the reviewed one`);
    const done = await work.json('dryrun', `${d.prefix}.json`);
    if (!args.redo && done && done.payload_sha256 === loaded.sha256 && WRITABLE_DRY_STATUSES.includes(done.status)) {
      skipped++;
      continue;
    }
    const r = await postIngest(cred, loaded.payload, true);
    await work.save(['dryrun', `${d.prefix}.json`], { at: nowIso(), payload_sha256: loaded.sha256, ...r });
    say(`[${i + 1}/${docs.length}] ${resultLine(d.prefix, r)}`);
    if (!WRITABLE_DRY_STATUSES.includes(r.status)) bad++;
    await sleep(500);
  }
  if (skipped) say(`${skipped} document(s) already dry-run with this payload were skipped (--redo repeats them).`);
  if (bad) stop(`${bad} document(s) did not dry-run cleanly`);
  say('All dry runs were clean. Nothing was written.');
}

/** Prefixes of the whole manifest already written with their current reviewed payload. */
async function writtenPrefixes(manifest, work, review) {
  const done = new Set();
  for (const d of manifest.documents) {
    const w = await work.json('write', `${d.prefix}.json`);
    if (w && ['indexed', 'unchanged'].includes(w.status) && w.payload_sha256 === review?.documents?.[d.prefix]?.payload_sha256) done.add(d.prefix);
  }
  return done;
}

async function cmdWrite(ctx) {
  const { args, docs, work, manifestSha, manifest } = ctx;
  const currentIds = {};
  const payloadShas = {};
  const dryRuns = {};
  for (const d of docs) {
    currentIds[d.prefix] = (await work.json('current', `${d.prefix}.json`))?.document?.id;
    payloadShas[d.prefix] = (await loadPayload(work, d.prefix))?.sha256;
    dryRuns[d.prefix] = await work.json('dryrun', `${d.prefix}.json`);
  }
  const review = await work.json('build', 'review.json');
  const written = await writtenPrefixes(manifest, work, review);
  const problems = writeGateProblems({ confirm: args.confirm, manifestSha, docs, review, currentIds, payloadShas, dryRuns, written });
  if (problems.length) {
    say('Refusing to write:');
    for (const p of problems) say(`  - ${p}`);
    process.exitCode = 2;
    return;
  }
  const cred = credentials(process.env);
  const ordered = orderForWrite(docs);
  say(`Writing ${ordered.length} document(s) to ${new URL(cred.url).host} (manifest ${manifestSha.slice(0, 12)}), dependencies first:`);
  for (const [i, d] of ordered.entries()) {
    const loaded = await loadPayload(work, d.prefix);
    if (written.has(d.prefix)) {
      say(`[${i + 1}/${ordered.length}] skipped   ${d.prefix}  already written with this payload`);
      continue;
    }
    const startedAt = nowIso();
    const r = await postIngest(cred, loaded.payload, false);
    await work.save(['write', `${d.prefix}.json`], { started_at: startedAt, at: nowIso(), payload_sha256: loaded.sha256, ...r });
    say(`[${i + 1}/${ordered.length}] ${resultLine(d.prefix, r)}`);
    if (!['indexed', 'unchanged'].includes(r.status)) stop(`${d.prefix}: ${r.status}; stopping. Documents after it were not written. Re-running write resumes here.`);
    written.add(d.prefix);
    await sleep(2000);
  }
  say('Done. Run readback next.');
}

// ---------------------------------------------------------------------------------------------
// 6. readback
// ---------------------------------------------------------------------------------------------

async function cmdReadback(ctx) {
  const { docs, work } = ctx;
  const get = makeReader(credentials(process.env));
  const columns = 'id,title,content_sha256,indexed_at,chunker_version,document_key:metadata->>document_key,n_chars:metadata->>n_chars,file_url_ambiguous:metadata->>file_url_ambiguous';
  let bad = 0;
  for (const [i, d] of docs.entries()) {
    const loaded = await loadPayload(work, d.prefix);
    if (!loaded) stop(`${d.prefix}: no built payload to compare with`);
    const written = await work.json('write', `${d.prefix}.json`);
    const dry = await work.json('dryrun', `${d.prefix}.json`);
    const planned = written ?? dry;
    if (!planned) stop(`${d.prefix}: no dry-run or write record to take the chunk count from`);
    const { rows } = await get(documentQuery(d, columns));
    const row = rows.length === 1 ? rows[0] : null;
    const { total } = row ? await get(`document_chunks?select=id&document_id=eq.${row.id}`, { count: true }) : { total: null };
    const expected = {
      title: loaded.payload.title,
      document_key: loaded.payload.metadata.document_key ?? null,
      content_sha256: loaded.payload.metadata.text_sha256,
      n_chars: loaded.payload.metadata.n_chars,
      chunk_count: planned.chunks,
      chunker_version: 2,
      ...(d.action === 'retitle_unlink' ? { file_url_ambiguous: true } : {}),
    };
    const problems = readbackProblems(expected, row ? { ...row, chunk_count: total } : null, { writtenAfter: written?.started_at ?? null });
    await work.save(['readback', `${d.prefix}.json`], { at: nowIso(), expected, actual: row ? { ...row, chunk_count: total } : null, problems });
    say(`[${i + 1}/${docs.length}] ${problems.length ? 'DIFF' : 'OK  '} ${d.prefix}  ${clip(row?.title ?? '(not found)', 48)}  key=${row?.document_key ?? '-'}  chunks=${total}  indexed_at=${row?.indexed_at ?? 'null'}`);
    for (const p of problems) say(`       ${p}`);
    if (problems.length) bad++;
  }
  if (bad) stop(`${bad} document(s) differ from the build`);
  say('Every document in NTER matches the build.');
}

// ---------------------------------------------------------------------------------------------

const COMMAND_FUNCTIONS = { prepare: cmdPrepare, pin: cmdPin, ocr: cmdOcr, build: cmdBuild, 'dry-run': cmdDryRun, write: cmdWrite, readback: cmdReadback };
const USAGE = 'usage: node scripts/f281-repair/repair.mjs <prepare|pin|ocr|build|dry-run|write|readback> [--only <prefix> ...] [--manifest f] [--work dir] [--env f]\n'
  + '       ocr [--go] [--max-usd N] [--pages-per-call N] [--via data|url]   write --confirm <manifest sha256>   prepare [--rows-only|--pdfs-only]   pin [--apply]   dry-run [--redo]\n'
  + 'Read the header of this file for the order of the steps and what each one touches.';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.command) {
    say(USAGE);
    process.exit(args.help ? 0 : 2);
  }
  const { manifest, sha256: manifestSha } = await loadManifest(path.resolve(args.manifest));
  const docs = selectDocuments(manifest, args.only);
  const needsKeys = ['dry-run', 'write', 'readback'].includes(args.command) || (args.command === 'prepare' && !args.pdfsOnly) || (args.command === 'ocr' && args.go);
  if (needsKeys) await loadDotEnv(path.resolve(args.env));
  const work = makeWork(path.resolve(args.work));
  await work.ensure();
  say(`F281 repair: ${args.command}, ${docs.length} document(s), manifest ${manifestSha.slice(0, 12)}, work ${path.relative(process.cwd(), work.at()) || '.'}`);
  await COMMAND_FUNCTIONS[args.command]({ args, docs, work, manifest, manifestSha });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Stop ? `STOP: ${err.message}` : err.message);
    process.exit(1);
  });
}
