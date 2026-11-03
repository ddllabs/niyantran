/**
 * The sealed-manifest hash of a registration batch (F278, design
 * docs/research/2026-11-02-batch-registration-design.md section 7.1). ingest_batch_seal recomputes it
 * in SQL (ingest_batch_manifest_sha256) and refuses manifest_hash_mismatch when the two differ, so
 * the runner and the database must agree byte for byte:
 *
 *   SHA-256, lowercase hex, over the UTF-8 bytes of one line per item, sorted by source_key in byte
 *   order (Postgres collate "C"): source_key TAB payload_sha256 TAB content_sha256 TAB chunks TAB
 *   est_tokens LF.
 *
 * Pure apart from Web Crypto; no I/O.
 */

const HEX64 = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();
const hasControl = (text) => [...text].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

function compareBytes(a, b) {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

/** Refuses an item the database would refuse (ingest_batch_add_items and its table's checks). */
export function manifestLine(item) {
  const { source_key: key, payload_sha256: payload, content_sha256: content, chunks, est_tokens: tokens } = item ?? {};
  if (typeof key !== 'string' || key.length < 1 || [...key].length > 1024 || hasControl(key)) {
    throw new Error('manifest item: source_key must be 1 to 1024 characters without control codes');
  }
  if (!HEX64.test(payload ?? '') || !HEX64.test(content ?? '')) throw new Error(`manifest item ${key}: hashes must be 64 lowercase hex`);
  if (!Number.isSafeInteger(chunks) || chunks < 1 || chunks > 800) throw new Error(`manifest item ${key}: chunks must be 1 to 800`);
  if (!Number.isSafeInteger(tokens) || tokens < 0) throw new Error(`manifest item ${key}: est_tokens must be a non-negative integer`);
  return `${key}\t${payload}\t${content}\t${chunks}\t${tokens}\n`;
}

/** The manifest hash of a list of items, in any order. Two items with one source_key are refused. */
export async function manifestSha256(items) {
  const sorted = [...items].sort((a, b) => compareBytes(a.source_key, b.source_key));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].source_key === sorted[i - 1].source_key) throw new Error(`manifest: ${sorted[i].source_key} is listed twice`);
  }
  const text = sorted.map(manifestLine).join('');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
