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
 */
import { supabase as defaultClient } from './supabaseClient.js';

/** document_key -> boolean. Coverage only changes on ingest, so this holds for the session. */
const known = new Map();

export function resetCoverageCache() {
  known.clear();
}

/**
 * The subset of `keys` that has indexed text behind it.
 *
 * Unknown keys are looked up in one request; keys already answered are not
 * asked about again. A failed lookup answers nothing rather than answering
 * "no", because "no full text" is a claim about the corpus and a network error
 * is not evidence for it - the caller shows no badge instead of a wrong one.
 *
 * @param {string[]} keys
 * @returns {Promise<Set<string>>}
 */
export async function indexedDocumentKeys(keys, client = defaultClient) {
  const wanted = [...new Set((keys || []).filter((k) => typeof k === 'string' && k.trim()))];
  const missing = wanted.filter((k) => !known.has(k));
  if (missing.length && client) {
    const { data, error } = await client
      .from('documents')
      .select('metadata->>document_key')
      .in('metadata->>document_key', missing)
      .not('indexed_at', 'is', null);
    if (!error) {
      const found = new Set((data || []).map((r) => r.document_key).filter(Boolean));
      for (const k of missing) known.set(k, found.has(k));
    }
  }
  return new Set(wanted.filter((k) => known.get(k) === true));
}

/**
 * What the panel shows for one attachment: 'full' when the record's text is in
 * the corpus, 'row' when it is not, and null when there is nothing to say -
 * an attachment with no key at all (a dropped file, a desk sample), or a
 * lookup that has not answered yet.
 *
 * @param {{ document_key?: string }} attachment
 * @param {Set<string> | null} indexed
 * @returns {'full' | 'row' | null}
 */
export function coverageOf(attachment, indexed) {
  const key = attachment?.document_key;
  if (!key || !indexed) return null;
  if (indexed.has(key)) return 'full';
  return known.get(key) === false ? 'row' : null;
}
