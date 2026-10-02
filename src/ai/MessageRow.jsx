/**
 * One saved message in the thread (panel-loading spec E). Memoised: it re-renders, and its
 * markdown is parsed again, only when something it shows changes - not on every streaming frame,
 * keystroke or controller emit, which used to re-render and re-parse the whole thread.
 */
import { memo } from 'react';
import ActivityTicker from './ActivityTicker.jsx';
import AiMarkdown from './AiMarkdown.jsx';
import SourceList from './SourceList.jsx';
import { isReadableCitation } from './CitationBubble.jsx';

/** Props equal for rendering: the same message object, label source, handler and language. */
export function sameRow(a, b) {
  return a.m === b.m && a.lang === b.lang && a.fallbackLabel === b.fallbackLabel
    && a.labelOf === b.labelOf && a.onOpenSource === b.onOpenSource;
}

function MessageRow({ m, lang, fallbackLabel, labelOf, onOpenSource }) {
  const hi = lang === 'hi';
  const readable = (m.sources || []).filter(isReadableCitation);
  return (
    <div className={`ai-msg ai-msg-${m.role}${m.error ? ' err' : ''}`}>
      <span>{m.role === 'user' ? (hi ? 'आप' : 'You') : (m.model ? labelOf(m.model) : fallbackLabel)}</span>
      {m.role === 'assistant' ? (
        <>
          {(m.activity?.length || m.timing || m.model_served) ? <ActivityTicker activity={m.activity} timing={m.timing} usage={m.usage} model={{ requested: m.model_requested, served: m.model_served }} labelOf={labelOf} sourceCount={readable.length} lang={lang} /> : null}
          <AiMarkdown text={m.content} sources={m.sources || []} onOpenSource={onOpenSource} />
          {Array.isArray(m.sources) && m.sources.length ? <SourceList sources={readable} onOpen={onOpenSource} lang={lang} /> : null}
          {m.status && m.status !== 'complete' ? <p className="ai-research-status">{m.status === 'running' ? 'Running — use Reload for the saved result.' : m.status}</p> : null}
          {m.error_message ? <p className="ai-foot warn">{m.error_message}</p> : null}
        </>
      ) : (
        m.content
      )}
    </div>
  );
}

export default memo(MessageRow, sameRow);
