// CORS: the browser origin must be on the allowlist, read from ALLOWED_ORIGINS
// (comma-separated). Without the variable only the Vite dev origin is allowed.

const DEFAULT_ORIGINS = ['http://localhost:5173'];

export function allowedOrigins(raw: string | undefined = Deno.env.get('ALLOWED_ORIGINS')): string[] {
  const list = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : DEFAULT_ORIGINS;
}

export function corsHeaders(req: Request, origins: string[] = allowedOrigins()): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey, x-refresh-secret',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && origins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

/** Answer an OPTIONS preflight, or return null so the caller continues. */
export function preflight(req: Request, origins?: string[]): Response | null {
  if (req.method !== 'OPTIONS') return null;
  return new Response(null, { status: 204, headers: corsHeaders(req, origins) });
}
