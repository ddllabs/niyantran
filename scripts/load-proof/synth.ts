// Synthetic documents for the F287 harness, and their registration through the real functions.
//
// A document is a Lok Sabha answer in the shape the batch runner would send (the one supplied-text
// shape the adapter and ingest_register_batch admit besides Law). It is prepared by the real
// prepareSuppliedText and suppliedCommitRows, so its payload, hash and chunk plan are exactly what the
// worker re-plans and compares. Text is pseudo-text from a seeded generator, or, when a text pool of the
// desk exists under ~/niyantran-eval-cache/load-proof/, real chunk text of that desk shuffled by the
// same generator. Either way each document opens with a unique header, so the duplicate-text refusal
// stays armed and no two documents share a text hash.
//
// Registration is as the runner does it: ingest_batch_open, ingest_batch_add_items, ingest_batch_seal and
// ingest_register_batch as corpus_ingest (a PostgREST token for that role; the proof's authenticator is
// a member of it), the policy approved by service_role, and the desk_rows each answer's link needs seeded.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { prepareSuppliedText } from '../../supabase/functions/_shared/suppliedText.ts';
import { suppliedCommitRows } from '../../supabase/functions/ingest-worker/supplied-step.ts';
import { manifestSha256 } from '../../src/lib/batchManifest.js';
import { CACHE_DIR, psql, rng, sha256Hex } from './lib.ts';

export const PQ = { tier: 'national', feature: 'Parliamentary Question Database' } as const;
export const FEATURES = {
  bills: { tier: 'national', feature: 'Bill Passage Probability Index' },
  nclt: { tier: 'law', feature: 'NCLT / NCLAT (Insolvency)' },
  regulatory: { tier: 'national', feature: 'Regulatory Body Watch (RBI SEBI TRAI CCI)' },
  pq: PQ,
  // Not partitioned: lands in document_chunks_default with Parliamentary Questions.
  other: { tier: 'national', feature: 'Proof Feature Without A Partition' },
} as const;
export type FeatureKey = keyof typeof FEATURES;
const BILLS = FEATURES.bills;

const WORDS = (
  'ministry scheme state government allocation fund district programme committee report notified amendment ' +
  'regulation authority board tribunal petition order appeal interest bank account payment rate year review ' +
  'sector policy framework implementation guideline provision section clause bill house member question ' +
  'answer department revenue expenditure outlay target progress coverage beneficiary village urban rural ' +
  'infrastructure project approval clearance compliance penalty notice hearing judgement relief claim ' +
  'creditor debtor resolution liquidation insolvency company director shareholder market securities issue ' +
  'disclosure investor telecom licence spectrum tariff consumer competition merger inquiry commission'
).split(' ');

function sentence(next: () => number): string {
  const n = 9 + Math.floor(next() * 12);
  const w = Array.from({ length: n }, () => WORDS[Math.floor(next() * WORDS.length)]);
  return w.join(' ').replace(/^./, (c) => c.toUpperCase()) + '.';
}

function paragraph(next: () => number, pool: string[] | null): string {
  if (pool?.length) return pool[Math.floor(next() * pool.length)];
  return Array.from({ length: 3 + Math.floor(next() * 4) }, () => sentence(next)).join(' ');
}

