import { useId, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, ChevronDown, Database, FileText, Network, Newspaper, Pause, Play, Users } from 'lucide-react';
import { DESK_IMAGES, DESK_IMAGE_CREDITS } from './deskImages.js';
import { deskHash } from '../../lib/deskRoute.js';
import { isTechnicalNote } from '../../lib/plainSourceNote.js';
import { formatCount, moduleAvailability, sourceDate, summarizeModules } from './deskPresentation.js';
import V6Photo from './V6Photo.jsx';
import V6Dialog from './V6Dialog.jsx';
import useDeskLandingMotion, { exploreDeskSectors } from './useDeskLandingMotion.js';
import './deskLandingV6.css';

const hasSource = summary => Boolean(summary && (summary.sources?.some(source => safeUrl(source.url)) || (!['error', 'unavailable'].includes(summary.availability) && ['stored', 'feed-backed', 'curated', 'simulated'].includes(summary.sourceMode))));
export const groupsWithSources = (groups, summaries) => groups.filter(group => group.modules.some(module => hasSource(summaries[module.feature])));
const safeUrl = value => { try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; } };
const Count = ({ value }) => <span data-v6-count={Number.isInteger(value) ? value : undefined}>{formatCount(value)}</span>;

const ModuleIcon = ({ module, summary }) => {
  const Icon = module.feature.includes('Graph') ? Network : summary?.sourceMode === 'feed-backed' ? Newspaper : /Candidate|Profiles|Heads/.test(module.feature) ? Users : FileText;
  return <Icon aria-hidden="true" />;
};
const moduleNote = (module, summary) => `${formatCount(summary?.count)} ${summary?.unit || 'records'} · ${moduleAvailability(module, summary)}`;


export function ModuleDetail({ module, summary, onOpen, retry, titleId, tab = module.tier }) {
  const sources = (summary?.sources || []).filter(source => safeUrl(source.url));
  return <div className="detail-inner"><div className="eyebrow">MODULE COVERAGE</div><h2 id={titleId}>{module.title}</h2><span className="status">{moduleAvailability(module, summary)}</span><div className="detail-count"><b>{formatCount(summary?.count)}</b><span>{summary?.unit || 'records'}</span></div><p className="detail-note" title={isTechnicalNote(summary?.sourceNote) ? summary.sourceNote : undefined}>{summary?.limitations || 'Source coverage is not available yet.'}</p><h3>FIELDS &amp; COVERAGE</h3><div className="field-chips">{summary?.columns?.length ? summary.columns.map(column => <span key={column.key}>{column.label}</span>) : <span>No populated fields reported</span>}</div><h3>ABOUT THE DATA</h3><p>{sourceDate(summary?.asOf)}{summary?.period ? ` · ${summary.period}` : ''}</p>{summary?.resourceKey && summary.resourceKey !== module.feature && <p>Uses the shared {summary.resourceKey === 'judiciary-sc-orders' ? 'Supreme Court order' : summary.resourceKey} register. Counted once in desk totals.</p>}<div className="field-chips source-links">{sources.map(source => <a href={safeUrl(source.url)} target="_blank" rel="noopener noreferrer" key={source.url}>{source.name}<ArrowUpRight aria-hidden="true" /></a>)}</div>{!sources.length && <p>Source links are not supplied in this summary.</p>}<div className="detail-action"><p>Open the existing workspace to explore its records.</p><div>{summary?.availability === 'error' && !summary.pending && retry && <button onClick={() => retry(module.feature)}>Retry summary</button>}<a className="primary" href={`/${deskHash(tab, module.feature)}`} onClick={event => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpen(module.feature); }}>Open in Terminal <ArrowUpRight aria-hidden="true" /></a></div></div></div>;
}
/**
 * Brings the chosen sector's modules into view when they are off screen (below the fold on a phone or a
 * short window), and after a keyboard selection moves focus to the list. Returns whether it scrolled.
 */
