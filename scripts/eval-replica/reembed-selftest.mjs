/**
 * Self-test of scripts/eval-replica/reembed.mjs (plan 2026-11-04-hybrid-and-contextual-retrieval T5): the
 * embedding-input rule, the spend ceiling, dry run, resume, the target-name refusal, the served-model and
 * width checks, the vector file, and (with Docker) a full load into one throwaway database. A fake embedder
 * stands in for OpenRouter: no network, no credentials, no .env, no paid call.
 *
 *   npx vite-node --config vitest.config.js scripts/eval-replica/reembed-selftest.mjs [-- --offline]
 *
 * Runs through vite-node because the script imports the worker's TypeScript (chunkHeader.ts, textNormalise.ts,
 * textContext.ts) so the rule is checked against the code the worker runs. The end-to-end part creates and drops
 * ONE database, niyantran_reembed_selftest, in the niyantran-corpus-test-db container (run outside the Claude
 * Code sandbox) and touches no other database. --offline skips it. Exit 0 when every check holds.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chunkTextWithContext } from '../../supabase/functions/_shared/textContext.ts';
import { buildChunkHeader } from '../../supabase/functions/_shared/chunkHeader.ts';
import { EMBED_DIMS, EMBED_PRICE_USD_PER_TOKEN } from '../../supabase/functions/_shared/embed.ts';
import { CONTAINER } from './rehearsal-db.mjs';

// reembed.mjs runs its command line on import unless this is set, so it is set first and the import is dynamic.
globalThis.REEMBED_AS_LIBRARY = true;
const {
  DEFAULT_POLICY, chunkEmbedHash, copyBinary, embedAll, embeddingInput, estimateTokens, makeDockerSource, makeDockerTarget,
  makeOpenRouterEmbedder, openVectorFile, parseArgs, parseTimings, readVectorFile, resolveFeatures, runReembed, sectionPrefix,
} = await import('./reembed.mjs');

const OFFLINE = process.argv.includes('--offline');
const work = mkdtempSync(join(tmpdir(), 'reembed-selftest-'));
const quiet = () => {};
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A deterministic 1536-wide vector for a text, so a test can say which input produced which vector. */
function fakeVector(text) {
  const h = createHash('sha256').update(text, 'utf8').digest();
  const v = new Float32Array(EMBED_DIMS);
  for (let i = 0; i < 32; i++) v[i] = (h[i] + 1) / 256;
  v[EMBED_DIMS - 1] = 0.5;
  return v;
}

/** The embedder's contract: (inputs) => { vectors, model, promptTokens, costUsd }. `factor` makes it cost more than estimated. */
function fakeEmbedder({ factor = 1 } = {}) {
  const calls = [];
  const embed = async (inputs) => {
    calls.push(inputs.slice());
    const promptTokens = Math.ceil(inputs.reduce((n, s) => n + estimateTokens(s), 0) * factor);
    return { vectors: inputs.map(fakeVector), model: 'openai/text-embedding-3-small', promptTokens, costUsd: promptTokens * EMBED_PRICE_USD_PER_TOKEN };
  };
  embed.calls = calls;
  embed.inputs = () => calls.flat();
  return embed;
}

// ---- the embedding-input rule ----------------------------------------------------------------------------------

const DOC = {
  title: 'Alpha Steel Ltd v. Beta Finance',
  desk_tier: 'law',
  desk_feature: 'NCLT / NCLAT (Insolvency)',
  metadata: { citation: { case_number: 'CP(IB) 12/KB/2023', order_date: '2024-02-03', forum: 'NCLT Kolkata' } },
};

test('rule: header, then the section prefix, then the content', () => {
  const header = buildChunkHeader(DOC);
  assert.ok(header.includes('Alpha Steel'), 'the real builder makes a header from the stored fields');
  assert.equal(embeddingInput({ header, section: { heading: 'PART I', note: 'Appeal' }, content: 'the appeal is dismissed' }), `${header}\n\nPART I › Appeal\n\nthe appeal is dismissed`);
  assert.equal(embeddingInput({ header, section: { note: '34.' }, content: 'x' }), `${header}\n\n34.\n\nx`);
  assert.equal(embeddingInput({ header, section: { heading: 'H' }, content: 'x' }), `${header}\n\nH\n\nx`);
  assert.equal(embeddingInput({ header, section: undefined, content: 'x' }), `${header}\n\nx`);
});

test('rule: an empty header gives exactly the input the worker embedded before headers existed', () => {
  assert.equal(embeddingInput({ header: '', section: { heading: 'H', note: 'n' }, content: 'body' }), 'H › n\n\nbody');
  assert.equal(embeddingInput({ header: undefined, section: null, content: 'body' }), 'body');
  assert.equal(embeddingInput({ header: '', section: {}, content: 'body' }), 'body');
  assert.equal(sectionPrefix('not an object'), '');
  assert.equal(sectionPrefix({ heading: '', note: '' }), '');
});

test('rule: matches the worker (chunkTextWithContext) row for row, with and without a header', async () => {
  const text = [
    '# PART ONE', '', 'First paragraph of the first part. '.repeat(30), '',
    '## Appeal', '', 'The appeal is dismissed for the reasons given above. '.repeat(40), '',
    'CHAPTER II - MEDIATION', 'Body of chapter two follows here. '.repeat(40),
  ].join('\n');
  for (const header of ['', buildChunkHeader(DOC)]) {
    const rows = await chunkTextWithContext(text, { header });
    assert.ok(rows.length >= 3, 'the sample has several chunks');
    assert.ok(rows.some((r) => r.section.heading), 'and some have a section');
    for (const r of rows) {
      const mine = embeddingInput({ header, section: r.section, content: r.content });
      assert.equal(mine, r.embedding_input, `chunk ${r.chunkIndex}`);
      assert.equal(await chunkEmbedHash(mine), r.embed_hash, `hash of chunk ${r.chunkIndex}`);
    }
  }
});

