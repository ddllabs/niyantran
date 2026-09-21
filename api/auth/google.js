import { resolveGoogleLogin } from '../../server/googleAuth.mjs';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'GET') {
    const id = String(process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '').trim();
    res.status(200).json({ ok: true, configured: Boolean(id), clientIdSuffix: id ? id.slice(-24) : null });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST /api/auth/google only' });
    return;
  }

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const out = await resolveGoogleLogin(payload);
    if (!out.ok) {
      const status = out.code === 'BAD_PASSWORD' || out.code === 'NEEDS_LINK' ? 401 : 400;
      res.status(status).json(out);
      return;
    }
    res.status(200).json({ ok: true, user: out.user, created: out.created, linked: Boolean(out.linked) });
  } catch (err) {
    const msg = err.message || String(err);
    const status = /audience|issuer|expired|token|credential|Missing|verified/i.test(msg) ? 401 : 500;
    res.status(status).json({ ok: false, code: 'VERIFY_FAILED', error: msg });
  }
}
