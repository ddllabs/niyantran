/**
 * Admin user directory, backed by Supabase `public.user_profiles`.
 *
 *   GET   /api/users?page=N&q=text
 *                              internal admin: one page of 100 profiles, oldest
 *                              first, optionally those whose email or name
 *                              contains the text; { ok, users, page, pageSize, total }
 *   PATCH /api/users/:userId   internal admin: { active?: boolean, type?: persona }
 *                              or { plan: free|plus|pro|max, planEnd?: date|null }
 *   POST  /api/users/:userId/credits
 *                              internal admin: { credits, kind: adjustment|topup,
 *                              reason, requestId, unitVersion } (F225)
 *
 * Accounts are created only through Supabase sign-up; this route never
 * creates, deletes or sets a password for anyone. Reads and writes use the
 * server's secret-key client after the route's own internal-admin check.
 * A plan is granted or revoked only through grant_manual_plan() (F2,
 * docs/specs/2026-09-29-f2-entitlements.md), which logs the granting admin.
 * Credits are added or removed only through admin_adjust_credits(), which
 * records the admin and the reason in the append-only ledger (F111).
 */
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from './authEmailProvider.mjs';
import { dbPersona, frontendPersona } from '../src/lib/personaMap.js';
import { normalizePlanId } from '../src/lib/publicPlans.js';

const PROFILE_COLUMNS = 'user_id, email, first_name, last_name, persona, role, plan, status, created_at, '
  + 'plan_status, plan_period_end, plan_source';
