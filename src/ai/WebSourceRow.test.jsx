import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import WebSourceRow from './WebSourceRow.jsx';

const page = (domain, cited = false, path = '') => ({ url: `https://${domain}/${path}`, title: `Page on ${domain}`, domain, cited });
const FIVE = [page('rbi.org.in', true, 'a'), page('pib.gov.in', true, 'b'), page('rbi.org.in', false, 'c'), page('thehindu.com', false, 'd'), page('livemint.com', false, 'e')];

describe('WebSourceRow (F124 T4b): the "From the web" row under an answer', () => {
  it('is one button with the label, the distinct domains and the count', () => {
    const html = renderToStaticMarkup(<WebSourceRow sources={FIVE} messageId="a1" onOpen={() => {}} />);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('type="button"');
    expect(html).toContain('From the web · unofficial');
    expect(html).toContain('rbi.org.in');
    expect(html).toContain('pib.gov.in');
    expect(html).toContain('thehindu.com');
    expect(html).not.toContain('livemint.com');
    expect(html).toContain('5 sources');
    expect(html).toContain('<svg');
  });

  it('shows a domain once even when several of its pages were searched, and singular for one source', () => {
    const html = renderToStaticMarkup(<WebSourceRow sources={[page('rbi.org.in', true, 'a'), page('rbi.org.in', false, 'b')]} onOpen={() => {}} />);
    expect(html.match(/rbi\.org\.in/g)).toHaveLength(2); // the visible domain and the accessible name
    expect(html).toContain('2 sources');
    const one = renderToStaticMarkup(<WebSourceRow sources={[page('pib.gov.in')]} onOpen={() => {}} />);
    expect(one).toContain('1 source<');
    expect(one).not.toContain('1 sources');
  });

  it('lists cited pages\' domains first, up to three', () => {
    const sources = [page('a.example', false), page('b.example', false), page('c.example', true), page('d.example', true)];
    const html = renderToStaticMarkup(<WebSourceRow sources={sources} onOpen={() => {}} />);
    expect(html.indexOf('c.example')).toBeLessThan(html.indexOf('d.example'));
    expect(html.indexOf('d.example')).toBeLessThan(html.indexOf('a.example'));
    expect(html).not.toContain('b.example');
  });

  it('has an accessible name that says unofficial, the count, the domains and the action', () => {
    const html = renderToStaticMarkup(<WebSourceRow sources={FIVE} onOpen={() => {}} />);
    expect(html).toContain('aria-label="From the web, unofficial: 5 sources (rbi.org.in, pib.gov.in, thehindu.com, …). Open the list"');
    const two = renderToStaticMarkup(<WebSourceRow sources={[page('rbi.org.in'), page('pib.gov.in')]} onOpen={() => {}} />);
    expect(two).toContain('aria-label="From the web, unofficial: 2 sources (rbi.org.in, pib.gov.in). Open the list"');
  });

  it('makes no third-party request: no image, no favicon, no remote src or srcset', () => {
    const html = renderToStaticMarkup(<WebSourceRow sources={FIVE} onOpen={() => {}} />);
    expect(html).not.toMatch(/<img|<link|favicon|srcset|\ssrc=|url\(/i);
    expect(html).not.toContain('https://');
  });

  it('opens the list with the pages and the message id', () => {
    const onOpen = vi.fn();
    WebSourceRow({ sources: FIVE, messageId: 'a1', onOpen }).props.onClick();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith({ kind: 'web', pages: FIVE, messageId: 'a1' });
  });

  it('renders nothing without sources, and ignores entries that are not pages', () => {
    for (const sources of [undefined, null, [], 'x', {}, [null, {}, { url: 'javascript:alert(1)', domain: 'x' }]]) {
      expect(renderToStaticMarkup(<WebSourceRow sources={sources} onOpen={() => {}} />)).toBe('');
    }
  });
});
