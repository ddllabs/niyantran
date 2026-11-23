// One sector of a desk: its modules, each opening the module's records.
import { useApp } from '../state/app.jsx';
import { useChat } from '../state/chat.jsx';
import { useStudio } from '../state/studio.jsx';
import { deskById, deskImg } from '../data/desks.js';
import Icon from '../ui/Icon.jsx';
import { Ph, TabBar } from '../ui/kit.jsx';

const glass = { background: 'rgba(0,0,0,.35)', color: '#fff', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' };

export function moduleIcon(m) {
  const f = `${m.feature} ${m.title}`.toLowerCase();
  if (/news|media|monitor|feed|press/.test(f)) return 'news';
  if (/court|judg|tribunal|nclt|law|legal|case/.test(f)) return 'scale';
  if (/market|stock|exchange|price|econom|gdp|indicator|budget|fiscal/.test(f)) return 'chart';
  if (/bill|act|policy|regulat|gazette|question/.test(f)) return 'policy';
  if (/election|candidate|mp |mla|manifesto|party/.test(f)) return 'flag';
  if (/climate|carbon|emission|energy|forest/.test(f)) return 'leaf';
  if (/calendar|schedule|event|fixture/.test(f)) return 'cal';
  return 'doc';
}

export default function Sector({ deskId, index }) {
  const { pop, push, openSheet } = useApp();
  const chat = useChat();
  const { openChat } = useStudio();
  const d = deskById(deskId);
  const g = d?.groups[index];
  if (!g) return null;
  const ask = () => { chat.setDeskContext({ tier: d.id }); chat.setDraft(`What should I know about ${g.name} on the ${d.name} desk right now?`); openChat(); };
  return (
    <div className="view push">
      <div className="shero">
        <Ph src={deskImg(g.image)} /><div className="fade" />
        <div style={{ position: 'absolute', left: 8, top: 6, zIndex: 2 }}>
          <button type="button" className="ib" style={glass} onClick={pop} aria-label="Back"><Icon name="back" /></button>
        </div>
        <div className="copy">
          <div className="k" style={{ color: '#cfd8ff' }}>INSIDE THIS SECTOR · {d.name.toUpperCase()}</div>
          <h2>{g.name}</h2>
          <p>{g.description}</p>
        </div>
      </div>
      <div className="body">
        <div className="selrow">
          <span className="k">SELECT A SECTOR</span>
          <button type="button" className="dsel" onClick={() => openSheet('sectorPick', { deskId, index })}><span>{g.name}</span><Icon name="down" /></button>
        </div>
        <div className="table-hd" style={{ paddingTop: 12 }}><span>{g.modules.length} MODULE{g.modules.length === 1 ? '' : 'S'}</span><span>OPEN</span></div>
        <div className="list">
          {g.modules.map((m) => {
            const mod = { ...m, desk: d.id, deskName: d.name, group: g.id, groupName: g.name };
            return (
              <button key={m.feature} type="button" className="mod" onClick={() => push({ v: 'module', module: mod })}>
                <span className="ic"><Icon name={moduleIcon(m)} /></span>
                <span className="tx"><b>{m.title}</b><span>{m.title !== m.feature ? m.feature : g.name}</span></span>
                <span className="chev"><Icon name="chev" /></span>
              </button>
            );
          })}
        </div>
        <div style={{ padding: '14px 16px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button type="button" className="pbtn sm soft" onClick={ask}><Icon name="sparkle" />Ask about this sector</button>
          <div className="note-line">Coverage and refresh vary by source; each module says where its rows come from.</div>
        </div>
      </div>
      <TabBar />
    </div>
  );
}
