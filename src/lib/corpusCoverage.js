/** Coverage uses canonical Law, legacy Bill, and reviewed cross-desk associations.
 * An unresolved association is not proof that OCR text is absent. */
import { attachmentCoverageKey } from './deskRows.js';
import { supabase as defaultClient } from './supabaseClient.js';

/** How long one key's answer is trusted (D9). */
export const COVERAGE_TTL_MS = 60_000;
export const COVERAGE_LOOKUP_TIMEOUT_MS = 15_000;

/**
 * document_key -> { value: boolean, at: number }. `at` is when the lookup that
 * produced the answer was sent, so an answer never claims to be newer than
 * the question.
 */
const known = new Map();
const lookupErrors = new Map();
const recordStates = new Map();
const latestLookup = new Map();
let lookupSequence = 0;
let cacheGeneration = 0;
const lookupFlights = new Map();
const runningRpcs = new Set();
const readyIds = new Map();
const subscribers = new Set();
let revision = 0;
const changed = (keys = null) => {
  revision += 1;
  for (const subscription of subscribers) {
    if (!keys || !subscription.keys || keys.some(key => subscription.keys.has(key))) subscription.notify();
  }
};
export const subscribeCoverage = (notify, keys = null) => {
  const subscription = { notify, keys: keys && new Set(keys) };
  subscribers.add(subscription);
  return () => subscribers.delete(subscription);
};
export const coverageRevision = () => revision;
export const coverageCallerVersion = () => cacheGeneration;

export function resetCoverageCache() {
  cacheGeneration += 1;
  for (const request of runningRpcs) request.abort();
  known.clear();
  lookupErrors.clear();
  recordStates.clear();
  latestLookup.clear();
  lookupFlights.clear();
  readyIds.clear();
  checked.clear();
  pending.clear();
  modulesRequest = null;
  changed();
}

const keysOf = (keys) => [...new Set((keys || []).filter((k) => typeof k === 'string' && k.trim()))];

/** The answer for `key` while it is within its lifetime, else undefined. */
function fresh(key, now) {
  const entry = known.get(key);
  return entry && now() - entry.at < COVERAGE_TTL_MS ? entry.value : undefined;
}

// The limit belongs to the client, not one lookup: new viewport mounts and chat
// requests can overlap older batches. Queued work rechecks its caller and readers.
const rpcQueues = new WeakMap();
function coverageRpc(client, name, keys, context) {
  let queue = rpcQueues.get(client);
  if (!queue) { queue = { active: 0, jobs: [] }; rpcQueues.set(client, queue); }
  const drain = () => {
    while (queue.active < 2 && queue.jobs.length) queue.jobs.shift()();
  };
  return new Promise((resolve, reject) => {
    queue.jobs.push(() => {
      const wanted = context.generation === cacheGeneration
        ? keys.filter(key => !context.visible || context.visible(key) || context.retained.has(key)) : [];
      if (!wanted.length) { resolve(null); return; }
      queue.active += 1;
      for (const key of wanted) context.attempted.add(key);
      const controller = new AbortController();
      let settled = false;
      const request = { abort: () => controller.abort() };
      runningRpcs.add(request);
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        runningRpcs.delete(request);
        controller.signal.removeEventListener('abort', aborted);
        queue.active -= 1;
        if (error) reject(error); else resolve(result);
        drain();
      };
      // Let every transport abort listener run before a replacement acquires the slot.
      // Supabase's builder forwards this signal to fetch; no network promise has to
      // settle by itself for a signed-out caller's hung request to release its slot.
      const aborted = () => queueMicrotask(() => finish(new DOMException('Coverage lookup aborted', 'AbortError')));
      controller.signal.addEventListener('abort', aborted, { once: true });
      const timeout = setTimeout(request.abort, COVERAGE_LOOKUP_TIMEOUT_MS);
      try {
        const transport = client.rpc(name, { p_keys: wanted });
        const response = typeof transport?.abortSignal === 'function' ? transport.abortSignal(controller.signal) : transport;
        Promise.resolve(response).then(result => finish(null, result), error => finish(error));
      } catch (error) { finish(error); }
    });
    drain();
  });
}

