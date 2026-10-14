/**
 * One saved message in the thread (panel-loading spec E). Memoised: it re-renders, and its
 * markdown is parsed again, only when something it shows changes - not on every streaming frame,
 * keystroke or controller emit, which used to re-render and re-parse the whole thread.
 */
import { memo } from 'react';
import ActivityTicker from './ActivityTicker.jsx';
import AiMarkdown from './AiMarkdown.jsx';
import SourceList from './SourceList.jsx';
import WebSourceStrip, { webSearchCount } from './WebSourceStrip.jsx';
import MessageActions from './MessageActions.jsx';
import { isReadableCitation } from './CitationBubble.jsx';
import { creditsText } from '../lib/creditsStore.js';

/** Props equal for rendering: the same message object, label source, handler, language and credits. */
export function sameRow(a, b) {
  return a.m === b.m && a.credits === b.credits && a.lang === b.lang && a.fallbackLabel === b.fallbackLabel
    && a.labelOf === b.labelOf && a.onOpenSource === b.onOpenSource && a.selectedSource === b.selectedSource;
}

/** The URLs an answer may link to: the pages it searched and the files of the documents it cites. */
function linksOf(m) {
  const pages = Array.isArray(m.webSources) ? m.webSources.map((p) => p?.url) : [];
  const files = Array.isArray(m.sources) ? m.sources.map((s) => s?.file_url) : [];
  return [...pages, ...files].filter((u) => typeof u === 'string');
}

/**
 * What an answer cost, in words, or '' when nothing is known (F111 §8). `credits` is only what the server
 * has said. A failed answer that saved no text is never charged (§3.1), so it says so without waiting for
 * the server; a known charge of nothing says the same. An unknown charge on any other answer says nothing.
 * A stopped answer is the exception to "no text means no cost": the round it was cut off in is still billed,
 * and its credits can arrive late (a null frame), so it shows its number when known and otherwise nothing,
 * never "No credits used" (review R, I1).
 */
export function creditsLine(m, credits) {
  if (m.role !== 'assistant' || m.status === 'running') return '';
  const known = typeof credits === 'number' && Number.isFinite(credits) && credits >= 0;
  if (m.status === 'cancelled') return known ? creditsText(credits) : '';
  if (known && credits > 0) return creditsText(credits);
  const failedEmpty = (m.status === 'error' || m.status === 'interrupted') && !String(m.content || '').trim();
  return known || failedEmpty ? 'No credits used' : '';
}

function MessageRow({ m, lang, labelOf, onOpenSource, selectedSource, credits }) {
  const readable = (m.sources || []).filter(isReadableCitation);
  const used = creditsLine(m, credits);
  return (
    <div className={`ai-msg ai-msg-${m.role}${m.error ? ' err' : ''}`}>
      {m.role === 'assistant' ? (
        <>
          {(m.activity?.length || m.timing || m.model_served || m.model || m.model_requested) ? <ActivityTicker activity={m.activity} timing={m.timing} effort={m.reasoning_effort} usage={m.usage} model={{ requested: m.model_requested || m.model, served: m.model_served || m.model }} labelOf={labelOf} sourceCount={readable.length} lang={lang} /> : null}
          {/* F131 §3: the pages searched, at the top of the answer, as on the live turn. */}
          {Array.isArray(m.webSources) && m.webSources.length ? <WebSourceStrip sources={m.webSources} searches={webSearchCount(m.activity)} messageId={m.id} onOpen={onOpenSource} /> : null}
          <AiMarkdown text={m.content} sources={m.sources || []} webSources={m.webSources} allowedLinks={linksOf(m)} onOpenSource={onOpenSource} selectedSource={selectedSource} />
          {Array.isArray(m.sources) && m.sources.length ? <SourceList sources={readable} onOpen={onOpenSource} lang={lang} /> : null}
          {m.status && m.status !== 'complete' ? <p className="ai-research-status">{m.status === 'running' ? 'Running — use Reload for the saved result.' : m.status}</p> : null}
          {m.error_message ? <p className="ai-foot warn">{m.error_message}</p> : null}
        </>
      ) : (
        m.role === 'user' ? <div className="ai-user-bubble">{m.content}</div> : m.content
      )}
      {/* An answer's footer is always the same shape, so its credits arriving later does not remount the copy button. */}
      {m.role === 'assistant' ? (
        <div className="ai-msg-foot"><MessageActions m={m} lang={lang} />{used ? <span className="ai-credit-used">{used}</span> : null}</div>
      ) : <MessageActions m={m} lang={lang} />}
    </div>
  );
}

export default memo(MessageRow, sameRow);
