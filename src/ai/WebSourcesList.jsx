import { useId } from 'react';

/**
 * The pages a turn searched on the web (web-search spec, F130 §6). Web pages are not citations: they
 * never get a `[n]` marker, a source id or a reader. The panel lists them and links out; no page is
 * fetched or embedded. Each entry shows its site's icon (F131 §3-4), which the reader's browser
 * asks only of our own server.
 */

/** A plain globe, drawn inline: the mark for the web itself, and for an entry with no domain. */
export const GlobeIcon = ({ className = 'ai-web-icon', size = 16 }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9c-2.4-2.6-3.6-5.6-3.6-9S9.6 5.6 12 3z" />
  </svg>
);

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * Our server's icon for a domain (F131 §4): `/api/site-icon` answers with the image, or 404 when the
 * site has none. Null without a domain. The server validates the host; this only lower-cases it.
 */
export function siteIconUrl(domain) {
  const host = text(domain).toLowerCase();
  return host ? `/api/site-icon?domain=${encodeURIComponent(host)}` : null;
}

/** The letter a site shows without an icon: its domain's first letter or digit, after any `www.`. */
const letterOf = (domain) => (text(domain).replace(/^www\./i, '').match(/[a-z0-9]/i)?.[0] || '?').toUpperCase();

/**
 * A failed image (an error, or our server's 404 for "no icon") is hidden, so the letter beneath it
 * shows. Done on the element rather than in state, so it works in a memoised row without a re-render.
 */
export function hideFailedIcon(event) {
  event.currentTarget.hidden = true;
}

/**
 * A round site icon (F131 §3). Decorative: the name of the site is always given in text nearby. The
 * letter sits beneath the image, so a missing icon reads as the letter and never as a broken image.
 */
export function SiteIcon({ domain, className = '' }) {
  const src = siteIconUrl(domain);
  return (
    <span className={className ? `ai-site-icon ${className}` : 'ai-site-icon'} aria-hidden="true">
      <span className="ai-site-icon-letter">{letterOf(domain)}</span>
      {src ? <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={hideFailedIcon} /> : null}
    </span>
  );
}

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
      {entry.domain ? <SiteIcon domain={entry.domain} /> : <GlobeIcon />}
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
 * @param {{ pages: Array<{ url: string, title: string, domain: string, cited: boolean }>, searches?: number | null }} props
 */
export default function WebSourcesList({ pages, searches = null }) {
  const list = entriesOf(pages);
  const headingId = useId();
  // F193: the search count lives here, not on the strip, with how many pages the answer linked.
  const cited = list.filter((entry) => entry.cited).length;
  const count = [
    searches > 0 && `${searches} ${searches === 1 ? 'search' : 'searches'}`,
    `${list.length} ${list.length === 1 ? 'page' : 'pages'}`,
    cited > 0 && `${cited} cited in the answer`,
  ].filter(Boolean).join(' · ');
  return (
    <section className="ai-web-panel" aria-labelledby={headingId}>
      <h3 id={headingId} className="ai-web-heading">Web sources searched</h3>
      <p className="ai-web-note">These are pages from the web, not Niyantran records. They may be inaccurate or out of date. The desk records and documents remain the authority.</p>
      {list.length ? <p className="ai-web-count">{count}</p> : null}
      {list.length ? (
        <ul className="ai-web-list" aria-labelledby={headingId}>
          {list.map((entry, index) => <li key={`${entry.href || entry.title}:${index}`}><Entry entry={entry} /></li>)}
        </ul>
      ) : <p className="rail-empty">No web pages to show.</p>}
    </section>
  );
}
