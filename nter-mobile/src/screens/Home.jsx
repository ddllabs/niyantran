// Home: the nter.news feed first (as on nter.pro), then the desks carousel, markets, the
// watchlist and the morning briefing.
import { useMemo, useState } from 'react';
import { useApp } from '../state/app.jsx';
import { api } from '../services/index.js';
import { useAsync } from '../lib/useAsync.js';
import { openUrl } from '../lib/open.js';
import { normalizeStory } from '../data/stories.js';
import { DESKS, ALL_MODULES, deskImg } from '../data/desks.js';
import Icon from '../ui/Icon.jsx';
import { NnLockup, Ph, Spinner, TabBar, ErrorLine } from '../ui/kit.jsx';
import { asset } from '../lib/asset.js';

const fmtPrice = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n >= 1000 ? n.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};
const fmtPct = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? `${n > 0 ? '+' : ''}${n.toFixed(2)}%` : '';
};

export function StoryCard({ story }) {
  const { push } = useApp();
  return (
    <button type="button" className="story" onClick={() => push({ v: 'story', story })}>
      <span className="th"><Ph src={story.img} /></span>
      <span className="tx">
        <span className="tag">{story.category.toUpperCase()}</span>
        <b>{story.title}</b>
        <span className="meta">{story.date.toUpperCase()}{story.mins ? ` · ${story.mins} MIN READ` : ''}</span>
      </span>
    </button>
  );
}

