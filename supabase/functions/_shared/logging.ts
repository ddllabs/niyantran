// One JSON line per event. Field names that look like credentials are
// redacted before they reach the log, whatever the caller passed.

const SENSITIVE = /token|secret|key|authorization|password|cookie/i;

export function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SENSITIVE.test(k)) out[k] = '[redacted]';
    else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = redact(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}

export function log(event: string, fields: Record<string, unknown> = {}, sink: (line: string) => void = console.log): void {
  sink(JSON.stringify({ t: new Date().toISOString(), event, ...redact(fields) }));
}
