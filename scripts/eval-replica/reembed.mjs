/**
 * Re-embed existing chunks WITH the contextual header, on a local rehearsal copy
 * (docs/plans/2026-11-04-hybrid-and-contextual-retrieval.md, task T5; decision D1: headers come from stored
 * metadata, no model call).
 *
 *   npx vite-node --config vitest.config.js scripts/eval-replica/reembed.mjs -- \
 *     --source niyantran_rehearsal_b9final --target niyantran_rehearsal_c2headers \
 *     [--features nclt,bill] [--max-usd 3] [--dry-run] [--no-load] [--limit N] [--concurrency 3] \
 *     [--index auto|rebuild|keep] [--out <vector file>]
 *
 * Runs through vite-node because it imports the worker's TypeScript (chunkHeader.ts, textNormalise.ts, embed.ts), so
 * the header, the hash and the request constants are the worker's own, not copies. Needs Docker (run outside the Claude
 * Code sandbox) and, unless --dry-run, OPENROUTER_API_KEY in the environment or in .env.local beside package.json.
 *
 * What it does, in order:
 *  1. Reads the SOURCE (read only: the session is opened with default_transaction_read_only) in the
 *     niyantran-corpus-test-db container: every document of the chosen features, then their chunks, streamed.
 *  2. Builds each chunk's embedding input with `embeddingInput` below and its embed_hash. The rule, and why, is the
 *     comment above that function. --dry-run stops here: it counts chunks and tokens per feature (the worker's own
 *     four-characters-a-token estimate), prices them, and calls nothing.
 *  3. Embeds in batches through OpenRouter (the request production sends: openai/text-embedding-3-small, float
 *     encoding, the model and the 1536 width checked on every response; plus usage accounting so the cost is the
 *     reported cost). 429 and 5xx are retried with backoff. Before each batch it reserves the batch's estimated cost
 *     (scaled by the worst estimate error seen so far) and stops, rather than start a batch that could pass
 *     --max-usd (default 3). Every finished batch is appended to the VECTOR FILE, which is also the checkpoint: a
 *     rerun skips every chunk whose id and embed_hash are already in it, so nothing is paid for twice.
 *  4. The vector file (default $TMPDIR/<target>-headers.vec, refused inside the repository) is the reuse export:
 *     a 48-byte header, then fixed 6,192-byte records: chunk id (16 bytes), embed_hash (32 bytes, SHA-256), the
 *     vector (1,536 little-endian float32). Production loads vectors by embed_hash equality. `readVectorFile` reads it.
 *  5. Only when every selected chunk has a vector, loads the TARGET (a niyantran_rehearsal_* database, enforced before
 *     anything else): the vectors go into an unlogged staging table by binary COPY, then ONE set-based UPDATE sets
 *     `embedding` (and `embed_hash` when the column exists), matched on id, desk_feature and chunk_hash; content and
 *     chunk_hash are never written. The HNSW indexes are dropped before the update and recreated after it has committed
 *     and a vacuum has removed the old row versions (--index rebuild, the default when the load touches a quarter of the
 *     table or more; --index keep updates them in place), so a failure between the two leaves the vectors loaded and the
 *     indexes missing. The table is then vacuumed and analysed. Every step is timed and printed. A run stopped by
 *     the ceiling, --limit or an error loads nothing: a half re-embedded feature would make the measurement meaningless.
 *
 * Prints only counts, timings and cost. Never prints the key, a vector or chunk text.
 */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, fstatSync, ftruncateSync, openSync, readFileSync, readSync, writeSync } from 'node:fs';
import { endianness, tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRehearsalDatabase, assertSourceDatabase } from '../../src/lib/rehearsal.js';
import { buildChunkHeader, chunkHeaderPrefix } from '../../supabase/functions/_shared/chunkHeader.ts';
import { normalise, sha256Hex } from '../../supabase/functions/_shared/textNormalise.ts';
import { EMBED_BATCH, EMBED_DIMS, EMBED_MODEL, EMBED_PRICE_USD_PER_TOKEN, EMBED_URL, servedModelMatches } from '../../supabase/functions/_shared/embed.ts';
import { CONTAINER, freeBytes } from './rehearsal-db.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MAX_USD = 3;

// ---- the embedding input -----------------------------------------------------------------------------------------

/**
 * The section label the worker put in front of a chunk's text, from the `section` the chunk row keeps in
 * metadata.section ({heading, note}): `heading › note`, or whichever one exists, then a blank line. This is the
 * worker's own rule (textContext.ts chunkTextWithContext, 99.97% of stored chunks; chunking.ts sectionPrefix for the
 * 121 page-chunker rows agrees unless a heading is the empty string).
 */
export function sectionPrefix(section) {
  if (!section || typeof section !== 'object' || Array.isArray(section)) return '';
  const label = [section.heading, section.note].filter((v) => typeof v === 'string' && v !== '').join(' › ');
  return label ? `${label}\n\n` : '';
}

/**
 * THE RULE for a chunk that already exists (production's backfill, T9, must call this same function):
 *
 *     embedding input = chunkHeaderPrefix(header) + sectionPrefix(chunk.metadata.section) + chunk.content
 *
 * Why this and not "content": the stored vectors were made from the worker's embedding_input, which is the section
 * label plus the text (textContext.ts line "bare"), not from the bare text. The input itself is not stored (no
 * embedding_input column; embed_hash is empty on the rehearsal copies), so it is rebuilt from what is stored. The
 * header goes first, as the worker puts it (`headerPrefix + bare`). With an empty header the result is exactly the
 * input the vector was originally made from, which is what makes "headers off" an honest arm.
 *
 * One part cannot be rebuilt: the header row of a table that a chunk starts in the middle of (tableHeaderPrefix),
 * which the worker added from the whole document's text. Such a chunk's input here lacks those lines, so its hash
 * differs from the one the worker would compute and production will not reuse its vector (it is embedded afresh).
 * A wrong hash can only cause a miss, never a wrong reuse.
 */
