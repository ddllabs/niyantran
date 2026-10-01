/**
 * What the assistant is doing, while it does it (docs/specs/2026-10-02-thinking-display.md).
 * One indicator from Send: it opens on "Starting…" with an elapsed clock, lists each stage once
 * and each search by what it did, and says what the searches found. When the turn ends it
 * collapses to one line ("5 searches · 3 sources · 53 s") unless the reader has touched it; the
 * details keep the steps, the finds and the measured buckets. It replaced the NyAI card (ADR 0007
 * §2, amended 2026-10-02) and keeps that card's polite status region and Hindi.
 */
import { useEffect, useState } from 'react';
import './research.css';

const SEARCH_TOOLS = ['search_documents', 'search_desk_rows'];

/**
 * The steps to list: public stage lines, each once, and the two searches, each search once. A
 * saved turn stores each finished search without `phase` (research-chat writes it after the end
 * frame), so a stored step with no phase is a finished one; the live stream sends `start` and `end`.
 */
export function tickerSteps(activity) {
  const kept = (Array.isArray(activity) ? activity : [])
    .map((a) => (a && a.type === 'tool' && a.phase === undefined ? { ...a, phase: 'end' } : a))
    .filter(a => a && (
      (a.type === 'activity' && typeof a.text === 'string' && a.text.trim()) ||
      (a.type === 'tool' && SEARCH_TOOLS.includes(a.name) && ['start', 'end'].includes(a.phase))
    ));
  return kept.filter((a, i) => (a.type === 'activity'
    // A saved turn from before F46 repeated its stage label every round.
    ? kept.findIndex((b) => b.type === 'activity' && b.text === a.text) === i
    : a.phase !== 'start' || !kept.some((b) => b.type === 'tool' && b.step === a.step && b.phase === 'end')));
}

function inputOf(step) {
  return Object.fromEntries(Object.entries(step.input || {}).filter(([, v]) => typeof v === 'string' && v.trim()));
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** One step, in words. */
export function stepLabel(step) {
  if (step.type === 'activity') return step.text;
  const input = inputOf(step);
  const n = Number.isFinite(step.resultCount) && step.resultCount >= 0 ? step.resultCount : 0;
  if (step.name === 'search_documents') {
    if (step.phase !== 'end') return input.query ? `Searching “${input.query}”…` : 'Searching documents…';
    return `${input.query ? `Searched “${input.query}”` : 'Searched documents'} · ${plural(n, 'passage', 'passages')}`;
  }
  const where = input.feature || input.tier || 'the desk';
  return step.phase === 'end' ? `Looked up ${where} · ${plural(n, 'row', 'rows')}` : `Looking up ${where}…`;
}

/** Each document the finished searches found, once, with its pages merged and sorted. */
export function foundSoFar(steps) {
  const out = [];
  for (const s of steps) {
    if (s.type !== 'tool' || s.phase !== 'end' || !Array.isArray(s.found)) continue;
    for (const f of s.found) {
      if (!f || typeof f.document_id !== 'string' || typeof f.title !== 'string') continue;
      let doc = out.find((d) => d.document_id === f.document_id);
      if (!doc) {
        doc = { document_id: f.document_id, title: f.title, pages: [] };
        out.push(doc);
      }
      for (const p of Array.isArray(f.pages) ? f.pages : []) {
        if (Number.isInteger(p) && p > 0 && !doc.pages.includes(p)) doc.pages.push(p);
      }
    }
  }
  for (const d of out) d.pages.sort((a, b) => a - b);
  return out;
}

/** m:ss, for the live clock. */
export function clock(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** The finished line: searches, cited sources and total time, each left out when zero. */
export function finishedSummary({ steps = [], sourceCount = 0, timing = null, hi = false }) {
  const searches = steps.filter((s) => s.type === 'tool' && s.phase === 'end').length;
  const secs = Number(timing?.total_ms) > 0 ? Math.max(1, Math.round(timing.total_ms / 1000)) : 0;
  const parts = hi
    ? [searches && `${searches} खोज`, sourceCount && `${sourceCount} स्रोत`, secs && `${secs} से.`]
    : [searches && plural(searches, 'search', 'searches'), sourceCount && plural(sourceCount, 'source', 'sources'), secs && `${secs} s`];
  const line = parts.filter(Boolean).join(' · ');
  return line || (hi ? 'उत्तर दिया' : 'Answered');
}

function seconds(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/** The measured buckets. */
export function timingLine({ timing = null, usage = null }) {
  return [
    timing?.search_ms ? `searched ${seconds(timing.search_ms)}` : '',
    // reasoning_ms is residual time - total minus search minus writing - not thinking. Calling it
    // "thought" claims reasoning the model may not have done: a real turn reported "thought 9.9s"
    // with reasoning_tokens of 0. Only the model's own count can say.
    timing?.reasoning_ms ? `${Number(usage?.reasoning_tokens) > 0 ? 'thought' : 'waited'} ${seconds(timing.reasoning_ms)}` : '',
    timing?.writing_ms ? `wrote ${seconds(timing.writing_ms)}` : '',
  ].filter(Boolean).join(' · ');
}

/** The model that answered, when it was not the one asked: said on the summary line itself. */
export function swapLabel({ model = null, labelOf = (id) => id }) {
  return model?.served && model.served !== model.requested ? `Answered by ${labelOf(model.served)}` : '';
}

function useNow(running) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  return now;
}

export default function ActivityTicker({
  activity = [], active = false, startedAt = 0, timing = null, model = null, usage = null,
  sourceCount = 0, labelOf = (id) => id, lang = 'en',
}) {
  const hi = lang === 'hi';
  const [open, setOpen] = useState(active);
  const [touched, setTouched] = useState(false);
  const now = useNow(active && startedAt > 0);

  useEffect(() => {
    if (!touched) setOpen(active);
  }, [active, touched]);

  const steps = tickerSteps(activity);
  if (!steps.length && !active && !timing && !model?.served) return null;

  const found = foundSoFar(steps);
  const last = steps[steps.length - 1];
  const head = active
    ? (last ? stepLabel(last) : (hi ? 'शुरू हो रहा है…' : 'Starting…'))
    : [finishedSummary({ steps, sourceCount, timing, hi }), swapLabel({ model, labelOf })].filter(Boolean).join(' · ');
  const details = active ? '' : timingLine({ timing, usage });

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
        <span className="ai-ticker-line" role="status" aria-live="polite">{head}</span>
        {active && startedAt > 0 ? <span className="ai-ticker-clock">{clock(now - startedAt)}</span> : null}
        <span className="ai-ticker-caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && steps.length ? (
        <ol className="ai-ticker-steps">
          {steps.map((s, i) => (
            <li key={`${s.type}-${s.step ?? i}`} className={`ai-ticker-step ${s.type}`}>
              <span>{stepLabel(s)}</span>
              {s.type === 'tool' && s.latencyMs ? <small>{seconds(s.latencyMs)}</small> : null}
            </li>
          ))}
        </ol>
      ) : null}

      {open && found.length ? (
        <p className="ai-ticker-found">
          <span>{hi ? 'अब तक मिला' : 'Found so far'}: </span>
          {found.map((d) => (d.pages.length ? `${d.title} (p. ${d.pages.join(', ')})` : d.title)).join(' · ')}
        </p>
      ) : null}

      {open && details ? <p className="ai-ticker-timing">{details}</p> : null}
    </div>
  );
}