test('rule: the hash is SHA-256 of the whitespace-normalised input, as the worker computes it', async () => {
  const input = 'Header  line\n\n  body\ttext ';
  assert.equal(await chunkEmbedHash(input), sha('Header line body text'));
  assert.equal(await chunkEmbedHash('a  b'), await chunkEmbedHash('a b'));
  assert.notEqual(await chunkEmbedHash('a b'), await chunkEmbedHash('a b c'));
});

// ---- options, names, features ----------------------------------------------------------------------------------

const ARGS = { tmpdir: work, repoRoot: join(work, 'repo') };

test('options: defaults, and bad values are refused', () => {
  const o = parseArgs(['--source', 'niyantran_rehearsal_b9final', '--target', 'niyantran_rehearsal_c2headers'], ARGS);
  assert.equal(o.maxUsd, 3);
  assert.equal(o.dryRun, false);
  assert.equal(o.indexMode, 'auto');
  assert.equal(o.out, join(work, 'niyantran_rehearsal_c2headers-headers.vec'));
  assert.throws(() => parseArgs(['--source', 'a', '--max-usd', '0'], ARGS), /max-usd/);
  assert.throws(() => parseArgs(['--source', 'a', '--max-usd', 'abc'], ARGS), /max-usd/);
  assert.throws(() => parseArgs(['--source', 'a', '--concurrency', '0'], ARGS), /concurrency/);
  assert.throws(() => parseArgs(['--source', 'a', '--index', 'sometimes'], ARGS), /index/);
  assert.throws(() => parseArgs(['--nonsense'], ARGS), /unknown option/);
  assert.throws(() => parseArgs(['--target', 'niyantran_rehearsal_x'], ARGS), /--source/);
  assert.throws(() => parseArgs(['--source', 'niyantran_rehearsal_a'], ARGS), /--target/);
  assert.doesNotThrow(() => parseArgs(['--source', 'niyantran_rehearsal_a', '--dry-run'], ARGS));
  assert.doesNotThrow(() => parseArgs(['--source', 'niyantran_rehearsal_a', '--no-load'], ARGS));
});

test('options: the vector file may not be inside the repository', () => {
  assert.throws(() => parseArgs(['--source', 's', '--dry-run', '--out', join(ARGS.repoRoot, 'eval', 'v.vec')], ARGS), /repository/);
  assert.doesNotThrow(() => parseArgs(['--source', 's', '--dry-run', '--out', join(work, 'v.vec')], ARGS));
});

test('target: only niyantran_rehearsal_* is accepted; the replica, other names and the source itself are refused', () => {
  const ok = (target) => DEFAULT_POLICY.check({ source: 'niyantran_rehearsal_b9final', target });
  assert.doesNotThrow(() => ok('niyantran_rehearsal_c2headers'));
  for (const bad of ['niyantran_retrieval_replica', 'niyantran_reembed_selftest', 'postgres', 'niyantran_rehearsal_', 'niyantran_rehearsal_C2', 'niyantran_rehearsal_a;drop', 'nterprod', '', undefined]) {
    assert.throws(() => ok(bad), /refusing/, String(bad));
  }
  assert.throws(() => DEFAULT_POLICY.check({ source: 'niyantran_rehearsal_b9final', target: 'niyantran_rehearsal_b9final' }), /same/);
  assert.throws(() => DEFAULT_POLICY.check({ source: 'postgres', target: 'niyantran_rehearsal_x' }), /refusing source/);
  assert.doesNotThrow(() => DEFAULT_POLICY.check({ source: 'niyantran_retrieval_replica', target: 'niyantran_rehearsal_x' }));
  // a dry run has no target, but a name that is given is still checked
  assert.doesNotThrow(() => DEFAULT_POLICY.check({ source: 'niyantran_rehearsal_b9final', target: undefined, needTarget: false }));
  assert.throws(() => DEFAULT_POLICY.check({ source: 'niyantran_rehearsal_b9final', target: 'postgres', needTarget: false }), /refusing/);
});

test('features: substring of the feature name, case-insensitive; an unknown word is refused', () => {
  const all = ['NCLT / NCLAT (Insolvency)', 'Parliamentary Question Database', 'Bill Passage Probability Index', 'Regulatory Body Watch (RBI SEBI TRAI CCI)'];
  assert.deepEqual(resolveFeatures(undefined, all), all);
  assert.deepEqual(resolveFeatures('nclt,Bill', all), [all[0], all[2]]);
  assert.deepEqual(resolveFeatures('regulatory', all), [all[3]]);
  assert.deepEqual(resolveFeatures('NCLT / NCLAT (Insolvency)', all), [all[0]]);
  assert.throws(() => resolveFeatures('nclt,tenders', all), /tenders/);
});

// ---- the vector file -------------------------------------------------------------------------------------------

