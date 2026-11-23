// Small building blocks shared by every screen, in the prototype's markup and classes.
import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { useApp } from '../state/app.jsx';
import { BLADE_HUES } from '../data/quickExit.js';
import { irisGeom } from './iris.js';
import { asset } from '../lib/asset.js';

export function Header({ title, sub, back, onBack, left, right, line }) {
  const app = useApp();
  return (
    <div className={`hdr${line ? ' line' : ''}`}>
      {back ? <button type="button" className="ib" onClick={onBack || app.pop} aria-label="Back"><Icon name="back" /></button> : left}
      <div className="t">{title}{sub ? <small>{sub}</small> : null}</div>
      {right}
    </div>
  );
}

const TABS = [['home', 'Home', 'home'], ['ask', 'Ask AI', 'sparkle'], ['library', 'Library', 'library'], ['me', 'Me', 'user']];
export function TabBar() {
  const { tab, setTab } = useApp();
  return (
    <nav className="tabbar" aria-label="Sections">
      {TABS.map(([id, label, icon]) => (
        <button key={id} type="button" className={tab === id ? 'on' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
          <Icon name={icon} /><span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

// A cover image as a background (the prototype's .ph), with a soft fallback colour.
export function Ph({ src, pos, className = 'ph' }) {
  return <div className={className} style={{ backgroundImage: src ? `url("${src}")` : undefined, ...(pos ? { backgroundPosition: pos } : {}) }} />;
}

export function MiniIris({ size }) {
  const g = irisGeom(13, 13, 12, 4.8, 5);
  return (
    <svg viewBox="0 0 26 26" aria-hidden="true" style={size ? { width: size, height: size } : undefined}>
      {g.blades.map((b, i) => <path key={i} d={b.d} fill={BLADE_HUES[i]} stroke="#fff" strokeWidth=".9" />)}
      <path d={g.hubD} fill="#131313" />
    </svg>
  );
}

export function Spinner({ label = 'Loading' }) {
  return <div className="spin" role="status" aria-label={label}><i /><i /><i /></div>;
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}

export function NnLockup({ cls = '' }) {
  const { theme } = useApp();
  const dark = theme === 'dark' || cls.includes('onDark') || (theme === 'system' && document.documentElement.dataset.theme === 'dark');
  return (
    <span className={`nnlock ${cls}`}>
      <img className="mk" src={asset('/brand/nter-news-mark.png')} alt="" />
      <img className="wd" src={asset(dark ? '/brand/nter-news-word-white.png' : '/brand/nter-news-word-dark.png')} alt="nter.news" />
    </span>
  );
}

// Sheets slide up from the bottom (or in from the left for the history drawer).
export function SheetShell({ children, size = '', drawer = false, onClose, label }) {
  const { closeSheet } = useApp();
  const [shown, setShown] = useState(false);
  useEffect(() => { const r = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(r); }, []);
  const close = onClose || closeSheet;
  return (
    <div className={`sheethost ${shown ? 'in' : ''}`}>
      <div className="scrim" onClick={close} />
      {drawer ? (
        <div className="drawer"><div className="pane" role="dialog" aria-label={label}>{children}</div></div>
      ) : (
        <div className="sheetwrap"><div className={`sheet ${size}`} role="dialog" aria-modal="true" aria-label={label}>{children}</div></div>
      )}
    </div>
  );
}

export function SheetHead({ title, sub, onClose }) {
  const { closeSheet } = useApp();
  return (
    <>
      <div className="grab" />
      <div className="sh-hd">
        <div className="t"><b>{title}</b>{sub ? <span>{sub}</span> : null}</div>
        <button type="button" className="ib" onClick={onClose || closeSheet} aria-label="Close"><Icon name="close" /></button>
      </div>
    </>
  );
}

export function Toast() {
  const { toastMsg } = useApp();
  return <div className={`toast ${toastMsg ? 'show' : ''}`} role="status" aria-live="polite">{toastMsg || ''}</div>;
}

export function SampleBadge() {
  const { isSample } = useApp();
  if (!isSample) return null;
  return <span className="samplebadge" title="This build reads a bundled snapshot, not the live service">SAMPLE DATA</span>;
}

export function ErrorLine({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="errline" role="alert">
      <span>{String(error.message || error)}</span>
      {onRetry ? <button type="button" onClick={onRetry}>Try again</button> : null}
    </div>
  );
}

export function fmtNum(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString('en-IN') : '—';
}

export function fmtDate(iso, opts = { day: '2-digit', month: 'short', year: 'numeric' }) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-IN', opts) : '';
}
