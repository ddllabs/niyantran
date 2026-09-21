import { isTextCitation } from '../types/citation.js';

/** The distinct cited documents, in first-citation order, each with its first citation. */
export function documentChips(sources) {
  const chips = [];
  const seen = new Set();
  for (const s of sources ?? []) {
    if (!isTextCitation(s) || seen.has(s.document_id)) continue;
    seen.add(s.document_id);
    chips.push({ document_id: s.document_id, title: s.title, file_name: s.file_name, first: s });
  }
  return chips;
}

/**
 * One chip per cited document under an assistant message (RAG spec §H).
 * Clicking a chip opens the reader at that document's first citation.
 *
 * @param {{ sources: import('../types/citation.js').CitationSource[], onOpen?: (c: import('../types/citation.js').TextCitation) => void }} props
 */
export default function SourceList({ sources, onOpen }) {
  const chips = documentChips(sources);
  if (!chips.length) return null;
  return (
    <ul className="ai-sources" aria-label="Sources">
      {chips.map((c) => (
        <li key={c.document_id}>
          <button type="button" className="ai-source-chip" onClick={() => onOpen?.(c.first)} title={c.file_name || c.title}>
            <span className="ai-source-title">{c.title}</span>
            {c.file_name ? <span className="ai-source-file">{c.file_name}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
