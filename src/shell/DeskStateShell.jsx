import { MODULE_UNAVAILABLE_TEXT } from '../desks/moduleLiveRetry.js';
import { plainNote, sourceLinks } from '../lib/plainSourceNote.js';

/**
 * Honest Planned / Offline / Empty / Error shells.
 * Never invents a DATE/TITLE table or zero KPIs.
 * F164: the state's detail and source note are shown in plain words; hosts, adapters and archive
 * wording stay in the card's `title` for debugging, and the sources are listed by name as links.
 */

function plainDefault(id, featureName) {
  if (id === 'planned') return `${featureName || 'This module'} has no records yet.`;
  if (id === 'offline') return 'The source isn’t responding right now.';
  return 'No records are available to display.';
}

export default function DeskStateShell({
  state,
  featureName = '',
  onRetry,
  intendedCoverage = '',
  expectedSources = '',
}) {
  const id = state?.id || 'planned';
  const title =
    id === 'offline'
      ? 'Source offline'
      : id === 'error'
        ? MODULE_UNAVAILABLE_TEXT
        : id === 'empty'
          ? 'No matching rows'
          : 'Module planned';
  const fallback = plainDefault(id, featureName);
  const copy = state?.detail ? plainNote(state.detail, fallback) : fallback;
  const sourceNote = plainNote(state?.sourceNote);
  const sources = sourceLinks(expectedSources);
  const sourceList = sources.map((s, i) => (
    <span key={s.url}>
      {i ? ', ' : ''}
      <a href={s.url} target="_blank" rel="noopener noreferrer">
        {s.name}
      </a>
    </span>
  ));
  const technical = [state?.detail, state?.host && `Host: ${state.host}`, state?.sourceNote]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={`desk-state-shell state-${id}`} role="status" title={technical && technical !== copy ? technical : undefined}>
      <p className="desk-state-kicker">{(state?.label || id).toUpperCase()}</p>
      <h2>{title}</h2>
      <p className="desk-state-copy">{copy}</p>
      {id === 'planned' && (
        <ul className="desk-state-meta">
          {intendedCoverage ? <li>Intended coverage: {intendedCoverage}</li> : null}
          {sources.length ? <li>Expected sources: {sourceList}</li> : null}
          {sourceNote && sourceNote !== copy ? <li>{sourceNote}</li> : null}
          <li>Filters, export and AI research turn on once records are available.</li>
        </ul>
      )}
      {id === 'offline' && sources.length ? (
        <ul className="desk-state-meta">
          <li>Sources: {sourceList}</li>
        </ul>
      ) : null}
      {(id === 'offline' || id === 'error') && typeof onRetry === 'function' ? (
        <div className="desk-state-actions">
          <button type="button" className="ghost-btn" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}
