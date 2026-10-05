import { useState } from 'react';
import { ModuleRow, SourceControl } from './NationalLandingView.jsx';
import { useNationalMotion } from './useNationalMotion.js';
import { useGlobalLanding } from './useGlobalLanding.js';
import GlobalGlobe, { GlobalTile } from './GlobalLandingArtwork.jsx';
import { WORLD_PATHS } from './globalLandingGeometry.js';
import './globalLanding.css';

const GROUPS = [
  { title: 'Security', scene: 'radar', copy: 'Conflict theatres and defence procurement programmes.' },
  { title: 'Diplomacy', scene: 'flags', copy: 'Alliances, sanctions programmes and humanitarian appeals.' },
  { title: 'Strategic Assets', scene: 'satellite', copy: 'Infrastructure, nuclear sites, upcoming launches and chokepoints.' },
  { title: 'Resources', scene: 'mine', copy: 'Reporting, constitutions, growth indicators and leader profiles.' },
  { title: 'Geonomics', scene: 'port', copy: 'Trade indicators and critical mineral references.' },
];
const MODES = [['stored', 'Stored', '#16a34a'], ['feed-backed', 'Feed-backed', '#d97706'], ['curated', 'Curated', '#4c2bb3']];
const titleFor = name => name === 'Satellite Infrastructure' ? 'Upcoming launches' : name === 'Energy' ? 'Energy & mineral references' : name;
const fmt = value => value == null ? '—' : value.toLocaleString('en-IN');
function total(summaries) {
  const known = summaries.filter(summary => Number.isInteger(summary?.count));
  return { count: known.length ? known.reduce((sum, summary) => sum + summary.count, 0) : null, loaded: known.length };
}

function LocationMap({ summaries, retry, onFeature }) {
  const features = ['Nuclear Watch', 'Maritime Choke-Points'];
  const loaded = features.map(feature => summaries[feature]);
  const locations = features.flatMap((feature, i) => (summaries[feature]?.locations || []).map(point => ({ ...point, feature, color: i ? '#d97706' : '#1d3fb8' })));
  return <section className="card" aria-labelledby="gl-map-title"><div className="ch"><h3 id="gl-map-title">Where the desk looks</h3><span className="sub">{fmt(locations.length)} source locations</span><span className="src">Schematic · not to scale</span></div>
    <svg className="gl-world" viewBox="0 0 1000 460" role="img" aria-label="Schematic map of source-provided nuclear-site and chokepoint coordinates">
      {WORLD_PATHS.map(path => <path key={path} d={path}/>)}
      {locations.map((point, index) => <circle key={`${point.feature}-${index}`} cx={(point.lon + 180) / 360 * 1000} cy={(90 - point.lat) / 180 * 460} r="3.7" fill={point.color}><title>{point.name} · {point.precision}</title></circle>)}
    </svg>
    <div className="gl-map-legend">{features.map((feature, index) => <button type="button" key={feature} onClick={() => onFeature(feature)}><i style={{ background: index ? '#d97706' : '#1d3fb8' }}/>{feature} ↗</button>)}</div>
    {loaded.some(value => !value) && <p role="status">Loading coordinate coverage…</p>}
    {features.filter(feature => summaries[feature]?.availability === 'error').map(feature => <p key={feature}>{feature} locations unavailable. <button type="button" onClick={() => retry(feature)}>Retry</button></p>)}
    {loaded.every(value => value && value.availability !== 'error') && !locations.length && <p>No valid source coordinates are available.</p>}
    <p className="fn">Only coordinates present in these two registers are plotted. Locations may be approximate; this map conveys coverage, not measured risk or completeness.</p>
  </section>;
}

