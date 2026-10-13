import { useId } from 'react';

/**
 * The pages a turn searched on the web (web-search spec, F130 §6). Web pages are not citations: they
 * never get a `[n]` marker, a source id or a reader. The panel lists them and links out; no page is
 * fetched or embedded, and no favicon is requested (owner decision 6), so the icon is a plain globe.
 */

/** A plain globe. Drawn inline so no icon service or image request is involved. */
export const GlobeIcon = ({ className = 'ai-web-icon', size = 16 }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9c-2.4-2.6-3.6-5.6-3.6-9S9.6 5.6 12 3z" />
  </svg>
);

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * The URL as a comparable string: scheme and host lower-cased, fragment dropped. Null for anything
 * that is not an absolute http(s) URL, so a `javascript:`, `data:` or relative link never matches.
 */
export function normaliseWebUrl(value) {
  const raw = text(value);
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  return url.href;
}

/** The domain to show: the server's, else the URL's own host. */
const domainOf = (page, url) => text(page.domain) || (url ? new URL(url).hostname : '');

/**
 * The pages worth showing, from whatever arrived: objects with a usable http(s) URL, each as
 * `{url, title, domain, cited}`. Anything else is dropped, so a malformed saved message cannot
 * put an unsafe link in the panel.
 */
export function cleanWebPages(pages) {
  const out = [];
  for (const page of Array.isArray(pages) ? pages : []) {
    if (!page || typeof page !== 'object') continue;
    const url = normaliseWebUrl(page.url) && text(page.url);
    if (!url) continue;
    const domain = domainOf(page, url);
    out.push({ url, title: text(page.title) || domain, domain, cited: page.cited === true });
  }
  return out;
}

/**
 * What the list draws: every object that has something to show. `href` is set only for an http(s)
 * URL; any other entry is drawn as text and never becomes a link, whatever reached this component.
 */
function entriesOf(pages) {
  const out = [];
  for (const page of Array.isArray(pages) ? pages : []) {
    if (!page || typeof page !== 'object') continue;
    const href = normaliseWebUrl(page.url) ? text(page.url) : null;
    const domain = domainOf(page, href);
    const title = text(page.title) || domain;
    if (!title) continue;
    out.push({ href, title, domain, cited: page.cited === true });
  }
  return out;
}

const Entry = ({ entry }) => {
  const body = (
    <>
      <GlobeIcon />
      <span className="ai-web-main">
        <span className="ai-web-title">{entry.title}</span>
        <span className="ai-web-meta">
          {entry.domain ? <span className="ai-web-domain">{entry.domain}</span> : null}
          {entry.cited ? <span className="ai-web-cited">Cited in the answer</span> : null}
        </span>
      </span>
    </>
  );
  return entry.href
    ? <a className="ai-web-entry" href={entry.href} target="_blank" rel="noopener noreferrer">{body}</a>
    : <div className="ai-web-entry">{body}</div>;
};

/**
 * @param {{ pages: Array<{ url: string, title: string, domain: string, cited: boolean }> }} props
 */
export default function WebSourcesList({ pages }) {
  const list = entriesOf(pages);
  const headingId = useId();
  return (
    <section className="ai-web-panel" aria-labelledby={headingId}>
      <h3 id={headingId} className="ai-web-heading">Web sources searched</h3>
      <p className="ai-web-note">These are pages from the web, not Niyantran records. They may be inaccurate or out of date. The desk records and documents remain the authority.</p>
      {list.length ? (
        <ul className="ai-web-list" aria-labelledby={headingId}>
          {list.map((entry, index) => <li key={`${entry.href || entry.title}:${index}`}><Entry entry={entry} /></li>)}
        </ul>
      ) : <p className="rail-empty">No web pages to show.</p>}
    </section>
  );
}
