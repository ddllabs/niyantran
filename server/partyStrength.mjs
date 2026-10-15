/**
 * F196 Party Organisation Map: party seat strength in each state assembly, counted from MLA Directory's
 * stored register (server/feedSchedule.mjs FEED_REGISTERS; loaded by scripts/load-feed-register.mjs).
 * No outside source: the store is read one state at a time (public.feed_page through serveFromStore,
 * up to 500 members a state; the largest, Uttar Pradesh, has 403 seats), all at once, so the read takes
 * the store's own time limit (1.5 s) and stays inside the feature feed's 4 s.
 *
 * The register is counted only when every state answered in full: a state missing, or with more members
 * stored than its page holds, would undercount the national roll-up, so the module says the register is
 * not available instead. Where no store is configured (the local dev server) the register's workbook is
 * read instead; on the live site (VERCEL) never, as backup/ is not in the function bundle.
 *
 * A count is kept for an hour (the register is reloaded rarely). In the feature feed's archive pass the
 * kept count is served whatever its age, and nothing is read.
 */
import { FEED_REGISTERS, mlaStateVariant } from './feedSchedule.mjs';
import { serveFromStore } from './feedServe.mjs';
import { readBackupRows } from './backupFeed.mjs';
import { aggregatePartyStrength, partyStrengthRows } from '../src/lib/partyStrength.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MLA = 'state:MLA Directory';
const KEEP_MS = 60 * 60_000;
const WORKBOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'backup', 'STATE', 'F30_MLA_Directory.xlsx');
const NOT_AVAILABLE = 'The MLA register is not available right now';

let kept = null;

export function resetPartyStrengthCache() {
  kept = null;
}

/** Every state's stored members, or null unless every state answered in full. */
async function storeRows(store) {
  const states = FEED_REGISTERS[MLA].values;
  const answers = await Promise.all(states.map((state) => Promise.resolve()
    .then(() => store(MLA, new URLSearchParams({ state })))
    .catch(() => null)));
  const short = states.filter((_s, i) => {
    const a = answers[i];
    return !Array.isArray(a?.rows) || !a.rows.length || Number(a.storeTotal) > a.rows.length;
  });
  if (short.length) {
    // No state at all: the store is not configured or not serving the register (before go-live); quiet.
    if (short.length < states.length) console.warn(`[party-map] the MLA register is incomplete in the store (${short.length} of ${states.length} states: ${short.slice(0, 3).join(', ')})`);
    return null;
  }
  return answers.flatMap((a) => a.rows);
}

/** The register's workbook rows as { state, party, as_of, register_source_url } (local dev only). */
export function registerWorkbookRows(file = WORKBOOK) {
  return readBackupRows(file, 100_000).map((r) => ({
    state: mlaStateVariant(r.state || r.geography),
    party: r.party,
    as_of: String(r.source_published_at || r.record_date || '').slice(0, 10),
    register_source_url: r.source_url,
  }));
}

function answerFor(rows, source) {
  const result = aggregatePartyStrength(rows);
  if (!result.states.length) return null;
  const complete = source === 'store';
  const asOf = result.asOf || 'an unrecorded date';
  const citations = [...new Set(rows.map((r) => String(r?.register_source_url || '')).filter((u) => /^https:\/\//i.test(u)))];
  return {
    rows: partyStrengthRows(result),
    adapter: 'register',
    kind: 'register',
    links: ['https://www.wikidata.org/', ...citations].slice(0, 40),
    note: `Party seat strength in ${result.states.length} state assemblies, counted from the MLA register (${result.totalSeats.toLocaleString('en-IN')} MLAs, as of ${asOf}${result.vacancies ? `; ${result.vacancies} vacant seat${result.vacancies === 1 ? '' : 's'} left out` : ''}).`,
    coverage: { from: '', through: result.asOf, exhaustive: complete },
    fallback: false,
    meta: {
      heading: 'Party Organisation Map',
      view: 'party-map',
      as_of: result.asOf,
      national: result.national,
      totalSeats: result.totalSeats,
      vacancies: result.vacancies,
      states: result.states.length,
      source,
    },
  };
}

const unavailable = (reason) => ({
  rows: [],
  reason,
  adapter: 'register',
  kind: 'register',
  links: [],
  note: `${NOT_AVAILABLE}. No seat counts were invented.`,
  coverage: { from: '', through: '', exhaustive: false },
  fallback: false,
  meta: null,
});

/**
 * The module's answer: { rows, adapter, kind, links, note, coverage, fallback, meta } for the feature
 * feed's envelope, with `rows` empty and `reason` set when the register could not be read.
 */
export async function servePartyStrength({
  archiveOnly = false,
  store = serveFromStore,
  readWorkbook = registerWorkbookRows,
  env = process.env,
  now = Date.now,
} = {}) {
  if (kept && (archiveOnly || now() - kept.at < KEEP_MS)) return kept.answer;
  if (archiveOnly) return unavailable(`${NOT_AVAILABLE} (live time limit reached)`);
  let answer = null;
  const stored = await storeRows(store);
  if (stored) answer = answerFor(stored, 'store');
  if (!answer && !env.VERCEL) {
    try {
      answer = answerFor(readWorkbook(), 'workbook');
    } catch (err) {
      console.warn(`[party-map] the register workbook could not be read: ${String(err?.message || err).slice(0, 200)}`);
    }
  }
  if (!answer) return unavailable(`${NOT_AVAILABLE} (the stored register is incomplete or not loaded)`);
  kept = { at: now(), answer };
  return answer;
}
