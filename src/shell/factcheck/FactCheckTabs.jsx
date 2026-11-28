// F366 slice B: the panel's tab list (the roving tabindex of the page's deck tabs: one tab stop, arrows,
// Home and End) and the five verdict count tiles that filter the Claims tab.
import { FILTER_KEYS } from './claimFilter.js';
import { VERDICTS } from './factCheckText.js';

const KEYS = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];

/** The tab an arrow, Home or End key moves to (wrapping), or null for any other key. */
export function nextTab(ids, current, key) {
  if (!KEYS.includes(key)) return null;
  const at = ids.indexOf(current);
  const target = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: ids.length - 1 }[key];
  return ids[(target + ids.length) % ids.length];
}

/**
 * Tab buttons only; the panels are drawn by the caller with ids `${idBase}-panel-${id}`.
 * A tab may carry `dot: { pulse, tick }`: a small decorative dot after the label (aria-hidden, so the tab's
 * name is its label alone). `pulse` adds the brief pulse; `tick` changes with each new event so a second
 * event inside the pulse restarts the animation.
 */
export function RovingTabs({ idBase, label, tabs, active, onChange }) {
  const ids = tabs.map((t) => t.id);
  return (
    <div className="fc-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          type="button"
          key={t.id}
          id={`${idBase}-tab-${t.id}`}
          role="tab"
          aria-selected={active === t.id}
          aria-controls={`${idBase}-panel-${t.id}`}
          tabIndex={active === t.id ? 0 : -1}
          className={`fc-tab${active === t.id ? ' active' : ''}`}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            const next = nextTab(ids, t.id, e.key);
            if (next === null) return;
            e.preventDefault();
            onChange(next);
            e.currentTarget.parentElement?.querySelector(`#${idBase}-tab-${next}`)?.focus();
          }}
        >
          {t.label}
          {t.dot ? <span key={t.dot.tick ?? 0} className={`fc-tab-dot${t.dot.pulse ? ' fc-tab-dot--pulse' : ''}`} aria-hidden="true" /> : null}
        </button>
      ))}
    </div>
  );
}

/** Five toggle buttons (several can be on), each the verdict's glyph, label and count; Clear while any is on. */
export function VerdictTiles({ counts, active, onToggle, onClear }) {
  return (
    <div className="fc-tiles" role="group" aria-label="Filter claims by verdict">
      {FILTER_KEYS.map((key) => (
        <button
          type="button"
          key={key}
          className={`fc-tile fc-tile--${key}`}
          data-verdict={key}
          aria-pressed={active.includes(key)}
          onClick={() => onToggle(key)}
        >
          <span className="fc-tile-glyph" aria-hidden="true">{VERDICTS[key].glyph}</span>
          <span className="fc-tile-label">{VERDICTS[key].label}</span>
          <span className="fc-tile-count">{counts[key]}</span>
        </button>
      ))}
      {active.length > 0 ? (
        <button type="button" className="fc-tiles-clear" data-fc="filter-clear" onClick={onClear}>Clear</button>
      ) : null}
    </div>
  );
}
