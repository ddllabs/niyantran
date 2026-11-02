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
//   retitle         a key-less Bill whose title is a file name: the title printed in its own text, nothing else
//                   (text, metadata and links unchanged; no key is added, re-keying is the Bills adapter's job).
//                   The new title must be printed in the first 3,000 characters of the text (check title_in_text)
//                   and the document must have no document_key (check keyless).
//
// Nothing runs by default and every step that touches a network says so below. The steps are separate
// and are run in this order, by the supervisor, each one read before the next:
//
//   1. prepare    NETWORK, READ-ONLY. GETs the documents from NTER (PostgREST, service key, no write method
//                 exists in the reader), for each re-key the desk records (desk_rows by document_key) that hold
//                 the new key, and the official PDF of each decode, reextract and ocr document with its SHA-256
//                 checked against the manifest (no PDF is fetched for strip_cover, rekey or retitle_unlink).
//                 Saves each row as a snapshot and records the snapshots' SHA-256 in current/SHA256SUMS.
//                 --rows-only / --pdfs-only run one half.
//      pin        OFFLINE. Lists the PDFs whose manifest source_sha256 is null (never fetched before prepare)
//                 with their hash and page count; --apply writes those hashes into the manifest. Trust on first
//                 use: look at the file (and at build's identity checks) before relying on it.
//   2. ocr        NETWORK, PAID (Mistral OCR, mistral-ocr-4-1, USD 4 per 1,000 pages). Without --go it prints the
//                 plan (pages, cached pages, cost for the whole batch) and spends nothing. With --go it calls
//                 Mistral with the verified bytes of the pinned PDF (inline, never a URL), refuses to pass
//                 --max-usd (default 5), saves every paid response BEFORE it validates it and counts it against
//                 the cap even if validation then fails. Each cached part records the PDF's SHA-256, the model
//                 and the request flags; build refuses a part that does not match. Refuses an unpinned PDF.
//   3. build      OFFLINE. Verifies the snapshots against SHA256SUMS, produces each new text and ingest-documents
//                 payload, runs the guards and checks (title guard; for re-keys and unlinks the printed Bill No.
//                 and the article or section the title names; for OCR and re-extraction the overlap of the old
//                 text in the new), and writes build/<prefix>.review.json, build/review.json (every payload
//                 hash and every new text's SHA-256) and build/review.md (every document, the riskiest first:
//                 read it, and the text of every OCR document by eye, before going on). The console shows one
//                 line per document, never a text.
//      rollback-build  OFFLINE. Turns the pre-write snapshots into payloads that put each document back as it
//                 was (an unlinked document is re-linked: file_url_ambiguous false plus its key fields), with a
//                 review.json of its own in rollback/. dry-run, write and readback take --rollback to use them.
//   4. dry-run    NETWORK, NO WRITE. Re-reads each row and refuses a document that differs from its snapshot
//                 (content_sha256, title, a hash of metadata, chunker_version, indexed_at), then posts the payload,
//                 one per request, to ingest-documents with dry_run:true and records status and the
//                 inserted/kept/deleted chunk counts. Resumable (--redo repeats).
//   5. write      NETWORK, WRITES NTER. In batches of --batch (20): each invocation writes ONE batch, then runs
//                 readback for it, records both, and stops: the next batch is the next invocation (the audit
//                 pause of docs/operations/corpus-jobs.md). It refuses unless
//                   - --confirm is the SHA-256 of build/review.json (the reviewed content, not the manifest file),
//                     and every payload and every text is the reviewed one;
//                   - --authorized-by "<who, when, what>" is given (recorded in write/authorization.json and in
//                     review.md);
//                   - every manifest id is filled in, and every payload was dry-run clean;
//                   - no document is overwritten that was written with another payload (name it with --rewrite);
//                   - no ingestion job holds a live claim (ingest_jobs, read-only) and no other write.lock holds
//                     this work directory;
//                   - each row still equals its snapshot (re-read just before it is posted);
//                   - the expected embedding cost (the dry run's new chunks, at the embedding model's price) is
//                     within --max-embed-usd (default 1);
//                   - every "after" is satisfied (4530253a only after 3d51552f, 0cfda1b0 after 648594ab).
//   6. readback   NETWORK, READ-ONLY. Compares each document in NTER with the build: title, document_key (none
//                 for an unlinked document), content_sha256, n_chars, chunk count, chunker_version, indexed_at
//                 (re-read a few times while it is still null; an unchanged write does not move it).
//
// Filling ids in the manifest or pinning a PDF changes the manifest: run build and dry-run again afterwards.
//
// Options: --manifest <file> (scripts/f281-repair/manifest.json), --work-dir <dir> (default
// ~/.niyantran/f281-repair, outside the worktree: it holds NTER text and the rollback snapshots; --work is the
// old name), --env <file> (.env.local, read by this script and nothing else), --only <prefix> (repeat),
// --rollback. ocr: --go, --max-usd N, --pages-per-call N (40). write: --confirm, --authorized-by, --batch,
// --max-embed-usd, --rewrite <prefix>. pin: --apply. dry-run: --redo.
// Environment: SUPABASE_URL or VITE_SUPABASE_URL, SUPABASE_SECRET_KEY (prepare, dry-run, write, readback);
// MISTRAL_API_KEY (ocr --go). Neither is ever printed.
//
// Stop conditions. Stop and report, do not work around:
//   prepare   a document found 0 or 2+ times; a row assertRepairable refuses (upload, storage_path,
//             extract_hash, supplied-text, section-context, file_url_ambiguous); a pinned PDF that is not HTTP
//             200 or whose SHA-256 is not the manifest's (kept as <prefix>.mismatch.pdf, never used).
//   ocr       a plan above --max-usd; a PDF that is not pinned; a page count that is not the manifest's; any
//             Mistral error or a response that fails validation (the paid response is kept and counted).
//   build     any failed check: a snapshot that changed, control codes left, an unmapped glyph, a title guard,
//             Bill No. or article failure, an old text that is not in the new one, a shifted font in a
//             re-extract, a re-key whose desk record is missing (unless allow_missing_desk), a cached OCR part
//             that is not from the pinned PDF with this tool's model and flags, an incomplete page set.
//   dry-run   any status other than dry_run or unchanged (refused, error), a drifted row, an HTTP error.
//   write     any gate problem; a live ingestion claim; a drifted row (that document is not written); the first
//             document that does not come back indexed or unchanged; any difference in the batch's readback.
//   readback  any difference from the build.
//
// Every request body and console line is free of the keys; texts are written only to the work directory.

