import { Fragment, useEffect, useRef, useState } from 'react';
import { featureMenuLabel } from '../lib/national.js';
import { aggregateNationalSummaries, BILL_FEATURE, NATIONAL_FEATURES } from '../lib/nationalLandingSummary.js';
import { useNationalLanding } from './useNationalLanding.js';
import { useNationalMotion } from './useNationalMotion.js';
import NationalLandingArtwork from './NationalLandingArtwork.jsx';
import './nationalLanding.css';

const GROUPS = [
  { title: 'Legislative & Policy', scene: 'chamber', copy: 'Bills, parliamentary questions and regulatory records.' },
  { title: 'Electoral', scene: 'ballot', copy: 'Candidate disclosures and affidavit records.' },
  { title: 'Representatives', scene: 'microphones', copy: 'Member profiles, constituencies and recorded activity.' },
  { title: 'Government Operations', scene: 'secretariat', copy: 'Posting orders, tenders, PIB releases and programmes.' },
  { title: 'Economy & Industry', scene: 'economy', copy: 'Budget allocations and economic reference series.' },
];
const MODES = { stored: 'Stored', 'feed-backed': 'Feed-backed', curated: 'Curated', unknown: 'Unavailable' };
const DISPLAY_NAMES = {
  [NATIONAL_FEATURES[3]]: 'Regulatory body watch',
  [NATIONAL_FEATURES[5]]: 'MP profiles & recorded activity',
  [NATIONAL_FEATURES[9]]: 'Flagship programmes',
  [NATIONAL_FEATURES[10]]: 'Budget allocations & schemes',
  [NATIONAL_FEATURES[11]]: 'Industry reference series',
};
const displayName = name => DISPLAY_NAMES[name] || featureMenuLabel(name);
const fmt = n => n == null ? '—' : n.toLocaleString('en-IN');
const date = s => s && Number.isFinite(Date.parse(s)) ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Source date unavailable';
const modeClass = mode => mode === 'stored' ? 'live' : mode === 'feed-backed' ? 'wire' : 'plan';

export function ModuleRow({ module, summary, onFeature, retry, matches, filtered, maxCount, title = displayName(module.htmlFeature) }) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const name = module.htmlFeature;
  const state = summary?.availability || 'loading';
  const sourceLabel = state === 'unavailable' ? 'Illustrative · measured data unavailable' : name === NATIONAL_FEATURES[2] && summary?.sourceMode === 'stored' ? 'Stored · Sampled questions' : MODES[summary?.sourceMode];
  const width = summary?.count == null ? 0 : Math.log1p(summary.count) / Math.log1p(maxCount) * 100;
  return <div className={`mod ${modeClass(summary?.sourceMode)}${matches ? filtered ? ' hit' : '' : ' dim'}${open ? ' open' : ''}${dismissed ? ' dismissed' : ''}`} onPointerEnter={() => setDismissed(false)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setDismissed(false); } }} onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.querySelector('.nl-open').focus(); setOpen(false); setDismissed(true); } }} inert={!matches} aria-hidden={!matches ? true : undefined}>
    <i className="st" aria-hidden="true"/>
    <button type="button" className="nl-open" data-feature={name} onClick={() => onFeature(name)}>
      <span className="name">{title}</span><span className="cnt">{fmt(summary?.count)}<small>{summary?.unit || 'records'}</small></span>
    </button>
    <div className={`track${summary?.count == null ? ' unknown' : ''}`} aria-hidden="true"><i style={{ width: `${width}%`, '--w': `${width}%` }}/></div>
    <div className="note">{state === 'loading' ? 'Loading source summary…' : state === 'error' ? 'Summary unavailable' : sourceLabel}<button type="button" className="nl-coverage" aria-label={`Coverage and fields: ${title}`} aria-expanded={open} onClick={() => { setDismissed(false); setOpen(value => !value); }}>ⓘ</button></div>
    <div className="cols">
      {summary?.columns?.map(column => <span key={column.key || column.label}>{column.label}</span>)}
      {!summary?.columns?.length && <p>Field summary unavailable.</p>}
      {open && <><p>{summary?.limitations || 'Source summary is not yet available.'}</p><p>{date(summary?.asOf)}{summary?.period ? ` · Observation years ${summary.period}` : ''}</p></>}
      {open && summary?.sources?.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.name} ↗</a>)}
      {open && state === 'error' && <button type="button" onClick={() => retry(name)}>Retry summary</button>}
      <button type="button" className="go" onClick={() => onFeature(name)}>Open register ↗</button>
    </div>
  </div>;
}