const PATCH_FIELDS = new Set(['active', 'type']);
const PLAN_FIELDS = new Set(['plan', 'planEnd']);
const GRANTABLE_PLANS = new Set(['free', 'plus', 'pro', 'max']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16 * 1024;
const CREDIT_FIELDS = new Set(['credits', 'kind', 'reason', 'requestId', 'unitVersion']);
const CREDIT_UNITS = new Set(['credit-ten-paise-v1', 'credit-paise-v2']);
const CREDIT_KINDS = new Set(['adjustment', 'topup']);
// Same economic typo guard after the tenfold denomination change.
const CREDIT_LIMITS = { 'credit-ten-paise-v1': 1_000_000, 'credit-paise-v2': 10_000_000 };
const MAX_REASON_LENGTH = 500;
// F147: the directory is read one page at a time, never whole.
export const USERS_PAGE_SIZE = 100;
const PAGE_NUMBER = /^[1-9]\d{0,5}$/;
const MAX_SEARCH_LENGTH = 100;
const SEARCH_COLUMNS = ['email', 'first_name', 'last_name'];

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// Request-scoped client: RPCs use exactly the token independently checked by
// getUser. Never use a service-role client or browser-supplied role metadata.
export function localClientForToken(token) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY
    || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Local authorization is not configured');
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function authorizeLocalUser(req, res, { admin = false, clientForToken = localClientForToken } = {}) {
  const header = req.headers.authorization;
  const match = typeof header === 'string' && /^Bearer ([^\s,]+)$/i.exec(header);
  if (!match) {
    json(res, { ok: false, error: 'Authentication required' }, 401);
    return null;
  }
  try {
    const client = clientForToken(match[1]);
    const verified = await client.auth.getUser(match[1]);
    const user = verified.data?.user;
    if (verified.error || !user?.id || typeof user.email !== 'string' || !user.email.trim()) {
      json(res, { ok: false, error: 'Invalid or expired session' }, 401);
      return null;
    }
    const profile = await client.rpc('get_my_profile');
    if (profile.error) throw new Error('Profile verification failed');
    if (profile.data?.user_id !== user.id || profile.data.status !== 'active') {
      json(res, { ok: false, error: 'Active account required' }, 403);
      return null;
    }
    if (admin) {
      const authority = await client.rpc('is_platform_admin');
      if (authority.error) throw new Error('Admin verification failed');
      if (authority.data !== true || profile.data.role !== 'admin') {
        json(res, { ok: false, error: 'Internal admin access required' }, 403);
        return null;
      }
    }
    return { id: user.id, email: user.email.trim().toLowerCase() };
  } catch {
    json(res, { ok: false, error: 'Unable to verify account access' }, 503);
    return null;
  }
}

/**
 * One user_profiles row in the directory shape. An allowlist: nothing else
 * leaves. `credits` is { balance, debt } (null for each when the wallet read
 * failed); left out, the credit fields are left out too rather than shown as 0.
 */
function directoryUser(row, credits) {
  const email = String(row.email || '').trim().toLowerCase();
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || email.split('@')[0];
  const persona = frontendPersona(row.persona);
  // The effective plan, as my_entitlement() reads it: a period that has
  // ended is free. The stored plan stays until the next grant.
  const plan = normalizePlanId(row.plan);
  const status = row.plan_status || (plan === 'free' ? 'free' : 'active');
  const end = row.plan_period_end || null;
  const lapsed = status !== 'free' && Boolean(end) && Date.parse(end) <= Date.now();
  return {
    id: row.user_id,
    name,
    email,
    type: persona,
    personaId: persona,
    plan: lapsed ? 'free' : plan,
    planStatus: lapsed ? 'free' : status,
    planEnd: end,
    planSource: row.plan_source || null,
    planLapsed: lapsed,
    active: row.status === 'active',
    status: row.status,
    role: row.role,
    createdAt: row.created_at,
    ...(credits ? { creditBalance: credits.balance, creditDebt: credits.debt, creditUnitVersion: credits.unitVersion } : {}),
  };
}

function creditAmount(value) {
  const amount = Number(value);
  return value == null || !Number.isFinite(amount) ? null : amount;
}

/**
 * The wallets of the listed users, keyed by user. A user with no wallet row
 * yet has nothing (balance 0). If the read fails the list still answers, with
 * the balance unknown (null), never a made-up 0.
 *
 * Only the ids of the page being listed are asked for (at most
 * USERS_PAGE_SIZE, a URL of a few kilobytes), so the wallet of anyone not
 * listed is never read, and no more rows come back than the server's per
 * request cap allows.
 */
async function walletsFor(client, ids) {
  const unknown = { balance: null, debt: null, unitVersion: null };
  if (!ids.length) return () => unknown;
  try {
    const readUnit = async () => {
      const { data, error } = await client.rpc('credit_unit');
      const expected = { 'credit-ten-paise-v1': 0.1, 'credit-paise-v2': 0.01 };
      return !error && expected[data?.unit_version] === Number(data?.inr_per_credit) ? data.unit_version : null;
    };
    const before = await readUnit();
    if (!before) return () => unknown;
    const { data, error } = await client
      .from('credit_wallets')
      .select('user_id, balance, debt')
      .in('user_id', ids);
    if (error || !Array.isArray(data)) return () => unknown;
    // A cutover between statements must never label a new wallet with an old
    // denomination. The one-time unit transition is monotonic.
    if (await readUnit() !== before) return () => unknown;
    const byUser = new Map();
    for (const w of data) byUser.set(w.user_id, { balance: creditAmount(w.balance) ?? 0, debt: creditAmount(w.debt) ?? 0, unitVersion: before });
    return (id) => byUser.get(id) || { balance: 0, debt: 0, unitVersion: before };
  } catch {
    return () => unknown;
  }
}

function adminClientFrom(deps) {
  return (deps.adminClient || getSupabaseAdminClient)();
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = typeof req.body === 'string' ? req.body : '';
  if (typeof req.body !== 'string') {
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) throw new Error('Request too large');
    }
  }
  if (raw.length > MAX_BODY_BYTES) throw new Error('Request too large');
  return raw ? JSON.parse(raw) : undefined;
}

/** { status?, persona? } for a valid body, or null. Unknown fields are refused. */
function profilePatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (!keys.length || keys.some((key) => !PATCH_FIELDS.has(key))) return null;
  const patch = {};
  if ('active' in body) {
    if (typeof body.active !== 'boolean') return null;
    patch.status = body.active ? 'active' : 'suspended';
  }
  if ('type' in body) {
    const persona = typeof body.type === 'string' ? dbPersona(body.type) : null;
    if (!persona) return null;
    patch.persona = persona;
  }
  return patch;
}