// Registration refuses control codes other than tab, LF and CR (control_codes); real chunk text has some.
// deno-lint-ignore no-control-regex
const CONTROL_CODES = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/** Real chunk text of a desk, if the pool file exists (an array of strings). */
export async function loadTextPool(slug: string): Promise<string[] | null> {
  try {
    const v = JSON.parse(await Deno.readTextFile(`${CACHE_DIR}/text-${slug}.json`));
    return Array.isArray(v) && v.length ? v.map((t) => String(t).replace(CONTROL_CODES, ' ')) : null;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
}

/** Chunks per document: the desk's real distribution when a counts file exists, else a long-tailed default. */
export async function loadChunkCounts(slug: string): Promise<number[] | null> {
  try {
    const v = JSON.parse(await Deno.readTextFile(`${CACHE_DIR}/counts-${slug}.json`));
    return Array.isArray(v) && v.length ? v.map(Number).filter((n) => n >= 1 && n <= 800) : null;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
}

/**
 * The largest document the generator asks for. The worker refuses over 800 chunks, and synthetic text came out up
 * to about 43% over a request on real Bills text (2026-11-06: a request of 600 failed 6 times in 12, and 500 reached
 * 595), so the real distribution's far tail is clamped here. Real documents past 800 chunks exist (Bills: 915 and
 * 2,240) and cannot use the supplied-text path at all.
 */
export const MAX_SYNTH_CHUNKS = 500;

export function pickChunkCount(next: () => number, counts: number[] | null): number {
  if (counts) return Math.min(MAX_SYNTH_CHUNKS, counts[Math.floor(next() * counts.length)]);
  return Math.min(120, Math.max(1, Math.round(Math.exp(1.4 + 1.1 * (next() + next() + next() - 1.5) * 1.15))));
}

export interface SynthDoc {
  n: number;
  sourceKey: string;
  chunks: number;
  text: string;
  embeddingInputs: string[];
  /** What ingest_register_batch and ingest_register_text take. */
  request: { payload: string; payload_sha256: string; expected: unknown[]; pages: unknown[]; sections: unknown[] };
  item: { source_key: string; payload_sha256: string; content_sha256: string; chunks: number; est_tokens: number };
  deskRow: { row_key: string; feature?: string; row: Record<string, unknown>; record_text: string };
}

const CHARS_PER_CHUNK = 760; // refined per document below

export async function synthDoc(
  o: { tag: string; n: number; chunks: number; seed: number; textPool?: string[] | null; bill?: boolean },
): Promise<SynthDoc> {
  const { tag, n } = o;
  const next = rng((o.seed * 2654435761 + n) >>> 0);
  const sourceKey = (await sha256Hex(`load-proof:${tag}:${n}`)).slice(0, 40);
  const stem = `AU${n}_${tag}`;
  // A bill's number has to be unique across runs: it comes from the tag, as the source key does.
  const billNumber = String(parseInt(sourceKey.slice(0, 7), 16) + 1000);
  const url = o.bill
    ? `https://sansad.in/getFile/BillsTexts/LSBillTexts/Asintroduced/${billNumber}_2025.pdf?source=legislation`
    : `https://sansad.in/getFile/loksabhaquestions/annex/187/${stem}.pdf?source=pqals`;
  const subject = o.bill ? `The Load Proof ${tag} ${n} Measure Bill, 2025` : `Subject ${tag} ${n}`;
  const header = o.bill ? `BILL NO. ${billNumber} OF 2025 (${tag}).` : `LOK SABHA UNSTARRED QUESTION ${n} (${tag}). ANSWER.`;
  const body = (chars: number) => {
    const parts = [header];
    let len = header.length;
    while (len < chars) {
      const p = paragraph(next, o.textPool ?? null);
      parts.push(p);
      len += p.length + 2;
    }
    return parts.join('\n\n');
  };
  let chars = Math.max(120, Math.round(o.chunks * CHARS_PER_CHUNK));
  let text = body(chars);
  let prepared = await prepare(text);
  // One correction toward the requested chunk count; the manifest records what was really produced.
  if (o.chunks > 3 && Math.abs(prepared.chunks.length - o.chunks) / o.chunks > 0.2) {
    chars = Math.round(chars * o.chunks / Math.max(1, prepared.chunks.length));
    text = body(chars);
    prepared = await prepare(text);
  }

  async function prepare(t: string) {
    const hash = await sha256Hex(t);
    return await prepareSuppliedText({
      source_key: sourceKey,
      title: subject,
      text: t,
      text_sha256: hash,
      desk_tier: PQ.tier,
      desk_feature: o.bill ? BILLS.feature : PQ.feature,
      file_name: `${stem}.pdf`,
      file_url: url,
      ...(o.bill
        ? { document_key: `bill:2025:${billNumber}`, document_role: 'as_introduced' }
        : { document_key_suggested: `pq:ls:187:${stem}` }),
      licence_class: 'gov_open',
      citation: o.bill
        ? {
          kind: 'bill',
          bill_number: billNumber,
          bill_year: '2025',
          house: 'Lok Sabha',
          bill_name: subject,
          status: 'Pending',
          introduced_on: '2025-03-04',
          ministry: 'MINISTRY OF PROOFS',
        }
        : {
          kind: 'parliamentary_question',
          house: 'Lok Sabha',
          session: '187',
          subject,
          ministry: 'MINISTRY OF PROOFS',
          answered_on: '02.04.2026',
        },
      review: {
        status: 'eligible',
        source_key: sourceKey,
        text_sha256: hash,
        rules_sha256: 'a'.repeat(64),
        package_id: 'load-proof',
        mapping_version: 'load-proof-1',
        decision_id: 'load-proof-decision',
        checks: { identity: true, completeness: true, sensitivity: true, dedupe: true, rights: true },
      },
      pages: [],
    }, { batch: true });
  }

  const expected = suppliedCommitRows(prepared.chunks);
  return {
    n,
    sourceKey,
    chunks: prepared.chunks.length,
    text,
    embeddingInputs: prepared.chunks.map((c) => c.embedding_input),
    request: {
      payload: prepared.payload,
      payload_sha256: prepared.payload_sha256,
      expected,
      pages: prepared.pages,
      sections: prepared.sections,
    },
    item: {
      source_key: sourceKey,
      payload_sha256: prepared.payload_sha256,
      content_sha256: await sha256Hex(text),
      chunks: prepared.chunks.length,
      est_tokens: prepared.chunks.reduce((s, c) => s + Math.ceil(c.embedding_input.length / 4), 0),
    },
    deskRow: {
      row_key: `lp-${tag}-${n}`,
      ...(o.bill ? { feature: BILLS.feature } : {}),
      row: o.bill
        ? {
          id: `lp-${tag}-${n}`,
          bill_number: billNumber,
          house: 'Lok Sabha',
          bill_name: subject,
          date_introduced: '2025-03-04',
          source_url: 'https://sansad.in/rs/legislation',
        }
        : {
        id: `lp-${tag}-${n}`,
        house: 'Lok Sabha',
        date: '2026-04-02',
        ministry: 'MINISTRY OF PROOFS',
        subject,
        mp_name: 'Member',
        source_url: url,
      },
      record_text: subject,
    },
  };
}

// ─── Registration ────────────────────────────────────────────────────────────

/** The listing row each answer's link needs (registration refuses no_desk_row without it). */
export async function seedDeskRows(docs: SynthDoc[]): Promise<void> {
  if (!docs.length) return;
  const json = JSON.stringify(docs.map((d) => d.deskRow));
  await psql(
    `insert into public.desk_rows(tier,feature,row_key,row,record_text,snapshot_at)
     select '${PQ.tier}', coalesce(r->>'feature', '${PQ.feature}'), r->>'row_key', r->'row', r->>'record_text', now()
       from jsonb_array_elements($lp$${json}$lp$::jsonb) r
     on conflict do nothing`,
  );
}

const rpc = async <T = unknown>(c: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await c.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
};

/** An active, generous policy for a collection, once. Approved by service_role as the supervisor would. */
export async function ensurePolicy(
  svc: SupabaseClient,
  collection: string,
  stopThresholds: Record<string, number> = {
    refusal_share: 1,
    failure_rate: 1,
    uncertain_max: 1_000_000,
    min_decided: 1,
  },
  admitted: Record<string, unknown> = { desk_tier: PQ.tier, desk_feature: PQ.feature, adapter: 'lok_sabha_answers' },
): Promise<void> {
  if (
    await psql(`select 1 from public.ingest_collection_policies where collection = '${collection}' limit 1`) === '1'
  ) return;
  await rpc(svc, 'ingest_policy_approve', {
    p: {
      collection,
      admitted: [admitted],
      licence_classes: ['gov_open'],
      min_chars_per_page: 600,
      min_pages_for_density: 5,
      require_page_count: false,
      budget_usd: 1_000_000,
      chunk_ceiling: 100_000_000,
      stop_thresholds: stopThresholds,
      decision_id: 'load-proof-policy',
      approver: 'Load Proof Harness',
      evidence_sha256: 'e'.repeat(64),
    },
  });
}

export interface RegisteredBatch {
  batchId: string;
  results: Array<{ outcome: string; reason?: string; document_id?: string; job_id?: string; source_key?: string }>;
  state: string;
}

/** The largest part of an ingest_register_batch call the harness sends; the function refuses over 8 MB. */
export const MAX_CALL_BYTES = 7_000_000;

/**
 * Where the call starting at `start` ends: at most 100 documents and MAX_CALL_BYTES of JSON, counted on the
 * whole request. A request also carries a row per chunk, so the text alone undercounts it.
 */
export function callEnd(requests: unknown[], start: number): number {
  const encoder = new TextEncoder();
  let end = start, bytes = 0;
  while (end < requests.length && end - start < 100) {
    const size = encoder.encode(JSON.stringify(requests[end])).length + 1;
    if (end > start && bytes + size > MAX_CALL_BYTES) break;
    bytes += size;
    end += 1;
  }
  return end;
}

/**
 * Opens, fills, seals and registers one batch (at most 10,000 documents) as corpus_ingest. Documents go
 * up at most 100 and 7 MB at a time (callEnd).
 */
export async function registerBatch(
  runner: SupabaseClient,
  docs: SynthDoc[],
  opts: { collection: string; log?: (m: string) => void },
): Promise<RegisteredBatch> {
  const items = docs.map((d) => d.item);
  const opened = await rpc<{ batch_id?: string; refused?: string; state?: string }>(runner, 'ingest_batch_open', {
    p: {
      collection: opts.collection,
      manifest_sha256: await manifestSha256(items),
      items_planned: items.length,
      chunks_planned: items.reduce((s, i) => s + i.chunks, 0),
      est_tokens: items.reduce((s, i) => s + i.est_tokens, 0),
      est_cost_usd: 1,
      runner_commit: 'abcdef1',
    },
  });
  if (!opened.batch_id) throw new Error(`ingest_batch_open refused: ${JSON.stringify(opened)}`);
  const batchId = opened.batch_id;
  if (opened.state === 'open') {
    for (let i = 0; i < items.length; i += 1000) {
      await rpc(runner, 'ingest_batch_add_items', { p_batch: batchId, p_items: items.slice(i, i + 1000) });
    }
    const sealed = await rpc<{ state?: string; refused?: string }>(runner, 'ingest_batch_seal', { p_batch: batchId });
    if (sealed.state !== 'sealed') throw new Error(`ingest_batch_seal refused: ${JSON.stringify(sealed)}`);
  }
  const results: RegisteredBatch['results'] = [];
  let state = opened.state ?? '';
  for (let i = 0; i < docs.length;) {
    const j = callEnd(docs.map((d) => d.request), i);
    const res = await rpc<{ results: RegisteredBatch['results']; batch?: { state?: string } }>(
      runner,
      'ingest_register_batch',
      {
        p_batch: batchId,
        p_documents: docs.slice(i, j).map((d) => d.request),
        p_dry_run: false,
        p_all_or_nothing: false,
      },
    );
    results.push(...res.results);
    state = res.batch?.state ?? state;
    opts.log?.(`registered ${j}/${docs.length}`);
    i = j;
  }
  return { batchId, results, state };
}

/**
 * Harness only. The adapter and registration admit Law and Lok Sabha answers, so a document meant for
 * another partition is registered as an answer and given its feature here, before its job runs. A
 * supplied-text document is immutable (protect_supplied_text), so triggers are switched off for this one
 * statement on the disposable database. Chunk routing reads documents.desk_feature and nothing else.
 */
export async function relabel(sourceKeys: string[], to: { tier: string; feature: string }): Promise<void> {
  if (!sourceKeys.length) return;
  await psql(
    `begin;
     set local session_replication_role = replica;
     update public.documents set desk_tier = '${to.tier}', desk_feature = '${to.feature.replaceAll("'", "''")}'
      where source_key in (select jsonb_array_elements_text($lp$${JSON.stringify(sourceKeys)}$lp$::jsonb));
     commit;`,
  );
}
