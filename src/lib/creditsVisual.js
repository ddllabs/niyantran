/**
 * The credits page's pictures (F184, docs/specs/2026-10-15-credits-page.md §3), as pure functions of
 * data the client already reads: my_credits() (creditsStore.js), my_usage_timeseries and
 * my_usage_activity (creditUsage.js). Credits only; nothing here is shown in money.
 */
import { creditsText, lowBalance } from './creditsStore.js';
import { dayText as periodDay, istDayStart } from './creditUsage.js';

const DAY_MS = 86400000;
const IST_OFFSET_MS = 330 * 60000;
const RENEW_SOON_MS = 7 * DAY_MS;

const n = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
/** The IST calendar date of an instant, as the reports write it (YYYY-MM-DD). */
const istDate = (ms) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
/** The instant an IST date (YYYY-MM-DD) begins. */
const istDateStart = (date) => Date.parse(`${date}T00:00:00+05:30`);

/**
 * This period as one bar: used, held, then what is left by lot kind (held comes out of the lot that
 * expires first). An overdrawn balance has nothing left and its own amount.
 */
export function periodBar(credits) {
  const used = Math.max(n(credits?.usedThisCycle), 0);
  const balance = n(credits?.balance);
  const held = Math.min(Math.max(n(credits?.held), 0), Math.max(balance, 0));
  const segments = [];
  if (used > 0) segments.push({ key: 'used', id: 'used', value: used });
  if (held > 0) segments.push({ key: 'held', id: 'held', value: held });
  let toTake = held;
  const lots = [...(credits?.lots || [])].sort((a, b) => (Date.parse(a.expiresAt) || Infinity) - (Date.parse(b.expiresAt) || Infinity));
  for (const lot of balance > 0 ? lots : []) {
    let value = Math.max(n(lot.remaining), 0);
    const taken = Math.min(value, toTake);
    value -= taken;
    toTake -= taken;
    if (value > 0) segments.push({ key: lot.kind || 'other', id: `${lot.kind || 'other'}:${lot.expiresAt || ''}:${segments.length}`, value, expiresAt: lot.expiresAt || null });
  }
  const left = Math.max(balance - held, 0);
  return { segments, used, held, left, total: used + Math.max(balance, 0), overdrawn: balance < 0 ? -balance : 0 };
}

/**
 * Credits used so far this period, day by day, against an even pace to the period's credits, and,
 * from the third day, an estimate at the average daily rate: the day they run out, or what is left
 * at renewal. Null without a period.
 */
export function paceModel({ credits, points, now = Date.now() }) {
  const start = Date.parse(credits?.cycleStartsAt || '');
  const end = Date.parse(credits?.cycleEndsAt || '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const startDay = istDayStart(start);
  // A period starts at the payment time, not at midnight, so it can span one more IST date than its length.
  const totalDays = Math.max(1, Math.floor((istDayStart(end - 1) - startDay) / DAY_MS) + 1);
  const today = Math.min(Math.floor((istDayStart(now) - startDay) / DAY_MS), totalDays - 1);
  if (today < 0) return null;
  const perDay = new Array(today + 1).fill(0);
  for (const p of Array.isArray(points) ? points : []) {
    const d = Math.floor((istDateStart(p.bucket) - startDay) / DAY_MS);
    if (d >= 0 && d <= today) perDay[d] += n(p.credits);
  }
  let sum = 0;
  const days = perDay.map((v, day) => ({ day, date: istDate(startDay + day * DAY_MS), cumulative: (sum += v) }));
  const bar = periodBar(credits);
  const elapsed = today + 1;
  const evenToday = (bar.total * elapsed) / totalDays;
  let projection = null;
  const rate = bar.used / elapsed;
  const left = n(credits?.available ?? bar.left);
  if (elapsed >= 3 && rate > 0 && left > 0) {
    const runOut = now + (left / rate) * DAY_MS;
    projection = runOut < end
      ? { runOutAt: new Date(runOut).toISOString(), leftAtRenewal: null, rate }
      : { runOutAt: null, leftAtRenewal: Math.max(left - rate * ((end - now) / DAY_MS), 0), rate };
  }
  return { days, totalDays, total: bar.total, used: bar.used, evenToday, projection, expires: credits?.plan === 'free' };
}

/** One cell per IST day for the last `count` days, oldest first, at five levels against the busiest. */
export function heatmapCells(points, now = Date.now(), count = 90) {
  const totals = new Map();
  for (const p of Array.isArray(points) ? points : []) totals.set(p.bucket, (totals.get(p.bucket) || 0) + n(p.credits));
  const last = istDayStart(now);
  const cells = [];
  for (let i = count - 1; i >= 0; i--) {
    const date = istDate(last - i * DAY_MS);
    cells.push({ date, value: totals.get(date) || 0 });
  }
  const max = Math.max(0, ...cells.map((c) => c.value));
  return cells.map((c) => ({ ...c, level: c.value > 0 && max > 0 ? Math.min(4, Math.max(1, Math.ceil((c.value / max) * 4))) : 0 }));
}

/** Activity rows totalled per chat, most credits first. Rows with no chat (dictation) share one group. */
export function groupByChat(rows) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = row.conversationId || (row.turnKey ? 'deleted' : 'dictation');
    const g = groups.get(key) || { key, conversationId: row.conversationId || null, title: null, credits: 0, calls: 0, answers: 0, latest: null, sample: row };
    g.title = g.title || row.title || null;
    g.credits += n(row.credits);
    g.calls += n(row.calls);
    g.answers += 1;
    if (!g.latest || Date.parse(row.createdAt) > Date.parse(g.latest)) g.latest = row.createdAt;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.credits - a.credits || Date.parse(b.latest) - Date.parse(a.latest));
}

