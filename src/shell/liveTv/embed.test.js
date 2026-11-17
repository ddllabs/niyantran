import { describe, expect, it } from 'vitest';
import { buildEmbedSrc, embedFrameKey } from './embed.js';

const O = 'https://app.example';
const q = (src) => new URL(src).searchParams;

describe('buildEmbedSrc', () => {
  it('carries exactly one mute with the intended value, even if the url already has one', () => {
    const src = buildEmbedSrc({ url: 'https://www.youtube-nocookie.com/embed/abc?autoplay=1&mute=1&playsinline=1', muted: false, origin: O });
    expect(q(src).getAll('mute')).toEqual(['0']);
    expect(q(src).get('autoplay')).toBe('1');
    expect(q(src).get('enablejsapi')).toBe('1');
    expect(q(src).get('origin')).toBe(O);
  });
  it('adds mute=1 for muted', () => {
    expect(q(buildEmbedSrc({ url: 'https://www.youtube.com/embed/abc', muted: true, origin: O })).getAll('mute')).toEqual(['1']);
  });
  it('adds enablejsapi only for YouTube hosts', () => {
    const src = buildEmbedSrc({ url: 'https://player.example.com/x?a=1', muted: true, origin: O });
    expect(q(src).has('enablejsapi')).toBe(false);
    expect(q(src).get('mute')).toBe('1');
  });
  it('returns an empty string for no url and leaves an unparseable one alone', () => {
    expect(buildEmbedSrc({ url: '', muted: true, origin: O })).toBe('');
    expect(buildEmbedSrc({ url: 'not a url', muted: true, origin: O })).toBe('not a url');
  });
});

describe('embedFrameKey', () => {
  it('depends on channel, broadcast, mode and reload only, not on mute', () => {
    const a = embedFrameKey({ channelId: 'c', broadcastId: 'b', mode: 'live', reloadKey: 0 });
    expect(embedFrameKey({ channelId: 'c', broadcastId: 'b', mode: 'live', reloadKey: 0, muted: true })).toBe(a);
    expect(embedFrameKey({ channelId: 'c', broadcastId: 'b', mode: 'live', reloadKey: 0, muted: false })).toBe(a);
    expect(embedFrameKey({ channelId: 'c', broadcastId: 'b', mode: 'live', reloadKey: 1 })).not.toBe(a);
    expect(embedFrameKey({ channelId: 'd', broadcastId: 'b', mode: 'live', reloadKey: 0 })).not.toBe(a);
  });
});