export function embeddingInput({ header, section, content }) {
  return chunkHeaderPrefix(header) + sectionPrefix(section) + content;
}

/** embed_hash as the worker computes it: SHA-256 hex of the whitespace-normalised input. */
export const chunkEmbedHash = (input) => sha256Hex(normalise(input));

/** The worker's own estimate (embed.ts): four characters a token. */
export const estimateTokens = (text) => Math.ceil(text.length / 4);

// ---- options, names, features ---------------------------------------------------------------------------------------

/** The outermost directory above `from` that looks like a repository checkout (a worktree sits inside the main one). */
function outermostRepoRoot(from) {
  let found = null;
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'AGENTS.md')) && existsSync(join(dir, 'package.json'))) found = dir;
    if (dirname(dir) === dir) return found ?? resolve(from, '..', '..');
  }
}

const INDEX_MODES = ['auto', 'rebuild', 'keep'];

export function parseArgs(argv, { tmpdir: tmp = tmpdir(), repoRoot = outermostRepoRoot(HERE) } = {}) {
  const o = { source: undefined, target: undefined, features: undefined, maxUsd: DEFAULT_MAX_USD, dryRun: false, noLoad: false, out: undefined, concurrency: 3, limit: Infinity, indexMode: 'auto' };
  const value = (i, name) => {
    if (i >= argv.length || argv[i].startsWith('--')) throw new Error(`${name} needs a value`);
    return argv[i];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') o.source = value(++i, a);
    else if (a === '--target') o.target = value(++i, a);
    else if (a === '--features') o.features = value(++i, a);
    else if (a === '--max-usd') {
      o.maxUsd = Number(value(++i, a));
      if (!Number.isFinite(o.maxUsd) || o.maxUsd <= 0) throw new Error('--max-usd must be a positive number of US dollars');
    } else if (a === '--concurrency') {
      o.concurrency = Number(value(++i, a));
      if (!Number.isInteger(o.concurrency) || o.concurrency < 1 || o.concurrency > 16) throw new Error('--concurrency must be a whole number from 1 to 16');
    } else if (a === '--limit') {
      o.limit = Number(value(++i, a));
      if (!Number.isInteger(o.limit) || o.limit < 1) throw new Error('--limit must be a positive whole number');
    } else if (a === '--index') {
      o.indexMode = value(++i, a);
      if (!INDEX_MODES.includes(o.indexMode)) throw new Error(`--index must be one of ${INDEX_MODES.join(', ')}`);
    } else if (a === '--out') o.out = resolve(value(++i, a));
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--no-load') o.noLoad = true;
    else throw new Error(`unknown option ${a}`);
  }
  if (!o.source) throw new Error('--source <database> is required');
  if (!o.target && !o.dryRun && !o.noLoad) throw new Error('--target <niyantran_rehearsal_...> is required (or use --dry-run or --no-load)');
  o.out ??= join(tmp, `${o.target ?? o.source}-headers.vec`);
  const inside = resolve(o.out) === repoRoot || resolve(o.out).startsWith(repoRoot + sep);
  if (inside) throw new Error(`--out ${o.out} is inside the repository (${repoRoot}); the vector file is large and must stay outside it`);
  return o;
}

/**
 * Which databases may be read and written. The source is read only and may be the replica or a rehearsal copy; the
 * target must be a niyantran_rehearsal_ database and may not be the source. runReembed calls this before it opens a
 * connection. Only the self-test passes another policy, for its one throwaway database.
 */
export const DEFAULT_POLICY = {
  check({ source, target, needTarget = true }) {
    assertSourceDatabase(source);
    if (needTarget || (target !== undefined && target !== null)) assertRehearsalDatabase(target);
    if (target !== undefined && target !== null && source === target) throw new Error('the source and the target are the same database');
  },
};

/** --features is a comma list; each word is a case-insensitive part of a feature name ("nclt", "bill", "question"). */
export function resolveFeatures(arg, available) {
  if (arg === undefined || arg === null || arg === '') return [...available];
  const words = String(arg).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const wanted = new Set();
  for (const w of words) {
    const hits = available.filter((f) => f.toLowerCase().includes(w));
    if (!hits.length) throw new Error(`--features: "${w}" matches no feature (available: ${available.join('; ')})`);
    hits.forEach((h) => wanted.add(h));
  }
  return available.filter((f) => wanted.has(f));
}

// ---- the embeddings request ---------------------------------------------------------------------------------------

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_ATTEMPTS = 5;

/**
 * Production's request (embed.ts: model, `encoding_format: 'float'`, no `dimensions`, inputs clamped to the same
 * length) plus `usage: {include: true}`, so OpenRouter reports the cost (build-eval-set.mjs does the same). The served
 * model and the 1536 width are checked on every response before a vector is used.
 */
