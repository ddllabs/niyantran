/**
 * Homepage intro video for the marketing site.
 *
 *   GET    /api/marketing/intro-video              public
 *   PUT    /api/marketing/intro-video              { enabled, title, subtitle, externalUrl, posterUrl }
 *   DELETE /api/marketing/intro-video              removes the uploaded file and clears the metadata
 *   POST   /api/marketing/intro-video/upload-url   { contentType, bytes } -> signed upload URL + token
 *   POST   /api/marketing/intro-video/finalize     { path } after the browser uploaded to Storage
 *
 * Everything but GET needs an internal-admin bearer. The file goes straight
 * from the browser to the public Storage bucket `marketing` through a signed
 * upload URL (a serverless request body cannot carry a video); the metadata
 * is the `marketing_intro_video` row of `public.app_flags`.
 */
import { getSupabaseAdminClient } from './authEmailProvider.mjs';
import { authorizeLocalUser } from './usersApi.mjs';

const BASE = '/api/marketing/intro-video';
const META_KEY = 'marketing_intro_video';
const BUCKET = 'marketing';
// Matches the bucket's file_size_limit; Storage enforces it again on upload.
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_BODY_BYTES = 16 * 1024;

// Allowed types and their one fixed object path each.
const OBJECT_PATHS = {
  'video/mp4': 'intro-video/intro-video.mp4',
  'video/webm': 'intro-video/intro-video.webm',
  'video/ogg': 'intro-video/intro-video.ogg',
  'video/quicktime': 'intro-video/intro-video.mov',
};
const ALLOWED_PATHS = new Set(Object.values(OBJECT_PATHS));

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
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
    objectPath: '',
    updatedAt: '',
    bytes: 0,
  };
}

function adminClientFrom(deps) {
  return (deps.adminClient || getSupabaseAdminClient)();
}

async function readMeta(client) {
  const { data, error } = await client
    .from('app_flags')
    .select('key, value, updated_at')
    .eq('key', META_KEY)
    .maybeSingle();
  if (error) throw new Error('Intro video read failed');
  if (!data || !data.value || typeof data.value !== 'object') return defaultMeta();
  return { ...defaultMeta(), ...data.value, updatedAt: String(data.updated_at || '') };
}

async function writeMeta(client, next, userId) {
  const { updatedAt: _updatedAt, ...value } = { ...defaultMeta(), ...next };
  const { data, error } = await client
    .from('app_flags')
    .upsert(
      { key: META_KEY, value, updated_by: userId, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )
    .select('key, value, updated_at')
    .single();
  if (error) throw new Error('Intro video write failed');
  return { ...defaultMeta(), ...data.value, updatedAt: String(data.updated_at || '') };
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

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let raw = typeof req.body === 'string' ? req.body : '';
  if (typeof req.body !== 'string') {
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) throw new Error('Request too large');
    }
  }
  if (raw.length > MAX_BODY_BYTES) throw new Error('Request too large');
  const parsed = raw ? JSON.parse(raw) : {};
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object');
  return parsed;
}

/** Empty, an http(s) URL, or a same-origin path; never javascript: or data:. */
function linkField(value, fallback) {
  const text = String(value ?? fallback ?? '').trim().slice(0, 500);
  if (!text || /^https?:\/\//i.test(text) || /^\/(?!\/)/.test(text)) return text;
  throw new Error('Links must be http(s) URLs or site paths.');
}

async function handleUploadUrl(client, payload) {
  const contentType = String(payload.contentType || '').split(';')[0].trim().toLowerCase();
  const path = OBJECT_PATHS[contentType];
  if (!path) return [400, { ok: false, error: 'Supported formats: mp4, webm, ogg, mov.' }];
  const bytes = Number(payload.bytes);
  if (!Number.isInteger(bytes) || bytes < 1) return [400, { ok: false, error: 'Empty upload.' }];
  if (bytes > MAX_BYTES) return [413, { ok: false, error: `File too large (max ${MAX_BYTES / (1024 * 1024)} MB)` }];
  const { data, error } = await client.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data?.token) throw new Error('Signed upload URL failed');
  return [200, { ok: true, bucket: BUCKET, path: data.path || path, token: data.token, signedUrl: data.signedUrl, maxBytes: MAX_BYTES }];
}

