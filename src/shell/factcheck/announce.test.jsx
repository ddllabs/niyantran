// Review 2 and 10: ONE shared status node for the copy, export and download confirmations of a view.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createAnnouncer, AnnouncerRegion } from './announce.jsx';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const sink = () => { const seen = []; return { seen, set: (t) => seen.push(t) }; };

describe('createAnnouncer', () => {
  it('writes the message into the region, then clears it', () => {
    const a = createAnnouncer();
    const s = sink();
    a.attach(s.set);
    a.say('Claim copied.');
    vi.advanceTimersByTime(1000);
    expect(s.seen.at(-1)).toBe('Claim copied.');
    vi.advanceTimersByTime(5000);
    expect(s.seen.at(-1)).toBe('');
  });
  it('announces the same message again: the region is emptied first, then set, every time', () => {
    const a = createAnnouncer();
    const s = sink();
    a.attach(s.set);
    a.say('Claim copied.');
    vi.advanceTimersByTime(1000); // pressed again within the 4 s the message stays
    a.say('Claim copied.');
    expect(s.seen.at(-1)).toBe('');
    vi.advanceTimersByTime(1000);
    expect(s.seen.at(-1)).toBe('Claim copied.');
    expect(s.seen.filter((t) => t === 'Claim copied.')).toHaveLength(2);
  });
  it('a later message replaces an earlier one that is still waiting', () => {
    const a = createAnnouncer();
    const s = sink();
    a.attach(s.set);
    a.say('first');
    a.say('second');
    vi.advanceTimersByTime(1000);
    expect(s.seen).not.toContain('first');
    expect(s.seen.at(-1)).toBe('second');
  });
  it('review 10: after the view is gone (detached) a late message does nothing and no timer is left', () => {
    const a = createAnnouncer();
    const s = sink();
    const detach = a.attach(s.set);
    a.say('x');
    detach();
    const before = s.seen.length;
    a.say('late clipboard answer');
    vi.advanceTimersByTime(10000);
    expect(s.seen.length).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('without a region, say is a no-op', () => {
    expect(() => createAnnouncer().say('x')).not.toThrow();
  });
});

describe('AnnouncerRegion', () => {
  it('is one polite status node', () => {
    const html = renderToStaticMarkup(<AnnouncerRegion announcer={createAnnouncer()} />);
    expect(html).toBe('<p class="fc-sr" role="status"></p>');
  });
});
