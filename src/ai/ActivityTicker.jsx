/**
 * What the assistant is doing, while it does it (docs/specs/2026-10-02-thinking-display.md).
 * One indicator from Send: it starts compact on "Starting…" with an elapsed clock, lists each stage once
 * and each search by what it did, and says what the searches found. When the turn ends it
 * shows one compact line ("5 searches · 3 citations · 53 s"); the
 * disclosure keeps the steps, the finds and timing buckets. Residual time is not measured reasoning. It replaced the NyAI card (ADR 0007
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

export function actionState(step, active = false, hi = false) {
  const state = step.phase !== 'end' ? (active ? 'Searching' : 'Incomplete')
    : step.status === 'cancelled' ? 'Cancelled' : step.status === 'error' ? 'Failed' : 'Completed';
  return hi ? ({Searching:'खोज जारी',Incomplete:'अधूरा',Cancelled:'रद्द',Failed:'विफल',Completed:'पूर्ण'})[state] : state;
}

const measured = (value, hi) => Number.isFinite(value) && value >= 0
  ? `${Math.round(value)} ${hi ? 'मि.से.' : 'ms'}` : (hi ? 'उपलब्ध नहीं' : 'Not available');
const EFFORTS = { off:['No reasoning','बंद'], minimal:['Minimal','न्यूनतम'], low:['Low','कम'], medium:['Medium','मध्यम'], high:['High','उच्च'], xhigh:['Extra high','बहुत उच्च'] };
const effortLabel = (effort, hi) => Object.hasOwn(EFFORTS,effort) ? EFFORTS[effort][hi ? 1 : 0] : (hi?'उपलब्ध नहीं':'Not available');

export function measurementRows(timing, steps = [], hi = false) {
  const documents = steps.filter(s=>s.type === 'tool' && s.phase === 'end' && s.name === 'search_documents');
  const sum = key => documents.length && documents.every(s=>Number.isFinite(s[key]) && s[key]>=0)
    ? documents.reduce((n,s)=>n+s[key],0) : undefined;
  const rows = [
    ['Search actions','खोज कार्रवाइयाँ',timing?.search_ms],
    ['Query embedding','प्रश्न एम्बेडिंग',sum('embeddingMs')],
    ['Database retrieval','डेटाबेस रिट्रीवल',sum('retrievalMs')],
    ['Reasoning duration','तर्क अवधि',undefined],
    ['Answer generation','उत्तर लेखन',timing?.writing_ms],
    ['Other processing','अन्य प्रोसेसिंग',timing?.reasoning_ms],
    ['Total','कुल',timing?.total_ms],
    ['First answer latency','पहले उत्तर की प्रतीक्षा',timing?.first_answer_ms > 0 ? timing.first_answer_ms : undefined],
  ];
  return rows.map(([en,local,value])=>[hi?local:en,measured(value,hi)]);
}

export function ActivityDetails({ steps = [], active = false, timing, model, effort, lang = 'en', labelOf = id=>id }) {
  const hi = lang === 'hi';
  const served = model?.served || model?.requested;
  return <div className="ai-activity-details">
    <dl className="ai-activity-measurements">
      <dt>{hi?'मॉडल':'Model'}</dt><dd>{served ? <>{labelOf(served)}<small>{served}</small></> : (hi?'उपलब्ध नहीं':'Not available')}</dd>
      {model?.requested && model?.served && model.requested !== model.served ? <><dt>{hi?'अनुरोधित मॉडल':'Requested model'}</dt><dd>{model.requested}</dd></> : null}
      <dt>{hi?'अनुरोधित सोच स्तर':'Requested thinking effort'}</dt><dd>{effortLabel(effort,hi)}</dd>
    </dl>
    {steps.length ? <ol className="ai-ticker-steps">
      {steps.map((s,i)=><li key={`${s.type}-${s.step ?? i}`} className={`ai-ticker-step ${s.type}`}>
        {s.type === 'tool' ? <>
          <div className="ai-action-heading"><strong>{actionState(s,active,hi)}</strong><span>{s.name === 'search_documents' ? (hi?'दस्तावेज़ खोज':'Document search') : (hi?'डेस्क खोज':'Desk lookup')}</span></div>
          <span>{s.phase !== 'end' && !active ? (inputOf(s).query || inputOf(s).feature || '') : stepLabel(s)}</span>
          <dl className="ai-activity-measurements">
            {Number.isSafeInteger(s.requestedTopK) && s.requestedTopK > 0 ? <><dt>{hi?'अनुरोधित टॉप-K':'Requested top-K'}</dt><dd>{s.requestedTopK}</dd></> : null}
            <dt>{hi?'बीता समय':'Elapsed'}</dt><dd>{measured(s.latencyMs,hi)}</dd>
            {s.name === 'search_documents' ? <><dt>{hi?'एम्बेडिंग':'Embedding'}</dt><dd>{measured(s.embeddingMs,hi)}</dd><dt>{hi?'डेटाबेस रिट्रीवल':'Database retrieval'}</dt><dd>{measured(s.retrievalMs,hi)}</dd></> : null}
          </dl>
        </> : <span>{s.text}</span>}
      </li>)}
    </ol> : null}
    <dl className="ai-activity-measurements ai-activity-timing">{measurementRows(timing,steps,hi).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <p className="ai-activity-note">{hi?'एम्बेडिंग और डेटाबेस समय खोज समय के हिस्से हैं। पहले उत्तर की प्रतीक्षा अन्य चरणों से ओवरलैप करती है। तर्क अवधि मापी नहीं जाती।':'Embedding and database times are included in search time. First answer latency overlaps other phases. Database time measures the RPC round trip. Reasoning duration is not measured.'}</p>
  </div>;
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
  const [open, setOpen] = useState(false);
  const now = useNow(active && startedAt > 0);

  const steps = tickerSteps(activity);
  if (!steps.length && !active && !timing && !model?.served) return null;

  const found = foundSoFar(steps);
  const last = steps[steps.length - 1];
  const summary = active
    ? (last ? stepLabel(last) : (hi ? 'शुरू हो रहा है…' : 'Starting…'))
    : finishedSummary({ steps, sourceCount, timing, hi });
  const modelId = model?.served || model?.requested;
  const head = [modelId && labelOf(modelId), effort && effortLabel(effort,hi), summary].filter(Boolean).join(' · ');

  return (
    <div className={`ai-ticker${active ? ' active' : ''}`}>
      <button
        type="button"
        className="ai-ticker-head"
        aria-expanded={open}
        onClick={() => {
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

      {open ? <ActivityDetails steps={steps} active={active} timing={timing} model={model} effort={effort} lang={lang} labelOf={labelOf} /> : null}

      {open && found.length ? (
        <p className="ai-ticker-found">
          <span>{active ? (hi ? 'अब तक मिला' : 'Found so far') : (hi ? 'मिला' : 'Found')}: </span>
          {found.map((d) => (d.pages.length ? `${d.title} (p. ${d.pages.join(', ')})` : d.title)).join(' · ')}
        </p>
      ) : null}

    </div>
  );
}
