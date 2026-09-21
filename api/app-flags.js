import { readAppFlags, writeAppFlags } from '../../server/appFlags.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'GET') {
    res.status(200).json({ ok: true, flags: readAppFlags() });
    return;
  }

  if (req.method === 'PUT') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const flags = writeAppFlags({ testingPhase: Boolean(body.testingPhase) });
      res.status(200).json({ ok: true, flags });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || String(err) });
    }
    return;
  }

  res.status(405).json({ ok: false, error: 'GET or PUT /api/app-flags only' });
}
