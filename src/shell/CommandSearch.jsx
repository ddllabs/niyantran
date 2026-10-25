import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { catalogModules } from '../desks/catalog.js';
import { Icon } from './Icons.jsx';
import { navigationMatches, recordMatches, resultDragProps } from './commandSearch.js';
import DictationButton from '../components/DictationButton.jsx';
import './command-search.css';

const modules = catalogModules();
export default function CommandSearch({ tabs, onOpen, identity, lang = 'en', searchRecords = recordMatches, query: sharedQuery, onQuery, scope = 'all' }) {
  const [localQ, setLocalQ] = useState('');
  const q = sharedQuery ?? localQ;
  const setQ = next => onQuery ? onQuery(typeof next === 'function' ? next(q) : next) : setLocalQ(next);
  const [open, setOpen] = useState(Boolean(sharedQuery));
  const [selected, setSelected] = useState(0);
  const [remote, setRemote] = useState({ query: '', hits: [], loading: false, error: '' });
  const [retry, setRetry] = useState(0);
  const [visibleCount, setVisibleCount] = useState(24);
  const input = useRef(null);
  // A result is held from mousedown until the click or drag ends. Without cancelling the mousedown
  // (which would also stop a native drag), focus can leave the input, and that must not close the
  // list and unmount the result being clicked or dragged (F134).
  const held = useRef(false);
  const id = useId();
  const query = q.trim();
  const local = useMemo(() => scope === 'records' ? [] : navigationMatches(query, tabs, modules), [query, tabs, scope]);
  const records = remote.query === query ? remote.hits : [];
  const hits = [...local, ...records].slice(0, visibleCount);
  const active = Math.min(selected, Math.max(0, hits.length - 1));
  const visible = open && query.length >= 2;
  const coverageNote = `${remote.coverage?.failed?.length ? ` Unavailable: ${remote.coverage.failed.join(', ')}.` : ''}${remote.coverage?.truncated ? ' First 50 per desk; refine your search for more.' : ''}`;

  useEffect(() => {
    if (!open || query.length < 2) return undefined;
    const controller = new AbortController();
    let live = true;
    const timer = setTimeout(async () => {
      setRemote({ query, hits: [], loading: true, error: '' });
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const found = await searchRecords(query, tabs, modules, controller.signal);
        if (live) setRemote({ query, hits: found, loading: false, error: '', coverage: found.coverage });
      } catch {
        if (live) setRemote({ query, hits: [], loading: false, error: 'Record search is unavailable. Try again.' });
      } finally { clearTimeout(timeout); }
    }, 300);
    return () => { live = false; clearTimeout(timer); controller.abort(); };
  }, [query, open, tabs, identity, retry, searchRecords]);

  useEffect(() => {
    if (visible) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [visible, id, active]);

  function hold() {
    held.current = true;
    const release = event => {
      held.current = false;
      for (const type of ['mouseup', 'dragend', 'drop']) window.removeEventListener(type, release, true);
      if (event.type === 'mouseup' && document.activeElement !== input.current) input.current?.focus();
    };
    for (const type of ['mouseup', 'dragend', 'drop']) window.addEventListener(type, release, true);
  }
  function choose(hit) {
    if (!hit) return;
    onOpen(hit);
    setOpen(false); setSelected(0);
  }
  return <div className="cmd" onBlur={e => {
    if (!held.current && !e.currentTarget.contains(e.relatedTarget)) setOpen(false);
  }}>
    <Icon name="search" />
    <input ref={input} value={q} role="combobox" aria-label="Command search"
      aria-autocomplete="list" aria-expanded={visible} aria-controls={visible ? id : undefined}
      aria-activedescendant={visible && hits[active] ? `${id}-${active}` : undefined}
      placeholder={lang === 'hi' ? 'डेस्क, मॉड्यूल, रिकॉर्ड खोजें' : 'Search desks, modules, records'}
      onFocus={() => setOpen(true)}
      onChange={e => { setQ(e.target.value); setVisibleCount(24); setSelected(0); setOpen(true); }}
      onKeyDown={e => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Escape') { setOpen(false); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); setOpen(true);
          setSelected(value => Math.max(0, Math.min(hits.length - 1, value + (e.key === 'ArrowDown' ? 1 : -1))));
        }
        if (e.key === 'Enter' && visible) { e.preventDefault(); choose(hits[active]); }
      }} />
    <DictationButton contextKey={identity} lang={lang} onTranscript={text => {
      setQ(value => `${value.trim()} ${text}`.trim()); setOpen(true); setSelected(0); input.current?.focus();
    }} />
    {scope === 'records' && query.length < 2 && <p className="cmd-search-status">Type at least two characters to search records.</p>}
    {visible && <div className="cmd-hits">
      <div id={id} role="listbox" aria-label="Search results">
        {['desk', 'module', 'record'].map(kind => {
          const group = hits.filter(hit => hit.kind === kind);
          if (!group.length) return null;
          return <div key={kind} role="group" aria-label={`${kind}s`}>
            <p className="cmd-group-label">{kind === 'desk' ? 'Desks' : kind === 'module' ? 'Modules' : 'Records'} <span>{group.length}</span></p>
            {group.map(hit => {
              const index = hits.indexOf(hit);
              return <div role="option" aria-selected={active === index} id={`${id}-${index}`} key={hit.id}
                className={`cmd-result${active === index ? ' active' : ''}`} onMouseEnter={() => setSelected(index)}>
                <button type="button" tabIndex={-1} {...resultDragProps(hit)} onMouseDown={hold} onClick={() => choose(hit)}>
                  <strong>{hit.title}</strong><span>{hit.detail}</span>{hit.kind === 'record' && <span className="cmd-record-date">Snapshot · {Number.isFinite(Date.parse(hit.snapshot_at)) ? new Date(hit.snapshot_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'date not recorded'}</span>}
                </button>
              </div>;
            })}
          </div>;
        })}
      </div>
      <p className="cmd-search-status" role="status">{remote.query !== query || remote.loading
        ? 'Searching records…' : remote.error || `${hits.length ? 'Indexed snapshot matches.' : 'No matches in the searched snapshots.'}${coverageNote} Not every module is indexed.`}</p>
      {local.length + records.length > visibleCount && <button type="button" className="cmd-retry" onMouseDown={event => event.preventDefault()} onClick={() => setVisibleCount(n => n + 24)}>Show more results ({local.length + records.length - visibleCount})</button>}
      {remote.query === query && remote.error && <button type="button" className="cmd-retry" onMouseDown={event => event.preventDefault()} onClick={() => setRetry(n => n + 1)}>Retry record search</button>}
    </div>}
  </div>;
}
