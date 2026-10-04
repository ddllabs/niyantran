import { Check, CircleAlert, PenLine, Search, Sparkles } from 'lucide-react';

export function actionState(step, active = false, hi = false) {
  const state = step.phase !== 'end' ? (active ? 'Searching' : 'Incomplete')
    : step.status === 'cancelled' ? 'Cancelled' : step.status === 'error' ? 'Failed' : 'Completed';
  return hi ? ({Searching:'खोज जारी',Incomplete:'अधूरा',Cancelled:'रद्द',Failed:'विफल',Completed:'पूर्ण'})[state] : state;
}

export const measured = (value, hi) => Number.isFinite(value) && value >= 0
  ? `${Math.round(value)} ${hi ? 'मि.से.' : 'ms'}` : (hi ? 'उपलब्ध नहीं' : 'Not available');
const EFFORTS = { off:['No reasoning','बंद'], minimal:['Minimal','न्यूनतम'], low:['Low','कम'], medium:['Medium','मध्यम'], high:['High','उच्च'], xhigh:['Extra high','बहुत उच्च'], max:['Max','अधिकतम'] };
export const effortLabel = (effort, hi) => Object.hasOwn(EFFORTS,effort) ? EFFORTS[effort][hi ? 1 : 0] : (hi?'उपलब्ध नहीं':'Not available');

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

/** Public actions only. No diagnostic tables interrupt the reading flow. */
export default function ResearchFlow({
  steps = [], active = false, timing, lang = 'en',
}) {
  const hi = lang === 'hi';
  const durations = [
    ['search_ms', hi ? 'खोज' : 'Searching'],
    ['reasoning_ms', hi ? 'प्रसंस्करण' : 'Processing'],
    ['writing_ms', hi ? 'लेखन' : 'Writing'],
  ].filter(([key]) => Number.isFinite(timing?.[key]) && timing[key] >= 0);
  const displayed = steps.length ? steps : active
    ? [{type:'activity',text:hi ? 'शुरू हो रहा है…' : 'Starting…'}] : [];
  return <div className="ai-research-flow">
    {durations.length ? <p className="ai-flow-timing">
      {durations.map(([key, label]) => <span key={key}
        title={key === 'reasoning_ms' ? (hi ? 'खोज और लेखन के बाहर का समय, जिसमें प्रतीक्षा शामिल है।' : 'Time outside searching and writing, including waiting; not measured model reasoning.') : undefined}>
        {label} <strong>{timing[key] < 1000 ? measured(timing[key], hi) : `${(timing[key] / 1000).toFixed(1)} ${hi ? 'से.' : 's'}`}</strong>
      </span>)}
    </p> : null}
    {displayed.length ? <ol className="ai-flow-stages">
      {displayed.map((step, index) => <Stage key={`${step.type}-${step.step ?? index}`}
        step={step} active={active} hi={hi}
        current={active && index === displayed.length - 1 && (step.type === 'activity' || step.phase !== 'end')} />)}
    </ol> : null}

  </div>;
}
