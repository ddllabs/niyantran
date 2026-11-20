// F389: the live transcript strip.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LiveTranscriptStrip } from './LiveTranscriptStrip.jsx';

const lines = [{ seq: 1, text: 'first line' }, { seq: 2, text: 'second line' }, { seq: 3, text: 'third line' }];
const findButton = (node) => {
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (Array.isArray(n)) { stack.push(...n); continue; }
    if (n?.type === 'button') return n;
    if (n?.props?.children) stack.push(n.props.children);
  }
  return null;
};

describe('LiveTranscriptStrip', () => {
  it('shows the newest two lines joined, not the older ones, with dir=auto', () => {
    const html = renderToStaticMarkup(<LiveTranscriptStrip lines={lines} listening onOpen={() => {}} />);
    expect(html).toContain('second line third line');
    expect(html).not.toContain('first line');
    expect(html).toMatch(/dir="auto"/);
  });
  it('shows a single line as it is', () => {
    expect(renderToStaticMarkup(<LiveTranscriptStrip lines={[lines[0]]} listening onOpen={() => {}} />)).toContain('first line');
  });
  it('says Listening… with no lines, pulsing only while listening', () => {
    const on = renderToStaticMarkup(<LiveTranscriptStrip lines={[]} listening onOpen={() => {}} />);
    expect(on).toContain('Listening…');
    expect(on).toContain('fc-listening');
    const off = renderToStaticMarkup(<LiveTranscriptStrip lines={[]} listening={false} onOpen={() => {}} />);
    expect(off).toContain('Listening…');
    expect(off).not.toContain('fc-listening');
  });
  it('is a labelled group and not a live region', () => {
    const html = renderToStaticMarkup(<LiveTranscriptStrip lines={lines} listening onOpen={() => {}} />);
    expect(html).toMatch(/role="group"[^>]*aria-label="Latest transcript"/);
    expect(html).toContain('aria-live="off"');
    expect(html).not.toMatch(/aria-live="(polite|assertive)"|role="status"|role="alert"/);
  });
  it('Full transcript calls the handler', () => {
    const onOpen = vi.fn();
    const b = findButton(LiveTranscriptStrip({ lines, listening: true, onOpen }));
    expect(b.props.children).toBe('Full transcript');
    b.props.onClick();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
