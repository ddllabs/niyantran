/**
 * The desk rail on module pages (F195, docs/specs/2026-10-15-desk-left-rail.md). Collapsed it is a
 * column of desk icons; its toggle widens it over the page with the names. At 900 px and below it is
 * a drawer, opened from the Desks button in the category row (DeskNav). It closes on Escape (which
 * hands focus back to whatever opened it), a press outside or on the scrim, focus leaving it, the
 * toggle, or picking a desk. The shell also closes it on any change of page.
 */
import { useEffect, useRef } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Icon, TAB_ICON } from './Icons.jsx';
import './deskRail.css';

export function RailList({ tab, lang, tabs, lockedIds, onPick }) {
  const locked = lockedIds instanceof Set ? lockedIds : new Set(lockedIds || []);
  return (
    <ul id="desk-rail-list">
      {tabs.map((desk) => {
        const name = lang === 'hi' ? desk.labelHi : desk.label;
        const isLocked = locked.has(desk.id);
        return (
          <li key={desk.id}>
            <button type="button" aria-current={desk.id === tab ? 'page' : undefined} className={isLocked ? 'desk-locked' : undefined}
              title={isLocked ? `${desk.label} · Upgrade` : desk.label} onClick={() => onPick(desk.id)}>
              <Icon name={TAB_ICON[desk.id] || 'globe'} size={18} />
              <span className="desk-rail-name">{name}</span>
              {isLocked ? <small>Upgrade</small> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default function DeskRail({ tab, lang, tabs, lockedIds, onDesk, open = false, onOpenChange }) {
  const nav = useRef(null);
  const opener = useRef(null);
  const hi = lang === 'hi';
  const label = open ? (hi ? 'डेस्क सूची छोटी करें' : 'Collapse the desk list') : (hi ? 'डेस्क सूची बड़ी करें' : 'Expand the desk list');

  useEffect(() => {
    if (!open) return undefined;
    const doc = nav.current?.ownerDocument;
    if (!doc) return undefined;
    // Whatever opened it (the toggle, or the Desks button on a phone) gets focus back on Escape.
    opener.current = doc.activeElement;
    (nav.current.querySelector('[aria-current="page"]') || nav.current.querySelector('li button'))?.focus({ preventScroll: true });
    const close = (refocus) => {
      onOpenChange(false);
      if (refocus) opener.current?.focus?.({ preventScroll: true });
    };
    // A dialog opened over the rail (search, an upgrade) owns its Escape and its focus.
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || doc.querySelector('dialog[open], [aria-modal="true"]')) return;
      close(true);
    };
    // The scrim closes from its own click, so a tap on it does not reach the page under it.
    const onDown = (e) => {
      if (nav.current?.contains(e.target) || e.target?.closest?.('.desktabs-desks, .desk-rail-scrim')) return;
      close(false);
    };
    // Focus moving to the Desks button is that button's own toggle, not a leave.
    const onFocusOut = (e) => { const to = e.relatedTarget; if (to && !nav.current?.contains(to) && !to.closest?.('.desktabs-desks')) close(false); };
    const root = nav.current;
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('mousedown', onDown);
    root.addEventListener('focusout', onFocusOut);
    return () => {
      doc.removeEventListener('keydown', onKey);
      doc.removeEventListener('mousedown', onDown);
      root.removeEventListener('focusout', onFocusOut);
    };
  }, [open, onOpenChange]);

  return (
    <>
      <nav ref={nav} className={`desk-rail${open ? ' open' : ''}`} id="desk-rail" aria-label={hi ? 'डेस्क' : 'Desks'}>
        <button type="button" className="desk-rail-toggle" aria-expanded={open} aria-controls="desk-rail-list" aria-label={label} title={label}
          onClick={() => onOpenChange(!open)}>
          {open ? <PanelLeftClose size={18} aria-hidden="true" /> : <PanelLeftOpen size={18} aria-hidden="true" />}
        </button>
        <RailList tab={tab} lang={lang} tabs={tabs} lockedIds={lockedIds} onPick={(id) => { onOpenChange(false); onDesk(id); }} />
      </nav>
      {open ? <div className="desk-rail-scrim" aria-hidden="true" onClick={() => onOpenChange(false)} /> : null}
    </>
  );
}
