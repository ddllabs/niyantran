// F7 / O7 (F171 B8): Live TV served hand-written transcripts labelled "Verified Record", invented
// archive entries and schedules, placeholder programmes ("<channel> Intelligence & Sectoral
// Deep-Dive"), stock-photo thumbnails with made-up titles and a hard-coded "live" status. Only real
// content is shown now; where nothing real exists the screen says so.
import { describe, expect, it } from 'vitest';
import * as liveTv from '../../server/liveTvApi.mjs';

const { YOUTUBE_SOURCES, getLiveTvArchive, getLiveTvSchedule, getLiveTvTranscript } = liveTv;

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
});
