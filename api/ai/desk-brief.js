import { getCachedDeskBrief, runDeskBrief } from '../../server/deskBrief.mjs';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const feature = String(req.query?.feature || '');
    const tier = String(req.query?.tier || '');
    const hash = String(req.query?.hash || '');
    const scope = String(req.query?.scope || 'entry');
    const hit = await getCachedDeskBrief(feature, tier, hash, scope);
    if (!hit) {
      res.status(404).json({ ok: false, cached: false, error: 'No cached brief for this fingerprint.' });
      return;
    }
    res.status(200).json({ ok: true, ...hit });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST or GET only' });
    return;
  }

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const row =
      payload.row && typeof payload.row === 'object'
        ? payload.row
        : Array.isArray(payload.rows)
          ? payload.rows[0]
          : null;
    const feature = String(payload.feature || '').trim();
    const tier = String(payload.tier || '').trim();
    if (!row) {
      res.status(400).json({ ok: false, error: 'Select a row to organise' });
      return;
    }
    const out = await runDeskBrief({
      feature,
      tier,
      row,
      hash: String(payload.hash || ''),
      force: Boolean(payload.force),
      sourceNote: payload.sourceNote || '',
      sourceExtract: payload.sourceExtract || '',
      scope: payload.scope === 'substance' ? 'substance' : 'entry',
    });
    res.status(200).json({ ok: true, ...out });
  } catch (err) {
    const msg = err.message || String(err);
    res.status(/missing|required|Select a row|No rows/i.test(msg) ? 400 : 502).json({ ok: false, error: msg });
  }
}
