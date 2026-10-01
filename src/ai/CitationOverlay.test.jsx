import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import CitationOverlay from './CitationOverlay.jsx';

const CHAT = <div className="chat-probe">chat</div>;
const VIEWER = <div className="viewer-probe">viewer</div>;
const css = readFileSync(new URL('./citation-overlay.css', import.meta.url), 'utf8');

/** The rules inside the first `@media <query> {` block, matched by brace depth. */
function mediaBlock(query) {
  const start = css.indexOf(`@media ${query}`);
  if (start < 0) return '';
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  return '';
}

describe('CitationOverlay markup', () => {
  it('closed: only the chat, in its wrapper, with no overlay classes and no viewer pane', () => {
    const html = renderToStaticMarkup(<CitationOverlay open={false} viewer={null}>{CHAT}</CitationOverlay>);
    expect(html).toBe('<div class="cov"><div class="cov-chat"><div class="chat-probe">chat</div></div></div>');
  });

  it('open on a desktop: the overlay class, the chat on the left, the viewer on the right, nothing inert', () => {
    const html = renderToStaticMarkup(<CitationOverlay open viewer={VIEWER} narrow={false}>{CHAT}</CitationOverlay>);
    expect(html).toMatch(/^<div class="cov is-open"[ >]/);
    expect(html).toContain('<div class="cov-chat"><div class="chat-probe">chat</div></div>');
    expect(html).toContain('<div class="cov-viewer"><div class="viewer-probe">viewer</div></div>');
    expect(html.indexOf('cov-chat')).toBeLessThan(html.indexOf('cov-viewer'));
    // No focus trap: the chat stays usable while a citation is open.
    expect(html).not.toContain('inert');
  });

  it('open on a phone: the viewer covers the chat, which is marked inert while hidden behind it', () => {
    const html = renderToStaticMarkup(<CitationOverlay open viewer={VIEWER} narrow>{CHAT}</CitationOverlay>);
    expect(html).toMatch(/^<div class="cov is-open is-narrow">/);
    expect(html).toMatch(/<div class="cov-chat" inert="">/);
    expect(html).toContain('<div class="cov-viewer"><div class="viewer-probe">viewer</div></div>');
  });

  it('the chat sits at the same place in the tree open and closed, so it is never remounted', () => {
    const shape = html => html.replace(/<div [^>]*>/g, '<div>');
    const closed = shape(renderToStaticMarkup(<CitationOverlay open={false} viewer={null}>{CHAT}</CitationOverlay>));
    const open = shape(renderToStaticMarkup(<CitationOverlay open viewer={VIEWER} narrow={false} viewportWidth={1440}>{CHAT}</CitationOverlay>));
    // root div > first child div > the chat, in both states; the handles and the viewer pane only follow it.
    expect(closed).toBe('<div><div><div>chat</div></div></div>');
    expect(open.startsWith('<div><div><div>chat</div></div>')).toBe(true);
  });
});

/** The opening tag of the element carrying `className`, or ''. */
function tagOf(html, className) {
  const match = html.match(new RegExp(`<div class="${className}"[^>]*>`));
  return match ? match[0] : '';
}

/** A Storage stand-in; `broken` makes every call throw. */
function memoryStorage(initial = {}, { broken = false } = {}) {
  const data = new Map(Object.entries(initial));
  const guard = () => { if (broken) throw new Error('SecurityError'); };
  return {
    getItem: (k) => { guard(); return data.has(k) ? data.get(k) : null; },
    setItem: (k, v) => { guard(); data.set(k, String(v)); },
    removeItem: (k) => { guard(); data.delete(k); },
  };
}

