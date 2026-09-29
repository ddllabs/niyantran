/**
 * A-15 — per-user prefs (watchlist, tours) in Supabase
 * `public.user_preferences` (migration 20260928100000_user_preferences.sql).
 *   GET  /api/user-prefs (optional matching email for compatibility)
 *   PUT  /api/user-prefs  { watchlist?, tours?, email? }
 *
 * AI chats are no longer a preference (2026-09-28): research conversations
 * live in public.conversations. An `aiChats` field is ignored; the ai_chats
 * column was dropped by 20260929130000_drop_ai_chats.sql.
 *
 * Data access runs through a client bound to the caller's own bearer, so the
 * table's `user_id = auth.uid()` policies check ownership a second time. This
 * handler never uses a privileged key.
 */
import { authorizeLocalUser, localClientForToken } from './usersApi.mjs';

const TABLE = 'user_preferences';
const MAX_BODY_CHARS = 256 * 1024;
// Per-field byte limits on the compact JSON. The migration's CHECK constraints
// use the same numbers on the stored jsonb text as a backstop.
const FIELD_LIMITS = {
  watchlist: { column: 'watchlist', maxBytes: 64 * 1024 },
  tours: { column: 'tours', maxBytes: 64 * 1024 },
};

class TooLarge extends Error {}

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  // ADR 0010: on Vercel the body often arrives pre-parsed.
  let body;
  if (req.body && typeof req.body === 'object') body = JSON.stringify(req.body);
  else if (typeof req.body === 'string') body = req.body;
  else {
    body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > MAX_BODY_CHARS) throw new TooLarge();
    }
  }
  if (body.length > MAX_BODY_CHARS) throw new TooLarge();
  return body;
}

function bearerToken(req) {
  // authorizeLocalUser has already accepted exactly this header shape.
  return /^Bearer ([^\s,]+)$/i.exec(req.headers.authorization)[1];
}

export async function handleUserPrefsApi(req, res, next, deps = {}) {
  const host = req.headers?.host || 'localhost';
  const url = new URL(req.url, `http://${host}`);
  if (!url.pathname.startsWith('/api/user-prefs')) {
    next();
    return;
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (url.pathname !== '/api/user-prefs') return json(res, { ok: false, error: 'Not found' }, 404);
  if (!['GET', 'PUT'].includes(req.method)) return json(res, { ok: false, error: 'GET or PUT only' }, 405);
  const clientForToken = deps.clientForToken || localClientForToken;
  const caller = await authorizeLocalUser(req, res, { clientForToken });
  if (!caller) return;
  const email = caller.email;
  let payload;
  if (req.method === 'PUT') {
    try {
      payload = JSON.parse((await readBody(req)) || '{}');
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid prefs');
    } catch (error) {
      if (error instanceof TooLarge) return json(res, { ok: false, error: 'Preferences payload too large' }, 413);
      return json(res, { ok: false, error: 'Invalid preferences payload' }, 400);
    }
  }
  const supplied = req.method === 'GET' ? url.searchParams.getAll('email') : [payload.email];
  if (supplied.some((value) => value != null && (typeof value !== 'string' || value.trim().toLowerCase() !== email))) {
    return json(res, { ok: false, error: 'Preferences belong to the signed-in account' }, 403);
  }

  // Rows are keyed by the stable verified Auth user ID, never by email.
  let row;
  if (req.method === 'PUT') {
    row = { user_id: caller.id };
    for (const [field, { column, maxBytes }] of Object.entries(FIELD_LIMITS)) {
      // Omitted fields are not sent, so a partial PUT keeps the stored values.
      if (payload[field] === undefined) continue;
      if (Buffer.byteLength(JSON.stringify(payload[field]), 'utf8') > maxBytes) {
        return json(res, { ok: false, error: 'Preferences payload too large' }, 413);
      }
      row[column] = payload[field];
    }
  }

  try {
    const client = clientForToken(bearerToken(req));

    if (req.method === 'GET') {
      const { data, error } = await client
        .from(TABLE)
        .select('watchlist, tours, updated_at')
        .eq('user_id', caller.id)
        .maybeSingle();
      if (error) throw new Error('Preference read failed');
      return json(res, {
        ok: true,
        email,
        prefs: {
          watchlist: data?.watchlist ?? null,
          tours: data?.tours ?? null,
        },
        updatedAt: data?.updated_at ?? null,
        engine: 'supabase',
      });
    }

    // One INSERT ... ON CONFLICT DO UPDATE of only the supplied columns;
    // the table's trigger sets updated_at.
    const { data, error } = await client
      .from(TABLE)
      .upsert(row, { onConflict: 'user_id' })
      .select('updated_at')
      .single();
    if (error?.code === '23514') return json(res, { ok: false, error: 'Preferences payload too large' }, 413);
    if (error || !data) throw new Error('Preference write failed');
    return json(res, { ok: true, email, updatedAt: data.updated_at, engine: 'supabase' });
  } catch {
    return json(res, { ok: false, error: 'Unable to access preferences' }, 500);
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
