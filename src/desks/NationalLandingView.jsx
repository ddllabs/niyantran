import { useState } from 'react';
import { featureMenuLabel } from '../lib/national.js';
import { aggregateNationalSummaries, BILL_FEATURE, NATIONAL_FEATURES } from '../lib/nationalLandingSummary.js';
import { useNationalLanding } from './useNationalLanding.js';
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

function ModuleRow({ module, summary, onFeature, retry }) {
  const name = module.htmlFeature;
  const state = summary?.availability || 'loading';
  return <li className={`nl-module nl-state-${state}`}>
    <div className="nl-module-main">
      <button className="nl-open" data-feature={name} onClick={() => onFeature(name)}><span>{displayName(name)}</span><span aria-hidden="true">↗</span></button>
      <div className="nl-module-meta"><span className={`nl-mode nl-mode-${summary?.sourceMode || 'unknown'}`}>{state === 'loading' ? 'Loading' : state === 'error' ? 'Unavailable' : MODES[summary.sourceMode]}</span><span>{fmt(summary?.count)} {state === 'empty' ? 'available records' : 'records'}</span></div>
    </div>
    <details className="nl-details"><summary>Coverage & fields</summary>
      {state === 'loading' ? <p>Loading source summary…</p> : <>
        <p>{summary.limitations || 'Source summary could not be loaded.'}</p>
        <p>{date(summary.asOf)}</p>
        {!!summary.columns?.length && <p><b>Available fields:</b> {summary.columns.map(c => c.label).join(' · ')}</p>}
        {!!summary.sources?.length && <p className="nl-source-links">{summary.sources.map(s => <a href={s.url} key={s.url} target="_blank" rel="noreferrer">{s.name} ↗</a>)}</p>}
        {state === 'error' && <button className="nl-retry" onClick={() => retry(name)}>Retry summary</button>}
      </>}
    </details>
  </li>;
}

