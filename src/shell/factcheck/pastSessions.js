// F360 T1: reading and deleting a signed-in user's finished fact-check sessions.
//
// The browser reads public.factcheck_sessions and public.factcheck_claims directly, under the signed-in
// user's own row-level access (select: user_id = auth.uid(); delete: own, live, settled sessions only). No
// user id is ever sent: the session's own sign-in decides whose rows come back. Every failure is reduced
// to { ok: false }; server error text never leaves this module.
import { supabase } from '../../lib/supabaseClient.js';

export const PAGE_SIZE = 20;
export const CLAIM_CAP = 500;

const SESSION_COLUMNS = 'id, video_id, channel_id, video_kind, started_at, ended_at, minutes_used, credits_charged, status';
const CLAIM_COLUMNS = 'id, session_id, position_s, spoken_at, claim_en, claimant, reported_by, kind, status, verdict, reason, sources, checked_at, supersedes, hidden_at, fail_reason';

const FAILED = Object.freeze({ ok: false });

const time = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? 0 : t; };
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The results to show. Rows are grouped into re-check chains by following `supersedes` to the root (a row
 * whose `supersedes` is empty, or points outside the fetched set; cycles stop at the first repeat). The
 * server only follows a successor with status 'checked' (a re-check starts 'pending' and a failed one ends
 * 'error'), so from a chain exactly one row is shown: the newest checked re-check (checked_at, then id), else
 * the root. A row with `supersedes` set and a status other than 'checked' is never shown. A chain whose root
 * an administrator hid (`hidden_at`) is dropped whole, and any single hidden row is never chosen.
 * Chains are ordered by the root's spoken_at, then checked_at, then id.
 */
export function newestResults(rows) {
  const list = rows.filter(Boolean);
  const byId = new Map(list.map((r) => [r.id, r]));
  const rootOf = (row) => {
    const seen = new Set([row.id]);
    let cur = row;
    while (cur.supersedes && byId.has(cur.supersedes) && !seen.has(cur.supersedes)) {
      cur = byId.get(cur.supersedes);
      seen.add(cur.id);
    }
    return cur;
  };
  const chains = new Map();
  for (const r of list) {
    const root = rootOf(r);
    if (!chains.has(root.id)) chains.set(root.id, { root, members: [] });
    if (r !== root) chains.get(root.id).members.push(r);
  }
  const shown = [];
  for (const { root, members } of chains.values()) {
    if (root.hidden_at) continue;
    const later = members
      .filter((m) => m.status === 'checked' && !m.hidden_at)
      .sort((a, b) => time(b.checked_at) - time(a.checked_at) || compare(String(b.id), String(a.id)));
    const pick = later[0] || (root.supersedes && root.status !== 'checked' ? null : root);
    if (pick) shown.push({ pick, root });
  }
  return shown
    .sort((x, y) => time(x.root.spoken_at) - time(y.root.spoken_at) || time(x.root.checked_at) - time(y.root.checked_at) || compare(String(x.root.id), String(y.root.id)))
    .map((x) => x.pick);
}

/** One page of the user's settled sessions, newest first: { ok: true, rows, hasMore } or { ok: false }. */
export async function listSettledSessions({ client = supabase, offset = 0 } = {}) {
  try {
    const { data, error } = await client
      .from('factcheck_sessions')
      .select(SESSION_COLUMNS)
      .eq('status', 'settled')
      .order('started_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + PAGE_SIZE); // one spare row tells whether there is a next page
    if (error || !Array.isArray(data)) return FAILED;
    return { ok: true, rows: data.slice(0, PAGE_SIZE), hasMore: data.length > PAGE_SIZE };
  } catch {
    return FAILED;
  }
}

/** One session's results: { ok: true, claims, capped } or { ok: false }. */
export async function fetchSessionClaims({ client = supabase, sessionId } = {}) {
  try {
    const { data, error } = await client
      .from('factcheck_claims')
      .select(CLAIM_COLUMNS)
      .eq('session_id', sessionId)
      .order('spoken_at', { ascending: true })
      .order('checked_at', { ascending: true })
      .order('id', { ascending: true })
      .range(0, CLAIM_CAP); // one spare row tells whether the cap cut the list
    if (error || !Array.isArray(data)) return FAILED;
    const capped = data.length > CLAIM_CAP;
    return { ok: true, claims: newestResults(capped ? data.slice(0, CLAIM_CAP) : data), capped };
  } catch {
    return FAILED;
  }
}

/** Deletes one live-stream session (its claims go with it). A recorded session is never sent. */
export async function deleteLiveSession({ client = supabase, session } = {}) {
  if (!session || session.video_kind !== 'live' || !session.id) return FAILED;
  try {
    const { data, error } = await client
      .from('factcheck_sessions')
      .delete()
      .eq('id', session.id)
      .eq('video_kind', 'live')
      .eq('status', 'settled')
      .select('id');
    // The row policy refuses silently by removing nothing; that is a failure, not a success.
    if (error || !Array.isArray(data) || data.length === 0) return FAILED;
    return { ok: true };
  } catch {
    return FAILED;
  }
}