/**
 * Asks the database about `keys` in one request and records the answers. A
 * failed request records a separate lookup error, never a negative coverage answer.
 * Only the latest lookup for a key may update text or metadata capability.
 */
async function performLookup(keys, client, at, sequence, context) {
  if (!keys.length || !client) return;
  const law = keys.filter(k => k.startsWith('law-record:'));
  const records = keys.filter(k => k.startsWith('desk-record:') || k.startsWith('document-id:'));
  const legacy = keys.filter(k => !k.startsWith('law-record:') && !k.startsWith('desk-record:') && !k.startsWith('document-id:'));
  const states = new Map();
  const ids = new Map();
  for (let i = 0; i < records.length; i += 48) {
    const batches = [records.slice(i, i + 24), records.slice(i + 24, i + 48)].filter(batch => batch.length);
    const results = await Promise.all(batches.map(batch => coverageRpc(client, 'record_resolve_document_keys', batch, context)));
    for (const result of results) {
      if (!result) continue;
      if (result.error || !Array.isArray(result.data)) return false;
      for (const row of result.data) {
        states.set(row.document_key, row.coverage);
        if (row.document_id) ids.set(row.document_key, [...(ids.get(row.document_key) || []), row.document_id]);
      }
    }
  }
  const answers = [];
  for (let i = 0; i < law.length; i += 12) {
    const result = await coverageRpc(client, 'law_resolve_document_keys', law.slice(i, i + 12), context);
    if (!result) continue;
    if (result.error) return false;
    answers.push(...(result.data || []));
  }
  const legacyWanted = legacy.filter(key => context.generation === cacheGeneration
    && (!context.visible || context.visible(key) || context.retained.has(key)));
  for (const key of legacyWanted) context.attempted.add(key);
  const { data, error } = legacyWanted.length ? await client
    .from('documents')
    .select('metadata->>document_key')
    .in('metadata->>document_key', legacyWanted)
    .not('indexed_at', 'is', null) : { data: [], error: null };
  if (error) return false;
  const found = new Set([...answers, ...(data || [])].map((r) => r.document_key).filter(Boolean));
  for (const k of keys) {
    if (latestLookup.get(k) !== sequence || !context.attempted.has(k)) continue;
    readyIds.set(k, [...new Set(ids.get(k) || [])]);
    if (k.startsWith('desk-record:') && (!recordStates.has(k) || recordStates.get(k).at <= at)) {
      recordStates.set(k, { value: states.has(k) ? 'stored' : 'snapshot', at });
    }
    const prev = known.get(k);
    if (!prev || prev.at <= at) known.set(k, { value: states.has(k) ? states.get(k) === 'full' : found.has(k), state: states.get(k) || (k.startsWith('desk-record:') ? 'snapshot' : k.startsWith('document-id:') ? 'unavailable' : null), at });
  }
  return true;
}

async function lookUp(keys, client, now, context) {
  if (!keys.length || !client) return;
  const at = now();
  const sequence = ++lookupSequence;
  for (const key of keys) latestLookup.set(key, sequence);
  let ok = false;
  try { ok = await performLookup(keys, client, at, sequence, context); } catch { /* A transport failure proves no coverage state. */ }
  for (const key of keys) {
    if (latestLookup.get(key) !== sequence || !context.attempted.has(key)) continue;
    if ((known.get(key)?.at ?? -Infinity) > at || (lookupErrors.get(key) ?? -Infinity) > at) continue;
    if (ok) lookupErrors.delete(key);
    else lookupErrors.set(key, at);
  }
  changed(keys);
}

const indexedOf = (keys, now) => new Set(keys.filter((k) => fresh(k, now) === true));

