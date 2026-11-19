// B6: the channel data. The 13 curated channels are unchanged; the added channels are only those verified
// against YouTube itself, each with a real channel id and at least one of the client's lists.
import { describe, expect, it } from 'vitest';
import { YOUTUBE_SOURCES, LIVE_TV_LISTS, getLiveTvChannels } from '../../server/liveTvApi.mjs';
import { ADDED_CHANNELS, LIST_CATEGORY } from '../../server/liveTvChannels.mjs';

const CURATED = [
  ['dhruv-rathee', 'UC-CSyyi47VX1lD9zyeABW3w', 'RJfqzUWZ0Bw', 'national'],
  ['think-school', 'UCKZozRVHRYsYHGEyNKuhhdA', 'UY9H83yQnzc', 'economics'],
  ['khan-gs', 'UCatL-c6pmnjzEOHSyjn-sHA', 'ECoO7eyknPs', 'national'],
  ['soch-mohak', 'UCz4a7agVFr1TxU-mpAP8hkw', '3MtJg5rJars', 'national'],
  ['csis', 'UCr5jq6MC_VCe1c5ciIZtk_w', '7ncDwpDZkho', 'global'],
  ['dd-news', 'UCKwucPzHZ7zCUIf7If-Wo1g', 'qD6GkaU2lD0', 'legislative'],
  ['sansad-tv', 'UCISgnSNwqQ2i8lhCun3KtQg', 'live_stream', 'legislative'],
  ['wion', 'UC_gUM8rL-Lrg6O3adPW9K1g', 'vfszY1JYbMc', 'global'],
  ['ndtv-24x7', 'UCZFMm1mMw0F81Z37aaEzTUA', 'I8643WY0BgA', 'national'],
  ['cnbc-tv18', 'UCmRbHAgG2k2vDUvb3xsEunQ', '1_Ih0JYmkjI', 'economics'],
  ['et-now', 'UCI_mwTKUhicNzFrhm33MzBQ', 'v-HldpGnVT8', 'economics'],
  ['india-today', 'UCYPvAwZP8pZhSMW8qs7cVCw', '9NH-hAV3H6M', 'national'],
  ['aaj-tak', 'UCt4t-jeY85JegMlZ-E5UWtA', 'ChQPEkASCb4', 'media'],
];
// Client entries whose YouTube channel could not be confirmed: not added.
const LEFT_OUT = ['sushant-sinha', 'the-wire', 'samajwadi-party', 'aitc-official', 'dmk-official', 'akhilesh-yadav', 'mamata-banerjee', 'election-commission-of-india', 'supreme-court-of-india', 'chatham-house', 'news-live', 'zee-punjab-haryana-himachal'];
const LIST_IDS = ['top-hi', 'top-en', 'politics', 'parties', 'parliament', 'education', 'economy', 'research', 'international', 'regional'];

