// F344 S3: pure helpers for "Checked parts of this video" (shared results on recorded videos).
// A part is one session's run over the video, as the server describes it. Nothing here guesses:
// a part whose access is not exactly own or unlocked is treated as locked and shows no text.
import { creditsText } from '../../lib/creditsStore.js';

const pad = (n) => String(n).padStart(2, '0');

/** A position in the video: 02:10, or 1:02:05 from one hour. Bad input reads as 00:00. */
export function formatPosition(seconds) {
  const s = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

export const formatRange = (from, to) => `${formatPosition(from)}–${formatPosition(to)}`;

export function minutesLabel(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return `${n} ${n === 1 ? 'minute' : 'minutes'}`;
}

export function claimsLabel(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  if (n === 0) return 'No claims';
  return `${n} ${n === 1 ? 'claim' : 'claims'}`;
}

/** "16 Nov 2026" from a date (2026-11-16) or a timestamp; empty when it cannot be read. A plain date is not shifted by the time zone. */
export function dateLabel(value) {
  const d = new Date(value);
  if (typeof value !== 'string' || Number.isNaN(d.getTime())) return '';
  const plain = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric', ...(plain ? { timeZone: 'UTC' } : {}) });
}

/**
 * The view-model of one part. `readable` parts (own, unlocked) carry their lines and cards; a locked
 * part never does, even if the server sent some. Only unlocked parts can be reported; only the user's
 * own can be checked again.
 */
export function partModel(stretch) {
  const readable = stretch.access === 'own' || stretch.access === 'unlocked';
  const price = typeof stretch.price === 'number' ? stretch.price : null;
  return {
    id: stretch.stretch_id,
    range: formatRange(stretch.from_s, stretch.to_s),
    minutes: minutesLabel(stretch.minutes),
    date: dateLabel(stretch.checked_on),
    claimsLabel: claimsLabel(stretch.claims_count),
    access: readable ? stretch.access : 'locked',
    readable,
    locked: !readable,
    reportable: stretch.access === 'unlocked',
    price,
    priceLabel: !readable && price !== null ? `Unlock · ${creditsText(price)}` : null,
    lines: readable && Array.isArray(stretch.lines) ? stretch.lines : [],
    claims: readable && Array.isArray(stretch.claims) ? stretch.claims : [],
  };
}

/** The first (newest) part whose range holds the position, ends included; null when none or unknown. */
export function coveringPart(stretches, positionS) {
  if (typeof positionS !== 'number' || !Number.isFinite(positionS)) return null;
  return stretches.find((s) => positionS >= s.from_s && positionS <= s.to_s) ?? null;
}

const SWITCHED_OFF = 'Shared results are switched off.';
const NOT_ALLOWED = 'Shared results are not available for this account.';

export function unlockErrorText(error) {
  const e = error || {};
  const status = e.status ?? 0;
  if (e.reason === 'insufficient' || status === 402) {
    const needs = typeof e.needed === 'number' ? `this needs ${creditsText(e.needed)}` : '';
    const has = typeof e.available === 'number' ? `you have ${creditsText(e.available)}` : '';
    const detail = [needs, has].filter(Boolean).join(' and ');
    return detail ? `Not enough credits: ${detail}.` : 'Not enough credits.';
  }
  if (e.reason === 'own') return 'You ran this part yourself, so it is already yours.';
  if (e.reason === 'price_changed') return 'The price changed. Review it and unlock again.';
  if (e.reason === 'rate_limited' || status === 429) return 'Too many tries just now. Wait a minute and try again.';
  if (e.reason === 'not_found' || e.reason === 'claim_not_found' || status === 404) return 'This part could no longer be found.';
  if (e.reason === 'off') return SWITCHED_OFF;
  if (e.reason === 'not_allowed' || status === 403) return NOT_ALLOWED;
  if (status === 401) return 'Your sign-in has expired. Sign in again.';
  if (status === 0) return 'The server did not answer. If you were charged, your balance will show it.';
  return 'Something went wrong on the server. If you were charged, your balance will show it.';
}

export function reportErrorText(error) {
  const e = error || {};
  const status = e.status ?? 0;
  if (e.reason === 'already') return 'You have already reported this verdict.';
  if (e.reason === 'rate_limited' || status === 429) return 'You have sent many reports today. Try again tomorrow.';
  if (e.reason === 'not_found' || e.reason === 'claim_not_found' || status === 404) return 'This verdict could no longer be found.';
  if (e.reason === 'off') return SWITCHED_OFF;
  if (e.reason === 'not_allowed' || status === 403) return NOT_ALLOWED;
  if (status === 0) return 'The report could not be sent. Check your connection and try again.';
  return 'The report could not be sent. Try again later.';
}

export const SHARED_LOAD_FAILED = 'The checked parts could not be loaded. Try again later.';

/** Why the list of checked parts could not be loaded. */
export function viewErrorText(error) {
  if (error?.reason === 'rate_limited' || error?.status === 429) return 'Too many lookups just now. Wait a minute and try again.';
  return SHARED_LOAD_FAILED;
}
