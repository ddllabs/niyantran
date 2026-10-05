import { useState } from 'react';
import { ModuleRow, SourceControl } from './NationalLandingView.jsx';
import { useNationalMotion } from './useNationalMotion.js';
import { useLawLanding } from './useLawLanding.js';
import CourtBackdrop, { LawTile } from './LawLandingArtwork.jsx';
import { aggregateLawSummaries } from '../lib/lawLandingSummary.js';
import './lawLanding.css';

const GROUPS = [
  { title: 'Judicial Intelligence', scene: 'court', copy: 'Stored Supreme Court orders and court reporting coverage.' },
  { title: 'Judicial Analytics', scene: 'bench', copy: 'Bench and judge reporting; structured analytics are not established.' },
  { title: 'International Courts', scene: 'peace', copy: 'ICC, ICJ and WTO reporting; official dockets are not connected.' },
  { title: 'Tribunals', scene: 'files', copy: 'NCLT/IBBI entries and sector tribunal reporting coverage.' },
];
const MODES = [['stored', 'Stored', '#16a34a'], ['feed-backed', 'Feed-backed', '#d97706'], ['curated', 'Curated', '#4c2bb3']];
const titleFor = name => name === 'Order Archive by Topic (Cross-Court)' ? 'Supreme Court orders by topic' : name === 'HC Judge Profiles & Bench Analytics' ? 'Judge & bench reporting' : name;
const fmt = value => value == null ? '—' : value.toLocaleString('en-IN');
function TierCoverage({ summaries }) {
  const tiers = [['Supreme Court', ['Supreme Court Order & Judgment Feed']], ['High Court coverage', ['UP High Court (Allahabad) Order Feed']], ['District court coverage', ['District Court Case Tracker']], ['Tribunal entries & coverage', ['NGT Environmental Litigation Tracker', 'CAT & Consumer Disputes (NCDRC) Watch', 'NCLT / NCLAT (Insolvency)', 'Sector Tribunals (ITAT / TDSAT / SAT / DRT)']], ['International court coverage', ['ICC Proceedings', 'ICJ Proceedings', 'WTO Dispute Settlement']]];
  const values = tiers.map(([title, features]) => ({ title, ...aggregateLawSummaries(features.map(feature => summaries[feature]).filter(Boolean)), expected: features.length }));
  const max = Math.max(1, ...values.map(value => value.count || 0));
  return <section className="card" aria-labelledby="law-tiers"><div className="ch"><h3 id="law-tiers">Coverage by tier of the system</h3><span className="sub">Available entries · source types differ</span></div><div className="law-tiers">{values.map(value => <div className="law-tier" key={value.title}><span>{value.title}</span><div className="law-track" aria-hidden="true"><i style={{'--w': `${(value.count || 0) / max * 100}%`, width: `${(value.count || 0) / max * 100}%`}}/></div><span>{fmt(value.count)}<small>{value.loaded}/{value.expected} sources</small></span></div>)}</div><p className="fn">Supreme Court topic views share one table. Reporting coverage is not a case count; entries can overlap between feeds. Judge reporting is shown separately in its module.</p></section>;
}

