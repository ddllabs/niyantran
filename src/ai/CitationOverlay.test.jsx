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
    expect(html).toMatch(/^<div class="cov is-open">/);
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
    const shape = html => html.replace(/ class="[^"]*"/g, '').replace(/ inert=""/g, '');
    const closed = shape(renderToStaticMarkup(<CitationOverlay open={false} viewer={null}>{CHAT}</CitationOverlay>));
    const open = shape(renderToStaticMarkup(<CitationOverlay open viewer={VIEWER} narrow={false}>{CHAT}</CitationOverlay>));
    // root div > first child div > the chat, in both states; the viewer pane only follows it.
    expect(closed).toBe('<div><div><div>chat</div></div></div>');
    expect(open.startsWith('<div><div><div>chat</div></div>')).toBe(true);
  });
});

describe('citation-overlay.css', () => {
  it('states the width rule: max(50vw, 960px), capped at the viewport, anchored right', () => {
    expect(css).toContain('min(100vw, max(50vw, 960px))');
    expect(css).toMatch(/position:\s*fixed/);
    expect(css).toMatch(/right:\s*0/);
  });

  it('splits the open overlay into two equal halves', () => {
    expect(css).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/);
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
