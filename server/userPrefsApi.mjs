/**
 * A-15 — per-user prefs in SQLite (watchlist, AI chats, tours).
 *   GET  /api/user-prefs (optional matching email for compatibility)
 *   PUT  /api/user-prefs  { watchlist?, aiChats?, tours?, email? }
 */
import { getDb, queryAll, run } from './db.mjs';
import { authorizeLocalUser } from './usersApi.mjs';

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2.5 * 1024 * 1024) throw new Error('Request too large');
  }
  return body;
}

function parseJson(raw, fallback) {
  try {
    if (raw == null || raw === '') return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function handleUserPrefsApi(req, res, next, deps = {}) {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/user-prefs')) {
    next();
    return;
  }

  if (url.pathname !== '/api/user-prefs') return json(res, { ok: false, error: 'Not found' }, 404);
  if (!['GET', 'PUT'].includes(req.method)) return json(res, { ok: false, error: 'GET or PUT only' }, 405);
  const caller = await authorizeLocalUser(req, res, { clientForToken: deps.clientForToken });
  if (!caller) return;
  const email = caller.email;
  let payload;
  if (req.method === 'PUT') {
    try {
      payload = JSON.parse((await readBody(req)) || '{}');
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid prefs');
    } catch {
      return json(res, { ok: false, error: 'Invalid preferences payload' }, 400);
    }
  }
  const supplied = req.method === 'GET' ? url.searchParams.getAll('email') : [payload.email];
  if (supplied.some((value) => value != null && (typeof value !== 'string' || value.trim().toLowerCase() !== email))) {
    return json(res, { ok: false, error: 'Preferences belong to the signed-in account' }, 403);
  }
  try {
    const database = await getDb();

    if (url.pathname === '/api/user-prefs' && req.method === 'GET') {
      const row = queryAll(database, `SELECT * FROM user_prefs WHERE user_email = ?`, [email])[0];
      if (!row) {
        return json(res, {
          ok: true,
          email,
          prefs: { watchlist: null, aiChats: null, tours: null },
          updatedAt: null,
          engine: 'sqlite',
        });
      }
      return json(res, {
        ok: true,
        email,
        prefs: {
          watchlist: parseJson(row.watchlist_json, null),
          aiChats: parseJson(row.ai_chats_json, null),
          tours: parseJson(row.tours_json, null),
        },
        updatedAt: row.updated_at,
        engine: 'sqlite',
      });
    }

    if (url.pathname === '/api/user-prefs' && req.method === 'PUT') {

      const existing = queryAll(database, `SELECT * FROM user_prefs WHERE user_email = ?`, [email])[0];
      const watchlist =
        payload.watchlist !== undefined
          ? JSON.stringify(payload.watchlist)
          : existing?.watchlist_json ?? null;
      const aiChats =
        payload.aiChats !== undefined ? JSON.stringify(payload.aiChats) : existing?.ai_chats_json ?? null;
      const tours = payload.tours !== undefined ? JSON.stringify(payload.tours) : existing?.tours_json ?? null;
      const updatedAt = new Date().toISOString();

      run(
        database,
        `INSERT INTO user_prefs (user_email, watchlist_json, ai_chats_json, tours_json, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_email) DO UPDATE SET
           watchlist_json = excluded.watchlist_json,
           ai_chats_json = excluded.ai_chats_json,
           tours_json = excluded.tours_json,
           updated_at = excluded.updated_at`,
        [email, watchlist, aiChats, tours, updatedAt],
      );
      return json(res, { ok: true, email, updatedAt, engine: 'sqlite' });
    }

    return json(res, { ok: false, error: 'Not found' }, 404);
  } catch {
    return json(res, { ok: false, error: 'Unable to access local preferences' }, 500);
  }
}

export function userPrefsApiPlugin() {
  return {
    name: 'niyantran-user-prefs-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleUserPrefsApi(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleUserPrefsApi(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
  };
}
