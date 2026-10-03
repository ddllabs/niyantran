import { Check, CircleAlert, PenLine, Search, Sparkles } from 'lucide-react';

export function actionState(step, active = false, hi = false) {
  const state = step.phase !== 'end' ? (active ? 'Searching' : 'Incomplete')
    : step.status === 'cancelled' ? 'Cancelled' : step.status === 'error' ? 'Failed' : 'Completed';
  return hi ? ({Searching:'खोज जारी',Incomplete:'अधूरा',Cancelled:'रद्द',Failed:'विफल',Completed:'पूर्ण'})[state] : state;
}

export const measured = (value, hi) => Number.isFinite(value) && value >= 0
  ? `${Math.round(value)} ${hi ? 'मि.से.' : 'ms'}` : (hi ? 'उपलब्ध नहीं' : 'Not available');
const EFFORTS = { off:['No reasoning','बंद'], minimal:['Minimal','न्यूनतम'], low:['Low','कम'], medium:['Medium','मध्यम'], high:['High','उच्च'], xhigh:['Extra high','बहुत उच्च'] };
export const effortLabel = (effort, hi) => Object.hasOwn(EFFORTS,effort) ? EFFORTS[effort][hi ? 1 : 0] : (hi?'उपलब्ध नहीं':'Not available');

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


function Stage({ step, current, active, hi }) {
  const tool = step.type === 'tool';
  const state = actionState(step, active);
  const success = tool && state === 'Completed';
  const failed = tool && ['Failed', 'Cancelled', 'Incomplete'].includes(state);
  const writing = !tool && /writing the answer/i.test(step.text);
  const Icon = success ? Check : failed ? CircleAlert : tool ? Search : writing ? PenLine : Sparkles;
  const title = tool
    ? (step.name === 'search_documents' ? (hi ? 'दस्तावेज़ खोज' : success ? 'Searched documents' : 'Document search') : (hi ? 'डेस्क खोज' : 'Desk lookup'))
    : step.text;
  const query = [step.input?.query, step.input?.feature, step.input?.tier]
    .find(value => typeof value === 'string' && value.trim());
  const count = Number.isSafeInteger(step.resultCount) && step.resultCount >= 0
    ? `${step.resultCount} ${step.name === 'search_documents' ? (hi ? 'अंश' : step.resultCount === 1 ? 'passage' : 'passages') : (hi ? 'पंक्तियाँ' : step.resultCount === 1 ? 'row' : 'rows')}` : '';
  return <li className={`ai-flow-step${current ? ' current' : ''}${failed ? ' unsuccessful' : ''}`}>
    <span className="ai-flow-marker"><Icon size={15} aria-hidden="true" /></span>
    <div className="ai-flow-content">
      <div className="ai-flow-heading">
        <span>{title}</span>
        {tool ? <span className={`ai-flow-badge${success ? ' success' : ''}`}>
          {success && count ? count : state === 'Searching' ? (hi ? 'जारी' : 'In progress') : actionState(step, active, hi)}
          {Number.isFinite(step.latencyMs) && step.latencyMs >= 0 && step.phase === 'end' ? ` · ${measured(step.latencyMs, hi)}` : ''}
        </span> : current ? <span className="ai-flow-badge">{hi ? 'जारी' : 'In progress'}</span> : null}
      </div>
      {tool && query ? <p className="ai-flow-query">“{query}”</p> : null}
    </div>
  </li>;
}

/** Public actions only. Diagnostics stay behind a second, native disclosure. */
export default function ResearchFlow({
  steps = [], active = false, timing, model, effort, usage, lang = 'en', labelOf = id => id,
}) {
  const hi = lang === 'hi';
  const modelId = model?.served || model?.requested;
  const tokens = usage?.reasoning_tokens;
  const hasTokens = Number.isSafeInteger(tokens) && tokens >= 0;
  const displayed = steps.length ? steps : active
    ? [{type:'activity',text:hi ? 'शुरू हो रहा है…' : 'Starting…'}] : [];
  return <div className="ai-research-flow">
    {hasTokens ? <p className="ai-flow-usage"><Sparkles size={14} aria-hidden="true" />
      {tokens} {hi ? 'तर्क टोकन' : 'reasoning tokens'}
    </p> : null}
    {displayed.length ? <ol className="ai-flow-stages">
      {displayed.map((step, index) => <Stage key={`${step.type}-${step.step ?? index}`}
        step={step} active={active} hi={hi}
        current={active && index === displayed.length - 1 && (step.type === 'activity' || step.phase !== 'end')} />)}
    </ol> : null}
    <details className="ai-flow-technical">
      <summary>{hi ? 'तकनीकी विवरण' : 'Technical details'}</summary>
      <dl className="ai-activity-measurements">
        <dt>{hi ? 'मॉडल' : 'Model'}</dt><dd>{modelId ? <>{labelOf(modelId)}<small>{modelId}</small></> : (hi ? 'उपलब्ध नहीं' : 'Not available')}</dd>
        {model?.requested && model?.served && model.requested !== model.served ? <>
          <dt>{hi ? 'अनुरोधित मॉडल' : 'Requested model'}</dt><dd>{model.requested}</dd>
        </> : null}
        <dt>{hi ? 'अनुरोधित सोच स्तर' : 'Requested thinking effort'}</dt><dd>{effortLabel(effort, hi)}</dd>
      </dl>
      {steps.filter(step => step.type === 'tool').map(step => <section className="ai-flow-action-detail" key={step.step}>
        <p>{step.name === 'search_documents' ? (hi ? 'दस्तावेज़ खोज' : 'Document search') : (hi ? 'डेस्क खोज' : 'Desk lookup')} · {actionState(step, active, hi)}</p>
        <dl className="ai-activity-measurements">
          {Number.isSafeInteger(step.requestedTopK) && step.requestedTopK > 0 ? <>
            <dt>{hi ? 'अनुरोधित टॉप-K' : 'Requested top-K'}</dt><dd>{step.requestedTopK}</dd>
          </> : null}
          <dt>{hi ? 'बीता समय' : 'Elapsed'}</dt><dd>{measured(step.latencyMs, hi)}</dd>
          {step.name === 'search_documents' ? <>
            <dt>{hi ? 'एम्बेडिंग' : 'Embedding'}</dt><dd>{measured(step.embeddingMs, hi)}</dd>
            <dt>{hi ? 'डेटाबेस रिट्रीवल' : 'Database retrieval'}</dt><dd>{measured(step.retrievalMs, hi)}</dd>
          </> : null}
        </dl>
      </section>)}
      <dl className="ai-activity-measurements ai-activity-timing">
        {measurementRows(timing, steps, hi).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      <p className="ai-activity-note">{hi
        ? 'एम्बेडिंग और डेटाबेस समय खोज समय के हिस्से हैं। पहले उत्तर की प्रतीक्षा अन्य चरणों से ओवरलैप करती है। तर्क अवधि मापी नहीं जाती।'
        : 'Embedding and database times are included in search time. First answer latency overlaps other phases. Database time measures the RPC round trip. Reasoning duration is not measured.'}</p>
    </details>
  </div>;
}