export function makeOpenRouterEmbedder({ apiKey, fetch: fetchFn = globalThis.fetch, sleep = defaultSleep }) {
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set: put it in the environment or in .env.local beside package.json');
  const maxChars = EMBED_BATCH.maxInputTokens * 4;
  return async function embed(inputs) {
    const batch = inputs.map((s) => (s.length > maxChars ? s.slice(0, maxChars) : s));
    let status = 0;
    let message = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let res;
      try {
        res = await fetchFn(EMBED_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'http-referer': 'https://niyantran.ai', 'x-title': 'Niyantran Terminal' },
          body: JSON.stringify({ model: EMBED_MODEL, input: batch, encoding_format: 'float', usage: { include: true } }),
        });
      } catch (error) {
        status = 0;
        message = `network error: ${error.message}`;
        if (attempt < MAX_ATTEMPTS) await sleep(Math.min(30_000, 1000 * 2 ** (attempt - 1)));
        continue;
      }
      status = res.status;
      const payload = (await res.json().catch(() => ({}))) ?? {};
      if (status === 429 || status >= 500) {
        message = String(payload?.error?.message ?? `HTTP ${status}`);
        const hint = Number(res.headers?.get?.('retry-after'));
        if (attempt < MAX_ATTEMPTS) await sleep(Math.min(60_000, Math.max(Number.isFinite(hint) ? hint * 1000 : 0, 1000 * 2 ** (attempt - 1))));
        continue;
      }
      if (!res.ok) throw new Error(`embeddings HTTP ${status}: ${String(payload?.error?.message ?? 'no detail')}`);
      const model = typeof payload.model === 'string' ? payload.model : '';
      if (!servedModelMatches(model)) throw new Error(`embeddings served by ${model || 'an unnamed model'}, expected ${EMBED_MODEL}`);
      const data = Array.isArray(payload.data) ? payload.data : [];
      if (data.length !== batch.length) throw new Error(`embeddings returned ${data.length} vectors for ${batch.length} inputs`);
      const vectors = new Array(batch.length);
      for (const item of data) {
        const idx = typeof item.index === 'number' ? item.index : -1;
        if (idx < 0 || idx >= batch.length || !Array.isArray(item.embedding) || vectors[idx]) throw new Error('embeddings response item is malformed');
        if (item.embedding.length !== EMBED_DIMS) throw new Error(`embedding width ${item.embedding.length}, expected ${EMBED_DIMS}`);
        vectors[idx] = Float32Array.from(item.embedding);
      }
      const promptTokens = Number(payload.usage?.prompt_tokens);
      const tokens = Number.isFinite(promptTokens) ? promptTokens : 0;
      const reported = payload.usage?.cost;
      const costUsd = typeof reported === 'number' && Number.isFinite(reported) && reported >= 0 ? reported : tokens * EMBED_PRICE_USD_PER_TOKEN;
      return { vectors, model, promptTokens: tokens, costUsd };
    }
    throw new Error(`embeddings HTTP ${status} after ${MAX_ATTEMPTS} attempts: ${message}`);
  };
}

