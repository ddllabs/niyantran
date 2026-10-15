import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import WebSourceStrip, { liveStrip, webSearchCount } from './WebSourceStrip.jsx';

const page = (domain, cited = false, path = '') => ({ url: `https://${domain}/${path}`, title: `Page on ${domain}`, domain, cited });
const FIVE = [page('rbi.org.in', true, 'a'), page('pib.gov.in', true, 'b'), page('rbi.org.in', false, 'c'), page('thehindu.com', false, 'd'), page('livemint.com', false, 'e')];
const SIX_DOMAINS = ['a.example', 'b.example', 'c.example', 'd.example', 'e.example', 'f.example'].map((d) => page(d));
const icons = (html) => (html.match(/<img [^>]*src="\/api\/site-icon\?domain=([^"]+)"/g) || []).map((m) => m.match(/domain=([^"]+)"/)[1]);

// F131 §3: one strip at the top of the answer, with the sites' icons. It replaced F130's WebSourceRow,
// whose still-relevant assertions moved here.
describe('WebSourceStrip: the "Web sources" strip at the top of an answer', () => {
  // F193 (owner 2026-10-15): "Web sources" and the page count; the unofficial note is in the list.
  it('is one button with the label and the page count, singular for one page', () => {
    const html = renderToStaticMarkup(<WebSourceStrip sources={FIVE} messageId="a1" onOpen={() => {}} />);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('type="button"');
    expect(html).toContain('<span class="ai-web-strip-label">Web sources</span>');
    expect(html).toContain('<span class="ai-web-strip-count">5 pages</span>');
    expect(html).not.toContain('unofficial');
    const one = renderToStaticMarkup(<WebSourceStrip sources={[page('pib.gov.in')]} onOpen={() => {}} />);
    expect(one).toContain('>1 page<');
    expect(one).not.toContain('1 pages');
  });

  it('shows one icon per distinct domain, case-insensitively, cited pages first', () => {
    const html = renderToStaticMarkup(<WebSourceStrip sources={[...FIVE, page('RBI.org.in', false, 'f')]} onOpen={() => {}} />);
    expect(icons(html)).toEqual(['rbi.org.in', 'pib.gov.in', 'thehindu.com', 'livemint.com']);
    const sources = [page('a.example'), page('b.example'), page('c.example', true), page('d.example', true)];
    expect(icons(renderToStaticMarkup(<WebSourceStrip sources={sources} onOpen={() => {}} />))).toEqual(['c.example', 'd.example', 'a.example', 'b.example']);
  });

  it('shows four icons and "+N" for the remaining domains when there are more than four', () => {
    const html = renderToStaticMarkup(<WebSourceStrip sources={SIX_DOMAINS} onOpen={() => {}} />);
    expect(icons(html)).toEqual(['a.example', 'b.example', 'c.example', 'd.example']);
    expect(html).toContain('<span class="ai-web-strip-more">+2</span>');
    const five = renderToStaticMarkup(<WebSourceStrip sources={SIX_DOMAINS.slice(0, 5)} onOpen={() => {}} />);
    expect(icons(five)).toHaveLength(4);
    expect(five).toContain('>+1</span>');
  });

  it('shows no "+N" for four domains or fewer, however many pages they have', () => {
    for (const sources of [SIX_DOMAINS.slice(0, 4), FIVE, [page('a.example')]]) {
      const html = renderToStaticMarkup(<WebSourceStrip sources={sources} onOpen={() => {}} />);
      expect(html).not.toContain('ai-web-strip-more');
      expect(html).not.toMatch(/>\+\d/);
    }
  });

  it('draws each icon as a decorative, lazy, no-referrer image from our own server, over its letter', () => {
    const html = renderToStaticMarkup(<WebSourceStrip sources={FIVE} onOpen={() => {}} />);
    for (const img of html.match(/<img [^>]*>/g)) {
      expect(img).toContain('alt=""');
      expect(img).toContain('loading="lazy"');
      expect(img).toMatch(/referrerpolicy="no-referrer"/i);
    }
    for (const src of html.match(/\ssrc="[^"]*"/g)) expect(src).toMatch(/^ src="\/api\/site-icon\?domain=/);
    expect(html).not.toMatch(/srcset|favicon|https:\/\//i);
    expect(html.match(/class="ai-site-icon-letter">([A-Z])</g)).toEqual(['class="ai-site-icon-letter">R<', 'class="ai-site-icon-letter">P<', 'class="ai-site-icon-letter">T<', 'class="ai-site-icon-letter">L<']);
  });

  it('has an accessible name that says the pages are not Niyantran records, the count, the first domains and the action', () => {
    const html = renderToStaticMarkup(<WebSourceStrip sources={SIX_DOMAINS} onOpen={() => {}} />);
    expect(html).toContain('aria-label="Web sources, not Niyantran records: 6 pages (a.example, b.example, c.example, d.example, …). Open the list"');
    const two = renderToStaticMarkup(<WebSourceStrip sources={[page('rbi.org.in'), page('pib.gov.in')]} searches={1} onOpen={() => {}} />);
    expect(two).toContain('aria-label="Web sources, not Niyantran records: 2 pages from 1 search (rbi.org.in, pib.gov.in). Open the list"');
  });

  it('leaves the search count to the list it opens', () => {
    const html = renderToStaticMarkup(<WebSourceStrip sources={FIVE} searches={3} onOpen={() => {}} />);
    expect(html).toContain('<span class="ai-web-strip-count">5 pages</span>');
    expect(html).toContain('aria-label="Web sources, not Niyantran records: 5 pages from 3 searches');
  });

  it('while searching: a pulsing globe, "Searching the web…" and the pages so far', () => {
    const html = renderToStaticMarkup(<WebSourceStrip sources={FIVE} searching searches={2} onOpen={() => {}} />);
    expect(html).toContain('class="ai-web-strip searching"');
    expect(html).toContain('ai-web-strip-globe');
    expect(html).toContain('Searching the web…');
    expect(html).toContain('5 pages so far');
    expect(html).not.toContain('>Web sources<');
    expect(html).not.toContain('2 searches');
    expect(html).toContain('aria-label="Searching the web: 5 pages so far (rbi.org.in, pib.gov.in, thehindu.com, livemint.com). Open the list"');
    expect(icons(html)).toHaveLength(4);
    const done = renderToStaticMarkup(<WebSourceStrip sources={FIVE} onOpen={() => {}} />);
    expect(done).not.toContain('ai-web-strip-globe');
    expect(done).not.toContain('searching');
  });

  it('opens the list with the pages, the search count and the message id', () => {
    const onOpen = vi.fn();
    WebSourceStrip({ sources: FIVE, searches: 2, messageId: 'a1', onOpen }).props.onClick();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith({ kind: 'web', pages: FIVE, searches: 2, messageId: 'a1' });
  });

  it('renders nothing without sources, and ignores entries that are not pages', () => {
    for (const sources of [undefined, null, [], 'x', {}, [null, {}, { url: 'javascript:alert(1)', domain: 'x' }]]) {
      expect(renderToStaticMarkup(<WebSourceStrip sources={sources} onOpen={() => {}} />)).toBe('');
      expect(renderToStaticMarkup(<WebSourceStrip sources={sources} searching onOpen={() => {}} />)).toBe('');
    }
  });

  it('stops the pulse for readers who ask for reduced motion', () => {
    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.ai-web-strip\.searching \.ai-web-strip-globe\s*\{[^}]*animation:/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.ai-web-strip-globe\s*\{\s*animation: none/);
  });
});

describe('webSearchCount', () => {
  it('adds up the searches of the finished web_search steps, saved or live', () => {
    expect(webSearchCount([
      { type: 'activity', text: 'Planning' },
      { type: 'tool', name: 'web_search', phase: 'start', step: 1 },
      { type: 'tool', name: 'web_search', phase: 'end', step: 1, resultCount: 9, searches: 2 },
      { type: 'tool', name: 'web_search', step: 4, resultCount: 6, searches: 1 },
      { type: 'tool', name: 'search_documents', phase: 'end', step: 2, searches: 5 },
    ])).toBe(3);
  });

  it('is null when no step says how many searches ran', () => {
    for (const activity of [undefined, null, [], [{ type: 'tool', name: 'web_search', phase: 'end', resultCount: 5 }],
      [{ type: 'tool', name: 'web_search', phase: 'end', searches: '3' }, { type: 'tool', name: 'web_search', phase: 'end', searches: -1 }, null]]) {
      expect(webSearchCount(activity)).toBeNull();
    }
  });
});

describe('liveStrip: the strip\'s props on the turn in flight', () => {
  const live = [page('reuters.com')];
  const final = [page('pib.gov.in', true)];
  const activity = [{ type: 'tool', name: 'web_search', phase: 'end', step: 1, searches: 2 }];
  const running = [{ type: 'tool', name: 'web_search', phase: 'start', step: 1 }];
  it('uses the pages found so far while the turn runs, and says it is searching while a web search runs', () => {
    expect(liveStrip({ webSources: [], webLive: live, activity: running, messageId: '' }, true)).toEqual({ sources: live, searching: true, searches: null, messageId: undefined });
  });
  it('stops saying it is searching once the web search step ends, while the answer is written', () => {
    const ended = [...running, ...activity];
    expect(liveStrip({ webSources: [], webLive: live, activity: ended }, true)).toMatchObject({ sources: live, searching: false, searches: 2 });
  });
  it('searches again when a later research round starts another web search', () => {
    const again = [...running, ...activity, { type: 'tool', name: 'web_search', phase: 'start', step: 3 }];
    expect(liveStrip({ webSources: [], webLive: live, activity: again }, true).searching).toBe(true);
  });
  it('uses the terminal list once it arrives, which replaces the live pages, and stops searching', () => {
    expect(liveStrip({ webSources: final, webLive: live, activity, messageId: 'm1' }, true)).toEqual({ sources: final, searching: false, searches: 2, messageId: 'm1' });
    expect(liveStrip({ webSources: final, webLive: live }, false)).toMatchObject({ sources: final, searching: false, searches: null });
  });
  it('has no pages once the turn has ended without a list, or without a stream', () => {
    expect(liveStrip({ webSources: [], webLive: live }, false).sources).toEqual([]);
    expect(liveStrip(null, true)).toMatchObject({ sources: [], searching: false });
  });
});
