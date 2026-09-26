/**
 * Homepage intro video for the marketing site.
 *
 *   GET    /api/marketing/intro-video
 *   POST   /api/marketing/intro-video   raw body + Content-Type / X-Filename
 *   PUT    /api/marketing/intro-video   { enabled, title, externalUrl, posterUrl }
 *   DELETE /api/marketing/intro-video
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { writablePath } from './writableRoot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(APP_ROOT, 'public', 'marketing');
const META_FILE = writablePath('marketing-intro-video.json');
const MAX_BYTES = 120 * 1024 * 1024; // 120 MB

const ALLOWED_EXT = new Set(['.mp4', '.webm', '.ogg', '.mov']);

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function ensureDirs() {
  try {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  } catch {
    /* public/ is read-only on serverless — meta still writes under /tmp */
  }
  fs.mkdirSync(path.dirname(META_FILE), { recursive: true });
}

function defaultMeta() {
  return {
    enabled: true,
    title: 'What nter.pro is',
    subtitle: 'A two-minute look at the terminal before you sign in.',
    videoUrl: '',
    externalUrl: '',
    posterUrl: '',
    fileName: '',
    updatedAt: '',
    bytes: 0,
  };
}

function readMeta() {
  ensureDirs();
  try {
    if (fs.existsSync(META_FILE)) {
      const raw = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
      return { ...defaultMeta(), ...raw };
    }
  } catch {
    /* defaults */
  }
  return defaultMeta();
}

function writeMeta(next) {
  ensureDirs();
  const value = { ...defaultMeta(), ...next };
  fs.writeFileSync(META_FILE, JSON.stringify(value, null, 2));
  return value;
}

function extFrom(name, mime) {
  const fromName = path.extname(String(name || '')).toLowerCase();
  if (ALLOWED_EXT.has(fromName)) return fromName;
  const m = String(mime || '').toLowerCase();
  if (m.includes('webm')) return '.webm';
  if (m.includes('ogg')) return '.ogg';
  if (m.includes('quicktime') || m.includes('mov')) return '.mov';
  return '.mp4';
}

function clearUploadedFiles(meta) {
  if (!meta?.fileName) return;
  const file = path.join(PUBLIC_DIR, meta.fileName);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* ignore */
  }
}

async function readRawBody(req, limit) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) {
      const err = new Error(`File too large (max ${Math.round(limit / (1024 * 1024))} MB)`);
      err.code = 'LIMIT';
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function publicMeta(meta) {
  const m = { ...defaultMeta(), ...meta };
  const hasFile = Boolean(m.videoUrl);
  const hasExternal = Boolean(String(m.externalUrl || '').trim());
  return {
    ok: true,
    enabled: m.enabled !== false,
    title: m.title,
    subtitle: m.subtitle,
    videoUrl: hasFile ? m.videoUrl : '',
    externalUrl: hasExternal ? String(m.externalUrl).trim() : '',
    posterUrl: m.posterUrl || '',
    fileName: m.fileName || '',
    updatedAt: m.updatedAt || '',
    bytes: m.bytes || 0,
    hasVideo: (hasFile || hasExternal) && m.enabled !== false,
  };
}

export async function handleMarketingMediaApi(req, res, next) {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url, `http://${host}`);
  if (!url.pathname.startsWith('/api/marketing/intro-video')) {
    next();
    return;
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (url.pathname === '/api/marketing/intro-video' && req.method === 'GET') {
    return json(res, publicMeta(readMeta()));
  }

  if (url.pathname === '/api/marketing/intro-video' && req.method === 'PUT') {
    try {
      const raw = await readRawBody(req, 256 * 1024);
      const payload = JSON.parse(raw.toString('utf8') || '{}');
      const prev = readMeta();
      const next = writeMeta({
        ...prev,
        enabled: payload.enabled !== false,
        title: String(payload.title ?? prev.title).slice(0, 120),
        subtitle: String(payload.subtitle ?? prev.subtitle).slice(0, 240),
        externalUrl: String(payload.externalUrl ?? prev.externalUrl ?? '').trim().slice(0, 500),
        posterUrl: String(payload.posterUrl ?? prev.posterUrl ?? '').trim().slice(0, 500),
        updatedAt: new Date().toISOString(),
      });
      return json(res, publicMeta(next));
    } catch (err) {
      return json(res, { ok: false, error: err.message || String(err) }, 400);
    }
  }

  if (url.pathname === '/api/marketing/intro-video' && req.method === 'DELETE') {
    const prev = readMeta();
    clearUploadedFiles(prev);
    const next = writeMeta({
      ...defaultMeta(),
      title: prev.title,
      subtitle: prev.subtitle,
      externalUrl: '',
      updatedAt: new Date().toISOString(),
    });
    return json(res, publicMeta(next));
  }

  if (url.pathname === '/api/marketing/intro-video' && req.method === 'POST') {
    try {
      const mime = String(req.headers['content-type'] || 'video/mp4').split(';')[0].trim();
      if (!/^video\//i.test(mime) && mime !== 'application/octet-stream') {
        return json(res, { ok: false, error: 'Upload a video file (mp4, webm, ogg, mov).' }, 400);
      }
      const nameHint = String(req.headers['x-filename'] || 'intro-video.mp4');
      const ext = extFrom(nameHint, mime);
      if (!ALLOWED_EXT.has(ext)) {
        return json(res, { ok: false, error: 'Supported formats: mp4, webm, ogg, mov.' }, 400);
      }
      const buf = await readRawBody(req, MAX_BYTES);
      if (!buf.length) return json(res, { ok: false, error: 'Empty upload.' }, 400);

      ensureDirs();
      const prev = readMeta();
      clearUploadedFiles(prev);

      const fileName = `intro-video${ext}`;
      const dest = path.join(PUBLIC_DIR, fileName);
      fs.writeFileSync(dest, buf);
      const stamp = Date.now();
      const next = writeMeta({
        ...prev,
        enabled: true,
        videoUrl: `/marketing/${fileName}?v=${stamp}`,
        fileName,
        bytes: buf.length,
        updatedAt: new Date().toISOString(),
        // Prefer uploaded file over external URL when both set
        externalUrl: prev.externalUrl || '',
      });
      return json(res, publicMeta(next));
    } catch (err) {
      const status = err.code === 'LIMIT' ? 413 : 400;
      return json(res, { ok: false, error: err.message || String(err) }, status);
    }
  }

  return json(res, { ok: false, error: 'Method not allowed' }, 405);
}

export function marketingMediaApiPlugin() {
  return {
    name: 'niyantran-marketing-media-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleMarketingMediaApi(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleMarketingMediaApi(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
  };
}
