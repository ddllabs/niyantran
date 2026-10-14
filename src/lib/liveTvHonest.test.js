// F7 / O7 (F171 B8): Live TV served hand-written transcripts labelled "Verified Record", invented
// archive entries and schedules, placeholder programmes ("<channel> Intelligence & Sectoral
// Deep-Dive"), stock-photo thumbnails with made-up titles and a hard-coded "live" status. Only real
// content is shown now; where nothing real exists the screen says so.
import { describe, expect, it } from 'vitest';
import * as liveTv from '../../server/liveTvApi.mjs';

const { YOUTUBE_SOURCES, getLiveTvArchive, getLiveTvSchedule, getLiveTvTranscript, getLiveTvVideos, normalizeYouTubeVideo } = liveTv;

describe('Live TV shows only real content (F7)', () => {
  it('no schedule is invented', () => {
    for (const ch of YOUTUBE_SOURCES) {
      const s = getLiveTvSchedule(ch.id);
      expect(s.items, ch.id).toEqual([]);
      expect(s.message).toBe('Schedule not published');
    }
  });

  it('no archive entry is invented', () => {
    expect(getLiveTvArchive().items).toEqual([]);
  });

  it('no transcript is invented', () => {
    const t = getLiveTvTranscript('arch-dd-2026-09-26');
    expect(t.available).toBe(false);
    expect(t.cues).toEqual([]);
    expect(t.message).toBe('No transcript available.');
  });

  it('no channel carries a made-up programme, live status, stock photo or date', () => {
    for (const ch of YOUTUBE_SOURCES) {
      expect(ch.currentProgram, ch.id).toBeUndefined();
      expect(ch.status, ch.id).not.toBe('live');
      for (const v of ch.fallbackVideos || []) {
        expect(v.thumbnail, ch.id).not.toMatch(/unsplash/i);
        expect(v.publishedAt, ch.id).toBeUndefined();
        expect(v.duration, ch.id).toBeUndefined();
      }
    }
  });

  it('nothing is labelled a verified record', () => {
    expect(JSON.stringify(Object.values(liveTv).filter((v) => typeof v !== 'function'))).not.toMatch(/verified record/i);
  });

  it('a video with no known date or length is served without one (review)', async () => {
    const v = normalizeYouTubeVideo({ videoId: 'RJfqzUWZ0Bw', title: 'Electoral Bonds' }, 'dhruv-rathee');
    expect(v.publishedAt).toBeNull();
    expect(v.duration).toBeNull();
    const saved = process.env.YOUTUBE_API_KEY;
    delete process.env.YOUTUBE_API_KEY;
    try {
      const out = await getLiveTvVideos('dhruv-rathee');
      expect(out.recentVideos.length).toBeGreaterThan(0);
      for (const r of out.recentVideos) expect(r.publishedAt).toBeNull();
    } finally {
      if (saved !== undefined) process.env.YOUTUBE_API_KEY = saved;
    }
  });

  it('channel IDs are the channels named (checked against YouTube, 2026-10-14)', () => {
    const id = Object.fromEntries(YOUTUBE_SOURCES.map((c) => [c.id, c.channelId]));
    expect(id['sansad-tv']).toBe('UCISgnSNwqQ2i8lhCun3KtQg'); // was Google for Developers
    expect(id['dd-news']).toBe('UCKwucPzHZ7zCUIf7If-Wo1g');
    expect(id['khan-gs']).toBe('UCatL-c6pmnjzEOHSyjn-sHA');
    expect(id['soch-mohak']).toBe('UCz4a7agVFr1TxU-mpAP8hkw');
    expect(id.csis).toBe('UCr5jq6MC_VCe1c5ciIZtk_w');
  });

  it('each curated video carries its own title (three pairs were swapped)', () => {
    const titleOf = Object.fromEntries(YOUTUBE_SOURCES.flatMap((c) => (c.fallbackVideos || []).map((v) => [v.videoId, v.title])));
    expect(titleOf.UY9H83yQnzc).toMatch(/^BETRAYAL OF SAUDI ARABIA/);
    expect(titleOf['3MtJg5rJars']).toMatch(/^Inside Air India/);
    expect(titleOf['7ncDwpDZkho']).toMatch(/^Red Lines and Reality/);
  });
});
