/**
 * Single Vercel serverless entry for ALL /api/* routes (Hobby ≤12 function files).
 * vercel.json rewrites /api/* → /api/router?__route=<path> so URLs stay the same.
 */
import { getCachedDeskBrief, runDeskBrief } from '../server/deskBrief.mjs';
import { serveFeatureFeed } from '../server/featureFeed.mjs';
import { serveNationalLanding } from '../server/nationalLandingSummary.mjs';
import { serveLawLanding } from '../server/lawLandingSummary.mjs';
import { serveEconomicsLanding } from '../server/economicsLandingSummary.mjs';
import { serveCarbonLanding } from '../server/carbonLandingSummary.mjs';
import { serveSportsLanding } from '../server/sportsLandingSummary.mjs';
import { serveEntertainmentLanding } from '../server/entertainmentLandingSummary.mjs';
import { serveGlobalLanding } from '../server/globalLandingSummary.mjs';
import {
  refreshHomeSnapshots,
  serveHomeLatest,
  serveHomeMarkets,
  serveHomePulse,
  serveHomeSegments,
  serveOhlc,
} from '../server/homeApi.mjs';
import { authorizeNterRequest, ingestNterArticle } from '../server/nterNews.mjs';
import { loadConstitutions, loadGrowth } from '../server/resourcesApi.mjs';
import { briefFromExtract, extractSource } from '../server/sourceExtract.mjs';
import { isExtractableSourceUrl, isHubListingUrl } from '../src/lib/sourceUrls.js';
import { authorizeLocalUser, handleUsersApi } from '../server/usersApi.mjs';
import { handleLiveTvApi } from '../server/liveTvApi.mjs';
import { handleMarketingMediaApi } from '../server/marketingMediaApi.mjs';
import { handleAnalyticsApi } from '../server/analyticsApi.mjs';
import { handleUserPrefsApi } from '../server/userPrefsApi.mjs';
import { handleBillingApi } from '../server/billingApi.mjs';
import { handleTransitApi } from '../server/transitApi.mjs';
import { handleDiplomacyRequest } from '../server/diplomacyApi.mjs';
import { handleAssetsRequest } from '../server/assetsApi.mjs';

export const config = {
  maxDuration: 60,
  includeFiles: ['{src/data/**,public/data/**}'],
};

