import { useRef } from 'react';
import { DESK_IMAGES, DESK_VISUALS } from '../desks/landing/deskImages.js';
import { Icon, TAB_ICON } from './Icons.jsx';
import './deskDirectory.css';

export function DeskLandingTabs({ tabs, tab, lockedIds, onDesk, lang = 'en' }) {
  const locked = lockedIds instanceof Set ? lockedIds : new Set(lockedIds || []);
  return <nav className="v6-landing-tabs" aria-label={lang === 'hi' ? 'डेस्क' : 'Desks'}>{tabs.map(desk => <button type="button" key={desk.id} aria-current={desk.id === tab ? 'page' : undefined} title={locked.has(desk.id) ? `${desk.label} · Upgrade` : desk.label} onClick={() => onDesk(desk.id)}>{lang === 'hi' ? desk.labelHi : desk.label}{locked.has(desk.id) && <small> · {lang === 'hi' ? 'अपग्रेड' : 'Upgrade'}</small>}</button>)}</nav>;
}

export function DeskDirectoryCards({ tabs, tab, lockedIds, onDesk, lang = 'en' }) {
  const locked = lockedIds instanceof Set ? lockedIds : new Set(lockedIds || []);
  return <div className="v6-desk-directory">{tabs.map(desk => {
    const visual = DESK_VISUALS[desk.id];
    const name = lang === 'hi' ? desk.labelHi : desk.label;
    return <button type="button" key={desk.id} data-directory={desk.id}
      aria-current={desk.id === tab ? 'page' : undefined}
      title={locked.has(desk.id) ? `${desk.label} · Upgrade` : desk.label}
      onClick={() => onDesk(desk.id)}>
      {visual ? <img src={(DESK_IMAGES[visual.image] || DESK_IMAGES[`${visual.image}.jpg`])} alt="" loading="lazy"/> : <div className="v6-directory-home"><Icon name={TAB_ICON[desk.id] || 'home'} size={28}/></div>}
      <span><b>{name}</b><small>{locked.has(desk.id) ? lang === 'hi' ? 'अपग्रेड' : 'Upgrade' : lang === 'hi' ? 'डेस्क खोलें' : 'Explore desk'}</small></span><span className="v6-directory-arrow" aria-hidden="true">↗</span>
    </button>;
  })}</div>;
}

export default function DeskDirectory({ tabs, tab, lockedIds, onDesk, lang = 'en' }) {
  const dialog = useRef(null);
  const trigger = useRef(null);
  const hi = lang === 'hi';
  const close = () => dialog.current?.close();
  return <div className="v6-directory-control">
    <button type="button" ref={trigger} className="v6-directory-open" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}><Icon name="grid" size={13}/>{hi ? 'सभी अनुभाग' : 'All sections'}</button>
    <dialog ref={dialog} className="v6-directory-dialog" aria-labelledby="v6-directory-title" onClose={() => trigger.current?.focus()} onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } }}>
      <button type="button" className="v6-directory-close" aria-label={hi ? 'बंद करें' : 'Close all sections'} onClick={close}>×</button>
      <div className="v6-directory-heading"><div>{hi ? 'आपका इंटेलिजेंस कार्यक्षेत्र' : 'YOUR INTELLIGENCE WORKSPACE'}</div><h2 id="v6-directory-title">{hi ? 'संदर्भ की दुनिया।' : 'A world of context.'}<br/><span>{hi ? 'अपना दृष्टिकोण चुनें।' : 'Choose your perspective.'}</span></h2><p>{hi ? 'हर डेस्क, एक जगह।' : 'Explore your desks. Every sector, every module, one place.'}</p></div>
      <DeskDirectoryCards tabs={tabs} tab={tab} lockedIds={lockedIds} lang={lang} onDesk={id => { close(); onDesk(id); }}/>
    </dialog>
  </div>;
}
