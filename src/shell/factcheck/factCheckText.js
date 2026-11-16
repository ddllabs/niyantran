// F344 T6: the words and small pure helpers of the fact-check panel. Nothing here touches React,
// the network or the browser, so every sentence can be tested.
import { creditsText } from '../../lib/creditsStore.js';

export const MINUTE_CHOICES = [5, 10, 15];

export const VERDICTS = {
  supported: { label: 'Supported', glyph: '✓' },
  contradicted: { label: 'Contradicted', glyph: '✕' },
  partly_true: { label: 'Partly true', glyph: '◐' },
  no_evidence: { label: 'No evidence found', glyph: '?' },
  opinion: { label: 'Opinion', glyph: '“' },
};

const STATUSES = {
  pending: { label: 'Checking…', glyph: '…' },
  needs_context: { label: 'Needs context, not checked', glyph: '…' },
  not_checkable: { label: 'Not checkable', glyph: '–' },
  unchecked: { label: 'Not checked', glyph: '–' },
  error: { label: 'Check failed', glyph: '!' },
};

const KIND_TAGS = { opinion: 'Opinion', prediction: 'Prediction', question: 'Question' };

/**
 * What a claim card shows as its badge: { key, label, glyph }. Only the five verdict labels are
 * ever shown as a verdict; a checked claim with anything else is a failed check.
 */
export function claimBadge(claim) {
  if (claim?.status === 'checked') {
    const verdict = Object.hasOwn(VERDICTS, claim.verdict) ? VERDICTS[claim.verdict] : null;
    if (verdict) return { key: claim.verdict, ...verdict };
    return { key: 'error', ...STATUSES.error };
  }
  const status = Object.hasOwn(STATUSES, claim?.status) ? claim.status : 'error';
  return { key: status, ...STATUSES[status] };
}

/** "Prediction", "Question" or "Opinion" for a claim that is not a plain claim and has no verdict of that name. */
export function kindTag(claim, badge) {
  const tag = Object.hasOwn(KIND_TAGS, claim?.kind) ? KIND_TAGS[claim.kind] : null;
  return tag && tag !== badge.label ? tag : null;
}

/** An http(s) address from a provider, normalised, or null. Anything else is shown as text only. */
export function safeSourceUrl(url) {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/** A link's text: the provider's title, else the host of its (already checked) address. */
export function sourceLabel(source) {
  const title = typeof source?.title === 'string' ? source.title.trim() : '';
  return title || new URL(source.url).hostname;
}

export function formatClock(seconds) {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The three blocks with their price; `affordable` is true when the balance is unknown (the server decides). */
export function blockOptions(creditsPerMinute, balance) {
  return MINUTE_CHOICES.map((minutes) => {
    const price = Math.round(minutes * creditsPerMinute * 10000) / 10000;
    return { minutes, price, affordable: typeof balance !== 'number' || balance >= price };
  });
}

const END_REASONS = {
  time: 'Time is up.',
  user: 'You stopped the session.',
  browser: 'Sharing ended in the browser.',
  silent: 'No speech for 90 seconds, so the session ended.',
  channel_change: 'The channel or video changed.',
  modal_close: 'Live TV was closed.',
  off: 'Fact-check was switched off. You were charged only for the time used.',
  server: 'The server ended the session.',
};

export function endReasonText(reason) {
  return Object.hasOwn(END_REASONS, reason) ? END_REASONS[reason] : 'The session ended.';
}

export function priceChangedText(creditsPerMinute) {
  return typeof creditsPerMinute === 'number'
    ? `The price changed to ${creditsText(creditsPerMinute)} a minute. Review and start again.`
    : 'The price changed. Review and start again.';
}

/** The confirm button: when the player is muted it is unmuted first, then the session is started. */
export function confirmStart({ isMuted, onUnmute, onConfirm }, minutes, creditsPerMinute) {
  if (isMuted) onUnmute();
  onConfirm(minutes, creditsPerMinute);
}

/** { text, retry } for a session error. `retry` means choosing a block again can help. */
export function errorMessage(error) {
  const e = error || {};
  const status = e.status ?? 0;
  if (e.reason === 'price_changed') return { text: priceChangedText(e.creditsPerMinute), retry: true };
  if (e.source === 'start' && status === 0) {
    return {
      text: 'The server did not answer. If the session started, one minute may be charged. Wait a few minutes before trying again.',
      retry: false,
    };
  }
  if (e.source === 'stop') {
    return { text: 'The server could not confirm the end of the session. Check your balance before starting another.', retry: false };
  }
  if (e.source === 'capture') {
    if (e.reason === 'denied') return { text: 'Sharing was declined. Fact-check needs this tab’s audio.', retry: true };
    if (e.reason === 'no_audio') {
      return { text: 'No audio was shared. In Chrome’s prompt choose “This tab” and turn tab audio on.', retry: true };
    }
    if (e.reason === 'unsupported') return { text: 'This browser cannot share tab audio. Use Chrome on a computer.', retry: false };
    return { text: 'Capturing the tab’s audio failed.', retry: true };
  }
  if (e.reason === 'insufficient' || status === 402) {
    const needs = typeof e.needed === 'number' ? `this block needs ${creditsText(e.needed)}` : '';
    const has = typeof e.available === 'number' ? `you have ${creditsText(e.available)}` : '';
    const detail = [needs, has].filter(Boolean).join(' and ');
    return { text: detail ? `Not enough credits: ${detail}.` : 'Not enough credits.', retry: true };
  }
  if (e.reason === 'already_active' || status === 409) {
    return { text: 'A fact-check session is already running on your account (perhaps in another tab).', retry: !e.sessionId };
  }
  if (status === 401) return { text: 'Your sign-in has expired. Sign in again.', retry: false };
  if (status === 403) return { text: 'Fact-check is not available for this account.', retry: false };
  if (status === 0) return { text: 'The network connection failed.', retry: true };
  return { text: 'The fact-check service had a problem.', retry: true };
}

const EMBED_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);

/** The YouTube id in an embed address, or null (another host, no id, or a placeholder such as "undefined"). */
export function embedVideoId(embedUrl) {
  let url;
  try { url = new URL(embedUrl); } catch { return null; }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !EMBED_HOSTS.has(url.hostname)) return null;
  const m = url.pathname.match(/^\/embed\/([A-Za-z0-9_-]{1,32})\/?$/);
  return m && m[1] !== 'undefined' && m[1] !== 'live_stream' ? m[1] : null;
}

