import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import WebSourcesList, { cleanWebPages, normaliseWebUrl } from './WebSourcesList.jsx';

const PAGES = [
  { url: 'https://www.rbi.org.in/press?id=1', title: 'RBI press release', domain: 'rbi.org.in', cited: true },
  { url: 'http://pib.gov.in/x', title: 'PIB note', domain: 'pib.gov.in', cited: false },
];

describe('WebSourcesList (F124 T4b): the "Web sources searched" panel', () => {
  it('has the heading, the unofficial note and one entry per page with title, domain and the cited marker', () => {
    const html = renderToStaticMarkup(<WebSourcesList pages={PAGES} />);
    expect(html).toContain('Web sources searched');
    expect(html).toMatch(/not Niyantran records/i);
    expect(html).toMatch(/inaccurate/i);
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html).toContain('RBI press release');
    expect(html).toContain('rbi.org.in');
    expect(html.match(/Cited in the answer/g)).toHaveLength(1);
    expect(html.indexOf('Cited in the answer')).toBeLessThan(html.indexOf('PIB note'));
    expect(html.match(/<svg/g).length).toBeGreaterThanOrEqual(2);
  });

  it('links each page out with target _blank and rel noopener noreferrer, and embeds nothing', () => {
    const html = renderToStaticMarkup(<WebSourcesList pages={PAGES} />);
    const anchors = html.match(/<a [^>]*>/g);
    expect(anchors).toHaveLength(2);
    for (const a of anchors) {
      expect(a).toContain('target="_blank"');
      expect(a).toContain('rel="noopener noreferrer"');
    }
    expect(anchors[0]).toContain('href="https://www.rbi.org.in/press?id=1"');
    expect(anchors[1]).toContain('href="http://pib.gov.in/x"');
    expect(html).not.toMatch(/<img|<iframe|<embed|<object|favicon|\ssrc=/i);
  });

  it('never renders a link for a URL that is not http or https; it is shown as text', () => {
    const bad = [
      { url: 'javascript:alert(1)', title: 'Click me', domain: 'evil.example', cited: false },
      { url: 'data:text/html,<b>x</b>', title: 'Data page', domain: 'data.example', cited: false },
      { url: 'ftp://files.example/x', title: 'FTP page', domain: 'files.example', cited: false },
      { url: '//protocol-relative.example/x', title: 'Relative page', domain: 'rel.example', cited: false },
    ];
    const html = renderToStaticMarkup(<WebSourcesList pages={bad} />);
    expect(html).not.toContain('<a ');
    expect(html).not.toMatch(/href=/i);
    expect(html).not.toContain('javascript:');
    expect(html).toContain('Click me');
    expect(html).toContain('FTP page');
  });

  it('falls back to the domain for a page without a title, and derives a missing domain from the URL', () => {
    const html = renderToStaticMarkup(<WebSourcesList pages={[{ url: 'https://Example.ORG/a', title: '  ', domain: '', cited: false }]} />);
    expect(html).toContain('example.org');
  });

  it('says so when there is nothing to list', () => {
    expect(renderToStaticMarkup(<WebSourcesList pages={[]} />)).toContain('No web pages');
  });
});

describe('cleanWebPages and normaliseWebUrl', () => {
  it('keeps only well-formed http(s) pages and drops everything else', () => {
    const out = cleanWebPages([
      PAGES[0], null, 'x', {}, { url: '' }, { url: 'javascript:alert(1)', title: 't' }, { url: 'ftp://x.example/', title: 't' },
      { url: 'https://ok.example/p', title: 'OK', domain: 'ok.example', cited: 'yes' },
    ]);
    expect(out.map(p => p.url)).toEqual([PAGES[0].url, 'https://ok.example/p']);
    expect(out[1].cited).toBe(false);
    expect(cleanWebPages(undefined)).toEqual([]);
  });

  it('normalises scheme and host case and drops the fragment, and rejects non-http', () => {
    expect(normaliseWebUrl('HTTPS://Example.ORG/Path?q=1#frag')).toBe('https://example.org/Path?q=1');
    expect(normaliseWebUrl('https://example.org/a#x')).toBe(normaliseWebUrl('https://EXAMPLE.org/a'));
    expect(normaliseWebUrl('javascript:alert(1)')).toBeNull();
    expect(normaliseWebUrl('not a url')).toBeNull();
    expect(normaliseWebUrl(undefined)).toBeNull();
  });
});
