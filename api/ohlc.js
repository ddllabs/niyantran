/**
 * GET /api/ohlc?symbol=&range= — Yahoo chart bars (home markets dependency).
 */
import { serveOhlc } from '../../server/homeApi.mjs';

export const config = {
  maxDuration: 20,
  includeFiles: ['public/data/**'],
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ ok: false, error: 'GET /api/ohlc only' });
    return;
  }

  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const symbol = url.searchParams.get('symbol') || '';
    const range = url.searchParams.get('range') || '1mo';
    if (!String(symbol).trim()) {
      res.status(400).json({ ok: false, error: 'symbol required' });
      return;
    }
    const body = await serveOhlc(symbol, range);
    res.status(200).json(body);
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message || String(err) });
  }
}
