/**
 * The signed-in user's AI credits (F111, docs/specs/2026-10-14-ai-credits.md §7, §8).
 *
 * my_credits() is the only source of the wallet and my_conversation_credits() of
 * each answer's charge. Values live in memory, keyed by the account they were read
 * for, never in browser storage. Credits only: the server sends no dollars, and the
 * rupee hint uses the rupees per credit it publishes, so no rate is copied here.
 */
import { supabase } from './supabaseClient.js';

const EVENT = 'niy-credits';
let current = null;
let inflight = null;

function publish(next) {
  current = next;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
  return current;
}

function num(value) {
  const n = Number(value);
  return value === null || value === undefined || !Number.isFinite(n) ? null : n;
}

/** Shape one my_credits() answer for the account it belongs to. */
export function shapeCredits(userId, data) {
  if (!userId || !data || typeof data !== 'object') return null;
  const balance = num(data.balance) ?? 0;
  const held = num(data.held) ?? 0;
  return {
    userId,
    balance,
    held,
    available: balance - held,
    debt: num(data.debt) ?? 0,
    plan: String(data.plan || 'free'),
    inrPerCredit: num(data.inr_per_credit),
    allowance: num(data.cycle?.allowance),
    cycleEndsAt: data.cycle?.ends_at || null,
    lots: Array.isArray(data.lots)
      ? data.lots.map((l) => ({ kind: String(l.kind), remaining: num(l.remaining) ?? 0, expiresAt: l.expires_at || null }))
      : [],
    recent: Array.isArray(data.recent)
      ? data.recent.map((r) => ({
        conversationId: r.conversation_id || null,
        title: r.title || null,
        credits: num(r.credits) ?? 0,
        createdAt: r.created_at || null,
      }))
      : [],
  };
}

/** The credits read for this account id, or null when not (yet) read. */
export function serverCredits(userId) {
  return current && userId && current.userId === userId ? current : null;
}

/** Re-read the credits for the current session. Resolves to them or null. */
export function refreshCredits() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const userId = data?.session?.user?.id;
      if (!userId) return publish(null);
      const result = await supabase.rpc('my_credits');
      if (result.error) return current && current.userId === userId ? current : null;
      // A session that changed while the read was in flight is not this answer's owner.
      const after = await supabase.auth.getSession();
      if (after.data?.session?.user?.id !== userId) return null;
      return publish(shapeCredits(userId, result.data));
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function clearCredits() {
  publish(null);
}

export function subscribeCredits(fn) {
  const on = () => fn(current);
  window.addEventListener(EVENT, on);
  return () => window.removeEventListener(EVENT, on);
}

/** Credits charged per answer in one of the caller's conversations: message id → credits. */
export async function conversationCredits(conversationId) {
  const out = new Map();
  if (!conversationId) return out;
  try {
    const { data, error } = await supabase.rpc('my_conversation_credits', { p_conversation: conversationId });
    if (error || !Array.isArray(data)) return out;
    for (const row of data) {
      const credits = num(row?.credits);
      if (row?.message_id && credits !== null) out.set(row.message_id, credits);
    }
  } catch {
    /* an unread charge simply shows nothing */
  }
  return out;
}

const GROUPED = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

function trimmed(value, digits) {
  return String(Number(value.toFixed(digits)));
}

/** Credits for display: whole from 100, one decimal from 10, two below; "−" when negative. */
export function formatCredits(value) {
  const n = num(value);
  if (n === null) return '—';
  const abs = Math.abs(n);
  const text = abs >= 100 ? GROUPED.format(Math.round(abs)) : abs >= 10 ? trimmed(abs, 1) : trimmed(abs, 2);
  return n < 0 && text !== '0' ? `−${text}` : text;
}

/** The rupee value of an amount of credits, e.g. "≈ ₹200". Empty without the published rate. */
export function rupeeHint(credits, inrPerCredit) {
  const c = num(credits);
  const rate = num(inrPerCredit);
  if (c === null || rate === null || rate <= 0) return '';
  const inr = Math.abs(c * rate);
  const text = inr >= 100 ? GROUPED.format(Math.round(inr)) : trimmed(inr, 2);
  return `≈ ${c < 0 ? '−' : ''}₹${text}`;
}

/** True when credits are running low (at most 10% of the cycle allowance) but not yet gone. */
export function lowBalance(credits) {
  const balance = num(credits?.balance);
  const allowance = num(credits?.allowance);
  if (balance === null || allowance === null || allowance <= 0) return false;
  return balance > 0 && balance <= allowance * 0.1;
}
