// Bulk runner, T2 (F285): pure planning. Prepared requests in; sealed-manifest batches and calls out, or one
// named reason not to start. No database, no network. Spec: docs/specs/2026-11-07-bulk-runner.md.
import { manifestSha256 } from '../../src/lib/batchManifest.js';
import type { Hold, PreparedRequest } from './prepare.ts';

export const MAX_BATCH_DOCS = 10_000;
export const MAX_CALL_DOCS = 100;
/** The part of an ingest_register_batch call the runner sends; the function refuses over 8 MB (design 5.1). */
export const MAX_CALL_BYTES = 7_000_000;
/** Chunks a feature may hold before it needs its own partition. */
export const UNPARTITIONED_CHUNK_LIMIT = 100_000;
/** Disk the F287 load proof measured per chunk, vectors and indexes included. */
export const BYTES_PER_CHUNK = 13_970;

export interface PlanLimits {
  /** Embedding price, for est_cost_usd. */
  usdPerMTokens: number;
  /** What the collection may still spend and still add. */
  budgetUsd: number;
  chunkCeiling: number;
  /** Disk in use now, and the line at which the run must not go on. */
  diskUsedBytes: number;
  diskStopBytes: number;
  /** Desk features with a partition of their own. */
  partitioned: readonly string[];
  /** Chunks each feature already holds, for the unpartitioned line. */
  chunksNow?: Record<string, number>;
  /** The pack's dedupe list: content hash to the source_key that keeps it. */
  dedupe?: Record<string, string>;
}

export type PlanStop =
  | 'nothing_to_load'
  | 'duplicate_source_key'
  | 'bad_manifest_item'
  | 'duplicate_text'
  | 'unpartitioned_feature_over_100k'
  | 'over_budget'
  | 'over_chunk_ceiling'
  | 'disk_over_stop_line';

export interface PlannedBatch {
  /** Sorted by source_key, so the same pack always makes the same batches and hashes. */
  requests: PreparedRequest[];
  items: PreparedRequest['item'][];
  manifest_sha256: string;
  items_planned: number;
  chunks_planned: number;
  est_tokens: number;
  est_cost_usd: number;
}

export type PlanResult =
  | { ok: true; batches: PlannedBatch[]; holds: Hold[] }
  | { ok: false; stop: PlanStop; detail: string };

const refuse = (stop: PlanStop, detail: string): PlanResult => ({ ok: false, stop, detail });
const encoder = new TextEncoder();

/**
 * Where the call starting at `start` ends: at most 100 documents and MAX_CALL_BYTES of JSON, counted on the whole
 * request, which carries a row per chunk, so the text alone undercounts it. A document over the limit travels alone.
 */
export function callEnd(requests: Pick<PreparedRequest, 'request'>[], start: number): number {
  let end = start, bytes = 0;
  while (end < requests.length && end - start < MAX_CALL_DOCS) {
    const size = encoder.encode(JSON.stringify(requests[end].request)).length + 1;
    if (end > start && bytes + size > MAX_CALL_BYTES) break;
    bytes += size;
    end += 1;
  }
  return end;
}

export function splitCalls(requests: Pick<PreparedRequest, 'request'>[]): Array<{ start: number; end: number }> {
  const calls = [];
  for (let i = 0; i < requests.length;) {
    const end = callEnd(requests, i);
    calls.push({ start: i, end });
    i = end;
  }
  return calls;
}

export async function plan(input: PreparedRequest[], limits: PlanLimits): Promise<PlanResult> {
  if (!input.length) return refuse('nothing_to_load', 'no request to send');
  const requests = [...input].sort((a, b) => a.source_key < b.source_key ? -1 : a.source_key > b.source_key ? 1 : 0);
  for (let i = 1; i < requests.length; i++) {
    if (requests[i].source_key === requests[i - 1].source_key) {
      return refuse('duplicate_source_key', `${requests[i].source_key} is prepared twice`);
    }
  }

  // Two records, one text: the database would refuse the second (duplicate_text), so the pack must say which stays.
  const byText = new Map<string, PreparedRequest[]>();
  for (const r of requests) {
    const group = byText.get(r.item.content_sha256);
    if (group) group.push(r);
    else byText.set(r.item.content_sha256, [r]);
  }
  const holds: Hold[] = [];
  const dropped = new Set<string>();
  for (const [hash, group] of byText) {
    if (group.length < 2) continue;
    const keeper = limits.dedupe && Object.hasOwn(limits.dedupe, hash) ? limits.dedupe[hash] : undefined;
    if (keeper === undefined || !group.some((r) => r.source_key === keeper)) {
      return refuse('duplicate_text', `${group.map((r) => r.source_key).join(', ')} share one text`);
    }
    for (const r of group) {
      if (r.source_key === keeper) continue;
      dropped.add(r.source_key);
      holds.push({ source_key: r.source_key, reason: 'duplicate_of_keeper', detail: keeper });
    }
  }
  const kept = requests.filter((r) => !dropped.has(r.source_key));
  holds.sort((a, b) => String(a.source_key) < String(b.source_key) ? -1 : 1);

  const byFeature = new Map<string, number>();
  let chunks = 0;
  for (const r of kept) {
    byFeature.set(r.desk.feature, (byFeature.get(r.desk.feature) ?? 0) + r.item.chunks);
    chunks += r.item.chunks;
  }
  for (const [feature, n] of byFeature) {
    if (limits.partitioned.includes(feature)) continue;
    const total = n + (limits.chunksNow?.[feature] ?? 0);
    if (total > UNPARTITIONED_CHUNK_LIMIT) {
      return refuse('unpartitioned_feature_over_100k', `${feature} would hold ${total} chunks with no partition`);
    }
  }

  const batches: PlannedBatch[] = [];
  let spend = 0, added = 0;
  for (let i = 0; i < kept.length; i += MAX_BATCH_DOCS) {
    const part = kept.slice(i, i + MAX_BATCH_DOCS);
    const items = part.map((r) => r.item);
    const chunks_planned = items.reduce((s, x) => s + x.chunks, 0);
    const est_tokens = items.reduce((s, x) => s + x.est_tokens, 0);
    // ingest_batch_open refuses a cost of zero.
    const est_cost_usd = Math.max(est_tokens * limits.usdPerMTokens / 1e6, 1e-6);
    spend += est_cost_usd;
    added += chunks_planned;
    if (spend > limits.budgetUsd) {
      return refuse('over_budget', `$${spend} by batch ${batches.length + 1}, budget $${limits.budgetUsd}`);
    }
    if (added > limits.chunkCeiling) {
      return refuse(
        'over_chunk_ceiling',
        `${added} chunks by batch ${batches.length + 1}, ceiling ${limits.chunkCeiling}`,
      );
    }
    let manifest_sha256: string;
    try {
      manifest_sha256 = await manifestSha256(items);
    } catch (e) {
      return refuse('bad_manifest_item', e instanceof Error ? e.message : String(e));
    }
    batches.push({
      requests: part,
      items,
      manifest_sha256,
      items_planned: items.length,
      chunks_planned,
      est_tokens,
      est_cost_usd,
    });
  }
  const projected = limits.diskUsedBytes + chunks * BYTES_PER_CHUNK;
  if (projected > limits.diskStopBytes) {
    return refuse('disk_over_stop_line', `${projected} bytes projected, stop line ${limits.diskStopBytes}`);
  }
  return { ok: true, batches, holds };
}