describe('the channel data', () => {
  it('has the 13 curated channels first and 83 added ones: 96 in all', () => {
    expect(YOUTUBE_SOURCES).toHaveLength(96);
    expect(ADDED_CHANNELS).toHaveLength(83);
    expect(YOUTUBE_SOURCES.slice(0, 13).map((c) => c.id)).toEqual(CURATED.map((c) => c[0]));
  });
  it('leaves the 13 curated channels unchanged: id, channel, curated video, desk', () => {
    for (const [id, channelId, defaultVideoId, deskId] of CURATED) {
      const c = YOUTUBE_SOURCES.find((x) => x.id === id);
      expect(c).toMatchObject({ channelId, defaultVideoId, deskId });
      expect(c.embedUrl).toContain(defaultVideoId === 'live_stream' ? 'live_stream' : `/embed/${defaultVideoId}?`);
      expect(c.liveHintVideoId).toBeUndefined();
    }
  });
  it("fixes Think School's stale handle", () => {
    expect(YOUTUBE_SOURCES.find((c) => c.id === 'think-school').channelUrl).toBe('https://www.youtube.com/@ThinkSchool');
  });
  it('has unique ids and unique channel ids, each channel id being UC and 22 characters', () => {
    expect(new Set(YOUTUBE_SOURCES.map((c) => c.id)).size).toBe(96);
    expect(new Set(YOUTUBE_SOURCES.map((c) => c.channelId)).size).toBe(96);
    for (const c of YOUTUBE_SOURCES) expect(c.channelId).toMatch(/^UC[A-Za-z0-9_-]{22}$/);
  });
  it('puts every channel in at least one of the ten lists, with the client\'s names', () => {
    expect(LIVE_TV_LISTS.map((l) => l.id)).toEqual(LIST_IDS);
    expect(LIVE_TV_LISTS.filter((l) => l.kind === 'top')).toHaveLength(2);
    expect(LIVE_TV_LISTS.find((l) => l.id === 'top-hi').name).toBe('Top · Hindi news');
    for (const c of YOUTUBE_SOURCES) {
      expect(c.lists.length).toBeGreaterThanOrEqual(1);
      for (const l of c.lists) expect(LIST_IDS).toContain(l);
    }
  });
  it('keeps the older category field on every channel, from the first list for an added one', () => {
    const categories = ['NEWS', 'EDUCATION', 'POLITICS', 'ECONOMICS', 'RESEARCH', 'GENERAL'];
    for (const c of YOUTUBE_SOURCES) expect(categories).toContain(c.category);
    for (const c of ADDED_CHANNELS) expect(c.category).toBe(LIST_CATEGORY[c.lists[0]]);
  });
  it('contains none of the 12 left out, by id or by anything that was only a candidate', () => {
    const ids = new Set(YOUTUBE_SOURCES.map((c) => c.id));
    for (const id of LEFT_OUT) expect(ids.has(id)).toBe(false);
    const urls = YOUTUBE_SOURCES.map((c) => c.channelUrl.toLowerCase());
    for (const handle of ['@sushantsinha', '@thewirenews', '@samajwadipartyofficial', '@dmkofficial', '@akhileshyadavsp']) {
      expect(urls.some((u) => u.endsWith(handle))).toBe(false);
    }
  });
  it('keeps a remembered live video only as a hint, on 47 added channels and none of the curated ones', () => {
    const hinted = YOUTUBE_SOURCES.filter((c) => c.liveHintVideoId);
    expect(hinted).toHaveLength(47);
    for (const c of hinted) {
      expect(c.liveHintVideoId).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(ADDED_CHANNELS).toContain(c);
    }
    for (const c of ADDED_CHANNELS) {
      expect(c.defaultVideoId).toBeUndefined();
      expect(c.embedUrl).toBeUndefined();
    }
  });
  it('holds no subscriber counts, notes or sources', () => {
    const text = JSON.stringify(ADDED_CHANNELS);
    expect(text).not.toMatch(/subscriber|verificationNote|streamNote|sources/i);
  });
  it('gives every added channel its tile initials and colour', () => {
    for (const c of ADDED_CHANNELS) {
      expect(c.short).toMatch(/^\S{1,5}$/);
      expect(c.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
    const abp = ADDED_CHANNELS.find((c) => c.id === 'abp-news');
    expect([abp.short, abp.color]).toEqual(['ABP', '#1E3A8A']);
  });
});

describe('the channel list response', () => {
  it('carries the ten lists and, for a channel, only what the page reads', async () => {
    const res = await getLiveTvChannels();
    expect(res.lists).toEqual(LIVE_TV_LISTS);
    expect(res.channels).toHaveLength(96);
    const allowed = new Set(['id', 'name', 'officialName', 'short', 'category', 'lists', 'lang', 'color', 'channelId', 'status', 'channelUrl', 'deskId', 'viewers', 'defaultVideoId', 'embedUrl', 'liveVideoId']);
    for (const c of res.channels) for (const k of Object.keys(c)) expect(allowed.has(k)).toBe(true);
    expect(JSON.stringify(res)).not.toMatch(/liveHintVideoId|description|fallbackVideos/);
  });
  it('keeps the category filter working', async () => {
    const res = await getLiveTvChannels({ category: 'ECONOMICS' });
    expect(res.channels.length).toBeGreaterThan(2);
    expect(res.channels.every((c) => c.category === 'ECONOMICS')).toBe(true);
  });
});
