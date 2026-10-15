/**
 * A turn the chat could not start for credits, told to the header (F193,
 * docs/specs/2026-10-15-chat-credits-and-web-strip.md). The chat panel publishes research-chat's
 * refusal; the header's balance pill shows it, since every credit message lives there (owner
 * 2026-10-15). `retry` replays the refused turn, for a balance that could not be checked.
 */

const BLOCKS = new Set(['credits_exhausted', 'credits_unavailable']);
const listeners = new Set();
let current = null;

/** Sets the refusal, or clears it with null; listeners hear only real changes. */
export function publishCreditNotice(next) {
  const notice = next && BLOCKS.has(next.block)
    ? { block: next.block, held: next.held === true, retry: typeof next.retry === 'function' ? next.retry : null }
    : null;
  const same = notice && current
    ? notice.block === current.block && notice.held === current.held && notice.retry === current.retry
    : notice === current;
  if (same) return;
  current = notice;
  for (const listener of listeners) listener(current);
}

export function creditNotice() {
  return current;
}

export function subscribeCreditNotice(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The refusal in words, or null when there is none or it no longer applies. A positive balance that
 * still refused the turn is held by answers in progress, so buying would not help (F111 review R, M2).
 */
export function refusalMessage(notice, credits) {
  if (!notice?.block) return null;
  const known = credits && Number.isFinite(credits.balance) ? credits : null;
  if (notice.block === 'credits_unavailable') {
    return { key: 'refused-unchecked', tone: 'warn', text: 'AI credits could not be checked, so your answer did not start. Try again in a moment.', retry: Boolean(notice.retry) };
  }
  if (known && known.available > 0) return null;
  if (notice.held === true || Boolean(known && known.balance > 0)) {
    return { key: 'refused-held', tone: 'warn', text: 'Your credits are in use by an answer that is still running. Try again when it finishes.' };
  }
  return { key: 'refused', tone: 'danger', text: 'You have no AI credits left to start an answer. Upgrade your plan, or write to niyantranai@gmail.com for more credits.', buy: true };
}