export function NationalLandingContent({ buckets, summaries, onFeature, retry, label = 'National', query = '', sourceFilter = 'all', onQuery = () => {}, onFilter = () => {} }) {
  const modules = buckets.flatMap(b => b.items);
  const values = Object.values(summaries);
  const total = aggregateNationalSummaries(values);
  const resourceCount = new Set(modules.map(m => m.htmlFeature === NATIONAL_FEATURES[1] ? BILL_FEATURE : m.htmlFeature)).size;
  const pending = modules.some(m => !summaries[m.htmlFeature]);
  const modeCount = mode => { const count = values.filter(s => s.sourceMode === mode).length; return count || (pending ? '—' : 0); };
  const bill = summaries[BILL_FEATURE];
  const sources = [...new Map(values.flatMap(s => s.sources || []).map(s => [s.name, s])).values()].slice(0, 5);
  const matches = m => `${m.htmlFeature} ${displayName(m.htmlFeature)}`.toLowerCase().includes(query.trim().toLowerCase()) && (sourceFilter === 'all' || summaries[m.htmlFeature]?.sourceMode === sourceFilter);
  const visible = modules.filter(matches).length;
  const sectors = bill?.sectors || [];
  const maxSector = Math.max(1, ...sectors.map(s => s.count));
  const shortcuts = [
    [NATIONAL_FEATURES[0], 'Track a bill', 'Explore the recorded stage and legislative history.'],
    [NATIONAL_FEATURES[2], 'Explore parliamentary questions', 'Browse members, ministries and tabled questions.'],
    [NATIONAL_FEATURES[4], 'Read candidate disclosures', 'Review available assets, liabilities and case records.'],
  ];
  return <div className="desk desk-wide national-landing">
    <section className="nl-hero" aria-labelledby="nl-title">
      <div className="nl-scene"><NationalLandingArtwork /></div>
      <div className="nl-hero-copy"><span className="nl-kicker">{label} desk · Public records</span><h1 id="nl-title">The Republic,<br/>on record.</h1><p>Explore legislation, representatives and government activity. See what each register holds before opening it.</p><div className="nl-sources">{sources.length ? sources.map(s => <a key={s.name} href={s.url} target="_blank" rel="noreferrer">{s.name} ↗</a>) : <span>Source summaries load below</span>}</div></div>
      <div className="nl-stats" aria-label="National register overview">
        <div><span>Records across registers</span><strong>{fmt(total.count)}</strong><small>{total.loaded}/{resourceCount} resources loaded · shared bills counted once</small></div>
        <div><span>Stored modules</span><strong>{modeCount('stored')}</strong><small>Snapshot-based records</small></div>
        <div><span>Feed-backed modules</span><strong>{modeCount('feed-backed')}</strong><small>Source retrieval, coverage varies</small></div>
        <div><span>Modules to explore</span><strong>{modules.length}</strong><small>{buckets.length} research groups</small></div>
      </div>
    </section>
    <section className="nl-directory" aria-labelledby="nl-directory-title">
      <div className="nl-section-bar"><div><h2 id="nl-directory-title">Find your starting point.</h2><p>Open a register, then work with its records.</p></div><div className="nl-tools"><label className="nl-search"><span>Find a module</span><input type="search" value={query} onChange={e => onQuery(e.target.value)} placeholder="Search modules…" /></label><label className="nl-filter"><span>Source type</span><select value={sourceFilter} onChange={e => onFilter(e.target.value)}><option value="all">All sources</option><option value="stored">Stored</option><option value="feed-backed">Feed-backed</option><option value="curated">Curated</option></select></label></div></div>
      <p className="nl-progress" role="status">{pending ? `Loading summaries · ${total.loaded} of ${resourceCount} resources available` : `Source summaries · ${total.loaded} of ${resourceCount} resources available`} · {visible} modules shown</p>
      <div className="nl-groups">{buckets.map((bucket, index) => {
        const items = bucket.items.filter(matches); if (!items.length) return null;
        const group = GROUPS[index] || GROUPS[0];
        return <article className="nl-group" key={bucket.label}><div className="nl-group-picture"><NationalLandingArtwork scene={group.scene}/><div><span>0{index + 1}</span><h3>{group.title}</h3></div></div><p className="nl-group-copy">{group.copy}</p><ul>{items.map(m => <ModuleRow key={m.htmlFeature} module={m} summary={summaries[m.htmlFeature]} onFeature={onFeature} retry={retry}/>)}</ul></article>;
      })}</div>
      {!visible && <div className="nl-empty"><p>No modules match these filters.</p><button onClick={() => { onQuery(''); onFilter('all'); }}>Clear filters</button></div>}
    </section>
    <div className="nl-bottom">
      <section className="nl-chart" aria-labelledby="nl-chart-title"><div className="nl-section-bar"><h2 id="nl-chart-title">Bills by sector</h2><span className="nl-count-label">{fmt(bill?.count)} bill records</span></div><p>Classification in the stored bill register · {date(bill?.asOf)}</p>
        {!bill ? <p role="status">Loading bill distribution…</p> : bill.availability === 'error' ? <><p>Bill distribution unavailable.</p><button onClick={() => retry(BILL_FEATURE)}>Retry summary</button></> : !sectors.length ? <p>No bill records available.</p> : <ul className="nl-bars">{sectors.map(s => <li key={s.label}><div><span>{s.label}</span><b>{fmt(s.count)}</b></div><div className="nl-bar-track"><span style={{ transform: `scaleX(${s.count / maxSector})` }}/></div></li>)}</ul>}
      </section>
      <section className="nl-starts" aria-labelledby="nl-start-title"><h2 id="nl-start-title">Start with a question.</h2><p>Three ways into the National desk.</p>{shortcuts.map(([feature, title, copy], i) => <button key={feature} onClick={() => onFeature(feature)}><span className="nl-start-number">0{i + 1}</span><span><b>{title}</b><small>{copy}</small></span><span aria-hidden="true">→</span></button>)}<p className="nl-footnote">Counts describe available records, not completeness or independent verification. Open coverage details for each module.</p></section>
    </div>
  </div>;
}

export default function NationalLandingView({ buckets = [], onFeature, label, lang }) {
  const [query, setQuery] = useState(''); const [sourceFilter, setFilter] = useState('all');
  const { summaries, retry } = useNationalLanding(buckets.flatMap(b => b.items.map(m => m.htmlFeature)));
  return <NationalLandingContent buckets={buckets} summaries={summaries} retry={retry} onFeature={onFeature} label={lang === 'hi' ? 'राष्ट्रीय' : label || 'National'} query={query} onQuery={setQuery} sourceFilter={sourceFilter} onFilter={setFilter}/>;
}
