/**
 * The viewer chrome's DOM wiring, as small functions over injected elements so they run against
 * fakes in node (docs/specs/2026-10-02-viewer-toolbar.md, "Keyboard" and "Interaction and
 * motion"), like viewerDom.js:
 * - an open menu's keys and its press-outside close;
 * - the tooltips' warm-up, so after the first tooltip the next ones show at once.
 */
import { menuFocus } from './menuModel.js';

const ITEMS = '[role^="menuitem"]:not([disabled])';
const activeElement = () => globalThis.document?.activeElement;

/**
 * Wires an open menu; returns `{dispose}`, which removes every listener it added.
 *
 * Escape is handled by a native listener on the menu node and stopped there. The full view's
 * Escape is a native listener on the dialog, and WorkSurface's Escape closes the whole reader; a
 * React handler would run after both, so it could not keep Escape from closing them too.
 *
 * @param {{menu: Element, trigger: Element, doc: Document | EventTarget,
 *   onClose: (options: {restoreFocus: boolean}) => void, getActive?: () => Element | null}} options
 */
export function createMenuDom({ menu, trigger, doc, onClose, getActive = activeElement }) {
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      onClose({ restoreFocus: true });
      return;
    }
    if (event.key === 'Tab') {
      onClose({ restoreFocus: false });
      return;
    }
    const items = [...menu.querySelectorAll(ITEMS)];
    const next = menuFocus({ key: event.key, index: items.indexOf(getActive()), count: items.length });
    if (next === null) return;
    event.preventDefault();
    items[next].focus();
  };
  const onPointerDown = (event) => {
    const target = event.target;
    if (menu.contains(target) || trigger?.contains(target)) return;
    onClose({ restoreFocus: false });
  };
  menu.addEventListener('keydown', onKeyDown);
  doc.addEventListener('pointerdown', onPointerDown, { capture: true });
  return {
    dispose() {
      menu.removeEventListener('keydown', onKeyDown);
      doc.removeEventListener('pointerdown', onPointerDown, { capture: true });
    },
  };
}

/** How long a pointer rests on a control before its tooltip shows (viewer.css uses the same). */
export const TIP_WARM_MS = 450;
/** How long the chrome stays warm after the pointer leaves it. */
export const TIP_COOL_MS = 400;

/**
 * Marks `root` with `data-tips-warm` once a tooltip has shown, and clears it TIP_COOL_MS after the
 * pointer leaves `root`. While warm, viewer.css shows tooltips at once and without motion. Returns
 * `{dispose}`.
 */
export function createTipWarmth(root, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let warming = null;
  let cooling = null;
  const stopWarming = () => { clearTimer(warming); warming = null; };
  const stopCooling = () => { clearTimer(cooling); cooling = null; };
  const onOver = (event) => {
    if (!event.target?.closest?.('[data-tip]') || 'tipsWarm' in root.dataset) return;
    stopWarming();
    warming = setTimer(() => { warming = null; root.dataset.tipsWarm = ''; }, TIP_WARM_MS);
  };
  const onOut = (event) => { if (event.target?.closest?.('[data-tip]')) stopWarming(); };
  const onEnter = () => stopCooling();
  const onLeave = () => {
    stopWarming();
    stopCooling();
    cooling = setTimer(() => { cooling = null; delete root.dataset.tipsWarm; }, TIP_COOL_MS);
  };
  const listeners = [['pointerover', onOver], ['pointerout', onOut], ['pointerenter', onEnter], ['pointerleave', onLeave]];
  for (const [type, fn] of listeners) root.addEventListener(type, fn);
  return {
    dispose() {
      stopWarming();
      stopCooling();
      for (const [type, fn] of listeners) root.removeEventListener(type, fn);
    },
  };
}
