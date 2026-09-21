/**
 * Single Vercel serverless entry for ALL /api/* routes.
 * Hobby plan caps function *files* at 12 — one catch-all keeps every endpoint
 * without raising the function count. Client URLs are unchanged.
 */
import { runAiChat, runAiFetch } from '../server/aiApi.mjs';
import { readAppFlags, writeAppFlags } from '../server/appFlags.mjs';
import { getCachedDeskBrief, runDeskBrief } from '../server/deskBrief.mjs';
import { serveFeatureFeed } from '../server/featureFeed.mjs';
import { resolveGoogleLogin } from '../server/googleAuth.mjs';
import {
  refreshHomeSnapshots,
  serveHomeLatest,
  serveHomeMarkets,
  serveHomePulse,
  serveOhlc,
} from '../server/homeApi.mjs';
import { authorizeNterRequest, ingestNterArticle } from '../server/nterNews.mjs';
import { loadConstitutions, loadGrowth } from '../server/resourcesApi.mjs';
import { briefFromExtract, extractSource } from '../server/sourceExtract.mjs';
import { isExtractableSourceUrl, isHubListingUrl } from '../src/lib/sourceUrls.js';

export const config = {
  maxDuration: 60,
  includeFiles: ['{src/data/**,public/data/**}'],
};

function routePath(req) {
  const raw = String(req.url || '').split('?')[0] || '';
  let p = raw.replace(/\/+$/, '') || '/';
  if (!p.startsWith('/api/')) {
    const parts = req.query?.path;
    if (Array.isArray(parts)) p = `/api/${parts.join('/')}`;
    else if (typeof parts === 'string' && parts) p = `/api/${parts}`;
  }
  return p.replace(/\/+$/, '') || '/api';
}

function parseBody(req) {
  if (req.body == null || req.body === '') return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      return {};
    }
  }
  return req.body;
}

