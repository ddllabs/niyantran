import { MODULE_UNAVAILABLE_TEXT } from '../desks/moduleLiveRetry.js';

/**
 * Honest Planned / Offline / Empty / Error shells.
 * Never invents a DATE/TITLE table or zero KPIs.
 */

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

  return (
    <div className={`desk-state-shell state-${id}`} role="status">
      <p className="desk-state-kicker">{(state?.label || id).toUpperCase()}</p>
      <h2>{title}</h2>
      <p className="desk-state-copy">
        {state?.detail ||
          (id === 'planned'
            ? `${featureName || 'This module'} does not yet have a shipped adapter or dataset on this host.`
            : 'No records are available to display.')}
      </p>
      {id === 'planned' && (
        <ul className="desk-state-meta">
          {intendedCoverage ? <li>Intended coverage: {intendedCoverage}</li> : null}
          {expectedSources ? <li>Expected sources: {expectedSources}</li> : null}
          {state?.host ? <li>Configured host: {state.host}</li> : null}
          {state?.sourceNote ? <li>{state.sourceNote}</li> : null}
          <li>Filters, export and AI research stay disabled until live or archive rows exist.</li>
        </ul>
      )}
      {(id === 'offline' || id === 'error') && (
        <div className="desk-state-actions">
          {state?.host ? <span className="muted">Host: {state.host}</span> : null}
          {typeof onRetry === 'function' ? (
            <button type="button" className="ghost-btn" onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
