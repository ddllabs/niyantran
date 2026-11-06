// E1 of the F287 spec (docs/specs/2026-11-06-ingestion-load-proof.md): the real worker, through real
// PostgREST as service_role, on the database built from the migration chain, with only the outside
// providers faked. Six cases:
//
//   1 single   supplied text, one document each on Bills, NCLT, Regulatory, Parliamentary Questions
//              (default partition) and a feature without a partition (default partition)
//   2 batch    a sealed batch through ingest_register_batch and suppliedBatchStep
//   3 pages    the page path: OCR stage, then chunk_commit, on one partitioned feature
//   4 rerun    the same batch registered again; a finished run requeued
//   5 kill     a worker killed mid-batch
//   6 provider a provider failure
//
//   deno run -A scripts/load-proof/e1.ts                  run every case
//   deno run -A scripts/load-proof/e1.ts --case kill      run one
//   deno run -A scripts/load-proof/e1.ts --break batch:ledger   run with one deliberate break
//   deno run -A scripts/load-proof/e1.ts --prove          run every break and require its named check to fail
//
// A break changes the scenario or the state it is judged on (a document left on the wrong partition, a
// ledger row altered, a worker that does not die, a provider that does not fail), never a check. A check
// is proved able to fail when the run with its break reports it failed. Exit status 1 on any failed
// check, so a clean run exits 0 and a broken one exits 1.
//
// The database is the proof database; start PostgREST first (postgrest.sh up). Every case uses its own
// source keys, so the suite can run again on the same database.

import { runOnce } from '../../supabase/functions/ingest-worker/handler.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { psql, psqlJson, sleep } from './lib.ts';
import { drain, makeHarness } from './driver.ts';
import { makeFakeEmbedder, vectorFor } from './fake-embed.ts';
import { fakePdfSha, fakeStorage, makeFakeOcr } from './fake-ocr.ts';
import {
  ensurePolicy,
  type FeatureKey,
  FEATURES,
  registerBatch,
  relabel,
  seedDeskRows,
  type SynthDoc,
  synthDoc,
} from './synth.ts';

// ─── checks and breaks ───────────────────────────────────────────────────────

interface Outcome {
  case: string;
  check: string;
  ok: boolean;
  detail: string;
}

const outcomes: Outcome[] = [];
let activeCase = '';
let activeBreak: string | null = null;
const brk = (id: string) => activeBreak === id;

