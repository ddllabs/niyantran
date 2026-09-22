import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { documentBlocks, readerWindow, visibleBlocks, WINDOW_CHARS } from './documentBlocks.js';
import RichText from './RichText.jsx';
import { NOTICE, resolveSpan } from './sourceReader.js';

import './research.css';
import './reader.css';

export function safeSourceUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) return null;
  try { const url = new URL(value.trim()); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

export async function loadSource(citation, client, current = () => true) {
  const unavailable = { loading: false, error: 'This document is no longer available. Try opening the source again.', doc: null, span: null };
  try {
    const { data: doc, error } = await client.from('documents')
      .select('id, title, file_name, file_url, desk_feature, ocr_text').eq('id', citation.document_id).maybeSingle();
    if (!current()) return null;
    if (error || !doc) return unavailable;
    const { data: chunk, error: chunkError } = await client.from('document_chunks').select('content').eq('id', citation.chunk_id).maybeSingle();
    if (!current()) return null;
    if (chunkError) return unavailable;
    const span = await resolveSpan(doc.ocr_text, citation, chunk?.content);
    return { loading: false, error: '', doc: { ...doc, file_url: safeSourceUrl(doc.file_url) }, span };
  } catch { return unavailable; }
}

/**
 * The reader pane (RAG spec §H): opens for a `text` citation, loads the
 * document through the Supabase client (RLS permits every signed-in user),
 * scrolls to the cited span and highlights it — or says the passage moved or
 * changed. Rendered inside the AI dock by streaming-research-agent.
 *
 * @param {{ citation: import('../types/citation.js').TextCitation, onClose?: () => void, client?: typeof supabase }} props
 */
export default function SourceReader({ citation, onClose, client = supabase }) {
  const [state, setState] = useState({ loading: true, error: '', doc: null, span: null });
  const [budget, setBudget] = useState(WINDOW_CHARS);
  const mark = useRef(null);

  useEffect(() => {
    let alive = true;
    setState({ loading: true, error: '', doc: null, span: null });
    setBudget(WINDOW_CHARS);
    loadSource(citation, client, () => alive).then(result => { if (alive && result) setState(result); });
    return () => {
      alive = false;
    };
  }, [citation.document_id, citation.chunk_id, citation.char_from, citation.char_to, citation.text_hash, client]);

  useEffect(() => {
    if (state.span && state.span.status !== 'changed') mark.current?.scrollIntoView?.({ block: 'center' });
  }, [state.span]);

  const { loading, error, doc, span } = state;
  const text = doc?.ocr_text ?? '';
  const notice = span ? NOTICE[span.status] : '';
  const fileUrl = safeSourceUrl(doc?.file_url) || safeSourceUrl(citation.file_url);

  const blocks = useMemo(() => documentBlocks(text), [text]);
  const shown = span ? visibleBlocks(blocks, readerWindow(text.length, span, budget), budget) : [];
  // What was actually laid out, which a whole table kept at the edge can widen
  // past the window; the controls offer the rest only when there is a rest.
  const first = shown[0]?.from ?? 0;
  const last = shown[shown.length - 1]?.to ?? text.length;
  // Every block the span touches is highlighted; the first one carries the ref
  // the scroll effect above looks for.
  const hit = span && span.to > span.from ? span : null;
  const scrollTo = hit ? shown.findIndex(b => b.to > hit.from && b.from < hit.to) : -1;
  const more = () => setBudget(b => b * 2);

  return (
    <section className="ai-reader" aria-label="Cited source">
      <header className="ai-reader-head">
        <div>
          <strong>{doc?.title ?? citation.title}</strong>
          <span className="ai-reader-file">
            {doc?.file_name ?? citation.file_name ?? ''}
            {fileUrl ? (
              <>
                {' '}
                <a href={fileUrl} target="_blank" rel="noreferrer">
                  Open file ↗
                </a>
              </>
            ) : null}
          </span>
        </div>
        {onClose ? (
          <button type="button" onClick={onClose} aria-label="Close reader">
            ×
          </button>
        ) : null}
      </header>
      {loading ? <p className="ai-reader-notice">Loading…</p> : null}
      {error ? (
        <p className="ai-reader-notice warn" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="ai-reader-notice warn" role="status">
          {notice}
        </p>
      ) : null}
      {doc && span ? (
        <div className="ai-reader-body" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {first > 0 ? (
            <button type="button" className="ai-reader-more" onClick={more}>
              Show more of this document
            </button>
          ) : null}
          {shown.map((block, i) => (
            <RichText
              key={`${block.from}:${block.to}`}
              text={text}
              kind={block.kind}
              from={block.from}
              to={block.to}
              mark={hit && block.to > hit.from && block.from < hit.to ? hit : null}
              markRef={i === scrollTo ? mark : null}
            />
          ))}
          {last < text.length ? (
            <button type="button" className="ai-reader-more" onClick={more}>
              Show more of this document
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