async function handleFinalize(client, payload, userId) {
  const path = String(payload.path || '');
  if (!ALLOWED_PATHS.has(path)) return [400, { ok: false, error: 'Unknown upload path.' }];
  const bucket = client.storage.from(BUCKET);
  const { data: info, error } = await bucket.info(path);
  if (error || !info) return [409, { ok: false, error: 'Upload not found. Upload the file first.' }];
  const bytes = Number(info.size ?? info.metadata?.size ?? 0);
  if (!(bytes > 0) || bytes > MAX_BYTES) return [400, { ok: false, error: 'Uploaded file is empty or too large.' }];
  const prev = await readMeta(client);
  const stamp = Date.now();
  const videoUrl = bucket.getPublicUrl(path, { cacheNonce: String(stamp) }).data.publicUrl;
  const next = await writeMeta(client, {
    ...prev,
    enabled: true,
    videoUrl,
    fileName: path.split('/').pop(),
    objectPath: path,
    bytes,
  }, userId);
  // A different format lived at another fixed path; drop it once replaced.
  if (prev.objectPath && prev.objectPath !== path && ALLOWED_PATHS.has(prev.objectPath)) {
    await bucket.remove([prev.objectPath]).catch(() => {});
  }
  return [200, publicMeta(next)];
}

async function handleDelete(client, userId) {
  const prev = await readMeta(client);
  if (prev.objectPath && ALLOWED_PATHS.has(prev.objectPath)) {
    const { error } = await client.storage.from(BUCKET).remove([prev.objectPath]);
    if (error) throw new Error('Intro video delete failed');
  }
  const next = await writeMeta(client, {
    ...defaultMeta(),
    title: prev.title,
    subtitle: prev.subtitle,
  }, userId);
  return [200, publicMeta(next)];
}

async function handleMetaUpdate(client, payload, userId) {
  const prev = await readMeta(client);
  let externalUrl;
  let posterUrl;
  try {
    externalUrl = linkField(payload.externalUrl, prev.externalUrl);
    posterUrl = linkField(payload.posterUrl, prev.posterUrl);
  } catch (err) {
    return [400, { ok: false, error: err.message }];
  }
  const next = await writeMeta(client, {
    ...prev,
    enabled: payload.enabled !== false,
    title: String(payload.title ?? prev.title).slice(0, 120),
    subtitle: String(payload.subtitle ?? prev.subtitle).slice(0, 240),
    externalUrl,
    posterUrl,
  }, userId);
  return [200, publicMeta(next)];
}

const ADMIN_ROUTES = {
  [`PUT ${BASE}`]: (client, payload, userId) => handleMetaUpdate(client, payload, userId),
  [`DELETE ${BASE}`]: (client, _payload, userId) => handleDelete(client, userId),
  [`POST ${BASE}/upload-url`]: (client, payload) => handleUploadUrl(client, payload),
  [`POST ${BASE}/finalize`]: (client, payload, userId) => handleFinalize(client, payload, userId),
};

export async function handleMarketingMediaApi(req, res, next, deps = {}) {
  const host = req.headers?.host || 'localhost';
  const url = new URL(req.url, `http://${host}`);
  if (!url.pathname.startsWith(BASE)) {
    next();
    return;
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (url.pathname === BASE && req.method === 'GET') {
    try {
      return json(res, publicMeta(await readMeta(adminClientFrom(deps))));
    } catch {
      return json(res, { ok: false, error: 'Intro video is unavailable' }, 503);
    }
  }

  const route = ADMIN_ROUTES[`${req.method} ${url.pathname}`];
  if (!route) return json(res, { ok: false, error: 'Method not allowed' }, 405);

  const caller = await authorizeLocalUser(req, res, { admin: true, clientForToken: deps.clientForToken });
  if (!caller) return;

  let payload = {};
  if (req.method !== 'DELETE') {
    try {
      payload = await readJsonBody(req);
    } catch {
      return json(res, { ok: false, error: 'Invalid JSON' }, 400);
    }
  }

  try {
    const [status, body] = await route(adminClientFrom(deps), payload, caller.id);
    return json(res, body, status);
  } catch {
    return json(res, { ok: false, error: 'Intro video storage is unavailable' }, 503);
  }
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