/** The key from the environment, else from .env.local beside package.json. Read only when something must be embedded. */
export function resolveApiKey(env = process.env, root = outermostRepoRoot(HERE)) {
  if (env.OPENROUTER_API_KEY) return env.OPENROUTER_API_KEY;
  for (const dir of [root, resolve(HERE, '..', '..')]) {
    const file = join(dir, '.env.local');
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*OPENROUTER_API_KEY\s*=\s*(.*)$/.exec(line);
      if (m) return m[1].trim().replace(/^(["'])(.*)\1$/, '$2');
    }
  }
  return '';
}

// ---- the vector file ----------------------------------------------------------------------------------------------

const MAGIC = Buffer.from('NTRVEC01', 'latin1');
const FILE_HEADER_BYTES = 48;
const VECTOR_BYTES = 4 * EMBED_DIMS;
export const VECTOR_RECORD_BYTES = 16 + 32 + VECTOR_BYTES;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;

const uuidBytes = (id) => Buffer.from(id.replace(/-/g, ''), 'hex');
const uuidText = (b) => {
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

function fileHeader() {
  const h = Buffer.alloc(FILE_HEADER_BYTES);
  MAGIC.copy(h, 0);
  h.writeUInt32LE(EMBED_DIMS, 8);
  h.writeUInt32LE(VECTOR_RECORD_BYTES, 12);
  h.write(EMBED_MODEL, 16, 32, 'latin1');
  return h;
}

/**
 * Open (creating it if absent) the append-only vector file that is both the checkpoint and the reuse export. A last
 * record torn by a crash is cut off, so it is embedded again. A file that is not ours is refused and left alone.
 */
export function openVectorFile(path) {
  if (endianness() !== 'LE') throw new Error('the vector file is little-endian float32; this machine is big-endian');
  const fresh = !existsSync(path) || fstatSizeOf(path) === 0;
  const fd = openSync(path, fresh ? 'w+' : 'r+');
  try {
    if (fresh) writeSync(fd, fileHeader());
    else {
      const head = Buffer.alloc(FILE_HEADER_BYTES);
      const got = readSync(fd, head, 0, FILE_HEADER_BYTES, 0);
      if (got < FILE_HEADER_BYTES || !head.subarray(0, 8).equals(MAGIC) || head.readUInt32LE(8) !== EMBED_DIMS || head.readUInt32LE(12) !== VECTOR_RECORD_BYTES) {
        throw new Error(`${path} is not a vector file of this tool (dimension ${EMBED_DIMS}); refusing to touch it`);
      }
    }
    const size = fstatSync(fd).size;
    const whole = Math.floor((size - FILE_HEADER_BYTES) / VECTOR_RECORD_BYTES);
    if ((size - FILE_HEADER_BYTES) % VECTOR_RECORD_BYTES !== 0) ftruncateSync(fd, FILE_HEADER_BYTES + whole * VECTOR_RECORD_BYTES);
    const done = new Set();
    const key = Buffer.alloc(48);
    for (let i = 0; i < whole; i++) {
      readSync(fd, key, 0, 48, FILE_HEADER_BYTES + i * VECTOR_RECORD_BYTES);
      done.add(`${uuidText(key.subarray(0, 16))}:${key.subarray(16, 48).toString('hex')}`);
    }
    let records = whole;
    return {
      path,
      get count() { return records; },
      has: (id, hash) => done.has(`${id}:${hash}`),
      /** Appends whole records in one write. Each is {id, hash, vector}. */
      append(recs) {
        if (!recs.length) return;
        const buf = Buffer.alloc(recs.length * VECTOR_RECORD_BYTES);
        recs.forEach((r, i) => {
          if (!UUID.test(r.id) || !SHA256.test(r.hash)) throw new Error('vector record needs a uuid id and a SHA-256 hex hash');
          if (r.vector.length !== EMBED_DIMS) throw new Error(`embedding width ${r.vector.length}, expected ${EMBED_DIMS}`);
          const at = i * VECTOR_RECORD_BYTES;
          uuidBytes(r.id).copy(buf, at);
          Buffer.from(r.hash, 'hex').copy(buf, at + 16);
          const f = r.vector instanceof Float32Array ? r.vector : Float32Array.from(r.vector);
          Buffer.from(f.buffer, f.byteOffset, f.byteLength).copy(buf, at + 48);
        });
        writeSync(fd, buf, 0, buf.length, FILE_HEADER_BYTES + records * VECTOR_RECORD_BYTES);
        records += recs.length;
        for (const r of recs) done.add(`${r.id}:${r.hash}`);
      },
      close: () => closeSync(fd),
    };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function fstatSizeOf(path) {
  const fd = openSync(path, 'r');
  try {
    return fstatSync(fd).size;
  } finally {
    closeSync(fd);
  }
}

/** Every whole record of a vector file, in file order, as {id, hash, vector: Float32Array}. */
export async function* readVectorFile(path) {
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(FILE_HEADER_BYTES);
    if (readSync(fd, head, 0, FILE_HEADER_BYTES, 0) < FILE_HEADER_BYTES || !head.subarray(0, 8).equals(MAGIC)) throw new Error(`${path} is not a vector file of this tool`);
    const whole = Math.floor((fstatSync(fd).size - FILE_HEADER_BYTES) / VECTOR_RECORD_BYTES);
    const PER_READ = 256;
    const buf = Buffer.alloc(PER_READ * VECTOR_RECORD_BYTES);
    for (let i = 0; i < whole; i += PER_READ) {
      const n = Math.min(PER_READ, whole - i);
      readSync(fd, buf, 0, n * VECTOR_RECORD_BYTES, FILE_HEADER_BYTES + i * VECTOR_RECORD_BYTES);
      for (let k = 0; k < n; k++) {
        const at = k * VECTOR_RECORD_BYTES;
        const vector = new Float32Array(EMBED_DIMS);
        Buffer.from(vector.buffer).set(buf.subarray(at + 48, at + VECTOR_RECORD_BYTES));
        yield { id: uuidText(buf.subarray(at, at + 16)), hash: buf.subarray(at + 16, at + 48).toString('hex'), vector };
      }
    }
  } finally {
    closeSync(fd);
  }
}

// ---- the embedding loop -------------------------------------------------------------------------------------------

/**
 * Embed `items` ({id, hash, input}), skipping those already in `store`, in batches within production's bounds, up to
 * `concurrency` batches at a time, and append each finished batch to `store`.
 *
 * Spend: before a batch starts, its estimated cost is reserved, scaled by the largest ratio of reported cost to
 * estimate seen so far (1.25 until one batch has been measured, and the first batch runs alone for that reason). A
 * batch that would take spent plus reserved past `maxUsd` waits for the batches in flight, and if it still does not
 * fit, the loop stops with stoppedBy 'ceiling'. stoppedBy is 'complete', 'ceiling', 'limit' (--limit chunks embedded)
 * or an error: a failed batch lets the others finish, keeps what was stored, and throws with `.summary`.
 */
export async function embedAll({ items, embed, store, maxUsd, concurrency = 3, limit = Infinity, log = () => {}, bounds = EMBED_BATCH, price = EMBED_PRICE_USD_PER_TOKEN }) {
  const maxChars = bounds.maxInputTokens * 4;
  const state = { embedded: 0, skippedDone: 0, spentUsd: 0, promptTokens: 0, requests: 0, stoppedBy: 'complete' };
  let reserved = 0;
  let worstRatio = null;
  let failure = null;
  let queued = 0;
  let pending = [];
  let pendingTokens = 0;
  const inflight = new Set();
  const safety = () => (worstRatio === null ? 1.25 : worstRatio * 1.02);

  async function dispatch() {
    const batch = pending;
    const tokens = pendingTokens;
    pending = [];
    pendingTokens = 0;
    for (;;) {
      if (failure) return false;
      const est = tokens * price * safety();
      const slot = inflight.size < concurrency && (worstRatio !== null || inflight.size === 0);
      const fits = state.spentUsd + reserved + est <= maxUsd;
      if (slot && fits) break;
      if (inflight.size === 0) {
        state.stoppedBy = 'ceiling';
        return false;
      }
      await Promise.race(inflight);
    }
    const est = tokens * price * safety();
    reserved += est;
    const run = (async () => {
      try {
        const res = await embed(batch.map((b) => b.input));
        if (!Array.isArray(res.vectors) || res.vectors.length !== batch.length) throw new Error(`embedder returned ${res.vectors?.length} vectors for ${batch.length} inputs`);
        for (const v of res.vectors) if (v.length !== EMBED_DIMS) throw new Error(`embedding width ${v.length}, expected ${EMBED_DIMS}`);
        store.append(batch.map((b, i) => ({ id: b.id, hash: b.hash, vector: res.vectors[i] })));
        const cost = Number.isFinite(res.costUsd) && res.costUsd > 0 ? res.costUsd : (res.promptTokens || 0) * price;
        const base = tokens * price;
        const ratios = [cost / base, (res.promptTokens || 0) / tokens].filter((r) => Number.isFinite(r) && r > 0);
        if (ratios.length) worstRatio = Math.max(worstRatio ?? 0, ...ratios);
        else worstRatio ??= 1;
        state.embedded += batch.length;
        state.spentUsd += cost;
        state.promptTokens += res.promptTokens || 0;
        state.requests += 1;
        if (state.requests % 25 === 0) log(`  ${state.embedded.toLocaleString('en-US')} chunks embedded, US$${state.spentUsd.toFixed(4)} spent`);
      } catch (error) {
        failure ??= error;
      } finally {
        reserved -= est;
        inflight.delete(run);
      }
    })();
    inflight.add(run);
    return true;
  }

  let go = true;
  for await (const item of items) {
    if (failure) break;
    if (store.has(item.id, item.hash)) {
      state.skippedDone++;
      continue;
    }
    if (queued >= limit) {
      state.stoppedBy = 'limit';
      break;
    }
    const input = item.input.length > maxChars ? item.input.slice(0, maxChars) : item.input;
    const t = estimateTokens(input);
    if (pending.length && (pending.length >= bounds.maxCount || pendingTokens + t > bounds.maxTokens)) {
      if (!(await dispatch())) {
        go = false;
        break;
      }
    }
    pending.push({ id: item.id, hash: item.hash, input });
    pendingTokens += t;
    queued++;
  }
  if (go && pending.length && !failure) await dispatch();
  await Promise.all(inflight);
  if (failure) {
    failure.summary = state;
    throw failure;
  }
  return state;
}

// ---- binary COPY ------------------------------------------------------------------------------------------------

const i16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n);
  return b;
};
const i32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
};
const field = (bytes) => Buffer.concat([i32(bytes.length), bytes]);
const NULL_FIELD = i32(-1);

/** One row of the staging table in PostgreSQL's binary COPY format: (id uuid, desk_feature text, chunk_hash text, embed_hash text, embedding vector). */
export function copyRow({ id, desk_feature, chunk_hash, embed_hash, vector }) {
  const v = Buffer.alloc(4 + VECTOR_BYTES);
  v.writeInt16BE(EMBED_DIMS, 0);
  const floats = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).subarray(0, VECTOR_BYTES);
  floats.copy(v, 4);
  v.subarray(4).swap32();
  return Buffer.concat([
    i16(5),
    field(uuidBytes(id)),
    desk_feature === null || desk_feature === undefined ? NULL_FIELD : field(Buffer.from(desk_feature, 'utf8')),
    field(Buffer.from(chunk_hash, 'utf8')),
    field(Buffer.from(embed_hash, 'utf8')),
    field(v),
  ]);
}

