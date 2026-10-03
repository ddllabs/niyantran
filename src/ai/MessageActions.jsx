import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { safeSourceUrl } from './SourceReader.jsx';

/** Keep reference numbers meaningful when the answer leaves the workbench. */
export function answerForCopy(m, hi = false) {
  const sources = (m.sources || []).filter(s => Number.isSafeInteger(s?.id) && s.id > 0 && typeof s.title === 'string');
  const lines = sources.map(s => {
    const url = safeSourceUrl(s.file_url);
    const page = s.page_number ? ` · ${hi ? 'पृ.' : 'p.'} ${s.page_number}` : '';
    return `[${s.id}] ${s.title}${page}${url ? ` — ${url}` : ''}`;
  });
  return String(m.content || '') + (lines.length ? `\n\n${hi ? 'स्रोत' : 'Sources'}\n${lines.join('\n')}` : '');
}

export async function copyAnswer(m, clipboard, hi = false) {
  try {
    if (!clipboard?.writeText) return false;
    await clipboard.writeText(answerForCopy(m, hi));
    return true;
  } catch { return false; }
}

export default function MessageActions({ m, lang }) {
  const hi = lang === 'hi';
  const [result, setResult] = useState('');
  const [copying, setCopying] = useState(false);
  useEffect(() => {
    if (result !== 'copied') return;
    const timer = setTimeout(() => setResult(''), 2000);
    return () => clearTimeout(timer);
  }, [result]);
  const copyLabel = result === 'copied' ? (hi ? 'उत्तर कॉपी किया गया' : 'Answer copied') : (hi ? 'उत्तर कॉपी करें' : 'Copy answer');
  const date = typeof m.at === 'number' && m.at > 0 ? new Date(m.at) : null;
  const validDate = date && Number.isFinite(date.getTime());
  const canCopy = m.role === 'assistant' && m.content && m.status !== 'running';
  if (!validDate && !canCopy) return null;
  return (
    <div className="ai-message-actions">
      {canCopy ? <button type="button" disabled={copying} aria-label={copyLabel} title={copyLabel} onClick={async () => {
        setCopying(true);
        const ok = await copyAnswer(m, typeof navigator === 'undefined' ? null : navigator.clipboard, hi);
        setResult(ok ? 'copied' : 'failed');
        setCopying(false);
      }}>
        {result === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button> : null}
      {validDate ? <time dateTime={date.toISOString()} title={date.toLocaleString(hi ? 'hi-IN' : undefined)}>
        {date.toLocaleTimeString(hi ? 'hi-IN' : undefined, { hour: 'numeric', minute: '2-digit' })}
      </time> : null}
      <span role="status" className={result === 'copied' ? 'ai-copy-announcement' : undefined}>{result === 'failed' ? (hi ? 'कॉपी नहीं हुआ। पाठ चुनकर कॉपी करें।' : 'Could not copy. Select the text to copy it.') : result === 'copied' ? (hi ? 'उत्तर कॉपी किया गया।' : 'Answer copied.') : ''}</span>
    </div>
  );
}
