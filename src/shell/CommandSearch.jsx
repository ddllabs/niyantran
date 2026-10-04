import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { catalogModules } from '../desks/catalog.js';
import { Icon } from './Icons.jsx';
import { navigationMatches, recordMatches } from './commandSearch.js';
import DictationButton from '../components/DictationButton.jsx';
import './command-search.css';

const modules = catalogModules();
export default function CommandSearch({ tabs, onOpen, identity, lang = 'en', searchRecords = recordMatches }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const [remote, setRemote] = useState({ query: '', hits: [], loading: false, error: '' });
  const [retry, setRetry] = useState(0);
  const input = useRef(null);
  const id = useId();
  const query = q.trim();
  const local = useMemo(() => navigationMatches(query, tabs, modules), [query, tabs]);
  const records = remote.query === query ? remote.hits : [];
  const hits = [...local, ...records];
  const active = Math.min(selected, Math.max(0, hits.length - 1));
  const visible = open && query.length >= 2;

  useEffect(() => {
    if (!open || query.length < 2) return undefined;
    const controller = new AbortController();
    let live = true;
    const timer = setTimeout(async () => {
      setRemote({ query, hits: [], loading: true, error: '' });
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const found = await searchRecords(query, tabs, modules, controller.signal);
        if (live) setRemote({ query, hits: found, loading: false, error: '' });
      } catch {
        if (live) setRemote({ query, hits: [], loading: false, error: 'Record search is unavailable. Try again.' });
      } finally { clearTimeout(timeout); }
    }, 300);
    return () => { live = false; clearTimeout(timer); controller.abort(); };
  }, [query, open, tabs, identity, retry, searchRecords]);

  useEffect(() => {
    if (visible) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [visible, id, active]);

  function choose(hit) {
    if (!hit) return;
    onOpen(hit);
    setQ(''); setOpen(false); setSelected(0);
  }
  return <div className="cmd" onBlur={e => {
    if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
  }}>
    <Icon name="search" />
    <input ref={input} value={q} role="combobox" aria-label="Command search"
      aria-autocomplete="list" aria-expanded={visible} aria-controls={visible ? id : undefined}
      aria-activedescendant={visible && hits[active] ? `${id}-${active}` : undefined}
      placeholder={lang === 'hi' ? 'डेस्क, मॉड्यूल, रिकॉर्ड खोजें' : 'Search desks, modules, records'}
      onFocus={() => setOpen(true)}
      onChange={e => { setQ(e.target.value); setSelected(0); setOpen(true); }}
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
    {visible && <div className="cmd-hits">
      <div id={id} role="listbox" aria-label="Search results">
        {['desk', 'module', 'record'].map(kind => {
          const group = hits.filter(hit => hit.kind === kind);
          if (!group.length) return null;
          return <div key={kind} role="group" aria-label={`${kind}s`}>
            <p className="cmd-group-label">{kind === 'desk' ? 'Desks' : kind === 'module' ? 'Modules' : 'Records'}</p>
            {group.map(hit => {
              const index = hits.indexOf(hit);
              return <div role="option" aria-selected={active === index} id={`${id}-${index}`} key={hit.id}
                className={`cmd-result${active === index ? ' active' : ''}`} onMouseEnter={() => setSelected(index)}>
                <button type="button" tabIndex={-1} onMouseDown={e => e.preventDefault()} onClick={() => choose(hit)}>
                  <strong>{hit.title}</strong><span>{hit.detail}</span>
                </button>
              </div>;
            })}
          </div>;
        })}
      </div>
      <p className="cmd-search-status" role="status">{remote.query !== query || remote.loading
        ? 'Searching records…' : remote.error || (!hits.length ? 'No matching desks, modules or records.' : 'Record matches from the indexed desk snapshot.')}</p>
      {remote.query === query && remote.error && <button type="button" className="cmd-retry" onClick={() => setRetry(n => n + 1)}>Retry record search</button>}
    </div>}
  </div>;
}
