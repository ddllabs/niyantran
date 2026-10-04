import { Icon, TAB_ICON } from './Icons.jsx';
import './deskRail.css';

export default function DeskRail({ tab, lang, tabs, lockedIds, onDesk }) {
  const locked = lockedIds instanceof Set ? lockedIds : new Set(lockedIds || []);
  return <nav className="desk-rail" aria-label={lang === 'hi' ? 'डेस्क' : 'Desks'}>{tabs.map(desk => <button type="button" key={desk.id} aria-current={desk.id === tab ? 'page' : undefined} className={locked.has(desk.id) ? 'desk-locked' : ''} onClick={() => onDesk(desk.id)} title={locked.has(desk.id) ? `${desk.label} · Upgrade` : desk.label}><Icon name={TAB_ICON[desk.id] || 'globe'} size={19}/><span>{lang === 'hi' ? desk.labelHi : desk.label}</span>{locked.has(desk.id) && <small>Upgrade</small>}</button>)}</nav>;
}
