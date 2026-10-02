/**
 * The viewer menus' keyboard decisions (docs/specs/2026-10-02-viewer-toolbar.md, "Keyboard"),
 * after the WAI-ARIA menu button pattern. Pure, so they are tested without a DOM.
 */

/**
 * The item index a key moves focus to, or null to leave the key alone. `index` is -1 when no
 * item has focus. Up and Down wrap; Home and End jump.
 */
export function menuFocus({ key, index, count }) {
  if (!Number.isSafeInteger(count) || count < 1) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return index < 0 ? 0 : (index + 1) % count;
  if (key === 'ArrowUp') return index < 0 ? count - 1 : (index - 1 + count) % count;
  return null;
}

/** Which item a key on the closed trigger opens the menu on, or null when it does not open it. */
export function openFocus(key) {
  if (key === 'Enter' || key === ' ' || key === 'ArrowDown') return 'first';
  if (key === 'ArrowUp') return 'last';
  return null;
}