test('vector file: records round-trip (id, hash, float32 vector) and survive a reopen', async () => {
  const path = join(work, 'roundtrip.vec');
  const a = { id: uuid(1), hash: sha('a'), vector: fakeVector('a') };
  const b = { id: uuid(2), hash: sha('b'), vector: fakeVector('b') };
  const f = openVectorFile(path);
  f.append([a]);
  f.close();
  const g = openVectorFile(path);
  assert.equal(g.has(a.id, a.hash), true);
  assert.equal(g.has(a.id, sha('other')), false, 'a different hash for the same chunk is not done');
  assert.equal(g.has(b.id, b.hash), false);
  g.append([b]);
  g.close();
  const back = [];
  for await (const r of readVectorFile(path)) back.push(r);
  assert.deepEqual(back.map((r) => [r.id, r.hash]), [[a.id, a.hash], [b.id, b.hash]]);
  assert.ok(back[0].vector instanceof Float32Array);
  assert.deepEqual([...back[0].vector], [...a.vector]);
  assert.deepEqual([...back[1].vector], [...b.vector]);
  assert.equal(statSync(path).size, 48 + 2 * (16 + 32 + 4 * EMBED_DIMS));
});

test('vector file: a torn last record (a crash mid-write) is dropped on reopen and the rest kept', async () => {
  const path = join(work, 'torn.vec');
  const rows = [1, 2, 3].map((n) => ({ id: uuid(n), hash: sha(String(n)), vector: fakeVector(String(n)) }));
  const f = openVectorFile(path);
  f.append(rows);
  f.close();
  truncateSync(path, statSync(path).size - 100);
  const g = openVectorFile(path);
  assert.equal(g.has(rows[0].id, rows[0].hash), true);
  assert.equal(g.has(rows[1].id, rows[1].hash), true);
  assert.equal(g.has(rows[2].id, rows[2].hash), false, 'the torn record is not counted, so it is paid for again');
  g.append([rows[2]]);
  g.close();
  const ids = [];
  for await (const r of readVectorFile(path)) ids.push(r.id);
  assert.deepEqual(ids, rows.map((r) => r.id));
});

test('vector file: a file that is not ours is refused, never overwritten', () => {
  const path = join(work, 'foreign.vec');
  writeFileSync(path, 'this is somebody else\'s file, long enough to be mistaken for ours'.repeat(3));
  assert.throws(() => openVectorFile(path), /not a vector file/);
  assert.match(readFileSync(path, 'utf8'), /somebody else/);
});

test('copy: the binary COPY stream frames each row as PostgreSQL expects (uuid, text, text, text, vector)', async () => {
  const vector = fakeVector('copy');
  const row = { id: uuid(7), desk_feature: 'Feature', chunk_hash: sha('c'), embed_hash: sha('e'), vector };
  const noFeature = { ...row, id: uuid(8), desk_feature: null };
  const chunks = [];
  for await (const b of copyBinary([row, noFeature])) chunks.push(b);
  const buf = Buffer.concat(chunks);
  assert.equal(buf.subarray(0, 11).toString('latin1'), 'PGCOPY\n\xff\r\n\0');
  assert.equal(buf.readInt32BE(11), 0, 'flags');
  assert.equal(buf.readInt32BE(15), 0, 'extension length');
  let at = 19;
  const readRow = () => {
    assert.equal(buf.readInt16BE(at), 5, 'five fields');
    at += 2;
    const fields = [];
    for (let i = 0; i < 5; i++) {
      const len = buf.readInt32BE(at);
      at += 4;
      fields.push(len === -1 ? null : buf.subarray(at, at + len));
      at += Math.max(len, 0);
    }
    return fields;
  };
  const [id, feature, chunkHash, embedHash, vec] = readRow();
  assert.equal(id.toString('hex'), uuid(7).replace(/-/g, ''));
  assert.equal(feature.toString('utf8'), 'Feature');
  assert.equal(chunkHash.toString('utf8'), sha('c'));
  assert.equal(embedHash.toString('utf8'), sha('e'));
  assert.equal(vec.length, 4 + 4 * EMBED_DIMS);
  assert.equal(vec.readInt16BE(0), EMBED_DIMS, 'pgvector binary: dimension');
  assert.equal(vec.readInt16BE(2), 0, 'pgvector binary: unused');
  for (const i of [0, 5, 31, EMBED_DIMS - 1]) assert.equal(vec.readFloatBE(4 + 4 * i), vector[i], `float ${i} is big-endian`);
  assert.equal(readRow()[1], null, 'a missing desk_feature is a NULL field');
  assert.equal(buf.readInt16BE(at), -1, 'trailer');
  assert.equal(at + 2, buf.length);
  assert.equal(vector[0], fakeVector('copy')[0], 'the caller\'s vector is not byteswapped in place');
});

test('timings: psql \\timing lines are attributed to the marker before them', () => {
  const t = parseTimings('@@drop\nTime: 12.5 ms\n@@update\nupdated=3\nTime: 100.25 ms\nTime: 4 ms\n@@rebuild\nTime: 2000 ms (00:02.000)\n');
  assert.deepEqual(t, { drop: 12.5, update: 104.25, rebuild: 2000 });
});

// ---- the embedder: request shape, retries, served model, width ------------------------------------------------

const okBody = (n, { model = 'text-embedding-3-small', width = EMBED_DIMS, cost = 0.00001 } = {}) => ({
  data: Array.from({ length: n }, (_, i) => ({ index: i, embedding: new Array(width).fill(0.25) })),
  model,
  usage: { prompt_tokens: 7 * n, total_tokens: 7 * n, cost },
});
const reply = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body });
const noSleep = async () => {};

