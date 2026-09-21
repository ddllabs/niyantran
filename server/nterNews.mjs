/**
 * nter.news → Terminal article ingest + home "Latest" store.
 *
 *   POST /api/news/ingest   Bearer NTER_TERMINAL_API_KEY
 *   (read path) serveNterLatest() for /api/home/latest
 *
 * Credentials stay server-side. X-NTER-Source is metadata only.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './loadEnv.mjs';

loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const MAX_ROWS = 120;
const KEY_RE = /^nter_news_live_[A-Za-z0-9_-]{16,}$/;

function storePaths() {
  const primary = process.env.VERCEL
    ? path.join('/tmp', 'nter-news.json')
    : path.join(APP_ROOT, 'tmp', 'nter-news.json');
  const publicMirror = path.join(APP_ROOT, 'public', 'data', 'nter-news.json');
  return { primary, publicMirror };
}

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
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
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
  return { ok: true, sourceHeader: String(req.headers?.['x-nter-source'] || req.headers?.['X-NTER-Source'] || '').trim() };
}

function ago(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 5400) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 172800) return `${Math.round(s / 3600)} hr`;
  return `${Math.round(s / 86400)} d`;
}

function articleToRow(article) {
  const title = String(article.title || '').trim();
  const link = String(article.url || '').trim();
  const pub = String(article.published_at || article.updated_at || new Date().toISOString()).trim();
  const id = String(article.article_id || link || title).trim();
  const summary = String(article.summary || '').trim();
  const author = String(article.author || '').trim();
  const category = String(article.category || '').trim();
  const src = author || category || 'nter.news';
  return {
    id,
    article_id: id,
    title,
    link,
    pub,
    img: String(article.image_url || '').trim(),
    src,
    site: 'https://nter.news',
    dek: summary.slice(0, 280),
    category,
    tags: Array.isArray(article.tags) ? article.tags.map(String).slice(0, 24) : [],
    author,
    content: String(article.content || '').slice(0, 50_000),
    t: new Date(pub).getTime() || Date.now(),
    ago: ago(pub),
    source: 'nter.news',
  };
}

export function readNterNewsStore() {
  const { primary, publicMirror } = storePaths();
  const fromPrimary = readJson(primary);
  if (fromPrimary && Array.isArray(fromPrimary.rows)) return fromPrimary;
  const fromPublic = readJson(publicMirror);
  if (fromPublic && Array.isArray(fromPublic.rows)) return fromPublic;
  return emptyStore();
}

function writeNterNewsStore(store) {
  const { primary, publicMirror } = storePaths();
  const body = `${JSON.stringify(store, null, 2)}\n`;
  try {
    fs.mkdirSync(path.dirname(primary), { recursive: true });
    fs.writeFileSync(primary, body);
  } catch (err) {
    console.warn('[nter-news] primary write failed', err.message);
  }
  if (!process.env.VERCEL) {
    try {
      fs.mkdirSync(path.dirname(publicMirror), { recursive: true });
      fs.writeFileSync(publicMirror, body);
    } catch (err) {
      console.warn('[nter-news] public mirror write failed', err.message);
    }
  }
}

/**
 * Upsert one article.published payload into the home Latest store.
 */
export function ingestNterArticle(payload, { sourceHeader = '' } = {}) {
  const event = String(payload?.event || 'article.published').trim();
  if (event && event !== 'article.published' && event !== 'article.updated') {
    return { ok: false, status: 400, error: `Unsupported event: ${event}` };
  }
  const title = String(payload?.title || '').trim();
  if (!title) return { ok: false, status: 400, error: 'title required' };

  const row = articleToRow(payload);
  if (!row.link && !row.article_id) {
    return { ok: false, status: 400, error: 'article_id or url required' };
  }

  const store = readNterNewsStore();
  const rows = Array.isArray(store.rows) ? [...store.rows] : [];
  const key = row.article_id || row.link;
  const idx = rows.findIndex((r) => r.article_id === key || r.id === key || (row.link && r.link === row.link));
  if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
  else rows.unshift(row);

  rows.sort((a, b) => (b.t || 0) - (a.t || 0));
  const next = {
    updated: new Date().toISOString(),
    source: 'nter.news',
    note: 'Latest from nter.news.',
    x_nter_source: sourceHeader || String(payload?.source || 'nter.news'),
    rows: rows.slice(0, MAX_ROWS),
  };
  writeNterNewsStore(next);
  return {
    ok: true,
    status: 200,
    article_id: row.article_id,
    upserted: idx >= 0 ? 'updated' : 'created',
    count: next.rows.length,
    updated: next.updated,
  };
}

export function serveNterLatest(opts = {}) {
  const limit = Math.min(40, Math.max(1, Number(opts.limit) || 12));
  const store = readNterNewsStore();
  const rows = (store.rows || []).slice(0, limit).map((r) => ({
    ...r,
    ago: r.ago || ago(r.pub),
  }));
  const updated = store.updated || null;
  let ageH = null;
  if (updated) {
    const t = new Date(updated).getTime();
    if (Number.isFinite(t)) ageH = (Date.now() - t) / 3600000;
  }
  return {
    ok: true,
    rows,
    note: rows.length
      ? store.note || 'Latest from nter.news.'
      : store.note || 'nter.news feed not configured on this build. No headlines were invented.',
    source: 'nter.news',
    archive: false,
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

  const out = ingestNterArticle(payload, { sourceHeader: auth.sourceHeader });
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
