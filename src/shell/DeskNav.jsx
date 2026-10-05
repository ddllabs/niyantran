import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TABS, bucketContaining, bucketsFor, modulesForTier } from '../desks/catalog.js';
import { featureMenuLabel } from '../lib/national.js';
import { Icon, TAB_ICON } from './Icons.jsx';

function Menu({ items, active, onPick, anchor, onKeep, onLeave }) {
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const width = 240;
    const left = Math.min(r.left, window.innerWidth - width - 12);
    setPos({ top: r.bottom + 2, left: Math.max(12, left) });
  }, [anchor]);
  if (!anchor) return null;
  return createPortal(
    <ul
      className="drop-menu portal"
      role="menu"
      style={{ top: pos.top, left: pos.left }}
      onMouseEnter={onKeep}
      onMouseLeave={onLeave}
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

export default function DeskNav({ tab, featureName, lang, onDesk, onFeature, tabs }) {
  const [open, setOpen] = useState(null);
  const btnRefs = useRef({});
  const closeTimer = useRef(null);
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
    };
  }, []);

  function showMenu(label) {
    clearTimeout(closeTimer.current);
    setOpen(label);
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

      {tab === 'home' && <span className="desk-current">{hi ? 'अपना डेस्क चुनें' : 'Choose a desk to begin'}</span>}
      {buckets.map((b) => {
        const isOn = currentBucket?.label === b.label;
        const isOpen = open === b.label;
        return (
          <div
            key={b.label}
            className="drop"
            onMouseEnter={() => showMenu(b.label)}
            onMouseLeave={hideMenuSoon}
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
