/**
 * GET /api/growth — World Bank GDP / CPI / unemployment for the G20-set.
 */
import { loadGrowth } from '../../server/resourcesApi.mjs';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ ok: false, error: 'GET only' });
    return;
  }
  try {
    const body = await loadGrowth();
    if (req.method === 'HEAD') {
      res.status(200).end();
      return;
    }
    res.status(200).json(body);
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message || String(err) });
  }
}
