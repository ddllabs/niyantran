// CORS: the browser origin must be on the allowlist, read from ALLOWED_ORIGINS
// (comma-separated). Without the variable only the Vite dev origin is allowed.
//
// An entry may hold one `*` inside the host of an https origin, for Vercel's
// per-deployment preview hostnames: `https://niyantran-*-ddl-labs.vercel.app`.
// The `*` stands for one or more letters, digits or hyphens within a single DNS
// label (never a dot, a port or a path), and the whole origin must match. Any
// other use of `*` (a bare `*`, more than one, outside the host, or plain http)
// matches nothing.

const DEFAULT_ORIGINS = ['http://localhost:5173'];

export function allowedOrigins(raw: string | undefined = Deno.env.get('ALLOWED_ORIGINS')): string[] {
  const list = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : DEFAULT_ORIGINS;
}

const LABEL_PART = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';

function patternOf(entry: string): RegExp | null {
  const m = /^https:\/\/([a-z0-9.-]*)\*([a-z0-9.-]*)$/i.exec(entry);
  if (!m) return null;
  const [, before, after] = m;
  // The wildcard must sit inside the host with a fixed domain after it.
  if (!after.includes('.') || before.includes('.')) return null;
  const quote = (s: string) => s.replace(/[.]/g, '\\.');
  return new RegExp(`^https://${quote(before)}${LABEL_PART}${quote(after)}$`, 'i');
}

export function originAllowed(origin: string, origins: string[]): boolean {
  if (!origin) return false;
  return origins.some((entry) => (entry.includes('*') ? Boolean(patternOf(entry)?.test(origin)) : entry === origin));
}

export function corsHeaders(req: Request, origins: string[] = allowedOrigins()): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey, x-refresh-secret',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (originAllowed(origin, origins)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

/** Answer an OPTIONS preflight, or return null so the caller continues. */
export function preflight(req: Request, origins?: string[]): Response | null {
  if (req.method !== 'OPTIONS') return null;
  return new Response(null, { status: 204, headers: corsHeaders(req, origins) });
}
