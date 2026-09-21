/**
 * Global app flags (testing phase, etc.).
 *
 *   GET  /api/app-flags
 *   PUT  /api/app-flags   { testingPhase: boolean }
 *
 * Persisted in tmp/app-flags.json (same host model as users SQLite / intro video).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const FLAGS_FILE = path.join(APP_ROOT, 'tmp', 'app-flags.json');

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function ensureDir() {
  fs.mkdirSync(path.dirname(FLAGS_FILE), { recursive: true });
}

export function defaultAppFlags() {
  return {
    testingPhase: false,
    updatedAt: '',
  };
}

export function readAppFlags() {
  ensureDir();
  try {
    if (fs.existsSync(FLAGS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(FLAGS_FILE, 'utf8'));
      return {
        ...defaultAppFlags(),
        testingPhase: Boolean(raw.testingPhase),
        updatedAt: String(raw.updatedAt || ''),
      };
    }
  } catch {
    /* defaults */
  }
  return defaultAppFlags();
}

export function writeAppFlags(patch = {}) {
  ensureDir();
  const prev = readAppFlags();
  const next = {
    testingPhase: patch.testingPhase != null ? Boolean(patch.testingPhase) : prev.testingPhase,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(FLAGS_FILE, JSON.stringify(next, null, 2));
  return next;
}

/** Free AI during testing: Gemini provider only. */
export function isFreeAiProvider(provider, model = '') {
  const p = String(provider || '').toLowerCase();
  const m = String(model || '').toLowerCase();
  if (p === 'gemini') return true;
  if (!p && m.includes('gemini')) return true;
  return false;
}

export function assertAiAllowedInTesting({ provider, model } = {}) {
  const flags = readAppFlags();
  if (!flags.testingPhase) return;
  if (isFreeAiProvider(provider, model)) return;
  throw new Error('Paid AI models are disabled during the testing phase. Use a free Gemini model.');
}

export async function handleAppFlagsApi(req, res, next) {
  const url = new URL(req.url || '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/app-flags')) {
    next();
    return;
  }

  if (url.pathname === '/api/app-flags' && req.method === 'GET') {
    return json(res, { ok: true, flags: readAppFlags() });
  }

  if (url.pathname === '/api/app-flags' && req.method === 'PUT') {
    let body = '';
    for await (const chunk of req) body += chunk;
    let parsed = {};
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch {
      return json(res, { ok: false, error: 'Invalid JSON' }, 400);
    }
    const flags = writeAppFlags({ testingPhase: Boolean(parsed.testingPhase) });
    return json(res, { ok: true, flags });
  }

  return json(res, { ok: false, error: 'Method not allowed' }, 405);
}

export function appFlagsApiPlugin() {
  return {
    name: 'niyantran-app-flags-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleAppFlagsApi(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleAppFlagsApi(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
  };
}
