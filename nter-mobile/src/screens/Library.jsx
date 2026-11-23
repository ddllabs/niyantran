// Library = the desks. The tab root lists the eight desks; a desk opens its hub with sectors.
import { useApp } from '../state/app.jsx';
import { useChat } from '../state/chat.jsx';
import { useStudio } from '../state/studio.jsx';
import { DESKS, deskById, deskImg } from '../data/desks.js';
import Icon from '../ui/Icon.jsx';
import { Header, Ph, TabBar } from '../ui/kit.jsx';

export function DeskGrid({ note = true }) {
  const { push } = useApp();
  return (
    <>
      <div className="dall-hd" style={{ paddingTop: 10 }}>
        <div className="tx">
          <div className="k accent">YOUR INTELLIGENCE WORKSPACE</div>
          <h2>A world of context.<br /><em>Choose your desk.</em></h2>
          <p>Eight desks. Every sector, every module, one place.</p>
        </div>
      </div>
      <div className="dall">
        {DESKS.map((d) => (
          <button key={d.id} type="button" className="dtile" onClick={() => push({ v: 'desk', deskId: d.id })}>
            <Ph src={deskImg(d.image)} /><div className="fade" />
            <span className="ic"><Icon name={d.icon} /></span>
            <span className="go"><Icon name="chev" /></span>
            <div><b>{d.name}</b><em>{d.titleText}</em><small>{d.groups.length} sectors · {d.moduleCount} modules</small></div>
          </button>
        ))}
      </div>
      {note ? <div className="dall-note">Pick a desk to browse its sectors, modules and records. Every record can be attached to Ask AI or turned into a document with Quick Exit.</div> : null}
    </>
  );
}

export default function Library() {
  const { push } = useApp();
  return (
    <div className="view">
      <Header title="Library" sub={`THE DESKS · ${DESKS.length} DESKS · ${DESKS.reduce((n, d) => n + d.moduleCount, 0)} MODULES`}
        right={<button type="button" className="ib" onClick={() => push({ v: 'search' })} aria-label="Search"><Icon name="search" /></button>} />
      <div className="body"><DeskGrid /></div>
      <TabBar />
    </div>
  );
}

export function DeskHubBody({ deskId, onBack }) {
  const { push, openSheet } = useApp();
  const chat = useChat();
  const { openChat } = useStudio();
  const d = deskById(deskId);
  if (!d) return null;
  const ask = () => { chat.setDeskContext({ tier: d.id }); openChat(); };
  return (
    <div className="body">
      <div className="hero">
        <Ph src={deskImg(d.image)} /><div className="fade" />
        <div className="topline">
          <button type="button" className="ib" onClick={onBack} aria-label="Back"><Icon name="back" /></button>
          <button type="button" className="pick" onClick={() => openSheet('deskPick', { current: d.id })}><b>DESK</b><span>{d.name}</span><Icon name="down" /></button>
          <button type="button" className="ib" onClick={() => push({ v: 'search' })} aria-label="Search"><Icon name="search" /></button>
        </div>
        <div className="copy">
          <div className="kick">{d.imageLabel || d.name.toUpperCase()}</div>
          <h1>{d.titleText}</h1>
          <p>{d.description}</p>
          <div className="meta">{d.groups.length} SECTORS · {d.moduleCount} MODULES</div>
        </div>
      </div>
      <div className="sec-hd"><h2>{d.heading || 'Inside this desk'}</h2><p>{d.groups.length} sectors · {d.moduleCount} modules</p></div>
      <div className="sectors">
        {d.groups.map((g, i) => (
          <button key={g.id} type="button" className="scard" onClick={() => push({ v: 'sector', deskId: d.id, index: i })}>
            <Ph src={deskImg(g.image)} /><div className="fade" />
            <span className="n">{String(i + 1).padStart(2, '0')}</span>
            <span className="mods">{g.modules.length} MODULE{g.modules.length === 1 ? '' : 'S'}</span>
            <b>{g.name}</b>
            <span>{g.cardDescription || g.description}</span>
          </button>
        ))}
      </div>
      <div style={{ padding: '14px 16px 24px' }}>
        <button type="button" className="pbtn sm soft" onClick={ask}><Icon name="sparkle" />Ask AI with the {d.name} desk</button>
      </div>
    </div>
  );
}

export function DeskScreen({ deskId }) {
  const { pop } = useApp();
  return (
    <div className="view push">
      <DeskHubBody deskId={deskId} onBack={pop} />
      <TabBar />
    </div>
  );
}
