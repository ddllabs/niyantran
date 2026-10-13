import { GlobeIcon, cleanWebPages } from './WebSourcesList.jsx';

const MAX_DOMAINS = 3;

/** The distinct domains of the pages, pages the answer cited first, each domain once. */
function domainsOf(pages) {
  const ordered = [...pages.filter(p => p.cited), ...pages.filter(p => !p.cited)];
  const seen = new Set();
  const out = [];
  for (const { domain } of ordered) {
    const key = domain.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(domain);
  }
  return out;
}

/**
 * "From the web · unofficial" (web-search spec, F130 §6): the one row under an answer that tells the
 * reader web pages were searched. It sits apart from the document `SourceList`, is a single button,
 * and opens the list of pages in the viewer. Web pages are not citations, so it carries no number.
 * No favicon or other remote image is requested (owner decision 6): the icon is an inline globe.
 *
 * @param {{ sources: Array<{ url: string, title: string, domain: string, cited: boolean }>, messageId?: string, onOpen?: (source: { kind: 'web', pages: unknown[], messageId?: string }) => void }} props
 */
export default function WebSourceRow({ sources, messageId, onOpen }) {
  const pages = cleanWebPages(sources);
  if (!pages.length) return null;
  const domains = domainsOf(pages);
  const shown = domains.slice(0, MAX_DOMAINS);
  const count = `${pages.length} source${pages.length === 1 ? '' : 's'}`;
  const label = `From the web, unofficial: ${count} (${shown.join(', ')}${domains.length > shown.length ? ', …' : ''}). Open the list`;
  return (
    <button type="button" className="ai-web-row" aria-label={label} onClick={() => onOpen?.({ kind: 'web', pages: sources, messageId })}>
      <GlobeIcon className="ai-web-row-icon" />
      <span className="ai-web-row-label">From the web · unofficial</span>
      <span className="ai-web-row-domains">{shown.join(', ')}</span>
      <span className="ai-web-row-count">{count}</span>
    </button>
  );
}
