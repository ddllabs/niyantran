/**
 * Which attached records have full text behind them, and which are only a row.
 *
 * A desk row carries `document_key` (`bill:2026:153`); a document carries the
 * same string at `metadata->>'document_key'`. research-chat scopes document
 * search to the keys a turn sends (validate.ts documentKeysOf), so a record
 * whose key matches no indexed document can only ever be answered from its
 * tabular columns - the turn reports "Search widened" and cites desk rows.
 *
 * That is honest but it arrives too late, after the question. Coverage is
 * sparse and unevenly so: of 9,415 distinct desk keys, 1,235 resolve to an
 * indexed document. Nothing in the panel said which kind of record you had
 * attached, so "why did it not read the bill" had no answer on screen.
 *
 * Read live rather than materialised onto desk_rows. The answer changes only
 * when the corpus is ingested, but it is a two-sided fact - the loader writes
 * the rows and the ingest writes the documents - so a stored flag has two
 * writers and can be wrong in a way this cannot. `documents_document_key`
 * already indexes the expression, and a turn attaches at most twelve records.
 *
 * Answers expire (Amendment A, D9). Admins now link, unlink and delete
 * documents from the Documents page, so an answer is trusted for
 * COVERAGE_TTL_MS, and the panel calls `refreshCoverage` when a key is newly
 * attached, so a change shows without a reload.
 */
import { supabase as defaultClient } from './supabaseClient.js';

/** How long one key's answer is trusted (D9). */
export const COVERAGE_TTL_MS = 60_000;

/**
 * document_key -> { value: boolean, at: number }. `at` is when the lookup that
 * produced the answer was sent, so an answer never claims to be newer than
 * the question.
 */
const known = new Map();

export function resetCoverageCache() {
  known.clear();
}

const keysOf = (keys) => [...new Set((keys || []).filter((k) => typeof k === 'string' && k.trim()))];

/** The answer for `key` while it is within its lifetime, else undefined. */
function fresh(key, now) {
  const entry = known.get(key);
  return entry && now() - entry.at < COVERAGE_TTL_MS ? entry.value : undefined;
}

/**
 * Asks the database about `keys` in one request and records the answers. A
 * failed request records nothing. An answer lands only if no newer lookup has
 * answered the key meanwhile, so a slow request cannot undo a refresh.
 */
async function lookUp(keys, client, now) {
  if (!keys.length || !client) return;
  const at = now();
  const { data, error } = await client
    .from('documents')
    .select('metadata->>document_key')
    .in('metadata->>document_key', keys)
    .not('indexed_at', 'is', null);
  if (error) return;
  const found = new Set((data || []).map((r) => r.document_key).filter(Boolean));
  for (const k of keys) {
    const prev = known.get(k);
    if (!prev || prev.at <= at) known.set(k, { value: found.has(k), at });
  }
}

const indexedOf = (keys, now) => new Set(keys.filter((k) => fresh(k, now) === true));

/**
 * The subset of `keys` that has indexed text behind it.
 *
 * Keys without a fresh answer (never asked, or asked COVERAGE_TTL_MS or more
 * ago) are looked up in one request; keys with a fresh answer are not asked
 * about again. A failed lookup answers nothing rather than answering "no",
 * because "no full text" is a claim about the corpus and a network error is
 * not evidence for it - the caller shows no badge instead of a wrong one.
 *
 * @param {string[]} keys
 * @param {object} [client]  a Supabase client
 * @param {() => number} [now]  the clock, for tests
 * @returns {Promise<Set<string>>}
 */
export async function indexedDocumentKeys(keys, client = defaultClient, now = Date.now) {
  const wanted = keysOf(keys);
  await lookUp(wanted.filter((k) => fresh(k, now) === undefined), client, now);
  return indexedOf(wanted, now);
}

/**
 * Asks about `keys` now, whatever is cached, and answers like
 * `indexedDocumentKeys`. The panel calls it when a key is newly attached, so
 * a document an admin linked or unlinked a moment ago shows at once (D9).
 * The old answers are dropped first: if the lookup fails, those keys answer
 * nothing rather than repeating what may no longer be true.
 *
 * @param {string[]} keys
 * @param {object} [client]  a Supabase client
 * @param {() => number} [now]  the clock, for tests
 * @returns {Promise<Set<string>>}
 */
export async function refreshCoverage(keys, client = defaultClient, now = Date.now) {
  const wanted = keysOf(keys);
  if (!wanted.length || !client) return new Set();
  for (const k of wanted) known.delete(k);
  await lookUp(wanted, client, now);
  return indexedOf(wanted, now);
}

/**
 * Asks about `keys` now, whatever their age, and answers with the keys whose latest answer is
 * "full text". The panel's periodic re-check (D9): its tick drifts against COVERAGE_TTL_MS, so it
 * must not skip an answer a few ms short of its lifetime. Unlike `refreshCoverage`, the old
 * answers stay until new ones land, so a failed lookup keeps the last answer.
 *
 * @param {string[]} keys
 * @param {object} [client]  a Supabase client
 * @param {() => number} [now]  the clock, for tests
 * @returns {Promise<Set<string>>}
 */
export async function recheckCoverage(keys, client = defaultClient, now = Date.now) {
  const wanted = keysOf(keys);
  await lookUp(wanted, client, now);
  return new Set(wanted.filter((k) => known.get(k)?.value === true));
}

/**
 * What the panel shows for one attachment: 'full' when the record's text is in
 * the corpus, 'row' when it is not, and null when there is nothing to say -
 * an attachment with no key at all (a dropped file, a desk sample), a lookup
 * that has not answered yet, or a "no" past COVERAGE_TTL_MS that has not been
 * asked again.
 *
 * A `document` chip ("Ask about this document") names a document opened from
 * a citation, so it is in the corpus by construction and needs no lookup.
 *
 * @param {{ kind?: string, document_id?: string, document_key?: string }} attachment
 * @param {Set<string> | null} indexed
 * @param {() => number} [now]  the clock, for tests
 * @returns {'full' | 'row' | null}
 */
export function coverageOf(attachment, indexed, now = Date.now) {
  if (attachment?.kind === 'document') return attachment.document_id ? 'full' : null;
  const key = attachment?.document_key;
  if (!key || !indexed) return null;
  if (indexed.has(key)) return 'full';
  // The last answer, even past its lifetime: re-querying is the caller's job (indexedDocumentKeys,
  // refreshCoverage), and a badge that blanks every minute tells the reader nothing.
  return known.get(key)?.value === false ? 'row' : null;
}
