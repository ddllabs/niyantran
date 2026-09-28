/**
 * Product analytics events → Supabase `public.analytics_events`.
 *   POST /api/analytics/event  { name, props?, sessionId?, userEmail? }  (open to anonymous visitors)
 *   GET  /api/analytics/events?limit=100                                  (internal admin)
 *   GET  /api/analytics/summary                                           (internal admin)
 *
 * Writes and reads use the server-side secret key, after this route's own
 * checks; the table grants clients nothing. A caller-supplied `userEmail` is
 * ignored, and `user_id` is recorded only from a verified bearer. Events are
 * limited to 60 a minute per client (analytics_rate_hit, hashed IP).
 */
import { createHmac } from 'node:crypto';
import { getSupabaseAdminClient } from './authEmailProvider.mjs';
import { authorizeLocalUser, localClientForToken } from './usersApi.mjs';

// Bounds mirror the CHECK constraints in 20260928100100_analytics_events.sql.
const NAME_PATTERN = /^[a-z0-9][a-z0-9_.:-]*$/;
const MAX_NAME = 64;
const MAX_SESSION_ID = 64;
const MAX_PROPS_BYTES = 4096;
const MAX_BODY_BYTES = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Owner decision 2026-09-28: 60 events a minute per client.
const RATE_LIMIT = 60;
const RATE_WINDOW_SECONDS = 60;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  if (typeof req.body === 'string') return req.body;
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new HttpError(413, 'Event too large');
  }
  return body;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Returns the row to insert, or throws HttpError(400) for anything out of bounds. */
