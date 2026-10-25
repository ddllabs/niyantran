import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, LockKeyhole, Search } from 'lucide-react';
import { searchDeskCatalogue } from '../desks/landing/deskCatalogue.js';
import { ModuleDetail } from '../desks/landing/DeskLandingFrame.jsx';
import V6Dialog from '../desks/landing/V6Dialog.jsx';
import { deskHash } from '../lib/deskRoute.js';
import { aiDragProps, openAiResearch } from '../lib/aiDrop.js';
import DictationButton from '../components/DictationButton.jsx';
import CommandSearch from './CommandSearch.jsx';
import { loadDeskCatalogueSummary } from './deskCatalogueSummary.js';
import './deskCatalogueSearch.css';

const EMPTY = [];
export const catalogueKeySelection = (key, selected, count) => Math.max(0, Math.min(Math.max(0, count - 1), selected + (key === 'ArrowDown' ? 1 : -1)));

/** A catalogue result is a module, so it drags into AI research as a feature (F134). */
export const catalogueDragProps = entry => aiDragProps({ kind: 'feature', tab: entry.tab, tier: entry.tier, feature: entry.feature, title: entry.title });

export const SEARCH_DRAGGING = 'catalogue-dialog-dragging';

/**
 * While the search is a modal dialog the page behind it is inert and cannot take a drop. On the start
 * of a result drag this opens AI research, then (after the browser has taken the drag image) turns the
 * dialog from modal to a transparent non-modal one: it stays rendered, so the dragged element is not
 * unmounted. The end of the drag, or a drop anywhere, closes the search.
 */
export function createSearchDrag({ getDialog, onEnd, openAi = openAiResearch, schedule = fn => setTimeout(fn, 0), cancel = clearTimeout, getWindow = () => window }) {
  let active = false, timer = null, win = null;
  const detach = () => {
    cancel(timer); timer = null;
    win?.removeEventListener('dragend', end, true); win?.removeEventListener('drop', end, true);
    win = null; active = false;
  };
  function end() {
    if (!active) return;
    detach(); onEnd();
  }
  const hide = () => {
    timer = null;
    const dialog = getDialog();
    if (!dialog?.open) return;
    dialog.classList.add(SEARCH_DRAGGING);
    dialog.close(); dialog.show();
  };
  return {
    start(event) {
      // Only a result starts this, not selected text dragged out of the search field.
      if (active || !event.target?.closest?.('[draggable="true"]')) return;
      active = true;
      openAi();
      win = getWindow();
      win.addEventListener('dragend', end, true); win.addEventListener('drop', end, true);
      timer = schedule(hide);
    },
    end,
    dispose: detach,
  };
}

/**
 * Opens the search. A search left mounted but invisible by a drag whose end never arrived is reset
 * first (closed, then opened on the next tick), so ⌘K and the trigger always work.
 */
export function openSearch({ dialog, drag, setOpen, schedule = fn => setTimeout(fn, 0) }) {
  if (dialog?.classList?.contains(SEARCH_DRAGGING)) {
    drag?.dispose();
    setOpen(false);
    schedule(() => setOpen(true));
    return;
  }
  setOpen(true);
}

export function CatalogueResults({ results, selected, lockedIds, listId, onSelect, onHighlight }) {
  return <div id={listId} role="listbox" aria-label="Module catalogue" className="catalogue-results">
    {results.length ? results.map((entry, index) => <button type="button" role="option" aria-selected={selected === index}
      id={`${listId}-${index}`} key={entry.id} tabIndex={selected === index ? 0 : -1}
      className={`catalogue-result${selected === index ? ' active' : ''}`} onMouseEnter={() => onHighlight(index)} onFocus={() => onHighlight(index)} onClick={() => onSelect(entry)} {...catalogueDragProps(entry)}>
      <span><b>{entry.title}</b><small>{entry.desk} → {entry.group}</small><small className="catalogue-result-kind">Module · Explore coverage</small>{lockedIds.includes(entry.tab) && <small className="catalogue-restriction"><LockKeyhole size={12} aria-hidden="true" />Access restricted</small>}</span><ArrowRight size={17} aria-hidden="true" />
    </button>) : <p className="catalogue-empty">No modules found. Try cricket, music, carbon, bills or courts.</p>}
  </div>;
}

