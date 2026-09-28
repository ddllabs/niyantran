/**
 * Global app flags (testing phase, etc.), stored in Supabase `public.app_flags`.
 *
 *   GET  /api/app-flags                              public
 *   PUT  /api/app-flags   { testingPhase: boolean }  internal admin (bearer)
 *
 * Reads and writes use the server's secret-key client after the route's own
 * checks; clients have no write access to the table (migration
 * 20260928100200_app_flags_and_marketing_media.sql).
 */
import { getSupabaseAdminClient } from './authEmailProvider.mjs';
import { authorizeLocalUser } from './usersApi.mjs';

const TESTING_PHASE_KEY = 'testing_phase';
const MAX_BODY_BYTES = 16 * 1024;

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function defaultAppFlags() {
  return {
    testingPhase: false,
    updatedAt: '',
  };
}

// Last flags this process read from or wrote to Supabase. It starts at the
// defaults on a cold instance; assertAiAllowedInTesting uses it only when a
// durable read fails.
let snapshot = defaultAppFlags();

/** Synchronous, process-local view of the flags. Not a durable read. */
export function readAppFlags() {
  return { ...snapshot };
}

/**
 * Applies a patch to the process-local view only; it does not persist.
 * Durable writes go through PUT /api/app-flags (storeAppFlags).
 */
export function writeAppFlags(patch = {}) {
  snapshot = {
    testingPhase: patch.testingPhase != null ? Boolean(patch.testingPhase) : snapshot.testingPhase,
    updatedAt: patch.updatedAt != null ? String(patch.updatedAt) : new Date().toISOString(),
  };
  return readAppFlags();
}

function flagsFromRow(row) {
  if (!row) return defaultAppFlags();
  return { testingPhase: row.value === true, updatedAt: String(row.updated_at || '') };
}

function adminClientFrom(deps) {
  return (deps.adminClient || getSupabaseAdminClient)();
}

/** Durable read. Missing row -> defaults. Throws when storage is unavailable. */
export async function fetchAppFlags(deps = {}) {
  const { data, error } = await adminClientFrom(deps)
    .from('app_flags')
    .select('key, value, updated_at')
    .eq('key', TESTING_PHASE_KEY)
    .maybeSingle();
  if (error) throw new Error('App flags read failed');
  snapshot = flagsFromRow(data);
  return readAppFlags();
}

/** Durable write, attributed to a verified admin. */
export async function storeAppFlags({ testingPhase }, { userId }, deps = {}) {
  const { data, error } = await adminClientFrom(deps)
    .from('app_flags')
    .upsert(
      { key: TESTING_PHASE_KEY, value: Boolean(testingPhase), updated_by: userId, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )
    .select('key, value, updated_at')
    .single();
  if (error) throw new Error('App flags write failed');
  snapshot = flagsFromRow(data);
  return readAppFlags();
}

/** Free AI during testing: Gemini provider only. */
export function isFreeAiProvider(provider, model = '') {
  const p = String(provider || '').toLowerCase();
  const m = String(model || '').toLowerCase();
  if (p === 'gemini' || m.includes('gemini')) return true;
  return false;
}


/**
 * Reads the durable flag on every call: the process-local copy starts at the
 * defaults on a cold instance, so it cannot decide alone. If storage is
 * unreachable, the last value this process read is used.
 */
export async function assertAiAllowedInTesting({ provider, model } = {}, deps = {}) {
  let flags;
  try {
    flags = await fetchAppFlags(deps);
  } catch {
    flags = readAppFlags();
  }
  if (!flags.testingPhase) return;
  if (isFreeAiProvider(provider, model)) return;
  throw new Error('Paid AI models are disabled during the testing phase. Use a free Gemini model.');
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = typeof req.body === 'string' ? req.body : '';
  if (typeof req.body !== 'string') {
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) throw new Error('Request too large');
    }
  }
  if (raw.length > MAX_BODY_BYTES) throw new Error('Request too large');
  return raw ? JSON.parse(raw) : {};
}

export async function handleAppFlagsApi(req, res, next, deps = {}) {
  const url = new URL(req.url || '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/app-flags')) {
    next();
    return;
  }
  if (url.pathname !== '/api/app-flags') return json(res, { ok: false, error: 'Not found' }, 404);

  if (req.method === 'GET') {
    try {
      return json(res, { ok: true, flags: await fetchAppFlags(deps) });
    } catch {
      return json(res, { ok: false, error: 'App flags are unavailable' }, 503);
    }
  }

  if (req.method === 'PUT') {
    const caller = await authorizeLocalUser(req, res, { admin: true, clientForToken: deps.clientForToken });
    if (!caller) return;
    let parsed;
    try {
      parsed = await readJsonBody(req);
    } catch {
      return json(res, { ok: false, error: 'Invalid JSON' }, 400);
    }
    if (!parsed || typeof parsed.testingPhase !== 'boolean') {
      return json(res, { ok: false, error: 'testingPhase must be a boolean' }, 400);
    }
    try {
      const flags = await storeAppFlags({ testingPhase: parsed.testingPhase }, { userId: caller.id }, deps);
      return json(res, { ok: true, flags });
    } catch {
      return json(res, { ok: false, error: 'App flags are unavailable' }, 503);
    }
  }

  return json(res, { ok: false, error: 'GET or PUT /api/app-flags only' }, 405);
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
