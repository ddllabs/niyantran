import { useEffect, useRef, useState } from 'react';
import { featureMenuLabel } from '../lib/national.js';
import { NATIONAL_FEATURES } from '../lib/nationalLandingSummary.js';

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

