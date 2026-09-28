/**
 * Same-origin AI helpers for the Vite dev server (the production router
 * mounts the same handlers).
 *   POST /api/ai/desk-brief  { feature, tier, row, hash, force }  — organise one selected entry
 *   GET  /api/ai/desk-brief?feature=&tier=&hash=  cached entry brief only
 *   GET  /api/ai/source-extract?url=  fetch + extract readable text (PDF/HTML/CSV/XLSX);
 *        signed-in active accounts only, public addresses only
 * Research chat goes from the browser straight to the research-chat Edge
 * Function, which holds the only provider key (ADR 0008); the /api/ai/chat
 * proxy of the legacy AI path was retired on 2026-09-28 (plan task D4).
 * Nothing here calls a model provider directly.
 */
import { loadEnv } from './loadEnv.mjs';
import { entryFingerprint, getCachedDeskBrief, runDeskBrief } from './deskBrief.mjs';
import { briefFromExtract, extractSource } from './sourceExtract.mjs';
import { authorizeLocalUser } from './usersApi.mjs';
import { isExtractableSourceUrl, isHubListingUrl } from '../src/lib/sourceUrls.js';

loadEnv();

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export async function handleAiApi(req, res, next) {
  loadEnv();
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url, `http://${host}`);
  if (!url.pathname.startsWith('/api/ai')) {
    next();
    return;
  }

  if (url.pathname === '/api/ai/source-extract') {
    if (req.method !== 'GET') return json(res, { ok: false, error: 'GET only' }, 405);
    if (!(await authorizeLocalUser(req, res))) return;
    try {
      const target = url.searchParams.get('url') || '';
      if (isHubListingUrl(target) || !isExtractableSourceUrl(target)) {
        return json(
          res,
          {
            ok: false,
            error: 'URL is a registry hub or non-document link — not extractable as source body',
            url: target,
          },
          400,
        );
      }
      const got = await extractSource(target);
      const title = url.searchParams.get('title') || '';
      const brief = briefFromExtract(got.text || '', { title, max: 1100 });
      return json(res, {
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
    } catch (err) {
      const msg = err.message || String(err);
      return json(res, { ok: false, error: msg }, /required/i.test(msg) ? 400 : 502);
    }
  }

  if (url.pathname === '/api/ai/desk-brief') {
    if (req.method === 'GET') {
      const feature = url.searchParams.get('feature') || '';
      const tier = url.searchParams.get('tier') || '';
      const hash = url.searchParams.get('hash') || '';
      const scope = url.searchParams.get('scope') || 'entry';
      const hit = await getCachedDeskBrief(feature, tier, hash, scope);
      if (!hit) return json(res, { ok: false, cached: false, error: 'No cached brief for this fingerprint.' }, 404);
      return json(res, { ok: true, ...hit });
    }
    if (req.method !== 'POST') return json(res, { ok: false, error: 'POST or GET only' }, 405);

    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 6 * 1024 * 1024) req.destroy();
    });
    await new Promise((resolve, reject) => {
      req.on('end', resolve);
      req.on('error', reject);
    });
    let payload = {};
    try {
      payload = JSON.parse(body || '{}');
    } catch {
      return json(res, { ok: false, error: 'Invalid JSON' }, 400);
    }
    try {
      const row =
        payload.row && typeof payload.row === 'object'
          ? payload.row
          : Array.isArray(payload.rows)
            ? payload.rows[0]
            : null;
      const feature = String(payload.feature || '').trim();
      const tier = String(payload.tier || '').trim();
      if (!row) return json(res, { ok: false, error: 'Select a row to organise' }, 400);
      const hash = String(payload.hash || entryFingerprint(row, feature, tier));
      const out = await runDeskBrief({
        feature,
        tier,
        row,
        hash,
        force: Boolean(payload.force),
        sourceNote: payload.sourceNote || '',
        sourceExtract: payload.sourceExtract || '',
        scope: payload.scope === 'substance' ? 'substance' : 'entry',
        authorization: req.headers?.authorization,
      });
      return json(res, { ok: true, ...out });
    } catch (err) {
      const msg = err.message || String(err);
      const status = Number.isInteger(err.status) ? err.status : /missing|required|Select a row|No rows/i.test(msg) ? 400 : 502;
      return json(res, { ok: false, error: msg }, status);
    }
  }

  next();
}

export function aiApiPlugin() {
  return {
    name: 'niyantran-ai-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleAiApi(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleAiApi(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
  };
}
