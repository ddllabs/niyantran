/** Client for the existing admin ingestion endpoint. See docs/operations/supplied-text-import.md. */
import { createReadStream } from 'node:fs';
import { mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareSuppliedText } from '../supabase/functions/_shared/suppliedText.ts';

const MAX_LINE = 8_000_000;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fileHash(path) {
  const h = createHash('sha256');
  for await (const b of createReadStream(path)) h.update(b);
  return h.digest('hex');
}
/** Bounds the line BEFORE parsing; readline alone can buffer an arbitrarily large corrupt line. */
export async function* jsonLines(path) {
  const source = createReadStream(path);
  const stream = path.endsWith('.gz') ? source.pipe(createGunzip()) : source;
  if (stream !== source) source.on('error', (e) => stream.destroy(e));
  let pending = Buffer.alloc(0);
  let line = 0;
  try {
    for await (const chunk of stream) {
      pending = Buffer.concat([pending, chunk]);
      let at;
      while ((at = pending.indexOf(10)) >= 0) {
        if (at > MAX_LINE) throw Error('record exceeds line limit');
        const bytes = pending.subarray(0, at);
        pending = pending.subarray(at + 1);
        line++;
        if (bytes.toString().trim()) {
          yield { line, record: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
        }
      }
      if (pending.length > MAX_LINE) throw Error('record exceeds line limit');
    }
    if (pending.length) {
      yield { line: line + 1, record: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(pending)) };
    }
  } finally {
    stream.destroy();
    source.destroy();
  }
}
function endpoint(target) {
  const u = new URL(target);
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/') {
    throw Error('target must be a bare Supabase project URL');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (
    !(local && u.protocol === 'http:') && !(u.protocol === 'https:' && /^[a-z0-9-]+\.supabase\.co$/.test(u.hostname))
  ) throw Error('target must be HTTPS Supabase or local HTTP');
  return u.origin + '/functions/v1/admin-ingest?input=supplied-text';
}
export async function runImport(options, request = fetch) {
  const { files, decisions, report, submit = false, approval, target, token, publishableKey } = options;
  if (!files?.length || !decisions || !report) throw Error('corpus, decisions and report paths required');
  if ((await stat(decisions)).size > 8_000_000) throw Error('decision manifest exceeds 8 MB');
  const decisionBytes = await readFile(decisions);
  const manifestHash = hash(decisionBytes);
  if (submit && approval !== manifestHash) throw Error('approval must equal the dry-run decision manifest SHA-256');
  const url = submit ? endpoint(target) : null;
  if (submit && (!token || !publishableKey || token.startsWith('sb_secret_'))) {
    throw Error('admin access token and publishable key required');
  }
  if (submit && token.split('.').length === 3) {
    let role;
    try {
      role = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).role;
    } catch {
      throw Error('invalid access token');
    }
    if (role !== 'authenticated') throw Error('use an authenticated admin session, not a service-role key');
  }
  const selected = new Map();
  for (const { record: d } of arrayLines(decisionBytes)) {
    if (typeof d.source_key !== 'string' || selected.has(d.source_key)) {
      throw Error('duplicate or missing decision source_key');
    }
    if (!/^[a-f0-9]{64}$/.test(d.file_sha256 ?? '') || !/^[a-f0-9]{64}$/.test(d.text_sha256 ?? '')) {
      throw Error('decision must bind file and text hashes');
    }
    selected.set(d.source_key, { decision: d, status: 'held', reason: 'source_not_found' });
    if (selected.size > 1000) throw Error('at most 1,000 source documents per invocation');
  }
  if (!selected.size) throw Error('empty decision manifest');
  // Complete all source reconciliation before the first network write. Spool bounded payloads to
  // private temporary files instead of retaining up to 1,000 large document texts in memory.
  const dir = await mkdtemp(join(tmpdir(), 'nter-text-import-'));
  let output;
  const summary = {
    manifest_sha256: manifestHash,
    selected: selected.size,
    ready: 0,
    held: 0,
    submitted: 0,
    uncertain: 0,
    registration_held: 0,
  };
  try {
    for (const file of files) {
      const sha = await fileHash(file);
      for await (const { record: r, line } of jsonLines(file)) {
        const entry = selected.get(r?.source_key);
        if (!entry) continue;
        const d = entry.decision;
        // File-specific selectors are essential: __full replacements and repeated members must
        // be resolved by the reviewed inventory, not whichever source appears first.
        if (d.file_sha256 !== sha) continue;
        if (entry.conflict) continue;
        try {
          if (r.text_sha256 !== d.text_sha256) throw Error('selected text revision mismatch');
          const p = await prepareSuppliedText({
            ...r,
            desk_feature: d.desk_feature,
            review: { ...d.review, file_sha256: d.file_sha256 },
          });
          if (entry.payload_sha256 && entry.payload_sha256 !== p.payload_sha256) {
            throw Error('conflicting source occurrences');
          }
          entry.payload_sha256 = p.payload_sha256;
          entry.chunks = p.chunks.length;
          entry.file_sha256 = sha;
          entry.line = line;
          entry.path = join(dir, hash(r.source_key) + '.json');
          await writeFile(entry.path, p.payload, { mode: 0o600 });
          entry.status = 'ready';
          entry.reason = null;
        } catch (e) {
          entry.status = 'held';
          entry.reason = e.message;
          entry.conflict = true;
        }
      }
      if (await fileHash(file) !== sha) throw Error('corpus file changed during scan');
    }
    const totalChunks = [...selected.values()].filter((e) => e.status === 'ready').reduce((n, e) => n + e.chunks, 0);
    const maxChunks = options.maxChunks ?? 10_000;
    if (!Number.isSafeInteger(maxChunks) || maxChunks < 1 || maxChunks > 800_000) {
      throw Error('max-chunks must be between 1 and 800000');
    }
    if (submit && totalChunks > maxChunks) throw Error('cohort exceeds max-chunks budget; split the reviewed manifest');
    summary.chunks = totalChunks;
    output = await open(report, 'wx', 0o600);
    const append = async (value) => {
      await output.write(JSON.stringify(value) + '\n');
      await output.sync();
    };
    await append({
      type: 'manifest',
      manifest_sha256: manifestHash,
      mode: submit ? 'submit' : 'offline-dry-run',
      target: submit ? new URL(url).origin : null,
    });
    let stopped = false;
    for (const [source_key, e] of selected) {
      if (e.status === 'held') summary.held++;
      else summary.ready++;
      const row = {
        source_key,
        status: e.status,
        reason: e.reason,
        payload_sha256: e.payload_sha256,
        chunks: e.chunks,
        file_sha256: e.file_sha256,
        line: e.line,
      };
      if (submit && e.status === 'ready') {
        if (stopped) {
          row.status = 'not_submitted';
          row.reason = 'earlier_request_uncertain_or_unauthorized';
        } else {
          // Persist intent BEFORE sending. A crash after this line requires rerunning the exact
          // manifest; registration itself is idempotent, with the DB as the authoritative ledger.
          await append({ ...row, status: 'submitting' });
          try {
            const record = JSON.parse(await readFile(e.path, 'utf8'));
            const response = await request(url, {
              method: 'POST',
              redirect: 'error',
              signal: AbortSignal.timeout(30_000),
              headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, apikey: publishableKey },
              body: JSON.stringify({ action: 'register_text', record, confirm_sha256: e.payload_sha256 }),
            });
            if (!response.ok) {
              row.status = [400, 413, 422].includes(response.status) ? 'held' : 'uncertain';
              row.reason = `HTTP ${response.status}`;
              if (row.status === 'held') summary.registration_held++;
              if (row.status === 'uncertain') {
                summary.uncertain++;
                stopped = true;
              }
            } else {
              const result = await response.json();
              if (!result.ok || !result.job_id || !result.document_id || result.payload_sha256 !== e.payload_sha256) {
                throw Error('unconfirmed registration');
              }
              row.status = 'registered';
              row.job_id = result.job_id;
              row.document_id = result.document_id;
              row.job_status = result.status;
              row.existing = result.existing;
              summary.submitted++;
            }
          } catch {
            row.status = 'uncertain';
            row.reason = 'registration outcome unknown; reconcile exact manifest';
            summary.uncertain++;
            stopped = true;
          }
        }
      }
      await append(row);
    }
    await append({ type: 'summary', ...summary });
    return summary;
  } finally {
    await output?.close();
    await rm(dir, { recursive: true, force: true });
  }
}
function arrayLines(bytes) {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes).split(/\r?\n/).filter((s) => s.trim()).map((s) => ({
    record: JSON.parse(s),
  }));
}
async function main() {
  const opts = {
    files: [],
    token: process.env.NTER_INGEST_ACCESS_TOKEN,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
  };
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(
      'node --experimental-strip-types scripts/corpus-text-import.mjs --corpus shard.jsonl.gz [--corpus ...] --decisions reviewed.jsonl --report new-report.jsonl [--submit --approval <manifest-sha256> --target https://PROJECT.supabase.co --max-chunks 10000]',
    );
    return;
  }
  const names = {
    '--decisions': 'decisions',
    '--report': 'report',
    '--approval': 'approval',
    '--target': 'target',
    '--max-chunks': 'maxChunks',
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--submit') opts.submit = true;
    else if (args[i] === '--corpus') opts.files.push(resolve(args[++i]));
    else if (names[args[i]]) {
      const name = names[args[i]];
      const value = args[++i];
      if (!value) throw Error('missing argument value');
      opts[name] = value;
    } else throw Error('unknown argument');
  }
  if (opts.maxChunks !== undefined) opts.maxChunks = Number(opts.maxChunks);
  const result = await runImport(opts);
  console.log(JSON.stringify(result));
  if (result.uncertain) process.exitCode = 2;
  else if (result.registration_held) process.exitCode = 3;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error(
      'Import stopped. Check arguments, input validation and the report; no automatic retry was attempted.',
    );
    process.exitCode = 1;
  });
}
