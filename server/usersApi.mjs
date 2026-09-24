/**
 * Shared issued-user store for Admin + marketing login.
 * SQLite (tmp/niyantran.sqlite) with JSON file migrate-on-read.
 *
 *   GET  /api/users
 *   PUT  /api/users   { users: [...] }
 */
import fs from 'fs';
import path from 'path';
import { getDb, queryAll, run } from './db.mjs';
import { createClient } from '@supabase/supabase-js';
import { writablePath } from './writableRoot.mjs';

const USERS_FILE = writablePath('issued-users.json');

const SEEDS = [
  {
    id: 'seed-analyst',
    name: 'Lead Analyst',
    email: 'analyst@niyantran',
    password: '12345678#',
    plan: 'enterprise',
    type: 'analyst',
    personaId: 'analyst',
    active: true,
    createdAt: '2026-01-15T00:00:00.000Z',
  },
  {
    id: 'seed-student',
    name: 'Student Desk',
    email: 'student@niyantran',
    password: '12345678#',
    plan: 'pro',
    type: 'student',
    personaId: 'student',
    active: true,
    createdAt: '2026-01-15T00:00:00.000Z',
  },
];

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function normalize(u) {
  if (!u || typeof u !== 'object') return null;
  const email = String(u.email || '')
    .trim()
    .toLowerCase();
  if (!email) return null;
  const plan = String(u.plan || 'explorer');
  return {
    id: String(u.id || `u-${email}`),
    name: String(u.name || email.split('@')[0]),
    email,
    password: String(u.password || ''),
    plan,
    type: String(u.type || 'analyst'),
    active: u.active !== false,
    personaId: u.personaId || u.persona_id || null,
    planStatus: u.planStatus || u.plan_status || (plan === 'explorer' ? 'free' : 'active'),
    trialEndsAt: u.trialEndsAt || u.trial_ends_at || null,
    billingYearly: Boolean(u.billingYearly ?? u.billing_yearly),
    googleSub: u.googleSub || u.google_sub || null,
    createdAt: u.createdAt || u.created_at || new Date().toISOString(),
  };
}

function mergeWithSeeds(list) {
  const byEmail = new Map();
  for (const s of SEEDS) byEmail.set(s.email, { ...s });
  for (const u of list || []) {
    const n = normalize(u);
    if (!n) continue;
    const seed = SEEDS.find((s) => s.email === n.email);
    if (seed) {
      byEmail.set(n.email, {
        ...seed,
        ...n,
        id: seed.id,
        email: seed.email,
        password: seed.password,
        type: n.type || seed.type,
        active: n.active !== false,
      });
      continue;
    }
    byEmail.set(n.email, n);
  }
  return [...byEmail.values()];
}

function rowToUser(r) {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    password: r.password,
    plan: r.plan,
    type: r.type,
    active: Number(r.active) !== 0,
    personaId: r.persona_id || null,
    planStatus: r.plan_status || (r.plan === 'explorer' ? 'free' : 'active'),
    trialEndsAt: r.trial_ends_at || null,
    billingYearly: Number(r.billing_yearly) === 1,
    googleSub: r.google_sub || null,
    createdAt: r.created_at,
  };
}

function readJsonFallback() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      const list = Array.isArray(parsed?.users) ? parsed.users : Array.isArray(parsed) ? parsed : [];
      return mergeWithSeeds(list);
    }
  } catch {
    /* fall through */
  }
  return mergeWithSeeds([]);
}

async function readUsers() {
  const database = await getDb();
  const rows = queryAll(database, `SELECT * FROM users ORDER BY created_at ASC`);
  if (!rows.length) {
    const fromJson = readJsonFallback();
    await writeUsers(fromJson);
    return fromJson;
  }
  return mergeWithSeeds(rows.map(rowToUser));
}

async function writeUsers(users) {
  const database = await getDb();
  // Exports omit passwords; metadata replacements must not erase credentials.
  const existing = queryAll(database, 'SELECT id, email, password FROM users');
  const list = mergeWithSeeds(users.map((user) => {
    const prior = existing.find((row) => row.id === user.id && row.email === String(user.email || '').trim().toLowerCase());
    return user.password === undefined && prior ? { ...user, password: prior.password } : user;
  }));
  const now = new Date().toISOString();
  run(database, `DELETE FROM users`);
  for (const u of list) {
    run(
      database,
      `INSERT INTO users (id, name, email, password, plan, type, active, persona_id, plan_status, trial_ends_at, billing_yearly, created_at, updated_at, google_sub)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        u.id,
        u.name,
        u.email,
        u.password,
        u.plan,
        u.type,
        u.active === false ? 0 : 1,
        u.personaId || null,
        u.planStatus || (u.plan === 'explorer' ? 'free' : 'active'),
        u.trialEndsAt || null,
        u.billingYearly ? 1 : 0,
        u.createdAt || now,
        now,
        u.googleSub || null,
      ],
    );
  }
  // Keep JSON mirror for older tooling / recovery.
  try {
    fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: list, updatedAt: now, engine: 'sqlite' }, null, 2));
  } catch {
    /* non-fatal */
  }
  return list;
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

function publicUsers(users) {
  return users.map((user) => {
    const { password: _password, ...safe } = normalize(user);
    return safe;
  });
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2 * 1024 * 1024) throw new Error('Request too large');
  }
  return body;
}

export async function handleUsersApi(req, res, next, deps = {}) {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/users')) {
    next();
    return;
  }
  if (url.pathname !== '/api/users') return json(res, { ok: false, error: 'Not found' }, 404);
  if (!['GET', 'PUT'].includes(req.method)) return json(res, { ok: false, error: 'GET or PUT only' }, 405);
  const caller = await authorizeLocalUser(req, res, { admin: true, clientForToken: deps.clientForToken });
  if (!caller) return;

  let list;
  if (req.method === 'PUT') {
    try {
      const payload = JSON.parse((await readBody(req)) || '{}');
      if (!Array.isArray(payload?.users) || payload.users.some((u) => !u || typeof u !== 'object' || Array.isArray(u))) {
        throw new Error('Invalid users');
      }
      list = payload.users;
    } catch {
      return json(res, { ok: false, error: 'Invalid users payload' }, 400);
    }
  }
  try {
    const users = req.method === 'GET'
      ? await (deps.readUsers || readUsers)()
      : await (deps.writeUsers || writeUsers)(list);
    return json(res, { ok: true, users: publicUsers(users), engine: 'sqlite' });
  } catch {
    return json(res, { ok: false, error: 'Unable to access local users' }, 500);
  }
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
