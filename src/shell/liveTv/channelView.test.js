// F366: pure helpers behind the redrawn channel card and the now-playing row.
import { describe, expect, it } from 'vitest';
import { applyDetectedStatuses, channelSubline, detectedStatusOf, nowPlayingLine, segmentCounts } from './channelView.js';

const channels = [
  { id: 'a', name: 'Alpha', category: 'NEWS', status: 'live', lang: 'Hindi' },
  { id: 'b', name: 'Beta', category: 'NEWS', status: 'recent', lang: 'English' },
  { id: 'c', name: 'Gamma', category: 'EDUCATION', status: 'soon' },
];

describe('segmentCounts', () => {
  it('counts channels per category, with ALL as the total, in the given order', () => {
    expect(segmentCounts(channels, ['ALL', 'NEWS', 'EDUCATION', 'POLITICS'])).toEqual([
      { category: 'ALL', count: 3 },
      { category: 'NEWS', count: 2 },
      { category: 'EDUCATION', count: 1 },
      { category: 'POLITICS', count: 0 },
    ]);
  });
  it('is zero everywhere before channels load, and tolerates bad input', () => {
    expect(segmentCounts([], ['ALL', 'NEWS'])).toEqual([{ category: 'ALL', count: 0 }, { category: 'NEWS', count: 0 }]);
    expect(segmentCounts(null, ['ALL'])).toEqual([{ category: 'ALL', count: 0 }]);
    expect(segmentCounts(channels, null)).toEqual([]);
  });
});

describe('channelSubline', () => {
  it('names LIVE or SOON with the language when the data has one', () => {
    expect(channelSubline(channels[0])).toBe('LIVE · Hindi');
    expect(channelSubline({ status: 'soon', lang: 'English' })).toBe('SOON · English');
  });
  it('prints no status for a recent channel (the server marks every channel recent), only the language', () => {
    expect(channelSubline(channels[1])).toBe('English');
    expect(channelSubline({ status: 'recent', lang: 'Hindi · English' })).toBe('Hindi · English');
    expect(channelSubline({ id: 'd', name: 'D', lang: 'Hindi' })).toBe('Hindi');
  });
  it('is empty when there is nothing worth showing', () => {
    expect(channelSubline({ id: 'd', name: 'D' })).toBe('');
    expect(channelSubline({ status: 'recent', lang: '  ' })).toBe('');
    expect(channelSubline(null)).toBe('');
    expect(channelSubline(channels[2])).toBe('SOON');
  });
});

describe('nowPlayingLine', () => {
  it('reads channel, language and kind for a live channel', () => {
    expect(nowPlayingLine({ mode: 'live', channel: channels[0] })).toBe('Alpha · Hindi · NEWS');
  });
  it('names the recorded item for a video or an archived segment', () => {
    expect(nowPlayingLine({ mode: 'video', channel: channels[0] })).toBe('Alpha · Hindi · Video');
    expect(nowPlayingLine({ mode: 'archive', channel: channels[1], item: { segment: 'Debate' } })).toBe('Beta · English · Debate');
    expect(nowPlayingLine({ mode: 'archive', channel: channels[1], item: null })).toBe('Beta · English · Archive');
  });
  it('is empty with no channel', () => {
    expect(nowPlayingLine({ mode: 'live', channel: null })).toBe('');
  });
});

// F367: the status a channel's own video lookup found, laid over the list's statuses.
describe('detectedStatusOf', () => {
  it('reads the status of a lookup answered from YouTube data', () => {
    expect(detectedStatusOf({ ok: true, source: 'youtube-api', dataOrigin: 'youtube-api', status: 'live' })).toBe('live');
    expect(detectedStatusOf({ ok: true, source: 'cache', dataOrigin: 'youtube-api', status: 'recent' })).toBe('recent');
  });
  it('reads nothing from a fallback, stale, failed or unknown answer', () => {
    expect(detectedStatusOf({ ok: true, dataOrigin: 'fallback', status: 'live' })).toBeNull();
    expect(detectedStatusOf({ ok: true, dataOrigin: 'stale', status: 'live' })).toBeNull();
    expect(detectedStatusOf({ ok: false, dataOrigin: 'youtube-api', status: 'live' })).toBeNull();
    expect(detectedStatusOf({ ok: true, dataOrigin: 'youtube-api', status: 'weird' })).toBeNull();
    expect(detectedStatusOf({ ok: true, dataOrigin: 'youtube-api' })).toBeNull();
    expect(detectedStatusOf(null)).toBeNull();
  });
});

describe('applyDetectedStatuses', () => {
  const list = [{ id: 'a', status: 'recent', name: 'A' }, { id: 'b', status: 'recent', name: 'B' }];
  it('puts a detected status over that channel only, without changing the input', () => {
    const out = applyDetectedStatuses(list, { a: 'live' });
    expect(out.map((c) => c.status)).toEqual(['live', 'recent']);
    expect(out[0]).toEqual({ id: 'a', status: 'live', name: 'A' });
    expect(list[0].status).toBe('recent');
    expect(out[1]).toBe(list[1]);
  });
  it('returns the same list when nothing is detected or nothing differs', () => {
    expect(applyDetectedStatuses(list, {})).toBe(list);
    expect(applyDetectedStatuses(list, { a: 'recent' })).toBe(list);
    expect(applyDetectedStatuses(list, { zzz: 'live' })).toBe(list);
    expect(applyDetectedStatuses(list, null)).toBe(list);
  });
  it('copes with a list that is not an array', () => {
    expect(applyDetectedStatuses(undefined, { a: 'live' })).toEqual([]);
  });
});
