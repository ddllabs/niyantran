// B6: keeps Tab inside a dialog that covers the page.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Handles a Tab key inside `container`: from the last control it goes to the first, from the first (with Shift) to
 * the last, and from outside the container into it. Returns true when it moved focus.
 */
export function trapTab(event, container) {
  if (event.key !== 'Tab' || !container?.querySelectorAll) return false;
  const items = [...container.querySelectorAll(FOCUSABLE)];
  if (!items.length) { event.preventDefault?.(); return true; }
  const first = items[0];
  const last = items[items.length - 1];
  const active = container.ownerDocument?.activeElement;
  const inside = items.includes(active);
  if (event.shiftKey && (active === first || !inside)) { event.preventDefault?.(); last.focus(); return true; }
  if (!event.shiftKey && (active === last || !inside)) { event.preventDefault?.(); first.focus(); return true; }
  return false;
}
