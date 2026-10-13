// The admin's credit adjustment (F111, docs/specs/2026-10-14-ai-credits.md
// section 9): the form's checks, and the request to POST /api/users/:id/credits.
// Credits only: no dollars and no rupees appear here.
import { hydrateUsersFromServer, verifiedLocalIdentity } from '../lib/userStore.js';

/** The three actions an admin can take, in the order the form lists them. */
export const CREDIT_ACTIONS = [
  { id: 'add', label: 'Add credits' },
  { id: 'remove', label: 'Remove credits' },
  { id: 'topup', label: 'Grant top-up' },
];

// The same limits the server enforces; it stays the authority.
const MAX_AMOUNT = 1_000_000;
const MAX_REASON = 500;
const AMOUNT = /^\d+(\.\d{1,4})?$/;
const SHOWN = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 4 });

/** A balance as the admin reads it: exact up to four decimals; a dash when unknown. */
export function formatBalance(value) {
  const n = Number(value);
  return value === null || value === undefined || !Number.isFinite(n) ? '—' : SHOWN.format(n);
}

/** A fresh id for one adjustment. The same id is reused for its retries. */
export function newRequestId() {
  return globalThis.crypto.randomUUID();
}

/**
 * The form's { kind, amount, reason } as the server's { credits, kind, reason },
 * or { ok: false, reason } with a plain message. The admin types a plain
 * amount; the action decides whether it is added or removed.
 */
export function creditRequest(draft) {
  const action = CREDIT_ACTIONS.find((a) => a.id === draft?.kind);
  if (!action) return { ok: false, reason: 'Choose an action.' };
  const text = String(draft.amount ?? '').trim();
  if (!text) return { ok: false, reason: 'Enter the amount of credits.' };
  if (text.startsWith('-')) return { ok: false, reason: 'Enter the amount without a minus sign; the action decides whether it is added or removed.' };
  if (!AMOUNT.test(text)) {
    return { ok: false, reason: /^\d+\.\d{5,}$/.test(text) ? 'Credits can have at most four decimals.' : 'Enter the amount as a plain number, such as 250 or 12.5.' };
  }
  const amount = Number(text);
  if (amount === 0) return { ok: false, reason: 'The amount must be above zero.' };
  if (amount > MAX_AMOUNT) return { ok: false, reason: 'The amount can be at most 1,000,000 credits.' };
  const reason = String(draft.reason ?? '').trim();
  if (!reason) return { ok: false, reason: 'Give a reason; it is kept with the adjustment.' };
  if (reason.length > MAX_REASON) return { ok: false, reason: `The reason can be at most ${MAX_REASON} characters.` };
  return {
    ok: true,
    credits: action.id === 'remove' ? -amount : amount,
    kind: action.id === 'topup' ? 'topup' : 'adjustment',
    reason,
  };
}

/**
 * Apply one checked request ({ credits, kind, reason }) to a user, as the
 * verified admin. `requestId` identifies the adjustment, not the click: a retry
 * with the same id applies once. Resolves to { ok, balance?, repeated?, reason? }.
 */
export async function adjustUserCredits(id, request, requestId) {
  try {
    const identity = await verifiedLocalIdentity({ admin: true });
    if (!identity) return { ok: false, reason: 'Sign in again as an admin to change credits.' };
    const res = await fetch(`/api/users/${encodeURIComponent(id)}/credits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identity.token}` },
      body: JSON.stringify({ ...request, requestId }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      return { ok: false, reason: typeof body?.error === 'string' && body.error ? body.error : 'The adjustment was not applied. Try again.' };
    }
    // The credits are already applied; a failed refresh must not read as a failure.
    await hydrateUsersFromServer().catch(() => []);
    return { ok: true, repeated: body.repeated === true, balance: body.balance };
  } catch {
    return { ok: false, reason: 'The adjustment could not be sent. Check the connection and try again; the same request will not apply twice.' };
  }
}