// Revision 4, point 1: the outer edge and the middle divider.
describe('CitationOverlay resize handles', () => {
  const openAt = (props = {}) => renderToStaticMarkup(
    <CitationOverlay open viewer={VIEWER} narrow={false} viewportWidth={1440} {...props}>{CHAT}</CitationOverlay>,
  );

  it('the outer edge is a focusable vertical separator in pixels, 960 to the viewport less 120', () => {
    const tag = tagOf(openAt(), 'cov-edge');
    expect(tag).not.toBe('');
    expect(tag).toContain('role="separator"');
    expect(tag).toContain('aria-orientation="vertical"');
    expect(tag).toMatch(/aria-label="[^"]+"/);
    expect(tag).toContain('aria-valuemin="960"');
    expect(tag).toContain('aria-valuemax="1320"');
    expect(tag).toContain('aria-valuenow="960"');
    expect(tag).toContain('tabindex="0"');
  });

  it('the middle divider is a focusable vertical separator in percent, 30 to 75, default 50', () => {
    const tag = tagOf(openAt(), 'cov-divider');
    expect(tag).not.toBe('');
    expect(tag).toContain('role="separator"');
    expect(tag).toContain('aria-orientation="vertical"');
    expect(tag).toMatch(/aria-label="[^"]+"/);
    expect(tag).toContain('aria-valuemin="30"');
    expect(tag).toContain('aria-valuemax="75"');
    expect(tag).toContain('aria-valuenow="50"');
    expect(tag).toContain('tabindex="0"');
  });

  it('the two handles have different labels', () => {
    const html = openAt();
    const label = tag => tag.match(/aria-label="([^"]+)"/)?.[1];
    expect(label(tagOf(html, 'cov-edge'))).not.toBe(label(tagOf(html, 'cov-divider')));
  });

  it('the overlay carries its width and the viewer share for the CSS, by default today\'s rule and 50%', () => {
    const root = openAt().match(/^<div [^>]*>/)[0];
    expect(root).toContain('--cov-width:960px');
    expect(root).toContain('--cov-split:50%');
    const wide = openAt({ viewportWidth: 2560 }).match(/^<div [^>]*>/)[0];
    expect(wide).toContain('--cov-width:1280px');
  });

  it('the divider sits between the chat and the viewer in the tab order', () => {
    const html = openAt();
    expect(html.indexOf('cov-chat')).toBeLessThan(html.indexOf('cov-divider'));
    expect(html.indexOf('cov-divider')).toBeLessThan(html.indexOf('cov-viewer'));
  });

  it('a stored width and share are used, re-clamped to the viewport', () => {
    const storage = memoryStorage({ niyantranCitationOverlayWidth: '1200', niyantranCitationSplit: '62' });
    const html = openAt({ storage });
    expect(tagOf(html, 'cov-edge')).toContain('aria-valuenow="1200"');
    expect(tagOf(html, 'cov-divider')).toContain('aria-valuenow="62"');
    expect(html).toContain('--cov-width:1200px');
    expect(html).toContain('--cov-split:62%');
    const clamped = openAt({ storage: memoryStorage({ niyantranCitationOverlayWidth: '5000', niyantranCitationSplit: '5' }) });
    expect(tagOf(clamped, 'cov-edge')).toContain('aria-valuenow="1320"');
    expect(tagOf(clamped, 'cov-divider')).toContain('aria-valuenow="30"');
  });

  it('a storage that throws falls back to the defaults', () => {
    const html = openAt({ storage: memoryStorage({ niyantranCitationOverlayWidth: '1200' }, { broken: true }) });
    expect(tagOf(html, 'cov-edge')).toContain('aria-valuenow="960"');
    expect(tagOf(html, 'cov-divider')).toContain('aria-valuenow="50"');
  });

  it('closed: no handles and no width', () => {
    const html = renderToStaticMarkup(<CitationOverlay open={false} viewer={null} viewportWidth={1440}>{CHAT}</CitationOverlay>);
    expect(html).not.toContain('separator');
    expect(html).not.toContain('--cov-width');
  });

  it('phones: no handles and no width; the full-screen viewer is unchanged', () => {
    const html = renderToStaticMarkup(<CitationOverlay open viewer={VIEWER} narrow viewportWidth={400}>{CHAT}</CitationOverlay>);
    expect(html).not.toContain('separator');
    expect(html).not.toContain('--cov-width');
    expect(html).toMatch(/^<div class="cov is-open is-narrow">/);
  });

  it('an unknown viewport leaves the width and the halves to the CSS fallbacks', () => {
    const html = renderToStaticMarkup(<CitationOverlay open viewer={VIEWER} narrow={false} viewportWidth={0}>{CHAT}</CitationOverlay>);
    expect(html).not.toContain('--cov-width');
    expect(html).not.toContain('--cov-split');
  });
});

describe('citation-overlay.css', () => {
  it('states the width rule: max(50vw, 960px), capped at the viewport, anchored right', () => {
    expect(css).toContain('min(100vw, max(50vw, 960px))');
    expect(css).toMatch(/position:\s*fixed/);
    expect(css).toMatch(/right:\s*0/);
  });

  it('takes the width from --cov-width, with today\'s rule as the fallback', () => {
    expect(css).toMatch(/width:\s*var\(--cov-width,\s*min\(100vw, max\(50vw, 960px\)\)\)/);
  });

  it('splits the open overlay by the viewer share, two equal halves by default', () => {
    expect(css).toMatch(/grid-template-columns:\s*minmax\(0,\s*calc\(100% - var\(--cov-split, 50%\)\)\)\s+minmax\(0,\s*var\(--cov-split, 50%\)\)/);
  });

  it('places the divider at the viewer share and the edge on the overlay\'s left', () => {
    expect(css).toMatch(/\.cov-divider\s*\{[^}]*left:\s*calc\(100% - var\(--cov-split, 50%\)\)/);
    expect(css).toMatch(/\.cov-edge\s*\{[^}]*left:\s*0/);
  });

  it('handles take touch and pen drags and show a resize cursor', () => {
    expect(css).toMatch(/\.cov-edge,\s*\.cov-divider\s*\{[^}]*touch-action:\s*none/);
    expect(css).toMatch(/\.cov-edge,\s*\.cov-divider\s*\{[^}]*cursor:\s*col-resize/);
  });

  it('while dragging: no transitions and no text selection', () => {
    expect(css).toMatch(/\.cov\.is-resizing[^{]*\{[^}]*transition:\s*none/);
    expect(css).toMatch(/\.cov\.is-resizing[^{]*\{[^}]*user-select:\s*none/);
  });

  it('on phones the handles are never shown', () => {
    const block = mediaBlock('(max-width: 900px)');
    expect(block).toMatch(/\.cov-edge,\s*\.cov-divider\s*\{[^}]*display:\s*none/);
  });

  it('animates the transform for about 250 ms', () => {
    expect(css).toMatch(/transition:\s*transform\s+250ms/);
  });

  it('switches instantly under prefers-reduced-motion', () => {
    const block = mediaBlock('(prefers-reduced-motion: reduce)');
    expect(block).toMatch(/\.cov[^{]*\{[^}]*transition:\s*none/);
  });

  it('on phones the chat stays in place and the viewer is fixed over it, full width', () => {
    const block = mediaBlock('(max-width: 900px)');
    expect(block).toMatch(/\.cov-viewer\s*\{[^}]*position:\s*fixed/);
    expect(block).toMatch(/\.cov-viewer\s*\{[^}]*left:\s*0/);
    expect(block).toMatch(/\.cov\.is-open[^{]*\{[^}]*position:\s*static/);
  });
});