function check(name: string, ok: boolean, detail = '') {
  outcomes.push({ case: activeCase, check: name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -- ${detail}`}`);
}

/** Each break, the case it belongs to, and the check that must fail under it. */
export const BREAKS: Array<{ id: string; case: string; fails: string }> = [
  { id: 'single:partition', case: 'single', fails: 'bills: chunks are in document_chunks_bills' },
  { id: 'single:job', case: 'single', fails: 'other: the job succeeded' },
  { id: 'single:facets', case: 'single', fails: 'regulatory: chunk facets equal the document' },
  { id: 'single:search', case: 'single', fails: 'nclt: a search as authenticated returns the document' },
  { id: 'single:count', case: 'single', fails: 'pq: every planned chunk is stored' },
  { id: 'single:date', case: 'single', fails: 'pq: doc_date is the answer date, 2026-04-02' },
  { id: 'batch:admit', case: 'batch', fails: 'every document was admitted' },
  { id: 'batch:jobs', case: 'batch', fails: 'every document is indexed and its job succeeded' },
  { id: 'batch:ledger', case: 'batch', fails: 'the ledger counts match' },
  { id: 'batch:logs', case: 'batch', fails: 'embedding calls carry the batch id' },
  { id: 'batch:onebyone', case: 'batch', fails: 'the batch step shared embedding calls between documents' },
  { id: 'pages:partition', case: 'pages', fails: 'chunks are in document_chunks_bills' },
  { id: 'pages:index', case: 'pages', fails: 'the document is indexed with its pages' },
  { id: 'pages:search', case: 'pages', fails: 'a search as authenticated returns the document' },
  { id: 'pages:ocr', case: 'pages', fails: 'the OCR stage ran once, over every page' },
  { id: 'pages:ocrlog', case: 'pages', fails: 'the OCR call was logged with its cost' },
  { id: 'rerun:reregister', case: 'rerun', fails: 'registering the batch again admits nothing new' },
  { id: 'rerun:chunks', case: 'rerun', fails: 'registering the batch again adds no chunk' },
  { id: 'rerun:held', case: 'rerun', fails: 'the killed run was held before the rerun' },
  { id: 'rerun:corrupt', case: 'rerun', fails: 'the rerun makes no embedding call' },
  { id: 'rerun:newchunks', case: 'rerun', fails: 'the rerun adds no chunk and changes no chunk id' },
  { id: 'kill:nokill', case: 'kill', fails: 'every job of the killed claim is held as text_outcome_uncertain' },
  { id: 'kill:committed', case: 'kill', fails: 'the slice that came back before the kill is committed' },
  { id: 'kill:corrupt', case: 'kill', fails: 'nothing is embedded twice' },
  { id: 'kill:early', case: 'kill', fails: 'requeue finishes every document' },
  { id: 'provider:none', case: 'provider', fails: 'the failed document stopped as embed_failed' },
  { id: 'provider:uncommit', case: 'provider', fails: 'the failed document keeps its committed slice' },
  { id: 'provider:others', case: 'provider', fails: 'the other documents finished' },
  { id: 'provider:search', case: 'provider', fails: 'the other documents are searchable' },
  { id: 'provider:log', case: 'provider', fails: 'the failed call was logged' },
];

// ─── helpers ─────────────────────────────────────────────────────────────────

const tagOf = (suffix: string) => `e1${Date.now().toString(36)}${suffix}`;
const ids = (xs: string[]) => `array[${xs.map((x) => `'${x}'`).join(',')}]::uuid[]`;
const PARTITION: Record<FeatureKey, string> = {
  bills: 'document_chunks_bills',
  nclt: 'document_chunks_nclt',
  regulatory: 'document_chunks_regulatory',
  pq: 'document_chunks_default',
  other: 'document_chunks_default',
};

/**
 * ingest_claim returns at most claim_batch jobs and never more than max_running less those running, so a
 * batch claim of n jobs needs max_running of at least n (the defaults are 1 and 2).
 */
async function setClaimBatch(n: number, maxRunning = 2) {
  await psql(`update public.ingest_settings set claim_batch = ${n}, max_running = ${Math.max(maxRunning, n)}`);
}

async function registerSingle(svc: SupabaseClient, doc: SynthDoc): Promise<{ document_id: string; job_id: string }> {
  const { data, error } = await svc.rpc('ingest_register_text', { p: doc.request });
  if (error) throw new Error(`ingest_register_text: ${error.message}`);
  return data as { document_id: string; job_id: string };
}

const pendingOf = (docIds: string[]) => async () =>
  Number(
    await psql(
      `select count(*) from public.ingest_jobs where document_id = any(${
        ids(docIds)
      }) and status in ('queued','running')`,
    ),
  );

const jobsOf = (docIds: string[]) =>
  psqlJson<
    Array<{ document_id: string; status: string; stage: string; error_code: string | null; batch_id: string | null }>
  >(
    `select document_id, status, stage, error_code, batch_id from public.ingest_jobs where document_id = any(${
      ids(docIds)
    }) order by created_at`,
  );

const chunkIdsHash = async (docIds: string[]) =>
  await psql(
    `select count(*) || ':' || coalesce(md5(string_agg(id::text, ',' order by id)), '') from public.document_chunks where document_id = any(${
      ids(docIds)
    })`,
  );

async function hitsDocument(
  auth: SupabaseClient,
  doc: SynthDoc,
  documentId: string,
  scope: { tier: string; feature: string } | null,
): Promise<boolean> {
  const v = await vectorFor(doc.embeddingInputs[0]);
  const { data, error } = await auth.rpc('match_documents', {
    query_embedding: `[${Array.from(v).join(',')}]`,
    match_count: 5,
    ...(scope ? { p_desk_tier: scope.tier, p_desk_feature: scope.feature } : {}),
  });
  if (error) throw new Error(`match_documents: ${error.message}`);
  return (data as Array<{ document_id: string }>).some((r) => r.document_id === documentId);
}

// ─── case 1: supplied text, one document on each feature ─────────────────────

async function caseSingle() {
  await setClaimBatch(1, 2);
  const h = await makeHarness();
  const auth = await h.rest.client('authenticated');
  const tag = tagOf('s');
  const keys = Object.keys(FEATURES) as FeatureKey[];
  const docs = new Map<FeatureKey, SynthDoc>();
  const reg = new Map<FeatureKey, { document_id: string; job_id: string }>();
  let n = 0;
  for (const k of keys) docs.set(k, await synthDoc({ tag, n: ++n, chunks: 9, seed: 11 }));
  await seedDeskRows([...docs.values()]);
  for (const k of keys) {
    reg.set(k, await registerSingle(h.svc, docs.get(k)!));
    if (k !== 'pq' && !(brk('single:partition') && k === 'bills')) await relabel([docs.get(k)!.sourceKey], FEATURES[k]);
  }
  const docIds = [...reg.values()].map((r) => r.document_id);
  await drain(h, { pending: pendingOf(docIds) });

  // Deliberate breaks act on the state the checks judge.
  if (brk('single:job')) {
    await psql(
      `update public.ingest_jobs set status = 'failed', stage = 'index', error_code = 'broken', finished_at = now() where document_id = '${
        reg.get('other')!.document_id
      }'`,
    );
  }
  if (brk('single:facets')) {
    await psql(
      `begin; set local session_replication_role = replica; update public.document_chunks set desk_tier = 'state' where document_id = '${
        reg.get('regulatory')!.document_id
      }'; commit;`,
    );
  }
  if (brk('single:search')) {
    await psql(
      `update public.document_chunks set embedding = null where document_id = '${reg.get('nclt')!.document_id}'`,
    );
  }
  if (brk('single:date')) {
    await psql(
      `begin; set local session_replication_role = replica; update public.document_chunks set doc_date = '2026-04-03' where document_id = '${
        reg.get('pq')!.document_id
      }'; commit;`,
    );
  }
  if (brk('single:count')) {
    await psql(
      `delete from public.document_chunks where id = (select id from public.document_chunks where document_id = '${
        reg.get('pq')!.document_id
      }' limit 1)`,
    );
  }

  for (const k of keys) {
    const doc = docs.get(k)!, id = reg.get(k)!.document_id, f = FEATURES[k];
    const [job] = await jobsOf([id]);
    check(`${k}: the job succeeded`, job?.status === 'succeeded' && job.stage === 'done', JSON.stringify(job));
    const parts = await psqlJson<Array<{ part: string; n: number }>>(
      `select tableoid::regclass::text part, count(*)::int n from public.document_chunks where document_id = '${id}' group by 1`,
    );
    check(
      `${k}: chunks are in ${PARTITION[k]}`,
      parts.length === 1 && parts[0].part === `public.${PARTITION[k]}` ||
        parts.length === 1 && parts[0].part === PARTITION[k],
      JSON.stringify(parts),
    );
    const stored = parts.reduce((s, p) => s + p.n, 0);
    check(`${k}: every planned chunk is stored`, stored === doc.chunks, `${stored} of ${doc.chunks}`);
    const bad = Number(
      await psql(`select count(*) from public.document_chunks c join public.documents d on d.id = c.document_id
      where d.id = '${id}' and (c.desk_feature is distinct from d.desk_feature or c.desk_tier is distinct from d.desk_tier
        or c.doc_date is distinct from public.document_date_facet(d.desk_feature, d.metadata) or c.language is distinct from d.metadata->>'language')`),
    );
    const feature = await psql(`select desk_tier || '|' || desk_feature from public.documents where id = '${id}'`);
    check(
      `${k}: chunk facets equal the document`,
      bad === 0 && feature === `${f.tier}|${f.feature}`,
      `${bad} chunks differ; document is ${feature}`,
    );
    if (k === 'pq') {
      const dates = await psql(
        `select string_agg(distinct doc_date::text, ',') from public.document_chunks where document_id = '${id}'`,
      );
      check('pq: doc_date is the answer date, 2026-04-02', dates === '2026-04-02', dates);
    }
    const scoped = await hitsDocument(auth, doc, id, f);
    const unscoped = await hitsDocument(auth, doc, id, null);
    check(
      `${k}: a search as authenticated returns the document`,
      scoped && unscoped,
      `scoped ${scoped}, unscoped ${unscoped}`,
    );
  }
  h.close();
}

// ─── case 2: a sealed batch ──────────────────────────────────────────────────

async function caseBatch() {
  const h = await makeHarness();
  await setClaimBatch(10, 10);
  const tag = tagOf('b');
  const docs: SynthDoc[] = [];
  for (let n = 1; n <= 12; n++) docs.push(await synthDoc({ tag, n, chunks: 12, seed: 21 }));
  await seedDeskRows(docs);
  await ensurePolicy(h.svc, 'national-pq');
  const runner = await h.rest.client('corpus_ingest');
  const reg = await registerBatch(runner, docs, { collection: 'national-pq' });
  const docIds = reg.results.map((r) => r.document_id!).filter(Boolean);
  if (brk('batch:onebyone')) await setClaimBatch(1);
  await drain(h, { pending: pendingOf(docIds) });
  await setClaimBatch(1);

  if (brk('batch:admit')) reg.results[0].outcome = 'refused';
  if (brk('batch:jobs')) {
    await psql(
      `update public.ingest_jobs set status = 'failed', stage = 'index', finished_at = now() where document_id = '${
        docIds[0]
      }'`,
    );
  }
  if (brk('batch:ledger')) {
    await psql(
      `update public.ingest_batch_items set outcome = 'refused', reason = 'broken' where batch_id = '${reg.batchId}' and source_key = '${
        docs[0].sourceKey
      }'`,
    );
  }
  if (brk('batch:logs')) {
    await psql(
      `update public.model_call_logs set raw_usage = raw_usage - 'batch_id' where raw_usage->>'batch_id' = '${reg.batchId}'`,
    );
  }

  check(
    'every document was admitted',
    reg.results.length === docs.length && reg.results.every((r) => r.outcome === 'admitted'),
    JSON.stringify(reg.results.map((r) => r.outcome)),
  );
  const jobs = await jobsOf(docIds);
  const indexed = Number(
    await psql(`select count(*) from public.documents where id = any(${ids(docIds)}) and indexed_at is not null`),
  );
  check(
    'every document is indexed and its job succeeded',
    jobs.length === docs.length && jobs.every((j) => j.status === 'succeeded' && j.batch_id === reg.batchId) &&
      indexed === docs.length,
    `${indexed} indexed; ${JSON.stringify(jobs.map((j) => j.status))}`,
  );

  const chunksPlanned = docs.reduce((s, d) => s + d.chunks, 0);
  const stored = Number(
    await psql(`select count(*) from public.document_chunks where document_id = any(${ids(docIds)})`),
  );
  const items = await psqlJson<Array<{ outcome: string; n: number }>>(
    `select outcome, count(*)::int n from public.ingest_batch_items where batch_id = '${reg.batchId}' group by 1`,
  );
  const status = await psql(
    `select state || '|' || items_planned || '|' || chunks_planned from public.ingest_batches where id = '${reg.batchId}'`,
  );
  const admittedItems = items.find((i) => i.outcome === 'admitted')?.n ?? 0;
  check(
    'the ledger counts match',
    admittedItems === docs.length && items.length === 1 && status.endsWith(`|${docs.length}|${chunksPlanned}`) &&
      stored === chunksPlanned,
    `items ${JSON.stringify(items)}; batch ${status}; stored ${stored} of ${chunksPlanned}`,
  );

  const calls = await psqlJson<Array<{ batch_id: string | null; jobs: number }>>(
    `select raw_usage->>'batch_id' batch_id, coalesce(jsonb_array_length(raw_usage->'job_ids'), 1)::int jobs from public.model_call_logs
      where purpose = 'embedding' and raw_usage->>'job_id' in (select id::text from public.ingest_jobs where document_id = any(${
      ids(docIds)
    }))`,
  );
  check(
    'embedding calls carry the batch id',
    calls.length > 0 && calls.every((c) => c.batch_id === reg.batchId),
    JSON.stringify(calls),
  );
  check(
    'the batch step shared embedding calls between documents',
    calls.length > 0 && calls.length < docs.length && calls.some((c) => c.jobs > 1),
    `${calls.length} calls for ${docs.length} documents`,
  );
  h.close();
}

// ─── case 3: the page path ───────────────────────────────────────────────────

async function casePages() {
  await setClaimBatch(1);
  const ocr = makeFakeOcr();
  const h = await makeHarness({ ocr: ocr.ocr, storage: fakeStorage });
  const auth = await h.rest.client('authenticated');
  const tag = tagOf('p');
  const feature = brk('pages:partition') ? FEATURES.other : FEATURES.bills;
  const sha = await fakePdfSha(tag), pages = brk('pages:ocr') ? 30 : 4;
  await psql(`insert into storage.buckets(id, name) values ('corpus', 'corpus') on conflict do nothing;
    insert into storage.objects(bucket_id, name, metadata) values ('corpus', 'files/${sha}.pdf', '{"size": 4096}')`);
  const { data, error } = await h.svc.rpc('ingest_register', {
    p: {
      source_key: `lp-pages-${tag}`,
      title: `Page path ${tag}`,
      file_sha256: sha,
      page_count: pages,
      desk_tier: feature.tier,
      desk_feature: feature.feature,
      files: [{
        part_index: 0,
        page_offset: 0,
        page_count: pages,
        sha256: sha,
        byte_size: 4096,
        storage_path: `files/${sha}.pdf`,
      }],
    },
  });
  if (error) throw new Error(`ingest_register: ${error.message}`);
  const id = (data as { document_id: string }).document_id;
  await drain(h, { pending: pendingOf([id]) });
  if (brk('pages:ocrlog')) {
    await psql(`delete from public.model_call_logs where purpose = 'ocr' and raw_usage->>'document_id' = '${id}'`);
  }
  if (brk('pages:index')) {
    await psql(
      `begin; set local session_replication_role = replica; update public.documents set indexed_at = null where id = '${id}'; commit;`,
    );
  }
  if (brk('pages:search')) await psql(`update public.document_chunks set embedding = null where document_id = '${id}'`);

  const [job] = await jobsOf([id]);
  const doc = (await psqlJson<Array<{ indexed_at: string | null; page_count: number; pages: number }>>(
    `select d.indexed_at, d.page_count, (select count(*)::int from public.document_pages p where p.document_id = d.id) pages from public.documents d where d.id = '${id}'`,
  ))[0];
  check(
    'the document is indexed with its pages',
    job?.status === 'succeeded' && doc.indexed_at !== null && doc.pages === pages && doc.page_count === pages,
    JSON.stringify({ job, doc }),
  );
  const parts = await psqlJson<Array<{ part: string; n: number }>>(
    `select tableoid::regclass::text part, count(*)::int n from public.document_chunks where document_id = '${id}' group by 1`,
  );
  check(
    'chunks are in document_chunks_bills',
    parts.length === 1 && parts[0].part.endsWith('document_chunks_bills') && parts[0].n > 0,
    JSON.stringify(parts),
  );
  check(
    'the OCR stage ran once, over every page',
    ocr.requests.length === 1 && ocr.requests[0].join() === '0,1,2,3',
    JSON.stringify(ocr.requests),
  );
  const ocrLog = Number(
    await psql(
      `select count(*) from public.model_call_logs where purpose = 'ocr' and raw_usage->>'document_id' = '${id}' and cost_usd > 0`,
    ),
  );
  check('the OCR call was logged with its cost', ocrLog === 1, `${ocrLog} rows`);
  // The fake embedder is keyed by text, so the search embeds the stored chunk's own embedding input.
  const v = await vectorFor(h.embedder.seenInputs()[0]);
  const { data: hits, error: se } = await auth.rpc('match_documents', {
    query_embedding: `[${Array.from(v).join(',')}]`,
    match_count: 5,
    p_desk_tier: feature.tier,
    p_desk_feature: feature.feature,
  });
  if (se) throw new Error(`match_documents: ${se.message}`);
  check(
    'a search as authenticated returns the document',
    (hits as Array<{ document_id: string }>).some((r) => r.document_id === id),
    `${(hits as unknown[]).length} hits`,
  );
  h.close();
}

// ─── case 4: reruns ──────────────────────────────────────────────────────────

async function caseRerun() {
  const embedder = makeFakeEmbedder();
  const h = await makeHarness({ embedder });
  await setClaimBatch(10, 10);
  const tag = tagOf('r');
  const docs: SynthDoc[] = [];
  for (let n = 1; n <= 6; n++) docs.push(await synthDoc({ tag, n, chunks: 8, seed: 31 }));
  await seedDeskRows(docs);
  await ensurePolicy(h.svc, 'national-pq');
  const runner = await h.rest.client('corpus_ingest');
  const first = await registerBatch(runner, docs, { collection: 'national-pq' });
  const docIds = first.results.map((r) => r.document_id!);
  await drain(h, { pending: pendingOf(docIds) });
  const before = await chunkIdsHash(docIds);
  const jobsBefore = Number(
    await psql(`select count(*) from public.ingest_jobs where document_id = any(${ids(docIds)})`),
  );
  const callsBefore = embedder.calls;

  // (a) The same batch registered again.
  const again = await registerBatch(runner, docs, { collection: 'national-pq' });
  if (brk('rerun:reregister')) again.results[0].outcome = 'admitted';
  if (brk('rerun:chunks')) {
    await psql(
      `insert into public.document_chunks(document_id, chunk_hash, chunk_index, char_from, char_to, chunker_version, content, desk_feature) values ('${
        docIds[0]
      }', 'zz${tag}', 99, 0, 5, 4, 'extra', '${FEATURES.pq.feature}')`,
    );
  }
  await drain(h, { pending: pendingOf(docIds) });
  const docsAfter = Number(await psql(`select count(*) from public.documents where id = any(${ids(docIds)})`));
  const jobsAfter = Number(
    await psql(`select count(*) from public.ingest_jobs where document_id = any(${ids(docIds)})`),
  );
  check(
    'registering the batch again admits nothing new',
    again.batchId === first.batchId && again.results.every((r) => r.outcome === 'existing') &&
      docsAfter === docs.length && jobsAfter === jobsBefore,
    JSON.stringify({
      same: again.batchId === first.batchId,
      outcomes: again.results.map((r) => r.outcome),
      docsAfter,
      jobsAfter,
    }),
  );
  check(
    'registering the batch again adds no chunk',
    await chunkIdsHash(docIds) === before && embedder.calls === callsBefore,
    `${before} -> ${await chunkIdsHash(docIds)}; embed calls ${callsBefore} -> ${embedder.calls}`,
  );

  // (b) A run killed after every slice was committed and before activation, then requeued.
  const extra: SynthDoc[] = [];
  for (let n = 101; n <= 103; n++) extra.push(await synthDoc({ tag, n, chunks: 10, seed: 32 }));
  await seedDeskRows(extra);
  const second = await registerBatch(runner, extra, { collection: 'national-pq' });
  const eIds = second.results.map((r) => r.document_id!);
  const jobIds = second.results.map((r) => r.job_id!);
  let reached = false;
  const w = h.workerDeps();
  const killedDeps = {
    ...w.deps,
    db: {
      ...w.deps.db,
      textActivate: () => {
        reached = true;
        return new Promise<void>(() => {});
      },
    },
  };
  void runOnce(killedDeps);
  for (let i = 0; i < 200 && !reached; i++) await sleep(50);
  if (!reached) throw new Error('the worker never reached activation');
  const stored = await chunkIdsHash(eIds);
  await psql(
    `update public.ingest_jobs set lease_until = now() - interval '1 second' where document_id = any(${
      ids(eIds)
    }) and status = 'running'`,
  );
  await drain(h, { pending: pendingOf(eIds) });
  if (brk('rerun:held')) {
    await psql(`update public.ingest_jobs set error_code = 'broken' where document_id = any(${ids(eIds)})`);
  }
  const held = await jobsOf(eIds);
  if (brk('rerun:corrupt')) {
    await psql(
      `update public.document_chunks set embed_hash = repeat('0', 64) where id = (select id from public.document_chunks where document_id = any(${
        ids(eIds)
      }) limit 1)`,
    );
  }
  const callsMid = embedder.calls;
  const rq = await runner.rpc('ingest_batch_requeue', { p_batch: second.batchId, p_job_ids: jobIds });
  await drain(h, { pending: pendingOf(eIds) });
  if (brk('rerun:newchunks')) {
    await psql(
      `insert into public.document_chunks(document_id, chunk_hash, chunk_index, char_from, char_to, chunker_version, content, desk_feature) values ('${
        eIds[0]
      }', 'yy${tag}', 98, 0, 5, 4, 'extra', '${FEATURES.pq.feature}')`,
    );
  }
  const finalJobs = await jobsOf(eIds);
  check(
    'the killed run was held before the rerun',
    held.length === 3 && held.every((j) => j.status === 'failed' && j.error_code === 'text_outcome_uncertain'),
    JSON.stringify({ held, rq: rq.error?.message }),
  );
  check('the rerun makes no embedding call', embedder.calls === callsMid, `${embedder.calls - callsMid} calls`);
  check(
    'the rerun adds no chunk and changes no chunk id',
    await chunkIdsHash(eIds) === stored && finalJobs.every((j) => j.status === 'succeeded'),
    `${stored} -> ${await chunkIdsHash(eIds)}; ${JSON.stringify(finalJobs.map((j) => j.status))}`,
  );
  h.close();
}

// ─── case 5: a worker killed mid-batch ───────────────────────────────────────

async function caseKill() {
  // The second embedding call never returns: the worker is gone while it waits.
  let hungAt = 0;
  const embedder = makeFakeEmbedder({
    hang: (_i, call) => {
      if (call === (brk('kill:committed') ? 1 : 2) && !brk('kill:nokill')) {
        hungAt = call;
        return true;
      }
      return false;
    },
  });
  const h = await makeHarness({ embedder });
  await setClaimBatch(20, 20);
  const tag = tagOf('k');
  const docs: SynthDoc[] = [];
  for (let n = 1; n <= 12; n++) docs.push(await synthDoc({ tag, n, chunks: 12, seed: 41 }));
  await seedDeskRows(docs);
  await ensurePolicy(h.svc, 'national-pq');
  const runner = await h.rest.client('corpus_ingest');
  const reg = await registerBatch(runner, docs, { collection: 'national-pq' });
  const docIds = reg.results.map((r) => r.document_id!), jobIds = reg.results.map((r) => r.job_id!);
  const total = docs.reduce((s, d) => s + d.chunks, 0);

  const w = h.workerDeps();
  const run = runOnce(w.deps);
  if (brk('kill:nokill')) await run;
  else for (let i = 0; i < 400 && !hungAt; i++) await sleep(50);
  if (!brk('kill:nokill') && !hungAt) throw new Error('the worker never reached its second embedding call');
  const committed = Number(
    await psql(`select count(*) from public.document_chunks where document_id = any(${ids(docIds)})`),
  );
  await psql(
    `update public.ingest_jobs set lease_until = now() - interval '1 second' where document_id = any(${
      ids(docIds)
    }) and status = 'running'`,
  );
  await drain(h, { pending: pendingOf(docIds) });
  const held = await jobsOf(docIds);
  check(
    'every job of the killed claim is held as text_outcome_uncertain',
    held.length === docs.length &&
      held.every((j) => j.status === 'failed' && j.error_code === 'text_outcome_uncertain'),
    JSON.stringify(held.map((j) => `${j.status}/${j.error_code}`)),
  );
  check(
    'the slice that came back before the kill is committed',
    committed > 0 && committed < total,
    `${committed} of ${total} chunks`,
  );

  const paidBefore = embedder.inputsEmbedded;
  if (brk('kill:corrupt')) {
    await psql(
      `update public.document_chunks set embed_hash = repeat('0', 64) where document_id = any(${ids(docIds)})`,
    );
  }
  const rq = await runner.rpc('ingest_batch_requeue', { p_batch: reg.batchId, p_job_ids: jobIds });
  const requeued =
    ((rq.data as { results?: Array<{ outcome: string }> } | null)?.results ?? []).filter((r) =>
      r.outcome === 'requeued'
    ).length;
  if (brk('kill:early')) {
    await psql(`update public.ingest_jobs set status = 'failed', error_code = 'broken' where id = '${jobIds[0]}'`);
  }
  if (!brk('kill:early')) await drain(h, { pending: pendingOf(docIds) });
  else await drain(h, { pending: pendingOf(docIds.slice(1)) });
  const done = await jobsOf(docIds);
  const stored = Number(
    await psql(`select count(*) from public.document_chunks where document_id = any(${ids(docIds)})`),
  );
  check(
    'requeue finishes every document',
    done.every((j) => j.status === 'succeeded') && stored === total,
    `requeued ${requeued}; ${JSON.stringify(done.map((j) => j.status))}; ${stored} of ${total} chunks${
      rq.error ? '; ' + rq.error.message : ''
    }`,
  );
  const again = embedder.repeated();
  check(
    'nothing is embedded twice',
    again.length === 0 && embedder.inputsEmbedded - paidBefore === total - committed,
    `${again.length} inputs repeated; ${embedder.inputsEmbedded - paidBefore} embedded after requeue, ${
      total - committed
    } were uncommitted`,
  );
  h.close();
}

// ─── case 6: a provider failure ──────────────────────────────────────────────

async function caseProvider() {
  await setClaimBatch(1);
  const tag = tagOf('f');
  const docs = [
    await synthDoc({ tag, n: 1, chunks: 4, seed: 51 }),
    await synthDoc({ tag, n: 2, chunks: 230, seed: 52 }),
    await synthDoc({ tag, n: 3, chunks: 4, seed: 53 }),
  ];
  const big = docs[1];
  // The provider fails the call that carries the big document's second slice (its 101st chunk on).
  const embedder = makeFakeEmbedder({
    fail: (
      inputs,
    ) => (!brk('provider:none') && inputs[0] === big.embeddingInputs[100] ? new Error('provider down: 503') : null),
  });
  const h = await makeHarness({ embedder });
  const auth = await h.rest.client('authenticated');
  await seedDeskRows(docs);
  const reg = [];
  for (const d of docs) reg.push(await registerSingle(h.svc, d));
  const docIds = reg.map((r) => r.document_id);
  await drain(h, { pending: pendingOf(docIds) });
  if (brk('provider:uncommit')) await psql(`delete from public.document_chunks where document_id = '${docIds[1]}'`);
  if (brk('provider:search')) {
    await psql(`update public.document_chunks set embedding = null where document_id = '${docIds[0]}'`);
  }
  if (brk('provider:log')) {
    await psql(
      `delete from public.model_call_logs where status = 'error' and raw_usage->>'document_id' = '${docIds[1]}'`,
    );
  }
  if (brk('provider:others')) {
    await psql(
      `update public.ingest_jobs set status = 'failed', stage = 'index', error_code = 'broken', finished_at = now() where document_id = '${
        docIds[2]
      }'`,
    );
  }

  const jobs = await jobsOf(docIds);
  const failed = (await psqlJson<Array<{ error_code: string; last_error: string }>>(
    `select error_code, last_error from public.ingest_jobs where document_id = '${docIds[1]}'`,
  ))[0];
  check(
    'the failed document stopped as embed_failed',
    jobs[1].status === 'failed' && failed?.error_code === 'embed_failed',
    JSON.stringify({ job: jobs[1], failed }),
  );
  const committed = Number(
    await psql(`select count(*) from public.document_chunks where document_id = '${docIds[1]}'`),
  );
  const indexed = await psql(`select indexed_at is not null from public.documents where id = '${docIds[1]}'`);
  check(
    'the failed document keeps its committed slice',
    committed === 100 && indexed === 'f',
    `${committed} chunks stored, indexed ${indexed}`,
  );
  check(
    'the other documents finished',
    jobs[0].status === 'succeeded' && jobs[2].status === 'succeeded',
    JSON.stringify(jobs.map((j) => j.status)),
  );
  const hits = [await hitsDocument(auth, docs[0], docIds[0], null), await hitsDocument(auth, docs[2], docIds[2], null)];
  check('the other documents are searchable', hits[0] && hits[1], JSON.stringify(hits));
  const errLog = Number(
    await psql(
      `select count(*) from public.model_call_logs where purpose = 'embedding' and status = 'error' and raw_usage->>'document_id' = '${
        docIds[1]
      }'`,
    ),
  );
  check('the failed call was logged', errLog === 1, `${errLog} error rows`);
  h.close();
}

// ─── main ────────────────────────────────────────────────────────────────────

const CASES: Record<string, () => Promise<void>> = {
  single: caseSingle,
  batch: caseBatch,
  pages: casePages,
  rerun: caseRerun,
  kill: caseKill,
  provider: caseProvider,
};

async function runCase(name: string, brokenWith: string | null) {
  activeCase = name;
  activeBreak = brokenWith;
  console.log(`\n== ${name}${brokenWith ? `  [break ${brokenWith}]` : ''}`);
  try {
    await CASES[name]();
  } catch (e) {
    check(`${name}: ran to completion`, false, (e as Error).message);
  } finally {
    await setClaimBatch(1, 2).catch(() => {});
  }
}

const arg = (flag: string) => {
  const i = Deno.args.indexOf(flag);
  return i >= 0 ? Deno.args[i + 1] : null;
};

if (import.meta.main) {
  const only = arg('--case');
  const onlyBreak = arg('--break');
  const names = only ? [only] : Object.keys(CASES);
  for (const n of names) if (!CASES[n]) throw new Error(`no case ${n}; cases are ${Object.keys(CASES).join(', ')}`);

  if (Deno.args.includes('--prove')) {
    // Every case clean, then every break: its named check must fail and the case must otherwise run.
    const verdicts: Array<{ break: string; check: string; failed: boolean }> = [];
    const cleanChecks: Outcome[] = [];
    for (const n of names) {
      const at = outcomes.length;
      await runCase(n, null);
      cleanChecks.push(...outcomes.slice(at));
      for (const b of BREAKS.filter((x) => x.case === n)) {
        const from = outcomes.length;
        await runCase(n, b.id);
        const failed = outcomes.slice(from).some((o) => o.check === b.fails && !o.ok);
        verdicts.push({ break: b.id, check: b.fails, failed });
      }
    }
    console.log('\n== proof that each check can fail');
    for (const v of verdicts) {
      console.log(`  ${v.failed ? 'FAILS-AS-REQUIRED' : 'DID-NOT-FAIL'}  ${v.break}  ->  ${v.check}`);
    }
    const unproved = verdicts.filter((v) => !v.failed).length;
    // Per-feature checks are one piece of code run five times; a break names one feature's instance.
    const kind = (name: string) =>
      name.replace(/^(bills|nclt|regulatory|pq|other): /, '').replace(/document_chunks_\w+/, 'document_chunks_X');
    const covered = new Set(BREAKS.map((b) => kind(b.fails)));
    const uncovered = [...new Set(cleanChecks.map((o) => kind(o.check)))].filter((k) => !covered.has(k));
    const cleanFailed = cleanChecks.filter((o) => !o.ok);
    console.log(`\nclean runs: ${cleanChecks.length - cleanFailed.length} of ${cleanChecks.length} checks passed`);
    for (const o of cleanFailed) console.log(`  CLEAN-FAILED  ${o.case}: ${o.check}  ${o.detail}`);
    for (const k of uncovered) console.log(`  NO-BREAK-FOR  ${k}`);
    console.log(`${verdicts.length} breaks, ${unproved} not detected, ${uncovered.length} check kinds without a break`);
    Deno.exit(unproved === 0 && uncovered.length === 0 && cleanFailed.length === 0 ? 0 : 1);
  }

  for (const n of names) {
    await runCase(
      n,
      onlyBreak && BREAKS.find((b) => b.id === onlyBreak)?.case === n ? onlyBreak : null,
    );
  }
  const failed = outcomes.filter((o) => !o.ok);
  console.log(`\n${outcomes.length - failed.length} of ${outcomes.length} checks passed`);
  Deno.exit(failed.length ? 1 : 0);
}
