/**
 * What the assistant is doing, while it does it (streaming spec §G).
 * Collapsed it is one line; expanded it lists every step with its result
 * count and duration. It auto-expands while the turn is running and collapses
 * when the turn ends, unless the reader has touched it. When the turn is over
 * it shows the measured buckets, and says so when another model answered.
 */
import { useEffect, useState } from 'react';

function toolLabel(step) {
  const input = step.input || {};
  if (step.name === 'search_documents') {
    return input.query ? `Searching documents for “${input.query}”` : 'Searching documents';
  }
  const where = input.feature || input.tier || 'the desk';
  return input.query ? `Looking up ${where} rows for “${input.query}”` : `Looking up rows in ${where}`;
}

function doneLabel(step) {
  const n = step.resultCount ?? 0;
  if (step.name === 'search_documents') return `Searched · ${n} ${n === 1 ? 'passage' : 'passages'}`;
  return `Looked up · ${n} ${n === 1 ? 'row' : 'rows'}`;
}

function summary(activity, active) {
  const last = activity[activity.length - 1];
  if (!last) return active ? 'Thinking through your question…' : 'No steps recorded';
  if (last.type === 'reasoning') return last.text;
  return last.phase === 'end' ? doneLabel(last) : toolLabel(last);
}

function seconds(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export default function ActivityTicker({ activity = [], active = false, timing = null, model = null }) {
  const [open, setOpen] = useState(active);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched) setOpen(active);
  }, [active, touched]);

  if (!activity.length && !active) return null;

  const steps = activity.filter((a) => a.type !== 'tool' || a.phase !== 'start' || !activity.some((b) => b.type === 'tool' && b.step === a.step && b.phase === 'end'));

  return (
    <div className={`ai-ticker${active ? ' active' : ''}`}>
      <button
        type="button"
        className="ai-ticker-head"
        aria-expanded={open}
        onClick={() => {
          setTouched(true);
          setOpen((v) => !v);
        }}
      >
        <span className={`ai-ticker-dot${active ? ' on' : ''}`} aria-hidden="true" />
        <span className="ai-ticker-line">{summary(activity, active)}</span>
        <span className="ai-ticker-caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open ? (
        <ol className="ai-ticker-steps">
          {steps.map((s, i) => (
            <li key={`${s.type}-${s.step ?? i}`} className={`ai-ticker-step ${s.type}`}>
              {s.type === 'reasoning' ? (
                <span>{s.text}</span>
              ) : (
                <>
                  <span>{s.phase === 'end' ? doneLabel(s) : toolLabel(s)}</span>
                  {s.latencyMs ? <small>{seconds(s.latencyMs)}</small> : null}
                </>
              )}
            </li>
          ))}
        </ol>
      ) : null}

      {!active && timing ? (
        <p className="ai-ticker-timing">
          {[
            timing.search_ms ? `searched ${seconds(timing.search_ms)}` : '',
            timing.reasoning_ms ? `thought ${seconds(timing.reasoning_ms)}` : '',
            timing.writing_ms ? `wrote ${seconds(timing.writing_ms)}` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
          {model?.served && model.served !== model.requested ? ` · ${model.requested} unavailable → ${model.served}` : ''}
        </p>
      ) : null}
    </div>
  );
}