/** { plan, periodEnd } for a valid plan body, or null. The end is optional; a past one is refused. */
function planGrant(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (!keys.includes('plan') || keys.some((key) => !PLAN_FIELDS.has(key))) return null;
  if (typeof body.plan !== 'string' || !GRANTABLE_PLANS.has(body.plan)) return null;
  let periodEnd = null;
  if (body.planEnd != null && body.planEnd !== '') {
    const at = typeof body.planEnd === 'string' ? Date.parse(body.planEnd) : NaN;
    if (!Number.isFinite(at) || at <= Date.now()) return null;
    periodEnd = new Date(at).toISOString();
  }
  return { plan: body.plan, periodEnd: body.plan === 'free' ? null : periodEnd };
}

// A query-string value: from the URL, else from req.query. api/router.js rewrites
// req.url to the bare path, so on the hosted API the parsed query is all that is left.
function queryParam(url, req, name) {
  if (url.searchParams.has(name)) return url.searchParams.get(name);
  const raw = req.query?.[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value : null;
}

/** { page, search } for a valid request, or { error }. Page 1 and no search when they are not sent. */
function directoryRequest(url, req) {
  const rawPage = queryParam(url, req, 'page');
  if (rawPage !== null && !PAGE_NUMBER.test(rawPage)) return { error: 'The page must be a whole number from 1' };
  const search = (queryParam(url, req, 'q') ?? '').trim();
  if (search.length > MAX_SEARCH_LENGTH) return { error: `The search can be at most ${MAX_SEARCH_LENGTH} characters` };
  return { page: rawPage === null ? 1 : Number(rawPage), search };
}

/**
 * The PostgREST `or` filter for a search, or null when there is nothing to
 * look for. The text is data, never syntax:
 *   - `*` is PostgREST's wildcard and cannot be matched literally, so it is
 *     left out; the text is matched as "contains" anyway;
 *   - `%`, `_` and `\` are LIKE's own wildcards and escape, so each is
 *     escaped with a backslash and matches itself;
 *   - the value is double-quoted, with `"` and `\` backslash-escaped, so a
 *     comma, parenthesis, dot or colon cannot end it or start another clause.
 */
export function directoryFilter(search) {
  const text = String(search ?? '').replaceAll('*', '').trim();
  if (!text) return null;
  const pattern = `*${text.replace(/[\\%_]/g, '\\$&')}*`;
  const quoted = `"${pattern.replace(/[\\"]/g, '\\$&')}"`;
  return SEARCH_COLUMNS.map((column) => `${column}.ilike.${quoted}`).join(',');
}

const outOfRange = (result) => result?.error?.code === 'PGRST103' || result?.status === 416;

async function listUsers(res, deps, { page, search }) {
  try {
    const client = adminClientFrom(deps);
    const filter = directoryFilter(search);
    const from = (page - 1) * USERS_PAGE_SIZE;
    let query = client.from('user_profiles').select(PROFILE_COLUMNS, { count: 'exact' });
    if (filter) query = query.or(filter);
    // created_at alone can tie; the id keeps every user on exactly one page.
    const read = await query
      .order('created_at', { ascending: true })
      .order('user_id', { ascending: true })
      .range(from, from + USERS_PAGE_SIZE - 1);
    let rows = read.data;
    let total = read.count;
    if (outOfRange(read)) {
      // A page past the end is not an error: an empty page with the real total.
      let counted = client.from('user_profiles').select('user_id', { count: 'exact', head: true });
      if (filter) counted = counted.or(filter);
      const head = await counted;
      if (head.error) throw new Error('Directory read failed');
      rows = [];
      total = head.count;
    } else if (read.error || !Array.isArray(rows)) {
      throw new Error('Directory read failed');
    }
    if (!Number.isInteger(total) || total < 0) throw new Error('Directory count failed');
    const walletOf = await walletsFor(client, rows.map((row) => row.user_id));
    return json(res, {
      ok: true,
      users: rows.map((row) => directoryUser(row, walletOf(row.user_id))),
      page,
      pageSize: USERS_PAGE_SIZE,
      total,
    });
  } catch {
    return json(res, { ok: false, error: 'The user directory is unavailable' }, 503);
  }
}

async function updateUser(req, res, caller, userId, deps) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return json(res, { ok: false, error: 'Invalid JSON' }, 400);
  }
  const isPlan = Boolean(body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).some((key) => PLAN_FIELDS.has(key)));
  const grant = isPlan ? planGrant(body) : null;
  const patch = isPlan ? null : profilePatch(body);
  if (isPlan && !grant) {
    return json(res, { ok: false, error: 'Send plan (free, plus, pro or max) and optionally a future planEnd, nothing else' }, 400);
  }
  if (!isPlan && !patch) {
    return json(res, { ok: false, error: 'Send only active (boolean) and/or type (a known persona)' }, 400);
  }
  if (!UUID.test(userId)) return json(res, { ok: false, error: 'User not found' }, 404);
  if (grant) return grantPlan(res, caller, userId, grant, deps);
  try {
    const client = adminClientFrom(deps);
    const target = await client.from('user_profiles').select(PROFILE_COLUMNS).eq('user_id', userId).maybeSingle();
    if (target.error) throw new Error('Directory read failed');
    if (!target.data) return json(res, { ok: false, error: 'User not found' }, 404);
    if (target.data.role === 'owner') return json(res, { ok: false, error: 'Owner accounts cannot be changed here' }, 403);
    if ('status' in patch && userId === caller.id) {
      return json(res, { ok: false, error: 'You cannot suspend or reactivate your own account' }, 409);
    }
    // The role filter keeps an owner promoted after the read above untouched.
    const updated = await client
      .from('user_profiles')
      .update(patch)
      .eq('user_id', userId)
      .neq('role', 'owner')
      .select(PROFILE_COLUMNS)
      .maybeSingle();
    if (updated.error) throw new Error('Directory write failed');
    if (!updated.data) return json(res, { ok: false, error: 'Owner accounts cannot be changed here' }, 403);
    return json(res, { ok: true, user: directoryUser(updated.data) });
  } catch {
    return json(res, { ok: false, error: 'The user directory is unavailable' }, 503);
  }
}

