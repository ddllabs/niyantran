/**
 * GET /api/home/latest — Latest from nter.news (ingested store).
 */
import { serveNterLatest } from '../../server/nterNews.mjs';

export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ ok: false, error: 'GET /api/home/latest only' });
    return;
  }

  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const limit = url.searchParams.get('limit');
    res.status(200).json(serveNterLatest({ limit }));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
