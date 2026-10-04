/**
 * What the assistant is doing, while it does it (docs/specs/2026-10-02-thinking-display.md).
 * One indicator from Send: it starts expanded on "Starting…" with an elapsed clock, lists each stage once
 * and each search by what it did, and says what the searches found. When the turn ends it
 * shows one compact line ("5 searches · 3 citations · 53 s"); the
 * disclosure keeps the steps, the finds and timing buckets. Residual time is not measured reasoning. It replaced the NyAI card (ADR 0007
 * §2, amended 2026-10-02) and keeps that card's polite status region and Hindi.
 */
import { useEffect, useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import ResearchFlow, { effortLabel } from './ResearchFlow.jsx';
import './research.css';

export function compactModelId(id) {
  const name = id.split('/').pop();
  return name.match(/(?:^|-)(\d+(?:\.\d+)+)(?:-|$)/)?.[1] || name;
}

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
  if (step.phase === 'end' && ['error', 'cancelled'].includes(step.status)) {
    return `${step.status === 'cancelled' ? 'Cancelled' : 'Failed'} ${step.name === 'search_documents' ? 'document search' : 'desk lookup'}${input.query ? ` “${input.query}”` : ''}`;
  }
  const n = Number.isFinite(step.resultCount) && step.resultCount >= 0 ? step.resultCount : null;
  if (step.name === 'search_documents') {
    if (step.phase !== 'end') return input.query ? `Searching “${input.query}”…` : 'Searching documents…';
    return `${input.query ? `Searched “${input.query}”` : 'Searched documents'}${n === null ? '' : ` · ${plural(n, 'passage', 'passages')}`}`;
  }
  const where = input.feature || input.tier || 'the desk';
  return step.phase === 'end' ? `Looked up ${where}${n === null ? '' : ` · ${plural(n, 'row', 'rows')}`}` : `Looking up ${where}…`;
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
    ? [searches && `${searches} खोज`, sourceCount && `${sourceCount} उद्धरण`, secs && `${secs} से.`]
    : [searches && plural(searches, 'search', 'searches'), sourceCount && plural(sourceCount, 'citation', 'citations'), secs && `${secs} s`];
  const line = parts.filter(Boolean).join(' · ');
  return line || (hi ? 'उत्तर दिया' : 'Answered');
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
  activity = [], active = false, startedAt = 0, timing = null, model = null,
  sourceCount = 0, effort = null, labelOf = (id) => id, lang = 'en',
}) {
  const hi = lang === 'hi';
  const [disclosure, setDisclosure] = useState(() => ({ active, open: active }));
  const [pointerToggle, setPointerToggle] = useState(false);
  const now = useNow(active && startedAt > 0);
  // Reset only at lifecycle boundaries; live events must not undo manual toggles.
  if (disclosure.active !== active) {
    setDisclosure({ active, open: active });
    setPointerToggle(false);
  }
  const open = disclosure.active === active ? disclosure.open : active;

  const steps = tickerSteps(activity);
  if (!steps.length && !active && !timing && !model?.served && !model?.requested) return null;

  const found = foundSoFar(steps);
  const last = steps[steps.length - 1];
  const summary = active
    ? (last ? stepLabel(last) : (hi ? 'शुरू हो रहा है…' : 'Starting…'))
    : finishedSummary({ steps, sourceCount, timing, hi });
  const modelId = model?.served || model?.requested;
  const head = [modelId && labelOf(modelId), effort && effortLabel(effort,hi), summary].filter(Boolean).join(' · ');

  return (
    <div className={`ai-ticker${active ? ' active' : ''}`} data-motion={pointerToggle ? 'pointer' : 'instant'}>
      <button
        type="button"
        className="ai-ticker-head"
        aria-expanded={open}
        aria-label={head}
        onClick={(event) => {
          setPointerToggle(event.detail > 0);
          setDisclosure({ active, open: !open });
        }}
      >
        <span className={`ai-ticker-glyph${active ? ' working' : ''}`} aria-hidden="true"><Sparkles size={16} /></span>
        <span className="ai-ticker-line" role="status" aria-live="polite">
          {modelId ? <span className="ai-ticker-model"><strong>{labelOf(modelId)}</strong>{labelOf(modelId) !== modelId ? <span className="ai-ticker-model-id" title={modelId}>{compactModelId(modelId)}</span> : null}{effort ? <span className="ai-ticker-effort">{hi ? 'सोच: ' : 'Thinking: '}{effortLabel(effort, hi)}</span> : null}</span> : null}
          <span className="ai-ticker-summary">{summary}</span>
        </span>
        {active && startedAt > 0 ? <span className="ai-ticker-clock">{clock(now - startedAt)}</span> : null}
        <ChevronDown className="ai-ticker-caret" size={16} aria-hidden="true" />
      </button>

      {open ? <ResearchFlow steps={steps} active={active} timing={timing} lang={lang} /> : null}

      {open && found.length ? (
        <p className="ai-ticker-found">
          <span>{active ? (hi ? 'अब तक मिला' : 'Found so far') : (hi ? 'मिला' : 'Found')}: </span>
          {found.map((d) => (d.pages.length ? `${d.title} (p. ${d.pages.join(', ')})` : d.title)).join(' · ')}
        </p>
      ) : null}

    </div>
  );
}
