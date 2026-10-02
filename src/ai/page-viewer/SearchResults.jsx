/**
 * The Results list (docs/specs/2026-10-02-viewer-continuous.md, section 4): each page holding the
 * query, with its count and snippets, the matches marked. A click goes to that page's first match.
 */
import { snippetEdges, snippetParts } from './searchModel.js';

const count = hits => `${hits} ${hits === 1 ? 'match' : 'matches'}`;

/**
 * @param {{query: string, pages: {page: number, hits: number, snippets: string[]}[],
 *   onPick: (page: number) => void, current?: number}} props
 *   `query` is the folded query the pages were found for; `current` is the current match's page.
 */
export default function SearchResults({ query, pages, onPick, current = null }) {
  if (!pages.length) return <p className="pv-results-empty" role="status">No matches</p>;
  return (
    <ol className="pv-results">
      {pages.map(({ page, hits, snippets }) => (
        <li key={page}>
          <button type="button" className="pv-result" aria-current={page === current ? 'true' : undefined} onClick={() => onPick(page)}>
            <span className="pv-result-head">
              <span>Page {page}</span>
              <span className="pv-result-count">{count(hits)}</span>
            </span>
            {snippets.map((snippet, i) => (
              <span key={i} className="pv-result-snippet">
                {snippetParts(snippet, query, snippetEdges(snippet, query)).map((part, j) => (part.match ? <mark key={j}>{part.text}</mark> : part.text))}
              </span>
            ))}
          </button>
        </li>
      ))}
    </ol>
  );
}
