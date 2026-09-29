/**
 * Admin user directory, backed by Supabase `public.user_profiles`.
 *
 *   GET   /api/users           internal admin: every profile, oldest first
 *   PATCH /api/users/:userId   internal admin: { active?: boolean, type?: persona }
 *                              or { plan: explorer|pro|enterprise, planEnd?: date|null }
 *
 * Accounts are created only through Supabase sign-up; this route never
 * creates, deletes or sets a password for anyone. Reads and writes use the
 * server's secret-key client after the route's own internal-admin check.
 * A plan is granted or revoked only through grant_manual_plan() (F2,
 * docs/specs/2026-09-29-f2-entitlements.md), which logs the granting admin.
 */
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from './authEmailProvider.mjs';
import { dbPersona, frontendPersona } from '../src/lib/personaMap.js';

const PROFILE_COLUMNS = 'user_id, email, first_name, last_name, persona, role, plan, status, created_at, '
  + 'plan_status, plan_period_end, plan_source, trial_started_at';
const PATCH_FIELDS = new Set(['active', 'type']);
const PLAN_FIELDS = new Set(['plan', 'planEnd']);
const GRANTABLE_PLANS = new Set(['explorer', 'pro', 'enterprise']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16 * 1024;

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

/** One user_profiles row in the directory shape. An allowlist: nothing else leaves. */
function directoryUser(row) {
  const email = String(row.email || '').trim().toLowerCase();
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || email.split('@')[0];
  const persona = frontendPersona(row.persona);
  // The effective plan, as my_entitlement() reads it: a period that has
  // ended is free. The stored plan stays until the next grant.
  const status = row.plan_status || (row.plan === 'explorer' ? 'free' : 'active');
  const end = row.plan_period_end || null;
  const lapsed = status !== 'free' && Boolean(end) && Date.parse(end) <= Date.now();
  return {
    id: row.user_id,
    name,
    email,
    type: persona,
    personaId: persona,
    plan: lapsed ? 'explorer' : row.plan === 'professional' ? 'pro' : row.plan,
    planStatus: lapsed ? 'free' : status,
    planEnd: end,
    planSource: row.plan_source || null,
    planLapsed: lapsed,
    trialUsed: Boolean(row.trial_started_at),
    active: row.status === 'active',
    status: row.status,
    role: row.role,
    createdAt: row.created_at,
  };
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
  return { plan: body.plan, periodEnd: body.plan === 'explorer' ? null : periodEnd };
}

async function listUsers(res, deps) {
  try {
    const { data, error } = await adminClientFrom(deps)
      .from('user_profiles')
      .select(PROFILE_COLUMNS)
      .order('created_at', { ascending: true });
    if (error || !Array.isArray(data)) throw new Error('Directory read failed');
    return json(res, { ok: true, users: data.map(directoryUser) });
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
    return json(res, { ok: false, error: 'Send plan (explorer, pro or enterprise) and optionally a future planEnd, nothing else' }, 400);
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
    return listUsers(res, deps);
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