test('embedder: the request matches production (model, float encoding, no dimensions) and asks for usage cost', async () => {
  const seen = [];
  const embed = makeOpenRouterEmbedder({ apiKey: 'k-test', sleep: noSleep, fetch: async (url, init) => { seen.push({ url, init }); return reply(200, okBody(2)); } });
  const r = await embed(['one', 'two']);
  assert.equal(seen[0].url, 'https://openrouter.ai/api/v1/embeddings');
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.model, 'openai/text-embedding-3-small');
  assert.equal(body.encoding_format, 'float');
  assert.deepEqual(body.input, ['one', 'two']);
  assert.deepEqual(body.usage, { include: true });
  assert.equal('dimensions' in body, false);
  assert.equal(seen[0].init.headers.authorization, 'Bearer k-test');
  assert.equal(r.vectors.length, 2);
  assert.equal(r.vectors[0].length, EMBED_DIMS);
  assert.equal(r.costUsd, 0.00001);
  assert.equal(r.promptTokens, 14);
});

test('embedder: the cost is priced from tokens when the response carries no cost', async () => {
  const body = okBody(1);
  delete body.usage.cost;
  const embed = makeOpenRouterEmbedder({ apiKey: 'k', sleep: noSleep, fetch: async () => reply(200, body) });
  const r = await embed(['x']);
  assert.equal(r.costUsd, 7 * EMBED_PRICE_USD_PER_TOKEN);
});

test('embedder: 429 and 5xx are retried with backoff, then it gives up; 4xx is not retried', async () => {
  let n = 0;
  const sleeps = [];
  const flaky = makeOpenRouterEmbedder({ apiKey: 'k', sleep: async (ms) => void sleeps.push(ms), fetch: async () => (++n < 3 ? reply(n === 1 ? 429 : 503, { error: { message: 'slow down' } }) : reply(200, okBody(1))) });
  assert.equal((await flaky(['x'])).vectors.length, 1);
  assert.equal(n, 3);
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[1] > sleeps[0], 'the wait grows');

  let m = 0;
  const dead = makeOpenRouterEmbedder({ apiKey: 'k', sleep: noSleep, fetch: async () => (++m, reply(500, {})) });
  await assert.rejects(() => dead(['x']), /HTTP 500/);
  assert.ok(m >= 3 && m <= 8, `bounded attempts, got ${m}`);

  let p = 0;
  const bad = makeOpenRouterEmbedder({ apiKey: 'k', sleep: noSleep, fetch: async () => (++p, reply(401, { error: { message: 'no key' } })) });
  await assert.rejects(() => bad(['x']), /401/);
  assert.equal(p, 1);

  const waits = [];
  let q = 0;
  const hinted = makeOpenRouterEmbedder({ apiKey: 'k', sleep: async (ms) => void waits.push(ms), fetch: async () => (++q === 1 ? reply(429, {}, { 'retry-after': '3' }) : reply(200, okBody(1))) });
  await hinted(['x']);
  assert.ok(waits[0] >= 3000, 'honours Retry-After');
});

test('embedder: a different served model, a wrong width, a wrong count and a missing key are refused', async () => {
  const run = (body) => makeOpenRouterEmbedder({ apiKey: 'k', sleep: noSleep, fetch: async () => reply(200, body) })(['x']);
  assert.ok((await run(okBody(1, { model: 'openai/text-embedding-3-small' }))).vectors.length === 1, 'either spelling of the model');
  await assert.rejects(() => run(okBody(1, { model: 'text-embedding-3-large' })), /served by text-embedding-3-large/);
  await assert.rejects(() => run(okBody(1, { model: '' })), /served by/);
  await assert.rejects(() => run(okBody(1, { width: 3072 })), /width 3072/);
  await assert.rejects(() => run(okBody(2)), /2 vectors for 1 input/);
  assert.throws(() => makeOpenRouterEmbedder({ apiKey: '', fetch: async () => {} }), /OPENROUTER_API_KEY/);
});

// ---- the embedding loop: ceiling, resume, limit ---------------------------------------------------------------

const items = (n, { length = 400, from = 0 } = {}) => (async function* () {
  for (let i = from; i < from + n; i++) {
    const input = `chunk ${i} `.padEnd(length, 'x');
    yield { id: uuid(i + 1), hash: sha(input), input };
  }
})();

const freshStore = (name) => openVectorFile(join(work, `${name}.vec`));
const COMMON = { maxUsd: 100, concurrency: 1, log: quiet, bounds: { maxCount: 10, maxTokens: 200_000, maxInputTokens: 7_000 } };

test('loop: embeds every item once, in batches within the bounds, and stores each vector', async () => {
  const store = freshStore('loop');
  const embed = fakeEmbedder();
  const r = await embedAll({ ...COMMON, items: items(25), embed, store });
  assert.equal(r.stoppedBy, 'complete');
  assert.equal(r.embedded, 25);
  assert.deepEqual(embed.calls.map((c) => c.length), [10, 10, 5]);
  const got = [];
  store.close();
  for await (const rec of readVectorFile(join(work, 'loop.vec'))) got.push(rec);
  assert.equal(got.length, 25);
  assert.ok(r.spentUsd > 0 && Math.abs(r.spentUsd - 25 * 100 * EMBED_PRICE_USD_PER_TOKEN) < 1e-9, `spent ${r.spentUsd}`);
});

test('ceiling: stops before the next batch would pass --max-usd, and never spends past it', async () => {
  const store = freshStore('ceiling');
  const embed = fakeEmbedder();
  const batchCost = 10 * 100 * EMBED_PRICE_USD_PER_TOKEN; // 10 inputs of 100 tokens
  const r = await embedAll({ ...COMMON, maxUsd: batchCost * 2.5, items: items(100), embed, store });
  assert.equal(r.stoppedBy, 'ceiling');
  assert.equal(embed.calls.length, 2, 'two whole batches fit, the third would not');
  assert.ok(r.spentUsd <= batchCost * 2.5);
  assert.equal(r.embedded, 20);
  store.close();
});

