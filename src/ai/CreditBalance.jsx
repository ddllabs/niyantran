/**
 * Opening Plan and invoices from the chat (F111, F184). The balance and every credit message live at
 * the header's balance pill (F193, owner 2026-10-15), so the chat box carries no credit line; the
 * chat's refusal reaches the pill through chatCreditNotice.js.
 */

/**
 * Plan and invoices is a section of the credits page (F184), which the terminal shell owns; the chat
 * panel is mounted deep inside it. The panel announces the request; the shell opens the section with
 * the plan. Nothing else listens, so nothing happens outside the shell.
 */
export const OPEN_BILLING_EVENT = 'niy-open-billing';

export function openPlanBilling(plan = null) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPEN_BILLING_EVENT, { detail: { plan } }));
}
