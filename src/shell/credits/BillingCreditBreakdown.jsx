import { creditsText } from '../../lib/creditsStore.js';
import { byExpiry, dayOrNull, lotLabel } from '../CreditLots.jsx';

// Presentation only: preserve the original lots and never combine different expiry instants.
export default function BillingCreditBreakdown({ lots = [] }) {
  const groups = new Map();
  for (const lot of byExpiry(lots)) {
    const key = JSON.stringify([lot.kind, lot.expiresAt ?? null]);
    const group = groups.get(key) || { ...lot, remaining: 0, parts: [] };
    group.remaining += lot.remaining;
    group.parts.push(lot.remaining);
    groups.set(key, group);
  }
  if (!groups.size) return <p className="billing-empty">You have no credits right now.</p>;
  return <div className="billing-credit-table-wrap"><table className="billing-credit-table">
    <caption className="billing-sr-only">Available credits by type and expiry</caption>
    <thead><tr><th scope="col">Type</th><th scope="col" className="billing-number">Available</th><th scope="col">Expires</th></tr></thead>
    <tbody>{[...groups].map(([key, lot]) => <tr key={key}>
      <th scope="row">{lot.parts.length > 1 ? <details className="billing-credit-sources"><summary>{lotLabel(lot.kind)}</summary><ul aria-label={`${lotLabel(lot.kind)} credit grants`}>{lot.parts.map((amount, i) => <li key={i}>Grant {i + 1}: {creditsText(amount)}</li>)}</ul></details> : lotLabel(lot.kind)}</th>
      <td className="billing-number">{creditsText(lot.remaining)}</td>
      <td>{dayOrNull(lot.expiresAt) ? <time dateTime={lot.expiresAt}>{dayOrNull(lot.expiresAt)}</time> : 'No expiry'}</td>
    </tr>)}</tbody>
  </table></div>;
}
