import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TABS, bucketContaining, bucketsFor, modulesForTier } from '../desks/catalog.js';
import { featureMenuLabel } from '../lib/national.js';
import { Icon, TAB_ICON } from './Icons.jsx';
import { DeskRailToggle } from './DeskRail.jsx';

/**
 * F203: a menu (240 px) reaches under the next tab, so a diagonal move from a tab to its menu crosses
 * the neighbour. With a menu open, another tab takes over only after the pointer rests on it.
 */
export const SWITCH_DELAY_MS = 160;
export function menuSwitchDelay(openLabel, label) {
  return openLabel && openLabel !== label ? SWITCH_DELAY_MS : 0;
}

/**
 * F203 (owner 2026-10-16): the menu's hover bridge (.drop-menu.portal::before) covers the tab's bottom
 * 8 px, so a pointer resting low on the tab is on the menu; moving back onto the tab is not leaving.
 */
export function leavesToOwnTab(anchor, to) {
  const tab = anchor?.closest?.('.drop');
  return Boolean(tab && to && tab.contains(to));
}

function Menu({ items, active, onPick, anchor, onKeep, onLeave }) {
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    if (!anchor) return undefined;
    // F203: the menu follows its tab when the row scrolls sideways or the window resizes.
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const width = 240;
      const left = Math.min(r.left, window.innerWidth - width - 12);
      setPos({ top: r.bottom + 2, left: Math.max(12, left) });
    };
    place();
    const row = anchor.closest('.desktabs');
    window.addEventListener('resize', place);
    row?.addEventListener('scroll', place, { passive: true });
    return () => {
      window.removeEventListener('resize', place);
      row?.removeEventListener('scroll', place);
    };
  }, [anchor]);
  if (!anchor) return null;
  return createPortal(
    <ul
      className="drop-menu portal"
      role="menu"
      style={{ top: pos.top, left: pos.left }}
      onMouseEnter={onKeep}
      onMouseLeave={(e) => { if (!leavesToOwnTab(anchor, e.relatedTarget)) onLeave(); }}
    >
      {items.map((it) => (
        <li key={it.id}>
          <button type="button" role="menuitem" className={it.id === active ? 'on' : ''} onClick={() => onPick(it)}>
            {it.label}
          </button>
        </li>
      ))}
    </ul>,
    document.body,
  );
}

export default function DeskNav({ tab, featureName, lang, onDesk, onFeature, tabs, desksOpen = false, onOpenDesks }) {
  const [open, setOpen] = useState(null);
  const btnRefs = useRef({});
  const closeTimer = useRef(null);
  const switchTimer = useRef(null);
  const hi = lang === 'hi';
  const homeTabs = tabs || TABS;
  const active = homeTabs.find((t) => t.id === tab) || TABS.find((t) => t.id === tab) || TABS[0];
  const buckets = tab === 'home' ? [] : bucketsFor(modulesForTier(active.tier), active.tier);
  const currentBucket = bucketContaining(buckets, featureName);

  useEffect(() => {
    setOpen(null);
  }, [tab]);

  useEffect(() => {
    function onDoc(e) {
      if (e.target.closest('.desktabs') || e.target.closest('.drop-menu')) return;
      setOpen(null);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(null);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      clearTimeout(closeTimer.current);
      clearTimeout(switchTimer.current);
    };
  }, []);

  function showMenu(label) {
    clearTimeout(closeTimer.current);
    setOpen(label);
  }

  function enterMenu(label) {
    clearTimeout(switchTimer.current);
    const wait = menuSwitchDelay(open, label);
    if (!wait) { showMenu(label); return; }
    // The open menu stays while the pointer only passes over this tab.
    clearTimeout(closeTimer.current);
    switchTimer.current = setTimeout(() => showMenu(label), wait);
  }

  function hideMenuSoon() {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(null), 180);
  }

  function labelOf(t) {
    if (hi) return t.labelHi;
    return t.label.charAt(0) + t.label.slice(1).toLowerCase();
  }

  return (
    <nav aria-label={hi ? 'डेस्क के मॉड्यूल' : 'Desk modules'} className={`desktabs${tab === 'home' ? ' home-nav' : ''}`}>
      {/* F195: the desk rail's toggle starts the row, above the rail's column (a drawer on phones). */}
      {onOpenDesks ? <DeskRailToggle open={desksOpen} onToggle={onOpenDesks} lang={lang} /> : null}
      {tab !== 'home' && (
        <button
          type="button"
          className="desk-current"
          onClick={() => {
            onDesk(tab);
            setOpen(null);
          }}
        >
          <Icon name={TAB_ICON[tab] || 'globe'} size={14} />
          {labelOf(active)}
          <i className="live-dot" />
        </button>
      )}

      {buckets.map((b) => {
        const isOn = currentBucket?.label === b.label;
        const isOpen = open === b.label;
        return (
          <div
            key={b.label}
            className="drop"
            onMouseEnter={() => enterMenu(b.label)}
            onMouseMove={() => { if (open === b.label) clearTimeout(closeTimer.current); }}
            onMouseLeave={() => { clearTimeout(switchTimer.current); hideMenuSoon(); }}
          >
            <button
              type="button"
              className={isOn ? 'on' : ''}
              aria-expanded={isOpen}
              aria-haspopup="menu"
              title={b.label}
              ref={(el) => {
                btnRefs.current[b.label] = el;
              }}
              onClick={() => showMenu(b.label)}
            >
              <span className="desk-pill-label">{b.label}</span>
              <Icon name="chevron" size={12} />
            </button>
            {isOpen && (
              <Menu
                anchor={btnRefs.current[b.label]}
                active={featureName}
                onKeep={() => showMenu(b.label)}
                onLeave={hideMenuSoon}
                items={b.items.map((m) => ({ id: m.htmlFeature, label: featureMenuLabel(m), tier: m.htmlTier }))}
                onPick={(it) => {
                  onFeature(it.id);
                  setOpen(null);
                }}
              />
            )}
          </div>
        );
      })}

    </nav>
  );
}