export function DeskCarousel() {
  const { push, setTab } = useApp();
  return (
    <div className="deskad">
      <div className="hd">
        <div className="tx"><div className="k accent">THE DESKS</div><h2>A world of context.</h2><span>Eight desks · every sector, every module, one place</span></div>
        <button type="button" className="all" onClick={() => setTab('library')}>All desks <Icon name="chev" /></button>
      </div>
      <div className="deskcar">
        {DESKS.map((d) => (
          <button key={d.id} type="button" className="dcard" onClick={() => push({ v: 'desk', deskId: d.id })}>
            <Ph src={deskImg(d.image)} />
            <div className="fade" />
            <span className="ic"><Icon name={d.icon} /></span>
            <div><b>{d.name}</b><small>{d.groups.length} sectors · {d.moduleCount} modules</small></div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function HomeFeed() {
  const { push, watchlist, openSheet } = useApp();
  const [section, setSection] = useState('Latest');
  const [more, setMore] = useState(false);
  const news = useAsync((signal) => api.homeLatest({ signal }), []);
  const markets = useAsync((signal) => api.homeMarkets({ signal }), []);

  const stories = useMemo(() => (news.data?.rows || []).map(normalizeStory).filter((s) => s.title), [news.data]);
  const sections = useMemo(() => ['Latest', ...[...new Set(stories.map((s) => s.section))].slice(0, 7)], [stories]);
  const lead = stories.find((s) => s.lead && s.img) || stories.find((s) => s.img) || stories[0];
  const list = section === 'Latest' ? stories.filter((s) => s !== lead) : stories.filter((s) => s.section === section);
  const hot = stories.slice(0, 6);

  const openWatch = (w) => {
    const m = ALL_MODULES.find((x) => x.desk === w.tab && x.feature === w.feature);
    if (m) push({ v: 'module', module: m });
  };

  return (
    <>
      {hot.length ? (
        <div className="ticker" aria-label="Hot topics">
          <span className="hot"><i />HOT TOPICS</span>
          {hot.map((s) => <button key={s.id} type="button" className="t" onClick={() => push({ v: 'story', story: s })}><b>{s.section}</b>{s.title.length > 70 ? `${s.title.slice(0, 70)}…` : s.title}</button>)}
        </div>
      ) : null}
      <div className="feed-hd">
        <div className="tx"><div className="k"><i className="livedot" />{news.data?.sample ? 'SAMPLE · LATEST' : news.data?.fallback ? 'SAVED · LATEST' : 'LIVE · LATEST'}</div><h2>Latest</h2></div>
        <button type="button" className="nnlink" onClick={() => openUrl('https://nter.news')} aria-label="Open nter.news"><NnLockup cls="xs" /><Icon name="ext" /></button>
      </div>
      {news.data?.fallback ? <div className="note-strip">nter.news could not be reached, so these are the last saved stories.</div> : null}
      <div className="nsec">
        {sections.map((s) => <button key={s} type="button" className={section === s ? 'on' : ''} onClick={() => { setSection(s); setMore(false); }}>{s}</button>)}
      </div>
      {news.loading && !stories.length ? <Spinner label="Loading stories" /> : null}
      <ErrorLine error={!stories.length ? news.error : null} onRetry={news.reload} />
      {section === 'Latest' && lead ? (
        <button type="button" className="leadst" onClick={() => push({ v: 'story', story: lead })}>
          <Ph src={lead.img} /><div className="fade" />
          <span className="tag">{lead.category.toUpperCase()}</span>
          <b>{lead.title}</b>
          {lead.dek ? <p>{lead.dek}</p> : null}
          <span className="meta">{lead.date.toUpperCase()}{lead.mins ? ` · ${lead.mins} MIN READ` : ''}</span>
        </button>
      ) : null}
      <div className="feed">
        {(more ? list : list.slice(0, 8)).map((s) => <StoryCard key={s.id} story={s} />)}
        {!news.loading && stories.length && !list.length ? <div className="empty"><b>No stories in this section yet</b></div> : null}
      </div>
      <div className="feed-more">
        {list.length > 8 && !more
          ? <button type="button" onClick={() => setMore(true)}>More stories <Icon name="down" /></button>
          : <button type="button" onClick={() => openUrl('https://nter.news')}>More on nter.news <Icon name="chev" /></button>}
      </div>

      <DeskCarousel />

      <div className="sec-hd" style={{ paddingTop: 14 }}><h2 style={{ fontSize: 16 }}>Markets</h2><p>{markets.data?.sample ? 'SAMPLE' : markets.data?.fallback ? 'LAST SAVED' : 'DELAYED'} · NSE · BSE · GLOBAL INDICES</p></div>
      {markets.loading && !markets.data ? <Spinner label="Loading markets" /> : null}
      <div className="mkt">
        {(markets.data?.rows || []).slice(0, 9).map((m) => {
          const d1 = Number(m.d1 ?? m.chg ?? m.pct_change);
          return <div key={m.symbol || m.name}><span>{m.name}</span><b>{fmtPrice(m.last)}</b><em className={d1 > 0 ? 'up' : d1 < 0 ? 'dn' : ''}>{fmtPct(d1)}</em></div>;
        })}
      </div>

      <div className="sec-hd" style={{ paddingTop: 14, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: 16 }}>My watchlist</h2>
        <button type="button" className="linkbtn" style={{ fontSize: 12.5 }} onClick={() => openSheet('watchlist')}>Edit</button>
      </div>
      <div className="watch">
        {watchlist.map((w) => <button key={`${w.tab}:${w.feature}`} type="button" onClick={() => openWatch(w)}><i />{w.label || w.feature}</button>)}
        {!watchlist.length ? <span className="note-line">Watch a module from any desk to keep it here.</span> : null}
      </div>

      <div className="mbrief">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}><div className="k">THE MORNING BRIEFING</div><NnLockup cls="onDark sm" /></div>
        <b>Source-led stories from nter.news, every weekday morning.</b>
        <p>Read the briefing and subscribe on nter.news. Free for everyone.</p>
        <div className="row"><button type="button" style={{ flex: 1 }} onClick={() => openUrl('https://nter.news')}>Open nter.news</button></div>
      </div>
      <div style={{ height: 16 }} />
    </>
  );
}

export default function Home() {
  const { setTab, push, openSheet, isSample } = useApp();
  return (
    <div className="view">
      <div className="hdr">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 4 }}>
          <img src={asset('/brand/logo-128.webp')} alt="" style={{ width: 26, height: 26, objectFit: 'contain' }} />
          <b style={{ fontSize: 12, letterSpacing: '.24em' }}>TERMINAL</b>
        </div>
        <div className="t" />
        <button type="button" className="deskbtn" onClick={() => setTab('library')} aria-label="All desks"><Icon name="library" /><span>Desks</span></button>
        <button type="button" className="ib" onClick={() => push({ v: 'search' })} aria-label="Search"><Icon name="search" /></button>
        <button type="button" className="ib" onClick={() => openSheet('watchlist')} aria-label="Watchlist"><Icon name="bell" /></button>
      </div>
      <div className="body">{isSample ? <div className="samplestrip">SAMPLE DATA · A READ-ONLY SNAPSHOT OF NTER.PRO · NOTHING HERE IS LIVE</div> : null}<HomeFeed /></div>
      <TabBar />
    </div>
  );
}
