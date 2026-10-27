/** Coverage uses canonical Law, legacy Bill, and reviewed cross-desk associations.
 * An unresolved association is not proof that OCR text is absent. */
import { attachmentCoverageKey } from './deskRows.js';
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
  modulesRequest = null;
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
  const law = keys.filter(k => k.startsWith('law-record:'));
  const records = keys.filter(k => k.startsWith('desk-record:') || k.startsWith('document-id:'));
  const legacy = keys.filter(k => !k.startsWith('law-record:') && !k.startsWith('desk-record:') && !k.startsWith('document-id:'));
  const states = new Map();
  for (let i = 0; i < records.length; i += 24) {
    const result = await client.rpc('record_resolve_document_keys', { p_keys: records.slice(i, i + 24) });
    if (result.error) return;
    for (const row of result.data || []) states.set(row.document_key, row.coverage);
  }
  const answers = [];
  for (let i = 0; i < law.length; i += 12) {
    const result = await client.rpc('law_resolve_document_keys', { p_keys: law.slice(i, i + 12) });
    if (result.error) return;
    answers.push(...(result.data || []));
  }
  const { data, error } = legacy.length ? await client
    .from('documents')
    .select('metadata->>document_key')
    .in('metadata->>document_key', legacy)
    .not('indexed_at', 'is', null) : { data: [], error: null };
  if (error) return;
  const found = new Set([...answers, ...(data || [])].map((r) => r.document_key).filter(Boolean));
  for (const k of keys) {
    const prev = known.get(k);
    if (!prev || prev.at <= at) known.set(k, { value: states.has(k) ? states.get(k) === 'full' : found.has(k), state: states.get(k) || (k.startsWith('desk-record:') || k.startsWith('document-id:') ? 'unavailable' : null), at });
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
 * Direct document chips use the same current readiness/permission lookup. A
 * saved citation is not proof that its document remains accessible or indexed.
 *
 * @param {{ kind?: string, document_id?: string, document_key?: string }} attachment
 * @param {Set<string> | null} indexed
 * @param {() => number} [now]  the clock, for tests
 * @returns {'full' | 'row' | null}
 */
export function coverageOf(attachment, indexed, now = Date.now) {
  const key = attachmentCoverageKey(attachment);
  if (!key && ['row', 'record'].includes(attachment?.kind)) return 'unmapped';
  if (!key || !indexed) return null;
  if (indexed.has(key)) return 'full';
  if (known.get(key)?.state) return known.get(key).state;
  // The last answer, even past its lifetime: re-querying is the caller's job (indexedDocumentKeys,
  // refreshCoverage), and a badge that blanks every minute tells the reader nothing.
  return known.get(key)?.value === false ? 'row' : null;
}

/** The one in-flight or settled document_modules() request, or null when none is worth keeping. */
let modulesRequest = null;

/**
 * The desk modules that have indexed documents, as `[{ desk_tier, desk_feature }]` (F130). It
 * changes only when the corpus is ingested and the answer is a handful of rows, so one request
 * serves the page's life; the web-search globe reads it to predict desk-focus turns.
 *
 * A failure answers null and is not kept, so the next call asks again: "unknown" is not evidence
 * that no module has documents. Concurrent callers share one request.
 *
 * @param {object} [client]  a Supabase client
 * @returns {Promise<{ desk_tier: string, desk_feature: string }[] | null>}
 */
export function documentModules(client = defaultClient) {
  if (!client) return Promise.resolve(null);
  if (modulesRequest) return modulesRequest;
  const request = Promise.resolve()
    .then(() => client.rpc('document_modules'))
    .then(({ data, error }) => {
      if (error || !Array.isArray(data)) return null;
      return data.filter((r) => r && typeof r.desk_tier === 'string' && r.desk_tier.trim()
        && typeof r.desk_feature === 'string' && r.desk_feature.trim())
        .map((r) => ({ desk_tier: r.desk_tier, desk_feature: r.desk_feature }));
    })
    .catch(() => null)
    .then((modules) => {
      if (modules === null && modulesRequest === request) modulesRequest = null;
      return modules;
    });
  modulesRequest = request;
  return request;
}

/** The server's module comparison (research-chat handler `moduleName`): case and punctuation do not matter. */
const moduleName = (s) => String(s ?? '').toLowerCase().replace(/[\p{P}/]+/gu, ' ').replace(/\s+/g, ' ').trim();

/**
 * Whether web search will start on for a turn, predicted from what the panel can see, by the same
 * rule the server applies (web-search spec section 1). The server's `web` frame stays
 * authoritative; this only lets the globe show the likely answer before the question is sent.
 *
 * `attachments` are the chips as stored on the chat (`kind`, `document_key`), plus the selected row
 * when the panel sends one. A row or record counts as having no document when it has no key or its
 * key is not in `indexedKeys`. A keyed record whose coverage has not answered yet (`indexedKeys`
 * null) is unknown: off, reason null, rather than a claim either way.
 *
 * @param {{ focus: string, attachments?: object[], indexedKeys?: Set<string> | null,
 *   deskContext?: { tier?: string, feature?: string } | null,
 *   modules?: { desk_tier: string, desk_feature: string }[] | null }} scope
 * @returns {{ on: boolean, reason: string | null }}
 */
export function webDefaultFor({ focus, attachments = [], indexedKeys = null, deskContext = null, modules = null }) {
  if (focus === 'broad') return { on: false, reason: 'broad' };
  if (focus === 'desk') {
    const tier = moduleName(deskContext?.tier);
    const feature = moduleName(deskContext?.feature);
    if (!tier || !feature) return { on: false, reason: 'no-record' };
    if (!Array.isArray(modules)) return { on: false, reason: null };
    return modules.some((m) => moduleName(m?.desk_tier) === tier && moduleName(m?.desk_feature) === feature)
      ? { on: false, reason: 'documents-in-scope' }
      : { on: true, reason: 'module-without-documents' };
  }
  const records = (attachments || []).filter((a) => a?.kind === 'row' || a?.kind === 'record');
  let unknown = false;
  for (const a of records) {
    if (!a.document_key) return { on: true, reason: 'record-without-document' };
    if (!indexedKeys) unknown = true;
    else if (!indexedKeys.has(a.document_key)) return { on: true, reason: 'record-without-document' };
  }
  if (unknown) return { on: false, reason: null };
  if (records.length || (attachments || []).some((a) => a?.kind === 'document')) return { on: false, reason: 'documents-in-scope' };
  return { on: false, reason: 'no-record' };
}