import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertNoControlCodes, assertRepairable, buildRepairPayload, buildRollbackPayload, chooseTitle, codePointLength, countControlCodes, decodeShiftedText,
  extractPrintedTitle, identityProblems, identityVerdict, oldTextContainment, ocrChecks, ocrPagesToDocument, stripLeadingForeignCover, titleInOpening,
} from '../../src/lib/documentRepair.js';
import { titleMatches } from '../../src/lib/titleGuard.js';
import { chunkDocument } from '../../supabase/functions/_shared/chunking.ts';
import { EMBED_PRICE_USD_PER_TOKEN } from '../../supabase/functions/_shared/embed.ts';
import { buildOcrRequest, callMistralOcr, checkIndexes, OCR_USD_PER_1000_PAGES, ocrCostUsd } from '../../supabase/functions/ingest-worker/mistral.ts';
import { countPdfPages, extractTextRuns } from './pdfRuns.mjs';
import {
  addBatch, checkSpend, clip, credentials, DRIFT_COLUMNS, deskNames, deskQuery, documentQuery, driftProblems, embedCapProblems, embedEstimate, formatSums,
  ingestJobsQuery, liveClaimProblems, loadDotEnv, loadManifest, lockDecision, makeReader, nextBatch, nextBatchNumber, OCR_MODEL, OCR_REQUEST_FLAGS,
  ocrCacheProblems, ocrPlan, pageRuns, parseArgs, parseSums, readbackProblems, readbackWrittenAfter, renderReview, retryRead, selectDocuments,
  sha256, snapshotProblems, spentOnParts, unpinned, usesPdf, WRITABLE_DRY_STATUSES, withAuthorization, withPins, writeGateProblems,
} from './lib.mjs';

const say = (...a) => console.log(...a);
let pause = (ms) => new Promise((r) => setTimeout(r, ms));
const sleep = (ms) => pause(ms);
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
    async ensure() {
      await mkdir(root, { recursive: true, mode: 0o700 });
    },
    async json(...p) {
      const file = at(...p);
      return existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : null;
    },
    async save(p, data) {
      await mkdir(path.dirname(at(...p)), { recursive: true, mode: 0o700 });
      await writeFile(at(...p), typeof data === 'string' || Buffer.isBuffer(data) ? data : `${JSON.stringify(data, null, 2)}\n`);
    },
  };
}

/** The directories of a stage: the repair itself, or the rollback built from the snapshots. */
const stageDirs = (rollback) => (rollback
  ? { build: 'rollback', dryrun: 'rollback-dryrun', write: 'rollback-write', readback: 'rollback-readback' }
  : { build: 'build', dryrun: 'dryrun', write: 'write', readback: 'readback' });

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

/** A write lock in the work directory (corpus-jobs.md: never remove an active, unknown or foreign-host lock). */
function acquireLock(work) {
  const file = work.at('write.lock');
  const me = { host: hostname(), pid: process.pid };
  const isAlive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return e.code === 'EPERM';
    }
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, 'wx');
      const lock = { ...me, token: randomUUID(), at: nowIso() };
      writeSync(fd, JSON.stringify(lock));
      closeSync(fd);
      return () => {
        try {
          if (JSON.parse(readFileSync(file, 'utf8')).token === lock.token) rmSync(file);
        } catch {
          // already gone
        }
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let found = 'unreadable';
      try {
        found = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        // an unreadable lock is an unknown lock
      }
      const verdict = lockDecision(found, me, isAlive);
      if (verdict === 'blocked') stop(`another write holds ${file} (${typeof found === 'object' ? `pid ${found.pid} on ${found.host}` : 'unknown lock'}); never remove it by hand unless you know it is dead`);
      rmSync(file); // a verified dead same-host lock
    }
  }
  return stop(`could not take ${file}`);
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
    const sums = parseSums(existsSync(work.at('current', 'SHA256SUMS')) ? await readFile(work.at('current', 'SHA256SUMS'), 'utf8') : '');
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
      const text = `${JSON.stringify({ read_at: nowIso(), chunk_count: total, document: row, ...(desk ? { desk } : {}) }, null, 2)}\n`;
      await work.save(['current', `${d.prefix}.json`], text);
      sums[`${d.prefix}.json`] = sha256(text);
      say(`  [${i + 1}/${docs.length}] ${d.prefix}  ${row.id}  ${d.action.padEnd(14)} chunks=${String(total).padStart(3)} chars=${fmt(codePointLength(row.ocr_text ?? ''))} v${row.chunker_version}${desk ? `  desk records for ${d.new_document_key}: ${desk.rows.length}` : ''}`);
    }
    await work.save(['current', 'SHA256SUMS'], formatSums(sums));
    say(`Snapshots recorded in ${work.at('current', 'SHA256SUMS')}: they are what rollback-build restores from. Back them up.`);
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
  say(`Pinned ${found.length}. The manifest SHA-256 is now ${sha256(await readFile(path.resolve(args.manifest)))} (the old ${ctx.manifestSha.slice(0, 12)} no longer applies): build and dry-run again.`);
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

