/**
 * The AI credit balance by the chat box (F111, docs/specs/2026-10-14-ai-credits.md §8).
 *
 * Credits only, never dollars: the rupee hint comes from the rate the server publishes with the
 * balance (my_credits), so no rate is copied here. The balance is read by creditsStore.js; this file
 * only shows it. Three things can replace the quiet balance line:
 *   - a warning, when the balance is at most 10% of the cycle allowance;
 *   - the blocked state, when research-chat refused the turn with 402 credits_exhausted, offering
 *     Upgrade and Buy credits (both open Plan & billing);
 *   - a plain retry message, when it answered 503 credits_unavailable (the turn never started).
 */
import { useEffect, useState } from 'react';
import { formatCredits, lowBalance, refreshCredits, rupeeHint, serverCredits, subscribeCredits } from '../lib/creditsStore.js';

/**
 * Plan & billing is owned by the terminal shell (TerminalShell.jsx holds its open state), and the
 * chat panel is mounted deep inside it. The panel announces the request; the shell opens its own
 * panel. Nothing else listens, so nothing happens outside the shell.
 */
export const OPEN_BILLING_EVENT = 'niy-open-billing';

export function openPlanBilling(plan = null) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPEN_BILLING_EVENT, { detail: { plan } }));
}

/**
 * Read the balance once when a signed-in panel opens, then follow the store until stopped. A failed
 * read changes nothing: the chip keeps what it had, or stays hidden.
 */
export function watchCredits({ refresh = refreshCredits, subscribe = subscribeCredits, onChange }) {
  const stop = subscribe(onChange);
  try { Promise.resolve(refresh()).catch(() => {}); } catch { /* a refresh that throws at once is the same */ }
  return stop;
}

/** The credits read for this verified account, or null (signed out, or not read yet). */
export function useCredits(ownerId) {
  const [credits, setCredits] = useState(() => (ownerId ? serverCredits(ownerId) : null));
  useEffect(() => {
    if (!ownerId) { setCredits(null); return undefined; }
    setCredits(serverCredits(ownerId));
    return watchCredits({ onChange: () => setCredits(serverCredits(ownerId)) });
  }, [ownerId]);
  return ownerId ? credits : null;
}

/** An amount of credits in words: "1,520 credits", "1 credit", "−50 credits". */
export const creditsText = (n) => `${formatCredits(n)} ${Math.abs(n) === 1 ? 'credit' : 'credits'}`;

export default function CreditBalance({ credits, block = '', onOpenBilling = openPlanBilling, onRetry }) {
  const known = credits && Number.isFinite(credits.balance) ? credits : null;
  // A refusal for credits no longer applies once credits are available again.
  const blocked = block === 'credits_exhausted' && !(known && known.available > 0);
  const unchecked = block === 'credits_unavailable';
  if (!known && !blocked && !unchecked) return null;

  const negative = Boolean(known && known.balance < 0);
  const low = Boolean(known) && lowBalance(known);
  const hint = known && !negative ? rupeeHint(known.balance, known.inrPerCredit) : '';
  const state = blocked ? 'blocked' : unchecked ? 'unchecked' : negative ? 'negative' : low ? 'low' : 'ok';
  return (
    <div className="ai-credit" data-state={state}>
      {blocked ? <p className="ai-credit-msg" role="alert">You have no AI credits left to start an answer.</p> : null}
      {unchecked ? <p className="ai-credit-msg" role="alert">AI credits could not be checked right now. Try again in a moment.</p> : null}
      {known ? (
        <p className="ai-credit-line">
          <span className="ai-credit-amount">{creditsText(known.balance)}</span>
          {hint ? <span className="ai-credit-hint">{hint}</span> : null}
          {negative ? <span className="ai-credit-hint">taken from your next credits</span> : null}
        </p>
      ) : null}
      {/* Always present, so a warning that appears after a turn is announced; empty it takes no room. */}
      <p className="ai-credit-warn" role="status">
        {low && !blocked ? `Running low: ${creditsText(known.balance)} left${known.plan === 'free' ? '' : ' this cycle'}` : ''}
      </p>
      {blocked ? (
        <div className="ai-credit-actions">
          <button type="button" onClick={() => onOpenBilling()}>Upgrade</button>
          <button type="button" onClick={() => onOpenBilling()}>Buy credits</button>
        </div>
      ) : null}
      {unchecked && onRetry ? (
        <div className="ai-credit-actions"><button type="button" onClick={() => onRetry()}>Try again</button></div>
      ) : null}
    </div>
  );
}