function coalescedLookup(keys, client, now, force = false, observerContext = null) {
  const generation = cacheGeneration;
  const waiting = new Set();
  const wanted = keys.filter(key => {
    const flight = lookupFlights.get(key);
    if (!force && flight?.client === client && flight.generation === generation) {
      // A direct read retains interest even if the badge that began it unmounts.
      if (!observerContext) flight.context.retained.add(key);
      waiting.add(flight.promise.then(() => {
        if (observerContext && flight.context.attempted.has(key)) observerContext.attempted.add(key);
      }));
      return false;
    }
    return true;
  });
  if (wanted.length) {
    const context = { generation, retained: new Set(), attempted: new Set(), ...observerContext };
    const promise = lookUp(wanted, client, now, context).finally(() => {
      for (const key of wanted) if (lookupFlights.get(key)?.promise === promise) lookupFlights.delete(key);
    });
    for (const key of wanted) lookupFlights.set(key, { client, generation, promise, context });
    waiting.add(promise);
  }
  return Promise.all(waiting);
}

/** A forced refresh can supersede the flight a direct reader originally joined.
 * Follow current same-caller work within one bounded read deadline. An unfinished
 * read remains unknown; an empty returned Set is never proof that text is absent. */
async function waitForCurrentLookups(keys, client, generation, deadline, initial) {
  while (generation === cacheGeneration && Date.now() < deadline) {
    const current = keys.map(key => lookupFlights.get(key))
      .filter(flight => flight?.client === client && flight.generation === generation);
    if (!current.length && !initial) return;
    let timeout;
    let unsubscribe;
    try {
      await Promise.race([
        Promise.all([...current.map(flight => flight.promise), ...(initial ? [initial] : [])]),
        // A replacement may finish before its predecessor. Wake on invalidation or
        // completion and reread the current flight instead of waiting for obsolete work.
        new Promise(resolve => { unsubscribe = subscribeCoverage(resolve, keys); }),
        new Promise(resolve => { timeout = setTimeout(resolve, deadline - Date.now()); }),
      ]);
    } finally { clearTimeout(timeout); unsubscribe?.(); }
    initial = null;
  }
}

/**
 * The subset of `keys` that has indexed text behind it.
 *
 * Keys without a fresh answer (never asked, or asked COVERAGE_TTL_MS or more
 * ago) are looked up in one request; keys with a fresh answer are not asked
 * about again. A failed lookup answers nothing rather than answering "no",
 * because "no full text" is a claim about the corpus and a network error is
 * not evidence for it. Public Record only describes supplied fields, not absence.
 *
 * @param {string[]} keys
 * @param {object} [client]  a Supabase client
 * @param {() => number} [now]  the clock, for tests
 * @returns {Promise<Set<string>>}
 */