const ROLE_ORDER = ['search', 'answer', 'repair', 'dictation'];

/** An answer's calls summed by role, in a fixed order: the pieces of its credits bar. */
export function roleSegments(detail) {
  const byRole = new Map();
  for (const d of Array.isArray(detail) ? detail : []) {
    const role = d.role || 'other';
    const s = byRole.get(role) || { role, credits: 0, calls: 0, free: true, model: null, effort: null, top: -1 };
    s.credits += n(d.credits);
    s.calls += 1;
    s.free = s.free && Boolean(d.free);
    if (n(d.credits) > s.top) {
      s.top = n(d.credits);
      s.model = d.model || null;
      s.effort = d.effort || null;
    }
    byRole.set(role, s);
  }
  const rank = (r) => (ROLE_ORDER.includes(r) ? ROLE_ORDER.indexOf(r) : ROLE_ORDER.length);
  return [...byRole.values()].sort((a, b) => rank(a.role) - rank(b.role)).map(({ top, ...s }) => s);
}

function dayText(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}

const PLAN_NAMES = { plus: 'Plus', pro: 'Pro', max: 'Max' };

/**
 * The status bar's messages (spec §1): every state the app already tells the user about, in the same
 * words as the chat and Plan and invoices. `failed` means the balance could not be read; `skip` drops
 * keys a section already says itself.
 */
export function statusMessages({ credits, failed = false, now = Date.now(), skip = [] }) {
  if (!credits) return failed ? [{ key: 'unchecked', tone: 'warn', text: 'AI credits could not be checked right now. Try again in a moment.' }] : [];
  const out = [];
  const balance = n(credits.balance);
  const held = n(credits.held);
  const free = credits.plan === 'free';
  if (balance < 0) out.push({ key: 'overdrawn', tone: 'danger', text: `${creditsText(-balance)} beyond your balance will be taken from your next credits.` });
  else if (balance <= 0) out.push({ key: 'empty', tone: 'danger', text: 'You have no AI credits left to start an answer. Upgrade your plan, or write to niyantranai@gmail.com for more credits.' });
  else if (balance - held > 0 && lowBalance(credits)) out.push({ key: 'low', tone: 'warn', text: `Running low: ${creditsText(balance)} left${!free && n(credits.allowance) > 0 ? ' this cycle' : ''}.` });
  if (held > 0) out.push({ key: 'held', tone: 'info', text: `${creditsText(held)} held for a running answer. They are released or charged when it finishes.` });
  const end = Date.parse(credits.cycleEndsAt || '');
  if (!free && Number.isFinite(end) && end > now && end - now <= RENEW_SOON_MS) {
    out.push({ key: 'renews', tone: 'info', text: `Your ${PLAN_NAMES[credits.plan] || 'plan'} month ends on ${dayText(end)}. Renew to keep it.` });
  }
  return out.filter((m) => !skip.includes(m.key));
}

/** The period in words, for when no day count fits: "Billing period · 13 Oct 2026 – 12 Nov 2026 · renews 12 Nov 2026". */
export function periodLine(credits) {
  if (!credits) return '';
  const ends = periodDay(credits.cycleEndsAt);
  if (credits.plan === 'free') return ends ? `Sign-up credits · valid until ${ends}` : 'Sign-up credits';
  const starts = periodDay(credits.cycleStartsAt);
  if (starts && ends) return `Billing period · ${starts} – ${ends} · renews ${ends}`;
  return ends ? `Billing period · renews ${ends}` : 'Billing period';
}