test('ceiling: holds when the real token count is higher than the estimate, and with batches in flight', async () => {
  const store = freshStore('ceiling-factor');
  const embed = fakeEmbedder({ factor: 1.6 });
  const maxUsd = 40 * 100 * EMBED_PRICE_USD_PER_TOKEN;
  const r = await embedAll({ ...COMMON, concurrency: 4, maxUsd, items: items(500), embed, store });
  assert.equal(r.stoppedBy, 'ceiling');
  assert.ok(r.spentUsd <= maxUsd, `spent ${r.spentUsd} of ${maxUsd}`);
  assert.ok(r.embedded > 0);
  store.close();
});

test('ceiling: a ceiling below one batch embeds nothing', async () => {
  const store = freshStore('ceiling-zero');
  const embed = fakeEmbedder();
  const r = await embedAll({ ...COMMON, maxUsd: 1e-9, items: items(5), embed, store });
  assert.equal(r.stoppedBy, 'ceiling');
  assert.equal(embed.calls.length, 0);
  store.close();
});

test('resume: chunks already in the file (same id and hash) are not embedded or paid for again', async () => {
  const path = join(work, 'resume.vec');
  const first = openVectorFile(path);
  const e1 = fakeEmbedder();
  const r1 = await embedAll({ ...COMMON, maxUsd: 10 * 100 * EMBED_PRICE_USD_PER_TOKEN * 1.5, items: items(40), embed: e1, store: first });
  first.close();
  assert.equal(r1.stoppedBy, 'ceiling');
  assert.equal(r1.embedded, 10);

  const second = openVectorFile(path);
  const e2 = fakeEmbedder();
  const r2 = await embedAll({ ...COMMON, items: items(40), embed: e2, store: second });
  second.close();
  assert.equal(r2.stoppedBy, 'complete');
  assert.equal(r2.skippedDone, 10);
  assert.equal(r2.embedded, 30);
  assert.equal(new Set(e2.inputs()).size, 30);
  for (const input of e1.inputs()) assert.ok(!e2.inputs().includes(input), 'nothing paid for twice');

  const third = openVectorFile(path);
  const e3 = fakeEmbedder();
  const r3 = await embedAll({ ...COMMON, items: items(40), embed: e3, store: third });
  third.close();
  assert.equal(e3.calls.length, 0);
  assert.equal(r3.skippedDone, 40);
});

test('resume: the same chunk with a different hash (a changed header) is embedded again', async () => {
  const store = freshStore('rehash');
  const embed = fakeEmbedder();
  await embedAll({ ...COMMON, items: items(5), embed, store });
  const changed = (async function* () {
    for (let i = 0; i < 5; i++) yield { id: uuid(i + 1), hash: sha(`new ${i}`), input: `new ${i}` };
  })();
  const r = await embedAll({ ...COMMON, items: changed, embed, store });
  assert.equal(r.embedded, 5);
  store.close();
});

test('limit: --limit embeds at most that many and reports it', async () => {
  const store = freshStore('limit');
  const embed = fakeEmbedder();
  const r = await embedAll({ ...COMMON, items: items(100), embed, store, limit: 13 });
  assert.equal(r.stoppedBy, 'limit');
  assert.equal(r.embedded, 13);
  store.close();
});

test('loop: a failed batch stops further batches, keeps what was stored, and carries the summary', async () => {
  const store = freshStore('fail');
  let n = 0;
  const base = fakeEmbedder();
  const embed = async (inputs) => { if (++n === 3) throw new Error('boom'); return base(inputs); };
  await assert.rejects(() => embedAll({ ...COMMON, items: items(100), embed, store }), (e) => {
    assert.match(e.message, /boom/);
    assert.equal(e.summary.embedded, 20);
    return true;
  });
  assert.equal(n, 3, 'no batch is started after the failure');
  store.close();
});

test('loop: a vector of the wrong width from an embedder is refused before it is stored', async () => {
  const store = freshStore('width');
  const embed = async (inputs) => ({ vectors: inputs.map(() => new Float32Array(10)), model: 'x', promptTokens: 1, costUsd: 0 });
  await assert.rejects(() => embedAll({ ...COMMON, items: items(3), embed, store }), /width/);
  store.close();
});

// ---- runReembed with a fake database --------------------------------------------------------------------------

function fakeWorld({ nDocs = 3, perDoc = 4 } = {}) {
  const features = ['NCLT / NCLAT (Insolvency)', 'Bill Passage Probability Index'];
  const docs = [];
  const chunks = [];
  let c = 0;
  for (let d = 0; d < nDocs; d++) {
    const feature = features[d % 2];
    const id = uuid(1000 + d);
    docs.push({ id, title: `Document ${d} of ${feature.slice(0, 4)}`, desk_tier: 'x', desk_feature: feature, metadata: feature.startsWith('NCLT') ? { citation: { case_number: `CP ${d}/2024` } } : {} });
    for (let k = 0; k < perDoc; k++) {
      c++;
      chunks.push({ id: uuid(c), document_id: id, desk_feature: feature, chunk_hash: sha(`ch${c}`), section: k === 1 ? { heading: 'PART', note: 'n' } : null, content: `The content of chunk ${c}. `.repeat(8) });
    }
  }
  chunks.push({ id: uuid(900), document_id: docs[0].id, desk_feature: docs[0].desk_feature, chunk_hash: sha('blank'), section: null, content: '  \n ' });
  const source = {
    async features() { return features.map((f) => ({ feature: f, chunks: chunks.filter((x) => x.desk_feature === f).length })); },
    async documents(wanted) { return docs.filter((d) => wanted.includes(d.desk_feature)); },
    async *chunks(wanted) { for (const x of chunks) if (wanted.includes(x.desk_feature)) yield x; },
  };
  const loads = [];
  const target = {
    async load(args) {
      const rows = [];
      for await (const r of args.rows) rows.push(r);
      loads.push({ ...args, rows });
      return { updated: rows.length, timings: {} };
    },
  };
  return { source, target, loads, docs, chunks };
}

