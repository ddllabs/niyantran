// Me: the account (same as nter.pro), plan and credits, perspective, writing profile, watchlist,
// your library (documents and pinned records), appearance, and about.
import { useEffect, useState } from 'react';
import { useApp } from '../state/app.jsx';
import { useStudio } from '../state/studio.jsx';
import { planName, PLANS } from '../data/plans.js';
import { FORMAT_LABEL } from '../data/quickExit.js';
import { APP_VERSION } from '../lib/config.js';
import { openUrl } from '../lib/open.js';
import { timeAgo } from '../services/shape.js';
import Icon from '../ui/Icon.jsx';
import { Header, TabBar, Empty, fmtNum, fmtDate } from '../ui/kit.jsx';
import { asset } from '../lib/asset.js';

function Row({ icon, title, sub, val, onClick }) {
  return (
    <button type="button" className="row-btn" onClick={onClick}>
      <span className="ic"><Icon name={icon} /></span>
      <span className="tx"><b>{title}</b>{sub ? <span>{sub}</span> : null}</span>
      {val ? <span className="val">{val}</span> : null}
      <span className="chev"><Icon name="chev" /></span>
    </button>
  );
}

const initials = (p, email) => {
  const n = [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.name || '';
  const parts = n.trim().split(/\s+/).filter(Boolean);
  if (parts.length) return parts.slice(0, 2).map((s) => s[0].toUpperCase()).join('');
  return String(email || 'N')[0].toUpperCase();
};

export default function Me() {
  const app = useApp();
  const { signedIn, profile, session, persona, lawyerProfile, plan, credits, writing, watchlist, made, pins, theme, setTheme, openSheet, push, signOut, setStage, isSample } = app;
  const email = profile?.email || session?.user?.email || '';
  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.name || (signedIn ? email.split('@')[0] : 'Guest');
  const planInfo = PLANS.find((p) => p.id === plan);
  const avail = credits?.available ?? 0;
  const allowance = credits?.allowance || planInfo?.credits || 10000;
  const pct = Math.max(0, Math.min(100, Math.round((100 * avail) / Math.max(1, allowance))));
  const deleteAccount = () => openUrl(`mailto:niyantranai@gmail.com?subject=${encodeURIComponent('Delete my nter.pro account')}&body=${encodeURIComponent(`Please delete the nter.pro account for ${email} and its data.`)}`);

  return (
    <div className="view">
      <Header title="Me" />
      <div className="body">
        <div className="me-hd">
          <div className="avatar">{initials(profile, email)}</div>
          <div><b>{name}</b><span>{signedIn ? email : 'Browsing without an account'}</span></div>
        </div>
        {signedIn ? (
          <div className="plan">
            <span className="k">{planName(plan).toUpperCase()} PLAN · AI CREDITS{isSample ? ' · SAMPLE' : ''}</span>
            <div className="big"><b>{credits ? fmtNum(avail) : '—'}</b><span>{credits ? `AVAILABLE${credits.held ? ` · ${fmtNum(credits.held)} HELD` : ''} · ${fmtNum(credits.used)} USED THIS CYCLE` : 'LOADING'}</span></div>
            <div className="bar"><i style={{ width: `${pct}%` }} /></div>
            <div className="foot">
              <span>{credits?.endsAt ? `Cycle ends ${fmtDate(credits.endsAt, { day: 'numeric', month: 'short' })}` : 'Credits renew with your plan'}</span>
              <button type="button" onClick={() => openSheet('plans')}>{plan === 'free' ? 'UPGRADE' : 'PLANS'}</button>
            </div>
          </div>
        ) : (
          <div className="plan">
            <span className="k">FREE ACCOUNT · 10,000 AI CREDITS TO START</span>
            <p style={{ margin: '6px 0 10px', fontSize: 13, lineHeight: 1.45 }}>Sign in with your nter.pro account — or create one — to ask the AI, read record briefs and make documents.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="pbtn sm" onClick={() => setStage('signin')}>Sign in</button>
              <button type="button" className="pbtn sm sec" onClick={() => setStage('signup')}>Create account</button>
            </div>
          </div>
        )}
        <div className="group">
          <Row icon={persona?.icon || 'user'} title="Perspective" sub={persona?.tag || 'Choose who the app is for'} val={persona?.name} onClick={() => openSheet('personaPick')} />
          {persona?.id === 'lawyer' || persona?.db === 'legal_researcher' ? (
            <Row icon="scale" title="Lawyer work profile" sub={`${lawyerProfile?.practiceArea || 'Civil & commercial'} · ${lawyerProfile?.jurisdiction || 'India'}`} val={lawyerProfile?.practiceTags?.join(', ') || 'Litigation'} onClick={() => openSheet('lawyerProfile')} />
          ) : null}
          <Row icon="edit" title="Writing profile" sub={`${writing.aud} · ${writing.lang} · ${writing.cite}`} onClick={() => openSheet('writing')} />
          <Row icon="bell" title="Watchlist" sub={`${watchlist.length} module${watchlist.length === 1 ? '' : 's'} watched${signedIn ? ' · same list as nter.pro' : ''}`} onClick={() => openSheet('watchlist')} />
        </div>
        <div className="group">
          <span className="k">YOUR LIBRARY</span><div style={{ height: 6 }} />
          <Row icon="folder" title="File Manager" sub="Your stored documents & AI indexing" onClick={() => push({ v: 'fileManager' })} />
          <Row icon="doc" title="Documents" sub={`${made.length} made with Quick Exit and Studio · on this phone`} onClick={() => push({ v: 'mylib', section: 'docs' })} />
          <Row icon="pin" title="Pinned records" sub={`${pins.length} pinned · on this phone`} onClick={() => push({ v: 'mylib', section: 'pinned' })} />
          {signedIn ? <Row icon="history" title="Conversations" sub="Your AI research, same as on nter.pro" onClick={() => openSheet('history')} /> : null}
        </div>
        <div className="group">
          <span className="k">APPEARANCE</span>
          <div className="segs" style={{ margin: '8px 0 4px' }}>
            {[['light', 'Light'], ['dark', 'Dark'], ['system', 'System']].map(([k, l]) => <button key={k} type="button" className={theme === k ? 'on' : ''} onClick={() => setTheme(k)} aria-pressed={theme === k}>{l}</button>)}
          </div>
        </div>
        <div className="group">
          <Row icon="help" title="Help & feedback" sub="niyantranai@gmail.com" onClick={() => openUrl('mailto:niyantranai@gmail.com?subject=nter.pro%20app')} />
          <Row icon="globe" title="Open nter.pro" sub="The full terminal on the web" onClick={() => openUrl('https://www.nter.pro')} />
          <Row icon="shield" title="About, privacy & image credits" onClick={() => push({ v: 'about' })} />
          {signedIn ? <Row icon="out" title="Sign out" onClick={signOut} /> : null}
          {signedIn ? <Row icon="close" title="Delete my account" sub="Sends a deletion request to nter.pro" onClick={deleteAccount} /> : null}
        </div>
        <div className="prov" style={{ paddingTop: 16 }}>NTER.PRO · TERMINAL · MOBILE {APP_VERSION}{isSample ? ' · SAMPLE DATA' : ''} · SAME ACCOUNT AS THE WEB</div>
      </div>
      <TabBar />
    </div>
  );
}

export function MyLibrary({ section = 'docs' }) {
  const { made, pins, push, replaceTop, removeMade, togglePin } = useApp();
  const { openInStudio } = useStudio();
  return (
    <div className="view push">
      <Header back title="Your library" sub="DOCUMENTS · PINNED RECORDS · FILES" />
      <div className="tabs" style={{ marginTop: 6 }}>
        {[['docs', 'Documents'], ['pinned', 'Pinned'], ['files', 'Files']].map(([k, l]) => <button key={k} type="button" className={section === k ? 'on' : ''} onClick={() => replaceTop({ v: 'mylib', section: k })}>{l}</button>)}
      </div>
      <div className="body"><div className="list">
        {section === 'docs' ? (made.length ? made.map((m) => (
          <div key={m.id} className="lrow">
            <button type="button" style={{ display: 'flex', gap: 12, flex: 1, minWidth: 0, alignItems: 'center', textAlign: 'left' }} onClick={() => openInStudio(m.id)}>
              <span className="ic doc"><Icon name={m.fmt === 'DOCX' ? 'word' : 'pdf'} /></span>
              <span className="tx"><b>{m.name}</b><span>{m.rec} · {FORMAT_LABEL[m.fmt] || m.fmt} · {timeAgo(m.edited || m.when)}</span></span>
            </button>
            <button type="button" className="ib" style={{ width: 34, height: 34, color: 'var(--muted)' }} onClick={() => removeMade(m.id)} aria-label={`Delete ${m.name}`}><Icon name="close" /></button>
          </div>
        )) : <Empty title="No documents yet">Documents you make with Quick Exit, or answers you open in Studio, land here.</Empty>) : null}
        {section === 'pinned' ? (pins.length ? pins.map((p) => (
          <div key={p.key} className="lrow">
            <button type="button" style={{ display: 'flex', gap: 12, flex: 1, minWidth: 0, alignItems: 'center', textAlign: 'left' }} onClick={() => push({ v: 'record', module: p.module, row: p.row })}>
              <span className="ic"><Icon name="pin" /></span>
              <span className="tx"><b>{p.title}</b><span>{p.module.title} · pinned {timeAgo(p.pinnedAt)}</span></span>
            </button>
            <button type="button" className="ib" style={{ width: 34, height: 34, color: 'var(--muted)' }} onClick={() => togglePin(p)} aria-label={`Unpin ${p.title}`}><Icon name="close" /></button>
          </div>
        )) : <Empty title="Nothing pinned">Pin a record from its page to keep it here and in the attach picker.</Empty>) : null}
        {section === 'files' ? (
          <div style={{ padding: '8px 0' }}>
            <div className="lrow" style={{ marginBottom: 12 }}>
              <button type="button" style={{ display: 'flex', gap: 12, flex: 1, minWidth: 0, alignItems: 'center', textAlign: 'left' }} onClick={() => push({ v: 'fileManager' })}>
                <span className="ic doc"><Icon name="folder" /></span>
                <span className="tx"><b>Personal File Manager</b><span>Browse stored documents & AI indexing</span></span>
              </button>
              <button type="button" className="pbtn sm sec" style={{ width: 'auto', padding: '0 12px', height: 32, fontSize: 12 }} onClick={() => push({ v: 'fileManager' })}>Open</button>
            </div>
            <Empty title="Manage your personal files" action={<button type="button" className="pbtn sm" onClick={() => push({ v: 'fileManager' })}>Go to File Manager</button>}>
              Upload PDFs and contracts to query them directly with Ask AI.
            </Empty>
          </div>
        ) : null}
      </div></div>
      <TabBar />
    </div>
  );
}

const CREDITS = `Globe textures: Solar System Scope / INOVE, based on NASA imagery — CC BY 4.0 (solarsystemscope.com/textures).
Typefaces: Inter and JetBrains Mono — SIL Open Font License 1.1.
News: nter.news, the Niyantran newsroom.
Desk photographs: listed below with their authors and licences (several CC BY-SA; adapted presentations keep the original licence).`;

// The desk photo credits shipped with the images (public/desks/CREDITS.txt), as plain lines.
function useDeskCredits() {
  const [lines, setLines] = useState([]);
  useEffect(() => {
    fetch(asset('/desks/CREDITS.txt')).then((r) => r.text()).then((t) => {
      const rows = t.split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l) && !/^\|\s*Asset/.test(l));
      setLines(rows.map((l) => l.split('|').slice(1, -1).map((c) => c.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim()).join(' — ')));
    }).catch(() => setLines([]));
  }, []);
  return lines;
}

