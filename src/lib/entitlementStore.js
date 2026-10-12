/**
 * The signed-in account's plan, as the server reports it (F2,
 * docs/specs/2026-09-29-f2-entitlements.md).
 *
 * my_entitlement() is the only source. The value lives in memory, keyed by the
 * account it was read for, and is never written to or read from browser
 * storage: editing sessionStorage cannot change a plan. Until it has been
 * read, planEntitlements.js treats the account as free.
 */
import { supabase } from './supabaseClient.js';

const EVENT = 'niy-entitlement';
let current = null;
let inflight = null;

function publish(next) {
  current = next;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
  return current;
}

/** Shape one my_entitlement() / grant result for the account it belongs to. */
function fromServer(userId, data) {
  if (!userId || !data || typeof data !== 'object') return null;
  return {
    userId,
    plan: String(data.plan || 'free'),
    status: String(data.status || 'free'),
    periodEnd: data.period_end || null,
    lapsed: data.lapsed === true,
    source: data.source || null,
  };
}

/** The server entitlement for this account id, or null when not (yet) read. */
export function serverEntitlement(userId) {
  return current && userId && current.userId === userId ? current : null;
}

/** Re-read the plan for the current session. Resolves to the entitlement or null. */
export function refreshEntitlement() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const userId = data?.session?.user?.id;
      if (!userId) return publish(null);
      const result = await supabase.rpc('my_entitlement');
      if (result.error) return current && current.userId === userId ? current : null;
      // A session that changed while the read was in flight is not this answer's owner.
      const after = await supabase.auth.getSession();
      if (after.data?.session?.user?.id !== userId) return null;
      return publish(fromServer(userId, result.data));
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function clearEntitlement() {
  publish(null);
}

export function subscribeEntitlement(fn) {
  const on = () => fn(current);
  window.addEventListener(EVENT, on);
  return () => window.removeEventListener(EVENT, on);
}
