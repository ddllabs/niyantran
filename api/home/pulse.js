/**
 * GET /api/home/pulse — conflict pulse (GDELT / Open Fronts snapshot).
 */
import { serveHomePulse } from '../../server/homeApi.mjs';

export const config = {
  maxDuration: 30,
  includeFiles: ['public/data/**'],
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ ok: false, error: 'GET /api/home/pulse only' });
    return;
  }

  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const maxAgeH = Number(url.searchParams.get('maxAgeH'));
    const fresh = url.searchParams.get('fresh') === '1';
    const body = await serveHomePulse({
      maxAgeH: Number.isFinite(maxAgeH) && maxAgeH > 0 ? maxAgeH : undefined,
      fresh,
    });
    res.status(200).json(body);
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message || String(err) });
  }
}
