/**
 * The viewer chrome's menu button (docs/specs/2026-10-02-viewer-toolbar.md, "Keyboard"), after the
 * WAI-ARIA menu button pattern. The open state is local, so opening a menu never re-renders the
 * page. Keys inside the open menu, and a press outside it, are wired by `createMenuDom` with
 * native listeners that exist only while the menu is open.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, ICON_PROPS } from './icons.js';
import { createMenuDom } from './menuDom.js';
import { openFocus } from './menuModel.js';

/**
 * @typedef {{id: string, separator: true}
 *   | {id: string, label: string, onSelect: () => void, icon?: import('react').ComponentType<object>,
 *      checked?: boolean, keepOpen?: boolean, describedBy?: string}} MenuItem
 *   `checked` makes the item a `menuitemradio`; `keepOpen` keeps the menu open after it is chosen;
 *   `describedBy` names the text it acts on (assistive technology skips a menu's non-item text).
 */

/**
 * The open menu's markup.
 * @param {{id: string, label: string, items: MenuItem[], side?: 'below' | 'above',
 *   align?: 'start' | 'end', footer?: import('react').ReactNode, onChoose: (item: MenuItem) => void,
 *   ref?: import('react').Ref<HTMLDivElement>}} props
 */
export function MenuPopup({ id, label, items, side = 'below', align = 'end', footer = null, onChoose, ref }) {
  return (
    <div id={id} ref={ref} className="pv-menu" role="menu" aria-label={label} data-side={side} data-align={align}>
      {items.map((item) => {
        if (item.separator) return <div key={item.id} role="separator" className="pv-menu-sep" />;
        const radio = typeof item.checked === 'boolean';
        const Mark = radio ? (item.checked ? Check : null) : item.icon;
        return (
          <button
            key={item.id}
            type="button"
            tabIndex={-1}
            className="pv-menu-item"
            role={radio ? 'menuitemradio' : 'menuitem'}
            aria-describedby={item.describedBy}
            aria-checked={radio ? item.checked : undefined}
            onClick={() => onChoose(item)}
          >
            <span className="pv-menu-mark">{Mark ? <Mark {...ICON_PROPS} /> : null}</span>
            <span>{item.label}</span>
          </button>
        );
      })}
      {footer ? <div className="pv-menu-foot">{footer}</div> : null}
    </div>
  );
}

/**
 * A trigger and its menu. `renderTrigger` receives the props the trigger must carry (its ref,
 * ARIA state and handlers), so the trigger can be an icon button or a text button.
 *
 * @param {{label: string, items: MenuItem[], side?: 'below' | 'above', align?: 'start' | 'end',
 *   footer?: import('react').ReactNode, onClose?: () => void,
 *   renderTrigger: (props: object) => import('react').ReactNode}} props
 */
export default function Menu({ label, items, side = 'below', align = 'end', footer = null, onClose, renderTrigger }) {
  const [open, setOpen] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const id = useId();
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const close = useCallback(({ restoreFocus }) => {
    setOpen(null);
    onCloseRef.current?.();
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu) return undefined;
    const choices = menu.querySelectorAll('[role^="menuitem"]');
    (open === 'last' ? choices[choices.length - 1] : choices[0])?.focus();
    const wiring = createMenuDom({ menu, trigger: triggerRef.current, doc: menu.ownerDocument, onClose: close });
    return () => wiring.dispose();
  }, [open, close]);

  const onChoose = (item) => {
    item.onSelect();
    if (!item.keepOpen) close({ restoreFocus: true });
  };

  const trigger = renderTrigger({
    ref: triggerRef,
    'aria-haspopup': 'menu',
    'aria-expanded': Boolean(open),
    'aria-controls': open ? id : undefined,
    onClick: () => (open ? close({ restoreFocus: false }) : setOpen('first')),
    onKeyDown: (event) => {
      if (open) return;
      const at = openFocus(event.key);
      if (!at) return;
      event.preventDefault();
      setOpen(at);
    },
  });

  return (
    <div className="pv-menu-wrap">
      {trigger}
      {open ? <MenuPopup id={id} ref={menuRef} label={label} items={items} side={side} align={align} footer={footer} onChoose={onChoose} /> : null}
    </div>
  );
}