/** The whole COPY stream for `rows` (an async or sync iterable of copyRow inputs), in pieces of about 4 MB. */
export async function* copyBinary(rows) {
  yield Buffer.concat([Buffer.from('PGCOPY\n\xff\r\n\0', 'latin1'), i32(0), i32(0)]);
  let parts = [];
  let size = 0;
  for await (const r of rows) {
    const b = copyRow(r);
    parts.push(b);
    size += b.length;
    if (size >= 4 << 20) {
      yield Buffer.concat(parts);
      parts = [];
      size = 0;
    }
  }
  parts.push(i16(-1));
  yield Buffer.concat(parts);
}

// ---- psql in the corpus container ---------------------------------------------------------------------------------

function dockerArgs(database, readOnly, extra) {
  return ['exec', '-i', ...(readOnly ? ['-e', 'PGOPTIONS=-c default_transaction_read_only=on'] : []), CONTAINER, 'psql', '-U', 'postgres', '-d', database, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', ...extra];
}

const quoteLiteral = (s) => `'${String(s).replace(/'/g, "''")}'`;
const quoteIdent = (s) => `"${String(s).replace(/"/g, '""')}"`;
const featureList = (features) => `array[${features.map(quoteLiteral).join(', ')}]::text[]`;

/** Runs psql to completion. `input` may be a string, or an (async) iterable of Buffers written with backpressure. */
function psqlRun(database, { sql, input, readOnly = false, single = false }) {
  return new Promise((resolvePromise, reject) => {
    const args = dockerArgs(database, readOnly, [...(single ? ['--single-transaction'] : []), ...(sql ? ['-c', sql] : [])]);
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (d) => (out += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (err = (err + d).slice(-4000)));
    child.on('error', (e) => reject(new Error(`could not run docker (is it on PATH, and are you outside the sandbox?): ${e.message}`)));
    child.on('close', (code) => (code === 0 ? resolvePromise(out.trim()) : reject(new Error(`psql (${database}) failed: ${err || out}`))));
    child.stdin.on('error', () => {});
    (async () => {
      if (input === undefined || typeof input === 'string') child.stdin.end(input ?? '');
      else {
        for await (const piece of input) {
          if (!child.stdin.write(piece)) await new Promise((r) => child.stdin.once('drain', r));
        }
        child.stdin.end();
      }
    })().catch((e) => {
      child.kill();
      reject(e);
    });
  });
}

/** Rows of one text column, one per line, streamed. The session is read-only when asked. */
async function* psqlLines(database, sql, { readOnly }) {
  const child = spawn('docker', dockerArgs(database, readOnly, ['-v', 'FETCH_COUNT=2000', '-c', sql]), { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.setEncoding('utf8').on('data', (d) => (err = (err + d).slice(-4000)));
  const closed = new Promise((res, rej) => {
    child.on('error', (e) => rej(new Error(`could not run docker (is it on PATH, and are you outside the sandbox?): ${e.message}`)));
    child.on('close', res);
  });
  closed.catch(() => {});
  try {
    // Split on "\n" only: readline also splits on U+2028, U+2029 and a lone "\r", which json_build_object leaves raw inside strings.
    child.stdout.setEncoding('utf8');
    let rest = '';
    for await (const piece of child.stdout) {
      rest += piece;
      let at;
      while ((at = rest.indexOf('\n')) !== -1) {
        const line = rest.slice(0, at);
        rest = rest.slice(at + 1);
        if (line) yield line;
      }
    }
    if (rest) yield rest;
    const code = await closed;
    if (code !== 0) throw new Error(`psql (${database}) failed: ${err}`);
  } finally {
    if (child.exitCode === null) child.kill();
  }
}

/** The source, read only. features() -> [{feature}], documents(features) -> rows, chunks(features) -> async rows. */
export function makeDockerSource(database) {
  return {
    async features() {
      const rows = [];
      for await (const l of psqlLines(database, "select json_build_object('feature', desk_feature)::text from (select distinct desk_feature from public.documents where desk_feature is not null order by 1) t", { readOnly: true })) rows.push(JSON.parse(l));
      return rows;
    },
    async documents(features) {
      const rows = [];
      for await (const l of psqlLines(database, `select json_build_object('id', id, 'title', title, 'desk_tier', desk_tier, 'desk_feature', desk_feature, 'metadata', metadata)::text from public.documents where desk_feature = any(${featureList(features)})`, { readOnly: true })) rows.push(JSON.parse(l));
      return rows;
    },
    async *chunks(features) {
      const sql = `select json_build_object('id', c.id, 'document_id', c.document_id, 'desk_feature', to_jsonb(c)->>'desk_feature', 'chunk_hash', c.chunk_hash, 'section', c.metadata->'section', 'content', c.content)::text
        from public.document_chunks c join public.documents d on d.id = c.document_id where d.desk_feature = any(${featureList(features)})`;
      for await (const l of psqlLines(database, sql, { readOnly: true })) yield JSON.parse(l);
    },
  };
}

const ms = (n) => (n < 1000 ? `${n.toFixed(0)} ms` : n < 120_000 ? `${(n / 1000).toFixed(1)} s` : `${(n / 60_000).toFixed(1)} min`);

/** Parses `\echo @@label` markers and psql `\timing` lines from one script's output into {label: milliseconds}. */
export function parseTimings(output) {
  const t = {};
  let label = null;
  for (const line of output.split('\n')) {
    const mark = /^@@(\w+)/.exec(line);
    if (mark) label = mark[1];
    const time = /^Time: ([\d.]+) ms/.exec(line);
    if (time && label) t[label] = (t[label] ?? 0) + Number(time[1]);
  }
  return t;
}

/** The target (a rehearsal copy). load() puts the vectors in with one set-based update and rebuilds the HNSW indexes. */
export function makeDockerTarget(database) {
  const q = (sql) => psqlRun(database, { sql });
  const timed = async (fn) => {
    const t0 = performance.now();
    const value = await fn();
    return { value, ms: performance.now() - t0 };
  };

  return {
    async load({ rows, expected, indexMode = 'auto', log = () => {} }) {
      const info = JSON.parse(
        await q(`select json_build_object(
          'embedHash', exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'document_chunks' and column_name = 'embed_hash'),
          'deskFeature', exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'document_chunks' and column_name = 'desk_feature'),
          'vectorType', (select format_type(atttypid, atttypmod) from pg_attribute where attrelid = 'public.document_chunks'::regclass and attname = 'embedding' and not attisdropped),
          'rows', (select count(*) from public.document_chunks),
          'dataDirectory', current_setting('data_directory'),
          'indexes', coalesce((select json_agg(json_build_object('name', c.relname, 'def', pg_get_indexdef(i.indexrelid),
              'parent', (select p.relname from pg_inherits h join pg_class p on p.oid = h.inhparent where h.inhrelid = c.oid)) order by c.relname)
            from pg_index i join pg_class c on c.oid = i.indexrelid join pg_class t on t.oid = i.indrelid join pg_am am on am.oid = c.relam
            where am.amname in ('hnsw', 'ivfflat')
              and (t.oid = 'public.document_chunks'::regclass or t.oid in (select relid from pg_partition_tree('public.document_chunks')))), '[]'::json)
        )::text`),
      );
      if (!/vector\(1536\)$/.test(info.vectorType ?? '')) throw new Error(`target document_chunks.embedding is ${info.vectorType}, expected vector(1536)`);
      const need = expected * (VECTOR_RECORD_BYTES + 300) * 3 + (1 << 30);
      const free = await freeBytes(info.dataDirectory);
      if (free < need) throw new Error(`the container has ${(free / 2 ** 30).toFixed(1)} GiB free, the load needs about ${(need / 2 ** 30).toFixed(1)} GiB (staging, the updated rows, WAL)`);

      const rebuild = info.indexes.length > 0 && (indexMode === 'rebuild' || (indexMode === 'auto' && expected >= 0.25 * info.rows));
      log(`target: ${info.rows.toLocaleString('en-US')} chunks; ${expected.toLocaleString('en-US')} vectors to load; ${info.indexes.length} HNSW/IVF index(es); index mode ${rebuild ? 'rebuild' : 'keep (updated in place)'}${info.embedHash ? '' : '; no embed_hash column, not set'}`);
      const timings = { stageMs: 0, dropMs: 0, updateMs: 0, sweepMs: 0, rebuildMs: 0, vacuumMs: 0 };

      await q('drop table if exists public.reembed_stage');
      await q(`create unlogged table public.reembed_stage (id uuid not null, desk_feature text, chunk_hash text not null, embed_hash text not null, embedding ${info.vectorType} not null)`);
      const staged = await timed(() => psqlRun(database, { sql: 'copy public.reembed_stage (id, desk_feature, chunk_hash, embed_hash, embedding) from stdin with (format binary)', input: copyBinary(rows) }));
      timings.stageMs = staged.ms;
      const n = Number(await q('select count(*) from public.reembed_stage'));
      log(`staged ${n.toLocaleString('en-US')} vectors in ${ms(staged.ms)}`);
      if (n !== expected) {
        await q('drop table public.reembed_stage');
        throw new Error(`${n} vectors reached the staging table, expected ${expected}; nothing in document_chunks was changed`);
      }

      const vectorSchema = /^"?([^".]+)"?\.vector\(/.exec(info.vectorType)?.[1];
      const roots = info.indexes.filter((i) => !i.parent);
      const children = info.indexes.filter((i) => i.parent);
      const settings = [
        '\\timing on',
        "set maintenance_work_mem = '1GB';",
        'set max_parallel_maintenance_workers = 0;',
        'set statement_timeout = 0;',
        "set lock_timeout = '30s';",
        // the vector comparison operator lives in the extension's schema (`extensions` on Supabase)
        ...(vectorSchema ? [`set search_path = public, ${quoteIdent(vectorSchema)};`] : []),
      ];
      const cleanup = ['\\echo @@cleanup', 'drop table public.reembed_stage;'];
      const updateScript = [
        ...settings,
        '\\echo @@drop',
        ...(rebuild ? roots.map((i) => `drop index public.${quoteIdent(i.name)};`) : []),
        '\\echo @@update',
        `with u as (update public.document_chunks c set embedding = s.embedding${info.embedHash ? ', embed_hash = s.embed_hash' : ''}
           from public.reembed_stage s where c.id = s.id${info.deskFeature ? ' and c.desk_feature = s.desk_feature' : ''} and c.chunk_hash = s.chunk_hash returning 1)
         select 'updated=' || count(*) from u;`,
        `do $check$ declare n bigint; begin
           select count(*) into n from public.reembed_stage s join public.document_chunks c on c.id = s.id${info.deskFeature ? ' and c.desk_feature = s.desk_feature' : ''} and c.chunk_hash = s.chunk_hash
             where c.embedding = s.embedding${info.embedHash ? ' and c.embed_hash = s.embed_hash' : ''};
           if n <> ${expected} then raise exception 'reembed: % of ${expected} staged vectors are in document_chunks; rolled back', n; end if;
         end $check$;`,
        ...(rebuild ? [] : cleanup),
      ].join('\n');
      const out = await psqlRun(database, { input: updateScript, single: true });
      const t = parseTimings(out);
      timings.dropMs = t.drop ?? 0;
      timings.updateMs = t.update ?? 0;
      const updated = Number(/updated=(\d+)/.exec(out)?.[1] ?? NaN);
      log(`update: ${updated.toLocaleString('en-US')} rows in ${ms(timings.updateMs)}`);

      // The update replaced every row, so each old version is still on its page. An index built now would hold those too:
      // HNSW keeps dead versions from a build as nodes, doubling the index and spending ef_search on them. So the update
      // commits first, vacuum removes the old versions, and only then are the indexes built.
      if (rebuild) {
        const swept = await timed(() => q('vacuum public.document_chunks'));
        timings.sweepMs = swept.ms;
        log(`old row versions removed in ${ms(swept.ms)}`);
        const rebuildScript = [
          ...settings,
          '\\echo @@rebuild',
          ...roots.map((i) => `${i.def};`),
          ...children.map((i) => `${i.def};`),
          ...children.map((i) => `alter index public.${quoteIdent(i.parent)} attach partition public.${quoteIdent(i.name)};`),
          ...cleanup,
        ].join('\n');
        timings.rebuildMs = parseTimings(await psqlRun(database, { input: rebuildScript, single: true })).rebuild ?? 0;
        log(`index work: dropped ${roots.length} root index(es) in ${ms(timings.dropMs)}, rebuilt ${info.indexes.length} index(es) in ${ms(timings.rebuildMs)}`);
      } else log('index work: none (indexes updated in place by the update above)');

      const vac = await timed(async () => {
        await q('vacuum (analyze) public.document_chunks');
        await q('analyze public.documents');
        if ((await q("select to_regclass('public.desk_rows')")) !== '') await q('analyze public.desk_rows');
      });
      timings.vacuumMs = vac.ms;
      log(`vacuum and analyze: ${ms(vac.ms)}`);
      return { updated, timings, rebuilt: rebuild };
    },
  };
}

// ---- the run --------------------------------------------------------------------------------------------------------

const usd = (n) => `US$${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`;
const num = (n) => n.toLocaleString('en-US');

/**
 * The whole run. `deps` (all optional) injects the source, the target, the embedder factory, the logger and, for tests,
 * the batch bounds and the database policy.
 */
export async function runReembed(options, deps = {}) {
  const log = deps.log ?? console.log;
  const needTarget = !options.dryRun && !options.noLoad;
  (deps.policy ?? DEFAULT_POLICY).check({ source: options.source, target: options.target, needTarget });

  const source = deps.source ?? makeDockerSource(options.source);
  const available = (await source.features()).map((f) => f.feature);
  const features = resolveFeatures(options.features, available);
  const docs = await source.documents(features);
  const headers = new Map(docs.map((d) => [d.id, buildChunkHeader(d)]));
  const featureOf = new Map(docs.map((d) => [d.id, d.desk_feature]));
  const stats = new Map(features.map((f) => [f, { feature: f, documents: docs.filter((d) => d.desk_feature === f).length, documentsWithHeader: docs.filter((d) => d.desk_feature === f && headers.get(d.id)).length, chunks: 0, skippedBlank: 0, tokens: 0, tokensWithoutHeader: 0 }]));
  log(`source ${options.source}: ${features.length} feature(s), ${num(docs.length)} documents${options.dryRun ? ' (dry run: nothing is embedded or written)' : ''}`);

  const plan = new Map(); // chunk id -> what the load needs
  async function* planned() {
    for await (const row of source.chunks(features)) {
      const st = stats.get(featureOf.get(row.document_id));
      if (!st) continue;
      if (normalise(row.content) === '') {
        st.skippedBlank++;
        continue;
      }
      const header = headers.get(row.document_id) ?? '';
      const input = embeddingInput({ header, section: row.section, content: row.content });
      const hash = await chunkEmbedHash(input);
      const clamped = Math.min(input.length, EMBED_BATCH.maxInputTokens * 4);
      st.chunks++;
      st.tokens += Math.ceil(clamped / 4);
      st.tokensWithoutHeader += Math.ceil((input.length - chunkHeaderPrefix(header).length) / 4);
      plan.set(row.id, { desk_feature: row.desk_feature ?? null, chunk_hash: row.chunk_hash, hash });
      yield { id: row.id, hash, input };
    }
  }

  const finish = (extra) => {
    const list = [...stats.values()];
    const sum = (k) => list.reduce((n, s) => n + s[k], 0);
    const totals = { chunks: sum('chunks'), skippedBlank: sum('skippedBlank'), tokens: sum('tokens'), tokensWithoutHeader: sum('tokensWithoutHeader') };
    totals.estimatedUsd = totals.tokens * EMBED_PRICE_USD_PER_TOKEN;
    return { features: list, totals, skippedBlank: totals.skippedBlank, ...extra };
  };

  if (options.dryRun) {
    for await (const _ of planned()) void _;
    const result = finish({ dryRun: true });
    for (const s of result.features) {
      log(`  ${s.feature}: ${num(s.chunks)} chunks in ${num(s.documents)} documents (${num(s.documentsWithHeader)} with a header; ${num(s.skippedBlank)} blank skipped); ~${num(s.tokens)} tokens (header adds ~${num(s.tokens - s.tokensWithoutHeader)}); ${usd(s.tokens * EMBED_PRICE_USD_PER_TOKEN)}`);
    }
    const t = result.totals;
    log(`  total: ${num(t.chunks)} chunks, ~${num(t.tokens)} tokens (without headers ~${num(t.tokensWithoutHeader)}), estimated ${usd(t.estimatedUsd)} at ${usd(EMBED_PRICE_USD_PER_TOKEN * 1e6)} per million tokens`);
    log(`  the vector file would be ${(t.chunks * VECTOR_RECORD_BYTES / 2 ** 30).toFixed(2)} GiB (${num(VECTOR_RECORD_BYTES)} bytes a chunk); the load needs about three times that free in the container`);
    log(`  the estimate counts four characters a token (the worker's own); the real tokenizer can differ by 10-25%. The run stops at --max-usd ${usd(options.maxUsd)}.`);
    return result;
  }

  const store = openVectorFile(options.out);
  let embedder;
  const embed = async (inputs) => {
    embedder ??= deps.embedder ? deps.embedder() : makeOpenRouterEmbedder({ apiKey: resolveApiKey() });
    return embedder(inputs);
  };
  let summary;
  try {
    summary = await embedAll({ items: planned(), embed, store, maxUsd: options.maxUsd, concurrency: options.concurrency, limit: options.limit, log, bounds: deps.bounds });
  } catch (error) {
    const s = error.summary;
    log(`stopped by an error after ${num(s?.embedded ?? 0)} chunks embedded, ${usd(s?.spentUsd ?? 0)} spent; the vector file keeps them (${store.path})`);
    store.close();
    throw error;
  }
  store.close();
  const exportBytes = existsSync(options.out) ? fstatSizeOf(options.out) : 0;
  log(`embedded ${num(summary.embedded)} chunks (${num(summary.skippedDone)} already in the vector file), ${num(summary.promptTokens)} tokens, ${usd(summary.spentUsd)} spent; stopped: ${summary.stoppedBy}`);
  log(`vector file ${options.out}: ${(exportBytes / 2 ** 20).toFixed(1)} MiB`);
  const result = finish({ dryRun: false, ...summary, exportBytes, loaded: 0, load: null });

  if (summary.stoppedBy !== 'complete') {
    log(`NOT loaded: the run stopped (${summary.stoppedBy}) before every chunk had a vector. Rerun the same command${summary.stoppedBy === 'ceiling' ? ' with a higher --max-usd' : ''}; chunks already in the vector file are not paid for again.`);
    return result;
  }
  if (options.noLoad) {
    log('--no-load: the target was not touched.');
    return result;
  }

  const target = deps.target ?? makeDockerTarget(options.target);
  async function* loadRows() {
    const seen = new Set();
    for await (const rec of readVectorFile(options.out)) {
      const p = plan.get(rec.id);
      if (!p || p.hash !== rec.hash || seen.has(rec.id)) continue;
      seen.add(rec.id);
      yield { id: rec.id, desk_feature: p.desk_feature, chunk_hash: p.chunk_hash, embed_hash: rec.hash, vector: rec.vector };
    }
  }
  const load = await target.load({ rows: loadRows(), expected: plan.size, indexMode: options.indexMode, log });
  result.loaded = load.updated;
  result.load = load;
  log(`loaded ${num(load.updated)} vectors into ${options.target}`);
  return result;
}

// ---- command line ---------------------------------------------------------------------------------------------------

// vite-node drops the script from process.argv (see scripts/build-eval-set.mjs): the arguments are what follows.
function scriptArgs() {
  const argv = process.argv.slice(2);
  const dash = argv.indexOf('--');
  if (dash !== -1) return argv.slice(dash + 1);
  const i = argv.findIndex((a) => /reembed\.mjs$/.test(a));
  return i === -1 ? argv : argv.slice(i + 1);
}

// The self-test imports this file as a library: it sets this flag first.
if (!globalThis.REEMBED_AS_LIBRARY) {
  (async () => {
    try {
      await runReembed(parseArgs(scriptArgs()));
      process.exit(0);
    } catch (error) {
      console.error(`reembed: ${error.message}`);
      process.exit(1);
    }
  })();
}