async function grantPlan(res, caller, userId, grant, deps) {
  try {
    const client = adminClientFrom(deps);
    const target = await client.from('user_profiles').select(PROFILE_COLUMNS).eq('user_id', userId).maybeSingle();
    if (target.error) throw new Error('Directory read failed');
    if (!target.data) return json(res, { ok: false, error: 'User not found' }, 404);
    if (target.data.role === 'owner') return json(res, { ok: false, error: 'Owner accounts cannot be changed here' }, 403);
    const granted = await client.rpc('grant_manual_plan', {
      p_user: userId,
      p_plan: grant.plan,
      p_period_end: grant.periodEnd,
      p_granted_by: caller.id,
    });
    // 22023 carries the function's own argument message (no provider detail).
    if (granted.error?.code === '22023') return json(res, { ok: false, error: String(granted.error.message) }, 400);
    if (granted.error) throw new Error('Plan grant failed');
    const updated = await client.from('user_profiles').select(PROFILE_COLUMNS).eq('user_id', userId).maybeSingle();
    if (updated.error || !updated.data) throw new Error('Directory read failed');
    return json(res, { ok: true, user: directoryUser(updated.data) });
  } catch {
    return json(res, { ok: false, error: 'The user directory is unavailable' }, 503);
  }
}

/** { credits, kind, reason, requestId } for a valid body, or { error } with a plain message. */
function creditAdjustment(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Send credits, kind, reason and requestId' };
  }
  if (Object.keys(body).some((key) => !CREDIT_FIELDS.has(key))) {
    return { error: 'Send only credits, kind, reason, requestId and unitVersion' };
  }
  if (body.unitVersion != null && !CREDIT_UNITS.has(body.unitVersion)) {
    return { error: 'Unknown credit unit version. Reload before adjusting credits.' };
  }
  if (typeof body.kind !== 'string' || !CREDIT_KINDS.has(body.kind)) {
    return { error: 'The kind must be adjustment or topup' };
  }
  const raw = body.credits;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || Number(raw.toFixed(4)) !== raw) {
    return { error: 'Credits must be a number with at most four decimals' };
  }
  const credits = raw;
  if (credits === 0) return { error: 'Credits must not be zero' };
  const limit = CREDIT_LIMITS[body.unitVersion ?? 'credit-ten-paise-v1'];
  if (Math.abs(credits) > limit) {
    return { error: `Credits must be no more than ${limit.toLocaleString('en-US')} either way` };
  }
  if (body.kind === 'topup' && credits < 0) return { error: 'A top-up must be a positive number of credits' };
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason || reason.length > MAX_REASON_LENGTH) {
    return { error: `A reason is required, up to ${MAX_REASON_LENGTH} characters` };
  }
  // Chosen by the browser, once per adjustment, so a retry or a double click
  // reaches the database as the same request and applies once.
  if (typeof body.requestId !== 'string' || !UUID.test(body.requestId)) {
    return { error: 'Send a request id (a UUID) so a retry cannot apply twice' };
  }
  return { credits, kind: body.kind, reason, requestId: body.requestId.toLowerCase(), unitVersion: body.unitVersion ?? null };
}

