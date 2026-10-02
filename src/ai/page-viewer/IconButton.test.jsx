import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IconButton, IconLink } from './IconButton.jsx';
import { ChevronRight, ExternalLink } from './icons.js';

describe('IconButton', () => {
  it('is a button named by its label, with a decorative icon and a hidden tooltip carrying the key', () => {
    const html = renderToStaticMarkup(<IconButton icon={ChevronRight} label="Next page" shortcut="→" keys="ArrowRight ]" />);
    expect(html).toMatch(/^<button type="button" class="pv-icon" aria-label="Next page" aria-keyshortcuts="ArrowRight \]"/);
    expect(html).toContain('data-tip=""');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).toContain('<span class="pv-tip" aria-hidden="true">Next page<kbd>→</kbd></span>');
  });

  it('passes the tooltip placement and any other button props through', () => {
    const html = renderToStaticMarkup(<IconButton icon={ChevronRight} label="Next page" tipSide="above" tipAlign="end" className="x" aria-haspopup="dialog" />);
    expect(html).toContain('data-tip-side="above"');
    expect(html).toContain('data-tip-align="end"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('class="pv-icon x"');
  });

  it('at a limit stays focusable and says so, so the press that reached the limit keeps focus', () => {
    const html = renderToStaticMarkup(<IconButton icon={ChevronRight} label="Next page" unavailable onClick={() => { throw new Error('must not run'); }} />);
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('disabled=""');
  });
});

describe('IconLink', () => {
  it('opens in a new tab without an opener or referrer, and says so in its name', () => {
    const html = renderToStaticMarkup(<IconLink icon={ExternalLink} label="Open original file" href="https://sansad.in/a.pdf" />);
    expect(html).toContain('href="https://sansad.in/a.pdf"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain('aria-label="Open original file (opens in a new tab)"');
  });
});
