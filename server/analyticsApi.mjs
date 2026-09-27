/**
 * Product analytics events → SQLite.
 *   POST /api/analytics/event  { name, props?, sessionId?, userEmail? }
 *   GET  /api/analytics/events?limit=100
 *   GET  /api/analytics/summary
 */
import { getDb, queryAll, run } from './db.mjs';

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
    if (body.length > 256 * 1024) break;
  }
  return body;
}

export async function handleAnalyticsApi(req, res, next) {
  const host = req.headers.host || 'localhost';
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

  try {
    const database = await getDb();

    if (url.pathname === '/api/analytics/event' && req.method === 'GET') {
      return json(res, { ok: true, endpoint: 'event', methods: ['POST'] });
    }

    if (url.pathname === '/api/analytics/event' && req.method === 'POST') {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      const name = String(payload.name || '').trim().slice(0, 120);
      if (!name) return json(res, { ok: false, error: 'name required' }, 400);
      const props = payload.props && typeof payload.props === 'object' ? payload.props : {};
      const sessionId = String(payload.sessionId || '').slice(0, 80);
      const userEmail = String(payload.userEmail || '').slice(0, 160).toLowerCase();
      const createdAt = new Date().toISOString();
      run(
        database,
        `INSERT INTO analytics_events (name, props_json, session_id, user_email, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [name, JSON.stringify(props), sessionId || null, userEmail || null, createdAt],
      );
      return json(res, { ok: true, stored: true, at: createdAt });
    }

    if (url.pathname === '/api/analytics/events' && req.method === 'GET') {
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100));
      const rows = queryAll(
        database,
        `SELECT id, name, props_json, session_id, user_email, created_at
         FROM analytics_events ORDER BY id DESC LIMIT ?`,
        [limit],
      ).map((r) => ({
        id: r.id,
        name: r.name,
        props: (() => {
          try {
            return JSON.parse(r.props_json || '{}');
          } catch {
            return {};
          }
        })(),
        sessionId: r.session_id,
        userEmail: r.user_email,
        createdAt: r.created_at,
      }));
      return json(res, { ok: true, rows, engine: 'sqlite' });
    }

    if (url.pathname === '/api/analytics/summary' && req.method === 'GET') {
      const counts = queryAll(
        database,
        `SELECT name, COUNT(*) AS n FROM analytics_events GROUP BY name ORDER BY n DESC LIMIT 50`,
      );
      const total = queryAll(database, `SELECT COUNT(*) AS n FROM analytics_events`)[0]?.n || 0;
      return json(res, { ok: true, total, byName: counts, engine: 'sqlite' });
    }

    return json(res, { ok: false, error: 'Not found' }, 404);
  } catch (err) {
    return json(res, { ok: false, error: err.message || String(err) }, 500);
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