export function CatalogueModuleCoverage({ entry, restricted, summary, titleId, onOpen, retry }) {
  if (!restricted) return <ModuleDetail tab={entry.tab} module={entry} summary={summary} titleId={titleId} onOpen={() => onOpen(entry)} retry={retry} />;
  return <div className="detail-inner"><div className="eyebrow">MODULE CATALOGUE</div><h2 id={titleId}>{entry.title}</h2>
    <span className="status">Access restricted</span><p>{entry.desk} / {entry.group}</p><p>{entry.description}</p>
    <p>Your account does not include this desk. Source coverage has not been requested.</p>
    <div className="detail-action"><p>Open this destination to view access options.</p><a className="primary" href={`/${deskHash(entry.tab, entry.feature)}`} onClick={event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); onOpen(entry);
    }}>Open in Terminal <ArrowUpRight aria-hidden="true" /></a></div>
  </div>;
}

export default function DeskCatalogueSearch({ tabs, recordTabs = EMPTY, lockedIds = EMPTY, identity, lang = 'en', onOpen, searchRecords }) {
  const [open, setOpen] = useState(false), [mode, setMode] = useState('catalogue');
  const [query, setQuery] = useState(''), [selected, setSelected] = useState(0);
  const [detail, setDetail] = useState(null), [coverage, setCoverage] = useState(null), [attempt, setAttempt] = useState(0);
  const trigger = useRef(null), dialog = useRef(null), input = useRef(null), drag = useRef(null);
  if (!drag.current) drag.current = createSearchDrag({ getDialog: () => dialog.current, onEnd: () => setOpen(false) });
  const id = useId(), listId = `${id}-results`, titleId = `${id}-title`;
  const results = useMemo(() => searchDeskCatalogue(query), [query]);
  const active = Math.min(selected, Math.max(0, results.length - 1));
  const lockedKey = lockedIds.join('\0');
  const restricted = Boolean(detail && lockedIds.includes(detail.tab));
  const hi = lang === 'hi';

  useEffect(() => {
    setOpen(false); setDetail(null); setQuery(''); setCoverage(null);
  }, [identity]);
  useEffect(() => {
    const shortcut = event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.altKey) {
        // Do not stack a search modal above another unrelated native dialog.
        if (document.querySelector('dialog[open]') && !dialog.current?.open) return;
        event.preventDefault(); openSearch({ dialog: dialog.current, drag: drag.current, setOpen });
      }
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const current = dialog.current, returnFocus = trigger.current;
    current.showModal(); input.current?.focus();
    return () => { current.close(); returnFocus?.focus(); };
  }, [open]);
  useEffect(() => () => drag.current.dispose(), []);
  useEffect(() => {
    if (open) dialog.current?.querySelector('input')?.focus();
  }, [open, mode]);
  useEffect(() => {
    if (open && mode === 'catalogue') document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, mode, listId, active]);
  useEffect(() => {
    if (!detail || restricted) return undefined;
    const controller = new AbortController();
    void loadDeskCatalogueSummary(detail, { signal: controller.signal, lockedIds: lockedKey.split('\0').filter(Boolean) }).then(summary => {
      if (!controller.signal.aborted && summary) setCoverage({ id: detail.id, summary });
    }).catch(() => {
      if (!controller.signal.aborted) setCoverage({ id: detail.id, summary: { feature: detail.feature, count: null, availability: 'error', sourceMode: 'unknown', columns: [], sources: [] } });
    });
    return () => controller.abort();
  }, [detail, restricted, lockedKey, identity, attempt]);

  const choose = entry => { setOpen(false); setCoverage(null); setDetail(entry); setAttempt(0); };
  const openDestination = entry => { setDetail(null); onOpen({ tab: entry.tab, feature: entry.feature, kind: 'module' }); };
  const keydown = event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = catalogueKeySelection(event.key, active, results.length);
      setSelected(next);
      if (event.target.closest('[role="option"]')) document.getElementById(`${listId}-${next}`)?.focus();
    }
    if (event.key === 'Enter' && results[active]) { event.preventDefault(); choose(results[active]); }
  };
  return <div className="desk-catalogue-search" data-catalogue-desks={tabs?.length || 0}>
    <button ref={trigger} type="button" className="catalogue-open" aria-label={hi ? 'डेस्क, मॉड्यूल और रिकॉर्ड खोजें' : 'Search desks, modules and records'} aria-haspopup="dialog" aria-keyshortcuts="Meta+K Control+K" onClick={() => { openSearch({ dialog: dialog.current, drag: drag.current, setOpen }); }}>
      <Search size={16} aria-hidden="true" /><span className="catalogue-label-long">{hi ? 'डेस्क, मॉड्यूल और रिकॉर्ड खोजें' : 'Search desks, modules and records'}</span><span className="catalogue-label-short" aria-hidden="true">{hi ? 'टर्मिनल में खोजें' : 'Search the terminal'}</span><kbd>⌘ K</kbd>
    </button>
    {open && <dialog ref={dialog} className="catalogue-dialog" aria-labelledby={titleId} onDragStartCapture={event => drag.current.start(event)} onDragEndCapture={() => drag.current.end()} onCancel={event => { event.preventDefault(); setOpen(false); }} onClick={event => {
      if (event.target !== dialog.current) return;
      const rect = dialog.current.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setOpen(false);
    }}>
      <h2 id={titleId} className="catalogue-sr-only">{hi ? 'मॉड्यूल और रिकॉर्ड खोजें' : 'Find modules and records'}</h2>
      <div className="catalogue-modes" role="group" aria-label="Search mode">
        <button type="button" aria-pressed={mode === 'catalogue'} onClick={() => setMode('catalogue')}>Modules</button>
        <button type="button" aria-pressed={mode === 'records'} onClick={() => setMode('records')}>Records</button>
        <button type="button" className="catalogue-close" aria-label="Close search" onClick={() => setOpen(false)}>Esc</button>
      </div>
      {mode === 'catalogue' ? <>
        <div className="catalogue-field"><Search size={18} aria-hidden="true" /><input ref={input} type="search" value={query} role="combobox" aria-label="Search all desks and modules" aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={results[active] ? `${listId}-${active}` : undefined} placeholder="Search cricket, music, markets, bills…" autoComplete="off" onChange={event => { setQuery(event.target.value); setSelected(0); }} onKeyDown={keydown} />
          <DictationButton contextKey={`${identity}:catalogue`} lang={lang} onTranscript={text => { setQuery(value => `${value.trim()} ${text}`.trim()); setSelected(0); input.current?.focus(); }} />
        </div><div className="catalogue-meta">SEARCH {new Set(searchDeskCatalogue('').map(entry => entry.tab)).size} DESKS<span role="status">{results.length} modules</span></div>
        <div onKeyDown={keydown}><CatalogueResults results={results} selected={active} lockedIds={lockedIds} listId={listId} onSelect={choose} onHighlight={setSelected} /></div>
        <div className="catalogue-footer">Every module, one search.<span>↵ Select a result to explore</span></div>
      </> : <div className="catalogue-records"><p>Search indexed record snapshots across your available desks. Some modules, including Sports and Entertainment, have no indexed records. Use Modules to find every destination.</p><CommandSearch query={query} onQuery={setQuery} scope="records" tabs={recordTabs} identity={identity} lang={lang} searchRecords={searchRecords} onOpen={hit => { setOpen(false); onOpen(hit); }} /></div>}
    </dialog>}
    {detail && <div className="desk-v6 catalogue-coverage"><V6Dialog titleId={`${id}-coverage`} onClose={() => setDetail(null)}>
      <CatalogueModuleCoverage entry={detail} restricted={restricted} summary={coverage?.id === detail.id ? coverage.summary : undefined} titleId={`${id}-coverage`} onOpen={openDestination} retry={() => { setCoverage(null); setAttempt(value => value + 1); }} />
    </V6Dialog></div>}
  </div>;
}