/** Every cached response of a document, validated or not: what was paid for. */
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
    // Only a validated part made from this PDF with this tool's request counts as cached; every part was paid for.
    const usable = parts.filter((p) => p.valid === true && p.source_sha256 === d.source_sha256);
    cached[d.prefix] = new Set(usable.flatMap((p) => p.pages.map((x) => x.index)));
    spentUsd += spentOnParts(parts);
  }
  const plan = ocrPlan(todoDocs, cached, usdPerPage);
  say(`Mistral OCR ${OCR_MODEL}, USD ${OCR_USD_PER_1000_PAGES} per 1,000 pages (${usdPerPage.toFixed(4)} a page):`);
  for (const r of plan.rows) say(`  ${r.prefix}  ${String(r.pages).padStart(3)} pages  cached ${String(r.cached).padStart(3)}  to buy ${String(r.todo.length).padStart(3)}  USD ${r.usd.toFixed(3)}`);
  say(`  ${todoDocs.length} document(s), ${plan.rows.reduce((n, r) => n + r.pages, 0)} pages; to buy: ${plan.todoPages} pages, USD ${plan.usd.toFixed(3)} (cap ${args.maxUsd}; already spent on cached responses ${spentUsd.toFixed(3)})`);
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
    // The verified bytes, inline: what Mistral reads is exactly the file whose SHA-256 is pinned.
    const documentUrl = `data:application/pdf;base64,${(await pdfBytes(work, d)).toString('base64')}`;
    for (const run of pageRuns(row.todo, args.pagesPerCall)) {
      checkSpend({ spentUsd, pages: run.length, usdPerPage, maxUsd: args.maxUsd });
      // The worker's own request (ingest-worker/mistral.ts), except for OCR_REQUEST_FLAGS (no images or blocks).
      const request = { ...buildOcrRequest(OCR_MODEL, documentUrl, run), ...OCR_REQUEST_FLAGS };
      let result;
      try {
        result = await callMistralOcr({ fetch, apiKey }, request);
      } catch (e) {
        stop(`${d.prefix}: Mistral OCR failed for pages ${run[0] + 1}-${run[run.length - 1] + 1}: ${e.message}`);
      }
      // Paid for: save it and count it first, then validate it.
      const cost = ocrCostUsd(result.pagesProcessed);
      spentUsd += cost;
      const pages = result.pages.map((p) => ({ ...p, images: (p.images ?? []).map(({ image_base64: _b64, ...rest }) => rest) }));
      const file = ['ocr', d.prefix, `part-${run[0]}-${run[run.length - 1]}.json`];
      const part = { fetched_at: nowIso(), valid: false, source_sha256: d.source_sha256, model_requested: OCR_MODEL, model: result.model, flags: OCR_REQUEST_FLAGS, requested: run, pages_processed: result.pagesProcessed, cost_usd: cost, latency_ms: result.latencyMs, pages };
      await work.save(file, part);
      try {
        checkIndexes(run, result.pages.map((p) => p.index));
      } catch (e) {
        stop(`${d.prefix}: the response for pages ${run[0] + 1}-${run[run.length - 1] + 1} was paid for (USD ${cost.toFixed(4)}, kept and counted) but did not validate: ${e.message}`);
      }
      await work.save(file, { ...part, valid: true });
      say(`  [${n + 1}/${plan.rows.length}] ${d.prefix}  pages ${run[0] + 1}-${run[run.length - 1] + 1}  processed ${result.pagesProcessed}  USD ${cost.toFixed(4)}  ${result.latencyMs} ms  (model ${result.model || 'not reported'})  spent so far ${spentUsd.toFixed(3)}`);
      await sleep(1500);
    }
  }
  say(`Done. Spent USD ${spentUsd.toFixed(4)} in total on cached responses.`);
}

// ---------------------------------------------------------------------------------------------
// 3. build, rollback-build
// ---------------------------------------------------------------------------------------------

function firstLastLines(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return { first: clip(lines[0] ?? '', 80), last: clip(lines[lines.length - 1] ?? '', 80), lines: lines.length };
}

