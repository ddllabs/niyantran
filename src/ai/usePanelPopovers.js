import { useEffect, useRef } from 'react';
import { createMenuDom } from './page-viewer/menuDom.js';

// History is a non-modal dialog. Tab may leave it, but must dismiss the
// dimming first; Escape and selecting a conversation restore the trigger.
export function wireHistoryPopover({ dialog, trigger, doc, close }) {
  const buttons = () => [...dialog.querySelectorAll('button:not([disabled])')];
  (buttons()[0] || dialog).focus();
  const keydown = event => {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); close(); trigger?.focus();
    } else if (event.key === 'Tab') {
      const items = buttons();
      if (!items.length || (event.shiftKey && doc.activeElement === items[0])) {
        event.preventDefault(); close(); trigger?.focus();
      } else if (!event.shiftKey && doc.activeElement === items.at(-1)) {
        close(); trigger?.focus();
      }
    }
  };
  dialog.addEventListener('keydown', keydown);
  return () => {
    dialog.removeEventListener('keydown', keydown);
    if (dialog.contains(doc.activeElement) || doc.activeElement === doc.body) trigger?.focus();
  };
}

/**
 * F200: Escape closes the open popover first, wherever focus is. Each popover stops the Escape
 * pressed inside it; one pressed elsewhere (focus left on the page, as a click on a button leaves
 * it in Safari, or in the composer) reached the panel's own Escape (F135) and closed the whole
 * panel with the menu still open. This listener runs before the panel's (document, capture) and
 * takes that Escape for the popover; the next Escape is the panel's again. `layers` are the open
 * popovers, topmost first: `{ root, close }`.
 */
export function wirePopoverEscape({ doc, layers }) {
  const keydown = (event) => {
    if (event.key !== 'Escape') return;
    const layer = layers.find((l) => l?.root);
    // Focus inside the popover: its own listener handles the key (and restores its trigger).
    if (!layer || layer.root.contains(doc.activeElement)) return;
    event.preventDefault();
    event.stopPropagation();
    layer.close();
    // Focus on nothing goes back to the trigger; focus in the composer stays where the reader left it.
    if (!doc.activeElement || doc.activeElement === doc.body) layer.root.querySelector('button')?.focus();
  };
  doc.addEventListener('keydown', keydown, true);
  return () => doc.removeEventListener('keydown', keydown, true);
}

export default function usePanelPopovers({ focusOpen, focusRef, focus, setFocusOpen,
  historyOpen, historyRef, pendingDelete, setHistoryOpen, modelOpen, modelRef, setModelOpen }) {
  const previousDelete = useRef('');
  useEffect(() => {
    if (!focusOpen) return undefined;
    const root = focusRef.current;
    const menu = root?.querySelector('[role="menu"]');
    const trigger = root?.querySelector('button');
    if (!menu) return undefined;
    (menu.querySelector('[aria-checked="true"]') || menu.querySelector('button'))?.focus();
    const wiring = createMenuDom({ menu, trigger, doc: document, onClose: ({ restoreFocus }) => {
      setFocusOpen(false);
      if (restoreFocus) trigger?.focus();
    } });
    return () => wiring.dispose();
  }, [focusOpen, focusRef, focus, setFocusOpen]);
  useEffect(() => {
    if (!historyOpen) return undefined;
    const root = historyRef.current;
    const dialog = root?.querySelector('[role="dialog"]');
    if (!dialog) return undefined;
    return wireHistoryPopover({ dialog, trigger: root.querySelector('button'), doc: document,
      close: () => setHistoryOpen(false) });
  }, [historyOpen, historyRef, setHistoryOpen]);
  useEffect(() => {
    const previous = previousDelete.current;
    previousDelete.current = pendingDelete;
    if (!historyOpen || (!pendingDelete && !previous)) return;
    const dialog = historyRef.current?.querySelector('[role="dialog"]');
    const row = [...(dialog?.querySelectorAll('[data-chat-id]') || [])]
      .find(el => el.dataset.chatId === (pendingDelete || previous));
    const target = pendingDelete ? row?.querySelector('button:not(.danger)')
      : row?.querySelector('.ai-v2-history-del');
    (target || dialog?.querySelector('button:not([disabled])') || dialog)?.focus();
  }, [pendingDelete, historyOpen, historyRef]);
  useEffect(() => {
    if (!modelOpen) return undefined;
    const root = modelRef.current;
    const keydown = event => {
      if (event.key !== 'Escape') return;
      // Native ancestor handling precedes the shell's document Escape listener.
      event.preventDefault(); event.stopPropagation(); setModelOpen(false);
      root.querySelector('button')?.focus();
    };
    root?.addEventListener('keydown', keydown);
    return () => root?.removeEventListener('keydown', keydown);
  }, [modelOpen, modelRef, setModelOpen]);
  useEffect(() => {
    if (!historyOpen && !focusOpen && !modelOpen) return undefined;
    return wirePopoverEscape({ doc: document, layers: [
      historyOpen && { root: historyRef.current, close: () => setHistoryOpen(false) },
      focusOpen && { root: focusRef.current, close: () => setFocusOpen(false) },
      modelOpen && { root: modelRef.current, close: () => setModelOpen(false) },
    ] });
  }, [historyOpen, historyRef, setHistoryOpen, focusOpen, focusRef, setFocusOpen, modelOpen, modelRef, setModelOpen]);
}
