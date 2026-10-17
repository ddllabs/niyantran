/**
 * The signed-in user's AI credits (F111, docs/specs/2026-10-14-ai-credits.md §7, §8).
 *
 * my_credits() is the only source of the wallet and my_conversation_credits() of
 * each answer's charge. Values live in memory, keyed by the account they were read
 * for, never in browser storage. Credits only (F184): no amount is shown in money.
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
let estimatesUserId = null;
let unitVersion = null;
let unitGeneration = 0;
let observedPaise = false;

function publish(next) {
  current = next;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
  return current;
}

function num(value) {
  const n = Number(value);
  return value === null || value === undefined || !Number.isFinite(n) ? null : n;
}

function withUnit(value, version) {
  Object.defineProperty(value, 'unitVersion', { value: version });
  return value;
}

const UNIT_RATES = { 'credit-ten-paise-v1': 0.1, 'credit-paise-v2': 0.01 };

function versionOf(data) {
  const rate = num(data?.inr_per_credit);
  const version = data?.unit_version == null
    ? Object.keys(UNIT_RATES).find((key) => UNIT_RATES[key] === rate)
    : data.unit_version;
  return Object.hasOwn(UNIT_RATES, version) && UNIT_RATES[version] === rate ? version : null;
}

function setUnit(version) {
  if (unitVersion === version) return;
  unitVersion = version;
  unitGeneration += 1;
  estimates = null;
  estimatesInflight = null;
  estimatesUserId = null;
  publish(null);
}

async function readUnit() {
  const started = epoch;
  try {
    const { data, error } = await supabase.rpc('credit_unit');
    if (started !== epoch) return null;
    const version = error ? null : versionOf(data);
    // A late response from before cutover cannot restore the old denomination.
    if (version === 'credit-ten-paise-v1' && observedPaise) return null;
    if (version === 'credit-paise-v2') observedPaise = true;
    setUnit(version);
    return version;
  } catch {
    if (started === epoch) setUnit(null);
    return null;
  }
}

/** Last authoritative denomination observed by this tab, or null when unavailable. */
export function creditUnitVersion() { return unitVersion; }

/** Shape one my_credits() answer for the account it belongs to. */
export function shapeCredits(userId, data) {
  if (!userId || !data || typeof data !== 'object') return null;
  const unitVersion = versionOf(data);
  if (!unitVersion) return null;
  const balance = num(data.balance) ?? 0;
  const held = num(data.held) ?? 0;
  return {
    userId,
    unitVersion,
    balance,
    held,
    available: balance - held,
    debt: num(data.debt) ?? 0,
    plan: String(data.plan || 'free'),
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
    const version = await readUnit();
    if (!version || started !== epoch) return null;
    const generation = unitGeneration;
    const result = await supabase.rpc('my_credits');
    if (started !== epoch) return null;
    if (result.error) {
      const after = await supabase.auth.getSession();
      return after.data?.session?.user?.id === userId && started === epoch
        && current?.userId === userId && current.unitVersion === version
        && generation === unitGeneration && unitVersion === version ? current : null;
    }
    const shaped = shapeCredits(userId, result.data);
    if (!shaped || shaped.unitVersion !== version) return publish(null);
    // A session that changed while the read was in flight is not this answer's owner.
    const after = await supabase.auth.getSession();
    if (after.data?.session?.user?.id !== userId || started !== epoch) return null;
    if (await readUnit() !== version || started !== epoch || generation !== unitGeneration || unitVersion !== version) return null;
    return publish(shaped);
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
  estimatesUserId = null;
  unitVersion = null;
  unitGeneration += 1;
  observedPaise = false;
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
    const started = epoch;
    const { data: session } = await supabase.auth.getSession();
    const userId = session?.session?.user?.id;
    if (!userId || started !== epoch) return out;
    const version = await readUnit();
    if (!version || started !== epoch) return out;
    const generation = unitGeneration;
    const { data, error } = await supabase.rpc('my_conversation_credits', { p_conversation: conversationId });
    if (error || !Array.isArray(data)) return out;
    if (await readUnit() !== version || started !== epoch) return out;
    const after = await supabase.auth.getSession();
    if (after.data?.session?.user?.id !== userId || started !== epoch || generation !== unitGeneration || unitVersion !== version) return out;
    for (const row of data) {
      const credits = num(row?.credits);
      if (row?.message_id && credits !== null) out.set(row.message_id, credits);
    }
    return withUnit(out, version);
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
export async function loadCreditEstimates() {
  const started = epoch;
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data?.session?.user?.id;
    if (!userId) return {};
    const version = await readUnit();
    if (!version || started !== epoch) return {};
    const generation = unitGeneration;
    if (estimates && estimatesUserId === userId) {
      const after = await supabase.auth.getSession();
      return after.data?.session?.user?.id === userId && started === epoch
        && generation === unitGeneration && unitVersion === version ? estimates : {};
    }
    if (estimatesInflight) return estimatesInflight;
    const read = (async () => {
      try {
        const result = await supabase.rpc('model_credit_estimates');
        if (result.error || !Array.isArray(result.data)) return {};
        const found = {};
        for (const row of result.data) {
          const credits = num(row?.credits);
          if (typeof row?.model_id === 'string' && row.model_id && credits !== null && credits > 0) found[row.model_id] = credits;
        }
        if (await readUnit() !== version || started !== epoch || generation !== unitGeneration) return {};
        const after = await supabase.auth.getSession();
        if (after.data?.session?.user?.id !== userId || started !== epoch || generation !== unitGeneration || unitVersion !== version) return {};
        estimates = withUnit(found, version);
        estimatesUserId = userId;
        return estimates;
      } catch {
        return {};
      } finally {
        if (estimatesInflight === read) estimatesInflight = null;
      }
    })();
    estimatesInflight = read;
    return read;
  } catch { return {}; }
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

// F162: an account with no allowance (top-ups only, or between cycles) is low at 10% of the
// smallest monthly allowance (Plus, 20,000 credits).
export const LOW_BALANCE_WITHOUT_ALLOWANCE = 2000;

/**
 * True when credits are running low but not yet gone: at most 10% of the cycle allowance, or
 * LOW_BALANCE_WITHOUT_ALLOWANCE when there is no allowance.
 */
export function lowBalance(credits) {
  const balance = num(credits?.balance);
  if (balance === null || balance <= 0) return false;
  const allowance = num(credits?.allowance);
  const limit = allowance !== null && allowance > 0 ? allowance * 0.1
    : credits?.unitVersion === 'credit-ten-paise-v1' ? 200 : LOW_BALANCE_WITHOUT_ALLOWANCE;
  return balance <= limit;
}
