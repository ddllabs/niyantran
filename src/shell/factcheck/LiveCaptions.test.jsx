// F416: the live captions on the player.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LiveCaptions } from './LiveCaptions.jsx';

const lines = [{ seq: 1, text: 'first line' }, { seq: 2, text: 'second line' }, { seq: 3, text: 'third line' }];

describe('LiveCaptions', () => {
  it('shows the newest two lines joined, not the older ones, with dir=auto', () => {
    const html = renderToStaticMarkup(<LiveCaptions lines={lines} listening />);
    expect(html).toContain('second line third line');
    expect(html).not.toContain('first line');
    expect(html).toMatch(/dir="auto"/);
  });
  it('shows a single line as it is', () => {
    expect(renderToStaticMarkup(<LiveCaptions lines={[lines[0]]} listening />)).toContain('first line');
  });
  it('says Listening… with no words while listening', () => {
    const html = renderToStaticMarkup(<LiveCaptions lines={[]} listening />);
    expect(html).toContain('Listening…');
    expect(html).toContain('is-listening');
  });
  it('shows nothing with no words and not listening', () => {
    expect(renderToStaticMarkup(<LiveCaptions lines={[]} listening={false} />)).toBe('');
  });
  it('words win over Listening… and are not marked as listening', () => {
    const html = renderToStaticMarkup(<LiveCaptions lines={lines} listening={false} />);
    expect(html).toContain('third line');
    expect(html).not.toContain('Listening…');
    expect(html).not.toContain('is-listening');
  });
  it('is hidden from screen readers and is not a live region, with no button', () => {
    const html = renderToStaticMarkup(<LiveCaptions lines={lines} listening />);
    expect(html).toMatch(/^<div[^>]*aria-hidden="true"/);
    expect(html).not.toMatch(/aria-live|role="(status|alert|group)"|<button/);
  });
});