export function LawLandingContent({ buckets, summaries, onFeature, retry, label = 'Law', query = '', sourceFilter = 'all', onQuery = () => {}, onFilter = () => {} }) {
  const [paused, setPaused] = useState(false);
  const motionRef = useNationalMotion(paused);
  const modules = buckets.flatMap(bucket => bucket.items), values = Object.values(summaries), aggregate = aggregateLawSummaries(values);
  const resourceCount = new Set(modules.map(module => summaries[module.htmlFeature]?.resourceKey || module.htmlFeature)).size;
  const pending = modules.some(module => !summaries[module.htmlFeature]);
  const modes = mode => values.filter(summary => summary.sourceMode === mode).length;
  const sources = [...new Map(values.flatMap(summary => (summary.sources || []).slice(0, 1)).map(source => [source.name, source])).values()].slice(0, 5);
  const matches = module => `${module.htmlFeature} ${titleFor(module.htmlFeature)}`.toLowerCase().includes(query.trim().toLowerCase()) && (sourceFilter === 'all' || summaries[module.htmlFeature]?.sourceMode === sourceFilter);
  const visible = modules.filter(matches).length, filtered = !!query.trim() || sourceFilter !== 'all';
  const maxCount = Math.max(1, ...values.map(summary => summary.count || 0));
  const shortcuts = [['Supreme Court Order & Judgment Feed', 'Read a Supreme Court order', 'Explore the stored order table and its source PDF.'], ['Order Archive by Topic (Cross-Court)', 'Explore orders by topic', 'Use subject classifiers on the same Supreme Court table.'], ['NCLT / NCLAT (Insolvency)', 'Find an insolvency entry', 'Explore NCLT records and IBBI public announcements.']];
  let offset = 0;
  return <div className="desk desk-wide national-landing law-landing" ref={motionRef}>
    <div className="backdrop" aria-hidden="true"><div className="bg on"><CourtBackdrop/></div><div className="veil"/></div>
    <div className="page"><section className="hero" aria-labelledby="law-title"><div className="nl-hero-copy"><div className="kicker"><span className="pill">{label} desk</span><span>{buckets.length} segments · {modules.length} modules · public-source registers</span></div><h1 id="law-title"><span className="w">Every order,</span><br/><span className="w">with its status stated.</span></h1><p className="lede">Explore <b>court records, tribunal entries and legal reporting.</b> Read each register with its source and coverage in view.</p><div className="sources"><b>Sources</b>{sources.length ? sources.map(source => <span key={source.name}><a href={source.url} target="_blank" rel="noreferrer">{source.name} ↗</a></span>) : <span>Source summaries load below</span>}</div></div>
      <button type="button" className="nl-motion-toggle" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? 'Resume motion' : 'Pause motion'}</button>
      <div className="stats" aria-label="Law register overview"><div className="stat"><span className="l">Entries across sources</span><b className="v">{fmt(aggregate.count)}</b><span className="s">{aggregate.loaded}/{resourceCount} resources measured · shared orders counted once</span></div>
        <div className="stat live"><span className="l">Stored modules</span><b className="v">{pending && !modes('stored') ? '—' : modes('stored')}</b><span className="s">Stored source tables</span></div>
        <div className="stat wire"><span className="l">Feed-backed modules</span><b className="v">{pending && !modes('feed-backed') ? '—' : modes('feed-backed')}</b><span className="s">Retrieval · coverage varies</span></div>
        <div className="stat"><span className="l">Modules to explore</span><b className="v">{modules.length}</b><span className="s">{buckets.length} research groups</span></div>
        <div className="stat donut"><svg viewBox="0 0 70 70" aria-hidden="true"><circle cx="35" cy="35" r="25" stroke="var(--hair)"/>{MODES.map(([mode,,color]) => {const length=modes(mode)/Math.max(1,modules.length)*157.08,start=offset;offset+=length;return <circle key={mode} cx="35" cy="35" r="25" stroke={color} strokeDasharray={`${length} ${157.08-length}`} strokeDashoffset={-start}/>;})}</svg><div className="lg">{MODES.map(([mode,name,color])=><span key={mode}><i style={{background:color}}/>{name} <b>{pending&&!modes(mode)?'—':modes(mode)}</b></span>)}</div></div>
      </div></section>
      <div className="bar"><h2>Find your starting point.</h2><span className="sub">Explore a register.</span><div className="tools"><label className="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><input type="search" aria-label="Find a module" value={query} onChange={event => onQuery(event.target.value)} placeholder="Search modules…"/></label><SourceControl value={sourceFilter} onChange={onFilter}/></div></div>
      <p className="nl-progress" role="status">{pending?'Loading summaries':'Source summaries'} · {values.length} of {modules.length} summaries received · {visible} matching {visible === 1 ? 'module' : 'modules'}</p>
      <div className="segments">{buckets.map((bucket,index)=>{const group=GROUPS[index]||GROUPS[0],sum=aggregateLawSummaries(bucket.items.map(module=>summaries[module.htmlFeature]).filter(Boolean));return <article className={`seg${bucket.items.some(matches)?'':' empty'}`} key={bucket.label} onAnimationEnd={event=>{if(event.target===event.currentTarget)event.currentTarget.style.animation='none';}} style={{animationDelay:`${350+index*90}ms`}}><div className="pic"><LawTile scene={group.scene}/><div className="cap"><span className="n">0{index+1}</span><h3>{group.title}</h3></div></div><div className="sh"><p>{group.copy}</p><div className="tot"><b>{fmt(sum.count)}</b><span>entries</span><span className="mods">{bucket.items.length} {bucket.items.length === 1 ? 'module' : 'modules'}</span></div></div><div className="list">{bucket.items.map(module=><ModuleRow key={module.htmlFeature} module={module} title={titleFor(module.htmlFeature)} summary={summaries[module.htmlFeature]} onFeature={onFeature} retry={retry} matches={matches(module)} filtered={filtered} maxCount={maxCount}/>)}</div></article>;})}</div>
      {!visible&&<div className="nl-empty"><p>No modules match these filters.</p><button type="button" onClick={()=>{onQuery('');onFilter('all');}}>Clear filters</button></div>}
      <div className="band"><TierCoverage summaries={summaries}/><section className="card" aria-labelledby="law-start-title"><div className="ch"><h3 id="law-start-title">Start with a question.</h3><span className="sub">Three ways in.</span></div><div className="starts">{shortcuts.map(([feature,title,copy],index)=><button type="button" className="start" key={feature} onClick={()=>onFeature(feature)}><span className="ic" aria-hidden="true">0{index+1}</span><span className="tx"><b>{title}</b><span>{copy}</span></span><span className="arr" aria-hidden="true">→</span></button>)}</div><p className="fn">Registers contain different kinds of entries. Totals do not establish unique entities, freshness or completeness.</p></section></div>
      <footer className="foot"><span><i className="live"/>Stored snapshots</span><span><i className="wire"/>Feed-backed retrieval</span><span><i/>Curated / unavailable</span><span className="right">Log-scale tracks · open ⓘ for coverage and source dates</span></footer>
    </div>
  </div>;
}

export default function LawLandingView({ buckets = [], onFeature, label, lang }) {
  const [query,setQuery]=useState(''),[sourceFilter,setFilter]=useState('all');
  const {summaries,retry}=useLawLanding(buckets.flatMap(bucket=>bucket.items.map(module=>module.htmlFeature)));
  return <LawLandingContent buckets={buckets} summaries={summaries} retry={retry} onFeature={onFeature} label={lang==='hi'?'विधि':label||'Law'} query={query} sourceFilter={sourceFilter} onQuery={setQuery} onFilter={setFilter}/>;
}
