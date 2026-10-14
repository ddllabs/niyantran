import { describe, it, expect } from 'vitest';
import {
  getLiveTvChannels,
  getLiveTvSchedule,
  getLiveTvArchive,
  getLiveTvTranscript,
} from '../../server/liveTvApi.mjs';

describe('CR-08 — Live TV Contracts and Data Verification', () => {
  it('loads canonical channels catalogue with verified attributes', () => {
    const data = getLiveTvChannels();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.channels)).toBe(true);
    expect(data.channels.length).toBeGreaterThanOrEqual(8);
    expect(data.activeChannelId).toBe('dd-news');

    // Verify channel schema invariants
    for (const ch of data.channels) {
      expect(ch.id).toBeDefined();
      expect(typeof ch.name).toBe('string');
      expect(ch.name.length).toBeGreaterThan(0);
      expect(ch.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(ch.lang).toBeDefined();
      expect(ch.channelId).toBeDefined();
      expect(ch.embedUrl).toContain('youtube');
      expect(['live', 'recent', 'soon', 'offline']).toContain(ch.status);
      // Live count/viewer verification: must be null or positive integer, NEVER fake fabricated numbers
      if (ch.viewers !== null) {
        expect(Number.isInteger(ch.viewers)).toBe(true);
        expect(ch.viewers).toBeGreaterThanOrEqual(0);
      }
    }
  });

  // F7 (F171 B8): schedules, archive entries and transcripts were invented; none is shown now.
  it('shows no invented schedule, archive or transcript', () => {
    const dd = getLiveTvSchedule('dd-news');
    expect(dd.ok).toBe(true);
    expect(dd.channelId).toBe('dd-news');
    expect(dd.items).toEqual([]);
    expect(dd.message).toBe('Schedule not published');
    expect(getLiveTvArchive().items).toEqual([]);
    expect(getLiveTvArchive('dd-news').items).toEqual([]);
    expect(getLiveTvTranscript('arch-dd-2026-09-26').available).toBe(false);
  });

  it('handles transcript unavailable state gracefully without generating fabricated content', () => {
    // Missing broadcast ID
    const empty = getLiveTvTranscript('');
    expect(empty.ok).toBe(false);
    expect(empty.error).toBe('broadcastId required');

    // Broadcast with no transcript
    const noTranscript = getLiveTvTranscript('arch-cnbc-2026-09-23');
    expect(noTranscript.ok).toBe(true);
    expect(noTranscript.available).toBe(false);
    expect(noTranscript.message).toBe('No transcript available.');
    expect(noTranscript.cues).toEqual([]);

    // Unknown broadcast
    const unknown = getLiveTvTranscript('non-existent-id');
    expect(unknown.ok).toBe(true);
    expect(unknown.available).toBe(false);
    expect(unknown.message).toBe('No transcript available.');
    expect(unknown.cues).toEqual([]);
  });

  it('verifies client helpers map to expected endpoints and handle network failure', async () => {
    const {
      fetchLiveTvChannels,
      fetchLiveTvSchedule,
      fetchLiveTvArchive,
      fetchLiveTvTranscript,
    } = await import('./liveTvClient.js');

    // Test with mocked global fetch
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url) => {
        if (url.includes('/api/livetv/channels')) {
          return new Response(JSON.stringify(getLiveTvChannels()));
        }
        if (url.includes('/api/livetv/schedule')) {
          return new Response(JSON.stringify(getLiveTvSchedule('dd-news')));
        }
        if (url.includes('/api/livetv/archive')) {
          return new Response(JSON.stringify(getLiveTvArchive('dd-news')));
        }
        if (url.includes('/api/livetv/transcript')) {
          return new Response(JSON.stringify(getLiveTvTranscript('arch-dd-2026-09-26')));
        }
        return new Response('Not found', { status: 404 });
      };

      const ch = await fetchLiveTvChannels();
      expect(ch.ok).toBe(true);
      expect(ch.channels.length).toBeGreaterThanOrEqual(8);

      const sch = await fetchLiveTvSchedule('dd-news');
      expect(sch.ok).toBe(true);
      expect(sch.items).toEqual([]);

      const arch = await fetchLiveTvArchive('dd-news');
      expect(arch.ok).toBe(true);
      expect(arch.items).toEqual([]);

      const tr = await fetchLiveTvTranscript('arch-dd-2026-09-26');
      expect(tr.ok).toBe(true);
      expect(tr.available).toBe(false);
      expect(tr.cues).toEqual([]);

      // Network failure returns safe error shape
      globalThis.fetch = async () => {
        throw new Error('Connection refused');
      };
      const failed = await fetchLiveTvChannels();
      expect(failed.ok).toBe(false);
      expect(failed.error).toContain('Connection refused');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('renders LiveTvModal closed when open=false and renders dialog structure when open=true', async () => {
    const React = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const LiveTvModal = (await import('../shell/LiveTvModal.jsx')).default;

    // When closed, renders null
    const closedHtml = renderToStaticMarkup(
      React.createElement(LiveTvModal, { open: false, onClose: () => {} })
    );
    expect(closedHtml).toBe('');

    // When open, renders full player container, tabs, and controls
    const openHtml = renderToStaticMarkup(
      React.createElement(LiveTvModal, { open: true, onClose: () => {} })
    );
    expect(openHtml).toContain('NIYANTRAN LIVE TV');
    expect(openHtml).toContain('ltv-modal');
    expect(openHtml).toContain('ltv-video-container');
    expect(openHtml).toContain('Broadcast Schedule');
    expect(openHtml).toContain('Archived Segments');
    expect(openHtml).toContain('Transcript');
    expect(openHtml).not.toContain('Authoritative');
  });

  it('supports curated YouTube sources across all 6 required categories', () => {
    const all = getLiveTvChannels();
    expect(all.ok).toBe(true);
    const requiredCategories = ['NEWS', 'EDUCATION', 'POLITICS', 'ECONOMICS', 'RESEARCH', 'GENERAL'];
    for (const cat of requiredCategories) {
      expect(all.categories).toContain(cat);
      const filtered = getLiveTvChannels({ category: cat });
      expect(filtered.ok).toBe(true);
      expect(filtered.channels.length).toBeGreaterThanOrEqual(1);
      expect(filtered.channels.every((c) => c.category === cat)).toBe(true);
    }

    // Specific curated channel presence
    const dhruv = all.channels.find((c) => c.id === 'dhruv-rathee');
    expect(dhruv).toBeDefined();
    expect(dhruv.category).toBe('POLITICS');
    expect(dhruv.channelId).toBe('UC-CSyyi47VX1lD9zyeABW3w');
    expect(dhruv.embedUrl).toContain('youtube-nocookie.com/embed');

    const thinkSchool = all.channels.find((c) => c.id === 'think-school');
    expect(thinkSchool).toBeDefined();
    expect(thinkSchool.category).toBe('EDUCATION');

    const csis = all.channels.find((c) => c.id === 'csis');
    expect(csis).toBeDefined();
    expect(csis.category).toBe('RESEARCH');
  });

  it('retrieves recent channel videos and handles live stream endpoints safely', async () => {
    const { getLiveTvVideos, getLiveTvLiveStreams } = await import('../../server/liveTvApi.mjs');
    
    // Videos for dhruv-rathee
    const dhruvVideos = await getLiveTvVideos('dhruv-rathee');
    expect(dhruvVideos.ok).toBe(true);
    expect(dhruvVideos.channelId).toBe('dhruv-rathee');
    expect(Array.isArray(dhruvVideos.recentVideos)).toBe(true);
    expect(dhruvVideos.recentVideos.length).toBeGreaterThanOrEqual(1);
    expect(dhruvVideos.recentVideos[0].embedUrl).toContain('youtube-nocookie.com/embed');

    // Live streams: none is claimed until liveness is checked (F7).
    const liveStreams = await getLiveTvLiveStreams();
    expect(liveStreams.ok).toBe(true);
    expect(liveStreams.liveStreams).toEqual([]);

    // Missing channel ID error handling
    const missing = await getLiveTvVideos('');
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain('channelId required');
  });

  it('renders category filter bar, video cards, and status chips in LiveTvModal', async () => {
    const React = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const LiveTvModal = (await import('../shell/LiveTvModal.jsx')).default;

    const html = renderToStaticMarkup(
      React.createElement(LiveTvModal, { open: true, onClose: () => {} })
    );

    expect(html).toContain('ltv-category-bar');
    expect(html).toContain('ltv-category-pill');
    expect(html).toContain('Channel Videos');
    expect(html).toContain('ltv-strip-loading');
  });

  it('normalizes YouTube video items across URL variations and preserves both id and videoId', async () => {
    const { extractYouTubeVideoId, normalizeYouTubeVideo } = await import('../../server/liveTvApi.mjs');

    // extractYouTubeVideoId test
    expect(extractYouTubeVideoId('y60wB0i2b7g')).toBe('y60wB0i2b7g');
    expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=y60wB0i2b7g')).toBe('y60wB0i2b7g');
    expect(extractYouTubeVideoId('https://youtu.be/y60wB0i2b7g')).toBe('y60wB0i2b7g');
    expect(extractYouTubeVideoId('https://www.youtube.com/live/y60wB0i2b7g')).toBe('y60wB0i2b7g');
    expect(extractYouTubeVideoId('https://www.youtube-nocookie.com/embed/y60wB0i2b7g')).toBe('y60wB0i2b7g');
    expect(extractYouTubeVideoId('live_stream')).toBe('live_stream');

    // normalizeYouTubeVideo output shape
    const item = {
      id: 'https://www.youtube.com/watch?v=y60wB0i2b7g',
      snippet: {
        title: 'Geopolitical Dynamics & Tech Supply Chains',
        channelId: 'test-channel',
      },
    };
    const norm = normalizeYouTubeVideo(item, 'fallback-channel');
    expect(norm).toBeDefined();
    expect(norm.id).toBe('y60wB0i2b7g');
    expect(norm.videoId).toBe('y60wB0i2b7g');
    expect(norm.channelId).toBe('test-channel');
    expect(norm.embedUrl).toContain('youtube-nocookie.com/embed/y60wB0i2b7g');
    expect(norm.embedUrl).not.toContain('key=');
    expect(norm.embedUrl).not.toContain('secret');
  });

  it('verifies YouTube embed URLs avoid secrets and use privacy-enhanced domain', () => {
    const data = getLiveTvChannels();
    for (const ch of data.channels) {
      expect(ch.embedUrl).toContain('youtube-nocookie.com/embed');
      expect(ch.embedUrl).not.toContain('key=');
      expect(ch.embedUrl).not.toContain('api_key');
      expect(ch.embedUrl).not.toContain('secret');
    }
  });

});
