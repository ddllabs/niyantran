/**
 * POST /api/news/ingest — nter.news article push (Bearer NTER_TERMINAL_API_KEY).
 */
import { authorizeNterRequest, ingestNterArticle } from '../../server/nterNews.mjs';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-NTER-Source');
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST /api/news/ingest only' });
    return;
  }

  const auth = authorizeNterRequest(req);
  if (!auth.ok) {
    res.status(auth.status).json({ ok: false, error: auth.error });
    return;
  }

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const out = ingestNterArticle(payload, { sourceHeader: auth.sourceHeader });
    res.status(out.status || (out.ok ? 200 : 400)).json(out);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
