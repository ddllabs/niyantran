/**
 * nter.news → Terminal article ingest + home "Latest" store.
 *
 *   POST /api/news/ingest   Bearer NTER_TERMINAL_API_KEY
 *   (read path) serveNterLatest() for /api/home/latest
 *
 * Articles live in Supabase public.nter_news_articles (T6, ADR 0005). Ingest
 * upserts through upsert_nter_article(), which dedupes by article_id then
 * link and skips older revisions; the table keeps the newest 200. The home
 * read falls back to the committed public/data/nter-news.json seed only when
 * the table is empty or unreachable. Nothing is written to disk.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './loadEnv.mjs';
import { getSupabaseAdminClient } from './authEmailProvider.mjs';

loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const MAX_READ = 40;
const KEY_RE = /^nter_news_live_[A-Za-z0-9_-]{16,}$/;
const SEED_PATH = path.join(APP_ROOT, 'public', 'data', 'nter-news.json');

function emptyStore(note) {
  return {
    updated: null,
    source: 'nter.news',
    note: note || 'nter.news feed waiting for the first article.published ingest.',
    rows: [],
  };
}

function readJson(file) {
  try {
    if (!file || !fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function ts(iso) {
  const t = new Date(iso || '').getTime();
  return Number.isFinite(t) ? t : 0;
}


export function expectedApiKey() {
  return String(process.env.NTER_TERMINAL_API_KEY || '').trim();
}

export function isConfiguredKey(key = expectedApiKey()) {
  return KEY_RE.test(String(key || '').trim());
}

function timingSafeEqualStr(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (!aa.length || aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

export function authorizeNterRequest(req) {
  const expected = expectedApiKey();
  if (!isConfiguredKey(expected)) {
    return { ok: false, status: 503, error: 'Ingest not configured on this host.' };
  }
  const auth = String(req.headers?.authorization || req.headers?.Authorization || '');
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  const token = (m?.[1] || '').trim();
  if (!token || !timingSafeEqualStr(token, expected)) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  return {
    ok: true,
    sourceHeader: String(req.headers?.['x-nter-source'] || req.headers?.['X-NTER-Source'] || '').trim(),
  };
}

function ago(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 5400) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 172800) return `${Math.round(s / 3600)} hr`;
  return `${Math.round(s / 86400)} d`;
}

/** Normalise flat or nested article.published payloads. */
function unwrapPayload(payload) {
  if (!payload || typeof payload !== 'object') return {};
  if (payload.article && typeof payload.article === 'object') {
    return {
      event: payload.event,
      source: payload.source,
      ...payload.article,
    };
  }
  if (payload.data && typeof payload.data === 'object') {
    return {
      event: payload.event,
      source: payload.source,
      ...payload.data,
    };
  }
  return payload;
}

