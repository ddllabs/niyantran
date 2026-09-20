// admin-models: the only write path to the allowlist and roles. Every
// request needs a user JWT and is_platform_admin() must be true for that
// user; the write itself runs with the service role through the
// admin_models_upsert RPC, so the guard triggers' refusals come back as 400.

import { requireUser, type Verify } from '../_shared/auth.ts';
import { corsHeaders, preflight } from '../_shared/cors.ts';
import { errorResponse, HttpError, json } from '../_shared/http.ts';
import { log } from '../_shared/logging.ts';
import { invalidateRegistry } from '../_shared/models.ts';

export type Kind = 'model' | 'role';

export interface AdminReadResult {
  models: Record<string, unknown>[];
  roles: Record<string, unknown>[];
  catalogue: Record<string, unknown>[];
}

export type WriteResult = { row: Record<string, unknown> } | { error: string };

export interface AdminDeps {
  verify?: Verify;
  isAdmin: (token: string) => Promise<boolean>;
  read: () => Promise<AdminReadResult>;
  write: (kind: Kind, row: Record<string, unknown>) => Promise<WriteResult>;
  origins?: string[];
}

const MODEL_FIELDS = ['model_id', 'label', 'vendor', 'tier', 'efforts', 'params', 'enabled', 'is_default', 'sort_order'] as const;
const ROLE_FIELDS = ['role_id', 'label', 'hint', 'model_id', 'sort_order'] as const;

/** Keep only the columns the RPC accepts; unknown keys are dropped, not rejected. */
export function pickRow(kind: Kind, raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'row must be an object');
  const src = raw as Record<string, unknown>;
  const fields: readonly string[] = kind === 'model' ? MODEL_FIELDS : ROLE_FIELDS;
  const out: Record<string, unknown> = {};
  for (const f of fields) if (f in src) out[f] = src[f];
  const idField = kind === 'model' ? 'model_id' : 'role_id';
  if (typeof out[idField] !== 'string' || !(out[idField] as string).trim()) throw new HttpError(400, `${idField} is required`);
  if ('efforts' in out && !Array.isArray(out.efforts)) throw new HttpError(400, 'efforts must be an array');
  if ('tier' in out && typeof out.tier !== 'number') throw new HttpError(400, 'tier must be a number');
  for (const b of ['enabled', 'is_default'] as const) {
    if (b in out && typeof out[b] !== 'boolean') throw new HttpError(400, `${b} must be a boolean`);
  }
  return out;
}

export async function handleAdminModels(req: Request, deps: AdminDeps): Promise<Response> {
  const pre = preflight(req, deps.origins);
  if (pre) return pre;
  const cors = corsHeaders(req, deps.origins);
  try {
    if (req.method !== 'GET' && req.method !== 'PUT') throw new HttpError(405, 'method not allowed');
    const { userId, token } = await requireUser(req, deps.verify);
    if (!(await deps.isAdmin(token))) {
      log('admin_models.forbidden', { user_id: userId });
      throw new HttpError(403, 'admin only');
    }

    if (req.method === 'GET') {
      return json(await deps.read(), 200, cors);
    }

    let body: { kind?: unknown; row?: unknown };
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'body must be JSON');
    }
    if (body.kind !== 'model' && body.kind !== 'role') throw new HttpError(400, 'kind must be model or role');
    const row = pickRow(body.kind, body.row);
    const result = await deps.write(body.kind, row);
    if ('error' in result) {
      log('admin_models.refused', { user_id: userId, kind: body.kind, message: result.error });
      return json({ error: result.error }, 400, cors);
    }
    invalidateRegistry();
    log('admin_models.saved', { user_id: userId, kind: body.kind, id: row.model_id ?? row.role_id });
    return json({ row: result.row }, 200, cors);
  } catch (err) {
    return errorResponse(err, cors);
  }
}