function parseEvent(raw) {
  let payload;
  try {
    payload = JSON.parse(raw || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
  if (!isPlainObject(payload)) throw new HttpError(400, 'Invalid event');

  const { name, props, sessionId } = payload;
  if (typeof name !== 'string' || name.length > MAX_NAME || !NAME_PATTERN.test(name)) {
    throw new HttpError(400, 'Invalid event name');
  }
  const eventProps = props ?? {};
  if (!isPlainObject(eventProps) || Buffer.byteLength(JSON.stringify(eventProps)) > MAX_PROPS_BYTES) {
    throw new HttpError(400, 'Invalid event props');
  }
  if (sessionId != null && (typeof sessionId !== 'string' || sessionId.length > MAX_SESSION_ID)) {
    throw new HttpError(400, 'Invalid session id');
  }
  return { name, props: eventProps, session_id: sessionId || null };
}

/**
 * The verified user id for a bearer, or null. Never rejects the request:
 * anonymous events are allowed, so a missing, malformed or expired bearer
 * just means the event is recorded without a user.
 */
async function verifiedUserId(req, clientForToken) {
  const header = req.headers?.authorization;
  const match = typeof header === 'string' && /^Bearer ([^\s,]+)$/i.exec(header);
  if (!match) return null;
  try {
    const verified = await clientForToken(match[1]).auth.getUser(match[1]);
    const id = verified?.data?.user?.id;
    return !verified?.error && typeof id === 'string' && UUID.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** The client address as Vercel reports it (x-real-ip), else the first x-forwarded-for hop. */
function clientIp(req) {
  const real = req.headers?.['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return real.trim();
  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * The counter key: an HMAC of the IP, keyed by a server secret, so the
 * database never holds a raw or brute-forceable address. The constant
 * fallback only applies where no secret is configured (a bare local run).
 */
function rateBucket(req) {
  const secret = process.env.ANALYTICS_RATE_SALT || process.env.SUPABASE_SECRET_KEY || 'niyantran-analytics-rate';
  return `ip:${createHmac('sha256', secret).update(clientIp(req)).digest('hex')}`;
}

/** False only when the counter says the client is over the limit; a limiter failure lets the event through. */
async function withinRateLimit(req, deps) {
  try {
    const { data, error } = await deps.adminClient().rpc('analytics_rate_hit', {
      p_bucket: rateBucket(req),
      p_limit: RATE_LIMIT,
      p_window_seconds: RATE_WINDOW_SECONDS,
    });
    return error ? true : data !== false;
  } catch {
    return true;
  }
}

async function recordEvent(req, res, deps) {
  let row;
  try {
    row = parseEvent(await readBody(req));
  } catch (err) {
    if (err instanceof HttpError) return json(res, { ok: false, error: err.message }, err.status);
    return json(res, { ok: false, error: 'Invalid event' }, 400);
  }
  if (!(await withinRateLimit(req, deps))) {
    res.setHeader('Retry-After', String(RATE_WINDOW_SECONDS));
    return json(res, { ok: false, error: 'Too many events' }, 429);
  }
  row.user_id = await verifiedUserId(req, deps.clientForToken);

  try {
    const { error } = await deps.adminClient().from('analytics_events').insert(row);
    if (error) {
      // 22xxx data exceptions and 23514 check violations come from the caller's
      // data; anything else is the store. Provider detail never reaches the caller.
      const code = String(error.code || '');
      if (code === '23514' || code.startsWith('22')) return json(res, { ok: false, error: 'Invalid event' }, 400);
      return json(res, { ok: false, error: 'Analytics storage unavailable' }, 503);
    }
  } catch {
    return json(res, { ok: false, error: 'Analytics storage unavailable' }, 503);
  }
  return json(res, { ok: true, stored: true, at: new Date().toISOString() });
}

async function listEvents(url, res, deps) {
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100));
  const { data, error } = await deps
    .adminClient()
    .from('analytics_events')
    .select('id, name, props, session_id, user_id, created_at')
    .order('id', { ascending: false })
    .limit(limit);
  if (error) throw new Error('read failed');
  const rows = (data || []).map((r) => ({
    id: r.id,
    name: r.name,
    props: r.props || {},
    sessionId: r.session_id,
    userId: r.user_id,
    // Emails are no longer stored; the key stays so existing readers keep their shape.
    userEmail: null,
    createdAt: r.created_at,
  }));
  return json(res, { ok: true, rows, engine: 'supabase' });
}

async function summarise(res, deps) {
  const { data, error } = await deps.adminClient().rpc('analytics_event_summary', { p_limit: 50 });
  if (error) throw new Error('summary failed');
  return json(res, { ok: true, total: Number(data?.total) || 0, byName: data?.byName || [], engine: 'supabase' });
}

export async function handleAnalyticsApi(req, res, next, deps = {}) {
  const host = req.headers?.host || 'localhost';
  const url = new URL(req.url, `http://${host}`);
  if (!url.pathname.startsWith('/api/analytics')) {
    next();
    return;
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const resolved = {
    adminClient: deps.adminClient || getSupabaseAdminClient,
    clientForToken: deps.clientForToken || localClientForToken,
  };

  if (url.pathname === '/api/analytics/event' && req.method === 'GET') {
    return json(res, { ok: true, endpoint: 'event', methods: ['POST'] });
  }

  if (url.pathname === '/api/analytics/event' && req.method === 'POST') {
    return recordEvent(req, res, resolved);
  }

  const isRead = req.method === 'GET' && ['/api/analytics/events', '/api/analytics/summary'].includes(url.pathname);
  if (!isRead) return json(res, { ok: false, error: 'Not found' }, 404);

  const caller = await authorizeLocalUser(req, res, { admin: true, clientForToken: resolved.clientForToken });
  if (!caller) return;
  try {
    if (url.pathname === '/api/analytics/events') return await listEvents(url, res, resolved);
    return await summarise(res, resolved);
  } catch {
    return json(res, { ok: false, error: 'Analytics storage unavailable' }, 503);
  }
}

export function analyticsApiPlugin() {
  return {
    name: 'niyantran-analytics-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleAnalyticsApi(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleAnalyticsApi(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
  };
}