const firstPageTitle = (text) => text.split('\n').map((l) => l.replace(/^[\s#>*_|]+/, '').trim()).filter(Boolean).slice(0, 2).map((l) => clip(l, 70)).join(' / ');

const pass = (extra = {}) => ({ ok: true, ...extra });
const fail = (message, extra = {}) => ({ ok: false, message, ...extra });
function attempt(fn) {
  try {
    return pass(fn() ?? {});
  } catch (e) {
    return fail(e.message);
  }
}

/** The metadata that described the old text's source, set to what describes the new one (the old is kept in text_repair.previous). */
const SOURCE_LABEL = { decode: 'pdf-text-layer-decoded', reextract: 'pdf-text-layer', ocr: OCR_MODEL };

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
  if (['rekey', 'retitle_unlink', 'retitle'].includes(d.action)) return { text: oldText, notes, extra: { text_unchanged: oldText.trim() ? pass() : fail('the stored text is empty') } };
  // ocr: only parts made from the pinned PDF, with this tool's model and flags, all validated
  const parts = await cachedOcr(work, d.prefix);
  const cacheProblems = ocrCacheProblems(parts, { sha: d.source_sha256, pages: d.pages });
  if (cacheProblems.length) throw new Error(`the cached OCR cannot be used: ${cacheProblems.join('; ')}`);
  const doc = ocrPagesToDocument(parts.flatMap((p) => p.pages), { expectedPages: d.pages });
  notes.empty_pages = doc.emptyPages;
  notes.unresolved_tables = doc.unresolvedTables;
  notes.images_removed = doc.imagesRemoved;
  notes.page_chars = doc.pages.map((p) => p.text.length);
  notes.ocr_cost_usd = spentOnParts(parts);
  notes.ocr_model = [...new Set(parts.map((p) => p.model))];
  return {
    text: doc.text,
    notes,
    extra: {
      ocr_cache: pass({ parts: parts.length }),
      ocr_pages_complete: pass({ pages: d.pages }),
      unresolved_tables: doc.unresolvedTables.length ? fail(`${doc.unresolvedTables.length} table placeholder(s) with no table`) : pass(),
    },
  };
}

const attention = (notes, message) => {
  notes.attention = [...(notes.attention ?? []), message];
};

async function snapshotSums(work) {
  const file = work.at('current', 'SHA256SUMS');
  if (!existsSync(file)) stop('no current/SHA256SUMS: run prepare');
  return parseSums(await readFile(file, 'utf8'));
}

/** The snapshot files of `docs` as they are now, hashed, against what prepare recorded. */
async function checkSnapshots(work, docs) {
  const actual = {};
  for (const d of docs) {
    const f = work.at('current', `${d.prefix}.json`);
    if (existsSync(f)) actual[`${d.prefix}.json`] = sha256(await readFile(f));
  }
  return snapshotProblems(await snapshotSums(work), actual, docs.map((d) => d.prefix));
}

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
  const keepsText = ['rekey', 'retitle_unlink', 'retitle', 'strip_cover'].includes(d.action);
  const REPLACEMENT = String.fromCharCode(0xfffd);
  const count = (t, ch) => t.split(ch).length - 1;
  const introduced = (n, o) => (keepsText ? n > o : n > 0);
  checks.control_codes = introduced(countControlCodes(text), countControlCodes(oldText)) ? attempt(() => assertNoControlCodes(text)) : pass();
  checks.replacement_characters = introduced(count(text, REPLACEMENT), count(oldText, REPLACEMENT)) ? fail('the text holds U+FFFD') : pass();
  checks.not_empty = text.trim() ? pass() : fail('the new text is empty');

  let titleChoice = null;
  let rekey = null;
  let retitle = null;
  if (d.action === 'rekey' || d.action === 'retitle_unlink' || d.action === 'retitle') {
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
    // The title's words do not tell the Constitution (Amendment) Bills apart: the printed Bill No. and the
    // article or section the title names do.
    const bill = d.action === 'rekey' ? { key: d.new_document_key } : d.new_bill_number ? { billNo: { number: d.new_bill_number, year: d.new_bill_year } } : {};
    const identity = identityProblems({ title: titleChoice.title, text, ...bill });
    checks.bill_identity = identity.problems.length ? fail(identity.problems.join('; '), { problems: identity.problems, notes: identity.notes }) : pass({ problems: [], notes: identity.notes });
    notes.old_title_guard = { ...titleMatches(existing.title, text), title: existing.title };
    if (!notes.old_title_guard.ok) notes.old_title_guard.confirms_defect = true;
    if (titleChoice.agreesWithPrinted === false) attention(notes, `the title (${titleChoice.source}) differs from the title printed in the text: ${clip(titleChoice.candidates.printed, 70)}`);
    if (titleChoice.deskAmbiguous) attention(notes, `the desk holds two names for the key: ${titleChoice.candidates.desk.map((n) => clip(n, 40)).join(' / ')}`);
    if (d.action === 'rekey') {
      if (desk) {
        notes.desk = { read: true, key: desk.key, names: desk.names, rows: desk.rows.length };
        if (desk.rows.length) checks.desk_record = pass({ rows: desk.rows.length });
        else if (d.allow_missing_desk) {
          checks.desk_record = pass({ rows: 0, allowed: d.reason });
          attention(notes, `no desk record holds ${d.new_document_key} (allowed by the manifest: it is harmless and keeps the identity right)`);
        } else checks.desk_record = fail(`no desk record holds ${d.new_document_key}: the document would have no row`);
      } else {
        notes.desk = { read: false };
        attention(notes, 'the desk record of the new key was not read (prepare reads it): title not checked against it');
      }
      if (existing.metadata?.house && d.new_house && existing.metadata.house !== d.new_house) notes.house_change = `${existing.metadata.house} -> ${d.new_house}`;
      rekey = { document_key: d.new_document_key, title: titleChoice.title, house: d.new_house, status: d.new_status };
    } else {
      retitle = { title: titleChoice.title };
    }
    if (d.action === 'retitle') {
      // The title is read, not composed: it must be printed in the opening of this document's own text. And a
      // document that has a key takes its title from the desk record, not from here.
      checks.title_in_text = titleInOpening(titleChoice.title, text) ? pass() : fail(`the title ${JSON.stringify(titleChoice.title)} is not printed in the first 3,000 characters of the text`);
      checks.keyless = existing.metadata?.document_key ? fail(`the document has the key ${existing.metadata.document_key}: a retitle is for a document with none`) : pass();
    }
    checks.same_text = text === oldText ? pass() : fail('a title or key repair must not change the text');
  } else if (d.action === 'decode' || d.action === 'strip_cover') {
    checks.title_guard = { ...titleMatches(existing.title, text), title: existing.title };
  } else if (d.guard_title) {
    checks.title_guard = { ...titleMatches(existing.title, text), title: existing.title };
  } else {
    checks.title_guard = { ok: true, skipped: 'regulatory document: the title is a file name' };
  }

  if (d.action === 'ocr' || d.action === 'reextract') {
    // Identity: the stored text is the tail or the debris of the same document, so its four-word sequences
    // should be in the new text. A garbage stored text cannot vouch for it: a person looks at the first page.
    const c = oldTextContainment(oldText, text);
    const verdict = identityVerdict({ share: c.share, shingles: c.shingles, garbage: Boolean(d.old_text_garbage) });
    checks.identity = { ok: verdict.level !== 'fail', level: verdict.level, reason: verdict.reason, share: c.share, shingles: c.shingles, contained: c.contained, firstPageTitle: firstPageTitle(text), ...(verdict.level === 'fail' ? { message: verdict.reason } : {}) };
    if (verdict.level === 'look') attention(notes, `${verdict.reason}; first page reads: ${checks.identity.firstPageTitle}`);
  }
  if (d.action === 'ocr') {
    checks.ocr = { ok: true, ...ocrChecks(text, d.ocr_kind, { pages: d.pages }) };
    if (d.ocr_kind === 'cci-order' && !checks.ocr.paragraphs.startsAtOne) attention(notes, 'numbering does not start at 1');
    if (d.ocr_kind === 'cci-order' && !checks.ocr.paragraphs.contiguous) attention(notes, 'numbering has a large gap');
    if (checks.ocr.lowDensity) attention(notes, 'under 600 characters per page');
    if (d.ocr_kind === 'bilingual-gazette' && checks.ocr.scripts.latinNoiseShare > 0.15) attention(notes, 'many Latin words do not look like English');
    if (notes.empty_pages?.length) attention(notes, `${notes.empty_pages.length} empty OCR page(s): ${notes.empty_pages.join(', ')}`);
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
      // The source is described only for actions that read it: a re-key or a cover strip read the stored text.
      provenance: {
        ...(d.source_url ? { source_url: d.source_url } : {}),
        ...(usesPdf(d) && d.source_sha256 ? { source_sha256: d.source_sha256 } : {}),
        ...(d.action === 'ocr' ? { ocr_model: OCR_MODEL } : {}),
      },
      metadataUpdates: SOURCE_LABEL[d.action] ? { ocr_lang: SOURCE_LABEL[d.action] } : null,
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
  const snapshotIssues = await checkSnapshots(work, docs);
  let bad = 0;
  for (const [i, d] of docs.entries()) {
    let entry;
    try {
      const mine = snapshotIssues.filter((p) => p.startsWith(`${d.prefix}:`));
      if (mine.length) throw new Error(mine.join('; '));
      entry = await buildOne(d, ctx);
    } catch (e) {
      // One document that cannot be built (no OCR cached yet, a changed snapshot) is a failed entry, not the end of the batch.
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
  say(`Review written to ${work.at('build', 'review.md')} (${entries.length} document(s), riskiest first) and ${work.at('build', 'review.json')}.`);
  say(`SHA-256 of build/review.json, which write --confirm must name: ${sha256(await readFile(work.at('build', 'review.json')))}`);
  if (bad) stop(`${bad} document(s) failed their checks`);
}

async function cmdRollbackBuild(ctx) {
  const { docs, work, manifestSha } = ctx;
  const issues = await checkSnapshots(work, docs);
  if (issues.length) stop(`the snapshots are not what prepare recorded:\n  ${issues.join('\n  ')}`);
  const review = { kind: 'rollback', manifest_sha256: manifestSha, built_at: nowIso(), documents: {} };
  for (const [i, d] of docs.entries()) {
    const snap = (await work.json('current', `${d.prefix}.json`)).document;
    const payload = await buildRollbackPayload(snap, { action: d.action });
    const text = `${JSON.stringify(payload, null, 2)}\n`;
    await work.save(['rollback', `${d.prefix}.payload.json`], text);
    review.documents[d.prefix] = { ok: true, action: d.action, payload_sha256: sha256(text), text_sha256: payload.metadata.text_sha256, title: payload.title, document_key: payload.metadata.document_key ?? null };
    say(`[${i + 1}/${docs.length}] ${d.prefix} ${d.action.padEnd(14)} restores ${clip(payload.title, 50)}  key=${payload.metadata.document_key ?? '-'}${d.action === 'retitle_unlink' ? '  (re-linked)' : ''}`);
  }
  await work.save(['rollback', 'review.json'], review);
  say(`Rollback payloads written to ${work.at('rollback')}. SHA-256 of rollback/review.json (write --rollback --confirm): ${sha256(await readFile(work.at('rollback', 'review.json')))}`);
}

// ---------------------------------------------------------------------------------------------
// 4. dry-run and 5. write
// ---------------------------------------------------------------------------------------------

async function loadPayload(work, dirs, prefix) {
  const file = work.at(dirs.build, `${prefix}.payload.json`);
  if (!existsSync(file)) return null;
  const text = await readFile(file, 'utf8');
  return { payload: JSON.parse(text), sha256: sha256(text) };
}

const resultLine = (prefix, r) => `${r.status.padEnd(9)} ${prefix}  chunks=${r.chunks} +${r.inserted} =${r.kept} -${r.deleted}  tokens=${r.embedded_tokens} usd=${r.cost_usd.toFixed(6)}${r.reason ? `  ${r.reason}` : ''}${r.error ? `  ERROR ${r.error}` : ''}`;

/** The row as it is now, for the drift check: a read-only GET of the columns the snapshot recorded. */
async function liveRow(get, d, snapshotId) {
  const { rows } = await get(documentQuery({ ...d, id: snapshotId }, DRIFT_COLUMNS));
  return rows.length === 1 ? rows[0] : null;
}

/** The embedding the chunks a dry run says are new would cost: the chunker's own token estimate, scaled by inserted / chunks. */
async function embeddingEstimate(items) {
  const rows = [];
  for (const it of items) rows.push({ prefix: it.prefix, rows: await chunkDocument(it.payload.ocr_text), chunks: it.dry.chunks, inserted: it.dry.inserted });
  return embedEstimate(rows, EMBED_PRICE_USD_PER_TOKEN);
}

async function cmdDryRun(ctx) {
  const { args, docs, work, manifestSha } = ctx;
  const dirs = stageDirs(args.rollback);
  const review = await work.json(dirs.build, 'review.json');
  if (!review || review.manifest_sha256 !== manifestSha) stop(`no reviewed ${dirs.build} for this manifest: run ${args.rollback ? 'rollback-build' : 'build'} first`);
  const cred = credentials(process.env);
  const get = makeReader(cred);
  let bad = 0;
  let skipped = 0;
  for (const [i, d] of docs.entries()) {
    if (review.documents[d.prefix]?.ok !== true) stop(`${d.prefix}: the reviewed build did not pass its checks`);
    const loaded = await loadPayload(work, dirs, d.prefix);
    if (!loaded || loaded.sha256 !== review.documents[d.prefix].payload_sha256) stop(`${d.prefix}: the payload file is not the reviewed one`);
    const done = await work.json(dirs.dryrun, `${d.prefix}.json`);
    if (!args.redo && done && done.payload_sha256 === loaded.sha256 && WRITABLE_DRY_STATUSES.includes(done.status)) {
      skipped++;
      continue;
    }
    // The row must still be the one prepare read. A document already written by this tool has moved on by design
    // (a rewrite): there is nothing of prepare's to compare it with.
    if (!args.rollback && !(await work.json(dirs.write, `${d.prefix}.json`))) {
      const snap = (await work.json('current', `${d.prefix}.json`)).document;
      const drift = driftProblems(snap, await liveRow(get, d, snap.id));
      if (drift.length) {
        await work.save([dirs.dryrun, `${d.prefix}.json`], { at: nowIso(), payload_sha256: loaded.sha256, status: 'drift', error: drift.join('; ') });
        say(`[${i + 1}/${docs.length}] DRIFT     ${d.prefix}  ${drift.join('; ')}`);
        bad++;
        continue;
      }
    }
    const r = await postIngest(cred, loaded.payload, true);
    await work.save([dirs.dryrun, `${d.prefix}.json`], { at: nowIso(), payload_sha256: loaded.sha256, ...r });
    say(`[${i + 1}/${docs.length}] ${resultLine(d.prefix, r)}`);
    if (!WRITABLE_DRY_STATUSES.includes(r.status)) bad++;
    await sleep(500);
  }
  if (skipped) say(`${skipped} document(s) already dry-run with this payload were skipped (--redo repeats them).`);
  if (bad) stop(`${bad} document(s) did not dry-run cleanly`);
  say('All dry runs were clean. Nothing was written.');
}

/** Prefixes of the selection already written (indexed or unchanged) with their current reviewed payload. */
async function writtenState(docs, work, dirs, review) {
  const written = new Set();
  const payloadShas = {};
  for (const d of docs) {
    const w = await work.json(dirs.write, `${d.prefix}.json`);
    if (w && ['indexed', 'unchanged'].includes(w.status)) {
      payloadShas[d.prefix] = w.payload_sha256;
      if (w.payload_sha256 === review?.documents?.[d.prefix]?.payload_sha256) written.add(d.prefix);
    }
  }
  return { written, payloadShas };
}

async function cmdWrite(ctx) {
  const { args, docs, work, manifestSha } = ctx;
  const dirs = stageDirs(args.rollback);
  const review = await work.json(dirs.build, 'review.json');
  const reviewSha = review ? sha256(await readFile(work.at(dirs.build, 'review.json'))) : null;
  const { written, payloadShas: writtenPayloadShas } = await writtenState(docs, work, dirs, review);
  const { batch, remaining } = nextBatch(docs, written, args.batch);
  if (!batch.length) {
    say('Nothing left to write: every selected document is written with its reviewed payload.');
    return;
  }

  const currentIds = {};
  const payloadShas = {};
  const textShas = {};
  const dryRuns = {};
  const payloads = {};
  for (const d of batch) {
    currentIds[d.prefix] = (await work.json('current', `${d.prefix}.json`))?.document?.id;
    const loaded = await loadPayload(work, dirs, d.prefix);
    payloadShas[d.prefix] = loaded?.sha256;
    textShas[d.prefix] = loaded ? sha256(loaded.payload.ocr_text) : undefined;
    payloads[d.prefix] = loaded?.payload;
    dryRuns[d.prefix] = await work.json(dirs.dryrun, `${d.prefix}.json`);
  }
  const problems = writeGateProblems({
    confirm: args.confirm, reviewSha, manifestSha, authorizedBy: args.authorizedBy, docs: batch, review, currentIds, payloadShas, textShas, dryRuns, written,
    writtenPayloadShas, rewrite: new Set(args.rewrite),
  });
  if (problems.length) {
    say('Refusing to write:');
    for (const p of problems) say(`  - ${p}`);
    process.exitCode = 2;
    return;
  }

  const cred = credentials(process.env);
  const get = makeReader(cred);
  const release = acquireLock(work);
  try {
    // Writer exclusivity: no ingestion job may hold a claim (corpus-jobs.md, project-wide writer exclusivity).
    const claims = liveClaimProblems((await get(ingestJobsQuery())).rows);
    if (claims.length) {
      say('Refusing to write:');
      for (const c of claims) say(`  - ${c}`);
      process.exitCode = 2;
      return;
    }
    // The embedding bill, before anything is posted.
    const est = await embeddingEstimate(batch.map((d) => ({ prefix: d.prefix, payload: payloads[d.prefix], dry: dryRuns[d.prefix] })));
    say(`Expected embedding cost of this batch: ${fmt(est.tokens)} tokens, USD ${est.usd.toFixed(4)} (the chunker's token estimate over the chunks the dry run says are new; cap ${args.maxEmbedUsd}).`);
    const capProblems = embedCapProblems(est, args.maxEmbedUsd);
    if (capProblems.length) {
      say('Refusing to write:');
      for (const c of capProblems) say(`  - ${c}`);
      process.exitCode = 2;
      return;
    }

    const number = nextBatchNumber(await work.json(dirs.write, 'batches.json'));
    const at = nowIso();
    const auth = (await work.json(dirs.write, 'authorization.json')) ?? { entries: [] };
    auth.entries.push({ at, batch: number, authorized_by: args.authorizedBy, review_sha256: reviewSha, prefixes: batch.map((d) => d.prefix) });
    await work.save([dirs.write, 'authorization.json'], auth);
    const mdFile = work.at(dirs.build, 'review.md');
    if (existsSync(mdFile)) await writeFile(mdFile, withAuthorization(await readFile(mdFile, 'utf8'), { authorizedBy: args.authorizedBy, at, reviewSha, batch: number }));

    say(`Writing batch ${number}: ${batch.length} document(s) of ${batch.length + remaining} pending to ${new URL(cred.url).host} (review ${reviewSha.slice(0, 12)}, authorized by: ${args.authorizedBy}):`);
    const refused = [];
    const wrote = [];
    for (const [i, d] of batch.entries()) {
      if (!args.rollback && !args.rewrite.includes(d.prefix)) {
        const snap = (await work.json('current', `${d.prefix}.json`)).document;
        const drift = driftProblems(snap, await liveRow(get, d, snap.id));
        if (drift.length) {
          say(`[${i + 1}/${batch.length}] REFUSED   ${d.prefix}  the row is not the snapshot: ${drift.join('; ')}`);
          refused.push(d.prefix);
          continue;
        }
      }
      const startedAt = nowIso();
      const r = await postIngest(cred, payloads[d.prefix], false);
      await work.save([dirs.write, `${d.prefix}.json`], { started_at: startedAt, at: nowIso(), batch: number, payload_sha256: payloadShas[d.prefix], ...r });
      say(`[${i + 1}/${batch.length}] ${resultLine(d.prefix, r)}`);
      if (!['indexed', 'unchanged'].includes(r.status)) stop(`${d.prefix}: ${r.status}; stopping. The rest of the batch was not written. Re-running write resumes here.`);
      wrote.push(d);
      await sleep(2000);
    }

    // The audit pause: readback of what this batch wrote, recorded, and then stop.
    say(`Batch ${number} written (${wrote.length}); reading it back:`);
    const results = await readbackDocs(wrote, { ...ctx, get, dirs });
    const log = addBatch(await work.json(dirs.write, 'batches.json'), { batch: number, at, authorized_by: args.authorizedBy, review_sha256: reviewSha, prefixes: batch.map((d) => d.prefix), written: wrote.map((d) => d.prefix), refused, readback_ok: results.every((x) => !x.problems.length) && !refused.length });
    await work.save([dirs.write, 'batches.json'], log);
    await work.save([dirs.readback, `batch-${number}.json`], { at: nowIso(), batch: number, results: results.map((x) => ({ prefix: x.prefix, problems: x.problems })) });
    const dirty = results.filter((x) => x.problems.length).length;
    if (refused.length || dirty) stop(`batch ${number}: ${refused.length} document(s) refused for drift, ${dirty} with a readback difference. Audit before another write.`);
    say(`Batch ${number} is clean. ${remaining} document(s) remain. Audit it (independent audit of the written documents, ANALYZE document_chunks, documents, desk_rows), then run write again for the next batch.`);
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------------------------
// 6. readback
// ---------------------------------------------------------------------------------------------

const READBACK_COLUMNS = 'id,title,content_sha256,indexed_at,chunker_version,document_key:metadata->>document_key,n_chars:metadata->>n_chars,file_url_ambiguous:metadata->>file_url_ambiguous';

/** Compares each document in NTER with its payload; saves readback/<prefix>.json; returns [{ prefix, problems }]. */
async function readbackDocs(docs, { work, get, dirs }) {
  const out = [];
  for (const [i, d] of docs.entries()) {
    const loaded = await loadPayload(work, dirs, d.prefix);
    if (!loaded) stop(`${d.prefix}: no built payload to compare with`);
    const written = await work.json(dirs.write, `${d.prefix}.json`);
    const dry = await work.json(dirs.dryrun, `${d.prefix}.json`);
    const planned = written ?? dry;
    if (!planned) stop(`${d.prefix}: no dry-run or write record to take the chunk count from`);
    const snapId = (await work.json('current', `${d.prefix}.json`))?.document?.id;
    const row = await retryRead(async () => {
      const { rows } = await get(documentQuery({ ...d, id: snapId ?? d.id }, READBACK_COLUMNS));
      return rows.length === 1 ? rows[0] : null;
    }, { sleep });
    const { total } = row ? await get(`document_chunks?select=id&document_id=eq.${row.id}`, { count: true }) : { total: null };
    const expected = {
      title: loaded.payload.title,
      document_key: loaded.payload.metadata.document_key ?? null,
      content_sha256: loaded.payload.metadata.text_sha256,
      n_chars: loaded.payload.metadata.n_chars,
      chunk_count: planned.chunks,
      chunker_version: 2,
      ...(d.action === 'retitle_unlink' && !dirs.build.startsWith('rollback') ? { file_url_ambiguous: true } : {}),
    };
    const problems = readbackProblems(expected, row ? { ...row, chunk_count: total } : null, { writtenAfter: readbackWrittenAfter(written) });
    await work.save([dirs.readback, `${d.prefix}.json`], { at: nowIso(), expected, actual: row ? { ...row, chunk_count: total } : null, problems });
    say(`[${i + 1}/${docs.length}] ${problems.length ? 'DIFF' : 'OK  '} ${d.prefix}  ${clip(row?.title ?? '(not found)', 48)}  key=${row?.document_key ?? '-'}  chunks=${total}  indexed_at=${row?.indexed_at ?? 'null'}`);
    for (const p of problems) say(`       ${p}`);
    out.push({ prefix: d.prefix, problems });
  }
  return out;
}

async function cmdReadback(ctx) {
  const { args, docs, work } = ctx;
  const get = makeReader(credentials(process.env));
  const results = await readbackDocs(docs, { work, get, dirs: stageDirs(args.rollback) });
  const bad = results.filter((r) => r.problems.length).length;
  if (bad) stop(`${bad} document(s) differ from the build`);
  say('Every document in NTER matches the build.');
}

// ---------------------------------------------------------------------------------------------

const COMMAND_FUNCTIONS = { prepare: cmdPrepare, pin: cmdPin, ocr: cmdOcr, build: cmdBuild, 'rollback-build': cmdRollbackBuild, 'dry-run': cmdDryRun, write: cmdWrite, readback: cmdReadback };
const USAGE = 'usage: node scripts/f281-repair/repair.mjs <prepare|pin|ocr|build|rollback-build|dry-run|write|readback> [--only <prefix> ...] [--manifest f] [--work-dir dir] [--env f] [--rollback]\n'
  + '       ocr [--go] [--max-usd N] [--pages-per-call N]   write --confirm <sha256 of build/review.json> --authorized-by "<text>" [--batch 20] [--max-embed-usd 1] [--rewrite <prefix>]\n'
  + '       prepare [--rows-only|--pdfs-only]   pin [--apply]   dry-run [--redo]\n'
  + 'Read the header of this file for the order of the steps and what each one touches.';

export async function main(argv = process.argv.slice(2), deps = {}) {
  if (deps.sleep) pause = deps.sleep;
  const args = parseArgs(argv);
  if (args.help || !args.command) {
    say(USAGE);
    process.exit(args.help ? 0 : 2);
  }
  const { manifest, sha256: manifestSha } = await loadManifest(path.resolve(args.manifest));
  const docs = selectDocuments(manifest, args.only);
  const needsKeys = ['dry-run', 'write', 'readback'].includes(args.command) || (args.command === 'prepare' && !args.pdfsOnly) || (args.command === 'ocr' && args.go);
  if (needsKeys) await loadDotEnv(path.resolve(args.env));
  const work = makeWork(path.resolve(args.workDir));
  await work.ensure();
  say(`F281 repair: ${args.command}${args.rollback ? ' (rollback)' : ''}, ${docs.length} document(s), manifest ${manifestSha.slice(0, 12)}, work ${work.at()}`);
  await COMMAND_FUNCTIONS[args.command]({ args, docs, work, manifest, manifestSha });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Stop ? `STOP: ${err.message}` : err.message);
    process.exit(1);
  });
}
