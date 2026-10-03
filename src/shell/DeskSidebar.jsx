import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TABS } from '../desks/catalog.js';
import { Icon, TAB_ICON } from './Icons.jsx';

export default function DeskSidebar({ tab, lang, onDesk, onClose, tabs, lockedIds }) {
  const rootRef = useRef(null);
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const hi = lang === 'hi';
  const list = tabs || TABS;
  const locked = lockedIds instanceof Set ? lockedIds : new Set(lockedIds || []);

  useEffect(() => {
    const opener = document.activeElement;
    const dialog = dialogRef.current;
    const buttons = () => [...(dialog?.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]') || [])];
    const focusFirst = () => (buttons()[0] || dialog)?.focus();
    const background = [...document.body.children]
      .filter((el) => el !== rootRef.current && !el.contains(rootRef.current))
      .map((el) => ({ el, inert: el.inert }));
    background.forEach(({ el }) => { el.inert = true; });
    focusFirst();
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === 'Tab') {
        const items = buttons();
        const first = items[0], last = items[items.length - 1];
        if (!first || !dialog?.contains(document.activeElement) || (!e.shiftKey && document.activeElement === last)) {
          e.preventDefault(); focusFirst();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus();
        }
      }
    }
    function onFocus(e) {
      if (!dialog?.contains(e.target)) focusFirst();
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus);
      background.forEach(({ el, inert }) => { el.inert = inert; });
      document.body.style.overflow = prev;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  function labelOf(t) {
    if (hi) return t.labelHi;
    return t.label.charAt(0) + t.label.slice(1).toLowerCase();
  }

  function pick(id) {
    onDesk(id);
    onClose();
  }

  return createPortal(
    <div ref={rootRef} className="desk-side-root" role="presentation">
      <button type="button" className="desk-side-scrim" tabIndex={-1} aria-label={hi ? 'बंद करें' : 'Close menu'} onClick={onClose} />
      <aside ref={dialogRef} tabIndex={-1} className="desk-side" role="dialog" aria-modal="true" aria-labelledby="desk-side-title">
        <header className="desk-side-head">
          <div className="desk-side-brand">
            <img src="/brand/logo.png?v=2" alt="" />
            <div>
              <b>TERMINAL</b>
              <h2 id="desk-side-title">{hi ? 'डेस्क' : 'Desks'}</h2>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={hi ? 'बंद करें' : 'Close'}>
            <Icon name="close" />
          </button>
        </header>
        <nav className="desk-side-nav">
          {list.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`${t.id === tab ? 'on' : ''}${locked.has(t.id) ? ' desk-locked' : ''}`}
              onClick={() => pick(t.id)}
            >
              <Icon name={TAB_ICON[t.id] || 'globe'} size={16} />
              <span>{labelOf(t)}</span>
              {locked.has(t.id) ? <em className="desk-up-tag">Upgrade</em> : null}
            </button>
          ))}
        </nav>
      </aside>
    </div>,
    document.body,
  );
}
