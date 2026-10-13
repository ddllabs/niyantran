/**
 * Site icons for web sources (web-search streaming spec F131 §4).
 * GET /api/site-icon?domain=<host> — the icon DuckDuckGo holds for <host>, cached at the CDN.
 *
 * The reader's browser asks only this server. The upstream host is fixed and the domain is
 * validated, never used as a URL, so the route cannot be pointed at another host. A missing,
 * oversized, slow or non-raster icon is a bare 404 and the client draws the domain's letter.
 */
const UPSTREAM = (host) => `https://icons.duckduckgo.com/ip3/${host}.ico`;
const FETCH_MS = 4_000;
const MAX_BYTES = 100 * 1024;
// Raster only: an SVG opened directly can carry script.
const TYPES = new Set([
  'image/x-icon', 'image/vnd.microsoft.icon', 'image/png', 'image/jpeg', 'image/gif', 'image/webp',
]);
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const RESERVED = /(^|\.)(localhost|local|internal|test|invalid|example)$/;

/** The host to look up, or null: lowercase DNS labels, two or more, no IP literal or reserved name. */
export function siteIconHost(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > 253) return null;
  const labels = raw.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return null;
  if (labels.every((l) => /^\d+$/.test(l)) || /^\d+$/.test(labels.at(-1))) return null;
  if (RESERVED.test(raw)) return null;
  return raw;
}

function send(res, status, headers = {}, body) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body);
}

const SAFE = { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" };
const NONE = { ...SAFE, 'Cache-Control': 'public, max-age=86400, s-maxage=86400' };

async function readCapped(response) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const buf = Buffer.from(await response.arrayBuffer());
    return buf.length > MAX_BYTES ? null : buf;
  }
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** Node-style handler; `fetchImpl` is injectable for tests. */
export async function handleSiteIconRequest(req, res, next, { fetchImpl = fetch } = {}) {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers?.host || 'localhost'}`);
  } catch {
    next();
    return;
  }
  if (url.pathname.replace(/\/$/, '') !== '/api/site-icon') {
    next();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, { ...SAFE, Allow: 'GET, HEAD' });
    return;
  }
  const host = siteIconHost(url.searchParams.get('domain'));
  if (!host) {
    send(res, 400, SAFE);
    return;
  }
  let body = null;
  let type = '';
  try {
    const response = await fetchImpl(UPSTREAM(host), {
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_MS),
      headers: { Accept: 'image/*' },
    });
    type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (response.status === 200 && TYPES.has(type)) body = await readCapped(response);
    else await response.body?.cancel?.().catch(() => {});
  } catch {
    body = null;
  }
  if (!body || !body.length) {
    send(res, 404, NONE);
    return;
  }
  send(res, 200, {
    ...SAFE,
    'Content-Type': type,
    'Content-Length': String(body.length),
    'Cache-Control': 'public, max-age=86400, s-maxage=604800',
  }, req.method === 'HEAD' ? undefined : body);
}

export function siteIconApiPlugin() {
  // Returns nothing: Vite would call a returned function as a post-middleware hook.
  const use = (server) => {
    server.middlewares.use((req, res, next) => {
      handleSiteIconRequest(req, res, next).catch(next);
    });
  };
  return { name: 'niyantran-site-icon-api', configureServer: use, configurePreviewServer: use };
}
