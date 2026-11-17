// The claim table through PostgREST with the service client. Every read and write is scoped by user and
// session (and claim id), so a request can never reach another user's row even with a guessed id.
// Writes to a claim happen only in the status the step expects, which is what makes the check lock,
// the held-claim update and the final save safe against a second request.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { CheckResult, ClaimInsert, ClaimRow, ClaimStore, HeldPatch, SessionRow } from './types.ts';

const CLAIM_COLUMNS =
  'id,session_id,user_id,quote,claim_en,claimant,reported_by,kind,status,verdict,reason,sources,checked_at,spoken_at,supersedes,shared';
const SESSION_COLUMNS = 'id,user_id,video_id,channel_id,video_kind';

type Db = Pick<SupabaseClient, 'from'>;

function must<T>(result: { data: T; error: { code?: string; message?: string } | null }): T {
  // Only the code is kept: a database message could carry row content.
  if (result.error) throw new Error(`database error ${result.error.code ?? 'unknown'}`);
  return result.data;
}

export function postgrestStore(db: () => Db): ClaimStore {
  const claims = () => db().from('factcheck_claims');
  const scoped = (userId: string, sessionId: string, claimId: string) => ({
    id: claimId,
    session_id: sessionId,
    user_id: userId,
  });
  return {
    async session(userId, sessionId) {
      const r = await db().from('factcheck_sessions').select(SESSION_COLUMNS).eq('id', sessionId).eq('user_id', userId)
        .maybeSingle();
      return (must(r) as SessionRow | null) ?? null;
    },
    async claims(userId, sessionId, limit) {
      const r = await claims().select(CLAIM_COLUMNS).eq('session_id', sessionId).eq('user_id', userId)
        .order('spoken_at', { ascending: false }).limit(limit);
      return (must(r) as ClaimRow[] | null) ?? [];
    },
    async insertClaims(rows: ClaimInsert[]) {
      if (!rows.length) return [];
      return (must(await claims().insert(rows).select(CLAIM_COLUMNS)) as ClaimRow[] | null) ?? [];
    },
    async updateHeld(userId, sessionId, claimId, patch: HeldPatch, shared: boolean) {
      const s = scoped(userId, sessionId, claimId);
      const r = await claims().update(patch).eq('id', s.id).eq('session_id', s.session_id).eq('user_id', s.user_id)
        .eq('status', 'needs_context').eq('shared', shared).select(CLAIM_COLUMNS).maybeSingle();
      return (must(r) as ClaimRow | null) ?? null;
    },
    async claim(userId, sessionId, claimId) {
      const s = scoped(userId, sessionId, claimId);
      const r = await claims().select(CLAIM_COLUMNS).eq('id', s.id).eq('session_id', s.session_id).eq(
        'user_id',
        s.user_id,
      ).maybeSingle();
      return (must(r) as ClaimRow | null) ?? null;
    },
    async claimById(userId, claimId) {
      const r = await claims().select(CLAIM_COLUMNS).eq('id', claimId).eq('user_id', userId).maybeSingle();
      return (must(r) as ClaimRow | null) ?? null;
    },
    async lockForCheck(userId, sessionId, claimId, at, staleBefore) {
      const s = scoped(userId, sessionId, claimId);
      const r = await claims().update({ checked_at: at }).eq('id', s.id).eq('session_id', s.session_id).eq(
        'user_id',
        s.user_id,
      )
        .eq('status', 'pending').or(`checked_at.is.null,checked_at.lt.${staleBefore}`).select('id');
      const rows = must(r) as unknown[] | null;
      return Array.isArray(rows) && rows.length === 1;
    },
    async releaseCheck(userId, sessionId, claimId) {
      const s = scoped(userId, sessionId, claimId);
      must(
        await claims().update({ checked_at: null }).eq('id', s.id).eq('session_id', s.session_id).eq(
          'user_id',
          s.user_id,
        ).eq('status', 'pending'),
      );
    },
    async finishCheck(userId, sessionId, claimId, result: CheckResult) {
      const s = scoped(userId, sessionId, claimId);
      const r = await claims().update(result).eq('id', s.id).eq('session_id', s.session_id).eq('user_id', s.user_id)
        .eq('status', 'pending').select(CLAIM_COLUMNS).maybeSingle();
      return (must(r) as ClaimRow | null) ?? null;
    },
  };
}
