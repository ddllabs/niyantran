/**
 * The signed-in account's plan, as the server reports it (F2,
 * docs/specs/2026-09-29-f2-entitlements.md).
 *
 * my_entitlement_manual() is the only source. The value lives in memory, keyed by the
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

/** Shape one server entitlement result for the account it belongs to. */
function fromServer(userId, data) {
  if (!userId || !data || typeof data !== 'object') return null;
  return {
    userId,
    plan: String(data.plan || 'free'),
    status: String(data.status || 'free'),
    periodEnd: data.period_end || null,
    accessUntil: data.access_until || data.period_end || null,
    graceUntil: data.grace_until || null,
    inGrace: data.in_grace === true,
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
      const result = await supabase.rpc('my_entitlement_manual');
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

/** Refresh at meaningful boundaries, rather than polling every page or minute. */
export function watchEntitlementTransitions(onChange, refreshWallet = () => {}) {
  let timer;
  let stopped = false;
  let retryTimer;
  let retries = 0;
  async function recheck() {
    if (stopped) return;
    const previous = current;
    await Promise.allSettled([refreshEntitlement(), Promise.resolve().then(() => { if (!stopped) return refreshWallet(); })]);
    if (stopped) return;
    if (previous && current === previous && retries < 3) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(recheck, [1000, 5000, 30000][retries++]);
    }
    schedule();
  }
  function schedule() {
    clearTimeout(timer);
    if (stopped || !current) return;
    const paid = Date.parse(current.periodEnd || '');
    const now = Date.now();
    const boundaries = [paid - 7 * 86400000, paid - 2 * 86400000, paid,
      Date.parse(current.accessUntil || ''), Date.parse(current.graceUntil || '')]
      .filter(value => Number.isFinite(value) && value > now);
    if (!boundaries.length) return;
    timer = setTimeout(async () => {
      if (stopped) return;
      onChange();
      await recheck();
    }, Math.min(Math.min(...boundaries) - now + 1, 2147483647));
  }
  const unsubscribe = subscribeEntitlement(() => {
    retries = 0; clearTimeout(retryTimer); onChange(); schedule();
  });
  const recover = () => { retries = 0; onChange(); recheck(); };
  window.addEventListener('focus', recover);
  window.addEventListener('online', recover);
  schedule();
  return () => {
    stopped = true; clearTimeout(timer); clearTimeout(retryTimer); unsubscribe();
    window.removeEventListener('focus', recover); window.removeEventListener('online', recover);
  };
}