const optionsFor = (name, extra = []) => parseArgs(['--source', 'niyantran_rehearsal_b9final', '--target', 'niyantran_rehearsal_c2headers', '--out', join(work, `${name}.vec`), ...extra], ARGS);

test('dry run: counts, headers and prices the run, and calls nothing (no embedder, no target, no file)', async () => {
  const w = fakeWorld();
  const lines = [];
  const embedder = () => { throw new Error('the embedder must not be built in a dry run'); };
  const o = optionsFor('dry', ['--dry-run']);
  const r = await runReembed(o, { source: w.source, target: { load: () => { throw new Error('no load in a dry run'); } }, embedder, log: (l) => lines.push(l) });
  assert.equal(r.dryRun, true);
  assert.equal(r.totals.chunks, 12, 'the blank chunk is not counted');
  assert.equal(r.totals.skippedBlank, 1);
  assert.equal(r.features.length, 2);
  assert.ok(r.totals.tokens > r.totals.tokensWithoutHeader, 'the header adds tokens');
  assert.equal(r.totals.estimatedUsd, r.totals.tokens * EMBED_PRICE_USD_PER_TOKEN);
  assert.equal(existsSync(o.out), false);
  assert.ok(lines.some((l) => /NCLT/.test(l) && /chunks/.test(l)), 'prints a line per feature');
  assert.ok(lines.some((l) => /US\$/.test(l)));
});

test('run: embeds header + section + content for every non-blank chunk, exports, and loads the target once', async () => {
  const w = fakeWorld();
  const embed = fakeEmbedder();
  const o = optionsFor('run', ['--concurrency', '1']);
  const r = await runReembed(o, { source: w.source, target: w.target, embedder: () => embed, policy: DEFAULT_POLICY, log: quiet });
  assert.equal(r.stoppedBy, 'complete');
  assert.equal(r.embedded, 12);
  assert.equal(w.loads.length, 1);
  assert.equal(w.loads[0].rows.length, 12);
  const first = w.chunks[0];
  const header = buildChunkHeader(w.docs[0]);
  assert.ok(header.includes('CP 0/2024'));
  const expected = `${header}\n\n${first.content}`;
  assert.ok(embed.inputs().includes(expected), 'the header-prefixed input was embedded');
  const row = w.loads[0].rows.find((x) => x.id === first.id);
  assert.equal(row.embed_hash, await chunkEmbedHash(expected));
  assert.equal(row.chunk_hash, first.chunk_hash, 'the chunk identity is passed through, not recomputed');
  assert.deepEqual([...row.vector], [...fakeVector(expected)]);
  assert.ok(embed.inputs().some((s) => s.includes('PART › n\n\nThe content')), 'a section prefix sits between the header and the text');
  assert.ok(existsSync(o.out));
  assert.ok(r.exportBytes > 0);
});

test('run: a ceiling stops it, nothing is loaded, and a rerun finishes without paying twice', async () => {
  const w = fakeWorld();
  const bounds = { maxCount: 3, maxTokens: 200_000, maxInputTokens: 7_000 };
  const o1 = optionsFor('resume-run', ['--concurrency', '1', '--max-usd', '0.00001']);
  const e1 = fakeEmbedder();
  const r1 = await runReembed(o1, { source: w.source, target: w.target, embedder: () => e1, bounds, log: quiet });
  assert.equal(r1.stoppedBy, 'ceiling');
  assert.ok(r1.embedded > 0 && r1.embedded < 12, `embedded ${r1.embedded}`);
  assert.equal(w.loads.length, 0, 'a partly embedded set is never loaded');

  const o2 = optionsFor('resume-run', ['--concurrency', '1']);
  const e2 = fakeEmbedder();
  const r2 = await runReembed(o2, { source: w.source, target: w.target, embedder: () => e2, bounds, log: quiet });
  assert.equal(r2.stoppedBy, 'complete');
  assert.equal(r1.embedded + r2.embedded, 12);
  assert.equal(w.loads.length, 1);
  for (const s of e1.inputs()) assert.ok(!e2.inputs().includes(s));

  const e3 = fakeEmbedder();
  const r3 = await runReembed(o2, { source: w.source, target: w.target, embedder: () => { throw new Error('nothing left to embed, so no embedder (and no key) is needed'); }, log: quiet });
  assert.equal(r3.embedded, 0);
  assert.equal(e3.calls.length, 0);
  assert.equal(w.loads.length, 2, 'the finished vectors load again from the file');
});

test('run: --features limits what is read, embedded and loaded; --no-load embeds and exports only', async () => {
  const w = fakeWorld();
  const embed = fakeEmbedder();
  const r = await runReembed(optionsFor('feat', ['--features', 'bill', '--no-load']), { source: w.source, target: w.target, embedder: () => embed, log: quiet });
  assert.equal(r.embedded, 4);
  assert.deepEqual(r.features.map((f) => f.feature), ['Bill Passage Probability Index']);
  assert.equal(w.loads.length, 0);
});