export function About() {
  const desk = useDeskCredits();
  return (
    <div className="view push">
      <Header back title="About" sub="NTER.PRO MOBILE" />
      <div className="body"><div className="about" style={{ padding: '14px 16px 30px' }}>
        <p><b>nter.pro</b> is the research terminal for government, policy, law and global affairs in India: official sources across legislation, courts, markets, climate and more, with every connection labelled.</p>
        <p>This app uses the same account, credits, conversations and watchlist as the website. Answers and briefs are information, not advice. Documents are formatted, not filed: check them before you sign.</p>
        <p>Documents you make and records you pin are kept on this phone.</p>
        <div style={{ display: 'flex', gap: 8, margin: '6px 0 16px' }}>
          <button type="button" className="pbtn sm sec" onClick={() => openUrl('https://www.nter.pro/privacy')}>Privacy policy</button>
          <button type="button" className="pbtn sm sec" onClick={() => openUrl('https://www.nter.pro/terms')}>Terms</button>
        </div>
        <div className="k" style={{ marginBottom: 6 }}>IMAGE AND TYPE CREDITS</div>
        <div className="credits-list">{CREDITS}</div>
        {desk.length ? <ul className="credits-rows">{desk.map((l, i) => <li key={i}>{l}</li>)}</ul> : null}
        <div className="prov" style={{ paddingTop: 18 }}>VERSION {APP_VERSION} · © NIYANTRAN</div>
      </div></div>
    </div>
  );
}