async function adjustCredits(req, res, caller, userId, deps) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return json(res, { ok: false, error: 'Invalid JSON' }, 400);
  }
  const adjustment = creditAdjustment(body);
  if (adjustment.error) return json(res, { ok: false, error: adjustment.error }, 400);
  if (!UUID.test(userId)) return json(res, { ok: false, error: 'User not found' }, 404);
  try {
    const client = adminClientFrom(deps);
    const target = await client.from('user_profiles').select(PROFILE_COLUMNS).eq('user_id', userId).maybeSingle();
    if (target.error) throw new Error('Directory read failed');
    if (!target.data) return json(res, { ok: false, error: 'User not found' }, 404);
    if (target.data.role === 'owner') return json(res, { ok: false, error: 'Owner accounts cannot be changed here' }, 403);
    // The RPC checks the request id before denomination: exact legacy retries
    // still succeed once, while new unversioned/stale requests fail closed.
    const adjusted = await client.rpc('admin_adjust_credits_v2', {
      p_user: userId,
      p_credits: adjustment.credits,
      p_kind: adjustment.kind,
      p_reason: adjustment.reason,
      p_admin: caller.id,
      p_request_id: adjustment.requestId,
      p_unit_version: adjustment.unitVersion,
    });
    // 22023 carries the function's own argument message (no provider detail).
    if (adjusted.error?.code === '22023') return json(res, { ok: false, error: String(adjusted.error.message) }, 400);
    const result = adjusted.data;
    if (adjusted.error || result?.ok !== true || creditAmount(result.balance) === null) throw new Error('Credit adjustment failed');
    return json(res, {
      ok: true,
      repeated: result.repeated === true,
      kind: result.kind,
      credits: creditAmount(result.credits),
      expiresAt: result.expires_at ?? null,
      balance: creditAmount(result.balance),
    });
  } catch {
    return json(res, { ok: false, error: 'The credit adjustment could not be completed' }, 503);
  }
}

function methodNotAllowed(res, allow) {
  res.setHeader('Allow', allow);
  return json(res, { ok: false, error: `${allow} only` }, 405);
}

export async function handleUsersApi(req, res, next, deps = {}) {
  const url = new URL(req.url || '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/users')) {
    next();
    return;
  }
  const segments = url.pathname.split('/').slice(3);
  if (url.pathname === '/api/users') {
    if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
    const caller = await authorizeLocalUser(req, res, { admin: true, clientForToken: deps.clientForToken });
    if (!caller) return;
    const listing = directoryRequest(url, req);
    if (listing.error) return json(res, { ok: false, error: listing.error }, 400);
    return listUsers(res, deps, listing);
  }
  if (url.pathname.startsWith('/api/users/') && segments.length === 1 && segments[0]) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, 'PATCH');
    let userId;
    try {
      userId = decodeURIComponent(segments[0]);
    } catch {
      userId = '';
    }
    const caller = await authorizeLocalUser(req, res, { admin: true, clientForToken: deps.clientForToken });
    if (!caller) return;
    return updateUser(req, res, caller, userId, deps);
  }
  if (segments.length === 2 && segments[0] && segments[1] === 'credits') {
    if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
    let userId;
    try {
      userId = decodeURIComponent(segments[0]);
    } catch {
      userId = '';
    }
    const caller = await authorizeLocalUser(req, res, { admin: true, clientForToken: deps.clientForToken });
    if (!caller) return;
    return adjustCredits(req, res, caller, userId, deps);
  }
  return json(res, { ok: false, error: 'Not found' }, 404);
}

export function usersApiPlugin() {
  return {
    name: 'niyantran-users-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleUsersApi(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleUsersApi(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
  };
}
