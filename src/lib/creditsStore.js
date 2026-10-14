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
// The read running now, and the one read queued behind it (review R, M3).
let inflight = null;
let queued = null;
// Bumped by clearCredits(), so a read begun before a sign-out cannot publish after it.
let epoch = 0;
// What a typical answer costs per model (F151): read once, kept until sign-out. Never a failure.
let estimates = null;
let estimatesInflight = null;

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
    // Where used_this_cycle counts from (F153); null when there is no cycle.
    cycleStartsAt: data.cycle?.starts_at || null,
    cycleEndsAt: data.cycle?.ends_at || null,
    // Credits charged to answers since this cycle began; null when there is no cycle (F111 review R, I2).
    usedThisCycle: num(data.used_this_cycle),
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

/** One read of my_credits() for whoever is signed in now. Never rejects. */
async function readOnce() {
  const started = epoch;
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data?.session?.user?.id;
    if (!userId) return publish(null);
    const result = await supabase.rpc('my_credits');
    if (started !== epoch) return null;
    if (result.error) return current && current.userId === userId ? current : null;
    // A session that changed while the read was in flight is not this answer's owner.
    const after = await supabase.auth.getSession();
    if (after.data?.session?.user?.id !== userId || started !== epoch) return null;
    return publish(shapeCredits(userId, result.data));
  } catch {
    return null;
  }
}

function start() {
  const read = readOnce().finally(() => {
    if (inflight === read && !queued) inflight = null;
  });
  inflight = read;
  return read;
}

/**
 * Re-read the credits for the current session. Resolves to them or null.
 *
 * A call made while a read is in flight is not answered by it: that read may have been sent before
 * the charge the caller is refreshing for. It gets one more read, started when the running one ends,
 * and every further call made meanwhile shares that same follow-up. The follow-up looks the session
 * up afresh, so a read for one account never answers a call made for another.
 */
export function refreshCredits() {
  if (!inflight) return start();
  if (!queued) {
    queued = inflight.then(() => {
      queued = null;
      return start();
    });
  }
  return queued;
}

/** Forget the cached balance (sign-out), and discard any read still in flight. */
export function clearCredits() {
  epoch += 1;
  estimates = null;
  estimatesInflight = null;
  wantedConversation = '';
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

/**
 * Credits a typical answer costs, by model id (model_credit_estimates()): whole credits, never dollars.
 *
 * Asked once per session and kept; concurrent callers share the one read. A failure, a signed-out
 * caller or a sign-out mid-read gives `{}` and keeps nothing, so the next call asks again, and a model
 * without an estimate is simply absent. The server's `basis` (measured or list-based) is not kept:
 * both are shown as an estimate.
 */
export function loadCreditEstimates() {
  if (estimates) return Promise.resolve(estimates);
  if (estimatesInflight) return estimatesInflight;
  const started = epoch;
  const read = (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (!data?.session?.user?.id) return {};
      const result = await supabase.rpc('model_credit_estimates');
      if (result.error || !Array.isArray(result.data)) return {};
      const found = {};
      for (const row of result.data) {
        const credits = num(row?.credits);
        if (typeof row?.model_id === 'string' && row.model_id && credits !== null && credits > 0) found[row.model_id] = credits;
      }
      if (started !== epoch) return {};
      estimates = found;
      return found;
    } catch {
      return {};
    } finally {
      if (estimatesInflight === read) estimatesInflight = null;
    }
  })();
  estimatesInflight = read;
  return read;
}

/** "≈ 170 credits" for one model's estimate; empty when there is no usable number. */
export function creditEstimateText(value) {
  const n = num(value);
  return n === null || n <= 0 ? '' : `≈ ${creditsText(n)}`;
}

/**
 * Plan & billing asks the AI panel to open one of the caller's saved conversations (F149), the way the
 * chat asks the shell for Plan & billing (OPEN_BILLING_EVENT in ai/CreditBalance.jsx). The shell shows
 * the AI panel; the research thread selects the chat. The id is also kept until a panel takes it, because
 * the panel may not have been mounted yet when the request was made.
 */
export const OPEN_CONVERSATION_EVENT = 'niy-open-conversation';
let wantedConversation = '';

export function openConversation(conversationId) {
  if (typeof window === 'undefined' || typeof conversationId !== 'string' || !conversationId) return;
  wantedConversation = conversationId;
  window.dispatchEvent(new CustomEvent(OPEN_CONVERSATION_EVENT, { detail: { conversationId } }));
}

/** The conversation asked for and not yet opened, or ''. Reading it clears it. */
export function takeWantedConversation() {
  const id = wantedConversation;
  wantedConversation = '';
  return id;
}

/**
 * Plan & billing, the profile menu and the chat's credit chip ask the shell for the Credits usage page
 * (F153), the way they ask for Plan & billing. The shell holds the page's open state.
 */
export const OPEN_USAGE_EVENT = 'niy-open-usage';

export function openCreditsUsage() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPEN_USAGE_EVENT));
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

/** An amount of credits in words, as it is shown: "1,520 credits", "1 credit", "−50 credits". */
export function creditsText(value) {
  const text = formatCredits(value);
  return `${text} ${text === '1' || text === '−1' ? 'credit' : 'credits'}`;
}

/** The rupee value of an amount of credits, e.g. "≈ ₹200". Empty without the published rate. */
export function rupeeHint(credits, inrPerCredit) {
  const c = num(credits);
  const rate = num(inrPerCredit);
  if (c === null || rate === null || rate <= 0) return '';
  const inr = Math.abs(c * rate);
  // A share of a call can be worth less than a paisa (F153's per-call credits): say so, not "₹0".
  if (inr > 0 && inr < 0.005) return '< ₹0.01';
  const text = inr >= 100 ? GROUPED.format(Math.round(inr)) : trimmed(inr, 2);
  return `≈ ${c < 0 ? '−' : ''}₹${text}`;
}

// F162: an account with no allowance (top-ups only, or between cycles) is low at 10% of the
// smallest monthly allowance (Plus, 2,000 credits).
export const LOW_BALANCE_WITHOUT_ALLOWANCE = 200;

/**
 * True when credits are running low but not yet gone: at most 10% of the cycle allowance, or
 * LOW_BALANCE_WITHOUT_ALLOWANCE when there is no allowance.
 */
export function lowBalance(credits) {
  const balance = num(credits?.balance);
  if (balance === null || balance <= 0) return false;
  const allowance = num(credits?.allowance);
  const limit = allowance !== null && allowance > 0 ? allowance * 0.1 : LOW_BALANCE_WITHOUT_ALLOWANCE;
  return balance <= limit;
}
