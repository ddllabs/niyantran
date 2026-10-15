import { ChevronRight } from 'lucide-react';
import { GlobeIcon, SiteIcon, cleanWebPages } from './WebSourcesList.jsx';

const MAX_ICONS = 4;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The distinct domains of the pages, case-insensitively, pages the answer cited first. */
function domainsOf(pages) {
  const ordered = [...pages.filter(p => p.cited), ...pages.filter(p => !p.cited)];
  const seen = new Set();
  const out = [];
  for (const { domain } of ordered) {
    const key = domain.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * How many searches the turn ran: the sum of `searches` over its finished web_search steps, live or
 * saved (F131 §2). Null when no step says, as on a turn saved before the count existed.
 */
export function webSearchCount(activity) {
  let total = 0;
  for (const a of Array.isArray(activity) ? activity : []) {
    if (a?.type === 'tool' && a.name === 'web_search' && a.phase !== 'start' && Number.isInteger(a.searches) && a.searches > 0) total += a.searches;
  }
  return total || null;
}

/**
 * The strip's props on the turn in flight (F131 §2-3): the terminal `webSources` once they arrive,
 * since they are authoritative; until then, while the turn runs, the pages found so far. A turn that
 * ended without a list shows none.
 */
export function liveStrip(stream, active) {
  const final = Array.isArray(stream?.webSources) && stream.webSources.length ? stream.webSources : null;
  const sources = final || (active && Array.isArray(stream?.webLive) ? stream.webLive : []);
  return { sources, searching: Boolean(active && !final && webSearchRunning(stream?.activity)), searches: webSearchCount(stream?.activity), messageId: stream?.messageId || undefined };
}

/** A web search step has started and not ended: the strip says "Searching the web…" only then,
 * not while the answer is written after it. */
function webSearchRunning(activity) {
  const steps = (Array.isArray(activity) ? activity : []).filter((a) => a?.type === 'tool' && a.name === 'web_search');
  return steps.some((a) => a.phase === 'start' && !steps.some((b) => b.phase !== 'start' && b.step === a.step));
}

/**
 * "Web sources" (web-search streaming spec, F131 §3; F193 wording and layout, owner 2026-10-15): one
 * strip at the top of an answer, between the thinking notes and the text, the same on the live turn
 * and the saved one. Up to four site icons side by side in their own pill, then "+N" for the other
 * domains, then the page count. While the turn searches it pulses and counts the pages found so far.
 * The whole strip is one button that opens the list of pages, which carries the search count and the
 * note that web pages are not Niyantran records. Web pages are not citations, so it carries no number,
 * and it sits apart from the document sources.
 *
 * @param {{ sources: Array<{ url: string, title: string, domain: string, cited?: boolean }>, searches?: number | null, searching?: boolean, messageId?: string, onOpen?: (source: { kind: 'web', pages: unknown[], searches: number | null, messageId?: string }) => void }} props
 */
export default function WebSourceStrip({ sources, searches = null, searching = false, messageId, onOpen }) {
  const pages = cleanWebPages(sources);
  if (!pages.length) return null;
  const domains = domainsOf(pages);
  const shown = domains.slice(0, MAX_ICONS);
  const more = domains.length - shown.length;
  const pageCount = plural(pages.length, 'page', 'pages');
  const ran = searches > 0 ? searches : null;
  const named = `(${shown.join(', ')}${more ? ', …' : ''})`;
  const label = searching
    ? `Searching the web: ${pageCount} so far ${named}. Open the list`
    : `Web sources, not Niyantran records: ${pageCount}${ran ? ` from ${plural(ran, 'search', 'searches')}` : ''} ${named}. Open the list`;
  const count = searching ? `${pageCount} so far` : pageCount;
  return (
    <button type="button" className={`ai-web-strip${searching ? ' searching' : ''}`} aria-label={label} onClick={() => onOpen?.({ kind: 'web', pages: sources, searches: ran, messageId })}>
      {searching ? <GlobeIcon className="ai-web-strip-globe" size={16} /> : null}
      <span className="ai-web-strip-icons" aria-hidden="true">
        {shown.map(domain => <SiteIcon key={domain} domain={domain} />)}
        {more > 0 ? <span className="ai-web-strip-more">+{more}</span> : null}
      </span>
      <span className="ai-web-strip-text">
        <span className="ai-web-strip-label">{searching ? 'Searching the web…' : 'Web sources'}</span>
        <span className="ai-web-strip-count">{count}</span>
      </span>
      <ChevronRight className="ai-web-strip-caret" size={16} aria-hidden="true" />
    </button>
  );
}
