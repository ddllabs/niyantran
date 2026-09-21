/**
 * GET|POST /api/home/refresh — rebuild home markets / news / conflict snapshots.
 */
import { refreshHomeSnapshots } from '../../server/homeApi.mjs';

export const config = {
  maxDuration: 60,
  includeFiles: ['public/data/**'],
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'HEAD') {
    res.status(405).json({ ok: false, error: 'GET or POST /api/home/refresh only' });
    return;
  }

  try {
    const body = await refreshHomeSnapshots();
    res.status(200).json(body);
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message || String(err) });
  }
}