function absolutizeNterImg(raw) {
  const img = String(raw || '').trim();
  if (!img) return '';
  if (/^https?:\/\//i.test(img)) return img;
  if (img.startsWith('//')) return `https:${img}`;
  if (img.startsWith('/')) return `https://nter.news${img}`;
  return img;
}

function articleToRow(article) {
  const title = String(article.title || '').trim();
  const link = String(article.url || article.link || '').trim();
  const publishedAt = String(article.published_at || '').trim();
  const updatedAt = String(article.updated_at || publishedAt || new Date().toISOString()).trim();
  const pub = publishedAt || updatedAt;
  const rawId = String(article.article_id || article.id || '').trim();
  const id = rawId || link || title;
  const summary = String(article.summary || article.dek || '').trim();
  const author = String(article.author || '').trim();
  const category = String(article.category || '').trim();
  const src = author || category || 'nter.news';
  return {
    id,
    article_id: id,
    title,
    link,
    pub,
    published_at: publishedAt || pub,
    updated_at: updatedAt,
    img: absolutizeNterImg(article.image_url || article.img || ''),
    src,
    site: 'https://nter.news',
    dek: summary.slice(0, 280),
    category,
    tags: Array.isArray(article.tags) ? article.tags.map(String).slice(0, 24) : [],
    author,
    content: String(article.content || '').slice(0, 50_000),
    t: ts(updatedAt) || ts(pub) || Date.now(),
    ago: ago(pub),
    source: 'nter.news',
  };
}

/** The committed seed, read-only. Every row is marked as a fallback. */
function seedStore() {
  const seed = readJson(SEED_PATH);
  if (!seed || !Array.isArray(seed.rows) || !seed.rows.length) return emptyStore();
  return { ...seed, rows: seed.rows.map((r) => ({ ...r, fallback: true })) };
}

async function storedStore(limit, deps) {
  const { data, error } = await deps
    .adminClient()
    .from('nter_news_articles')
    .select('row, updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error('nter.news store unavailable');
  const rows = (data || []).map((r) => ({ ...r.row, fallback: false }));
  return {
    updated: data?.[0]?.updated_at || null,
    source: 'nter.news',
    note: 'Latest from nter.news.',
    rows,
  };
}

function resolveDeps(deps = {}) {
  return { adminClient: deps.adminClient || getSupabaseAdminClient };
}

/**
 * Upsert one article.published / article.updated payload into Supabase.
 * Dedupes by article_id (then url); skips older updated_at revisions.
 */
export async function ingestNterArticle(payload, { sourceHeader = '' } = {}, deps = {}) {
  const raw = unwrapPayload(payload);
  const event = String(raw?.event || payload?.event || 'article.published').trim();
  if (event && event !== 'article.published' && event !== 'article.updated') {
    return { ok: false, status: 400, error: `Unsupported event: ${event}` };
  }
  const title = String(raw?.title || '').trim();
  if (!title) return { ok: false, status: 400, error: 'title required' };

  const { ago: _ago, ...row } = articleToRow(raw);
  if (!row.link && !row.article_id) {
    return { ok: false, status: 400, error: 'article_id or url required' };
  }
  row.x_nter_source = sourceHeader || String(raw?.source || payload?.source || 'nter.news');

  try {
    const { data, error } = await resolveDeps(deps).adminClient().rpc('upsert_nter_article', { p: row });
    if (error) return { ok: false, status: 503, error: 'nter.news store unavailable' };
    return { ok: true, status: 200, article_id: row.article_id, upserted: data, updated: new Date().toISOString() };
  } catch {
    return { ok: false, status: 503, error: 'nter.news store unavailable' };
  }
}

export async function serveNterLatest(opts = {}, deps = {}) {
  const limit = Math.min(MAX_READ, Math.max(1, Number(opts.limit) || 12));
  let store;
  try {
    store = await storedStore(limit, resolveDeps(deps));
  } catch {
    store = null;
  }
  if (!store?.rows?.length) store = seedStore();
  const rows = (store.rows || []).slice(0, limit).map((r) => ({
    ...r,
    ago: r.ago || ago(r.pub || r.updated_at),
  }));
  const updated = store.updated || null;
  let ageH = null;
  if (updated) {
    const t = new Date(updated).getTime();
    if (Number.isFinite(t)) ageH = (Date.now() - t) / 3600000;
  }
  const liveCount = rows.filter((r) => !r.fallback).length;
  return {
    ok: true,
    rows,
    note: rows.length
      ? liveCount
        ? store.note || 'Latest from nter.news.'
        : store.note || 'nter.news fallback seed — waiting for the next live ingest.'
      : store.note ||
        'Waiting for nter.news article.published pushes to POST /api/news/ingest. No headlines were invented.',
    source: 'nter.news',
    archive: false,
    waiting: !rows.length,
    updated,
    as_of: updated || '',
    ageH,
    cached: false,
  };
}

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

export async function handleNterNewsApi(req, res, next) {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url || '/', `http://${host}`);
  if (url.pathname !== '/api/news/ingest') {
    next();
    return;
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-NTER-Source');
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    json(res, { ok: false, error: 'POST /api/news/ingest only' }, 405);
    return;
  }

  const auth = authorizeNterRequest(req);
  if (!auth.ok) {
    json(res, { ok: false, error: auth.error }, auth.status);
    return;
  }

  let payload = {};
  try {
    const raw = await readBody(req);
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    json(res, { ok: false, error: 'Invalid JSON' }, 400);
    return;
  }

  const out = await ingestNterArticle(payload, { sourceHeader: auth.sourceHeader });
  json(res, out, out.status || (out.ok ? 200 : 400));
}

export function nterNewsApiPlugin() {
  return {
    name: 'niyantran-nter-news-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleNterNewsApi(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleNterNewsApi(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
  };
}
