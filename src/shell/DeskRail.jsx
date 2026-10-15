/**
 * The desk rail on module pages (F195, docs/specs/2026-10-15-desk-left-rail.md). Collapsed it is a
 * column of desk icons; the toggle at the start of the category row (DeskRailToggle, in DeskNav) slides
 * it open over the page with the names. At 900 px and below it is a drawer. It closes on Escape (which
 * hands focus back to whatever opened it), a press outside or on the scrim, focus leaving it, the
 * toggle, or picking a desk. The shell also closes it on any change of page.
 */
import { useEffect, useRef } from 'react';
import { Icon, TAB_ICON } from './Icons.jsx';
import './deskRail.css';

/** Three lines that become a cross when the rail is open (F195 follow-up, owner 2026-10-15). */
export function DeskRailToggle({ open, onToggle, lang = 'en' }) {
  const hi = lang === 'hi';
  const label = open ? (hi ? 'डेस्क छिपाएँ' : 'Hide desks') : (hi ? 'डेस्क दिखाएँ' : 'Show desks');
  return (
    <button type="button" className="desk-rail-toggle" aria-expanded={open} aria-controls="desk-rail" aria-label={label} title={label} onClick={() => onToggle()}>
      <svg className="desk-rail-glyph" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <line className="desk-rail-glyph-top" x1="5" x2="19" y1="7" y2="7" />
        <line className="desk-rail-glyph-middle" x1="5" x2="19" y1="12" y2="12" />
        <line className="desk-rail-glyph-bottom" x1="5" x2="19" y1="17" y2="17" />
      </svg>
    </button>
  );
}

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
              <span className="desk-rail-icon"><Icon name={TAB_ICON[desk.id] || 'globe'} size={18} /></span>
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

  useEffect(() => {
    if (!open) return undefined;
    const doc = nav.current?.ownerDocument;
    if (!doc) return undefined;
    // Whatever opened it (the toggle, as a rule) gets focus back on Escape.
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
      if (nav.current?.contains(e.target) || e.target?.closest?.('.desk-rail-toggle, .desk-rail-scrim')) return;
      close(false);
    };
    // Focus moving to the toggle is the toggle's own business (its click closes the rail), not a leave.
    const onFocusOut = (e) => { const to = e.relatedTarget; if (to && !nav.current?.contains(to) && !to.closest?.('.desk-rail-toggle')) close(false); };
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
        <RailList tab={tab} lang={lang} tabs={tabs} lockedIds={lockedIds} onPick={(id) => { onOpenChange(false); onDesk(id); }} />
      </nav>
      {open ? <div className="desk-rail-scrim" aria-hidden="true" onClick={() => onOpenChange(false)} /> : null}
    </>
  );
}