function q(req) {
  try {
    const host = req.headers?.host || 'localhost';
    return new URL(req.url || '/', `http://${host}`).searchParams;
  } catch {
    return new URLSearchParams();
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const path = routePath(req);
  const method = String(req.method || 'GET').toUpperCase();

  try {
    // —— feature / resources ——
    if (path === '/api/feature-feed') {
      if (method !== 'GET' && method !== 'HEAD') {
        res.status(405).json({ ok: false, error: 'GET /api/feature-feed only' });
        return;
      }
      const body = await serveFeatureFeed(q(req));
      if (method === 'HEAD') {
        res.status(200).end();
        return;
      }
      res.status(200).json(body);
      return;
    }

    if (path === '/api/constitutions') {
      if (method !== 'GET' && method !== 'HEAD') {
        res.status(405).json({ ok: false, error: 'GET only' });
        return;
      }
      const body = await loadConstitutions();
      if (method === 'HEAD') {
        res.status(200).end();
        return;
      }
      res.status(200).json(body);
      return;
    }

    if (path === '/api/growth') {
      if (method !== 'GET' && method !== 'HEAD') {
        res.status(405).json({ ok: false, error: 'GET only' });
        return;
      }
      const body = await loadGrowth();
      if (method === 'HEAD') {
        res.status(200).end();
        return;
      }
      res.status(200).json(body);
      return;
    }

    // —— home ——
    if (path === '/api/ohlc') {
      if (method !== 'GET' && method !== 'HEAD') {
        res.status(405).json({ ok: false, error: 'GET /api/ohlc only' });
        return;
      }
      const sp = q(req);
      const symbol = sp.get('symbol') || '';
      const range = sp.get('range') || '1mo';
      if (!String(symbol).trim()) {
        res.status(400).json({ ok: false, error: 'symbol required' });
        return;
      }
      res.status(200).json(await serveOhlc(symbol, range));
      return;
    }

    if (path === '/api/home/markets') {
      if (method !== 'GET' && method !== 'HEAD') {
        res.status(405).json({ ok: false, error: 'GET /api/home/markets only' });
        return;
      }
      const sp = q(req);
      const maxAgeH = Number(sp.get('maxAgeH'));
      res.status(200).json(
        await serveHomeMarkets({
          maxAgeH: Number.isFinite(maxAgeH) && maxAgeH > 0 ? maxAgeH : undefined,
          fresh: sp.get('fresh') === '1',
        }),
      );
      return;
    }

    if (path === '/api/home/latest') {
      if (method !== 'GET' && method !== 'HEAD') {
        res.status(405).json({ ok: false, error: 'GET /api/home/latest only' });
        return;
      }
      const sp = q(req);
      const maxAgeH = Number(sp.get('maxAgeH'));
      res.status(200).json(
        await serveHomeLatest({
          maxAgeH: Number.isFinite(maxAgeH) && maxAgeH > 0 ? maxAgeH : undefined,
          fresh: sp.get('fresh') === '1',
        }),
      );
      return;
    }

    if (path === '/api/home/pulse') {
      if (method !== 'GET' && method !== 'HEAD') {
        res.status(405).json({ ok: false, error: 'GET /api/home/pulse only' });
        return;
      }
      const sp = q(req);
      const maxAgeH = Number(sp.get('maxAgeH'));
      res.status(200).json(
        await serveHomePulse({
          maxAgeH: Number.isFinite(maxAgeH) && maxAgeH > 0 ? maxAgeH : undefined,
          fresh: sp.get('fresh') === '1',
        }),
      );
      return;
    }

    if (path === '/api/home/refresh') {
      if (method !== 'GET' && method !== 'POST' && method !== 'HEAD') {
        res.status(405).json({ ok: false, error: 'GET or POST /api/home/refresh only' });
        return;
      }
      res.status(200).json(await refreshHomeSnapshots());
      return;
    }

    // —— news ingest ——
    if (path === '/api/news/ingest') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-NTER-Source');
        res.status(204).end();
        return;
      }
      if (method !== 'POST') {
        res.status(405).json({ ok: false, error: 'POST /api/news/ingest only' });
        return;
      }
      const auth = authorizeNterRequest(req);
      if (!auth.ok) {
        res.status(auth.status).json({ ok: false, error: auth.error });
        return;
      }
      const payload = parseBody(req);
      const out = ingestNterArticle(payload, { sourceHeader: auth.sourceHeader });
      res.status(out.status || (out.ok ? 200 : 400)).json(out);
      return;
    }

    // —— app flags ——
    if (path === '/api/app-flags') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (method === 'GET') {
        res.status(200).json({ ok: true, flags: readAppFlags() });
        return;
      }
      if (method === 'PUT') {
        const body = parseBody(req);
        const flags = writeAppFlags({ testingPhase: Boolean(body.testingPhase) });
        res.status(200).json({ ok: true, flags });
        return;
      }
      res.status(405).json({ ok: false, error: 'GET or PUT /api/app-flags only' });
      return;
    }

    // —— auth ——
    if (path === '/api/auth/google') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (method === 'GET') {
        const id = String(process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '').trim();
        res.status(200).json({ ok: true, configured: Boolean(id), clientIdSuffix: id ? id.slice(-24) : null });
        return;
      }
      if (method !== 'POST') {
        res.status(405).json({ ok: false, error: 'POST /api/auth/google only' });
        return;
      }
      const out = await resolveGoogleLogin(parseBody(req));
      if (!out.ok) {
        const status = out.code === 'BAD_PASSWORD' || out.code === 'NEEDS_LINK' ? 401 : 400;
        res.status(status).json(out);
        return;
      }
      res.status(200).json({ ok: true, user: out.user, created: out.created, linked: Boolean(out.linked) });
      return;
    }

    // —— AI ——
    if (path === '/api/ai/chat') {
      if (method !== 'POST') {
        res.status(405).json({ ok: false, error: 'POST only' });
        return;
      }
      const out = await runAiChat(parseBody(req));
      res.status(200).json({ ok: true, ...out });
      return;
    }

    if (path === '/api/ai/fetch') {
      if (method !== 'GET') {
        res.status(405).json({ ok: false, error: 'GET only' });
        return;
      }
      const target = String(req.query?.url || q(req).get('url') || '');
      const out = await runAiFetch(target);
      res.status(200).json({ ok: true, ...out });
      return;
    }

    if (path === '/api/ai/desk-brief') {
      if (method === 'GET') {
        const sp = q(req);
        const feature = String(sp.get('feature') || req.query?.feature || '');
        const tier = String(sp.get('tier') || req.query?.tier || '');
        const hash = String(sp.get('hash') || req.query?.hash || '');
        const scope = String(sp.get('scope') || req.query?.scope || 'entry');
        const hit = await getCachedDeskBrief(feature, tier, hash, scope);
        if (!hit) {
          res.status(404).json({ ok: false, cached: false, error: 'No cached brief for this fingerprint.' });
          return;
        }
        res.status(200).json({ ok: true, ...hit });
        return;
      }
      if (method !== 'POST') {
        res.status(405).json({ ok: false, error: 'POST or GET only' });
        return;
      }
      const payload = parseBody(req);
      const row =
        payload.row && typeof payload.row === 'object'
          ? payload.row
          : Array.isArray(payload.rows)
            ? payload.rows[0]
            : null;
      if (!row) {
        res.status(400).json({ ok: false, error: 'Select a row to organise' });
        return;
      }
      const out = await runDeskBrief({
        feature: String(payload.feature || '').trim(),
        tier: String(payload.tier || '').trim(),
        row,
        hash: String(payload.hash || ''),
        force: Boolean(payload.force),
        sourceNote: payload.sourceNote || '',
        sourceExtract: payload.sourceExtract || '',
        scope: payload.scope === 'substance' ? 'substance' : 'entry',
      });
      res.status(200).json({ ok: true, ...out });
      return;
    }

    if (path === '/api/ai/source-extract') {
      if (method !== 'GET') {
        res.status(405).json({ ok: false, error: 'GET only' });
        return;
      }
      const sp = q(req);
      const target = String(sp.get('url') || req.query?.url || '');
      const title = String(sp.get('title') || req.query?.title || '');
      if (!target || isHubListingUrl(target) || !isExtractableSourceUrl(target)) {
        res.status(400).json({
          ok: false,
          error: 'URL is a registry hub or non-document link — not extractable as source body',
          url: target,
        });
        return;
      }
      const got = await extractSource(target);
      const brief = briefFromExtract(got.text || '', { title, max: 1100 });
      res.status(200).json({
        ok: true,
        url: got.url,
        kind: got.kind,
        mime: got.mime,
        bytes: got.bytes,
        error: got.error || null,
        text: got.text || '',
        brief,
        hasBinary: Boolean(got.base64),
      });
      return;
    }

    res.status(404).json({ ok: false, error: `No API route for ${path}` });
  } catch (err) {
    const msg = err.message || String(err);
    const status = /missing|required|invalid|Select a row|No rows|audience|issuer|expired|token|credential|verified/i.test(
      msg,
    )
      ? /audience|issuer|expired|token|credential|verified/i.test(msg)
        ? 401
        : 400
      : 502;
    res.status(status).json({ ok: false, error: msg });
  }
}