function routePath(req) {
  // Prefer explicit rewrite param from vercel.json (via req.query or req.url)
  let via = req.query?.__route;
  if (!via && req.url) {
    try {
      const host = req.headers?.host || 'localhost';
      const sp = new URL(req.url, `http://${host}`).searchParams;
      via = sp.get('__route');
    } catch {
      // ignore
    }
  }
  if (typeof via === 'string' && via.trim()) {
    const s = via.trim().replace(/^\/+/, '');
    return `/api/${s}`.replace(/\/+$/, '') || '/api';
  }
  if (Array.isArray(via) && via.length) {
    return `/api/${via.map(String).join('/')}`.replace(/\/+$/, '');
  }

  const raw = String(req.url || '').split('?')[0] || '';
  let p = raw.replace(/\/+$/, '') || '/';
  if (p === '/api/router' || p === '/api/router.js') p = '/api';
  if (!p.startsWith('/api/')) {
    p = p.startsWith('/') ? `/api${p}` : `/api/${p}`;
  }
  p = p.replace(/^\/api\/api\//, '/api/');
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
    const sp = new URL(req.url || '/', `http://${host}`).searchParams;
    // Drop internal rewrite key from URLSearchParams copies used by handlers
    sp.delete('__route');
    return sp;
  } catch {
    return new URLSearchParams();
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const path = routePath(req);
  const method = String(req.method || 'GET').toUpperCase();

  try {
    if (path === '/api/national-landing' || path === '/api/global-landing' || path === '/api/law-landing' || path === '/api/economics-landing' || path === '/api/carbon-landing' || path === '/api/sports-landing' || path === '/api/entertainment-landing') {
      const global = path === '/api/global-landing';
      const law = path === '/api/law-landing';
      const economics = path === '/api/economics-landing';
      const carbon = path === '/api/carbon-landing';
      const sports = path === '/api/sports-landing';
      const entertainment = path === '/api/entertainment-landing';
      if (method !== 'GET') { res.status(405).json({ ok: false, error: 'GET only' }); return; }
      try {
        const body = await (entertainment ? serveEntertainmentLanding : sports ? serveSportsLanding : carbon ? serveCarbonLanding : economics ? serveEconomicsLanding : law ? serveLawLanding : global ? serveGlobalLanding : serveNationalLanding)(q(req), serveFeatureFeed);
        res.status(body.ok ? 200 : 502).json(body);
      } catch (err) {
        res.status(err.message === `Unknown ${entertainment ? 'Entertainment' : sports ? 'Sports' : carbon ? 'Carbon' : economics ? 'Economics' : law ? 'Law' : global ? 'Global' : 'National'} module` ? 400 : 502).json({ ok: false, error: `${entertainment ? 'Entertainment' : sports ? 'Sports' : carbon ? 'Carbon' : economics ? 'Economics' : law ? 'Law' : global ? 'Global' : 'National'} summary unavailable` });
      }
      return;
    }
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

    if (path === '/api/home/segments') {
      if (method !== 'GET' && method !== 'HEAD') {
        res.status(405).json({ ok: false, error: 'GET /api/home/segments only' });
        return;
      }
      res.status(200).json(await serveHomeSegments());
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

    if (path.startsWith('/api/livetv')) {
      const qStr = q(req).toString();
      req.url = qStr ? `${path}?${qStr}` : path;
      await handleLiveTvApi(req, res, () => {
        res.status(404).json({ ok: false, error: `No Live TV route for ${path}` });
      });
      return;
    }

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
      const out = await ingestNterArticle(parseBody(req), { sourceHeader: auth.sourceHeader });
      res.status(out.status || (out.ok ? 200 : 400)).json(out);
      return;
    }

    if (path === '/api/users' || path.startsWith('/api/users/')) {
      req.url = path;
      await handleUsersApi(req, res, () => {
        res.status(404).json({ ok: false, error: 'Not found' });
      });
      return;
    }

    // /api/auth/* is not served in production (2026-09-28): the app signs in
    // through Supabase Auth directly, and a server-side password proxy would
    // pool every attempt behind this deployment's addresses.

    if (path.startsWith('/api/marketing/intro-video')) {
      const qStr = q(req).toString();
      req.url = qStr ? `${path}?${qStr}` : path;
      await handleMarketingMediaApi(req, res, () => {
        res.status(404).json({ ok: false, error: `No marketing route for ${path}` });
      });
      return;
    }

    if (path.startsWith('/api/analytics')) {
      const qStr = q(req).toString();
      req.url = qStr ? `${path}?${qStr}` : path;
      await handleAnalyticsApi(req, res, () => {
        res.status(404).json({ ok: false, error: `No analytics route for ${path}` });
      });
      return;
    }

    if (path.startsWith('/api/user-prefs')) {
      const qStr = q(req).toString();
      req.url = qStr ? `${path}?${qStr}` : path;
      await handleUserPrefsApi(req, res, () => {
        res.status(404).json({ ok: false, error: `No user-prefs route for ${path}` });
      });
      return;
    }

    if (path.startsWith('/api/billing')) {
      const qStr = q(req).toString();
      const host = req.headers?.host || 'localhost';
      const url = new URL(qStr ? `${path}?${qStr}` : path, `http://${host}`);
      const handled = await handleBillingApi(req, res, url);
      if (handled) return;
      res.status(404).json({ ok: false, error: `No billing route for ${path}` });
      return;
    }

    if (['/api/air', '/api/ships', '/api/ais', '/api/vessels'].includes(path)) {
      const qStr = q(req).toString();
      req.url = qStr ? `${path}?${qStr}` : path;
      await handleTransitApi(req, res, () => {
        res.status(404).json({ ok: false, error: `No transit route for ${path}` });
      });
      return;
    }

    if (path === '/api/opensanctions' || path === '/api/fts') {
      const qStr = q(req).toString();
      req.url = qStr ? `${path}?${qStr}` : path;
      await handleDiplomacyRequest(req, res, () => {
        res.status(404).json({ ok: false, error: `No diplomacy route for ${path}` });
      });
      return;
    }

    if (['/api/portwatch', '/api/launches', '/api/celestrak', '/api/wb-projects'].includes(path)) {
      const qStr = q(req).toString();
      req.url = qStr ? `${path}?${qStr}` : path;
      await handleAssetsRequest(req, res, () => {
        res.status(404).json({ ok: false, error: `No assets route for ${path}` });
      });
      return;
    }

    // /api/ai/chat (the legacy AI path's proxy) was retired on 2026-09-28: the
    // panel and the admin persona probe call research-chat directly.

    if (path === '/api/ai/desk-brief') {
      if (method === 'GET') {
        const sp = q(req);
        const hit = await getCachedDeskBrief(
          String(sp.get('feature') || req.query?.feature || ''),
          String(sp.get('tier') || req.query?.tier || ''),
          String(sp.get('hash') || req.query?.hash || ''),
          String(sp.get('scope') || req.query?.scope || 'entry'),
        );
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
      try {
        const out = await runDeskBrief({
          feature: String(payload.feature || '').trim(),
          tier: String(payload.tier || '').trim(),
          row,
          hash: String(payload.hash || ''),
          force: Boolean(payload.force),
          sourceNote: payload.sourceNote || '',
          sourceExtract: payload.sourceExtract || '',
          scope: payload.scope === 'substance' ? 'substance' : 'entry',
          authorization: req.headers?.authorization,
        });
        res.status(200).json({ ok: true, ...out });
      } catch (err) {
        // Statuses set by the forwarder (401, upstream 4xx, generic 502/503).
        if (!err?.status) throw err;
        res.status(err.status).json({ ok: false, error: err.message });
      }
      return;
    }

    if (path === '/api/ai/source-extract') {
      if (method !== 'GET') {
        res.status(405).json({ ok: false, error: 'GET only' });
        return;
      }
      // Signed-in active accounts only; extractSource also refuses any hop
      // that resolves to a non-public address.
      if (!(await authorizeLocalUser(req, res))) return;
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
    const raw = err.message || String(err);
    const msg = /sql-wasm|sql\.js|ENOENT|WASM/i.test(raw)
      ? 'Sign-in is temporarily unavailable. Please try again in a moment, or create an account first.'
      : raw;
    const status = /missing|required|requires|invalid|disabled|Select a row|No rows|audience|issuer|expired|token|credential|verified|auth|unauthorized/i.test(
      raw,
    )
      ? /audience|issuer|expired|token|credential|verified|auth|requires.*auth|unauthorized/i.test(raw)
        ? 401
        : 400
      : 502;
    res.status(status).json({ ok: false, error: msg });
  }
}