export async function indexedDocumentKeys(keys, client = defaultClient, now = Date.now) {
  const wanted = keysOf(keys);
  const generation = cacheGeneration;
  const deadline = Date.now() + COVERAGE_LOOKUP_TIMEOUT_MS;
  const initial = coalescedLookup(wanted.filter((k) => fresh(k, now) === undefined), client, now);
  await waitForCurrentLookups(wanted, client, generation, deadline, initial);
  return generation === cacheGeneration ? indexedOf(wanted, now) : new Set();
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
  changed(wanted);
  // Explicit invalidation starts a new generation of this key's answer. Ordinary reads
  // (including badges/prediction) share it, rather than issuing a second request.
  await coalescedLookup(wanted, client, now, true);
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
  await coalescedLookup(wanted, client, now);
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

/** Record metadata capability is independent of the linked document's readiness.
 * A successful empty desk RPC means the stored identity was not accessible; it
 * does not say whether any document exists. Failed lookups establish neither. */
export function recordAvailability(attachment, indexed) {
  const key = attachmentCoverageKey(attachment);
  const text = lookupErrors.has(key) ? 'error' : coverageOf(attachment, indexed);
  if (!['row', 'record'].includes(attachment?.kind)) return { record: null, text };
  if (!key) return { record: 'snapshot', text: null };
  return { record: recordStates.get(key)?.value || 'unknown', text: text === 'snapshot' ? null : text };
}

/** Public capability describes what can be used now, never why text is unavailable.
 * The supplied record fields remain usable even when their stored identity is unknown.
 * Neither a saved chip nor a caller-owned Set is evidence of current Full text. */
export function publicCorpusCapability(attachment, now = Date.now) {
  const key = attachmentCoverageKey(attachment);
  return key && !lookupErrors.has(key) && fresh(key, now) === true ? 'full' : 'record';
}

/** Individually ready sources remain useful when the complete association is partial. */
export function readyDocumentIds(attachment, now = Date.now) {
  const key = attachmentCoverageKey(attachment);
  return key && !lookupErrors.has(key) && fresh(key, now) !== undefined ? readyIds.get(key) || [] : [];
}

/** One scheduler for visible listing records, selected records and chat pins. Mounted badges
 * register keys; they do not own polling loops. Same-frame mounts share bounded RPC batches. */
const observed = new Map();
const checked = new Map();
const pending = new Set();
let timer = null;
let authSubscription = null;
const nextCheckAt = key => ((lookupErrors.has(key) ? checked.get(key) : known.get(key)?.at) ?? checked.get(key) ?? -Infinity) + COVERAGE_TTL_MS;

function scheduleCoverage(delay = 0) {
  if (timer !== null || !observed.size) return;
  timer = setTimeout(async () => {
    timer = null;
    const now = Date.now();
    const generation = cacheGeneration;
    const keys = [...observed.keys()].filter(key => !pending.has(key) && now >= nextCheckAt(key));
    for (const key of keys) pending.add(key);
    if (keys.length) {
      changed(keys); // Expired Full text is removed while the new lookup is pending.
      const context = { visible: key => observed.has(key), attempted: new Set() };
      await coalescedLookup(keys.filter(key => fresh(key, Date.now) === undefined), defaultClient, Date.now, false, context);
      if (generation !== cacheGeneration) { scheduleCoverage(); return; }
      for (const key of keys) {
        pending.delete(key);
        if (context.attempted.has(key)) checked.set(key, Date.now());
      }
    }
    if (observed.size) {
      const waiting = [...observed.keys()].filter(key => !pending.has(key));
      if (waiting.length) {
        const due = Math.min(...waiting.map(nextCheckAt));
        scheduleCoverage(Math.max(1, due - Date.now()));
      }
    }
  }, delay);
}

function watchCoverageIdentity() {
  // Supabase changes callers through this event. Clear all prior evidence before any late
  // request can publish it; never retain a token in the cache or its keys.
  if (!authSubscription && defaultClient?.auth?.onAuthStateChange) {
    authSubscription = defaultClient.auth.onAuthStateChange(() => {
      resetCoverageCache();
      if (timer !== null) { clearTimeout(timer); timer = null; }
      queueMicrotask(() => scheduleCoverage());
    });
  }
}

// Install before any public consumer can populate/read the cache, including consumers
// whose lookups precede their first mounted badge. This callback performs no Auth calls.
watchCoverageIdentity();

export function observeCoverage(keys, onAnswer) {
  const wanted = keysOf(keys);
  if (!wanted.length || !defaultClient) return null;
  for (const key of wanted) observed.set(key, (observed.get(key) || 0) + 1);
  const notify = () => onAnswer?.(indexedOf(wanted, Date.now));
  const unsubscribe = subscribeCoverage(notify, wanted);
  notify();
  // A new visible key must not wait for another key's refresh timer.
  if (timer !== null) { clearTimeout(timer); timer = null; }
  scheduleCoverage();
  return () => {
    unsubscribe();
    for (const key of wanted) {
      const count = observed.get(key) - 1;
      if (count) observed.set(key, count); else observed.delete(key);
    }
    if (!observed.size && timer !== null) { clearTimeout(timer); timer = null; }
  };
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
  const records = (attachments || []).filter((a) => ['row', 'record', 'document'].includes(a?.kind));
  let unknown = false;
  for (const a of records) {
    const key = attachmentCoverageKey(a);
    const entry = known.get(key);
    if (!key || !entry || fresh(key, Date.now) === undefined || lookupErrors.has(key)) { unknown = true; continue; }
    if (readyDocumentIds(a).length || entry.value === true) continue;
    if (recordStates.get(key)?.value === 'stored' && ['unmapped', 'registered', 'incomplete'].includes(entry.state)) {
      return { on: true, reason: 'record-without-document' };
    }
    unknown = true;
  }
  if (unknown) return { on: false, reason: null };
  if (records.length) return { on: false, reason: 'documents-in-scope' };
  return { on: false, reason: 'no-record' };
}
