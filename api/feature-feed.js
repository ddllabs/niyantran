/**
 * GET /api/feature-feed?tier=&feature= — same handler as local Vite middleware.
 * Required on Vercel so Global Resources desks are not stuck on empty archive.
 */
import { serveFeatureFeed } from '../../server/featureFeed.mjs';

export const config = {
  maxDuration: 60,
  includeFiles: ['src/data/**', 'public/data/**'],
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ ok: false, error: 'GET /api/feature-feed only' });
    return;
  }

  try {
    const host = req.headers?.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);
    const body = await serveFeatureFeed(url.searchParams);
    if (req.method === 'HEAD') {
      res.status(200).end();
      return;
    }
    res.status(200).json(body);
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message || String(err) });
  }
}
