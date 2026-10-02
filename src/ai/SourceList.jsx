import { isTextCitation } from '../types/citation.js';

const MAX_PAGES = 5;

/**
 * The distinct cited documents, in first-citation order, each with its first citation, the
 * distinct pages cited and the citation numbers (the answer's bubbles) that point into it.
 */
export function documentChips(sources) {
  const chips = [];
  const byId = new Map();
  for (const s of sources ?? []) {
    if (!isTextCitation(s)) continue;
    let c = byId.get(s.document_id);
    if (!c) {
      c = { document_id: s.document_id, title: s.title, file_name: s.file_name, desk_feature: s.desk_feature, first: s, pages: [], ids: [] };
      byId.set(s.document_id, c);
      chips.push(c);
    }
    if (Number.isSafeInteger(s.page_number) && !c.pages.includes(s.page_number)) c.pages.push(s.page_number);
    if (!c.ids.includes(s.id)) c.ids.push(s.id);
  }
  for (const c of chips) {
    c.pages.sort((a, b) => a - b);
    c.ids.sort((a, b) => a - b);
  }
  return chips;
}

/** "p. 2", "pp. 3, 5, 7", or the first five then "+N"; '' with no pages. */
function pageLabel(pages, hi) {
  if (!pages.length) return '';
  const shown = pages.slice(0, MAX_PAGES).join(', ');
  const more = pages.length > MAX_PAGES ? ` +${pages.length - MAX_PAGES}` : '';
  const prefix = hi ? 'पृ.' : pages.length === 1 ? 'p.' : 'pp.';
  return `${prefix} ${shown}${more}`;
}

const DocGlyph = () => (
  <svg className="ai-source-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </svg>
);

const Chevron = () => (
  <svg className="ai-source-go" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

/**
 * The documents cited by an assistant message, as one compact list (source-list spec). A row
 * opens the reader at that document's first citation. The storage file name is only the tooltip.
 *
 * @param {{ sources: import('../types/citation.js').CitationSource[], onOpen?: (c: import('../types/citation.js').TextCitation) => void, lang?: string }} props
 */
export default function SourceList({ sources, onOpen, lang }) {
  const chips = documentChips(sources);
  if (!chips.length) return null;
  const hi = lang === 'hi';
  const count = hi ? `${chips.length} दस्तावेज़` : `${chips.length} document${chips.length === 1 ? '' : 's'}`;
  return (
    <section className="ai-sources-block">
      <p className="ai-sources-label">{hi ? 'स्रोत' : 'Sources'} · {count}</p>
      <ul className="ai-sources" aria-label={hi ? 'स्रोत' : 'Sources'}>
        {chips.map((c) => {
          const pages = pageLabel(c.pages, hi);
          return (
            <li key={c.document_id}>
              <button type="button" className="ai-source-chip" onClick={() => onOpen?.(c.first)} title={c.file_name || c.title}>
                <DocGlyph />
                <span className="ai-source-main">
                  <span className="ai-source-title">{c.title}</span>
                  <span className="ai-source-meta">
                    {c.desk_feature ? <span>{c.desk_feature}</span> : null}
                    {pages ? <span>{pages}</span> : null}
                    <span className="ai-source-ids">
                      {hi ? 'उद्धरण' : 'cited'}
                      {c.ids.map((id) => <span key={id} className="ai-source-id">{id}</span>)}
                    </span>
                  </span>
                </span>
                <Chevron />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
