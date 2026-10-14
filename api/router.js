/**
 * Single Vercel serverless entry for ALL /api/* routes (Hobby ≤12 function files).
 * vercel.json rewrites /api/* → /api/router?__route=<path> so URLs stay the same.
 */
import { getCachedDeskBrief, runDeskBrief } from '../server/deskBrief.mjs';
import { serveFeatureFeedStoredFirst, serveFeatureFeedWithBackup, serveFeatureFeedWithinLimit } from '../server/featureFeed.mjs';
import { serveFeaturePage, wantsPage } from '../server/featurePage.mjs';
import { serveNationalLanding } from '../server/nationalLandingSummary.mjs';
import { serveLawLanding } from '../server/lawLandingSummary.mjs';
import { serveEconomicsLanding } from '../server/economicsLandingSummary.mjs';
import { serveCarbonLanding } from '../server/carbonLandingSummary.mjs';
import { serveSportsLanding } from '../server/sportsLandingSummary.mjs';
import { serveEntertainmentLanding } from '../server/entertainmentLandingSummary.mjs';
import { serveGlobalLanding } from '../server/globalLandingSummary.mjs';
import { serveStateLanding } from '../server/stateLandingSummary.mjs';
import {
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
import { handleSiteFiguresApi } from '../server/siteFiguresApi.mjs';
import { handleAnalyticsApi } from '../server/analyticsApi.mjs';
import { handleUserPrefsApi } from '../server/userPrefsApi.mjs';
import { handleBillingApi } from '../server/billingApi.mjs';
import { handleTransitApi } from '../server/transitApi.mjs';
import { handleDiplomacyRequest } from '../server/diplomacyApi.mjs';
import { handleAssetsRequest } from '../server/assetsApi.mjs';
import { handleSiteIconRequest } from '../server/siteIconApi.mjs';
import { handleFeedRefresh } from '../server/feedStore.mjs';

export const config = {
  maxDuration: 60,
  includeFiles: ['{src/data/**,public/data/**}'],
  // F169 (owner, 2026-10-14): no backup pack on the live function. server/backupFeed.mjs reads one
  // there only for a module on LIVE_BACKUP_PACKS (empty); the workbooks stay in the repository for
  // the local dev server.
  excludeFiles: ['backup/**'],
};

// F154: the only routes Vercel's CDN may keep. Each is public, needs no sign-in, and its answer
// depends only on the path and query string. Any route not listed here stays `no-store`.
const EDGE_CACHED_ROUTES = new Set([
  '/api/national-landing',
  '/api/global-landing',
  '/api/law-landing',
  '/api/economics-landing',
  '/api/carbon-landing',
  '/api/sports-landing',
  '/api/entertainment-landing',
  '/api/state-landing',
  '/api/feature-feed',
  '/api/home/segments',
  '/api/constitutions',
  '/api/growth',
]);
// These set their own Cache-Control over the router's `no-store`; the router leaves them alone.
const OWN_CACHE_ROUTES = new Set(['/api/site-figures', '/api/site-icon']);

// Vercel-CDN-Cache-Control is read by Vercel's CDN only and is not passed on, so the browser
// sees Cache-Control alone and checks back every time (Vercel docs, "Cache-Control headers").
export const API_CACHE = {
  browser: 'public, max-age=0, must-revalidate',
  cdn: 'public, s-maxage=300, stale-while-revalidate=86400',
  // An archive answer given because the live source passed its time limit: re-checked sooner.
  cdnArchive: 'public, s-maxage=60, stale-while-revalidate=86400',
  // F169 C4: an answer read from the feed store (`served: 'store'`). The store changes at most every
  // 15 minutes and a cached answer's age is shown from its own fetched time, so one minute at the edge
  // loses nothing; a short stale window also means switching a module's `serve` off (the rollback) is
  // seen within minutes, not a day.
  cdnStore: 'public, s-maxage=60, stale-while-revalidate=300',
};

/** 'edge', 'own' or 'no-store' for one request. */
export function cachePolicyFor(path, method) {
  if (OWN_CACHE_ROUTES.has(path)) return 'own';
  if ((method === 'GET' || method === 'HEAD') && EDGE_CACHED_ROUTES.has(path)) return 'edge';
  return 'no-store';
}

function isPendingAnswer(body) {
  if (body?.served !== 'archive') return false;
  return !(body.rows || []).some((r) => r && r.status !== 'source_status');
}

// Decides the headers when the answer is written, once its status is known: only a 2xx answer
// may be kept; an error, a refusal or a timeout keeps `no-store`.
function cacheAtEdgeOnSuccess(res) {
  let body;
  const apply = () => {
    const status = Number(res.statusCode) || 200;
    if (status < 200 || status >= 300) {
      res.setHeader('Cache-Control', 'no-store');
      return;
    }
    // F168: a pending answer (stored records served, none to show) is not kept, so the page's
    // retries reach the server again.
    if (isPendingAnswer(body)) {
      res.setHeader('Cache-Control', 'no-store');
      return;
    }
    res.setHeader('Cache-Control', API_CACHE.browser);
    res.setHeader(
      'Vercel-CDN-Cache-Control',
      body?.served === 'archive' ? API_CACHE.cdnArchive : body?.served === 'store' ? API_CACHE.cdnStore : API_CACHE.cdn,
    );
  };
  const json = res.json.bind(res);
  const end = res.end.bind(res);
  res.json = (value) => {
    body = value;
    apply();
    return json(value);
  };
  res.end = (...args) => {
    apply();
    return end(...args);
  };
}

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
  if (cachePolicyFor(path, method) === 'edge') cacheAtEdgeOnSuccess(res);

  try {
    if (path === '/api/national-landing' || path === '/api/global-landing' || path === '/api/law-landing' || path === '/api/economics-landing' || path === '/api/carbon-landing' || path === '/api/sports-landing' || path === '/api/entertainment-landing' || path === '/api/state-landing') {
      const state = path === '/api/state-landing';
      const global = path === '/api/global-landing';
      const law = path === '/api/law-landing';
      const economics = path === '/api/economics-landing';
      const carbon = path === '/api/carbon-landing';
      const sports = path === '/api/sports-landing';
      const entertainment = path === '/api/entertainment-landing';
      if (method !== 'GET') { res.status(405).json({ ok: false, error: 'GET only' }); return; }
      try {
        const body = await (state ? serveStateLanding : entertainment ? serveEntertainmentLanding : sports ? serveSportsLanding : carbon ? serveCarbonLanding : economics ? serveEconomicsLanding : law ? serveLawLanding : global ? serveGlobalLanding : serveNationalLanding)(q(req), (economics || carbon || sports || entertainment) ? serveFeatureFeedWithinLimit : serveFeatureFeedWithBackup);
        res.status(body.ok ? 200 : 502).json(body);
      } catch (err) {
        res.status(err.message === `Unknown ${state ? 'State' : entertainment ? 'Entertainment' : sports ? 'Sports' : carbon ? 'Carbon' : economics ? 'Economics' : law ? 'Law' : global ? 'Global' : 'National'} module` ? 400 : 502).json({ ok: false, error: `${state ? 'State' : entertainment ? 'Entertainment' : sports ? 'Sports' : carbon ? 'Carbon' : economics ? 'Economics' : law ? 'Law' : global ? 'Global' : 'National'} summary unavailable` });
      }
      return;
    }
    if (path === '/api/feature-feed') {
      if (method !== 'GET' && method !== 'HEAD') {
        res.status(405).json({ ok: false, error: 'GET /api/feature-feed only' });
        return;
      }
      // F156: a page of a large module when `page` is asked for; otherwise the whole answer, as before.
      const params = q(req);
      const { status, body } = wantsPage(params)
        ? await serveFeaturePage(params, serveFeatureFeedWithBackup)
        : { status: 200, body: await serveFeatureFeedStoredFirst(params) };
      if (method === 'HEAD') {
        res.status(status).end();
        return;
      }
      res.status(status).json(body);
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

    // F169 phase 4 (C3, ADR 0012): the 5-minute pg_cron job posts here through pg_net with the
    // shared secret in x-feed-refresh-secret. Dormant (503) until FEED_REFRESH_SECRET is set.
    //
    // pg_net time limit (checked 2026-10-15): net.http_post takes timeout_milliseconds as a plain
    // int (default 5000 in pg_net 0.20.x; the Supabase guide still shows 2000) and passes it to
    // libcurl's CURLOPT_TIMEOUT_MS with no upper bound in released versions (src/core.c, v0.20.4,
    // which Supabase Postgres 17.6.1.167 ships); unreleased master adds pg_net.max_timeout_ms,
    // default 600000. So the job can wait 60 s: call it with timeout_milliseconds => 60000.
    // Requests run concurrently in pg_net's curl multi handle, so a 60 s wait blocks no other
    // request. If pg_net stops waiting first, curl drops the connection and records
    // timed_out = true in net._http_response; the function is NOT stopped, because Vercel
    // cancels a Node.js function on client disconnect only when "supportsCancellation" is set
    // (vercel.json does not set it). The run still returns within its 55 s budget, under the 60 s
    // maxDuration: modules stop by 50 s and every database call is cut at the time left, so a
    // record either completes by 55 s or its module's lease runs out and the next claim counts it
    // as failed. Only the summary is lost.
    // Sources: https://github.com/supabase/pg_net (README, src/core.c at v0.20.4),
    // https://supabase.com/docs/guides/database/extensions/pg_net,
    // https://vercel.com/docs/functions/functions-api-reference#cancel-requests
    if (path === '/api/feeds/refresh') {
      await handleFeedRefresh(req, res);
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

    // F142: the marketing site's live counts. Public; sets its own Cache-Control over the no-store above.
    if (path === '/api/site-figures') {
      req.url = path;
      await handleSiteFiguresApi(req, res, () => {
        res.status(404).json({ ok: false, error: `No route for ${path}` });
      });
      return;
    }

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

    if (path === '/api/site-icon') {
      const qStr = q(req).toString();
      req.url = qStr ? `${path}?${qStr}` : path;
      await handleSiteIconRequest(req, res, () => {
        res.status(404).json({ ok: false, error: `No site-icon route for ${path}` });
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
