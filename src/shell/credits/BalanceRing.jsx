/**
 * The balance ring (F184 spec §2, §4): the share of this period's credits left, coloured by the same
 * states as the chat (lowBalance(): amber; none left or overdrawn: red; unreadable: a dash). Shared by
 * the header pill, the credits page and the chat's balance line, so it stays small.
 */
import { lowBalance } from '../../lib/creditsStore.js';
import { periodBar } from '../../lib/creditsVisual.js';
import './creditsPage.css';

/** ok | low | empty | unchecked | loading, for the ring's colour and the pill's words. */
export function balanceState(credits, failed = false) {
  if (!credits) return failed ? 'unchecked' : 'loading';
  if (credits.balance - (credits.held || 0) <= 0) return 'empty';
  return lowBalance(credits) ? 'low' : 'ok';
}

export function BalanceRing({ credits, failed = false, size = 20 }) {
  const state = balanceState(credits, failed);
  const bar = credits ? periodBar(credits) : null;
  const share = bar && bar.total > 0 ? Math.min(1, bar.left / bar.total) : state === 'ok' || state === 'low' ? 1 : 0;
  const r = 14;
  const c = 2 * Math.PI * r;
  return (
    <svg className={`cp-ring cp-ring-${state}`} width={size} height={size} viewBox="0 0 36 36" aria-hidden="true" focusable="false">
      <circle className="cp-ring-track" cx="18" cy="18" r={r} />
      {state === 'unchecked' || state === 'loading'
        ? <line className="cp-ring-dash" x1="11" x2="25" y1="18" y2="18" />
        : <circle className="cp-ring-fill" cx="18" cy="18" r={r} strokeDasharray={`${(share * c).toFixed(2)} ${c.toFixed(2)}`} transform="rotate(-90 18 18)" />}
    </svg>
  );
}
