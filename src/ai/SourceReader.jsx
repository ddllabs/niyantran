import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { NOTICE, resolveSpan } from './sourceReader.js';

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
  const mark = useRef(null);

  useEffect(() => {
    let alive = true;
    setState({ loading: true, error: '', doc: null, span: null });
    (async () => {
      const { data: doc, error } = await client
        .from('documents')
        .select('id, title, file_name, file_url, desk_feature, ocr_text')
        .eq('id', citation.document_id)
        .maybeSingle();
      if (!alive) return;
      if (error || !doc) {
        setState({ loading: false, error: error?.message || 'This document is no longer available.', doc: null, span: null });
        return;
      }
      const { data: chunk } = await client.from('document_chunks').select('content').eq('id', citation.chunk_id).maybeSingle();
      const span = await resolveSpan(doc.ocr_text, citation, chunk?.content);
      if (alive) setState({ loading: false, error: '', doc, span });
    })();
    return () => {
      alive = false;
    };
  }, [citation.document_id, citation.chunk_id, citation.char_from, citation.char_to, citation.text_hash, client]);

  useEffect(() => {
    if (state.span && state.span.status !== 'changed') mark.current?.scrollIntoView({ block: 'center' });
  }, [state.span]);

  const { loading, error, doc, span } = state;
  const text = doc?.ocr_text ?? '';
  const notice = span ? NOTICE[span.status] : '';

  return (
    <section className="ai-reader" aria-label="Cited source">
      <header className="ai-reader-head">
        <div>
          <strong>{doc?.title ?? citation.title}</strong>
          <span className="ai-reader-file">
            {doc?.file_name ?? citation.file_name ?? ''}
            {doc?.file_url || citation.file_url ? (
              <>
                {' '}
                <a href={doc?.file_url ?? citation.file_url} target="_blank" rel="noreferrer">
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
        <pre className="ai-reader-body" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {text.slice(0, span.from)}
          {span.to > span.from ? (
            <mark ref={mark} className="ai-reader-mark" style={{ background: 'rgba(250, 204, 21, 0.35)' }}>
              {text.slice(span.from, span.to)}
            </mark>
          ) : null}
          {text.slice(span.to)}
        </pre>
      ) : null}
    </section>
  );
}