export function revealModules(list, { instant = false, keyboard = false, viewportTop, viewportHeight } = {}) {
  const explorer = list?.closest?.('.explorer');
  if (!explorer) return false;
  const view = viewportHeight === undefined ? visibleArea(explorer) : { top: viewportTop ?? 0, bottom: (viewportTop ?? 0) + viewportHeight };
  const { top, height } = explorer.getBoundingClientRect();
  const offscreen = top < view.top || top + Math.min(height, 160) > view.bottom;
  if (offscreen) explorer.scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'start' });
  if (keyboard) list.focus({ preventScroll: true });
  return offscreen;
}
/** The visible band of the nearest scrolling ancestor (the terminal scrolls its content, not the page). */
function visibleArea(el) {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (/(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight) {
      const r = node.getBoundingClientRect();
      return { top: r.top, bottom: r.top + node.clientHeight };
    }
  }
  return { top: 0, bottom: window.innerHeight };
}
export function DataBreakdown({ title, items, stages = [], asOf, titleId, description }) {
  const max = Math.max(1, ...items.map(item => item.count));
  return <div className="detail-inner"><div className="eyebrow">COVERAGE OVERVIEW</div><h2 id={titleId}>{title}</h2><p>{description || (title === 'Bills by sector' ? 'Classification from the prepared register. Missing classifications remain visible.' : 'Known counts grouped by research sector. Missing totals are not treated as zero; see each module for its units.')}</p><div className="breakdown-chart">{items.length ? items.map(item => <div className="breakdown-row" key={item.label}><span>{item.label}</span><b>{formatCount(item.count)}</b><div><i style={{ width: `${item.count / max * 100}%` }} /></div></div>) : <p>Distribution is not available yet.</p>}</div>{stages.length > 0 && <><h3>BILL STAGES</h3><div className="field-chips">{stages.map(stage => <span key={stage.label}>{stage.label} <b>{formatCount(stage.count)}</b></span>)}</div></>}<p className="detail-note">{sourceDate(asOf)}. See each module for its source and coverage limitations.</p></div>;
}
function Insight({ items, count, onOpen, national, highlight }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...items.map(item => item.count));
  return <aside className={`hero-insight ${hover ? 'chart-active' : ''}`} aria-label="Desk data highlight"><div className="insight-top">{national ? 'THE LEGISLATIVE LANDSCAPE' : 'DESK COVERAGE'}<i /></div><div className="insight-number"><b><Count value={count} /></b><span>{highlight?.unit || (national ? 'bills on record' : 'counted records')}</span></div><div className="mini-bars" role="group" aria-label={highlight?.title || (national ? 'Bills by sector' : 'Known counts by sector')}>{items.map((item, index) => <button key={item.label} className="mini-bar" style={{ '--height': `${Math.max(5, item.count / max * 100)}%`, '--i': index }} aria-label={`${item.label}: ${formatCount(item.count)} ${highlight?.unit || 'records'}`} onPointerEnter={() => setHover(item)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(item)} onBlur={() => setHover(null)} onClick={onOpen}><i /></button>)}</div><div className="insight-foot"><span>{hover ? `${hover.label} · ${formatCount(hover.count)}` : items.length ? (highlight?.title || 'KNOWN COUNTS BY SECTOR') : 'Distribution unavailable'}</span><button onClick={onOpen}>View data <ArrowUpRight aria-hidden="true" /></button></div></aside>;
}

export function ModuleExplorer({ presentation, group, summaries, onSector, onFeature, id, lang = 'en' }) {
  return <section className={`explorer ${group?.id === 'economy' ? 'budget-sector' : ''}`} aria-labelledby={`${id}-explorer`}>
    <div className="explorer-heading">
      <div><span className="eyebrow">INSIDE THIS SECTOR</span><h2 id={`${id}-explorer`}>{group?.name}</h2><p>{group?.description}</p></div>
      <span className="explorer-badge">{group?.modules.length || 0} modules · {group?.modules.filter(module => hasSource(summaries[module.feature])).length || 0} with sources</span>
      <div className="explorer-selector"><label htmlFor={`${id}-sector`}>{lang === 'hi' ? 'सेक्टर चुनें' : 'Select a sector'}</label>
        <div className="explorer-selector-control"><select id={`${id}-sector`} title={group?.name} value={group?.id || ''} onChange={event => onSector(event.target.value)}>
          {presentation.groups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select><ChevronDown aria-hidden="true" /></div>
      </div>
    </div>
    <div key={group?.id} className="module-list refresh" id={`${id}-modules`} tabIndex={0} aria-label="Modules in the selected sector">
      {group?.modules.map((module, index) => <a className="module-item" key={module.feature} style={{ '--i': index }} href={`/${deskHash(presentation.id, module.feature)}`} aria-label={`${module.title}: ${moduleNote(module, summaries[module.feature])}`} onClick={event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); onFeature(module.feature);
      }}><span className="module-icon"><ModuleIcon module={module} summary={summaries[module.feature]} /></span><span className="module-copy"><b>{module.title}</b><span>{moduleNote(module, summaries[module.feature])}</span></span><ArrowRight aria-hidden="true" /></a>)}
    </div>
  </section>;
}