test('run: the target-name refusal happens before anything is read or paid for', async () => {
  const w = fakeWorld();
  let touched = false;
  const spy = { features: async () => { touched = true; return []; }, documents: async () => [], chunks: async function* () {} };
  const o = { ...optionsFor('refuse'), target: 'niyantran_retrieval_replica' };
  await assert.rejects(() => runReembed(o, { source: spy, target: w.target, embedder: () => { throw new Error('no'); }, log: quiet }), /refusing/);
  assert.equal(touched, false);
});

// ---- binary export and the docker source/target (e2e) ---------------------------------------------------------

const DB = 'niyantran_reembed_selftest';
const psql = (sql, { db = DB, input } = {}) => {
  const r = spawnSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', db, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', ...(sql ? ['-c', sql] : [])], { input: input ?? '', encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
};

const SCHEMA = (partitioned) => `
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
create table public.documents (id uuid primary key, title text not null, desk_tier text, desk_feature text, metadata jsonb not null default '{}');
create table public.document_chunks (
  id uuid not null, document_id uuid not null references public.documents(id), chunk_hash text not null, chunk_index int not null,
  content text not null, embedding extensions.vector(1536), metadata jsonb not null default '{}', embed_hash text,
  desk_feature text not null, unique (id, desk_feature)
) ${partitioned ? 'partition by list (desk_feature)' : ''};
${partitioned ? `
create table public.document_chunks_nclt partition of public.document_chunks for values in ('NCLT / NCLAT (Insolvency)');
create table public.document_chunks_default partition of public.document_chunks default;
create index document_chunks_embedding_halfvec_hnsw on public.document_chunks using hnsw ((embedding::extensions.halfvec(1536)) extensions.halfvec_cosine_ops);
` : `create index document_chunks_embedding_halfvec_hnsw on public.document_chunks using hnsw ((embedding::extensions.halfvec(1536)) extensions.halfvec_cosine_ops);`}
-- Makes every update non-HOT, as packed pages do on the real table: a HOT-updated old version is never indexed, so on
-- this small table the old versions would not reach the HNSW build and the size check below would prove nothing.
create index document_chunks_embed_hash_idx on public.document_chunks (embed_hash);
`;

function seed() {
  // a distinct old vector per row: HNSW folds equal vectors into one node, which would hide old versions in the index
  const e0 = (i) => `[1${',0'.repeat(EMBED_DIMS - 2)},${(i + 1) / 100}]`;
  const w = fakeWorld({ nDocs: 4, perDoc: 3 });
  const values = [];
  for (const d of w.docs) values.push(`('${d.id}', '${d.title}', 'x', '${d.desk_feature}', '${JSON.stringify(d.metadata)}')`);
  psql(`insert into public.documents values ${values.join(',')}`);
  const rows = w.chunks.map((c, i) => `('${c.id}', '${c.document_id}', '${c.chunk_hash}', ${i}, '${c.content.replace(/'/g, "''")}', '${e0(i)}', '${JSON.stringify(c.section ? { section: c.section } : {})}', null, '${c.desk_feature}')`);
  psql(`insert into public.document_chunks (id, document_id, chunk_hash, chunk_index, content, embedding, metadata, embed_hash, desk_feature) values ${rows.join(',')}`);
  // text that breaks naive line splitting or quoting: U+2028, a lone CR, a quote, a backslash, rupee sign, Devanagari
  psql("update public.document_chunks set content = E'Rs. \\u20b9 5,00,000 \\u2028 line\\rcarriage \\'quoted\\' back\\\\slash \\u0928\\u093f\\u092f\\u0902\\u0924\\u094d\\u0930\\u0923' where id = '" + w.chunks[2].id + "'");
  return w;
}

const snapshot = (what) => psql(`select md5(string_agg(${what}, '|' order by id)) from public.document_chunks`);
const E2E_POLICY = { check: ({ source, target }) => { assert.equal(source, DB); assert.equal(target, DB); } };
const indexNames = () => psql("select string_agg(c.relname || ':' || i.indisvalid || ':' || coalesce((select p.relname from pg_inherits h join pg_class p on p.oid = h.inhparent where h.inhrelid = c.oid), '-'), ',' order by c.relname) from pg_index i join pg_class c on c.oid = i.indexrelid join pg_class t on t.oid = i.indrelid join pg_namespace n on n.oid = t.relnamespace where n.nspname = 'public' and t.relname like 'document_chunks%'");

