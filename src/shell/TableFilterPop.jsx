import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { tableFilterGroups } from '../lib/analytics.js';
import { vizFilterList, vizFilterOn } from '../lib/nationalKpi.js';
import { Icon } from './Icons.jsx';
import { selectedValues } from '../lib/choiceFilter.js';

export { matchesChoice, selectedValues } from '../lib/choiceFilter.js';

export function choiceGroup(title, values, current, setCurrent, { allValue = '', allLabel = 'All' } = {}) {
  const opts = values.map((v) => (v && typeof v === 'object' ? v : { value: v, label: v }));
  const selected = selectedValues(current, allValue);
  return {
    id: title,
    title,
    options: [
      { label: allLabel, on: selected.length === 0, onPick: () => setCurrent(allValue) },
      ...opts.map((o) => ({
        label: o.label,
        on: selected.map(String).includes(String(o.value)),
        onPick: () => {
          const has = selected.map(String).includes(String(o.value));
          const next = has ? selected.filter((x) => String(x) !== String(o.value)) : [...selected, o.value];
          setCurrent(next.length ? next : allValue);
        },
      })),
    ],
  };
}

export default function TableFilterPop({
  feed,
  groups: groupsProp,
  extraGroups,
  q,
  onQ,
  searchPlaceholder = 'Search this table',
  vizFilter,
  onClearViz,
  disabled,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const popRef = useRef(null);
  const feedGroups = useMemo(() => {
    if (groupsProp) return groupsProp;
    if (!feed) return [];
    // F156: a paged module's menu comes with the page, counted over the whole register.
    if (feed.paged) return feed.filterGroups || [];
    try {
      return tableFilterGroups(feed);
    } catch {
      return [];
    }
  }, [feed, groupsProp]);
  const groups = useMemo(() => [...feedGroups, ...(extraGroups || [])], [feedGroups, extraGroups]);
  const extraOn = (extraGroups || []).some((g) => g.options?.some((o, i) => i > 0 && o.on));
  const list = vizFilterList(vizFilter);
  const active = Boolean(q?.trim() || list.length || extraOn);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const wrap = wrapRef.current;
    const pop = popRef.current;
    if (!wrap || !pop) return undefined;

    function place() {
      const btn = wrap.getBoundingClientRect();
      const pad = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(340, vw * 0.86, vw - pad * 2);
      pop.style.width = `${width}px`;
      pop.style.maxHeight = `${Math.min(520, vh * 0.7, vh - pad * 2)}px`;

      const spaceRight = vw - btn.left - pad;
      const spaceLeft = btn.right - pad;
      if (spaceRight >= width || spaceRight >= spaceLeft) {
        pop.style.left = '0';
        pop.style.right = 'auto';
        const overflow = btn.left + width + pad - vw;
        if (overflow > 0) pop.style.left = `${-overflow}px`;
      } else {
        pop.style.right = '0';
        pop.style.left = 'auto';
        const overflow = pad - (btn.right - width);
        if (overflow > 0) pop.style.right = `${-overflow}px`;
      }

      const below = btn.bottom + 6;
      const need = Math.min(pop.scrollHeight || 280, parseFloat(pop.style.maxHeight) || 280);
      if (below + need > vh - pad && btn.top > need + pad) {
        pop.style.top = 'auto';
        pop.style.bottom = 'calc(100% + 6px)';
      } else {
        pop.style.top = 'calc(100% + 6px)';
        pop.style.bottom = 'auto';
      }
    }

    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, groups.length, q, active]);

  function pick(opt) {
    if (typeof opt.onPick === 'function') {
      opt.onPick();
      return;
    }
    window.dispatchEvent(new CustomEvent('niy-viz-filter', { detail: opt }));
  }

  function clearAll() {
    onQ?.('');
    onClearViz?.();
    (extraGroups || []).forEach((g) => g.options?.[0]?.onPick?.());
  }

  return (
    <div className={`tbl-filter ${className}`.trim()} ref={wrapRef}>
      <button
        type="button"
        className={`tbl-filter-btn${open || active ? ' on' : ''}`}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Table filters"
        title="Filters"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="filter" size={15} />
        {active ? <i className="tbl-filter-dot" /> : null}
      </button>
      {open ? (
        <div ref={popRef} className="tbl-filter-pop" role="dialog" aria-label="Table filters">
          {onQ ? (
            <label className="tbl-filter-search">
              <Icon name="search" size={14} />
              <input
                value={q || ''}
                onChange={(e) => onQ(e.target.value)}
                placeholder={searchPlaceholder}
                autoComplete="off"
                autoFocus
              />
            </label>
          ) : null}
          {active ? (
            <button type="button" className="tbl-filter-clear" onClick={clearAll}>
              Clear filters
            </button>
          ) : null}
          {groups.map((g) => (
            <div key={g.id || g.title} className="tbl-filter-group">
              <h4>{g.title}</h4>
              <div className="tbl-filter-opts">
                {g.options.map((opt) => {
                  const on =
                    opt.on ??
                    vizFilterOn(vizFilter, opt.filterCol || g.col, opt.filterValue || opt.label, opt.filterMap || g.map);
                  return (
                    <button key={`${opt.filterCol || g.col || ''}|${opt.label}`} type="button" className={on ? 'on' : ''} onClick={() => pick(opt)}>
                      <span>{opt.label}</span>
                      {opt.n != null ? <em>{opt.n}</em> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {!groups.length && !onQ ? <p className="tbl-filter-empty">No filters for this table.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
