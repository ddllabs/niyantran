// One Edge Function, five actions. The common gate runs in a fixed order and nothing past it happens
// before it passes:
//   1. CORS preflight   2. origin   3. POST only   4. requireUser (identity only from the verified
//   token)   5. active account   6. parse the action and validate its input
// then the action calls factcheck_touch (session check and rate limit) BEFORE any model call.
// Errors carry the CORS headers; no log line holds a token, key, audio or transcript text.

import { requireUser } from '../_shared/auth.ts';
import { allowedOrigins, corsHeaders, originAllowed, preflight } from '../_shared/cors.ts';
import { errorResponse, HttpError, json } from '../_shared/http.ts';
import { log } from '../_shared/logging.ts';
import { ApiError } from './apiError.ts';
import { MAX_JSON_BYTES, MAX_MULTIPART_BYTES, readCapped } from './body.ts';
import { checkAction } from './check.ts';
import { extractAction } from './extract.ts';
import { recheckAction } from './recheck.ts';
import { startAction } from './start.ts';
import { stopAction } from './stop.ts';
import { transcribeAction } from './transcribe.ts';
import type { Ctx, FactcheckDeps } from './types.ts';
import { badRequest, isObject, type Obj } from './validate.ts';

const JSON_ACTIONS: Record<string, (ctx: Ctx, body: Obj) => Promise<Obj>> = {
  start: startAction,
  extract: extractAction,
  check: checkAction,
  stop: stopAction,
  recheck: recheckAction,
};

async function parse(req: Request): Promise<{ action: string; json?: Obj; form?: FormData }> {
  const type = (req.headers.get('content-type') ?? '').toLowerCase();
  if (type.startsWith('multipart/form-data')) {
    const bytes = await readCapped(req, MAX_MULTIPART_BYTES);
    let form: FormData;
    try {
      form = await new Response(bytes as BlobPart, { headers: { 'content-type': req.headers.get('content-type')! } })
        .formData();
    } catch {
      throw badRequest('Invalid form.');
    }
    if (form.get('action') !== 'transcribe') throw badRequest('Only transcribe may be sent as a form.');
    return { action: 'transcribe', form };
  }
  const bytes = await readCapped(req, MAX_JSON_BYTES);
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw badRequest('Invalid JSON.');
  }
  if (!isObject(body) || typeof body.action !== 'string' || !Object.hasOwn(JSON_ACTIONS, body.action)) {
    throw badRequest('Unknown action.');
  }
  return { action: body.action, json: body };
}

export async function handleFactcheck(req: Request, deps: FactcheckDeps): Promise<Response> {
  const origins = deps.origins ?? allowedOrigins();
  const pre = preflight(req, origins);
  if (pre) return pre;
  const cors = { ...corsHeaders(req, origins), 'Cache-Control': 'no-store' };
  const now = deps.now ?? Date.now;
  const started = now();
  let action = 'unknown';
  try {
    const origin = req.headers.get('origin');
    if (origin && !originAllowed(origin, origins)) throw new HttpError(403, 'Origin not allowed.');
    if (req.method !== 'POST') throw new HttpError(405, 'POST only.');
    const { token, userId } = await requireUser(req, deps.verify);
    let active: boolean;
    try {
      active = await deps.active(token, userId);
    } catch {
      throw new ApiError(503, 'Account verification unavailable.', { reason: 'unavailable' });
    }
    if (!active) throw new HttpError(403, 'An active account is required.');

    const parsed = await parse(req);
    action = parsed.action;
    const ctx: Ctx = { req, deps, userId, token, now };
    const result = parsed.form
      ? await transcribeAction(ctx, parsed.form)
      : await JSON_ACTIONS[parsed.action](ctx, parsed.json!);
    log('factcheck.done', { action, status: 200, ms: now() - started });
    return json(result, 200, cors);
  } catch (error) {
    if (error instanceof ApiError) {
      log('factcheck.done', {
        action,
        status: error.status,
        reason: String(error.body.reason ?? ''),
        ms: now() - started,
      });
      return json({ error: error.message, ...error.body }, error.status, { ...cors, ...error.headers });
    }
    // Only the error's name is logged: a message may carry data from a provider or a row.
    log('factcheck.error', {
      action,
      status: error instanceof HttpError ? error.status : 500,
      name: (error as Error)?.name ?? 'unknown',
    });
    return errorResponse(error, cors);
  }
}
