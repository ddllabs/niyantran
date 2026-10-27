export interface PilotSources {
  pilot(): Promise<boolean>;
  active(): Promise<{ text: string; id: string } | null>;
  bundled(): Promise<string>;
}
export interface ResolvedPersona {
  text: string;
  source: string;
  version: string | null;
  hash: string;
  reason?: string;
}
export function validatePersonaText(text: unknown): asserts text is string {
  if (typeof text !== 'string' || !text.trim() || new TextEncoder().encode(text).length > 100_000 || text.includes('\0')) {
    throw new HttpError(400, 'Prompt must be nonblank, contain no NUL, and be at most 100,000 UTF-8 bytes');
  }
}
export async function promptHash(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function resolvePilotPersona(_file: string, s: PilotSources, override?: string): Promise<ResolvedPersona> {
  let pilot = false;
  let unavailable = false;
  try { pilot = await s.pilot(); } catch { unavailable = true; }
  if (override !== undefined) {
    if (!pilot) throw new HttpError(403, 'Persona editing is restricted to the pilot account');
    validatePersonaText(override);
    return { text: override, source: 'editor_test', version: null, hash: await promptHash(override) };
  }
  if (pilot) {
    try {
      const active = await s.active();
      if (active) {
        validatePersonaText(active.text);
        return { text: active.text, source: 'published', version: active.id, hash: await promptHash(active.text) };
      }
    } catch { unavailable = true; }
  }
  const text = await s.bundled();
  return { text, source: unavailable ? 'bundled_fallback' : 'bundled', version: null,
    hash: await promptHash(text), ...(unavailable ? { reason: 'storage_unavailable' } : {}) };
}
import { HttpError } from './http.ts';