export default function DeskLandingFrame({ presentation, summaries = {}, onFeature, lang = 'en', toolbar, metrics, dataHighlight }) {
  const [selected, setSelected] = useState(presentation.groups[0]?.id);
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const sectors = useRef(null);
  const id = useId();
  const modules = presentation.groups.flatMap(group => group.modules);
  const aggregate = summarizeModules(modules, summaries);
  const groups = filter === 'sources' ? groupsWithSources(presentation.groups, summaries) : presentation.groups;
  const group = presentation.groups.find(item => item.id === selected) || presentation.groups[0];
  const national = presentation.id === 'national';
  const bills = national ? summaries['Bill Passage Probability Index'] : null;
  const defaultMetrics = [{ label: 'Counted records', value: aggregate.count, note: 'Known counts; shared resources counted once' }, { label: 'Modules', value: modules.length, note: 'Full section catalogue' }, { label: 'Sectors', value: presentation.groups.length, note: 'Areas to explore' }];
  const shownMetrics = metrics || defaultMetrics;
  const insightCount = dataHighlight ? dataHighlight.count : national ? bills?.count : aggregate.count;
  // The count-up follows the numbers on screen (the insight and the stat tiles), not the raw summaries.
  const motion = useDeskLandingMotion([insightCount, ...shownMetrics.map(metric => metric.value)].join(','));
  const items = dataHighlight?.items || (national ? bills?.sectors || [] : presentation.groups.map(item => ({ label: item.short, count: summarizeModules(item.modules, summaries).count })).filter(item => item.count != null));
  // Owner, 2026-10-13: a picture card only selects its sector. The chosen card is marked and the
  // explorer is brought into view when it is off screen; the module cards below open the terminal.
  const chooseSector = (item, event) => {
    setSelected(item.id);
    setAnnouncement(`${item.name}: ${item.modules.length} modules shown below.`);
    const keyboard = event?.detail === 0;
    // After React commits, so the list shows the new sector.
    requestAnimationFrame(() => revealModules(document.getElementById(`${id}-modules`), { instant: motion.paused || motion.reduced, keyboard }));
  };

  return <div ref={motion.ref} className={`desk-v6 ${motion.paused ? 'motion-paused' : ''} ${!['national', 'global', 'law'].includes(presentation.id) ? 'expanded-desk' : ''}`} data-desk={presentation.id} lang={lang}>
    <div className="v6-main"><div className="crumb"><span>INTELLIGENCE DESKS</span><span>/</span><b>{presentation.name}</b><span className="snapshot"><i />{aggregate.pending ? 'Loading summaries' : 'Summary requests complete'}</span>{toolbar}</div>
      <section className="hero" aria-labelledby={`${id}-title`}><div className="hero-photo" aria-hidden="true"><img src={DESK_IMAGES[presentation.image] || DESK_IMAGES[`${presentation.image}.jpg`]} alt="" fetchPriority="high" /></div><div className="hero-copy"><div className="eyebrow"><span className="small-line" />THE {presentation.name.toUpperCase()} DESK</div><h1 id={`${id}-title`}>{presentation.title[0]}<br /><span>{presentation.title[1]}</span></h1><p>{presentation.description}</p><div className="hero-bottom"><button className="primary" onClick={() => exploreDeskSectors(sectors.current, motion.paused)}>Explore the desk <ArrowRight aria-hidden="true" /></button><span className="hero-meta">{presentation.groups.length} sectors · {modules.length} modules · one perspective</span></div></div><Insight items={items} count={insightCount} national={national} highlight={dataHighlight} onOpen={() => setDetail('data')} /><span className="photo-label">{presentation.imageLabel}</span></section>
      <section className="stats" aria-label="Desk statistics">{shownMetrics.map(metric => <div className="stat" key={metric.label}><div className="stat-label"><Database aria-hidden="true" />{metric.label}</div><div className="stat-value"><Count value={metric.value} /></div><div className="stat-note">{metric.note}</div></div>)}</section>
      <div className="section-heading"><div><h2>{presentation.heading}</h2><span>Choose a sector. Explore its records.</span></div><div className="sector-controls"><span>{groups.length} sectors to explore</span><div className="segmented" aria-label="Sector coverage filter"><button aria-pressed={filter === 'all'} onClick={() => { setFilter('all'); setAnnouncement('Showing all sectors.'); }}>All</button><button aria-pressed={filter === 'sources'} onClick={() => { setFilter('sources'); setAnnouncement('Showing sectors with sources.'); }}><i />With sources</button></div></div></div>
      <p aria-live="polite" aria-atomic="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>{announcement}</p><section ref={sectors} className="sector-grid" style={{ '--sector-columns': Math.max(1, Math.min(groups.length, 5)) }} aria-label="Research sectors">{groups.map(item => { const totals = summarizeModules(item.modules, summaries); const index = presentation.groups.indexOf(item); const modes = [...new Set(item.modules.map(module => summaries[module.feature]?.sourceMode).filter(mode => mode && mode !== 'unknown'))]; return <button type="button" className="sector-card" key={item.id} style={{ '--i': index }} aria-pressed={group?.id === item.id} aria-controls={`${id}-modules`} aria-label={`Show ${item.name}: ${item.modules.length} modules`} onClick={event => chooseSector(item, event)}><div className={`card-picture picture-${item.image}`} data-image={item.image}><V6Photo name={item.image} /><span className="card-number">{String(index + 1).padStart(2, '0')}</span><span className="card-count">{item.modules.length} modules</span></div><div className="card-body"><div className="card-title-row"><h3>{item.title[0]}<br />{item.title[1]}</h3></div><p className="card-desc">{item.cardDescription || item.description}</p><div className="card-bottom"><span className="card-total">{formatCount(presentation.coverageCounts ? totals.pending && !totals.knownModules ? null : totals.knownModules : totals.count)}{totals.pending && (presentation.coverageCounts ? totals.knownModules > 0 : totals.count != null) ? '+' : ''}<small>{presentation.coverageCounts ? 'measured modules' : 'records'}</small></span><span className="status">{modes.length > 1 ? 'Mixed sources' : modes[0] === 'stored' ? 'Stored register' : modes[0] === 'feed-backed' ? 'News & feeds' : modes[0] === 'curated' ? 'Curated records' : modes[0] === 'simulated' ? 'Illustrative simulation' : totals.pending ? 'Loading' : 'Coverage unavailable'}</span></div></div></button>; })}</section>
      <ModuleExplorer presentation={presentation} group={group} summaries={summaries} onSector={setSelected} onFeature={onFeature} id={id} lang={lang} />
      <footer><span>Counts reflect available source summaries; coverage varies.</span><div><a href={DESK_IMAGE_CREDITS} target="_blank" rel="noopener noreferrer">Image credits</a><button onClick={motion.toggle} disabled={motion.reduced} aria-pressed={motion.paused}>{motion.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}{motion.reduced ? 'Reduced motion' : motion.paused ? 'Resume motion' : 'Pause motion'}</button></div></footer>
    </div>{detail && <V6Dialog titleId={`${id}-dialog`} onClose={() => setDetail(null)}><DataBreakdown title={dataHighlight?.title || (national ? 'Bills by sector' : 'Coverage at a glance')} items={items} stages={bills?.stages} asOf={dataHighlight?.asOf || bills?.asOf} description={dataHighlight?.description} titleId={`${id}-dialog`} /></V6Dialog>}
  </div>;
}
