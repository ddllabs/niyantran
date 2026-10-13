import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import WebSourcesList, { SiteIcon, cleanWebPages, hideFailedIcon, normaliseWebUrl, siteIconUrl } from './WebSourcesList.jsx';

const PAGES = [
  { url: 'https://www.rbi.org.in/press?id=1', title: 'RBI press release', domain: 'rbi.org.in', cited: true },
  { url: 'http://pib.gov.in/x', title: 'PIB note', domain: 'pib.gov.in', cited: false },
];

describe('WebSourcesList (F130 T4b): the "Web sources searched" panel', () => {
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
  });

  // F131 §3: each entry shows its site's icon, through our own server, instead of the plain globe.
  it('shows each entry\'s site icon from our icon endpoint, with the letter beneath it as the fallback', () => {
    const html = renderToStaticMarkup(<WebSourcesList pages={PAGES} />);
    const imgs = html.match(/<img [^>]*>/g);
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toContain('src="/api/site-icon?domain=rbi.org.in"');
    expect(imgs[1]).toContain('src="/api/site-icon?domain=pib.gov.in"');
    expect(html.match(/class="ai-site-icon-letter">[RP]</g)).toHaveLength(2);
  });

  it('keeps the globe for an entry with no domain at all', () => {
    const html = renderToStaticMarkup(<WebSourcesList pages={[{ url: 'javascript:alert(1)', title: 'Untitled page', domain: '', cited: false }]} />);
    expect(html).toContain('<svg');
    expect(html).not.toContain('<img');
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
    expect(html).not.toMatch(/<iframe|<embed|<object|srcset/i);
    // The only images are site icons from our own server: never the page itself, never a third party.
    for (const src of html.match(/\ssrc="[^"]*"/g)) expect(src).toMatch(/^ src="\/api\/site-icon\?domain=[a-z0-9.-]+"$/);
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

// F131 §3-4: the site icon, its URL on our server, and the letter it falls back to.
describe('siteIconUrl and SiteIcon', () => {
  it('builds our endpoint\'s URL from the lower-cased domain, encoded, and none without a domain', () => {
    expect(siteIconUrl('Reuters.COM')).toBe('/api/site-icon?domain=reuters.com');
    expect(siteIconUrl(' pib.gov.in ')).toBe('/api/site-icon?domain=pib.gov.in');
    expect(siteIconUrl('a b/c?d')).toBe('/api/site-icon?domain=a%20b%2Fc%3Fd');
    for (const bad of ['', '  ', null, undefined, 42]) expect(siteIconUrl(bad)).toBeNull();
  });

  it('is a decorative, lazy, no-referrer image over the domain\'s first letter', () => {
    const html = renderToStaticMarkup(<SiteIcon domain="www.rbi.org.in" />);
    expect(html).toMatch(/^<span class="ai-site-icon" aria-hidden="true">/);
    expect(html).toContain('<span class="ai-site-icon-letter">R</span>');
    const img = html.match(/<img [^>]*>/)[0];
    expect(img).toContain('alt=""');
    expect(img).toContain('loading="lazy"');
    expect(img).toMatch(/referrerpolicy="no-referrer"/i);
    expect(img).toContain('src="/api/site-icon?domain=www.rbi.org.in"');
  });

  it('hides a failed image, so the letter shows and never a broken-image glyph', () => {
    const tree = SiteIcon({ domain: 'pib.gov.in' });
    const img = tree.props.children.find((c) => c?.type === 'img');
    expect(img.props.onError).toBe(hideFailedIcon);
    const target = { hidden: false };
    img.props.onError({ currentTarget: target });
    expect(target.hidden).toBe(true);
  });

  it('draws only the letter without a domain, and a neutral mark when there is no letter', () => {
    expect(renderToStaticMarkup(<SiteIcon domain="" />)).not.toContain('<img');
    expect(renderToStaticMarkup(<SiteIcon domain="" />)).toContain('ai-site-icon-letter">?<');
    expect(renderToStaticMarkup(<SiteIcon domain="xn--h2brj9c.in" />)).toContain('ai-site-icon-letter">X<');
  });
});