/** What is playing, as one string; null when nothing can be captured. A change of it ends a session. */
export function playingTarget(channelId, playbackMode, videoId) {
  return channelId && videoId ? `${channelId}|${playbackMode}|${videoId}` : null;
}

export const RECHECK_FAILED = 'The new check failed. Nothing was charged.';
export const RECHECK_LOST = 'The answer did not arrive. The check may have finished and been charged. Press Check again to see it.';
export const RECHECK_ALREADY = 'This verdict was already checked again. Showing that result.';
export const RECHECK_LOCKED = 'Checking again is unavailable for now after repeated failures.';

/** The answer may never have reached us although the server finished (and charged) the check. */
export const recheckAnswerLost = (status) => status === 0 || (status >= 500 && status !== 502 && status !== 503);

/** Plain words for a re-check that did not produce a result (the price_changed case is handled by the caller). */
export function recheckErrorText(error) {
  const e = error || {};
  const status = e.status ?? 0;
  if (e.reason === 'insufficient' || status === 402) {
    const needs = typeof e.needed === 'number' ? `this needs ${creditsText(e.needed)}` : '';
    const has = typeof e.available === 'number' ? `you have ${creditsText(e.available)}` : '';
    const detail = [needs, has].filter(Boolean).join(' and ');
    return detail ? `Not enough credits: ${detail}.` : 'Not enough credits.';
  }
  if (e.reason === 'not_recheckable') return 'This verdict cannot be checked again.';
  if (e.reason === 'claim_not_found') return 'This claim could no longer be found, so it cannot be checked again.';
  if (e.reason === 'off') return 'Checking again is switched off.';
  if (e.reason === 'not_allowed' || status === 403) return 'Checking again is not available for this account.';
  if (e.reason === 'too_many_failures') return RECHECK_LOCKED;
  if (e.reason === 'in_progress') return 'This claim is already being checked again.';
  if (e.reason === 'rate_limited' || status === 429) return 'Too many checks just now. Wait a minute and try again.';
  if (status === 401) return 'Your sign-in has expired. Sign in again.';
  if (recheckAnswerLost(status)) return RECHECK_LOST;
  return RECHECK_FAILED;
}

export function recheckPriceChangedText(price) {
  return `The price changed to ${creditsText(price)}. Check again to confirm.`;
}
