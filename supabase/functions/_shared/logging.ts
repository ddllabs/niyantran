// One JSON line per event. Credentials are redacted before they reach the log, whatever the
// caller passed: by exact field name, and by the shape of the value.
//
// F36 (F171 B12): this used to hide any field whose name contained "token" or "key", which hid
// counts and record keys (embed_tokens, document_key) and still logged a secret kept under a
// harmless name or inside an array.

const SECRET_NAMES = new Set([
  'token', 'access_token', 'refresh_token', 'id_token', 'claim_token', 'bearer',
  'api_key', 'apikey', 'service_role_key', 'anon_key', 'secret', 'client_secret', 'password',
  'authorization', 'cookie', 'set-cookie', 'x-api-key',
]);
// Bearer credentials, JSON web tokens, and provider keys (OpenRouter, OpenAI, Stripe-like).
const SECRET_VALUE = /^(?:Bearer\s+\S|eyJ[\w-]+\.[\w-]+\.|sk-[\w-]{6,}|rk_live_|pk_live_)/i;

function redactValue(v: unknown): unknown {
  if (typeof v === 'string') return SECRET_VALUE.test(v.trim()) ? '[redacted]' : v;
  if (Array.isArray(v)) return v.map(redactValue);
  if (v && typeof v === 'object') return redact(v as Record<string, unknown>);
  return v;
}

export function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = SECRET_NAMES.has(k.toLowerCase()) ? '[redacted]' : redactValue(v);
  }
  return out;
}

export function log(event: string, fields: Record<string, unknown> = {}, sink: (line: string) => void = console.log): void {
  sink(JSON.stringify({ t: new Date().toISOString(), event, ...redact(fields) }));
}
