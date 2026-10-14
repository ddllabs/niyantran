/**
 * Credits by expiry (F111 §8; F153 section D): the open lots, earliest expiry first, with kind,
 * remaining credits and expiry. Shared by Plan & billing and the Credits usage page. Hook-free.
 */
import { creditsText } from '../lib/creditsStore.js';

function day(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A date for display, or null when the server sent none or something unreadable. */
export function dayOrNull(iso) {
  return iso && !Number.isNaN(Date.parse(iso)) ? day(iso) : null;
}

const LOT_KINDS = {
  monthly: 'Monthly',
  rollover: 'Rolled over',
  signup: 'Sign-up',
  topup: 'Top-up',
  adjustment: 'Adjustment',
};

export function lotLabel(kind) {
  const known = LOT_KINDS[kind];
  if (known) return known;
  const text = String(kind || 'Other').replace(/[_-]+/g, ' ');
  return text[0].toUpperCase() + text.slice(1);
}

/** Earliest expiry first; a lot with no expiry goes last. */
export function byExpiry(lots) {
  const at = (l) => (dayOrNull(l.expiresAt) ? Date.parse(l.expiresAt) : Infinity);
  return [...lots].sort((a, b) => at(a) - at(b));
}

export default function CreditLots({ lots }) {
  const sorted = byExpiry(lots || []);
  if (!sorted.length) return <p className="plan-up-note">You have no credits right now.</p>;
  return (
    <ul className="plan-credits-lots">
      {sorted.map((l, i) => (
        <li key={`${l.kind}-${l.expiresAt}-${i}`} className="plan-credits-lot">
          <span className="plan-credits-kind">{lotLabel(l.kind)}</span>
          <span className="plan-credits-num">{creditsText(l.remaining)}</span>
          <span className="plan-credits-when">{dayOrNull(l.expiresAt) ? `Expires ${dayOrNull(l.expiresAt)}` : 'No expiry'}</span>
        </li>
      ))}
    </ul>
  );
}