for (const partitioned of [true, false]) {
  test(`e2e (${partitioned ? 'partitioned' : 'plain'} table): loads header vectors by set-based update, rebuilds the HNSW indexes, leaves content and chunk_hash alone`, async () => {
    psql(`drop database if exists ${DB} with (force)`, { db: 'postgres' });
    psql(`create database ${DB}`, { db: 'postgres' });
    try {
      psql(null, { input: SCHEMA(partitioned) });
      const w = seed();
      const before = { content: snapshot('content'), hash: snapshot('chunk_hash'), indexes: indexNames() };
      assert.match(before.indexes, /document_chunks_embedding_halfvec_hnsw:true/);

      const embed = fakeEmbedder();
      const out = join(work, `e2e-${partitioned}.vec`);
      const o = parseArgs(['--source', DB, '--target', DB, '--out', out, '--concurrency', '2', '--index', 'rebuild'], ARGS);
      const timings = [];
      const r = await runReembed(o, { source: makeDockerSource(DB), target: makeDockerTarget(DB), embedder: () => embed, policy: E2E_POLICY, log: (l) => timings.push(l) });
      assert.equal(r.stoppedBy, 'complete');
      assert.equal(r.loaded, 12, '12 non-blank chunks loaded');
      assert.equal(r.skippedBlank, 1);
      assert.ok(r.load.timings.rebuildMs > 0 && r.load.timings.updateMs >= 0, 'index work is timed');
      assert.ok(timings.some((l) => /index/i.test(l) && /ms|s\b/.test(l)), 'and printed');

      assert.equal(snapshot('content'), before.content, 'content unchanged');
      assert.equal(snapshot('chunk_hash'), before.hash, 'chunk_hash unchanged');
      assert.equal(indexNames(), before.indexes, 'the same indexes, valid, attached the same way');
      assert.equal(psql("select to_regclass('public.reembed_stage') is null"), 't', 'the staging table is gone');

      // The rebuilt index holds live rows only. Built in the update's transaction it also held the old row versions and
      // came out at twice the size (seen on the full corpus: NCLT 1,754 MB against 877 MB).
      const hnswBytes = () => psql("select sum(pg_relation_size(c.oid)) from pg_class c join pg_am a on a.oid = c.relam where a.amname = 'hnsw' and c.relkind = 'i'");
      const loadedBytes = hnswBytes();
      psql('reindex table public.document_chunks');
      assert.equal(loadedBytes, hnswBytes(), 'the rebuilt indexes are the size of a build over live rows alone');

      const first = w.chunks[0];
      const expected = `${buildChunkHeader(w.docs[0])}\n\n${first.content}`;
      const got = psql(`select embed_hash, embedding::text from public.document_chunks where id = '${first.id}'`).split('|');
      assert.equal(got[0], await chunkEmbedHash(expected));
      const stored = JSON.parse(got[1]);
      assert.equal(stored.length, EMBED_DIMS);
      assert.deepEqual(stored.slice(0, 32), [...fakeVector(expected)].slice(0, 32).map(Math.fround));

      const odd = embed.inputs().find((x) => x.includes('\u2028 line\rcarriage'));
      assert.ok(odd && odd.includes("'quoted' back\\slash") && odd.includes('\u20b9') && odd.includes('\u0928'), 'U+2028, CR, quotes, backslash and Devanagari arrive intact');
      assert.equal(psql(`select embed_hash from public.document_chunks where id = '${w.chunks[2].id}'`), await chunkEmbedHash(odd));

      const blank = psql("select embed_hash is null, embedding::text like '[1,0,0%' from public.document_chunks where id = '" + uuid(900) + "'");
      assert.equal(blank, 't|t', 'the blank chunk was not touched');
      assert.equal(psql('select count(*) from public.document_chunks where embed_hash is not null'), '12');

      // the index serves a nearest-neighbour query on the new vectors
      const probe = psql(`set search_path = public, extensions; set enable_seqscan = off; select id from public.document_chunks order by embedding::extensions.halfvec(1536) <=> '[${[...fakeVector(expected)].join(',')}]'::extensions.halfvec(1536) limit 1`).split('\n').pop();
      assert.equal(probe, first.id);

      // a rerun pays nothing and loads the same vectors again
      const again = fakeEmbedder();
      const r2 = await runReembed(o, { source: makeDockerSource(DB), target: makeDockerTarget(DB), embedder: () => again, policy: E2E_POLICY, log: quiet });
      assert.equal(again.calls.length, 0);
      assert.equal(r2.loaded, 12);
      assert.equal(indexNames(), before.indexes);
    } finally {
      psql(`drop database if exists ${DB} with (force)`, { db: 'postgres' });
    }
  });
}

test('e2e (keep index mode): a feature subset is loaded in place; other features keep their old vectors', async () => {
  psql(`drop database if exists ${DB} with (force)`, { db: 'postgres' });
  psql(`create database ${DB}`, { db: 'postgres' });
  try {
    psql(null, { input: SCHEMA(true) });
    const w = seed();
    const before = indexNames();
    const o = parseArgs(['--source', DB, '--target', DB, '--features', 'nclt', '--out', join(work, 'e2e-keep.vec'), '--index', 'keep'], ARGS);
    const r = await runReembed(o, { source: makeDockerSource(DB), target: makeDockerTarget(DB), embedder: () => fakeEmbedder(), policy: E2E_POLICY, log: quiet });
    const nclt = w.chunks.filter((c) => c.desk_feature.startsWith('NCLT') && c.content.trim()).length;
    assert.equal(r.loaded, nclt);
    assert.equal(r.load.timings.rebuildMs, 0, 'no rebuild in keep mode');
    assert.equal(psql("select count(*) from public.document_chunks where embed_hash is not null"), String(nclt));
    assert.equal(psql("select count(*) from public.document_chunks where desk_feature like 'Bill%' and embedding::text like '[1,0,0%'"), String(w.chunks.filter((c) => c.desk_feature.startsWith('Bill')).length));
    assert.equal(indexNames(), before);
  } finally {
    psql(`drop database if exists ${DB} with (force)`, { db: 'postgres' });
  }
});

// ---- run -------------------------------------------------------------------------------------------------------

const ISOLATED = /e2e/;
let failed = 0;
for (const t of tests) {
  if (OFFLINE && ISOLATED.test(t.name)) {
    console.log(`SKIP  ${t.name}`);
    continue;
  }
  try {
    await t.fn();
    console.log(`PASS  ${t.name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL  ${t.name}\n      ${String(error.stack ?? error).split('\n').slice(0, 6).join('\n      ')}`);
  }
}
rmSync(work, { recursive: true, force: true });
console.log(failed ? `\n${failed} of ${tests.length} failed` : `\nall ${tests.length} checks held`);
process.exit(failed ? 1 : 0);