export function SourceControl({ value, onChange }) {
  const ref = useRef(null);
  const [thumb, setThumb] = useState({ left: 3, width: 60 });
  useEffect(() => {
    const node = ref.current;
    const measure = () => {
      const button = node?.querySelector('[aria-pressed="true"]');
      if (button) setThumb({ left: button.offsetLeft, width: button.offsetWidth });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (node) observer?.observe(node);
    return () => observer?.disconnect();
  }, [value]);
  return <div className="segc" ref={ref} role="group" aria-label="Source type"><span className="thumb" style={thumb} aria-hidden="true"/>{[['all', 'All'], ['stored', 'Stored'], ['feed-backed', 'Feed-backed'], ['curated', 'Curated']].map(([key, title]) => <button type="button" key={key} className={`f-${key === 'all' ? 'all' : modeClass(key)}`} aria-pressed={value === key} onClick={() => onChange(key)}><i aria-hidden="true"/>{title}</button>)}</div>;
}

export function NationalLandingContent({ buckets, summaries, onFeature, retry, label = 'National', query = '', sourceFilter = 'all', onQuery = () => {}, onFilter = () => {} }) {
  const [paused, setPaused] = useState(false);
  const motionRef = useNationalMotion(paused);
  const modules = buckets.flatMap(bucket => bucket.items);
  const values = Object.values(summaries);
  const total = aggregateNationalSummaries(values);
  const resourceCount = new Set(modules.map(module => module.htmlFeature === NATIONAL_FEATURES[1] ? BILL_FEATURE : module.htmlFeature)).size;
  const pending = modules.some(module => !summaries[module.htmlFeature]);
  const modeCount = mode => values.filter(summary => summary.sourceMode === mode).length;
  const bill = summaries[BILL_FEATURE];
  const sources = [...new Map(values.flatMap(summary => summary.sources || []).map(source => [source.name, source])).values()].slice(0, 5);
  const matches = module => `${module.htmlFeature} ${displayName(module.htmlFeature)}`.toLowerCase().includes(query.trim().toLowerCase()) && (sourceFilter === 'all' || summaries[module.htmlFeature]?.sourceMode === sourceFilter);
  const visible = modules.filter(matches).length;
  const filtered = !!query.trim() || sourceFilter !== 'all';
  const sectors = bill?.sectors || [];
  const maxSector = Math.max(1, ...sectors.map(sector => sector.count));
  const maxCount = Math.max(1, ...values.map(summary => summary.count || 0));
  const shortcuts = [
    [NATIONAL_FEATURES[0], 'Track a bill', 'Explore the recorded stage and legislative history.'],
    [NATIONAL_FEATURES[2], 'Explore parliamentary questions', 'Browse members, ministries and tabled questions.'],
    [NATIONAL_FEATURES[4], 'Read candidate disclosures', 'Review available assets, liabilities and case records.'],
  ];
  const loadedLabel = `${total.loaded}/${resourceCount} resources loaded · shared bills counted once`;
  const knownModes = ['stored', 'feed-backed', 'curated'];
  const colors = ['#16a34a', '#d97706', '#4c2bb3'];
  let donutOffset = 0;
  return <div className="desk desk-wide national-landing" ref={motionRef}>
    <div className="backdrop" aria-hidden="true"><div className="bg on"><NationalLandingArtwork/></div><div className="veil"/></div>
    <div className="page">
      <section className="hero" aria-labelledby="nl-title">
        <div className="nl-hero-copy"><div className="kicker"><span className="pill">{label} desk</span><span>{buckets.length} segments · {modules.length} modules · public records</span></div><h1 id="nl-title"><span className="w">The Republic,</span><br/><span className="w">on record.</span></h1><p className="lede">Explore <b>legislation, representatives and government activity.</b> See what each register holds before opening it.</p><div className="sources"><b>Sources</b>{sources.length ? sources.map(source => <span key={source.name}><a href={source.url} target="_blank" rel="noreferrer">{source.name} ↗</a></span>) : <span>Source summaries load below</span>}</div></div>
        <button type="button" className="nl-motion-toggle" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? 'Resume motion' : 'Pause motion'}</button>
        <div className="stats" aria-label="National register overview">
          <div className="stat"><span className="l">Records across registers</span><strong className="v">{fmt(total.count)}</strong><span className="s">{loadedLabel}</span></div>
          <div className="stat live"><span className="l">Stored modules</span><strong className="v">{pending && !modeCount('stored') ? '—' : modeCount('stored')}</strong><span className="s">Snapshot-based records</span></div>
          <div className="stat wire"><span className="l">Feed-backed modules</span><strong className="v">{pending && !modeCount('feed-backed') ? '—' : modeCount('feed-backed')}</strong><span className="s">Retrieval · coverage varies</span></div>
          <div className="stat"><span className="l">Modules to explore</span><strong className="v">{modules.length}</strong><span className="s">{buckets.length} research groups</span></div>
          <div className="stat donut"><svg viewBox="0 0 70 70" aria-hidden="true"><circle cx="35" cy="35" r="25" stroke="var(--hair)"/>{knownModes.map((mode, index) => { const length = modeCount(mode) / Math.max(1, modules.length) * 157.08; const offset = donutOffset; donutOffset += length; return <circle key={mode} cx="35" cy="35" r="25" stroke={colors[index]} strokeDasharray={`${length} ${157.08 - length}`} strokeDashoffset={-offset}/>; })}</svg><div className="lg">{knownModes.map((mode, index) => <span key={mode}><i style={{ background: colors[index] }}/>{MODES[mode]} <b>{pending && !modeCount(mode) ? '—' : modeCount(mode)}</b></span>)}</div></div>
        </div>
      </section>
      <div className="bar"><h2>Find your starting point.</h2><span className="sub">Explore a register.</span><div className="tools"><label className="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><input type="search" aria-label="Find a module" value={query} onChange={event => onQuery(event.target.value)} placeholder="Search modules…"/></label><SourceControl value={sourceFilter} onChange={onFilter}/></div></div>
      <p className="nl-progress" role="status">{pending ? 'Loading summaries' : 'Source summaries'} · {total.loaded} of {resourceCount} resources available · {visible} matching modules</p>
      <div className="segments">{buckets.map((bucket, index) => {
        const group = GROUPS[index] || GROUPS[0];
        const groupTotal = aggregateNationalSummaries(bucket.items.map(module => summaries[module.htmlFeature]).filter(Boolean));
        return <article className={`seg${bucket.items.some(matches) ? '' : ' empty'}`} key={bucket.label} onAnimationEnd={event => { if (event.target === event.currentTarget) event.currentTarget.style.animation = 'none'; }} style={{ animationDelay: `${350 + index * 90}ms` }}><div className="pic"><NationalLandingArtwork scene={group.scene}/><div className="cap"><span className="n">0{index + 1}</span><h3>{group.title}</h3></div></div><div className="sh"><p>{group.copy}</p><div className="tot"><b>{fmt(groupTotal.count)}</b><span>records</span><span className="mods">{bucket.items.length} modules</span></div></div><div className="list">{bucket.items.map(module => <ModuleRow key={module.htmlFeature} module={module} summary={summaries[module.htmlFeature]} onFeature={onFeature} retry={retry} matches={matches(module)} filtered={filtered} maxCount={maxCount}/>)}</div></article>;
      })}</div>
      {!visible && <div className="nl-empty"><p>No modules match these filters.</p><button type="button" onClick={() => { onQuery(''); onFilter('all'); }}>Clear filters</button></div>}
      <div className="band"><section className="card" aria-labelledby="nl-chart-title"><div className="ch"><h3 id="nl-chart-title">Bills by sector</h3><span className="sub">{fmt(bill?.count)} bill records</span><span className="src">{date(bill?.asOf)}</span></div>
        {!bill ? <p role="status">Loading bill distribution…</p> : bill.availability === 'error' ? <><p>Bill distribution unavailable.</p><button type="button" onClick={() => retry(BILL_FEATURE)}>Retry summary</button></> : !sectors.length ? <p>No bill records available.</p> : <div className="bars">{sectors.map(sector => <Fragment key={sector.label}><span className="k" title={sector.label}>{sector.label}</span><div className="t" aria-hidden="true"><i style={{ width: `${sector.count / maxSector * 100}%`, '--w': `${sector.count / maxSector * 100}%` }}/></div><b className="v">{fmt(sector.count)}</b></Fragment>)}</div>}<p className="fn">Classification in the stored bill register. Counts are records, not unique people or verified completeness.</p>
      </section><section className="card" aria-labelledby="nl-start-title"><div className="ch"><h3 id="nl-start-title">Start with a question.</h3><span className="sub">Three ways in.</span></div><div className="starts">{shortcuts.map(([feature, title, copy], index) => <button type="button" className="start" key={feature} onClick={() => onFeature(feature)}><span className="ic" aria-hidden="true">0{index + 1}</span><span className="tx"><b>{title}</b><span>{copy}</span></span><span className="arr" aria-hidden="true">→</span></button>)}</div><p className="fn">Open a register to work with its records. Coverage and fields vary by source.</p></section></div>
      <footer className="foot"><span><i className="live"/>Stored snapshots</span><span><i className="wire"/>Feed-backed retrieval</span><span><i/>Curated / unavailable</span><span className="right">Module tracks use a log scale · open ⓘ for coverage</span></footer>
    </div>
  </div>;
}

export default function NationalLandingView({ buckets = [], onFeature, label, lang }) {
  const [query, setQuery] = useState(''); const [sourceFilter, setFilter] = useState('all');
  const { summaries, retry } = useNationalLanding(buckets.flatMap(bucket => bucket.items.map(module => module.htmlFeature)));
  return <NationalLandingContent buckets={buckets} summaries={summaries} retry={retry} onFeature={onFeature} label={lang === 'hi' ? 'राष्ट्रीय' : label || 'National'} query={query} onQuery={setQuery} sourceFilter={sourceFilter} onFilter={setFilter}/>;
}