export function GlobalLandingContent({ buckets, summaries, onFeature, retry, label = 'Global', query = '', sourceFilter = 'all', onQuery = () => {}, onFilter = () => {} }) {
  const [paused, setPaused] = useState(false);
  const motionRef = useNationalMotion(paused);
  const modules = buckets.flatMap(bucket => bucket.items), values = Object.values(summaries), aggregate = total(values);
  const pending = modules.some(module => !summaries[module.htmlFeature]);
  const modes = mode => values.filter(summary => summary.sourceMode === mode).length;
  const sources = [...new Map(values.flatMap(summary => (summary.sources || []).slice(0, 1)).map(source => [source.name, source])).values()].slice(0, 5);
  const matches = module => `${module.htmlFeature} ${titleFor(module.htmlFeature)}`.toLowerCase().includes(query.trim().toLowerCase()) && (sourceFilter === 'all' || summaries[module.htmlFeature]?.sourceMode === sourceFilter);
  const visible = modules.filter(matches).length, filtered = !!query.trim() || sourceFilter !== 'all';
  const maxCount = Math.max(1, ...values.map(summary => summary.count || 0));
  const shortcuts = [['Open Fronts', 'Follow a conflict theatre', 'Explore recorded stages, intensity and developments.'], ['Alliances', 'Understand an alliance', 'Read membership, obligations and institutional exceptions.'], ['Global Trade', 'Explore world trade', 'Compare the available country indicators and observation years.']];
  let offset = 0;
  return <div className="desk desk-wide national-landing global-landing" ref={motionRef}>
    <div className="backdrop" aria-hidden="true"><div className="bg on globe-bg"><GlobalGlobe/></div><div className="veil"/></div>
    <div className="page"><section className="hero" aria-labelledby="gl-title"><div className="nl-hero-copy"><div className="kicker"><span className="pill">{label} desk</span><span>{buckets.length} segments · {modules.length} modules · public-source registers</span></div><h1 id="gl-title"><span className="w">The world,</span><br/><span className="w">one register at a time.</span></h1><p className="lede">Explore <b>security, diplomacy, strategic assets and the world economy.</b> Read each register with its source and coverage in view.</p><div className="sources"><b>Sources</b>{sources.length ? sources.map(source => <span key={source.name}><a href={source.url} target="_blank" rel="noreferrer">{source.name} ↗</a></span>) : <span>Source summaries load below</span>}</div></div>
      <button type="button" className="nl-motion-toggle" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? 'Resume motion' : 'Pause motion'}</button>
      <div className="stats" aria-label="Global register overview"><div className="stat"><span className="l">Records across registers</span><b className="v">{fmt(aggregate.count)}</b><span className="s">{aggregate.loaded}/{modules.length} measured counts · illustrative board excluded</span></div>
        <div className="stat live"><span className="l">Stored modules</span><b className="v">{pending && !modes('stored') ? '—' : modes('stored')}</b><span className="s">Source-linked snapshots</span></div>
        <div className="stat wire"><span className="l">Feed-backed modules</span><b className="v">{pending && !modes('feed-backed') ? '—' : modes('feed-backed')}</b><span className="s">Retrieval · coverage varies</span></div>
        <div className="stat"><span className="l">Modules to explore</span><b className="v">{modules.length}</b><span className="s">{buckets.length} research groups</span></div>
        <div className="stat donut"><svg viewBox="0 0 70 70" aria-hidden="true"><circle cx="35" cy="35" r="25" stroke="var(--hair)"/>{MODES.map(([mode,,color]) => {const length=modes(mode)/Math.max(1,modules.length)*157.08,start=offset;offset+=length;return <circle key={mode} cx="35" cy="35" r="25" stroke={color} strokeDasharray={`${length} ${157.08-length}`} strokeDashoffset={-start}/>;})}</svg><div className="lg">{MODES.map(([mode,name,color])=><span key={mode}><i style={{background:color}}/>{name} <b>{pending&&!modes(mode)?'—':modes(mode)}</b></span>)}</div></div>
      </div></section>
      <div className="bar"><h2>Find your starting point.</h2><span className="sub">Explore a register.</span><div className="tools"><label className="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><input type="search" aria-label="Find a module" value={query} onChange={event => onQuery(event.target.value)} placeholder="Search modules…"/></label><SourceControl value={sourceFilter} onChange={onFilter}/></div></div>
      <p className="nl-progress" role="status">{pending?'Loading summaries':'Source summaries'} · {values.length} of {modules.length} summaries received · {visible} matching {visible === 1 ? 'module' : 'modules'}</p>
      <div className="segments">{buckets.map((bucket,index)=>{const group=GROUPS[index]||GROUPS[0],sum=total(bucket.items.map(module=>summaries[module.htmlFeature]));return <article className={`seg${bucket.items.some(matches)?'':' empty'}`} key={bucket.label} onAnimationEnd={event=>{if(event.target===event.currentTarget)event.currentTarget.style.animation='none';}} style={{animationDelay:`${350+index*90}ms`}}><div className="pic"><GlobalTile scene={group.scene}/><div className="cap"><span className="n">0{index+1}</span><h3>{group.title}</h3></div></div><div className="sh"><p>{group.copy}</p><div className="tot"><b>{fmt(sum.count)}</b><span>records</span><span className="mods">{bucket.items.length} {bucket.items.length === 1 ? 'module' : 'modules'}</span></div></div><div className="list">{bucket.items.map(module=><ModuleRow key={module.htmlFeature} module={module} title={titleFor(module.htmlFeature)} summary={summaries[module.htmlFeature]} onFeature={onFeature} retry={retry} matches={matches(module)} filtered={filtered} maxCount={maxCount}/>)}</div></article>;})}</div>
      {!visible&&<div className="nl-empty"><p>No modules match these filters.</p><button type="button" onClick={()=>{onQuery('');onFilter('all');}}>Clear filters</button></div>}
      <div className="band"><LocationMap summaries={summaries} retry={retry} onFeature={onFeature}/><section className="card" aria-labelledby="gl-start-title"><div className="ch"><h3 id="gl-start-title">Start with a question.</h3><span className="sub">Three ways in.</span></div><div className="starts">{shortcuts.map(([feature,title,copy],index)=><button type="button" className="start" key={feature} onClick={()=>onFeature(feature)}><span className="ic" aria-hidden="true">0{index+1}</span><span className="tx"><b>{title}</b><span>{copy}</span></span><span className="arr" aria-hidden="true">→</span></button>)}</div><p className="fn">Registers contain different kinds of entries. Totals do not establish unique entities, freshness or completeness.</p></section></div>
      <footer className="foot"><span><i className="live"/>Stored snapshots</span><span><i className="wire"/>Feed-backed retrieval</span><span><i/>Curated / unavailable</span><span className="right">Log-scale tracks · open ⓘ for coverage and source dates</span></footer>
    </div>
  </div>;
}

export default function GlobalLandingView({ buckets = [], onFeature, label, lang }) {
  const [query,setQuery]=useState(''),[sourceFilter,setFilter]=useState('all');
  const {summaries,retry}=useGlobalLanding(buckets.flatMap(bucket=>bucket.items.map(module=>module.htmlFeature)));
  return <GlobalLandingContent buckets={buckets} summaries={summaries} retry={retry} onFeature={onFeature} label={lang==='hi'?'वैश्विक':label||'Global'} query={query} sourceFilter={sourceFilter} onQuery={setQuery} onFilter={setFilter}/>;
}
