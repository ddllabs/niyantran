// health: the verification gate for the foundation module. A 200 proves the
// JWT was accepted, the caller's auth.uid() reached the database, vector is
// installed, and the pricing and allowlist tables are readable.

import { requireUser, type Verify } from '../_shared/auth.ts';
import { corsHeaders, preflight } from '../_shared/cors.ts';
import { errorResponse, HttpError, json } from '../_shared/http.ts';
import { log } from '../_shared/logging.ts';

export interface HealthRow {
  vector: boolean;
  pricing_rows: number;
  models_enabled: number;
  uid: string | null;
}

export interface HealthDeps {
  verify?: Verify;
  /** Runs public.ai_health() as the caller. */
  probe: (token: string) => Promise<HealthRow>;
  version: string;
  origins?: string[];
}

export async function handleHealth(req: Request, deps: HealthDeps): Promise<Response> {
  const pre = preflight(req, deps.origins);
  if (pre) return pre;
  const cors = corsHeaders(req, deps.origins);
  try {
    if (req.method !== 'GET') throw new HttpError(405, 'method not allowed');
    const { userId, token } = await requireUser(req, deps.verify);
    const row = await deps.probe(token);
    if (row.uid !== userId) throw new HttpError(500, 'auth.uid() did not match the token subject');
    log('health.ok', { user_id: userId, vector: row.vector, pricing_rows: row.pricing_rows, models_enabled: row.models_enabled });
    return json(
      {
        ok: true,
        version: deps.version,
        vector: row.vector,
        pricing_rows: row.pricing_rows,
        models_enabled: row.models_enabled,
        user_id: userId,
      },
      200,
      cors,
    );
  } catch (err) {
    log('health.error', { status: err instanceof HttpError ? err.status : 500, message: (err as Error).message });
    return errorResponse(err, cors);
  }
}
