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

const C = 20;
const R = 16;

/** The arc for a share of the ring, clockwise from the top; drawn as a path, so no transform is needed. */
export function ringArc(share) {
  const t = Math.max(0, Math.min(1, share));
  if (t <= 0) return null;
  if (t >= 0.999) return `M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C - 0.01} ${C - R}`;
  const a = 2 * Math.PI * t;
  const x = (C + R * Math.sin(a)).toFixed(2);
  const y = (C - R * Math.cos(a)).toFixed(2);
  return `M ${C} ${C - R} A ${R} ${R} 0 ${t > 0.5 ? 1 : 0} 1 ${x} ${y}`;
}

/** The ring; from 36 px up it carries a small credit spark in the middle (the balance card, the popover). */
export function BalanceRing({ credits, failed = false, size = 20 }) {
  const state = balanceState(credits, failed);
  const bar = credits ? periodBar(credits) : null;
  const share = bar && bar.total > 0 ? Math.min(1, bar.left / bar.total) : state === 'ok' || state === 'low' ? 1 : 0;
  const arc = state === 'unchecked' || state === 'loading' ? null : ringArc(share);
  return (
    <svg className={`cp-ring cp-ring-${state}${size >= 36 ? ' cp-ring-large' : ''}`} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <circle className="cp-ring-track" cx={C} cy={C} r={R} />
      {arc ? <path className="cp-ring-fill" d={arc} /> : null}
      {state === 'unchecked' || state === 'loading' ? <line className="cp-ring-dash" x1="14" x2="26" y1={C} y2={C} /> : null}
      {size >= 36 && arc ? <path className="cp-ring-spark" d="M20 12.5l1.9 5.6 5.6 1.9-5.6 1.9-1.9 5.6-1.9-5.6-5.6-1.9 5.6-1.9z" /> : null}
    </svg>
  );
}
