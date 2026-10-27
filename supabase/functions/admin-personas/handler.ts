import { requireUser, type Verify } from '../_shared/auth.ts';
import { preflight, corsHeaders } from '../_shared/cors.ts';
import { HttpError, json, errorResponse } from '../_shared/http.ts';
import { validatePersonaText } from '../_shared/personaPilot.ts';
import { PERSONA_MAP } from '../_shared/personaMap.ts';

async function readInput(req: Request): Promise<Record<string, unknown>> {
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, 'JSON body required');
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 110_000) { await reader.cancel(); throw new HttpError(413, 'request too large'); }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } finally { reader.releaseLock(); }
  try { return JSON.parse(body); } catch { throw new HttpError(400, 'invalid JSON'); }
}

export interface PersonaAdminDeps {
  verify?: Verify;
  access(actor: string): Promise<boolean>;
  run(actor: string, input: Record<string, unknown>): Promise<unknown>;
}
export async function handleAdminPersonas(req: Request, deps: PersonaAdminDeps): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  const cors = corsHeaders(req);
  try {
    if (!['GET','POST'].includes(req.method)) throw new HttpError(405, 'method not allowed');
    const { userId } = await requireUser(req, deps.verify);
    if (!await deps.access(userId)) throw new HttpError(403, 'Persona editing requires an active platform admin');
    let input: Record<string, unknown> = { action: 'read' };
    if (req.method === 'POST') {
      input = await readInput(req);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'object required');
      if (!['initialize','save','publish','rollback'].includes(String(input.action))) throw new HttpError(400, 'unknown action');
      if (input.action !== 'initialize') {
        if (!PERSONA_MAP.some(p => p.db === input.persona)) throw new HttpError(400, 'unknown persona');
        if (!Number.isSafeInteger(input.expected) || Number(input.expected) < 1) throw new HttpError(400, 'expected revision required');
        if (input.action === 'save') validatePersonaText(input.text);
        if (input.action === 'rollback' && (typeof input.revision !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.revision))) throw new HttpError(400, 'revision required');
      }
    }
    return json(await deps.run(userId, input), 200, { ...cors, 'cache-control': 'no-store' });
  } catch (e) { return errorResponse(e, cors); }
}
