// F344 T6: pure helpers behind the panel's words and the modal's wiring.
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { blockOptions, confirmStart, embedVideoId, formatClock, playingTarget, priceChangedText, safeSourceUrl } from './factCheckText.js';

describe('formatClock', () => {
  it.each([[0, '0:00'], [5, '0:05'], [65, '1:05'], [600, '10:00'], [-3, '0:00'], [Number.NaN, '0:00']])('%s -> %s', (s, out) => {
    expect(formatClock(s)).toBe(out);
  });
});

describe('blockOptions', () => {
  it('prices 5, 10 and 15 minutes and marks what the balance cannot cover', () => {
    const o = blockOptions(500, 5000);
    expect(o.map((x) => [x.minutes, x.price, x.affordable])).toEqual([[5, 2500, true], [10, 5000, true], [15, 7500, false]]);
    expect(blockOptions(500, null).every((x) => x.affordable)).toBe(true);
    expect(blockOptions(0.5, 0).every((x) => !x.affordable)).toBe(true);
  });
  it('keeps fractional prices exact enough to display', () => {
    expect(blockOptions(0.5, 100)[0].price).toBe(2.5);
  });
});

describe('safeSourceUrl', () => {
  it('allows only http and https', () => {
    expect(safeSourceUrl('https://a.example/x')).toBe('https://a.example/x');
    expect(safeSourceUrl('http://a.example')).toBe('http://a.example/');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://a', '//a.example', 'a.example', '', null, 5]) expect(safeSourceUrl(bad)).toBeNull();
  });
});

describe('embedVideoId', () => {
  it('reads the id from a YouTube embed url', () => {
    expect(embedVideoId('https://www.youtube-nocookie.com/embed/RJfqzUWZ0Bw?autoplay=1&mute=1')).toBe('RJfqzUWZ0Bw');
    expect(embedVideoId('https://www.youtube.com/embed/-e72F_bBcqA')).toBe('-e72F_bBcqA');
  });
  it('is null for the literal "undefined", other hosts and unparsable addresses', () => {
    for (const v of [
      'https://www.youtube-nocookie.com/embed/undefined?autoplay=1',
      'https://evil.example/embed/RJfqzUWZ0Bw',
      'https://www.youtube.com.evil.example/embed/RJfqzUWZ0Bw',
      '/embed/RJfqzUWZ0Bw',
      'javascript:/embed/RJfqzUWZ0Bw',
    ]) expect(embedVideoId(v), v).toBeNull();
    expect(embedVideoId('https://youtube.com/embed/abcDEF_-123')).toBe('abcDEF_-123');
  });
  it('is null when there is none', () => {
    for (const v of ['', null, undefined, 'https://example.com/watch?v=abc', 'https://www.youtube.com/embed/', 'https://www.youtube.com/embed/live_stream?channel=UC1']) expect(embedVideoId(v)).toBeNull();
  });
});

describe('playingTarget', () => {
  it('names what is playing: channel, mode, video; null when nothing', () => {
    expect(playingTarget('dd-news', 'live', 'abc')).toBe('dd-news|live|abc');
    expect(playingTarget('dd-news', 'live', null)).toBeNull();
  });
});

describe('playingTarget needs a channel too', () => {
  it('is null without a channel id', () => {
    expect(playingTarget('', 'live', 'abc')).toBeNull();
    expect(playingTarget(undefined, 'live', 'abc')).toBeNull();
  });
});

describe('priceChangedText', () => {
  it('names the fresh price', () => {
    expect(priceChangedText(700)).toBe('The price changed to 700 credits a minute. Review and start again.');
    expect(priceChangedText(undefined)).toBe('The price changed. Review and start again.');
  });
});

describe('confirmStart', () => {
  it('unmutes first and then confirms, when the player is muted', () => {
    const order = [];
    confirmStart({ isMuted: true, onUnmute: () => order.push('unmute'), onConfirm: (...a) => order.push(['confirm', ...a]) }, 10, 500);
    expect(order).toEqual(['unmute', ['confirm', 10, 500]]);
  });
  it('only confirms when it is not muted', () => {
    const onUnmute = vi.fn();
    const onConfirm = vi.fn();
    confirmStart({ isMuted: false, onUnmute, onConfirm }, 5, 500);
    expect(onUnmute).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledWith(5, 500);
  });
});
